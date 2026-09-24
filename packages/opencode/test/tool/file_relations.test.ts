import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { describe, expect } from "bun:test"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { FileRelationsTool, DEPENDENT_LIMIT, exportTarget, packageName } from "../../src/tool/file_relations"
import { SessionID, MessageID } from "../../src/session/schema"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Git } from "@/git"
import type * as Tool from "../../src/tool/tool"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([CrossSpawnSpawner.node, FSUtil.node, Ripgrep.node, Truncate.node, Agent.node, Git.node]),
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const asks = () => {
  const items: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
  return {
    items,
    next: {
      ...ctx,
      ask: (req: Omit<PermissionV1.Request, "id" | "sessionID" | "tool">) =>
        Effect.sync(() => {
          items.push(req)
        }),
    } satisfies Tool.Context,
  }
}

type Output = {
  file: string
  package: string | null
  imports: Array<{ specifier: string; kind: string; dynamic?: boolean; resolved?: string }>
  exports: string[]
  dependents: { total: number; files: string[]; truncated?: string }
}

// A two-package monorepo: "app" imports from itself (relative and "@/" alias),
// from the "shared" workspace package through its exports map, and from npm/runtime.
const MAIN = `
import { helper } from "./helper"
import { util } from "@/lib/util"
import { shared } from "@fx/shared/thing"
import { Effect } from "effect"
import fs from "fs"
import type { T } from "./types"
// import { fake } from "./in-comment"
const text = "import { fake } from './in-string'"
const lazy = () => import("./lazy")
export const c = 1
export function f() {}
export class K {}
export * as NS from "./helper"
export default f
export type TT = string
export interface II {}
`

const workspace = (dir: string) =>
  Effect.promise(async () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "fixture-root", workspaces: ["packages/*"] }),
      "packages/app/package.json": JSON.stringify({ name: "@fx/app" }),
      "packages/app/tsconfig.json": `{
        // comments are allowed in tsconfig
        "compilerOptions": { "paths": { "@/*": ["./src/*"] } },
      }`,
      "packages/app/src/main.ts": MAIN,
      "packages/app/src/helper.ts": "export const helper = 1\n",
      "packages/app/src/lib/util.ts": "export const util = 1\n",
      "packages/app/src/lazy.ts": "export const lazy = 1\n",
      "packages/app/src/types.ts": "export type T = 1\n",
      "packages/app/README.md": "not code\n",
      "packages/shared/package.json": JSON.stringify({ name: "@fx/shared", exports: { "./*": "./src/*.ts" } }),
      "packages/shared/src/thing.ts": "export const shared = 1\n",
    }
    for (const [file, content] of Object.entries(files)) await Bun.write(path.join(dir, file), content)
  })

const run = (filePath: string, context: Tool.Context = ctx) =>
  Effect.gen(function* () {
    const info = yield* FileRelationsTool
    const tool = yield* info.init()
    return yield* tool.execute({ filePath }, context)
  })

const failure = (filePath: string) =>
  Effect.gen(function* () {
    const exit = yield* run(filePath).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (!Exit.isFailure(exit)) return ""
    const err = Cause.squash(exit.cause)
    return err instanceof Error ? err.message : String(err)
  })

