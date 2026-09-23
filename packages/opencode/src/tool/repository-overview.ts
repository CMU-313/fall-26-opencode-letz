import path from "path"
import { Effect, Schema } from "effect"
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
          const overview = {
            root: instance.directory,
            name: path.basename(instance.directory),
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
