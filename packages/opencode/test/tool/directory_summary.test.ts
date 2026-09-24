import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "@/agent/agent"
import { MessageID, SessionID } from "@/session/schema"
import { DirectorySummaryTool } from "@/tool/directory_summary"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([FSUtil.node, Agent.node, Truncate.node])))
const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const run = Effect.fn("DirectorySummaryTest.run")(function* (directory: string, context: Tool.Context = ctx) {
  const info = yield* DirectorySummaryTool
  const tool = yield* info.init()
  return yield* tool.execute({ path: directory }, context)
})

const failure = Effect.fn("DirectorySummaryTest.failure")(function* (directory: string) {
  const exit = yield* run(directory).pipe(Effect.exit)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) return String(Cause.squash(exit.cause))
  throw new Error("Expected failure")
})

describe("tool.directory_summary", () => {
  it.instance("summarizes a valid directory deterministically and checks read permissions", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.writeWithDirs(path.join(test.directory, "module", "README.md"), "# Module")
      yield* fs.writeWithDirs(path.join(test.directory, "module", "index.ts"), "export const value = 1")
      yield* fs.writeWithDirs(path.join(test.directory, "module", "nested", "child.ts"), "")
      const requests: Parameters<Tool.Context["ask"]>[0][] = []
      const next = {
        ...ctx,
        ask: (request: Parameters<Tool.Context["ask"]>[0]) =>
          Effect.sync(() => {
            requests.push(request)
          }),
      }
      const result = yield* run("module", next)
      const summary = result.metadata.summary
      expect(JSON.parse(result.output)).toEqual(summary)
      expect(summary.path).toBe(path.join(test.directory, "module"))
      expect(summary.importantFiles).toEqual(["README.md", "index.ts"])
      expect(summary.subdirectories).toEqual(["nested"])
      expect(summary.purpose).toContain("source module")
      expect(summary.truncated).toBe(false)
      expect(requests.map((request) => request.permission)).toEqual(["read", "read"])
      expect(requests[1].patterns[0]).toMatch(/module\/index\.ts$/)
      expect((yield* run("module")).output).toBe(result.output)
    }),
  )

  it.instance("summarizes an empty directory", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.makeDirectory(path.join(test.directory, "empty"))
      const result = yield* run("empty")
      expect(result.metadata.summary).toMatchObject({
        files: [],
        importantFiles: [],
        subdirectories: [],
        dependencies: [],
        unresolvedImports: [],
        truncated: false,
      })
      expect(result.metadata.summary.purpose).toContain("Empty directory")
    }),
  )

  it.instance("errors clearly for a nonexistent path", () =>
    Effect.gen(function* () {
      expect(yield* failure("missing")).toContain("Directory not found:")
    }),
  )

  it.instance("detects cross-directory dependencies without treating comments or strings as imports", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.writeWithDirs(path.join(test.directory, "shared", "value.ts"), "export const value = 1")
      yield* fs.writeWithDirs(path.join(test.directory, "module", "local.ts"), "export const local = 1")
      yield* fs.writeWithDirs(
        path.join(test.directory, "module", "index.ts"),
        [
          'import { value } from "../shared/value"',
          'export { value } from "../shared/value.js"',
          'const loaded = require("../shared/value.ts")',
          'const dynamic = import("../shared/value")',
          'import type { Value } from "../shared/value"',
          'import { local } from "./local"',
          'import external from "external-package"',
          '// import nope from "../fake/comment"',
          'const example = "import nope from \'../fake/string\'"',
        ].join("\n"),
      )
      const summary = (yield* run("module")).metadata.summary
      expect(summary.dependencies.map((dependency) => dependency.specifier)).toEqual([
        "../shared/value",
        "../shared/value.js",
        "../shared/value.ts",
      ])
      expect(summary.dependencies.every((dependency) => dependency.target.endsWith("shared/value.ts"))).toBe(true)
      expect(summary.dependencies.every((dependency) => dependency.directory.endsWith("shared"))).toBe(true)
      expect(summary.unresolvedImports).toEqual([{ file: "index.ts", specifier: "external-package" }])
    }),
  )

  it.instance("errors clearly for a file path", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.writeWithDirs(path.join(test.directory, "file.txt"), "text")
      expect(yield* failure("file.txt")).toContain("Path is not a directory:")
    }),
  )

  it.instance("rejects paths outside the workspace including symlink targets", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const outside = yield* tmpdirScoped()
      expect(yield* failure(outside)).toContain("within the current workspace")
      if (process.platform === "win32") return
      const fs = yield* FSUtil.Service
      yield* fs.symlink(outside, path.join(test.directory, "outside"))
      expect(yield* failure("outside")).toContain("within the current workspace")
    }),
  )

  it.instance("stops when source read permission is denied after directory access is allowed", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.writeWithDirs(path.join(test.directory, "module", "index.ts"), "export const secret = 1")
      const exit = yield* run("module", {
        ...ctx,
        ask: (request) =>
          request.patterns.some((pattern) => pattern.endsWith("index.ts"))
            ? Effect.die(new Error("Read denied"))
            : Effect.void,
      }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(String(Cause.squash(exit.cause))).toContain("Read denied")
    }),
  )

  it.instance("keeps JSON valid and reports incomplete coverage for oversized sources", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.writeWithDirs(path.join(test.directory, "module", "large.ts"), " ".repeat(256 * 1024 + 1))
      const result = yield* run("module")
      expect(JSON.parse(result.output)).toEqual(result.metadata.summary)
      expect(result.metadata.truncated).toBe(true)
      expect(result.metadata.summary.skipped).toEqual([
        { file: "large.ts", reason: "Source exceeds 256 KiB scan limit" },
      ])
    }),
  )
})
