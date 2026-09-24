import path from "path"
import { Effect, Schema } from "effect"
import { parse } from "jsonc-parser"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./file_relations.txt"
import * as Tool from "./tool"

export const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]

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

type Metadata = { imports: number; exports: number }

export const FileRelationsTool = Tool.define<typeof Parameters, Metadata, FSUtil.Service>(
  "file_relations",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

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

    const loadPackage = Effect.fn("FileRelationsTool.loadPackage")(function* (file: string, worktree: string) {
      const [manifest] = yield* fs.findUp("package.json", path.dirname(file), worktree)
      const root = manifest ? path.dirname(manifest) : worktree
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
      const names = new Set<string>()
      for (const pattern of patterns) {
        if (typeof pattern !== "string") continue
        const manifests = yield* fs
          .glob(path.posix.join(pattern, "package.json"), { cwd: worktree, absolute: true })
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
        for (const manifest of manifests) {
          const name = (yield* readJsonc(manifest))?.name
          if (typeof name === "string") names.add(name)
        }
      }
      return names
    })

    const classify = Effect.fn("FileRelationsTool.classify")(function* (
      specifier: string,
      file: string,
      pkg: PackageInfo,
      workspace: Set<string>,
      worktree: string,
    ) {
      if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
        const target = path.resolve(path.dirname(file), specifier)
        const resolved = yield* resolveFile(target)
        const kind: ImportKind = inside(pkg.root, target) ? "same-package" : inside(worktree, target) ? "workspace" : "external"
        return { kind, resolved }
      }

      const alias = pkg.aliases.find((item) => (item.exact ? specifier === item.prefix : specifier.startsWith(item.prefix)))
      if (alias) {
        for (const target of alias.targets) {
          const resolved = yield* resolveFile(alias.exact ? target : path.join(target, specifier.slice(alias.prefix.length)))
          if (resolved) return { kind: "same-package" as const, resolved }
        }
        return { kind: "same-package" as const, resolved: undefined }
      }

      const name = packageName(specifier)
      if (name === pkg.name) return { kind: "same-package" as const, resolved: undefined }
      if (workspace.has(name)) return { kind: "workspace" as const, resolved: undefined }
      return { kind: "external" as const, resolved: undefined }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
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

          const source = yield* fs.readFileStringSafe(file)
          const scanned = scan(source ?? "", file)
          const pkg = yield* loadPackage(file, ins.worktree)
          const workspace = yield* loadWorkspace(ins.worktree)

          const imports: ImportInfo[] = []
          for (const item of scanned.imports) {
            const { kind, resolved } = yield* classify(item.specifier, file, pkg, workspace, ins.worktree)
            imports.push({
              specifier: item.specifier,
              kind,
              ...(item.dynamic && { dynamic: true as const }),
              ...(resolved && { resolved: path.relative(ins.worktree, resolved) }),
            })
          }

          const result = {
            file: path.relative(ins.worktree, file),
            package: pkg.name ?? null,
            imports,
            exports: scanned.exports,
          }

          return {
            title: result.file,
            metadata: { imports: imports.length, exports: scanned.exports.length },
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

function inside(dir: string, target: string) {
  const relative = path.relative(dir, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
