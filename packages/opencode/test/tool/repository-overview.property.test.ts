import { expect } from "bun:test"
import path from "path"
import fc from "fast-check"
import { rename } from "node:fs/promises"
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
// Independent oracle: vary language combinations without importing detection tables.
const languages = fc.uniqueArray(
  fc.constantFrom(
    { ext: "tsx", name: "TypeScript" },
    { ext: "py", name: "Python" },
    { ext: "rs", name: "Rust" },
    { ext: "go", name: "Go" },
    { ext: "java", name: "Java" },
    { ext: "js", name: "JavaScript" },
  ),
  { minLength: 1, maxLength: 6, selector: (item) => item.name },
)
const names = fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/), { minLength: 1, maxLength: 8 })

const requirements = [
  {
    id: "R1",
    kind: "model/oracle",
    wording:
      "The tool should display the repository's main directories, important files, and detected programming languages.",
  },
  {
    id: "R2",
    kind: "invariant",
    wording: "The tool must exclude dependency directories and sensitive file contents from the overview.",
  },
  {
    id: "R4",
    kind: "round-trip",
    wording:
      "When a file is added and later deleted, rerunning the tool should produce the same repository overview as before, assuming the final repository contents are unchanged.",
  },
  {
    id: "R5",
    kind: "metamorphic",
    wording:
      "When a directory is renamed without changing its contents, the overview must update the affected directory paths while preserving unrelated programming language and framework information.",
  },
]

