import path from "path"
import { Effect, Schema } from "effect"
import { parse } from "jsonc-parser"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./file_relations.txt"
import * as Tool from "./tool"

export const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
export const DEPENDENT_LIMIT = 50
const CANDIDATE_LIMIT = 5000
// Specifiers that point at a directory's index without naming it: ".", "..", "./index", "../index.ts".
const BARE_INDEX_SPECIFIER = /^\.\.?(\/(index(\.[cm]?[jt]sx?)?)?)?$/

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "Absolute or workspace-relative path to a JavaScript or TypeScript file",
  }),
})

export type ImportKind = "same-package" | "workspace" | "external"

export type ImportInfo = {
  specifier: string
  kind: ImportKind
  dynamic?: true
  resolved?: string
}

type Alias = { prefix: string; exact: boolean; targets: string[] }

type PackageInfo = {
  root: string
  name?: string
  aliases: Alias[]
  exports?: unknown
  imports?: unknown
  main?: string
}

type WorkspacePackage = { root: string; exports?: unknown; main?: string }

type Metadata = { imports: number; exports: number; dependents: number }

export const FileRelationsTool = Tool.define<typeof Parameters, Metadata, FSUtil.Service | Ripgrep.Service>(
  "file_relations",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service

    const readJsonc = Effect.fn("FileRelationsTool.readJsonc")(function* (file: string) {
      const text = yield* fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!text) return undefined
      const value: unknown = parse(text)
      return value && typeof value === "object" ? (value as Record<string, any>) : undefined
    })

    // Tries the path as written, then with each extension, then as a directory index.
    // Also maps TypeScript's "./foo.js" convention back to "./foo.ts".
    const resolveFile = Effect.fn("FileRelationsTool.resolveFile")(function* (base: string) {
      const stem = /\.[cm]?jsx?$/.test(base) ? base.replace(/\.([cm]?)js(x?)$/, "") : undefined
      const candidates = [
        base,
        ...EXTENSIONS.map((ext) => base + ext),
        ...(stem ? EXTENSIONS.map((ext) => stem + ext) : []),
        ...EXTENSIONS.map((ext) => path.join(base, "index" + ext)),
      ]
      for (const candidate of candidates) {
        if (yield* fs.isFile(candidate)) return candidate
      }
      return undefined
    })

    const readPackage = Effect.fn("FileRelationsTool.readPackage")(function* (
      manifest: string | undefined,
      fallback: string,
    ) {
      const root = manifest ? path.dirname(manifest) : fallback
      const json = manifest ? yield* readJsonc(manifest) : undefined
      const name = json?.name
      const main = typeof json?.main === "string" ? json.main : undefined
      const options = (yield* readJsonc(path.join(root, "tsconfig.json")))?.compilerOptions
      const base = path.resolve(root, typeof options?.baseUrl === "string" ? options.baseUrl : ".")
      const paths: Record<string, unknown> = options?.paths && typeof options.paths === "object" ? options.paths : {}
      // Like TypeScript, exact keys win, then the longest prefix, regardless of key order.
      const aliases = Object.entries(paths)
        .map(([key, targets]) => ({
          prefix: key.replace(/\*$/, ""),
          exact: !key.endsWith("*"),
          targets: (Array.isArray(targets) ? targets : [])
            .filter((target): target is string => typeof target === "string")
            .map((target) => path.resolve(base, target)),
        }))
        .toSorted((a, b) => Number(b.exact) - Number(a.exact) || b.prefix.length - a.prefix.length)
      return {
        root,
        name: typeof name === "string" ? name : undefined,
        aliases,
        exports: json?.exports,
        imports: json?.imports,
        main,
      } satisfies PackageInfo
    })

    const loadWorkspace = Effect.fn("FileRelationsTool.loadWorkspace")(function* (worktree: string) {
      const workspaces = (yield* readJsonc(path.join(worktree, "package.json")))?.workspaces
      const patterns: unknown[] = Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? [])
      const packages = new Map<string, WorkspacePackage>()
      for (const pattern of patterns) {
        if (typeof pattern !== "string") continue
        const manifests = yield* fs
          .glob(path.posix.join(pattern, "package.json"), { cwd: worktree, absolute: true })
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
        for (const manifest of manifests) {
          const json = yield* readJsonc(manifest)
          if (typeof json?.name !== "string") continue
          const main = typeof json.main === "string" ? json.main : undefined
          packages.set(json.name, { root: path.dirname(manifest), exports: json.exports, main })
        }
      }
      return packages
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          // Non-git projects report worktree "/", so fall back to the project directory
          // to keep the search from walking the whole disk.
          const root = ins.worktree === "/" ? ins.directory : ins.worktree
          const file = path.resolve(ins.directory, params.filePath)

          yield* assertExternalDirectoryEffect(ctx, file, { kind: "file" })
          yield* ctx.ask({
            permission: "read",
            patterns: [path.relative(ins.worktree, file)],
            always: ["*"],
            metadata: {},
          })

          if (!(yield* fs.existsSafe(file))) throw new Error(`File not found: ${file}`)
          if (!(yield* fs.isFile(file))) throw new Error(`Not a file: ${file}`)
          if (!EXTENSIONS.includes(path.extname(file))) {
            throw new Error(`Unsupported file type: ${file} (supported: ${EXTENSIONS.join(", ")})`)
          }

          const workspace = yield* loadWorkspace(root)
          const packages = new Map<string, PackageInfo>()

          // Cached per directory because dependents scanning resolves many files in the same folders.
          const packageOf = Effect.fnUntraced(function* (target: string) {
            const dir = path.dirname(target)
            const cached = packages.get(dir)
            if (cached) return cached
            const [manifest] = yield* fs.findUp("package.json", dir, root)
            const info = yield* readPackage(manifest, root)
            packages.set(dir, info)
            return info
          })

          const resolveWorkspace = Effect.fnUntraced(function* (
            specifier: string,
            name: string,
            pkg: WorkspacePackage,
            require: boolean,
          ) {
            const sub = specifier === name ? "." : "." + specifier.slice(name.length)
            const target = exportTarget(pkg.exports, sub, require) ?? (sub === "." ? (pkg.main ?? "index") : sub)
            return yield* resolveFile(path.resolve(pkg.root, target))
          })

          // `require` picks the "require" condition over "import" in package.json maps.
          const classify: (
            specifier: string,
            from: string,
            require?: boolean,
          ) => Effect.Effect<{ kind: ImportKind; resolved: string | undefined }, Error> = Effect.fnUntraced(function* (
            specifier: string,
            from: string,
            require = false,
          ) {
            const pkg = yield* packageOf(from)
            // "#name" imports go through the importing package's own package.json "imports" map.
            if (specifier.startsWith("#")) {
              const target = importTarget(pkg.imports, specifier, require)
              if (target && !target.startsWith(".")) return yield* classify(target, from, require)
              const resolved = target ? yield* resolveFile(path.resolve(pkg.root, target)) : undefined
              return { kind: "same-package" as const, resolved }
            }
            if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
              const target = path.resolve(path.dirname(from), specifier)
              const resolved = yield* resolveFile(target)
              const kind: ImportKind = inside(pkg.root, target)
                ? "same-package"
                : inside(root, target)
                  ? "workspace"
                  : "external"
              return { kind, resolved }
            }

            const aliases = pkg.aliases.filter((item) =>
              item.exact ? specifier === item.prefix : specifier.startsWith(item.prefix),
            )
            for (const alias of aliases) {
              for (const target of alias.targets) {
                const rest = specifier.slice(alias.prefix.length)
                const base = alias.exact
                  ? target
                  : target.includes("*")
                    ? target.replace("*", rest)
                    : path.join(target, rest)
                const resolved = yield* resolveFile(base)
                if (resolved) return { kind: "same-package" as const, resolved }
              }
            }
            // A catch-all "*" alias that resolves nothing falls back to normal package lookup, as in TypeScript.
            if (aliases.some((item) => item.prefix !== ""))
              return { kind: "same-package" as const, resolved: undefined }

            const name = packageName(specifier)
            if (name === pkg.name) {
              return { kind: "same-package" as const, resolved: yield* resolveWorkspace(specifier, name, pkg, require) }
            }
            const member = workspace.get(name)
            if (!member) return { kind: "external" as const, resolved: undefined }
            return { kind: "workspace" as const, resolved: yield* resolveWorkspace(specifier, name, member, require) }
          })

          // Ripgrep narrows candidates to files with a quoted path ending in the target's name,
          // then each candidate is parsed and resolved so only real imports count.
          const findDependents = Effect.fnUntraced(function* () {
            const pkg = yield* packageOf(file)
            // "#name" keys in the package's "imports" map that can point at this file (any condition).
            const importKeys = new Set<string>()
            if (pkg.imports && typeof pkg.imports === "object") {
              for (const [key, value] of Object.entries(pkg.imports)) {
                if (key.includes("*")) continue
                for (const target of allTargets(value)) {
                  if ((yield* resolveFile(path.resolve(pkg.root, target))) === file) importKeys.add(key)
                }
              }
            }
            const terms = [...searchTerms(file, pkg.name), ...importKeys]
            const pattern = searchPattern(terms)
            let failed = false
            const matches = yield* ripgrep
              .grep({
                cwd: root,
                pattern,
                include: `*.{${EXTENSIONS.map((ext) => ext.slice(1)).join(",")}}`,
                limit: CANDIDATE_LIMIT,
                signal: ctx.abort,
              })
              .pipe(
                Effect.catch(() => {
                  failed = true
                  return Effect.succeed([])
                }),
              )
            const candidates = new Set(matches.map((match) => path.resolve(root, match.entry.path)))
            const index = path.basename(file, path.extname(file)) === "index"
            // "." and ".." imports of an index file never name it, so check its neighbors directly.
            if (index) for (const neighbor of yield* nearbyFiles(path.dirname(file))) candidates.add(neighbor)

            const dependents: string[] = []
            for (const candidate of candidates) {
              if (candidate === file || candidate.split(path.sep).includes("node_modules")) continue
              const source = yield* fs.readFileStringSafe(candidate).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (!source) continue
              const imports = yield* Effect.try({
                try: () => scan(source, candidate).imports,
                catch: (cause) => cause,
              }).pipe(Effect.catch(() => Effect.succeed([] as ReturnType<typeof scan>["imports"])))
              for (const item of imports) {
                const bare = BARE_INDEX_SPECIFIER.test(item.specifier)
                if (!(index && bare) && !terms.some((term) => item.specifier.includes(term))) continue
                const own = importKeys.has(item.specifier) && (yield* packageOf(candidate)).root === pkg.root
                if (!own && (yield* classify(item.specifier, candidate, item.require)).resolved !== file) continue
                dependents.push(path.relative(root, candidate))
                break
              }
            }
            const incomplete = failed
              ? "dependent search failed, so some dependents may be missing"
              : matches.length >= CANDIDATE_LIMIT
                ? `search stopped after ${CANDIDATE_LIMIT} matching lines, so some dependents may be missing`
                : undefined
            return { files: dependents.toSorted(), incomplete }
          })

          // Source files in a directory and its immediate subdirectories.
          const nearbyFiles = Effect.fnUntraced(function* (dir: string) {
            const list = (target: string) =>
              fs.readDirectoryEntries(target).pipe(Effect.catch(() => Effect.succeed([] as FSUtil.DirEntry[])))
            const files: string[] = []
            for (const entry of yield* list(dir)) {
              const full = path.join(dir, entry.name)
              if (entry.type === "file" && EXTENSIONS.includes(path.extname(entry.name))) files.push(full)
              if (entry.type !== "directory" || entry.name === "node_modules") continue
              for (const child of yield* list(full)) {
                if (child.type === "file" && EXTENSIONS.includes(path.extname(child.name)))
                  files.push(path.join(full, child.name))
              }
            }
            return files
          })

          const source = yield* fs.readFileStringSafe(file)
          const scanned = yield* Effect.try({
            try: () => scan(source ?? "", file),
            catch: (cause) => cause,
          }).pipe(
            Effect.catch((cause) =>
              Effect.die(
                new Error(`Could not parse ${file}: ${cause instanceof Error ? cause.message : String(cause)}`),
              ),
            ),
          )
          const pkg = yield* packageOf(file)

          const imports: ImportInfo[] = []
          for (const item of scanned.imports) {
            const { kind, resolved } = yield* classify(item.specifier, file, item.require)
            imports.push({
              specifier: item.specifier,
              kind,
              ...(item.dynamic && { dynamic: true as const }),
              ...(resolved && { resolved: path.relative(root, resolved) }),
            })
          }

          const search = yield* findDependents()
          const dependents = search.files
          const shown = dependents.slice(0, DEPENDENT_LIMIT)
          const result = {
            file: path.relative(root, file),
            package: pkg.name ?? null,
            imports,
            exports: scanned.exports,
            dependents: {
              total: dependents.length,
              files: shown,
              ...(dependents.length > shown.length && {
                truncated: `...and ${dependents.length - shown.length} more (showing first ${DEPENDENT_LIMIT})`,
              }),
              ...(search.incomplete && { incomplete: search.incomplete }),
            },
          }

          return {
            title: result.file,
            metadata: { imports: imports.length, exports: scanned.exports.length, dependents: dependents.length },
            output: JSON.stringify(result, null, 2),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// Bun's scanner is a real parser: comments and strings never yield imports,
// and type-only imports and exports are dropped because they erase at runtime.
export function scan(source: string, file: string) {
  const loader = file.endsWith(".tsx") ? "tsx" : file.endsWith(".jsx") ? "jsx" : /\.[cm]?ts$/.test(file) ? "ts" : "js"
  const transpiler = new Bun.Transpiler({ loader })
  // Bun's scanner rejects a leading "#!" line, so blank it out first.
  source = source.replace(/^#!.*/, "")
  // scan() finds exports; scanImports() also reports require() calls, which scan() skips.
  const exports = transpiler.scan(source).exports
  const seen = new Map<string, { specifier: string; dynamic: boolean; require: boolean }>()
  for (const item of transpiler.scanImports(source)) {
    const dynamic = item.kind === "dynamic-import"
    const require = item.kind === "require-call"
    const existing = seen.get(item.path)
    if (existing) {
      existing.dynamic &&= dynamic
      existing.require &&= require
    } else seen.set(item.path, { specifier: item.path, dynamic, require })
  }
  return {
    imports: [...seen.values()].toSorted((a, b) => a.specifier.localeCompare(b.specifier)),
    exports: [...exports].toSorted(),
  }
}

export function packageName(specifier: string) {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

// Maps a package subpath ("." or "./fs-util") through a package.json "exports" field.
export function exportTarget(exports: unknown, sub: string, require = false): string | undefined {
  if (!exports || typeof exports !== "object") return sub === "." ? pick(exports, require) : undefined
  const map = exports as Record<string, unknown>
  if (!Object.keys(map).some((key) => key.startsWith("."))) return sub === "." ? pick(map, require) : undefined
  return subpathTarget(map, sub, require)
}

// Maps a "#name" specifier through a package.json "imports" field.
export function importTarget(imports: unknown, specifier: string, require = false): string | undefined {
  if (!imports || typeof imports !== "object") return undefined
  return subpathTarget(imports as Record<string, unknown>, specifier, require)
}

function pick(value: unknown, require: boolean): string | undefined {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return undefined
  const conditions = value as Record<string, unknown>
  const style = require ? conditions.require : conditions.import
  return pick(conditions.bun ?? style ?? conditions.default ?? conditions.types, require)
}

// Every file path a conditional target can point to, e.g. both the "bun" and "node" variants.
export function allTargets(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (!value || typeof value !== "object") return []
  return Object.values(value).flatMap(allTargets)
}

function subpathTarget(map: Record<string, unknown>, sub: string, require: boolean): string | undefined {
  if (sub in map) return pick(map[sub], require)
  // Like Node, the pattern with the longest prefix before "*" wins, regardless of key order.
  const best = Object.entries(map)
    .map(([key, value]) => ({
      value,
      before: key.slice(0, key.indexOf("*")),
      after: key.slice(key.indexOf("*") + 1),
      star: key.includes("*"),
    }))
    .filter((item) => item.star && sub.length >= item.before.length + item.after.length)
    .filter((item) => sub.startsWith(item.before) && sub.endsWith(item.after))
    .toSorted((a, b) => b.before.length - a.before.length)[0]
  return best
    ? pick(best.value, require)?.replace("*", sub.slice(best.before.length, sub.length - best.after.length))
    : undefined
}

// Words an importing specifier must contain: the file's own name, or for index
// files the folder name plus the package name, since an entry point can be imported by either.
// Matches a term only at the end of a quoted import path ("./en", "@x/en.js", "../en/index"),
// so short names like "en" do not match every line in the repository.
export function searchPattern(terms: string[]) {
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  const ext = "(\\.[cm]?[jt]sx?)?"
  return `["'\`/](${escaped})${ext}(/index${ext})?["'\`]`
}

export function searchTerms(file: string, pkgName?: string) {
  const base = path.basename(file, path.extname(file))
  if (base !== "index") return [base]
  return [...new Set([path.basename(path.dirname(file)), ...(pkgName ? [pkgName] : [])])]
}

function inside(dir: string, target: string) {
  const relative = path.relative(dir, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
