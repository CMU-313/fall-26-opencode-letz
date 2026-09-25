import path from "path"
import { Effect, Option, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { Tool } from "./tool"
import DESCRIPTION from "./repository-overview.txt"

const EXCLUDED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
])

const FILES = new Map<string, "manifest" | "lockfile" | "config">([
  ["package.json", "manifest"],
  ["pyproject.toml", "manifest"],
  ["Cargo.toml", "manifest"],
  ["go.mod", "manifest"],
  ["bun.lock", "lockfile"],
  ["bun.lockb", "lockfile"],
  ["package-lock.json", "lockfile"],
  ["pnpm-lock.yaml", "lockfile"],
  ["yarn.lock", "lockfile"],
  ["tsconfig.json", "config"],
  ["jsconfig.json", "config"],
  ["vite.config.ts", "config"],
  ["vite.config.js", "config"],
  ["vite.config.mts", "config"],
  ["vite.config.mjs", "config"],
  ["next.config.js", "config"],
  ["next.config.mjs", "config"],
  ["next.config.ts", "config"],
])

export const Parameters = Schema.Struct({})

const PackageMetadata = Schema.Struct({
  name: Schema.optional(Schema.Unknown),
  packageManager: Schema.optional(Schema.Unknown),
  workspaces: Schema.optional(Schema.Unknown),
  dependencies: Schema.optional(Schema.Unknown),
  devDependencies: Schema.optional(Schema.Unknown),
})

const LANGUAGES = new Map([
  ["typescript", "TypeScript"],
  ["typescriptreact", "TypeScript"],
  ["javascript", "JavaScript"],
  ["javascriptreact", "JavaScript"],
  ["python", "Python"],
  ["go", "Go"],
  ["rust", "Rust"],
  ["java", "Java"],
])

const LANGUAGE_FILES = new Map([
  ["tsconfig.json", "TypeScript"],
  ["jsconfig.json", "JavaScript"],
  ["pyproject.toml", "Python"],
  ["Cargo.toml", "Rust"],
  ["go.mod", "Go"],
  ["pom.xml", "Java"],
  ["build.gradle", "Java"],
  ["build.gradle.kts", "Java"],
])