requirements.forEach((requirement) => {
  it.live(`${requirement.id} (${requirement.kind}): ${requirement.wording}`, () =>
    Effect.gen(function* () {
      const services = yield* Effect.context<FSUtil.Service | Agent.Service | Truncate.Service>()
      // Each sample and shrink gets a fresh scoped instance. Capture Effect services
      // before crossing fast-check's Promise callback boundary; preserve failures.
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(
            names,
            languages,
            fc.boolean(),
            fc.stringMatching(/^[a-zA-Z0-9]{8,32}$/),
            async (folders, evidence, workspace, token) => {
              await Effect.gen(function* () {
                const test = yield* TestInstance
                const fs = yield* FSUtil.Service
                if (requirement.id === "R1") {
                  // Every case includes the P3 nested frontend/backend example,
                  // without workspace declarations. Vary depth, names, and extra languages.
                  const nested = folders.slice(0, 3).join("/")
                  yield* fs.ensureDir(path.join(test.directory, "frontend", nested))
                  yield* fs.ensureDir(path.join(test.directory, "backend", nested))
                  yield* fs.writeJson(path.join(test.directory, "package.json"), {})
                  yield* fs.writeFileString(path.join(test.directory, "frontend", nested, `${token}.tsx`), "")
                  yield* fs.writeFileString(path.join(test.directory, "backend", nested, `${token}.py`), "")
                  yield* Effect.forEach(evidence, (item) =>
                    fs.writeFileString(
                      path.join(test.directory, workspace ? "frontend" : "backend", nested, `main.${item.ext}`),
                      "",
                    ),
                  )
                  const info = yield* RepositoryOverviewTool
                  const tool = yield* info.init()
                  const result = yield* tool.execute({}, ctx)
                  expect(result.metadata.overview.folders).toEqual(["backend", "frontend"])
                  expect(result.metadata.overview.importantFiles).toEqual([{ path: "package.json", kind: "manifest" }])
                  expect(result.metadata.overview.languages).toEqual(
                    [...new Set(["TypeScript", "Python", ...evidence.map((item) => item.name)])].sort(),
                  )
                  expect(result.metadata.overview.workspaces).toEqual([])
                  expect(result.metadata.overview.truncated).toBe(false)
                  expect(JSON.parse(result.output)).toEqual(result.metadata.overview)
                  return
                }
                if (requirement.id === "R5") {
                  // Every sample exercises a stale literal declaration, without
                  // editing any files during the user/ -> client/ rename.
                  const nested = folders.slice(0, 3).join("/")
                  yield* fs.ensureDir(path.join(test.directory, "user", nested))
                  yield* fs.ensureDir(path.join(test.directory, "unrelated"))
                  yield* fs.writeJson(path.join(test.directory, "package.json"), {
                    workspaces: ["user"],
                    devDependencies: { vue: "3" },
                  })
                  yield* fs.writeJson(path.join(test.directory, "user/package.json"), { dependencies: { react: "19" } })
                  yield* fs.writeFileString(path.join(test.directory, "main.js"), "")
                  yield* Effect.forEach(evidence, (item) =>
                    fs.writeFileString(path.join(test.directory, "user", nested, `main.${item.ext}`), ""),
                  )
                  yield* Effect.forEach(evidence, (item) =>
                    fs.writeFileString(path.join(test.directory, "user", `main.${item.ext}`), ""),
                  )
                  // Root-of-workspace evidence makes the old implementation's
                  // loss of React and Python after the rename independently visible.
                  yield* fs.writeFileString(path.join(test.directory, "user/main.py"), "")
                  const info = yield* RepositoryOverviewTool
                  const tool = yield* info.init()
                  const before = yield* tool.execute({}, ctx)
                  expect(before.metadata.overview.languages).toEqual(
                    [...new Set(["JavaScript", "Python", ...evidence.map((item) => item.name)])].sort(),
                  )
                  expect(before.metadata.overview.frameworks).toEqual(["React", "Vue"])
                  expect(before.metadata.overview.workspaces).toEqual([{ path: "user", name: null }])
                  expect(before.metadata.overview.truncated).toBe(false)
                  yield* Effect.promise(() =>
                    rename(path.join(test.directory, "user"), path.join(test.directory, "client")),
                  )
                  const after = yield* tool.execute({}, ctx)
                  expect(after.metadata.overview).toEqual({
                    ...before.metadata.overview,
                    folders: ["client", "unrelated"],
                    // Membership must be truthful: client does not match "user".
                    workspaces: [],
                  })
                  expect(JSON.parse(after.output)).toEqual(after.metadata.overview)
                  return
                }
                yield* Effect.forEach(folders, (name) => fs.ensureDir(path.join(test.directory, `dir-${name}`)))
                yield* fs.writeJson(path.join(test.directory, "package.json"), {
                  workspaces: workspace ? ["dir-*"] : [],
                  dependencies: workspace ? {} : { react: "19" },
                })
                const directory = workspace ? path.join(test.directory, `dir-${folders[0]}`) : test.directory
                if (workspace) {
                  yield* fs.writeJson(path.join(directory, "package.json"), { dependencies: { react: "19" } })
                }
                yield* Effect.forEach(evidence, (item) =>
                  fs.writeFileString(path.join(directory, `main.${item.ext}`), ""),
                )
                const info = yield* RepositoryOverviewTool
                const tool = yield* info.init()
                const before = yield* tool.execute({}, ctx)
                expect(before.metadata.overview.languages).toEqual(evidence.map((item) => item.name).sort())
                expect(before.metadata.overview.frameworks).toEqual(["React"])
                expect(before.metadata.overview.truncated).toBe(false)
                expect(JSON.parse(before.output)).toEqual(before.metadata.overview)
                if (requirement.id === "R2") {
                  // Add every excluded directory at root and inside a declared workspace.
                  // Random secrets and hostile metadata reveal content or traversal leaks.
                  const secret = `PRIVATE_SENTINEL_${token}`
                  yield* fs.writeFileString(path.join(test.directory, ".env"), `API_KEY=${secret}`)
                  yield* Effect.forEach(
                    [
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
                    ].flatMap((name) => [name, `dir-${folders[0]}/${name}`]),
                    (name) =>
                      Effect.gen(function* () {
                        yield* fs.ensureDir(path.join(test.directory, name))
                        yield* fs.writeJson(path.join(test.directory, name, "package.json"), {
                          name: secret,
                          dependencies: { vue: "3" },
                        })
                        yield* fs.writeFileString(path.join(test.directory, name, "leak.py"), secret)
                      }),
                  )
                  // Include wildcard traversal so exclusion is tested during resolution.
                  yield* fs.writeJson(path.join(test.directory, "package.json"), {
                    workspaces: ["*", "*/*"],
                    dependencies: { react: "19" },
                  })
                  const after = yield* tool.execute({}, ctx)
                  expect(after.output).not.toContain(secret)
                  expect(after.output).not.toContain(".env")
                  expect(after.metadata.overview.folders).toEqual(before.metadata.overview.folders)
                  expect(after.metadata.overview.workspaces).toEqual(
                    folders
                      .map((name) => ({ path: `dir-${name}`, name: null }))
                      .sort((a, b) => (a.path < b.path ? -1 : 1)),
                  )
                  expect(after.metadata.overview.languages).toEqual(before.metadata.overview.languages)
                  expect(after.metadata.overview.frameworks).toEqual(["React"])
                  return
                }
                if (requirement.id === "R4") {
                  // README always changes importantFiles, even if languages already include TS.
                  yield* fs.writeFileString(path.join(test.directory, `README-${token}.md`), "temporary")
                  expect((yield* tool.execute({}, ctx)).output).not.toBe(before.output)
                  yield* fs.remove(path.join(test.directory, `README-${token}.md`))
                  const after = yield* tool.execute({}, ctx)
                  expect(after.output).toBe(before.output)
                  expect(after.metadata).toEqual(before.metadata)
                  return
                }
              }).pipe(withTmpdirInstance(), Effect.scoped, Effect.provide(services), Effect.runPromise)
            },
          ),
          { numRuns: 50 },
        ),
      )
    }),
  )
})