describe("tool.file_relations", () => {
  it.instance(
    "classifies each import as same-package, workspace, or external",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* workspace(test.directory)
        const result = yield* run(path.join(test.directory, "packages/app/src/main.ts"))
        const output = JSON.parse(result.output) as Output

        expect(output.package).toBe("@fx/app")
        expect(output.imports).toEqual([
          { specifier: "./helper", kind: "same-package", resolved: "packages/app/src/helper.ts" },
          { specifier: "./lazy", kind: "same-package", dynamic: true, resolved: "packages/app/src/lazy.ts" },
          { specifier: "@/lib/util", kind: "same-package", resolved: "packages/app/src/lib/util.ts" },
          { specifier: "@fx/shared/thing", kind: "workspace", resolved: "packages/shared/src/thing.ts" },
          { specifier: "effect", kind: "external" },
          { specifier: "fs", kind: "external" },
        ])
      }),
    { git: true },
  )

  it.instance(
    "ignores type-only imports and imports inside comments or strings",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* workspace(test.directory)
        const result = yield* run(path.join(test.directory, "packages/app/src/main.ts"))
        const specifiers = (JSON.parse(result.output) as Output).imports.map((item) => item.specifier)

        expect(specifiers).not.toContain("./types")
        expect(specifiers).not.toContain("./in-comment")
        expect(specifiers).not.toContain("./in-string")
      }),
    { git: true },
  )

  it.instance(
    "lists top-level runtime exports and omits type-only exports",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* workspace(test.directory)
        const result = yield* run(path.join(test.directory, "packages/app/src/main.ts"))

        expect((JSON.parse(result.output) as Output).exports).toEqual(["K", "NS", "c", "default", "f"])
        expect(result.metadata.exports).toBe(5)
      }),
    { git: true },
  )

  it.instance(
    "lists dependents through relative, alias, and workspace imports",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* workspace(test.directory)
        const dependents = (file: string) =>
          run(path.join(test.directory, file)).pipe(
            Effect.map((result) => (JSON.parse(result.output) as Output).dependents),
          )

        expect(yield* dependents("packages/app/src/helper.ts")).toEqual({
          total: 1,
          files: ["packages/app/src/main.ts"],
        })
        expect((yield* dependents("packages/app/src/lib/util.ts")).files).toEqual(["packages/app/src/main.ts"])
        expect((yield* dependents("packages/shared/src/thing.ts")).files).toEqual(["packages/app/src/main.ts"])
        expect((yield* dependents("packages/app/src/main.ts")).total).toBe(0)
      }),
    { git: true },
  )

  it.instance(
    "does not count a file that only mentions the target name as a dependent",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* workspace(test.directory)
        yield* Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "packages/app/src/mentions.ts"),
            `// helper is mentioned here\nexport const helperName = "helper"\n`,
          ),
        )
        const result = yield* run(path.join(test.directory, "packages/app/src/helper.ts"))

        expect((JSON.parse(result.output) as Output).dependents.files).toEqual(["packages/app/src/main.ts"])
      }),
    { git: true },
  )

  it.instance(
    "truncates long dependent lists with a marker",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* workspace(test.directory)
        const count = DEPENDENT_LIMIT + 5
        yield* Effect.promise(async () => {
          for (let i = 0; i < count; i++) {
            await Bun.write(
              path.join(test.directory, `packages/app/src/users/user-${String(i).padStart(2, "0")}.ts`),
              `import { helper } from "../helper"\nexport const value = helper\n`,
            )
          }
        })
        const result = yield* run(path.join(test.directory, "packages/app/src/helper.ts"))
        const dependents = (JSON.parse(result.output) as Output).dependents

        expect(dependents.total).toBe(count + 1)
        expect(dependents.files).toHaveLength(DEPENDENT_LIMIT)
        expect(dependents.truncated).toBe(`...and 6 more (showing first ${DEPENDENT_LIMIT})`)
        expect(result.metadata.dependents).toBe(count + 1)
      }),
    { git: true },
    30000,
  )

  it.instance(
    "errors on a nonexistent path",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        expect(yield* failure(path.join(test.directory, "missing.ts"))).toContain("File not found")
      }),
    { git: true },
  )

  it.instance(
    "errors on a directory",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* workspace(test.directory)
        expect(yield* failure(path.join(test.directory, "packages/app/src"))).toContain("Not a file")
      }),
    { git: true },
  )

  it.instance(
    "errors on a file that is not JavaScript or TypeScript",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* workspace(test.directory)
        expect(yield* failure(path.join(test.directory, "packages/app/README.md"))).toContain("Unsupported file type")
      }),
    { git: true },
  )

  it.instance(
    "asks for read permission on the file",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* workspace(test.directory)
        const { items, next } = asks()
        yield* run(path.join(test.directory, "packages/app/src/helper.ts"), next)

        const read = items.find((item) => item.permission === "read")
        expect(read?.patterns).toEqual(["packages/app/src/helper.ts"])
        expect(items.find((item) => item.permission === "external_directory")).toBeUndefined()
      }),
    { git: true },
  )

  it.instance(
    "asks for external_directory permission outside the project",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const outside = path.join(path.dirname(test.directory), `outside-${path.basename(test.directory)}.ts`)
        yield* Effect.acquireRelease(
          Effect.promise(() => Bun.write(outside, "export const x = 1\n")),
          () => Effect.promise(() => Bun.file(outside).delete()),
        )
        const { items, next } = asks()
        yield* run(outside, next)

        expect(items.find((item) => item.permission === "external_directory")).toBeDefined()
      }),
    { git: true },
  )

  it.instance("stays inside the project directory when it is not a git repository", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* workspace(test.directory)
      const result = yield* run(path.join(test.directory, "packages/app/src/helper.ts"))
      const output = JSON.parse(result.output) as Output

      expect(output.file).toBe("packages/app/src/helper.ts")
      expect(output.dependents.files).toEqual(["packages/app/src/main.ts"])
    }),
  )
})

describe("tool.file_relations helpers", () => {
  it.effect("reads package names from bare and scoped specifiers", () =>
    Effect.sync(() => {
      expect(packageName("effect")).toBe("effect")
      expect(packageName("effect/Schema")).toBe("effect")
      expect(packageName("@opencode-ai/core/fs-util")).toBe("@opencode-ai/core")
    }),
  )

  it.effect("maps subpaths through package.json exports", () =>
    Effect.sync(() => {
      expect(exportTarget("./index.ts", ".")).toBe("./index.ts")
      expect(exportTarget({ ".": "./src/index.ts", "./*": "./src/*.ts" }, "./fs-util")).toBe("./src/fs-util.ts")
      expect(exportTarget({ ".": { import: "./dist/index.js" } }, ".")).toBe("./dist/index.js")
      expect(exportTarget({ "./*.js": "./src/*.ts" }, "./a/b.js")).toBe("./src/a/b.ts")
      expect(exportTarget({ ".": "./src/index.ts" }, "./missing")).toBeUndefined()
    }),
  )
})
