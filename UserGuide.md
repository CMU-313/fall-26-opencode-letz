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

## Repository overview tool (Lynsey Li, issue #7)

### What it does

`repository_overview` gives a high-level summary of the current repository so users can quickly understand its structure and technologies without manually inspecting many files.

The overview includes:

- the repository root and repository name
- important top-level folders and files
- package metadata such as the package name and package manager
- detected programming languages and frameworks
- workspace/package information for monorepos
- truncation information when a repository is too large to summarize completely

The output is structured JSON and is bounded so that very large repositories do not generate excessively large results.

The feature is also available through the `/repository-overview` built-in slash command, which asks the agent to run the existing `repository_overview` tool for the current repository.

### How to use it

1. Install dependencies from the repository root:

   ```sh
   bun install
   ```
   
2. Start OpenCode:

   ```sh
   cd packages/opencode
   bun run dev
   ```
   
3. In OpenCode, run:

   ```text
   /repository-overview
   ```

The command takes no arguments and requests an overview of the repository associated with the current session.

### How to user test it

Start OpenCode from `packages/opencode`:

```sh
bun run dev
```

Then enter:

```text
/repository-overview
```

Verify that the command is available without arguments and produces a repository summary containing information such as the repository name, root, folders, important files, detected technologies, package metadata, and workspace information when applicable.

The underlying tool can also be tested directly:

```sh
bun run --conditions=browser ./src/index.ts debug agent build \
  --tool repository_overview --params '{}'
```

The result should contain structured JSON representing the current repository.


### Automated tests

Run from `packages/opencode`:

```sh
bun test test/tool/repository-overview.test.ts
bun test test/tool/registry.test.ts
bun test test/session/prompt.test.ts
```

- `test/tool/repository-overview.test.ts` contains 35 tests covering repository structure, important files, package metadata, package-manager detection, language and framework detection, workspace discovery, malformed workspace declarations, deterministic ordering, generated-directory and symlink exclusion, output bounds, and truncation behavior.
- `test/tool/registry.test.ts` verifies that `repository_overview` is registered as a built-in tool, can be executed through the registry, and returns the expected structured output.
- `test/session/prompt.test.ts` verifies that `/repository-overview` is discoverable as an argument-free built-in command and that invoking it successfully executes the existing `repository_overview` tool in the current session.

### Why these tests are sufficient

- The core tests cover the major repository information required by the feature, including repository structure, technologies, package metadata, and workspaces.
- Boundary tests verify that large repositories remain bounded while still returning valid structured output and reporting truncation.
- Negative cases verify that malformed metadata, unsafe workspace patterns, generated directories, symlinks, and weak technology evidence do not produce incorrect results.
- The registry test verifies that the tool is actually exposed and executable through OpenCode.
- The command tests verify the complete user-facing path from `/repository-overview` discovery through tool execution.
- Together, the tests cover both the repository-analysis logic and the user-facing integration required by issue #7.

### Known limitations

- The overview is intentionally high-level rather than a complete inventory of every repository file.
- Large collections, workspace searches, and text fields are bounded; when limits are reached, the result reports truncation instead of returning unlimited output.
- Technology detection relies on supported source-file extensions, package metadata, dependency names, and recognized build configuration files rather than analyzing arbitrary source text.
- Generated directories and symlink-based evidence are intentionally ignored to keep the overview focused on the repository's actual source structure.

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

## Progressive Debugging Hint Tool (Zdenek Rusek Kotva, Issue [#11](https://github.com/CMU-313/fall-26-opencode-letz/issues/11))

### What it does

`hint` is a built-in agent tool that guides a student through debugging a problem in stages instead of revealing the fix immediately. It is implemented as a tool rather than a slash command, so the agent decides to call it based on conversation context (for example, when a student asks for help debugging rather than an outright fix) instead of requiring the student to know and type a special command.

The hint progression is tracked per session and per problem text:

- **Hints 1–3**: Each call advances the hint level by one. The tool returns instructions that define what the model can explain at that stage and what it must withhold. This includes exact line numbers, literal values, whether a comment is a red herring, and the specific mechanism causing the failure. These restrictions are important because simply asking a model to provide a first-level hint is not enough. If the model has already investigated the bug, it may reveal the diagnosis too early.
- **After hint 3**: Further calls ask the model to explain the specific root cause and provide the fix, supported by evidence gathered during the investigation. This avoids generic, templated explanations.

