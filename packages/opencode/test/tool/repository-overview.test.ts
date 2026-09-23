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
        package: null,
        packageManager: null,
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
        package: null,
        packageManager: null,
        folders: [],
        importantFiles: [],
        truncated: false,
      })
      expect(result.metadata.overview).toEqual(JSON.parse(result.output))
    }),
  )

  const cases = [
    {
      title: "reads package name and prefers explicit manager over conflicting lockfiles",
      manifest: JSON.stringify({
        name: "example",
        packageManager: "bun@1.4.2",
        scripts: { test: "private-script" },
        dependencies: { privateDependency: "1.0.0" },
      }),
      locks: ["pnpm-lock.yaml", "yarn.lock"],
      package: { name: "example" },
      manager: { name: "bun", version: "1.4.2", source: "package.json#packageManager" },
    },
    {
      title: "infers a manager when the packageManager field is absent",
      manifest: JSON.stringify({ name: "example" }),
      locks: ["pnpm-lock.yaml"],
      package: { name: "example" },
      manager: { name: "pnpm", version: null, source: "pnpm-lock.yaml" },
    },
    {
      title: "infers a manager without package.json",
      manifest: undefined,
      locks: ["yarn.lock"],
      package: null,
      manager: { name: "yarn", version: null, source: "yarn.lock" },
    },
    {
      title: "infers a manager despite malformed package.json",
      manifest: "{broken",
      locks: ["package-lock.json"],
      package: null,
      manager: { name: "npm", version: null, source: "package-lock.json" },
    },
    {
      title: "does not guess between conflicting lockfiles",
      manifest: "{}",
      locks: ["bun.lock", "pnpm-lock.yaml"],
      package: { name: null },
      manager: null,
    },
    {
      title: "treats both Bun lockfile formats as the same manager",
      manifest: "{}",
      locks: ["bun.lockb", "bun.lock"],
      package: { name: null },
      manager: { name: "bun", version: null, source: "bun.lock" },
    },
    {
      title: "ignores invalid metadata field types",
      manifest: JSON.stringify({ name: 42, packageManager: false }),
      locks: [],
      package: { name: null },
      manager: null,
    },
  ]

  cases.forEach((input) => {
    it.instance(input.title, () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const fs = yield* FSUtil.Service
        if (input.manifest !== undefined) {
          yield* fs.writeFileString(path.join(test.directory, "package.json"), input.manifest)
        }
        yield* Effect.forEach(input.locks, (file) => fs.writeFileString(path.join(test.directory, file), ""))
        const info = yield* RepositoryOverviewTool
        const tool = yield* info.init()
        const result = yield* tool.execute({}, ctx)
        expect(JSON.parse(result.output)).toEqual({
          ...result.metadata.overview,
          package: input.package,
          packageManager: input.manager,
        })
        expect(result.output).not.toContain("private-script")
        expect(result.output).not.toContain("privateDependency")
      }),
    )
  })
})