const FRAMEWORKS = new Map([
  ["react", "React"],
  ["next", "Next.js"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["@angular/core", "Angular"],
  ["express", "Express"],
])

const WorkspaceDeclaration = Schema.Union([
  Schema.Array(Schema.String),
  Schema.Struct({ packages: Schema.Array(Schema.String) }),
])

const MANAGERS = new Map([
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
])

export const RepositoryOverviewTool = Tool.define(
  "repository_overview",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (_params, ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          yield* ctx.ask({
            permission: "repository_overview",
            patterns: [instance.directory],
            always: ["*"],
            metadata: { path: instance.directory },
          })
          const entries = yield* fs.readDirectoryEntries(instance.directory)
          const manifest = entries.some((entry) => entry.type === "file" && entry.name === "package.json")
            ? yield* Effect.gen(function* () {
                yield* ctx.ask({
                  permission: "read",
                  patterns: [path.relative(instance.worktree, path.join(instance.directory, "package.json"))],
                  always: ["*"],
                  metadata: { path: path.join(instance.directory, "package.json") },
                })
                return yield* fs.readJson(path.join(instance.directory, "package.json")).pipe(
                  Effect.map(Schema.decodeUnknownOption(PackageMetadata)),
                  Effect.map(Option.getOrNull),
                  Effect.catch(() => Effect.succeed(null)),
                )
              })
            : null
          const explicit =
            typeof manifest?.packageManager === "string"
              ? /^(bun|pnpm|yarn|npm)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(
                  manifest.packageManager,
                )
              : null
          const lockfiles = entries
            .filter((entry) => entry.type === "file" && MANAGERS.has(entry.name))
            .map((entry) => entry.name)
            .sort()
          const managers = new Set(lockfiles.map((file) => MANAGERS.get(file)!))
          const declaration = Option.getOrNull(Schema.decodeUnknownOption(WorkspaceDeclaration)(manifest?.workspaces))
          const patterns = declaration === null ? [] : "packages" in declaration ? declaration.packages : declaration
          const workspacePatterns = [
            ...new Set(
              patterns.flatMap((pattern) => {
                // Only relative, in-repository patterns are eligible. Never follow symlinks.
                if (path.posix.isAbsolute(pattern) || path.win32.isAbsolute(pattern) || /[\\!]/.test(pattern)) return []
                const segments = pattern.split("/").filter((segment) => segment !== "." && segment !== "")
                if (!segments.length || segments.some((segment) => segment === ".." || EXCLUDED.has(segment))) return []
                return [segments.join("/")]
              }),
            ),
          ].sort()
          const matches = yield* Effect.forEach(workspacePatterns, (pattern) =>
            resolveWorkspaces(fs, instance.directory, pattern.split("/")),
          )
          const workspaces = yield* Effect.forEach(
            [...new Set(matches.flat())].filter((directory) => directory !== instance.directory).sort(),
            (directory) =>
              Effect.gen(function* () {
                const files = yield* fs.readDirectoryEntries(directory).pipe(Effect.catch(() => Effect.succeed([])))
                const child = files.some((entry) => entry.type === "file" && entry.name === "package.json")
                  ? yield* Effect.gen(function* () {
                      const file = path.join(directory, "package.json")
                      yield* ctx.ask({
                        permission: "read",
                        patterns: [path.relative(instance.worktree, file)],
                        always: ["*"],
                        metadata: { path: file },
                      })
                      return yield* fs.readJson(file).pipe(
                        Effect.map(Schema.decodeUnknownOption(PackageMetadata)),
                        Effect.map(Option.getOrNull),
                        Effect.catch(() => Effect.succeed(null)),
                      )
                    })
                  : null
                return {
                  path: path.relative(instance.directory, directory).split(path.sep).join("/"),
                  name: typeof child?.name === "string" && child.name.trim() ? child.name : null,
                  technologies: detectTechnologies(files, child),
                }
              }),
          )
          const technologies = [detectTechnologies(entries, manifest), ...workspaces.map((item) => item.technologies)]
          const overview = {
            root: instance.directory,
            name: path.basename(instance.directory),
            workspacePatterns,
            workspaces: workspaces.map((item) => ({ path: item.path, name: item.name })),
            languages: [...new Set(technologies.flatMap((item) => item.languages))].sort(),
            frameworks: [...new Set(technologies.flatMap((item) => item.frameworks))].sort(),
            package: manifest
              ? { name: typeof manifest.name === "string" && manifest.name.trim() ? manifest.name : null }
              : null,
            packageManager: explicit
              ? { name: explicit[1], version: explicit[2], source: "package.json#packageManager" }
              : managers.size === 1
                ? { name: MANAGERS.get(lockfiles[0])!, version: null, source: lockfiles[0] }
                : null,
            folders: entries
              .filter((entry) => entry.type === "directory" && !EXCLUDED.has(entry.name))
              .map((entry) => entry.name)
              .sort(),
            importantFiles: entries
              .filter((entry) => entry.type === "file")
              .flatMap((entry) => {
                const kind = /^README/i.test(entry.name) ? ("readme" as const) : FILES.get(entry.name)
                return kind ? [{ path: entry.name, kind }] : []
              })
              .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
            truncated: false,
          }
          return {
            title: "Repository overview",
            metadata: { overview, truncated: false },
            output: JSON.stringify(overview, null, 2),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function detectTechnologies(entries: FSUtil.DirEntry[], manifest: typeof PackageMetadata.Type | null) {
  return {
    languages: entries.flatMap((entry) => {
      if (entry.type !== "file") return []
      const language = LANGUAGE_FILES.get(entry.name) ?? LANGUAGES.get(LANGUAGE_EXTENSIONS[path.extname(entry.name)])
      return language ? [language] : []
    }),
    frameworks: [manifest?.dependencies, manifest?.devDependencies].flatMap((dependencies) => {
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return []
      return Object.entries(dependencies).flatMap(([name, version]) => {
        const framework = FRAMEWORKS.get(name)
        return framework && typeof version === "string" && version.trim() ? [framework] : []
      })
    }),
  }
}

function resolveWorkspaces(fs: FSUtil.Interface, directory: string, segments: string[]): Effect.Effect<string[]> {
  if (!segments.length) return Effect.succeed([directory])
  return Effect.gen(function* () {
    const entries = yield* fs.readDirectoryEntries(directory).pipe(Effect.catch(() => Effect.succeed([])))
    const recursive = segments[0] === "**"
    const current = recursive ? yield* resolveWorkspaces(fs, directory, segments.slice(1)) : []
    const children = yield* Effect.forEach(
      entries.filter(
        (entry) =>
          entry.type === "directory" &&
          !EXCLUDED.has(entry.name) &&
          (recursive || fs.globMatch(segments[0], entry.name)),
      ),
      (entry) => resolveWorkspaces(fs, path.join(directory, entry.name), recursive ? segments : segments.slice(1)),
    )
    return [...current, ...children.flat()]
  })
}