The tool never edits or modifies the student's code. Its role is limited to returning guidance for the model to relay, helping students work toward the solution before seeing the full explanation.

### How to use it

The tool is always available to agents. You do not need a feature flag.

1. Install dependencies from the repository root:

   ```sh
   bun install
   ```
   
2. Start OpenCode:

   ```sh
   cd packages/opencode
   bun run dev
   ```
  
3. In an OpenCode session with a working bug to debug, describe it naturally and ask for help without asking for the fix outright. For example:

   > I'm getting a 401 from my login endpoint even with the right credentials. Can you help me think through it instead of just fixing it?

The OpenCode agent will call the `hint` tool based on the conversation context. You do not need to invoke the `hint` tool manually.

4. Request further guidance by asking about the same problem again. Keep the problem description consistent and stay in the same session so the `hint` tool can track your progress through the hint stages. You can simply ask, “Can I have another hint?” to advance to the next hint stage.

The `hint` tool guides you through four hint stages:

* **Hint 1/3 - general direction:** Identifies the likely category of the bug and an area to investigate.
* **Hint 2/3 - narrower guidance:** Points toward relevant inputs, comparisons, or state transitions.
* **Hint 3/3 - root-cause clues:** Identifies the most likely cause and the area where a minimal fix may be needed, based on the evidence gathered.
* **Solution:** On the next request, explains the specific root cause and the precise correction, grounded in the investigation.

### How to user test it

There are two ways to test the `hint` tool: run it directly without a model provider, or test the full hint progression in a live OpenCode session.

#### Option 1: Test a single hint without a model

The `debug agent` command invokes the tool directly, so you can inspect its output without connecting a model provider or using an API key.

From `packages/opencode`, run:

```sh
bun run --conditions=browser ./src/index.ts debug agent build --tool hint --params '{"problem":"Why does the login endpoint keep returning 401?"}'
```

The command returns a JSON response containing the tool name, input, result, and metadata. On the first call, expect a title of Hint 1/3 and an output field containing instructions that tell the agent how to guide the student without revealing the solution prematurely. The output is a directive for the agent to relay, not the hint shown to the student.

Each invocation starts a fresh session, so this command always returns hint level 1. It is useful for inspecting the initial response and its metadata, but it cannot demonstrate progression across hint levels.

#### Option 2: Test the hint full progression in a live session

This verifies that hints advance from level 1 through level 3 and then reveal the solution.

**1. Set up a model provider.**

Start OpenCode in development mode:

```sh
cd packages/opencode
bun run dev
```

