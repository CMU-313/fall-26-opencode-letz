## Cross-team red team — Anna Lin (`annalin`), Team SegFault

Target: Tiffany Liu (`tiffany4`), Team LETZ — Directory Summary.

**Target commit:** `6b7881bc84ff20f0307e895cb14f369d30bf9839`

I studied `traceability/tiffany4.md`, `packages/opencode/src/tool/directory_summary.ts`, and `packages/opencode/test/tool/directory_summary.property.test.ts` at that commit.

**Committed patches:** [[mutants/annalin/redteam/](https://github.com/CMU-313/fall-26-opencode-seg-fault/tree/4ceabc0fb58dfc8e54814c93aed2a9524e274fca/mutants/annalin/redteam)](https://github.com/CMU-313/fall-26-opencode-seg-fault/tree/4ceabc0fb58dfc8e54814c93aed2a9524e274fca/mutants/annalin/redteam), SegFault commit `4ceabc0fb58dfc8e54814c93aed2a9524e274fca`.

Apply each patch independently to the target commit, without stacking them. All three patches were checked for clean application and reversal and parsed with Bun. I did not execute the full target property suite; survival predictions below are based on inspecting its generators and assertions.

### RT1 — P1: Ignore the configured alias base directory

**Requirement targeted:** P1 — report resolved imports outside the summarized directory with their target directory and resolution kind.

**Mutation:** An alias-resolution simplification drops `compilerOptions.baseUrl` and always anchors alias targets at the tsconfig directory.

For example, with `baseUrl: "src"`, `paths: {"@lib/*": ["lib/*"]}`, and `src/lib/value.ts` present, an import of `@lib/value` from `module/index.ts` becomes unresolved or resolves to a wrong root-level `lib/value.ts`.

**Expected property gap:** “P1 model/oracle: resolved dependency targets” generates a `paths` mapping but never a non-default `baseUrl`. Consequently, the mutated expression produces the same base directory for every generated fixture. P2/P3 exercise relative imports, P4 exercises external packages, and R2–R6 do not exercise configured aliases. Generating non-default base directories and root-level decoy targets would expose this bug.

```diff
--- a/packages/opencode/src/tool/directory_summary.ts
+++ b/packages/opencode/src/tool/directory_summary.ts
@@ -62,7 +62,7 @@
         Schema.decodeUnknownOption(TsConfig)(parse(text, [], { allowTrailingComma: true })),
       )?.compilerOptions
       // TypeScript resolves `paths` relative to `baseUrl`, or to the tsconfig directory when it is unset.
-      const base = path.resolve(path.dirname(config), options?.baseUrl ?? ".")
+      const base = path.resolve(path.dirname(config))
       return Object.entries(options?.paths ?? {})
         .map(([pattern, targets]): Alias => {
           const star = pattern.indexOf("*")
```

### RT2 — P2: Collapse distinct dependency targets sharing a filename

**Requirement targeted:** P2 — count each distinct `(source file, target)` once and aggregate counts and source files by related directory.

**Mutation:** A developer shortens the dependency-map key to the target’s basename instead of its full path.

For example, `module/index.ts` imports both `../lib/a/value` and `../lib/b/value`, resolving to distinct `value.ts` files. The mutant drops the second edge, incorrectly reporting one dependency instead of two and omitting one related-directory contribution.

**Expected property gap:** “P2 metamorphic: duplicate imports preserve frequency” generates targets named `lib/item{id}.ts` with unique IDs. Distinct targets therefore always have distinct basenames. P1 also uses unique `item{id}.ts` basenames, P3 has only one outward target, and P4 has no repository edges. P2’s alternate specifiers for the same target still deduplicate correctly. Generating distinct target directories containing the same filename would expose the collision.

```diff
--- a/packages/opencode/src/tool/directory_summary.ts
+++ b/packages/opencode/src/tool/directory_summary.ts
@@ -319,7 +319,7 @@
               }
               // Imports that stay inside the summarized directory, including its subdirectories, are internal structure.
               if (FSUtil.contains(directory, resolved.target)) continue
-              const key = `${file.name}\0${resolved.target}`
+              const key = `${file.name}\0${path.basename(resolved.target)}`
               if (dependencies.has(key)) continue
               dependencies.set(key, {
                 file: file.name,
```

### RT3 — R4: Lose parent folders in missing-directory errors

**Requirement targeted:** R4 — fail requests for missing or deleted directories with an explicit `Directory not found` error identifying the absolute requested path.

**Mutation:** An error-formatting refactor reconstructs the path from the working directory and the missing directory’s basename, discarding intermediate folders.

For example, requesting `parent/gone` under `/workspace` reports `Directory not found: /workspace/gone` instead of `Directory not found: /workspace/parent/gone`. The request still fails, but identifies the wrong path. This affects both never-created and deleted nested directories.

**Expected property gap:** “R4 invariant: missing and deleted directories have explicit errors” generates only top-level names such as `missing123` under `instance.directory`. Reconstructing those paths from their basenames gives exactly the expected result. The other properties request existing directories and do not execute this branch. Generating nested missing and deleted directories and checking the full requested absolute path would expose the bug.

```diff
--- a/packages/opencode/src/tool/directory_summary.ts
+++ b/packages/opencode/src/tool/directory_summary.ts
@@ -103,7 +103,7 @@
             Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
             Effect.catch(inaccessible),
           )
-          if (!stat) return yield* Effect.fail(new Error(`Directory not found: ${directory}`))
+          if (!stat) return yield* Effect.fail(new Error(`Directory not found: ${path.join(instance.directory, path.basename(directory))}`))
           if (stat.type !== "Directory") return yield* Effect.fail(new Error(`Path is not a directory: ${directory}`))
 
           const entries = (yield* fs.readDirectoryEntries(directory).pipe(Effect.catch(inaccessible))).toSorted(
```