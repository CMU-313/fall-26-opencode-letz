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
3. Start opencode with the flag set and ask the agent about a file, for example "Use file_relations on packages/opencode/src/tool/glob.ts":

   ```sh
   cd packages/opencode
   OPENCODE_EXPERIMENTAL_FILE_RELATIONS=true bun run dev
   ```

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
