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

type PackageInfo = { root: string; name?: string; aliases: Alias[] }

type WorkspacePackage = { root: string; exports: unknown; main?: string }

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

    const readPackage = Effect.fn("FileRelationsTool.readPackage")(function* (manifest: string | undefined, fallback: string) {
      const root = manifest ? path.dirname(manifest) : fallback
      const name = manifest ? (yield* readJsonc(manifest))?.name : undefined
      const options = (yield* readJsonc(path.join(root, "tsconfig.json")))?.compilerOptions
      const base = path.resolve(root, typeof options?.baseUrl === "string" ? options.baseUrl : ".")
      const paths: Record<string, unknown> = options?.paths && typeof options.paths === "object" ? options.paths : {}
      const aliases = Object.entries(paths).map(([key, targets]) => ({
        prefix: key.replace(/\*$/, ""),
        exact: !key.endsWith("*"),
        targets: (Array.isArray(targets) ? targets : [])
          .filter((target): target is string => typeof target === "string")
          .map((target) => path.resolve(base, target.replace(/\*$/, ""))),
      }))
      return { root, name: typeof name === "string" ? name : undefined, aliases } satisfies PackageInfo
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
          const file = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.resolve(ins.directory, params.filePath)

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

          const resolveWorkspace = Effect.fnUntraced(function* (specifier: string, name: string, pkg: WorkspacePackage) {
            const sub = specifier === name ? "." : "." + specifier.slice(name.length)
            const target = exportTarget(pkg.exports, sub) ?? (sub === "." ? (pkg.main ?? "index") : sub)
            return yield* resolveFile(path.resolve(pkg.root, target))
          })

          const classify = Effect.fnUntraced(function* (specifier: string, from: string) {
            const pkg = yield* packageOf(from)
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

            const alias = pkg.aliases.find((item) =>
              item.exact ? specifier === item.prefix : specifier.startsWith(item.prefix),
            )
            if (alias) {
              for (const target of alias.targets) {
                const base = alias.exact ? target : path.join(target, specifier.slice(alias.prefix.length))
                const resolved = yield* resolveFile(base)
                if (resolved) return { kind: "same-package" as const, resolved }
              }
              return { kind: "same-package" as const, resolved: undefined }
            }

            const name = packageName(specifier)
            const member = workspace.get(name)
            if (!member) return { kind: "external" as const, resolved: undefined }
            const resolved = yield* resolveWorkspace(specifier, name, member)
            return { kind: name === pkg.name ? ("same-package" as const) : ("workspace" as const), resolved }
          })

          // Ripgrep narrows candidates to files mentioning the target's name,
          // then each candidate is parsed and resolved so only real imports count.
          const findDependents = Effect.fnUntraced(function* () {
            const pkg = yield* packageOf(file)
            const terms = searchTerms(file, pkg.name)
            const pattern = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
            const matches = yield* ripgrep
              .grep({
                cwd: root,
                pattern,
                include: `*.{${EXTENSIONS.map((ext) => ext.slice(1)).join(",")}}`,
                limit: CANDIDATE_LIMIT,
                signal: ctx.abort,
              })
              .pipe(Effect.catch(() => Effect.succeed([])))
            const candidates = [...new Set(matches.map((match) => path.resolve(root, match.entry.path)))]

            const dependents: string[] = []
            for (const candidate of candidates) {
              if (candidate === file) continue
              const source = yield* fs.readFileStringSafe(candidate).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (!source) continue
              const imports = yield* Effect.try({
                try: () => scan(source, candidate).imports,
                catch: (cause) => cause,
              }).pipe(Effect.catch(() => Effect.succeed([] as ReturnType<typeof scan>["imports"])))
              for (const item of imports) {
                if (!terms.some((term) => item.specifier.includes(term))) continue
                const { resolved } = yield* classify(item.specifier, candidate)
                if (resolved !== file) continue
                dependents.push(path.relative(root, candidate))
                break
              }
            }
            return dependents.toSorted()
          })

          const source = yield* fs.readFileStringSafe(file)
          const scanned = scan(source ?? "", file)
          const pkg = yield* packageOf(file)

          const imports: ImportInfo[] = []
          for (const item of scanned.imports) {
            const { kind, resolved } = yield* classify(item.specifier, file)
            imports.push({
              specifier: item.specifier,
              kind,
              ...(item.dynamic && { dynamic: true as const }),
              ...(resolved && { resolved: path.relative(root, resolved) }),
            })
          }

          const dependents = yield* findDependents()
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
  const result = new Bun.Transpiler({ loader }).scan(source)
  const seen = new Map<string, { specifier: string; dynamic: boolean }>()
  for (const item of result.imports) {
    const dynamic = item.kind === "dynamic-import"
    const existing = seen.get(item.path)
    if (existing) existing.dynamic &&= dynamic
    else seen.set(item.path, { specifier: item.path, dynamic })
  }
  return {
    imports: [...seen.values()].toSorted((a, b) => a.specifier.localeCompare(b.specifier)),
    exports: [...result.exports].toSorted(),
  }
}

export function packageName(specifier: string) {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

// Maps a package subpath ("." or "./fs-util") through a package.json "exports" field.
export function exportTarget(exports: unknown, sub: string): string | undefined {
  const pick = (value: unknown): string | undefined => {
    if (typeof value === "string") return value
    if (!value || typeof value !== "object") return undefined
    const conditions = value as Record<string, unknown>
    return pick(conditions.bun ?? conditions.import ?? conditions.default ?? conditions.types)
  }
  if (!exports || typeof exports !== "object") return sub === "." ? pick(exports) : undefined
  const map = exports as Record<string, unknown>
  if (!Object.keys(map).some((key) => key.startsWith("."))) return sub === "." ? pick(map) : undefined
  if (sub in map) return pick(map[sub])
  for (const [key, value] of Object.entries(map)) {
    const star = key.indexOf("*")
    if (star < 0) continue
    const before = key.slice(0, star)
    const after = key.slice(star + 1)
    if (sub.length < before.length + after.length || !sub.startsWith(before) || !sub.endsWith(after)) continue
    return pick(value)?.replace("*", sub.slice(before.length, sub.length - after.length))
  }
  return undefined
}

// Words an importing specifier must contain: the file's own name, or for index
// files the folder name plus the package name, since an entry point can be imported by either.
export function searchTerms(file: string, pkgName?: string) {
  const base = path.basename(file, path.extname(file))
  if (base !== "index") return [base]
  return [...new Set([path.basename(path.dirname(file)), ...(pkgName ? [pkgName] : [])])]
}

function inside(dir: string, target: string) {
  const relative = path.relative(dir, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