The default free model returns "OpenCode's free tier can only be used from within OpenCode." So, in the OpenCode session, run `/connect` and configure a model provider. For example, you can create an [OpenRouter](https://openrouter.ai/) account, generate an API key, connect it to OpenCode, and select an available free model.

The default free model may return an error stating that OpenCode's free tier can only be used from within OpenCode when running a development build.

**2. Introduce a test bug.**

For example, in `packages/opencode/src/server/auth.ts`, temporarily change the username check in the authorization function from:

```ts
credentials.username === config.username
```

to:

```ts
credentials.username === "opencode"
```

This makes the username check use a hardcoded value instead of the configured username. Use this only as a temporary test change, and restore the original code when completed with user testing.

**3. Request hints in the same session.**

Start by describing the bug naturally without asking for the fix outright:

> I'm getting a 401 from my login endpoint even with the right credentials. Can you help me think through it instead of just fixing it?

Then ask for another hint repeatedly, for example:

> Can I have another hint?

Keep using the same session and problem description so the tool can track progression.

**4. Verify each stage.**

* **Hint 1/3 - general direction:** Identifies the likely category of the bug and an area to investigate.
* **Hint 2/3 - narrower guidance:** Points toward relevant inputs, comparisons, or state transitions.
* **Hint 3/3 - root-cause clues:** Identifies the most likely cause and the area where a minimal fix may be needed, based on the evidence gathered.
* **Solution:** On the next request, explains the specific root cause and the precise correction, grounded in the investigation.

Verify that the amount of guidance changes at each stage, becoming more specific until the solution is returned. Also verify that the tool itself does not modify the source file. Again, since you introduced the test bug manually, restore the original code after completing user testing.

### Automated tests

Run from `packages/opencode`:
```sh
bun test test/tool/hint.test.ts
bun test test/tool/registry.test.ts
```

- `test/tool/hint.test.ts` (4 tests):
  - **Full hint progression flow**: Verifies that a single session/problem advances through hints 1 → 2 → 3 → solution. Checks exact titles, distinct guidance text at each hint level, and that early hints do not reveal solution-only details. Also verifies that five additional calls after reaching the solution continue returning the solution without resetting or throwing errors.
  - **Hint progression isolation**: Verifies that different sessions and different problems within the same session maintain independent hint levels. Also tests that a `:`-delimiter collision between a session ID and problem text does not cause distinct progressions to share state.
  - **Edge-case problem strings**: Tests empty and whitespace-only strings, a 20,000-character string, quotes, punctuation, newlines, and Unicode. Verifies that these inputs are handled without errors and that near-duplicate strings differing only in case or leading whitespace are tracked as distinct problems.
  - **Deterministic state reads**: Verifies that repeated calls to the read-only `get` method without calling the `next` method does not advance hint progression, ensuring that reading state has no side effects.
- `test/tool/registry.test.ts` ("exposes and executes hint through the registry without modifying source files"): Verifies that `hint` is registered and exposed to agents through the actual `ToolRegistry`. Executes the tool twice through the registry to verify end-to-end progression, rather than testing only the underlying service. Also verifies that a fixture file on disk remains byte-for-byte unchanged after both calls.

### Why these tests are sufficient

The automated tests cover the core functional and state-management requirements of the progressive debugging hint tool described in Issue [#11](https://github.com/CMU-313/fall-26-opencode-letz/issues/11). Each acceptance criterion relevant to the tool's implemented behavior is covered by at least one automated test:

* **Implemented as an OpenCode tool:** `test/tool/registry.test.ts` verifies that the `hint` tool is registered, exposed through the actual `ToolRegistry`, and executable by an agent.

* **Provides an initial general hint:** `test/tool/hint.test.ts` verifies that the first invocation returns `Hint 1/3` with guidance directing the student toward the general category of the problem while withholding premature details.

* **Provides increasingly specific hints:** The full progression test verifies that successive calls return `Hint 1/3`, `Hint 2/3`, and `Hint 3/3`, with different guidance at each stage. It checks that the hints progress from general direction to specific inputs, comparisons, or state transitions, and finally to the likely root cause and minimal fix area.

* **Provides at least three hint levels before revealing the solution:** The full progression test verifies that the first three calls return hints without marking the solution as revealed, while the fourth call returns `Solution` and sets `revealed` to `true`.

* **Adds guidance instead of repeating previous hints:** The full progression test checks that consecutive hint outputs differ and contain the expected stage-specific instructions.

* **Continues progression for the same debugging problem:** The full progression test verifies that the hint level advances for repeated calls using the same session and exact problem text. The isolation test also verifies that different sessions and different problem descriptions maintain independent progression states.

* **Reveals the full solution after the available hints:** The full progression test checks that the solution response contains the expected solution-stage instructions and that subsequent calls continue returning the solution rather than resetting the progression.

* **Does not automatically modify the student's code:** `test/tool/registry.test.ts` creates a fixture source file, invokes the tool twice through the registry, and verifies that the file's contents remain unchanged. This confirms that the tested tool execution does not modify that source file.

* **Includes new unit tests for expected behavior:** `test/tool/hint.test.ts` covers progression, solution reveal, state isolation, edge-case problem strings, and read-only state access. `test/tool/registry.test.ts` additionally verifies registration, execution through the registry, and source-file preservation.

The tests also cover robustness beyond the main acceptance criteria. They verify that empty strings, whitespace, long inputs, punctuation, newlines, Unicode, and differences in capitalization or leading whitespace do not cause problems to be conflated. They also check that state reads are deterministic and do not advance the progression, and that repeated calls after revealing the solution remain stable. 

Together, these tests provide coverage of the tool's core behavior, progression state, integration with OpenCode's tool registry, and non-modification of source files. They test both the hint service and the registered tool, rather than relying solely on isolated implementation details.

### Known limitations

- Hint progression is tracked using the session ID and problem text. The tool does not determine whether differently worded questions describe the same underlying problem. As a result, substantially rephrasing a question may restart progression at hint 1, even when the student is still debugging the same issue. A possible follow-up is issue [#12](https://github.com/CMU-313/fall-26-opencode-letz/issues/12), which explores context-aware guidance.