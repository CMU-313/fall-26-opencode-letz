import path from "path"
import { builtinModules } from "module"
import { Effect, Option, Schema } from "effect"
import { parse } from "jsonc-parser"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { containsPath } from "@/project/instance-context"
import { Tool } from "./tool"
import DESCRIPTION from "./directory_summary.txt"

export const Parameters = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "Directory within the current workspace; relative paths use the active working directory.",
  }),
})

const TsConfig = Schema.Struct({
  compilerOptions: Schema.optional(
    Schema.Struct({
      baseUrl: Schema.optional(Schema.String),
      paths: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
    }),
  ),
})

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/i
const CONFIG =
  /^(?:tsconfig|jsconfig)(?:\..+)?\.json$|^bunfig\.toml$|[.-]config\.\w+$|^\.\w[\w.-]*rc(?:\.\w+)?$|^\.(?:gitignore|editorconfig|env)/i
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".json"]
const ENTRY_LIMIT = 200
// Bounds filesystem work per call; the dependency list in the output is capped separately.
const SCAN_LIMIT = 1000
const DEPENDENCY_LIMIT = 200
const SOURCE_BYTES = 256 * 1024

type Alias = { prefix: string; suffix: string; wildcard: boolean; targets: string[] }
type Resolution =
  | { type: "dependency"; kind: "relative" | "alias" | "workspace"; target: string; directory: string }
  | { type: "external"; kind: "package" | "builtin"; name: string }
  | { type: "unresolved" }

