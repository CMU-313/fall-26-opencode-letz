import path from "path"
import { Effect, Option, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
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
})

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
          const overview = {
            root: instance.directory,
            name: path.basename(instance.directory),
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
