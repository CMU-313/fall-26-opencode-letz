import { describe, expect } from "bun:test"
import path from "path"
import fc from "fast-check"
import { Cause, Effect, Exit } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "@/agent/agent"
import { MessageID, SessionID } from "@/session/schema"
import { DirectorySummaryTool } from "@/tool/directory_summary"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { requireInstance, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([FSUtil.node, Agent.node, Truncate.node, CrossSpawnSpawner.node])),
)
const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_property"),
  messageID: MessageID.make("msg_property"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}
type Summary = {
  purpose: string
  files: { name: string; role: string }[]
  subdirectories: string[]
  dependencies: { file: string; specifier: string; kind: string; target: string; directory: string }[]
  relatedDirectories: { directory: string; imports: number; files: string[] }[]
  externalPackages: { name: string; kind: string; files: string[] }[]
  unresolvedImports: { file: string; specifier: string }[]
  truncated: boolean
  skipped: unknown[]
}
const summarize = Effect.fn("DirectorySummaryProperty.summarize")(function* (directory = "module") {
  const info = yield* DirectorySummaryTool
  const tool = yield* info.init()
  const result: Summary = JSON.parse((yield* tool.execute({ path: directory }, ctx)).output)
  expect(result.truncated).toBe(false)
  expect(result.skipped).toEqual([])
  return result
})
const write = Effect.fn("DirectorySummaryProperty.write")(function* (files: Record<string, string>) {
  const instance = yield* requireInstance
  const fs = yield* FSUtil.Service
  yield* fs.makeDirectory(path.join(instance.directory, "module"), { recursive: true })
  yield* Effect.forEach(Object.entries(files), ([name, text]) =>
    fs.writeWithDirs(path.join(instance.directory, name), text),
  )
})

// Capture the live test services; each generated case gets its own scoped workspace.
function check<A, E, R>(arbitrary: fc.Arbitrary<A>, body: (value: A) => Effect.Effect<void, E, R>) {
  return Effect.gen(function* () {
    const services = yield* Effect.context<R>()
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(arbitrary, (value) => Effect.runPromiseWith(services)(body(value))),
        {
          numRuns: 100,
          seed: 17313,
        },
      ),
    )
  })
}
const ids = fc.uniqueArray(fc.integer({ min: 0, max: 12 }), { maxLength: 8 })
const extension = fc.constantFrom("ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs")