export const DirectorySummaryTool = Tool.define(
  "directory_summary",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const readAliases = Effect.fn("DirectorySummaryTool.readAliases")(function* (directory: string, root: string) {
      const config = (yield* fs
        .findUp("tsconfig.json", directory, root)
        .pipe(Effect.orElseSucceed(() => [] as string[])))[0]
      if (!config) return [] as Alias[]
      const text = yield* fs.readFileString(config).pipe(Effect.orElseSucceed(() => ""))
      const options = Option.getOrUndefined(
        Schema.decodeUnknownOption(TsConfig)(parse(text, [], { allowTrailingComma: true })),
      )?.compilerOptions
      // TypeScript resolves `paths` relative to `baseUrl`, or to the tsconfig directory when it is unset.
      const base = path.resolve(path.dirname(config), options?.baseUrl ?? ".")
      return Object.entries(options?.paths ?? {})
        .map(([pattern, targets]): Alias => {
          const star = pattern.indexOf("*")
          return {
            prefix: star === -1 ? pattern : pattern.slice(0, star),
            suffix: star === -1 ? "" : pattern.slice(star + 1),
            wildcard: star !== -1,
            targets: targets.map((target) => path.resolve(base, target)),
          }
        })
        .toSorted((a, b) => b.prefix.length - a.prefix.length)
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const requested = path.resolve(instance.directory, params.path)
          // Resolve symlinks before the boundary check so a link cannot point the scan outside the workspace.
          const directory = yield* Effect.try({ try: () => FSUtil.resolve(requested), catch: () => requested }).pipe(
            Effect.orElseSucceed(() => requested),
          )
          if (!containsPath(directory, instance)) {
            return yield* Effect.fail(
              new Error(`directory_summary path must be within the current workspace: ${directory}`),
            )
          }
          const root = instance.worktree === "/" ? instance.directory : instance.worktree
          const relative = (file: string) => path.relative(root, file).split(path.sep).join("/") || "."
          const ask = (file: string) =>
            ctx.ask({ permission: "read", patterns: [relative(file)], always: ["*"], metadata: {} })
          const inaccessible = () => Effect.fail(new Error(`Directory is not accessible: ${directory}`))
          yield* ask(directory)

          const stat = yield* fs.stat(directory).pipe(
            Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
            Effect.catch(inaccessible),
          )
          if (!stat) return yield* Effect.fail(new Error(`Directory not found: ${directory}`))
          if (stat.type !== "Directory") return yield* Effect.fail(new Error(`Path is not a directory: ${directory}`))

          const entries = (yield* fs.readDirectoryEntries(directory).pipe(Effect.catch(inaccessible))).toSorted(
            (a, b) => a.name.localeCompare(b.name),
          )
          const selected = entries.slice(0, ENTRY_LIMIT)
          const files = selected
            .filter((entry) => entry.type === "file")
            .map((entry) => ({ name: entry.name, role: role(entry.name, path.basename(directory)) }))
          const subdirectories = selected.filter((entry) => entry.type === "directory").map((entry) => entry.name)
          const skipped = selected
            .filter((entry) => entry.type === "symlink")
            .map((entry) => ({ file: entry.name, reason: "Symbolic links are not scanned" }))
          const coverage = { truncated: entries.length > ENTRY_LIMIT, records: 0 }

          const resolveModule = Effect.fnUntraced(function* (base: string) {
            const candidates = [
              base,
              ...(/\.[cm]?js$/.test(base) ? [base.replace(/js$/, "ts"), base.replace(/js$/, "tsx")] : []),
              ...EXTENSIONS.map((ext) => base + ext),
              ...EXTENSIONS.map((ext) => path.join(base, "index" + ext)),
            ]
            for (const candidate of candidates) {
              if (!(yield* fs.isFile(candidate))) continue
              const real = FSUtil.normalizePath(
                yield* fs.realPath(candidate).pipe(Effect.orElseSucceed(() => candidate)),
              )
              return containsPath(real, instance) ? real : undefined
            }
            return undefined
          })

          const aliases = yield* readAliases(directory, root)
          const packages = new Map<string, { root: string; exports: unknown } | undefined>()
          const findPackage = Effect.fnUntraced(function* (name: string) {
            if (packages.has(name)) return packages.get(name)
            const link = (yield* fs
              .findUp(path.join("node_modules", name), directory, root)
              .pipe(Effect.orElseSucceed(() => [] as string[])))[0]
            const real = link
              ? FSUtil.normalizePath(yield* fs.realPath(link).pipe(Effect.orElseSucceed(() => link)))
              : undefined
            // Workspace packages are symlinked into node_modules from inside the repository;
            // installed third-party packages resolve to a real path that is still under node_modules.
            if (!real || !containsPath(real, instance) || real.split(path.sep).includes("node_modules")) {
              packages.set(name, undefined)
              return undefined
            }
            const manifest = path.join(real, "package.json")
            yield* ask(manifest)
            const pkg = yield* fs.readJson(manifest).pipe(Effect.orElseSucceed(() => undefined))
            const found = { root: real, exports: isRecord(pkg) ? pkg.exports : undefined }
            packages.set(name, found)
            return found
          })

          const resolveImport = Effect.fnUntraced(function* (specifier: string): Effect.fn.Return<Resolution> {
            if (/^\.\.?(?:\/|$)/.test(specifier)) {
              const target = yield* resolveModule(path.resolve(directory, specifier))
              if (!target) return { type: "unresolved" }
              return { type: "dependency", kind: "relative", target, directory: path.dirname(target) }
            }
            const alias = aliases.find((item) =>
              item.wildcard
                ? specifier.startsWith(item.prefix) &&
                  specifier.endsWith(item.suffix) &&
                  specifier.length >= item.prefix.length + item.suffix.length
                : specifier === item.prefix,
            )
            if (alias) {
              const match = alias.wildcard
                ? specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length)
                : ""
              for (const target of alias.targets) {
                const resolved = yield* resolveModule(target.replace("*", match))
                if (resolved)
                  return { type: "dependency", kind: "alias", target: resolved, directory: path.dirname(resolved) }
              }
              return { type: "unresolved" }
            }
            if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier === "bun") {
              return { type: "external", kind: "builtin", name: specifier }
            }
            const parts = specifier.split("/")
            const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
            if (builtinModules.includes(name)) return { type: "external", kind: "builtin", name }
            const pkg = yield* findPackage(name)
            if (!pkg) return { type: "external", kind: "package", name }
            const subpath = specifier.slice(name.length + 1)
            const entry = exportTarget(pkg.exports, subpath)
            const target = yield* resolveModule(entry ? path.resolve(pkg.root, entry) : path.join(pkg.root, subpath))
            if (!target) return { type: "dependency", kind: "workspace", target: pkg.root, directory: pkg.root }
            return { type: "dependency", kind: "workspace", target, directory: path.dirname(target) }
          })

          const dependencies = new Map<
            string,
            { file: string; specifier: string; kind: string; target: string; directory: string }
          >()
          const external = new Map<string, { name: string; kind: string; files: Set<string> }>()
          const unresolved: { file: string; specifier: string }[] = []

          for (const file of files.filter((file) => SOURCE.test(file.name))) {
            if (coverage.records >= SCAN_LIMIT) {
              coverage.truncated = true
              break
            }
            const source = path.join(directory, file.name)
            yield* ask(source)
            const info = yield* fs.stat(source).pipe(Effect.orElseSucceed(() => undefined))
            if (info && Number(info.size) > SOURCE_BYTES) {
              skipped.push({ file: file.name, reason: "Source exceeds 256 KiB scan limit" })
              coverage.truncated = true
              continue
            }
            const text = yield* fs.readFileString(source).pipe(Effect.orElseSucceed(() => undefined))
            if (text === undefined) {
              skipped.push({ file: file.name, reason: "Source file is not readable" })
              continue
            }
            if (typeof Bun === "undefined") {
              skipped.push({ file: file.name, reason: "Import scanning requires the Bun runtime" })
              continue
            }
            const found = yield* Effect.try({ try: () => specifiers(file.name, text), catch: () => undefined }).pipe(
              Effect.orElseSucceed(() => undefined),
            )
            if (!found) {
              skipped.push({ file: file.name, reason: "Imports could not be parsed" })
              continue
            }
            for (const specifier of found) {
              if (coverage.records >= SCAN_LIMIT) {
                coverage.truncated = true
                break
              }
              coverage.records++
              const resolved = yield* resolveImport(specifier)
              if (resolved.type === "unresolved") {
                unresolved.push({ file: file.name, specifier })
                continue
              }
              if (resolved.type === "external") {
                const item = external.get(resolved.name) ?? {
                  name: resolved.name,
                  kind: resolved.kind,
                  files: new Set(),
                }
                item.files.add(file.name)
                external.set(resolved.name, item)
                continue
              }
              // Imports that stay inside the summarized directory, including its subdirectories, are internal structure.
              if (FSUtil.contains(directory, resolved.target)) continue
              const key = `${file.name}\0${resolved.target}`
              if (dependencies.has(key)) continue
              dependencies.set(key, {
                file: file.name,
                specifier,
                kind: resolved.kind,
                target: relative(resolved.target),
                directory: relative(resolved.directory),
              })
            }
          }

          const edges = [...dependencies.values()]
          // Overview fields come first and the per-file lists last, so the standard output
          // truncation only cuts detail and never the coverage flags.
          const summary = {
            path: directory,
            relativePath: relative(directory),
            purpose: purpose(path.basename(directory), files, subdirectories, entries.length),
            truncated: coverage.truncated || edges.length > DEPENDENCY_LIMIT,
            skipped,
            importantFiles: files
              .filter((file) => file.role !== "file" && file.role !== "source")
              .map((file) => file.name),
            subdirectories,
            relatedDirectories: related(edges),
            externalPackages: [...external.values()]
              .map((item) => ({ name: item.name, kind: item.kind, files: [...item.files].toSorted() }))
              .toSorted((a, b) => a.name.localeCompare(b.name)),
            unresolvedImports: unresolved,
            files,
            dependencies: edges.slice(0, DEPENDENCY_LIMIT),
          }
          return {
            title: summary.relativePath,
            output: JSON.stringify(summary, null, 2),
            // `truncated` is deliberately absent so Tool.define still applies the standard output size limit.
            metadata: {
              files: files.length,
              subdirectories: subdirectories.length,
              dependencies: edges.length,
              incomplete: summary.truncated,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function specifiers(file: string, source: string) {
  const loader = file.endsWith(".tsx") ? "tsx" : file.endsWith(".jsx") ? "jsx" : /\.[cm]?ts$/i.test(file) ? "ts" : "js"
  // Bun's scanner is a real parser, so comments, strings, and regex literals never produce false imports.
  // It omits `import type` declarations because they are erased at runtime.
  return [...new Set(new Bun.Transpiler({ loader }).scanImports(source).map((item) => item.path))].toSorted()
}

function related(edges: { file: string; directory: string }[]) {
  return [...Map.groupBy(edges, (edge) => edge.directory).entries()]
    .map(([directory, items]) => ({
      directory,
      imports: items.length,
      files: [...new Set(items.map((item) => item.file))].toSorted(),
    }))
    .toSorted((a, b) => b.imports - a.imports || a.directory.localeCompare(b.directory))
}

function role(file: string, directory: string) {
  if (/^(?:readme|agents|contributing|license|changelog)(?:\.|$)/i.test(file)) return "documentation"
  if (/^(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/.test(file)) return "package manifest"
  if (/^(?:bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/.test(file))
    return "dependency lockfile"
  if (/(?:^|\.)(?:test|spec)\.[^.]+$/.test(file)) return "test"
  // `foo/foo.ts` is the module's main file by convention in this repository.
  if (/^(?:index|main|mod)\.[^.]+$/.test(file) || (SOURCE.test(file) && file.replace(SOURCE, "") === directory))
    return "entry point"
  if (CONFIG.test(file)) return "configuration"
  return SOURCE.test(file) ? "source" : "file"
}

function purpose(name: string, files: { name: string; role: string }[], subdirectories: string[], count: number) {
  if (count === 0) return "Empty directory; no purpose can be inferred."
  if (files.some((file) => file.role === "package manifest"))
    return "Likely a package or project root, with dependency and build metadata."
  const tests = files.filter((file) => file.role === "test").length
  const code = files.filter((file) => SOURCE.test(file.name)).length
  if (/^(?:test|tests|__tests__|spec)$/i.test(name) || (tests > 0 && tests * 2 >= code))
    return "Likely contains automated tests and supporting fixtures."
  if (/^(?:docs?|documentation)$/i.test(name)) return "Likely contains project documentation."
  if (/^(?:scripts?|bin)$/i.test(name)) return "Likely contains tools or automation scripts."
  if (code > 0) return "Likely a source module containing application or library implementation."
  if (files.length === 0 && subdirectories.length > 0)
    return `Likely groups related modules or packages: ${subdirectories.slice(0, 5).join(", ")}${subdirectories.length > 5 ? ", ..." : ""}.`
  return "Groups project files and subdirectories; no more specific purpose can be inferred."
}

// Resolves the subset of package.json `exports` used by workspace packages: exact keys, one `*` pattern, and conditions.
function exportTarget(exports: unknown, subpath: string): string | undefined {
  const key = subpath ? `./${subpath}` : "."
  const map = typeof exports === "string" ? { ".": exports } : exports
  if (!isRecord(map)) return undefined
  if (key in map) return condition(map[key])
  const pattern = Object.keys(map).find((item) => {
    const [prefix, suffix] = item.split("*")
    return item.includes("*") && key.startsWith(prefix) && key.endsWith(suffix)
  })
  if (!pattern) return undefined
  const [prefix, suffix] = pattern.split("*")
  return condition(map[pattern])?.replaceAll("*", key.slice(prefix.length, key.length - suffix.length))
}

function condition(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!isRecord(value)) return undefined
  return ["bun", "import", "default", "node", "require"].map((name) => condition(value[name])).find(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
