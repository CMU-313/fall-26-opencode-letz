import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "@/agent/agent"
import { MessageID, SessionID } from "@/session/schema"
import { DirectorySummaryTool } from "@/tool/directory_summary"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([FSUtil.node, Agent.node, Truncate.node, CrossSpawnSpawner.node])),
)
const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}
// chmod-based tests cannot deny access on Windows or when the suite runs as root.
const permissionsEnforced = process.platform !== "win32" && process.getuid?.() !== 0

type Summary = {
  path: string
  relativePath: string
  purpose: string
  files: { name: string; role: string }[]
  importantFiles: string[]
  subdirectories: string[]
  relatedDirectories: { directory: string; imports: number; files: string[] }[]
  dependencies: { file: string; specifier: string; kind: string; target: string; directory: string }[]
  externalPackages: { name: string; kind: string; files: string[] }[]
  unresolvedImports: { file: string; specifier: string }[]
  skipped: { file: string; reason: string }[]
  truncated: boolean
}

const run = Effect.fn("DirectorySummaryTest.run")(function* (directory: string, context: Tool.Context = ctx) {
  const info = yield* DirectorySummaryTool
  const tool = yield* info.init()
  return yield* tool.execute({ path: directory }, context)
})

const summarize = Effect.fn("DirectorySummaryTest.summarize")(function* (directory: string) {
  const summary: Summary = JSON.parse((yield* run(directory)).output)
  return summary
})

const failure = Effect.fn("DirectorySummaryTest.failure")(function* (directory: string) {
  const exit = yield* run(directory).pipe(Effect.exit)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) return String(Cause.squash(exit.cause))
  throw new Error("Expected failure")
})

const write = Effect.fn("DirectorySummaryTest.write")(function* (files: Record<string, string>) {
  const test = yield* TestInstance
  const fs = yield* FSUtil.Service
  for (const [file, content] of Object.entries(files)) yield* fs.writeWithDirs(path.join(test.directory, file), content)
  return test.directory
})