describe("tool.directory_summary properties", () => {
  // P1: Report resolved imports outside the summarized directory with their target directory and resolution kind.
  // Kind: model/oracle
  // Generator rationale: empty through eight targets, nested sibling paths, all supported source extensions,
  // and both relative and tsconfig alias resolution; expected edges come from the generated fixture model.
  it.live(
    "P1 model/oracle: resolved dependency targets",
    () =>
      check(
        fc.tuple(ids, extension, fc.boolean(), fc.boolean(), fc.constantFrom("", ".suffix"), fc.boolean()),
        ([targets, ext, alias, baseUrl, suffix, exact]) =>
          provideTmpdirInstance(() =>
            Effect.gen(function* () {
              const root = baseUrl ? "source-root/" : ""
              const specifier = (id: number) =>
                alias ? `@lib/group${id % 3}/item${id}${suffix}` : `../${root}lib/group${id % 3}/item${id}`
              yield* write({
                "tsconfig.json": JSON.stringify({
                  compilerOptions: {
                    ...(baseUrl ? { baseUrl: "source-root" } : {}),
                    paths: exact
                      ? Object.fromEntries(
                          targets.map((id) => [
                            `@lib/group${id % 3}/item${id}${suffix}`,
                            [`lib/group${id % 3}/item${id}`],
                          ]),
                        )
                      : { [`@lib/*${suffix}`]: ["lib/*"] },
                  },
                }),
                ...Object.fromEntries(
                  targets.map((id) => [`${root}lib/group${id % 3}/item${id}.ts`, "export const value = 1"]),
                ),
                ...(baseUrl
                  ? Object.fromEntries(
                      targets.map((id) => [`lib/group${id % 3}/item${id}.ts`, "export const decoy = 1"]),
                    )
                  : {}),
                [`module/index.${ext}`]: targets.map((id) => `import "${specifier(id)}"`).join("\n"),
              })
              const summary = yield* summarize()
              expect(summary.dependencies.toSorted((a, b) => a.target.localeCompare(b.target))).toEqual(
                targets
                  .map((id) => ({
                    file: `index.${ext}`,
                    specifier: specifier(id),
                    kind: alias ? "alias" : "relative",
                    target: `${root}lib/group${id % 3}/item${id}.ts`,
                    directory: `${root}lib/group${id % 3}`,
                  }))
                  .toSorted((a, b) => a.target.localeCompare(b.target)),
              )
              expect(summary.unresolvedImports).toEqual([])
              expect(summary.externalPackages).toEqual([])
            }),
          ),
      ),
    60000,
  )

  // P2: Count each distinct (source file, target) once and aggregate counts and source files by related directory.
  // Kind: metamorphic
  // Generator rationale: duplicate imports and alternate specifiers for the same target across one to four files;
  // repeating and reversing imports must preserve edges and independently computed aggregate counts.
  it.live(
    "P2 metamorphic: duplicate imports preserve frequency",
    () =>
      check(fc.tuple(ids, fc.integer({ min: 1, max: 4 }), fc.boolean()), ([targets, count, collide]) =>
        provideTmpdirInstance(() =>
          Effect.gen(function* () {
            const target = (id: number) => (collide ? `lib/group${id}/value` : `lib/item${id}`)
            const sources = Array.from({ length: count }, (_, i) => `source${i}.ts`)
            yield* write({
              ...Object.fromEntries(targets.map((id) => [`${target(id)}.ts`, "export const value = 1"])),
              ...Object.fromEntries(
                sources.map((file) => [`module/${file}`, targets.map((id) => `import "../${target(id)}"`).join("\n")]),
              ),
            })
            const before = yield* summarize()
            expect(before.dependencies).toHaveLength(targets.length * count)
            expect(before.relatedDirectories).toEqual(
              collide
                ? targets
                    .map((id) => ({ directory: `lib/group${id}`, imports: count, files: sources }))
                    .toSorted((a, b) => a.directory.localeCompare(b.directory))
                : targets.length
                  ? [{ directory: "lib", imports: targets.length * count, files: sources }]
                  : [],
            )
            yield* write(
              Object.fromEntries(
                sources.map((file) => [
                  `module/${file}`,
                  targets
                    .toReversed()
                    .flatMap((id) => [
                      `import "../${target(id)}"`,
                      `import "../${target(id)}"`,
                      `import "../${target(id)}.ts"`,
                    ])
                    .join("\n"),
                ]),
              ),
            )
            expect((yield* summarize()).dependencies).toEqual(before.dependencies)
            expect((yield* summarize()).relatedDirectories).toEqual(before.relatedDirectories)
          }),
        ),
      ),
    60000,
  )

  // P3: Exclude imports within the summarized directory and do not scan nested source files.
  // Kind: metamorphic
  // Generator rationale: generated nesting depths and similar sibling names exercise containment boundaries;
  // internal files and nested imports must leave the existing outward dependency sets unchanged.
  it.live(
    "P3 metamorphic: internal and nested files preserve outward dependencies",
    () =>
      check(fc.tuple(ids, fc.integer({ min: 1, max: 4 })), ([targets, depth]) =>
        provideTmpdirInstance(() =>
          Effect.gen(function* () {
            yield* write({ "module/index.ts": 'import "../module-other/value"', "module-other/value.ts": "export {}" })
            const before = yield* summarize()
            expect(before.dependencies.map((edge) => edge.directory)).toEqual(["module-other"])
            const nested = Array.from({ length: depth }, (_, i) => `level${i}`).join("/")
            yield* write({
              ...Object.fromEntries(
                targets.map((id) => [`module/${nested}/item${id}.ts`, 'import "nested-only-package"']),
              ),
              "module/index.ts": [
                'import "../module-other/value"',
                ...targets.map((id) => `import "./${nested}/item${id}"`),
              ].join("\n"),
            })
            const after = yield* summarize()
            expect(after.dependencies).toEqual(before.dependencies)
            expect(after.relatedDirectories).toEqual(before.relatedDirectories)
            expect(after.externalPackages).toEqual([])
            expect(after.unresolvedImports).toEqual([])
          }),
        ),
      ),
    60000,
  )

  // P4: Report third-party packages and runtime builtins separately from repository dependencies, with unique importing files.
  // Kind: model/oracle
  // Generator rationale: scoped/unscoped package subpaths, node/bun builtins, duplicate imports, and empty subsets.
  it.live(
    "P4 model/oracle: external package and builtin classification",
    () =>
      check(
        fc.tuple(
          fc.subarray([
            { specifier: "p4-package/subpath", name: "p4-package", kind: "package" },
            { specifier: "@p4/package/deep/path", name: "@p4/package", kind: "package" },
            { specifier: "node:fs", name: "node:fs", kind: "builtin" },
            { specifier: "path", name: "path", kind: "builtin" },
            { specifier: "bun", name: "bun", kind: "builtin" },
            { specifier: "bun:test", name: "bun:test", kind: "builtin" },
          ]),
          fc.integer({ min: 1, max: 4 }),
        ),
        ([imports, count]) =>
          provideTmpdirInstance(() =>
            Effect.gen(function* () {
              const sources = Array.from({ length: count }, (_, i) => `source${i}.ts`)
              yield* write(
                Object.fromEntries(
                  sources.map((file) => [
                    `module/${file}`,
                    imports.flatMap((item) => [`import "${item.specifier}"`, `import "${item.specifier}"`]).join("\n"),
                  ]),
                ),
              )
              const summary = yield* summarize()
              expect(summary.externalPackages).toEqual(
                imports
                  .map((item) => ({ name: item.name, kind: item.kind, files: sources }))
                  .toSorted((a, b) => a.name.localeCompare(b.name)),
              )
              expect(summary.dependencies).toEqual([])
              expect(summary.relatedDirectories).toEqual([])
              expect(summary.unresolvedImports).toEqual([])
            }),
          ),
      ),
    60000,
  )
})

