import { expect } from "bun:test"
import path from "path"
import fc from "fast-check"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { RepositoryOverviewTool } from "../../src/tool/repository-overview"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { TestInstance, withTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

fc.configureGlobal({ seed: 20261111 })

const it = testEffect(LayerNode.compile(LayerNode.group([FSUtil.node, Truncate.node, Agent.node])))

const ctx = {
  sessionID: SessionID.make("ses_property"),
  messageID: MessageID.make("msg_property"),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
} satisfies Tool.Context

// Independent oracle: these expected kinds describe the repository contract.
const recognizedFiles = [
  { path: "README.md", kind: "readme" },
  { path: "readme.txt", kind: "readme" },
  { path: "README.backup.tmp", kind: "readme" },
  { path: "package.json", kind: "manifest" },
  { path: "pyproject.toml", kind: "manifest" },
  { path: "Cargo.toml", kind: "manifest" },
  { path: "go.mod", kind: "manifest" },
  { path: "bun.lock", kind: "lockfile" },
  { path: "pnpm-lock.yaml", kind: "lockfile" },
  { path: "tsconfig.json", kind: "config" },
  { path: "vite.config.ts", kind: "config" },
  { path: "next.config.mjs", kind: "config" },
] as const

const irrelevantFiles = ["notes.txt", "NOTREADME.md", "source.ts", ".env", "Dockerfile"]

const importantFilesProperty = fc.record({
  recognized: fc.subarray([...recognizedFiles], { minLength: 1 }),
  irrelevant: fc.uniqueArray(fc.constantFrom(...irrelevantFiles), {
    maxLength: irrelevantFiles.length,
  }),
})

it.live("R1 recognizes generated important files", () =>
  Effect.gen(function* () {
    const services = yield* Effect.context<FSUtil.Service | Agent.Service | Truncate.Service>()

    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(importantFilesProperty, async ({ recognized, irrelevant }) => {
          await Effect.gen(function* () {
            const test = yield* TestInstance
            const fs = yield* FSUtil.Service

            yield* Effect.forEach(recognized, (file) =>
              fs.writeFileString(path.join(test.directory, file.path), ""),
            )
            yield* Effect.forEach(irrelevant, (file) =>
              fs.writeFileString(path.join(test.directory, file), ""),
            )
            yield* fs.ensureDir(path.join(test.directory, "frontend", "src"))
            yield* fs.ensureDir(path.join(test.directory, "backend", "src"))
            yield* fs.writeFileString(path.join(test.directory, "frontend", "src", "app.tsx"), "")
            yield* fs.writeFileString(path.join(test.directory, "backend", "src", "app.py"), "")

            const info = yield* RepositoryOverviewTool
            const tool = yield* info.init()
            const result = yield* tool.execute({}, ctx)

            const expected = [...recognized]
              .map((file) => ({ path: file.path, kind: file.kind }))
              .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

            expect(result.metadata.overview.importantFiles).toEqual(expected)
            expect(JSON.parse(result.output).importantFiles).toEqual(expected)
            expect(result.metadata.overview.languages).toContain("Python")
            expect(result.metadata.overview.languages).toContain("TypeScript")
            expect(JSON.parse(result.output).languages).toContain("Python")
            expect(JSON.parse(result.output).languages).toContain("TypeScript")
          }).pipe(withTmpdirInstance(), Effect.scoped, Effect.provide(services), Effect.runPromise)
        }),
        { numRuns: 50 },
      ),
    )
  }),
)