describe("tool.directory_summary", () => {
  it.instance("summarizes a valid directory with roles, subdirectories, and read permission checks", () =>
    Effect.gen(function* () {
      const directory = yield* write({
        "module/README.md": "# Module",
        "module/index.ts": "export const value = 1",
        "module/module.ts": "export const main = 1",
        "module/util.ts": "export const util = 1",
        "module/vite.config.ts": "export default {}",
        "module/nested/child.ts": 'import { x } from "../../elsewhere"',
      })
      const requests: Parameters<Tool.Context["ask"]>[0][] = []
      const result = yield* run("module", {
        ...ctx,
        ask: (request) =>
          Effect.sync(() => {
            requests.push(request)
          }),
      })
      const summary: Summary = JSON.parse(result.output)
      expect(summary.path).toBe(path.join(directory, "module"))
      expect(summary.relativePath).toBe("module")
      expect(summary.files).toEqual([
        { name: "index.ts", role: "entry point" },
        { name: "module.ts", role: "entry point" },
        { name: "README.md", role: "documentation" },
        { name: "util.ts", role: "source" },
        { name: "vite.config.ts", role: "configuration" },
      ])
      expect(summary.importantFiles).toEqual(["index.ts", "module.ts", "README.md", "vite.config.ts"])
      expect(summary.subdirectories).toEqual(["nested"])
      expect(summary.purpose).toContain("source module")
      // nested/child.ts has an unresolvable import; empty results prove subdirectories are not scanned.
      expect(summary.dependencies).toEqual([])
      expect(summary.unresolvedImports).toEqual([])
      expect(summary.truncated).toBe(false)
      expect(result.metadata).toMatchObject({ files: 5, subdirectories: 1, dependencies: 0, incomplete: false })
      expect(requests.map((request) => [request.permission, request.patterns])).toEqual([
        ["read", ["module"]],
        ["read", ["module/index.ts"]],
        ["read", ["module/module.ts"]],
        ["read", ["module/util.ts"]],
        ["read", ["module/vite.config.ts"]],
      ])
      expect((yield* run("module")).output).toBe(result.output)
    }),
  )

  it.instance("accepts absolute paths and the workspace root", () =>
    Effect.gen(function* () {
      const directory = yield* write({ "module/index.ts": "" })
      expect((yield* summarize(path.join(directory, "module"))).relativePath).toBe("module")
      const root = yield* summarize(".")
      expect(root.relativePath).toBe(".")
      expect(root.subdirectories).toEqual(["module"])
    }),
  )

  it.instance("summarizes an empty directory", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.makeDirectory(path.join(test.directory, "empty"))
      expect(yield* summarize("empty")).toMatchObject({
        purpose: "Empty directory; no purpose can be inferred.",
        files: [],
        importantFiles: [],
        subdirectories: [],
        relatedDirectories: [],
        dependencies: [],
        externalPackages: [],
        unresolvedImports: [],
        truncated: false,
      })
    }),
  )

  it.instance("errors clearly for a nonexistent path", () =>
    Effect.gen(function* () {
      expect(yield* failure("missing")).toContain("Directory not found:")
    }),
  )

  it.instance("errors clearly for a file path", () =>
    Effect.gen(function* () {
      yield* write({ "file.txt": "text" })
      expect(yield* failure("file.txt")).toContain("Path is not a directory:")
    }),
  )

  it.instance("errors clearly for an inaccessible directory", () =>
    Effect.gen(function* () {
      if (!permissionsEnforced) return
      const directory = yield* write({ "locked/index.ts": "" })
      const fs = yield* FSUtil.Service
      const locked = path.join(directory, "locked")
      yield* fs.chmod(locked, 0o000)
      const message = yield* failure("locked").pipe(Effect.ensuring(fs.chmod(locked, 0o755).pipe(Effect.orDie)))
      expect(message).toContain("Directory is not accessible:")
    }),
  )

  it.instance("skips unreadable source files and still scans the rest", () =>
    Effect.gen(function* () {
      if (!permissionsEnforced) return
      const directory = yield* write({
        "shared/value.ts": "",
        "module/a.ts": 'import "../shared/value"',
        "module/b.ts": 'import "../shared/value"',
      })
      const fs = yield* FSUtil.Service
      yield* fs.chmod(path.join(directory, "module", "a.ts"), 0o000)
      const summary = yield* summarize("module")
      expect(summary.skipped).toEqual([{ file: "a.ts", reason: "Source file is not readable" }])
      expect(summary.dependencies.map((item) => item.file)).toEqual(["b.ts"])
    }),
  )

  it.instance("rejects paths outside the workspace including symlink targets", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const outside = yield* tmpdirScoped()
      expect(yield* failure(outside)).toContain("within the current workspace")
      expect(yield* failure("..")).toContain("within the current workspace")
      if (process.platform === "win32") return
      const fs = yield* FSUtil.Service
      yield* fs.symlink(outside, path.join(test.directory, "outside"))
      expect(yield* failure("outside")).toContain("within the current workspace")
    }),
  )

  it.instance("stops when source read permission is denied after directory access is allowed", () =>
    Effect.gen(function* () {
      yield* write({ "module/index.ts": "export const secret = 1" })
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

  it.instance("detects relative dependencies, removes duplicates, and ignores internal imports", () =>
    Effect.gen(function* () {
      yield* write({
        "shared/value.ts": "export const value = 1",
        "shared/other.ts": "export const other = 1",
        "shared/index.ts": 'export * from "./value"',
        "late/value.ts": "export const late = 1",
        "module/local.ts": "export const local = 1",
        "module/nested/child.ts": "export const child = 1",
        "module/helper.ts": 'import { value } from "../shared/value"',
        "module/index.ts": [
          'import { value } from "../shared/value"',
          'export { value as again } from "../shared/value.js"',
          'const loaded = require("../shared/value.ts")',
          'const dynamic = import("../shared")',
          'export * from "../shared/other"',
          'import { local } from "./local"',
          'import { child } from "./nested/child"',
          'import { gone } from "../missing"',
          // A quote inside a regex literal must not hide the import that follows it.
          'const re = /"/',
          'import { late } from "../late/value"',
          '// import nope from "../fake/comment"',
          "const example = \"import nope from '../fake/string'\"",
        ].join("\n"),
      })
      const summary = yield* summarize("module")
      expect(summary.dependencies).toEqual([
        {
          file: "helper.ts",
          specifier: "../shared/value",
          kind: "relative",
          target: "shared/value.ts",
          directory: "shared",
        },
        { file: "index.ts", specifier: "../late/value", kind: "relative", target: "late/value.ts", directory: "late" },
        { file: "index.ts", specifier: "../shared", kind: "relative", target: "shared/index.ts", directory: "shared" },
        {
          file: "index.ts",
          specifier: "../shared/other",
          kind: "relative",
          target: "shared/other.ts",
          directory: "shared",
        },
        {
          file: "index.ts",
          specifier: "../shared/value",
          kind: "relative",
          target: "shared/value.ts",
          directory: "shared",
        },
      ])
      expect(summary.relatedDirectories).toEqual([
        { directory: "shared", imports: 4, files: ["helper.ts", "index.ts"] },
        { directory: "late", imports: 1, files: ["index.ts"] },
      ])
      expect(summary.unresolvedImports).toEqual([{ file: "index.ts", specifier: "../missing" }])
    }),
  )

  it.instance("resolves tsconfig path aliases such as @/", () =>
    Effect.gen(function* () {
      yield* write({
        "tsconfig.json": [
          "{",
          "  // comments and trailing commas are allowed",
          '  "compilerOptions": { "paths": { "@/*": ["./src/*"], } },',
          "}",
        ].join("\n"),
        "src/shared/value.ts": "export const value = 1",
        "src/feature/index.ts": [
          'import { value } from "@/shared/value"',
          'import { gone } from "@/missing/thing"',
        ].join("\n"),
      })
      const summary = yield* summarize("src/feature")
      expect(summary.dependencies).toEqual([
        {
          file: "index.ts",
          specifier: "@/shared/value",
          kind: "alias",
          target: "src/shared/value.ts",
          directory: "src/shared",
        },
      ])
      expect(summary.unresolvedImports).toEqual([{ file: "index.ts", specifier: "@/missing/thing" }])
      expect(summary.externalPackages).toEqual([])
    }),
  )

  it.instance("links workspace packages and classifies external and builtin imports", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const directory = yield* write({
        "packages/lib/package.json": JSON.stringify({ name: "@acme/lib", exports: { "./*": "./src/*.ts" } }),
        "packages/lib/src/util.ts": "export const util = 1",
        "node_modules/left-pad/package.json": JSON.stringify({ name: "left-pad" }),
        "packages/app/index.ts": [
          'import { util } from "@acme/lib/util"',
          'import pad from "left-pad"',
          'import { Effect } from "effect"',
          'import fs from "node:fs"',
          'import path from "path"',
        ].join("\n"),
      })
      const fs = yield* FSUtil.Service
      yield* fs.makeDirectory(path.join(directory, "node_modules", "@acme"), { recursive: true })
      yield* fs.symlink(path.join(directory, "packages", "lib"), path.join(directory, "node_modules", "@acme", "lib"))
      const summary = yield* summarize("packages/app")
      expect(summary.dependencies).toEqual([
        {
          file: "index.ts",
          specifier: "@acme/lib/util",
          kind: "workspace",
          target: "packages/lib/src/util.ts",
          directory: "packages/lib/src",
        },
      ])
      expect(summary.externalPackages).toEqual([
        { name: "effect", kind: "package", files: ["index.ts"] },
        { name: "left-pad", kind: "package", files: ["index.ts"] },
        { name: "node:fs", kind: "builtin", files: ["index.ts"] },
        { name: "path", kind: "builtin", files: ["index.ts"] },
      ])
    }),
  )

  it.instance("infers purpose from the balance of files and from subdirectories", () =>
    Effect.gen(function* () {
      yield* write({
        "mixed/a.ts": "",
        "mixed/b.ts": "",
        "mixed/c.ts": "",
        "mixed/a.test.ts": "",
        "checks/a.ts": "",
        "checks/a.test.ts": "",
        "checks/b.test.ts": "",
        "container/alpha/index.ts": "",
        "container/beta/index.ts": "",
      })
      expect((yield* summarize("mixed")).purpose).toContain("source module")
      expect((yield* summarize("checks")).purpose).toContain("automated tests")
      expect((yield* summarize("container")).purpose).toBe("Likely groups related modules or packages: alpha, beta.")
    }),
  )

  it.instance("reports incomplete coverage for oversized sources and large directories", () =>
    Effect.gen(function* () {
      yield* write({
        "module/large.ts": " ".repeat(256 * 1024 + 1),
        ...Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`many/${String(i).padStart(3, "0")}.md`, ""])),
      })
      const result = yield* run("module")
      const large: Summary = JSON.parse(result.output)
      expect(result.metadata.incomplete).toBe(true)
      expect(large.truncated).toBe(true)
      expect(large.skipped).toEqual([{ file: "large.ts", reason: "Source exceeds 256 KiB scan limit" }])
      const many = yield* summarize("many")
      expect(many.files).toHaveLength(200)
      expect(many.truncated).toBe(true)
    }),
  )

  it.instance("caps listed dependencies but still counts all of them per directory", () =>
    Effect.gen(function* () {
      const names = Array.from({ length: 205 }, (_, i) => `v${String(i).padStart(3, "0")}`)
      yield* write({
        ...Object.fromEntries(names.map((name) => [`shared/${name}.ts`, ""])),
        "module/index.ts": names.map((name) => `import "../shared/${name}"`).join("\n"),
      })
      const summary = yield* summarize("module")
      expect(summary.dependencies).toHaveLength(200)
      expect(summary.relatedDirectories).toEqual([{ directory: "shared", imports: 205, files: ["index.ts"] }])
      expect(summary.truncated).toBe(true)
    }),
  )
})
