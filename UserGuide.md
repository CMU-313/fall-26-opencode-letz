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

- `test/tool/repository-overview.test.ts` contains 31 tests covering repository structure, important files, package metadata, package-manager detection, language and framework detection, workspace discovery, malformed workspace declarations, deterministic ordering, generated-directory and symlink exclusion, output bounds, and truncation behavior.
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