// R2: Mark inferred purpose as tentative and explicitly state when no specific purpose can be inferred.
// Kind: invariant
// Generator rationale: source, manifest, unknown-file and empty directories cover confident-looking guesses and unknowns.
it.live(
  "R2 invariant: purpose communicates uncertainty",
  () =>
    check(
      fc.tuple(fc.constantFrom("source", "package", "unknown", "empty", "tests", "docs", "scripts", "groups"), ids),
      ([kind, values]) =>
        provideTmpdirInstance(() =>
          Effect.gen(function* () {
            yield* write(
              kind === "source"
                ? { "module/index.ts": "export {}" }
                : kind === "package"
                  ? { "module/package.json": "{}" }
                  : kind === "unknown"
                    ? { "module/data.dat": "data" }
                    : kind === "empty"
                      ? {}
                      : kind === "groups"
                        ? Object.fromEntries(
                            [0, ...values.map((id) => id + 1)].map((id) => [`module/group${id}/index.ts`, "export {}"]),
                          )
                        : Object.fromEntries(
                            [0, ...values.map((id) => id + 1)].map((id) => [
                              `module/item${id}.${kind === "tests" ? "test.ts" : kind === "docs" ? "md" : "ts"}`,
                              "",
                            ]),
                          ),
            )
            const directory = ["tests", "docs", "scripts"].includes(kind) ? kind : "module"
            if (directory !== "module") {
              const fs = yield* FSUtil.Service
              const instance = yield* requireInstance
              yield* fs.rename(path.join(instance.directory, "module"), path.join(instance.directory, directory))
            }
            const summary = yield* summarize(directory)
            expect(summary.purpose).toMatch(
              kind === "empty" || kind === "unknown" ? /no (?:more specific )?purpose can be inferred/ : /^Likely /,
            )
            expect(summary.purpose.length).toBeGreaterThan(0)
          }),
        ),
    ),
  60000,
)

// R3: Return a filename-based purpose overview in one or two sentences, separate from detailed file and dependency lists.
// Kind: invariant
// Generator rationale: zero to eight source files plus optional package metadata vary contents without assuming semantic inference.
it.live(
  "R3 invariant: purpose is a concise overview",
  () =>
    check(fc.tuple(ids, fc.boolean()), ([files, manifest]) =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          yield* write({
            ...Object.fromEntries(files.map((id) => [`module/item${id}.ts`, "export {}"])),
            ...(manifest ? { "module/package.json": "{}" } : {}),
          })
          const summary = yield* summarize()
          expect(summary.purpose.length).toBeGreaterThan(0)
          expect(summary.purpose.length).toBeLessThanOrEqual(200)
          expect(summary.purpose.match(/[.!?](?:\s|$)/g)?.length).toBeGreaterThanOrEqual(1)
          expect(summary.purpose.match(/[.!?](?:\s|$)/g)?.length).toBeLessThanOrEqual(2)
          expect(summary.purpose).toBe(
            manifest
              ? "Likely a package or project root, with dependency and build metadata."
              : files.length
                ? "Likely a source module containing application or library implementation."
                : "Empty directory; no purpose can be inferred.",
          )
        }),
      ),
    ),
  60000,
)

