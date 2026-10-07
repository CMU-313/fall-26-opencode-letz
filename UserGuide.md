# User Guide

## File relations tool (Ethan Tao, issue #4)

### What it does

`file_relations` is an agent tool that takes one JavaScript or TypeScript file and returns structured JSON with:

- `imports`: each import, classified as `same-package` (relative paths, tsconfig aliases like `@/...`, `#name` imports from package.json, or the file's own package name), `workspace` (another package in this monorepo), or `external` (npm packages and runtime built-ins), plus the resolved file when it can be found
- `exports`: top-level runtime exports (const, function, class, default, `export * as`); type-only exports are left out
- `dependents`: other files in the workspace that import this file, capped at 50 with a `truncated` marker like `...and 80 more (showing first 50)`

It is behind a feature flag, so the agent does not see the tool unless the flag is on. It follows the `read` permission, so read-only agents like `explore` can use it too.

### How to use it

1. Install dependencies from the repo root: `bun install`
2. Turn the flag on by setting `OPENCODE_EXPERIMENTAL_FILE_RELATIONS=true` (setting `OPENCODE_EXPERIMENTAL=true` also turns it on).
3. Start opencode with the flag set and ask the agent about a file, for example "Use file_relations on src/tool/glob.ts":

   ```sh
   cd packages/opencode
   OPENCODE_EXPERIMENTAL_FILE_RELATIONS=true bun run dev
   ```

   Chatting needs a connected model provider (`/connect`). The default free model returns "OpenCode's free tier can only be used from within OpenCode" in a dev build. To test without a model or API key, use the `debug agent` command below.

### How to user test it

The `debug agent` command calls the tool directly, so you can check its output without a model or API key. Run these from `packages/opencode`:

```sh
OPENCODE_EXPERIMENTAL_FILE_RELATIONS=true bun run --conditions=browser ./src/index.ts debug agent build \
  --tool file_relations --params '{"filePath":"src/tool/glob.ts"}' 2>/dev/null | jq -r .result.output
```

What you should see:

- 8 imports: 4 `same-package` (including the `@/effect/instance-state` alias), 2 `workspace` (`@opencode-ai/core/...`), 2 `external` (`effect`, `path`)
- exports `GlobTool` and `Parameters`
- 3 dependents: `registry.ts`, `glob.test.ts`, `parameters.test.ts`

More checks:

| Try | Expected |
| --- | --- |
| `"filePath":"../core/src/fs-util.ts"` | about 130 dependents, 50 listed, plus a `truncated` marker |
| `"filePath":"src/tool/nope.ts"` | `File not found: ...` |
| `"filePath":"package.json"` | `Unsupported file type: ...` |
| Same command without the flag | `Tool file_relations not found for agent build` |

(`jq` only pretty-prints the output. Without it, look at the `output` field of the printed JSON.)

### Automated tests

Run from `packages/opencode`:

```sh
bun test test/tool/file_relations.test.ts test/tool/registry.test.ts
```

- `test/tool/file_relations.test.ts` (27 tests) builds a small two-package monorepo in a temp directory and runs the real tool on it. It checks:
  - each import kind (relative, tsconfig alias, `#name` imports, workspace package through an `exports` map, npm, built-in, dynamic `import()`, `require()`)
  - that the most specific tsconfig alias wins and a `*` inside an alias target is filled in, as in TypeScript
  - that `require()` uses the `require` export condition, and that paths containing `..` are normalized
  - that type-only imports and import-like text in comments or strings are ignored
  - each export form, and that type-only exports are left out
  - dependents found through relative, alias, workspace, `.`/`..`/`./index` imports, and that a file that only mentions the name is not counted
  - the 50-dependent truncation marker, and the warning when the search hits its candidate cap or fails
  - the exact JSON shape of the output
  - errors for a missing path, a directory, and a non-JS/TS file
  - read and external-directory permission checks
- `test/tool/registry.test.ts` (2 file_relations tests) checks that the tool is hidden when the flag is off and listed when it is on.
- `test/permission/next.test.ts` ("treats file_relations as a read tool") checks that the tool is shown or hidden by `read` rules.

### Why these tests are sufficient

- Each acceptance criterion in issue #4 has at least one test, and the tests check exact results with `toEqual`, not just that something was returned.
- The tests run the real tool, with the real parser and ripgrep, on real files, so import resolution and the dependent search are exercised end to end.
- Edge cases found during review (index imports, shebang files, CommonJS, packages importing themselves, `#name` imports, non-git projects and `node_modules`) each have a regression test.
- The flag tests show default agent behavior is unchanged unless the flag is on.

### Known limitations

- Only JavaScript and TypeScript files are supported.
- A dependent is missed when its import specifier does not contain the target file's name, for example a renamed `exports` subpath or an exact tsconfig alias.
- Only `compilerOptions.paths` in the `tsconfig.json` next to `package.json` is read; `extends` is not followed.
- An index file imported from two or more folders away (for example `"../.."`) is not found as a dependent.
- CommonJS exports (`module.exports = ...`) are not listed; only ESM exports are.

## Directory Summary Tool (Tiffany Liu, issue #9)

### What it does

`directory_summary` is a built-in agent tool that takes one directory in the current workspace and returns structured JSON describing it. It helps you see where a folder fits in an unfamiliar codebase, between a whole-repository overview and a single file's imports.

For the directory you give it, it reports:

- **What the folder appears to do**: `purpose` is a short guess based on the folder's contents (package root, tests, docs, scripts, source module, or a group of modules). `files` lists each immediate file with a role (entry point, source, test, documentation, configuration, package manifest, dependency lockfile, file). `importantFiles` and `subdirectories` are also included.
- **Dependencies on other folders**: `relatedDirectories` lists every other repository folder this one imports from. `dependencies` has one record per (file, target), with the import specifier and its kind:
  - `relative`: `./foo`, `../foo`
  - `alias`: tsconfig `paths`, such as `@/session/schema`
  - `subpath`: package.json `imports`, such as `#db`
  - `workspace`: another package in the monorepo, such as `@opencode-ai/core/fs-util`
- **How often each dependency occurs**: each `relatedDirectories` entry has an `imports` count and the list of `files` that import from that folder. The list is sorted with the most-used folder first. If one file imports the same target several times, it counts once.
- **External package dependencies**: `externalPackages` lists npm packages (`kind: "package"`) and runtime built-ins such as `path` or `node:fs` (`kind: "builtin"`), with the files that use each one.

It also reports what it could not check. `unresolvedImports` lists relative, alias, or subpath imports whose target file does not exist. `skipped` and `truncated` show when coverage is incomplete, for example because of symlinks, unparseable files, files over 256 KiB, or more than 200 entries.

Behavior to know about:

- Only the immediate `.js`/`.jsx`/`.ts`/`.tsx`/`.mjs`/`.cjs`/`.mts`/`.cts` files in the folder are scanned. Subdirectories are listed but not scanned.
- Imports are found with Bun's parser, so import-like text inside comments, strings, or template literals is ignored. `import type` lines are not counted because they are erased at runtime.
- Imports that stay inside the folder, including its subdirectories, are internal structure and are not listed as dependencies.
- Paths outside the workspace, including symlinks that point outside it, are rejected. The tool asks for `read` permission on the directory and on every file it reads, so normal OpenCode permission rules apply.

### How to use it

The tool is always available to the `build`, `plan`, and `explore` agents. You don't need a feature flag.

1. Install dependencies from the repo root: `bun install`
2. Start OpenCode:

   ```sh
   cd packages/opencode
   bun run dev
   ```

3. Ask the agent about a folder, for example:

   > Use directory_summary on packages/opencode/src/tool and explain what this folder does and what it depends on.

The tool takes one parameter:

| Parameter | Type                         | Description                                                                                 |
| --------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `path`    | string (required, non-empty) | The directory to summarize. Absolute, or relative to the directory OpenCode was started in. |

Example tool call: `{"path": "src/tool"}`

### How to manually test it

The `debug agent` command calls the tool directly, so you can check its output without a model or API key. Run these from `packages/opencode`:

```sh
bun run --conditions=browser ./src/index.ts debug agent build \
  --tool directory_summary --params '{"path":"src/tool"}' 2>/dev/null | jq -r .result.output
```

1. **Folder summary.** Run the command above. `relativePath` is `packages/opencode/src/tool`, `purpose` says it is a source module, and `files` lists about 40 files, with entry points, tests, and configuration labeled.
2. **Internal dependencies.** `relatedDirectories` starts with `packages/core/src` and `packages/opencode/src/effect`, each with an `imports` count and the importing files. `dependencies` includes `relative`, `alias` (`@/...`), and `workspace` (`@opencode-ai/core/...`) kinds. `unresolvedImports` is empty.
3. **External dependencies.** `externalPackages` includes `effect`, `diff`, and `jsonc-parser` (`package`) and `path` (`builtin`).
4. **Subpath imports.** Use `"path":"../core/src/database"`. `#sqlite` resolves to a file inside that folder, so it does not appear in `externalPackages`.
5. **Empty directory.** Run `mkdir src/tmp-empty`, then use `"path":"src/tmp-empty"`. `purpose` is `Empty directory; no purpose can be inferred.` and every list is empty. Remove the folder afterwards.
6. **Invalid and rejected paths.** Error messages show on the last lines of output, so drop `2>/dev/null | jq ...` for these:

| Try                           | Expected                                                           |
| ----------------------------- | ------------------------------------------------------------------ |
| `"path":"src/nope"`           | `Directory not found: .../src/nope`                                |
| `"path":"../../package.json"` | `Path is not a directory: .../package.json`                        |
| `"path":"/tmp"`               | `directory_summary path must be within the current workspace: ...` |
| `{}` (no `path`)              | `The directory_summary tool was called with invalid arguments ...` |

(`jq` only pretty-prints the output. Without it, look at the `output` field of the printed JSON.)

### Automated tests

Run from `packages/opencode`:

```sh
bun test test/tool/directory_summary.test.ts test/tool/parameters.test.ts test/tool/registry.test.ts
```

- `packages/opencode/test/tool/directory_summary.test.ts` (21 tests) builds small repositories in a temporary directory and runs the real tool on them. It checks:
  - **Valid input:** relative and absolute paths, the workspace root, file roles, important files, subdirectories, and deterministic output
  - **Empty, nonexistent, and wrong paths:** an empty directory, a missing path, a file instead of a directory, and malformed input (`{}`, `""`, a number, `null`), which is rejected before any permission request
  - **Dependency detection:** `./` and `../` imports, `@/` tsconfig aliases, `#name` subpath imports, and workspace packages, both when linked through `node_modules` and when found from package.json `workspaces` before `bun install`. It also checks conditional `exports`, npm packages, and built-ins
  - **Counts and duplicates:** repeated imports of one target are counted once per file, imports from several files are counted per folder, imports inside the folder are left out, and counts stay correct when the dependency list is capped at 200
  - **Parser correctness:** imports in line and block comments, strings, template literals, and JSX attributes are ignored. `import type` is ignored, as are JSX runtime imports that Bun adds on its own. `import`, `export ... from`, `require()`, and dynamic `import()` are detected, and unparseable files are reported in `skipped`
  - **Safety and permissions:** paths outside the workspace and symlinks that point outside it are rejected, an unreadable directory gives a clear error, unreadable files are skipped, a denied `read` permission stops the scan, `read` is requested for the directory, each source file, and `tsconfig.json`/`package.json`, and symlinked entries are skipped instead of followed
  - **Coverage limits:** oversized files, directories with more than 200 entries (purpose is still inferred from every entry), and the `truncated` flag
- `packages/opencode/test/tool/parameters.test.ts` (2 directory_summary tests) snapshots the JSON schema sent to the model and checks that `path` is required and non-empty.
- `packages/opencode/test/tool/registry.test.ts` ("exposes directory_summary") checks that the tool is registered.

### Why these tests are sufficient

- Each acceptance criterion in issue #9 has at least one test:

  | Criterion                                                | Tests                                       |
  | -------------------------------------------------------- | ------------------------------------------- |
  | Valid directory paths                                    | valid input                                 |
  | Important files and subdirectories                       | file roles, important files, subdirectories |
  | Purpose description                                      | purpose tests                               |
  | Dependencies on other parts of the repository            | dependency detection, counts                |
  | Structured output                                        | exact JSON fields                           |
  | Clear errors for nonexistent or inaccessible directories | error tests                                 |
  | Workspace permission checks                              | safety and permissions                      |

- The tests check exact results with `toEqual`, not just that something was returned. They run the real tool, with Bun's real parser, on real files and symlinks, so path resolution and permission checks run end to end. No mocks are used except the permission callback, which records or denies requests.
- Every bug fixed in Sprint 2 has a regression test that fails on the Sprint 1 code: `#name` imports listed as npm packages, phantom `react` imports from JSX files, workspace packages listed as external before `bun install`, purpose ignoring a `package.json` past the 200-entry limit, and `tsconfig.json` read without asking permission.
