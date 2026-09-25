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
        languages: ["TypeScript"],
        frameworks: [],
        workspaces: [],
        workspacePatterns: [],
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
        languages: [],
        frameworks: [],
        workspaces: [],
        workspacePatterns: [],
        importantFiles: [],
        truncated: false,
      })
      expect(result.metadata.overview).toEqual(JSON.parse(result.output))
    }),
  )

  it.instance("detects Java from each build configuration at root and workspace roots without source files", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.writeJson(path.join(test.directory, "package.json"), { workspaces: ["packages/app"] })
      yield* fs.ensureDir(path.join(test.directory, "packages/app"))
      const info = yield* RepositoryOverviewTool
      const tool = yield* info.init()
      yield* Effect.forEach([".", "packages/app"], (directory) =>
        Effect.forEach(["pom.xml", "build.gradle", "build.gradle.kts"], (name) =>
          Effect.gen(function* () {
            const file = path.join(test.directory, directory, name)
            yield* fs.writeFileString(file, "")
            const result = yield* tool.execute({}, ctx)
            expect(result.metadata.overview.languages).toEqual(["Java"])
            yield* fs.remove(file)
          }),
        ),
      )
    }),
  )

  const technologyCases = [
    {
      title: "detects TypeScript from a root source extension",
      files: ["index.tsx"],
      manifest: {},
      languages: ["TypeScript"],
      frameworks: [],
    },
    {
      title: "sorts and deduplicates languages from source and manifest filenames",
      files: ["index.ts", "types.ts", "tsconfig.json", "main.js", "Main.java", "pyproject.toml", "go.mod", "Cargo.toml"],
      manifest: {},
      languages: ["Go", "Java", "JavaScript", "Python", "Rust", "TypeScript"],
      frameworks: [],
    },
    {
      title: "detects exact root dependency and devDependency framework names",
      files: [],
      manifest: {
        dependencies: { react: "^19", next: "^15", express: "^5", "@angular/core": "^20" },
        devDependencies: { vue: "^3", svelte: "^5", react: "^19" },
      },
      languages: [],
      frameworks: ["Angular", "Express", "Next.js", "React", "Svelte", "Vue"],
    },
    {
      title: "ignores malformed dependency containers",
      files: [],
      manifest: { dependencies: ["react"], devDependencies: "next" },
      languages: [],
      frameworks: [],
    },
    {
      title: "ignores invalid dependency values while preserving valid evidence",
      files: [],
      manifest: { dependencies: { react: false, next: {}, vue: null, svelte: " ", express: "^5" } },
      languages: [],
      frameworks: ["Express"],
    },
    {
      title: "does not infer technologies from weak metadata or arbitrary source text",
      files: ["README.md", "notes.txt"],
      manifest: {
        name: "react-typescript-project",
        dependencies: { typescript: "^5", "@types/react": "^19", "react-helper": "1" },
        scripts: { build: "next build" },
      },
      languages: [],
      frameworks: [],
    },
    {
      title: "ignores language evidence inside generated directories and deeper source trees",
      files: ["node_modules/main.ts", "dist/main.js", "build/main.py", "coverage/Main.java", "src/deep/main.rs"],
      manifest: {},
      languages: [],
      frameworks: [],
    },
  ]

  technologyCases.forEach((input) => {
    it.instance(input.title, () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const fs = yield* FSUtil.Service
        yield* fs.writeJson(path.join(test.directory, "package.json"), input.manifest)
        yield* Effect.forEach(input.files, (file) =>
          Effect.gen(function* () {
            yield* fs.ensureDir(path.dirname(path.join(test.directory, file)))
            yield* fs.writeFileString(path.join(test.directory, file), "React Next.js Python")
          }),
        )
        const info = yield* RepositoryOverviewTool
        const tool = yield* info.init()
        const result = yield* tool.execute({}, ctx)
        expect(result.metadata.overview.languages).toEqual(input.languages)
        expect(result.metadata.overview.frameworks).toEqual(input.frameworks)
        expect(JSON.parse(result.output)).toEqual(result.metadata.overview)
      }),
    )
  })

  it.instance("aggregates workspace technologies, deduplicates frameworks, and skips symlink evidence", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.writeJson(path.join(test.directory, "package.json"), {
        workspaces: ["packages/*", "node_modules/*"],
        dependencies: { react: "^19" },
      })
      yield* Effect.forEach(["packages/a", "packages/b", "node_modules/ignored"], (directory) =>
        fs.ensureDir(path.join(test.directory, directory)),
      )
      yield* fs.writeJson(path.join(test.directory, "packages/a/package.json"), { dependencies: { react: "^19" } })
      yield* fs.writeJson(path.join(test.directory, "packages/b/package.json"), { devDependencies: { vue: "^3" } })
      yield* fs.writeJson(path.join(test.directory, "node_modules/ignored/package.json"), { dependencies: { next: "^15" } })
      yield* fs.writeFileString(path.join(test.directory, "packages/a/index.ts"), "")
      yield* fs.writeFileString(path.join(test.directory, "packages/b/main.py"), "")
      yield* fs.writeFileString(path.join(test.directory, "node_modules/ignored/Main.java"), "")
      yield* fs.symlink(
        path.join(test.directory, "node_modules/ignored/Main.java"),
        path.join(test.directory, "packages/a/Main.java"),
      )
      const info = yield* RepositoryOverviewTool
      const tool = yield* info.init()
      const result = yield* tool.execute({}, ctx)
      expect(result.metadata.overview.languages).toEqual(["Python", "TypeScript"])
      expect(result.metadata.overview.frameworks).toEqual(["React", "Vue"])
      expect(result.metadata.overview.workspaces).toEqual([
        { path: "packages/a", name: null },
        { path: "packages/b", name: null },
      ])
    }),
  )

  const workspaceCases = [
    {
      title: "resolves array workspaces with names, sorting, and duplicate removal",
      declaration: ["packages/*", "apps/*", "packages/alpha", "./packages//*"],
      patterns: ["apps/*", "packages/*", "packages/alpha"],
      expected: [
        { path: "apps/web", name: "@example/web" },
        { path: "packages/alpha", name: "@example/alpha" },
        { path: "packages/broken", name: null },
        { path: "packages/empty", name: null },
        { path: "packages/missing", name: null },
        { path: "packages/number", name: null },
      ],
    },
    {
      title: "resolves object workspace declarations",
      declaration: { packages: ["apps/*", "packages/alpha"] },
      patterns: ["apps/*", "packages/alpha"],
      expected: [
        { path: "apps/web", name: "@example/web" },
        { path: "packages/alpha", name: "@example/alpha" },
      ],
    },
    {
      title: "resolves nested workspace patterns while excluding generated directories and symlinks",
      declaration: [
        "packages/**/alpha",
        "node_modules/*",
        "dist/*",
        "build/*",
        "coverage/*",
        "packages/node_modules/*",
        "../*",
        "/tmp/*",
        "linked/*",
      ],
      patterns: ["linked/*", "packages/**/alpha"],
      expected: [{ path: "packages/alpha", name: "@example/alpha" }],
    },
    ...["packages/*", { packages: "packages/*" }, ["packages/*", 42], null].map((declaration, index) => ({
      title: `ignores malformed workspace declaration ${index + 1}`,
      declaration,
      patterns: [],
      expected: [],
    })),
  ]

  workspaceCases.forEach((input) => {
    it.instance(input.title, () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const fs = yield* FSUtil.Service
        yield* fs.writeJson(path.join(test.directory, "package.json"), { name: "root", workspaces: input.declaration })
        yield* Effect.forEach(
          [
            ["packages/number", '{"name":42}'],
            ["packages/empty", '{"name":"   "}'],
            ["packages/broken", "{broken"],
            ["packages/alpha", '{"name":"@example/alpha"}'],
            ["apps/web", '{"name":"@example/web"}'],
            ["node_modules/alpha", '{"name":"excluded"}'],
            ["packages/node_modules/alpha", '{"name":"excluded"}'],
          ],
          (item) =>
            Effect.gen(function* () {
              yield* fs.ensureDir(path.join(test.directory, item[0]))
              yield* fs.writeFileString(path.join(test.directory, item[0], "package.json"), item[1])
            }),
        )
        yield* fs.ensureDir(path.join(test.directory, "packages/missing"))
        yield* fs.symlink(path.join(test.directory, "apps"), path.join(test.directory, "linked"))
        const info = yield* RepositoryOverviewTool
        const tool = yield* info.init()
        const result = yield* tool.execute({}, ctx)
        expect(result.metadata.overview.workspaces).toEqual(input.expected)
        expect(result.metadata.overview.workspacePatterns).toEqual(input.patterns)
        expect(JSON.parse(result.output).workspacePatterns).toEqual(input.patterns)
        expect(JSON.parse(result.output).workspaces).toEqual(input.expected)
        expect(result.metadata.overview.package).toEqual({ name: "root" })
      }),
    )
  })

  it.instance("ignores unsafe workspace patterns in declarations and resolution", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.ensureDir(path.join(test.directory, "packages/private"))
      yield* fs.writeJson(path.join(test.directory, "package.json"), {
        workspaces: [
          "../outside/*",
          "/tmp/*",
          "C:/outside/*",
          "C:\\outside\\*",
          "!packages/private",
          "packages\\*",
          path.join(test.directory, "packages", "*"),
          `../${path.basename(test.directory)}/packages/*`,
        ],
      })
      const info = yield* RepositoryOverviewTool
      const tool = yield* info.init()
      const result = yield* tool.execute({}, ctx)
      expect(result.metadata.overview.workspacePatterns).toEqual([])
      expect(result.metadata.overview.workspaces).toEqual([])
      expect(JSON.parse(result.output).workspacePatterns).toEqual([])
      expect(JSON.parse(result.output).workspaces).toEqual([])
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