// R4: Fail a summary request for a missing or deleted directory with an explicit Directory not found error identifying its path.
// Kind: invariant
// Generator rationale: varied safe directory names and both never-created and deleted paths exercise the two missing cases.
it.live(
  "R4 invariant: missing and deleted directories have explicit errors",
  () =>
    check(
      fc.tuple(fc.integer({ min: 0, max: 10000 }), fc.boolean(), fc.integer({ min: 0, max: 3 })),
      ([id, deleted, depth]) =>
        provideTmpdirInstance(() =>
          Effect.gen(function* () {
            const instance = yield* requireInstance
            const fs = yield* FSUtil.Service
            const name = [...Array.from({ length: depth }, (_, n) => `parent${n}`), `missing${id}`].join("/")
            if (deleted) {
              yield* fs.makeDirectory(path.join(instance.directory, name), { recursive: true })
              yield* fs.remove(path.join(instance.directory, name), { recursive: true })
            }
            const info = yield* DirectorySummaryTool
            const tool = yield* info.init()
            const result = yield* tool.execute({ path: name }, ctx).pipe(Effect.exit)
            expect(Exit.isFailure(result)).toBe(true)
            if (Exit.isSuccess(result)) throw new Error("Expected missing directory failure")
            expect(String(Cause.squash(result.cause))).toContain(
              `Directory not found: ${path.join(instance.directory, name)}`,
            )
          }),
        ),
    ),
  60000,
)

// R5: Recompute the immediate file listing on every call so added files appear and removed files disappear.
// Kind: metamorphic
// Generator rationale: disjoint original and replacement file sets include empty, single-file and multi-file updates.
it.live(
  "R5 metamorphic: additions and deletions refresh the file listing",
  () =>
    check(fc.tuple(ids, ids, ids), ([original, added, directories]) =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const instance = yield* requireInstance
          const fs = yield* FSUtil.Service
          yield* write({
            ...Object.fromEntries(original.map((id) => [`module/original${id}.ts`, "export {}"])),
            ...Object.fromEntries(directories.map((id) => [`module/folder${id}/index.ts`, "export {}"])),
          })
          expect((yield* summarize()).subdirectories.toSorted()).toEqual(
            directories.map((id) => `folder${id}`).toSorted(),
          )
          expect((yield* summarize()).files.map((file) => file.name).toSorted()).toEqual(
            original.map((id) => `original${id}.ts`).toSorted(),
          )
          yield* write(Object.fromEntries(added.map((id) => [`module/added${id}.ts`, "export {}"])))
          expect((yield* summarize()).files.map((file) => file.name).toSorted()).toEqual(
            [...original.map((id) => `original${id}.ts`), ...added.map((id) => `added${id}.ts`)].toSorted(),
          )
          yield* Effect.forEach(original, (id) => fs.remove(path.join(instance.directory, `module/original${id}.ts`)))
          expect((yield* summarize()).files.map((file) => file.name).toSorted()).toEqual(
            added.map((id) => `added${id}.ts`).toSorted(),
          )
        }),
      ),
    ),
  60000,
)

// R6: For a directory rename that preserves its filename-based purpose category and entry-point naming relationships, preserve purpose and file roles; update reported paths to the new directory name.
// Kind: metamorphic
// Generator rationale: ordinary utils/helpers names avoid category-name changes; generated source sets preserve entry-point relationships.
it.live(
  "R6 metamorphic: comparable directory renames preserve purpose and roles",
  () =>
    check(ids, (files) =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const instance = yield* requireInstance
          const fs = yield* FSUtil.Service
          yield* write({
            "module/index.ts": "export {}",
            ...Object.fromEntries(files.map((id) => [`module/item${id}.ts`, "export {}"])),
          })
          yield* fs.rename(path.join(instance.directory, "module"), path.join(instance.directory, "utils"))
          const info = yield* DirectorySummaryTool
          const tool = yield* info.init()
          const before = JSON.parse((yield* tool.execute({ path: "utils" }, ctx)).output) as Summary & {
            path: string
            relativePath: string
          }
          yield* fs.rename(path.join(instance.directory, "utils"), path.join(instance.directory, "helpers"))
          const after = JSON.parse((yield* tool.execute({ path: "helpers" }, ctx)).output) as Summary & {
            path: string
            relativePath: string
          }
          expect(after.purpose).toBe(before.purpose)
          expect(after.files).toEqual(before.files)
          expect(before.relativePath).toBe("utils")
          expect(after.relativePath).toBe("helpers")
          expect(before.path).toBe(path.join(instance.directory, "utils"))
          expect(after.path).toBe(path.join(instance.directory, "helpers"))
        }),
      ),
    ),
  60000,
)
