# User Guide

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
