import { describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { RepositoryOverviewTool } from "../../src/tool/repository-overview"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([FSUtil.node, Truncate.node, Agent.node])))

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
} satisfies Tool.Context

describe("tool.repository_overview", () => {
  it.instance("reports folders and important files in a normal repository", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* Effect.forEach(["src", "packages", "node_modules"], (name) =>
        fs.ensureDir(path.join(test.directory, name)),
      )
      yield* Effect.forEach(["README.md", "package.json", "tsconfig.json", "notes.txt"], (name) =>
        fs.writeFileString(path.join(test.directory, name), ""),
      )
      const info = yield* RepositoryOverviewTool
      const tool = yield* info.init()
      const result = yield* tool.execute({}, ctx)
      expect(JSON.parse(result.output)).toEqual({
        root: test.directory,
        name: path.basename(test.directory),
        folders: ["packages", "src"],
        importantFiles: [
          { path: "README.md", kind: "readme" },
          { path: "package.json", kind: "manifest" },
          { path: "tsconfig.json", kind: "config" },
        ],
        truncated: false,
      })
      expect(result.metadata.overview).toEqual(JSON.parse(result.output))
      expect(result.metadata.truncated).toBe(false)
      expect(result.title).toBe("Repository overview")
    }),
  )

  it.instance("returns structured empty lists for a minimal repository", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.writeFileString(path.join(test.directory, "notes.txt"), "notes")
      const info = yield* RepositoryOverviewTool
      const tool = yield* info.init()
      const result = yield* tool.execute({}, ctx)
      expect(JSON.parse(result.output)).toEqual({
        root: test.directory,
        name: path.basename(test.directory),
        folders: [],
        importantFiles: [],
        truncated: false,
      })
      expect(result.metadata.overview).toEqual(JSON.parse(result.output))
    }),
  )
})
