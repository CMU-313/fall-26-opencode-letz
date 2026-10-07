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

const recording = () => {
  const requests: Parameters<Tool.Context["ask"]>[0][] = []
  const context: Tool.Context = {
    ...ctx,
    ask: (request) =>
      Effect.sync(() => {
        requests.push(request)
      }),
  }
  return { context, patterns: () => requests.map((request) => request.patterns) }
}

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

  it.instance("rejects malformed input before asking for permission or reading files", () =>
    Effect.gen(function* () {
      const info = yield* DirectorySummaryTool
      const tool = yield* info.init()
      const execute = tool.execute as unknown as (args: unknown, ctx: Tool.Context) => ReturnType<typeof tool.execute>
      const record = recording()
      for (const input of [{}, { path: "" }, { path: 42 }, null]) {
        const exit = yield* execute(input, record.context).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (!Exit.isFailure(exit)) continue
        const error = exit.cause.reasons.find(Cause.isDieReason)?.defect
        expect(error).toBeInstanceOf(Tool.InvalidArgumentsError)
        expect(String(error)).toContain("directory_summary tool was called with invalid arguments")
      }
      expect(record.patterns()).toEqual([])
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
      const record = recording()
      const summary: Summary = JSON.parse((yield* run("src/feature", record.context)).output)
      expect(record.patterns()).toContainEqual(["tsconfig.json"])
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

  it.instance("resolves package.json subpath imports such as #name", () =>
    Effect.gen(function* () {
      yield* write({
        "package.json": JSON.stringify({
          name: "app",
          imports: {
            "#db": { bun: "./src/db/db.bun.ts", node: "./src/db/db.node.ts" },
            "#util/*": "./src/util/*.ts",
          },
        }),
        "src/db/db.bun.ts": "export const db = 1",
        "src/util/format.ts": "export const format = 1",
        "src/feature/index.ts": [
          'import { db } from "#db"',
          'import { format } from "#util/format"',
          'import { gone } from "#missing"',
        ].join("\n"),
        // #db resolves into src/db, so summarizing that directory treats the import as internal.
        "src/db/index.ts": 'export * from "#db"',
      })
      const record = recording()
      const summary: Summary = JSON.parse((yield* run("src/feature", record.context)).output)
      expect(summary.dependencies).toEqual([
        { file: "index.ts", specifier: "#db", kind: "subpath", target: "src/db/db.bun.ts", directory: "src/db" },
        {
          file: "index.ts",
          specifier: "#util/format",
          kind: "subpath",
          target: "src/util/format.ts",
          directory: "src/util",
        },
      ])
      expect(summary.unresolvedImports).toEqual([{ file: "index.ts", specifier: "#missing" }])
      expect(summary.externalPackages).toEqual([])
      expect(record.patterns()).toContainEqual(["package.json"])
      const db = yield* summarize("src/db")
      expect(db.dependencies).toEqual([])
      expect(db.externalPackages).toEqual([])
    }),
  )

  it.instance("finds workspace packages from package.json workspaces when they are not linked", () =>
    Effect.gen(function* () {
      yield* write({
        "package.json": JSON.stringify({ name: "root", workspaces: { packages: ["packages/*", "!packages/ignored"] } }),
        "packages/lib/package.json": JSON.stringify({
          name: "@acme/lib",
          exports: { ".": { types: "./src/index.d.ts", import: "./src/index.ts" } },
        }),
        "packages/lib/src/index.ts": "export const lib = 1",
        "packages/app/a.ts": ['import { lib } from "@acme/lib"', 'import pad from "left-pad"'].join("\n"),
        "packages/app/b.ts": ['import { lib } from "@acme/lib"', 'import pad from "left-pad"'].join("\n"),
      })
      const summary = yield* summarize("packages/app")
      expect(summary.dependencies).toEqual([
        {
          file: "a.ts",
          specifier: "@acme/lib",
          kind: "workspace",
          target: "packages/lib/src/index.ts",
          directory: "packages/lib/src",
        },
        {
          file: "b.ts",
          specifier: "@acme/lib",
          kind: "workspace",
          target: "packages/lib/src/index.ts",
          directory: "packages/lib/src",
        },
      ])
      expect(summary.relatedDirectories).toEqual([
        { directory: "packages/lib/src", imports: 2, files: ["a.ts", "b.ts"] },
      ])
      expect(summary.externalPackages).toEqual([{ name: "left-pad", kind: "package", files: ["a.ts", "b.ts"] }])
    }),
  )

  it.instance("ignores block comments, template literals, type-only imports, and injected JSX runtime imports", () =>
    Effect.gen(function* () {
      yield* write({
        "shared/value.ts": "export const value = 1",
        "shared/types.ts": "export type Value = number",
        "module/view.tsx": [
          'import { value } from "../shared/value"',
          'import type { Value } from "../shared/types"',
          '/* import fake from "../fake/block" */',
          "const text = `import fake from '../fake/template'`",
          "export const View = () => <div title=\"import x from '../fake/jsx'\">{value}</div>",
        ].join("\n"),
      })
      const summary = yield* summarize("module")
      expect(summary.dependencies).toEqual([
        {
          file: "view.tsx",
          specifier: "../shared/value",
          kind: "relative",
          target: "shared/value.ts",
          directory: "shared",
        },
      ])
      // Bun's scanner reports "react/jsx-dev-runtime" for any JSX even though the file never imports React.
      expect(summary.externalPackages).toEqual([])
      expect(summary.unresolvedImports).toEqual([])
      expect(summary.skipped).toEqual([])
    }),
  )

  it.instance("reports sources whose imports cannot be parsed and still scans the rest", () =>
    Effect.gen(function* () {
      yield* write({
        "shared/value.ts": "",
        "module/broken.ts": 'import { from "../shared/value"',
        "module/ok.ts": 'import "../shared/value"',
      })
      const summary = yield* summarize("module")
      expect(summary.skipped).toEqual([{ file: "broken.ts", reason: "Imports could not be parsed" }])
      expect(summary.dependencies.map((item) => item.file)).toEqual(["ok.ts"])
    }),
  )

  it.instance("lists symbolic links as skipped instead of following them", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const directory = yield* write({ "shared/value.ts": 'import pad from "left-pad"', "module/index.ts": "" })
      const fs = yield* FSUtil.Service
      yield* fs.symlink(path.join(directory, "shared", "value.ts"), path.join(directory, "module", "link.ts"))
      const summary = yield* summarize("module")
      expect(summary.files).toEqual([{ name: "index.ts", role: "entry point" }])
      expect(summary.skipped).toEqual([{ file: "link.ts", reason: "Symbolic links are not scanned" }])
      expect(summary.externalPackages).toEqual([])
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
        // Sorts after the numbered files, so it falls outside the 200 listed entries.
        "many/package.json": "{}",
      })
      const result = yield* run("module")
      const large: Summary = JSON.parse(result.output)
      expect(result.metadata.incomplete).toBe(true)
      expect(large.truncated).toBe(true)
      expect(large.skipped).toEqual([{ file: "large.ts", reason: "Source exceeds 256 KiB scan limit" }])
      const many = yield* summarize("many")
      expect(many.files).toHaveLength(200)
      expect(many.files.map((file) => file.name)).not.toContain("package.json")
      expect(many.purpose).toContain("package or project root")
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
