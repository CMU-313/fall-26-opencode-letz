# Traceability: Tiffany Liu (tiffany4)

**Target feature:** directory_summary (`packages/opencode/src/tool/directory_summary.ts` and relevant supporting files)

## Requirements

The original table and interview excerpts below were supplied by Tiffany in this session. The underlying interview transcripts were not available in the repository; the excerpts are preserved as supplied, not independently authenticated. R1 was explicitly labeled an example in that table and concerns command permissions rather than this feature. All six supplied rows are retained. Supporting P1–P4 requirements come from `UserGuide.md` and `directory_summary.txt`, not interview quotations.

| ID           | Interview evidence                                                                                                        | Requirement                                                                                                                                                                                       | Acceptance Criteria                                                                                                                                                                                                                                                    | Changed in P4?                | Property (kind)                                   | Test                                                                                                          | Mutants it kills |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --- |
| R1 (example) | C-12, S-4: "I'd be furious if it ran rm -rf after I said deny"                                                            | When a command matches several rules, the last matching rule in the config decides the outcome.                                                                                                   | With rules `{"*": "allow", "rm *": "deny"}`, `rm -rf /` evaluates to deny and `ls -la` evaluates to allow.                                                                                                                                                             | No                            | Outside directory_summary scope; retained example | No new property; command permission behavior is outside this assignment feature.                              | N/A — outside feature scope |
| R2           | S-2: "If the tool is unsure about something, it should tell the user that it is unsure."                                  | Mark inferred purpose as tentative and explicitly state when no specific purpose can be inferred.                                                                                                 | Source and package-root fixtures begin with "Likely"; empty and unknown-file directories explicitly say no purpose or no more specific purpose can be inferred. No README semantic inference is promised.                                                              | Yes                           | R2 (invariant)                                    | `directory_summary.property.test.ts`: R2 invariant: purpose communicates uncertainty                          | H1; S141, S147, S153, S167 |
| R3           | S-2: "It should be enough to understand the folder's purpose in one or two sentences."                                    | Return a filename-based purpose overview in one or two sentences, separate from detailed file and dependency lists.                                                                               | The purpose is nonempty, at most 200 characters, and one or two sentences for generated empty, source, and package-root fixtures; its category matches the fixture. JSON detail lists are separate from purpose.                                                       | Yes                           | R3 (invariant)                                    | `directory_summary.property.test.ts`: R3 invariant: purpose is a concise overview                             | H1 |
| R4           | C-2, S-3: "The tool should tell the user that the file does not exist or that it has been deleted."                       | Fail a summary request for a missing or deleted directory with an explicit Directory not found error identifying its path.                                                                        | Both never-created and created-then-deleted directory requests fail with `Directory not found:` and the absolute requested path; no successful summary is returned.                                                                                                    | Yes                           | R4 (invariant)                                    | `directory_summary.property.test.ts`: R4 invariant: missing and deleted directories have explicit errors      | H2; RT3 |
| R5           | C-3: "I would expect the initial summary to have the file included, and the later summary to not have the file included." | Recompute the immediate file listing on every call so added files appear and removed files disappear.                                                                                             | Summarize original files, add disjoint files and summarize again, then delete originals and summarize again: all three immediate file sets match the filesystem exactly, including empty sets.                                                                         | Yes                           | R5 (metamorphic)                                  | `directory_summary.property.test.ts`: R5 metamorphic: additions and deletions refresh the file listing        | S10 |
| R6           | C-4, S-4: "Everything should remain the same except for the name."                                                        | For a directory rename that preserves its filename-based purpose category and entry-point naming relationships, preserve purpose and file roles; update reported paths to the new directory name. | Rename `utils` to `helpers` with identical `index.ts` and `util.ts` files and unchanged import topology: purpose and file roles stay equal while `relativePath` and absolute `path` change. Renames to category names such as `tests` may change the inferred purpose. | Yes                           | R6 (metamorphic)                                  | `directory_summary.property.test.ts`: R6 metamorphic: comparable directory renames preserve purpose and roles | Not measured against H1–H5 |
| P1           | Specification: UserGuide.md, Folder dependencies; no interview attribution                                                | Report resolved imports outside the summarized directory with their target directory and resolution kind.                                                                                         | Generated relative and tsconfig-alias targets across nested sibling folders produce exactly the expected target, directory, source, specifier and kind; no external or unresolved imports.                                                                             | No (supporting specification) | P1 (model/oracle)                                 | `directory_summary.property.test.ts`: P1 model/oracle: resolved dependency targets                            | H3; S35, S41, S46; RT1 |
| P2           | Specification: UserGuide.md, Dependency frequency; no interview attribution                                               | Count each distinct (source file, target) once and aggregate counts and source files by related directory.                                                                                        | Repeating/reversing imports and adding alternate specifiers preserves dependency records and counts; a directory with T targets used by F files has T×F edges and F unique source files.                                                                               | No (supporting specification) | P2 (metamorphic)                                  | `directory_summary.property.test.ts`: P2 metamorphic: duplicate imports preserve frequency                    | H4; RT2 |
| P3           | Specification: UserGuide.md, Scope and safety; no interview attribution                                                   | Exclude imports within the summarized directory and do not scan nested source files.                                                                                                              | Adding internal imports at depths 1–4 and nested files with external imports leaves outward edges unchanged; a similarly named sibling still appears as a dependency.                                                                                                  | No (supporting specification) | P3 (metamorphic)                                  | `directory_summary.property.test.ts`: P3 metamorphic: internal and nested files preserve outward dependencies | H5 |
| P4           | Specification: UserGuide.md, External dependencies; no interview attribution                                              | Report third-party packages and runtime builtins separately from repository dependencies, with unique importing files.                                                                            | Generated scoped/unscoped subpaths and node/bun builtin imports have exact package names, kinds and unique source lists; repository and unresolved lists remain empty.                                                                                                 | No (supporting specification) | P4 (model/oracle)                                 | `directory_summary.property.test.ts`: P4 model/oracle: external package and builtin classification            | Not measured against H1–H5 |

All test filenames above are under `packages/opencode/test/tool/`.

Properties written or suggested by opencode or another AI tool: **R2, R3, R4, R5, R6, P1, P2, P3, P4**. Requirement revisions and this document were also AI-assisted.

## Requirement changes

| ID  | Original requirement (P3)                                                                                                                                                                                     | Revised requirement                                                                                                                                                                               | Why it changed                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2  | The tool should not give incorrect information and should tell the user when it is unsure. Original acceptance: With a README describing authentication, the summary identifies the folder as authentication. | Mark inferred purpose as tentative and explicitly state when no specific purpose can be inferred.                                                                                                 | Arbitrary semantic correctness cannot be guaranteed by a filename heuristic; the tool does not read README contents for meaning. Preserve S-2's need to communicate uncertainty with objectively checkable wording.                                                                                     |
| R3  | The tool should give a short summary that explains what the directory does without too much detail. Original acceptance: With an account management folder, the summary does not describe payment processing. | Return a filename-based purpose overview in one or two sentences, separate from detailed file and dependency lists.                                                                               | "Too much detail" lacks a measurable limit and the original acceptance assumes semantic analysis. Preserve S-2's one-or-two-sentence request and state the actual inference scope.                                                                                                                      |
| R4  | The tool should tell the user when a directory does not exist instead of crashing. Original acceptance: With a folder containing 10 files, the overview is 1–2 sentences.                                     | Fail a summary request for a missing or deleted directory with an explicit Directory not found error identifying its path.                                                                        | The original acceptance tests brevity, not missing-directory handling. A controlled tool failure is appropriate; "instead of crashing" needs a precise observable error contract.                                                                                                                       |
| R5  | The summary should update when files are added or removed from a directory. Original acceptance: With a deleted src/utils directory, the tool displays a missing directory error.                             | Recompute the immediate file listing on every call so added files appear and removed files disappear.                                                                                             | Original acceptance duplicates R4 and does not test C-3's before/after file membership. Clarify immediate listing and per-call freshness without promising background updates.                                                                                                                          |
| R6  | The tool should preserve functionality descriptions after renaming. Original acceptance: With utils renamed to helpers, only the directory name changes in the summary.                                       | For a directory rename that preserves its filename-based purpose category and entry-point naming relationships, preserve purpose and file roles; update reported paths to the new directory name. | Unconditional rename invariance conflicts with name-based heuristics (`docs`, `tests`, matching entry filenames), and full output includes absolute/relative paths and dependency paths. Restrict invariance to comparable names and unchanged import topology while preserving the intended stability. |

R1 is feasible and objectively testable as supplied, with no conflict in its permission domain; it remains unchanged and explicitly outside this feature. Revised R2–R6 are feasible and mutually consistent: they distinguish tentative categorization, concise output, missing paths, refresh behavior, and qualified rename stability. Each now has observable criteria while retaining the original evidence. P1–P4 preserve existing specification rules without revising the interview requirements.

## Execution and triage

Every property runs 100 cases with seed 17313, using the actual tool, Bun parser, filesystem and a fresh scoped workspace. fast-check reports the shrunk counterexample and replay path on failure. No new property is skipped or disabled.

During initial development in the personal fork, fixture errors were corrected without weakening assertions: `provideTmpdirInstance` requires reading `requireInstance` rather than the convenience `TestInstance` service; removing a directory requires `{ recursive: true }`. No production bug was demonstrated by these properties.

## Shared dependency setup

The team dependency PR [#18](https://github.com/CMU-313/fall-26-opencode-letz/pull/18) merged fast-check 4.10.2 in commit `927f13b2c5e270f7736606c1627e38b912e94ec8`. This branch starts from team `main` after that merge and uses the shared dependency unchanged. No package.json or lockfile change is included in this PR.

## Automated execution

`TESTING.md` and `turbo.json` wire `opencode#test` into the `test` workflow on pushes and pull requests. The package runner discovers this property test file. A dedicated `Run directory_summary properties` step additionally runs it without `--only-failures` so successful property names appear in logs. It allows five minutes with sixty seconds per property to accommodate hosted filesystem overhead while retaining all 100 cases per property.

The e2e job is pinned to Ubuntu 24.04: the personal-fork trial demonstrated that the moving `ubuntu-latest` runner used Ubuntu 26.04, unsupported by this Playwright version. Team main already provides a fifteen-minute unit-test budget, retained here.

## Repository and PR scope

The correct assignment repository is **CMU-313/fall-26-opencode-letz**, targeting `main`. This branch includes the shared dependency setup and the team's merged Project 3 implementation, including directory_summary PR #15. It preserves teammates' features and process-test fixes. The earlier personal-fork implementation and its original Project 3 commits remain preserved on local `properties-backup` and the personal fork's remote branch; they are not transplanted over team history.

The personal-fork PR and its CI evidence are superseded by the team PR. Only team-branch test results and team commit permalinks should be used for the final submission. Keep the team PR unmerged for Project 5.

## Team-branch local verification

From `packages/opencode`:

- `bun test --timeout 60000 test/tool/directory_summary.property.test.ts test/tool/directory_summary.test.ts test/tool/parameters.test.ts test/tool/registry.test.ts`: **110 passed, 0 failed**, 17 snapshots, 5893 assertions (59.69 seconds). Includes all nine properties, 100 generated cases each, against the team's current production implementation and fast-check 4.10.2.
- `bun typecheck`: **passed**.

No production source, dependency manifest, or lockfile changes are included. The focused tests use the team's existing implementation and all teammate features remain intact.

## Hand-written mutants

Executed November 12, 2026, on `tiffany4/properties` against commit `6b7881bc84ff20f0307e895cb14f369d30bf9839`. All five patches independently modify only `packages/opencode/src/tool/directory_summary.ts`; none is applied in the final implementation. No property or production source changes remain.

[Original pre-execution predictions](../mutants/tiffany4/predictions.md) are preserved byte-for-byte. That document intentionally retains its earlier “NOT RUN” entries as a historical prediction record; measured outcomes are recorded here and in [results.json](../mutants/tiffany4/results.json). Its SHA-256 is `248a03912f4a4df0dc6c6b58ac48792a356b0d1a36e35404c4d9e30bc5d4dd78`.

| ID | Requirement targeted | Change and plausible mistake | Predicted killer | Actual result |
| --- | --- | --- | --- | --- |
| [H1](../mutants/tiffany4/H1.patch) | R2: tentative inferred purpose | Remove “Likely” from the source-module purpose, as an editorial simplification that removes uncertainty. | R2 uncertainty assertion; also R3's exact purpose assertion. | **Killed** by `R2 invariant: purpose communicates uncertainty` and `R3 invariant: purpose is a concise overview`. Two assertion failures; exit 1. [Log](../mutants/tiffany4/logs/H1.log). |
| [H2](../mutants/tiffany4/H2.patch) | R4: explicit missing-directory error | Reuse `inaccessible()` for a missing stat, conflating not-found and access errors. | R4's required error text and absolute path. | **Killed** by `R4 invariant: missing and deleted directories have explicit errors`. The call fails, but the message says “Directory is not accessible” instead of “Directory not found”. One assertion failure; exit 1. [Log](../mutants/tiffany4/logs/H2.log). |
| [H3](../mutants/tiffany4/H3.patch) | P1: correct dependency resolution kind | Copy `kind: "relative"` into the alias success branch, retaining the correct target but misclassifying its origin. | P1's exact edge comparison for nonempty alias fixtures. | **Killed** by `P1 model/oracle: resolved dependency targets`. Expected `alias`, received `relative`. One assertion failure; exit 1. [Log](../mutants/tiffany4/logs/H3.log). |
| [H4](../mutants/tiffany4/H4.patch) | P2: one edge per distinct source/target pair | Use only the target as the map key, merging distinct source-file edges during deduplication. | P2's edge count for multiple importing files. | **Killed** by `P2 metamorphic: duplicate imports preserve frequency`. Expected two edges, received one. One assertion failure; exit 1. [Log](../mutants/tiffany4/logs/H4.log). |
| [H5](../mutants/tiffany4/H5.patch) | P3: internal-directory exclusion with sibling boundaries | Replace path containment with `startsWith`, mistaking a similarly prefixed sibling for a descendant. | P3's initial `module-other` dependency assertion. | **Killed** by `P3 metamorphic: internal and nested files preserve outward dependencies`. Expected `["module-other"]`, received `[]`. One assertion failure; exit 1. [Log](../mutants/tiffany4/logs/H5.log). |

All five original predictions were confirmed. There were no survivors in these focused runs and no compilation, setup, or timeout failures counted as kills. The main table lists only observed kills; “Not measured” does not claim that a property could not kill one of these mutants.

### Counterexamples and replay information

The unchanged properties use seed **17313**, with up to 100 cases each. A failing property stops and shrinks its counterexample, so mutant runs do not necessarily execute all 100 cases.

| Mutant / property | Shrunk counterexample (fast-check argument array) | Replay path |
| --- | --- | --- |
| H1 / R2 | `["source"]` | `0` |
| H1 / R3 | `[[[0],false]]` | `0:1:0:1` |
| H2 / R4 | `[[0,false]]` | `0:0:0` |
| H3 / P1 | `[[[0],"ts",true]]` | `1:1:1:1` |
| H4 / P2 | `[[[0],2]]` | `1:1:1` |
| H5 / P3 | `[[[],1]]` | `0:0` |

### Execution and restoration verification

All commands ran from `packages/opencode`, using Bun 1.3.14. Per-test timeout: 60 seconds; outer command bound: 180 seconds. No timeout was reached. Each patch was generated from the same original source, checked with `git apply --check`, applied alone, tested, and removed before the next mutant. The original source bytes were restored even on test failure. Every patch passed another independent application check after restoration.

Baseline and final restored command:

```sh
bun test --timeout 60000 test/tool/directory_summary.property.test.ts
```

- [Baseline](../mutants/tiffany4/logs/baseline.log): **9 passed, 0 failed**, 5700 assertions, 12.76 seconds reported by Bun.
- [Final restored suite](../mutants/tiffany4/logs/restored.log): **9 passed, 0 failed**, 5700 assertions, 14.35 seconds reported by Bun.
- Both complete runs exercised all nine original properties, 100 generated cases each; no property changes were needed.
- Mutant commands use that same file with `--test-name-pattern`: H1 `R[23] invariant:`, H2 `R4 invariant:`, H3 `P1 model/oracle:`, H4 `P2 metamorphic:`, H5 `P3 metamorphic:`. Exact commands, exit statuses, and elapsed wall times are saved in `results.json` and each log.
- Source SHA-256 before and after: `764912d5822b1a11cf16ce78e74d0f045173176616637b2ddd39edcec046266e`. `git diff` confirms no remaining changes to the source or original property file.

The remote team `main` was observed at `0d50fc61e20c38fc5fe1ca5b4031f2ebbea5fdfd`, different from the branch's recorded base. This focused mutation experiment preserved the exact predicted/studied version instead of mixing in unrelated upstream changes. Synchronizing and revalidating against team `main` remains an integration task before final submission. Nothing was committed or pushed in this phase.

## Stryker comparison

### Initial run and reproducibility

This is the initial measurement against the original nine properties; no property strengthening has been performed in this step. The feature implementation remains at `6b7881bc84ff20f0307e895cb14f369d30bf9839`. The fixed fast-check seed is **17313**, with 100 cases per property unless a failure ends the run early.

The team already added `@stryker-mutator/core` **10.1.1** in dependency commit `b27ae52` on team `main`. This working branch did not contain it, so the same exact version was installed locally with `bun add --dev --exact @stryker-mutator/core@10.1.1`, updating only the package manifest and lockfile for dependency setup. fast-check remains 4.10.2. No new dependency PR or commit was created. Team-main synchronization remains a later integration task; these results describe the preserved feature version, not a merged upstream branch.

Configuration: [stryker.tiffany4.config.json](../packages/opencode/stryker.tiffany4.config.json). Command runner, coverage analysis off, HTML/clear-text/progress plus JSON reporters, four workers. The command is only `bun test --timeout 60000 --bail test/tool/directory_summary.property.test.ts`; no existing example tests or repository-wide suite participate. `--bail` stops after an actual failure and does not reduce the 100 cases of a passing property. Stryker represents the command as one synthetic “All tests” test, although Bun executes the nine properties.

Mutation is restricted to `src/tool/directory_summary.ts` ranges 106–107 (missing/type errors), 109–117 (fresh listings), 218 and 220–235 (relative/alias classification and matching), 248–255 (external/builtin classification), 321–330 (internal exclusion and source/target deduplication), 387–394 (directory aggregation), and 410–424 (purpose inference). This is a scoped score, not a score for every branch of the whole feature. Workspace exports, import parsing, permission checks, scan caps, and other helpers are not mutated in this run.

Execution, from `packages/opencode`:

```sh
bunx stryker run stryker.tiffany4.config.json
```

One run completed successfully in **15 minutes 59 seconds**, under a 25-minute outer bound. The initial dry run passed in about 15 seconds. Per-mutant timeout allowance was twice dry-run duration plus 60 seconds; the dry-run bound was three minutes. No timeout was reached and no restart/rerun was needed. The progress reporter fell back to append-only output because the captured console is not interactive; this did not affect results. Sandboxes were retained for possible diagnosis and are ignored by Git. Production source was never mutated in place.

| Initial result | Count |
| --- | ---: |
| Generated/tested | **176** |
| Killed | **100** |
| Survived | **76** |
| Timed out | **0** |
| No coverage | **0** |
| Compile errors / runtime errors / ignored | **0 / 0 / 0** |
| Initial mutation score | **56.82%** |

The raw score is `100 / 176 × 100`. Coverage analysis is disabled, so “No coverage = 0” does not prove every mutant is exercised: unexercised mutations can appear as survivors. All 100 killed-mutant status reasons contain property-failure/assertion evidence; compilation and infrastructure failures were not counted as kills.

Artifacts: [HTML report](../mutants/tiffany4/mutation.html), [raw JSON report](../mutants/tiffany4/mutation.json), [summary/counts](../mutants/tiffany4/stryker-summary.json), [execution metadata](../mutants/tiffany4/stryker-execution.json), [full run log](../mutants/tiffany4/stryker-initial.log), and [all 76 survivors with exact replacements](../mutants/tiffany4/stryker-survivors.md). The HTML and JSON were copied from Stryker's generated reports, not synthesized. `reports/` and `.stryker-tmp/` are now ignored in `packages/opencode/.gitignore`.

### What the hand-written and automatic mutants found

None of H1–H5's exact edits was generated in this scoped Stryker run:

| Hand-written mutant | Comparison with generated mutations |
| --- | --- |
| H1: remove only “Likely” from the source-purpose sentence | Stryker's string mutation 158 empties the whole sentence; it does not perform that editorial rewrite. Both expose purpose assertions, but H1 models a plausible wording edit. |
| H2: route missing paths through `inaccessible()` | Stryker changes the missing-stat condition (0–2) or empties the diagnostic (3); it does not select another existing error helper. |
| H3: label aliases `relative` | Stryker empties the alias kind (54) or object (52), rather than choosing the competing valid classification. |
| H4: deduplicate by target alone | Stryker empties the complete key template (89), rather than dropping only the source component. H4 specifically models undercounting shared imports. |
| H5: replace containment with a prefix check | Stryker makes the containment condition constant (87–88); it does not replace the helper with the semantically weaker `startsWith` call. |

All five human-designed bugs were killed, while automation revealed **76 survivors** across nearby branches, boundaries, and output fields. The hand-written edits model domain-specific mistakes that generic operators do not construct. Automatic mutations explore many small conditions that those five designs did not challenge, exposing generator and oracle limitations. A high hand-written kill rate therefore did not establish comprehensive property coverage.

### Surviving mutants needing attention in Step 4

The full inventory is linked above. The following grouping identifies concrete examples and separates requirement gaps from contract/equivalence questions. These are source-and-property analyses of observed survivors; new witness properties have not yet been run.

| Area and representative IDs | Why they survived / proposed property work |
| --- | --- |
| Mixed directory entries: **10, 12, 18–24** | R5 generates only ordinary files. R6 compares two snapshots without independently checking roles. P3 creates nested directories but checks outward imports, not the returned file/subdirectory partition. Removing a file-only filter can therefore put directories into `files`. Generate mixed immediate files and directories and assert exact separate memberships. This is a plausible R5 listing bug. |
| Alias matching: **29, 31–33, 35–37, 39–42, 46–47, 50** | P1 uses matching `@lib/*` aliases with an empty suffix and existing targets. It misses unmatched prefixes, nonempty suffixes, exact aliases, empty captures, and missing-target fallback. For example, 35 replaces suffix matching with prefix matching, and 46 changes suffix subtraction to addition. Extend generators and the oracle around those cases; these are plausible P1 resolver mistakes. |
| Bun submodules: **62** | P4 includes bare `bun`, but no `bun:*` imports. Changing `startsWith("bun:")` to `endsWith("bun:")` can misclassify `bun:test` as a package. Include builtin submodules and assert their classification. Review 64 and 66 separately because bare `bun` may still be recognized by the builtin-module fallback. |
| Purpose categories and thresholds: **120, 122, 124, 128–132, 137–141, 143–147, 149–153** | R2 generates source/package/unknown/empty cases; R3 generates sources and an optional manifest; R6 uses utils/helpers. No fixture reaches test-majority boundaries or docs/scripts category names. Empty test/docs/script purpose strings (141, 147, 153) survive even though they violate R2's uncertainty requirement. Mutant 138 changes `tests * 2 >= code` to `>`: a plausible boundary bug. Add generated category names, case variants, near-miss names, and test/source ratios; preserve the qualified R6 rename contract. |
| Directories containing only subdirectories: **160–175** | The properties do not exercise the grouping-purpose branch. Empty purpose (167), removed five-item cap (168), and changed ellipsis boundaries (170–175) survive. Generate subdirectory-only directories, including 0/1/5/6 entries, and assert the relevant uncertainty/conciseness contract. Clarify which cap details are requirements before adding assertions. |
| Aggregation ordering: **100–104** | P2 aggregates into a single `lib` directory, while P1 checks edges rather than aggregate ordering. Generate several target directories with unequal and equal counts. The current P2 wording guarantees counts and sources, not a sort order, so distinguish a missing contract from a missing assertion before declaring these requirement violations. |
| File-path errors and workspace classification: **5, 8, 82** | R4 tests missing/deleted directories, not existing file paths; disabling the file-type guard or blanking its diagnostic survives. P1 fixtures do not use workspace packages, so always treating them as external (82) survives. These extend beyond the specific current property fixtures/acceptance examples; review requirement scope before strengthening. |

The most surprising gap is that **empty purpose strings for named categories survive**, despite a property explicitly checking concise nonempty purpose. Its generator never visits those categories. Another is the mixed-entry filter removal: nested directories exist in a dependency property, but that property's oracle never checks the file listing. Both are useful candidates for a future agent-failure analysis, but the actual original agent transcript and strengthened-property evidence are still required; this step does not fabricate either.

### Equivalence triage and remaining work

Mutants **26 and 53** replace the internal `type: "dependency"` discriminator with an empty string for relative and alias resolution. The only consumer distinguishes `unresolved` and `external`, then treats every other value as a dependency; the discriminator is neither returned in summary JSON nor used by another consumer. Thus these two replacements follow the same observable execution path as the original in this implementation, and should not be “killed” by asserting an unobservable internal value.

The initial raw score remains **56.82%**. Excluding only these two analytically equivalent mutants gives a **provisional 57.47%** (`100 / 174`); this is not a final equivalence-adjusted score because the other survivors have not all been reviewed. Step 4 must strengthen properties for genuine gaps, investigate remaining equivalence/contract questions, rerun the scoped configuration, and record final raw and adjusted scores. Use property improvements, not example-based tests.

### Final verification

After Stryker completed, the unchanged original property suite was run from `packages/opencode`:

```sh
bun test --timeout 60000 test/tool/directory_summary.property.test.ts
```

**9 passed, 0 failed**, 5700 assertions, 16.16 seconds; [saved log](../mutants/tiffany4/logs/stryker-restored.log). All nine retain seed 17313 and 100 cases. Hash checks confirmed the production source, original property file, original predictions, five patches, and every pre-existing Step 2 artifact remain unchanged. The Step 2 traceability content remains intact above. No commit or push was performed.

## Property strengthening and focused verification

All nine original property names and seed **17313** remain. P1 now generates default/non-default `baseUrl`, root-level decoys, exact aliases and suffix aliases in addition to relative imports. P2 retains its original same-directory target cases and adds distinct directories containing the same basename; its count, unique-source and metamorphic duplicate-import assertions remain. P4 adds `bun:test`. R2 now includes named tests/docs/scripts and subdirectory-only folders; R4 includes nested missing/deleted paths; R5 mixes immediate files and subdirectories and asserts their separate membership. R3, P3 and R6 were not weakened or removed.

A bounded, focused reproduction applied individual replacements from the original Stryker JSON, not another full 176-mutant run. Each patch was checked and applied alone to the unchanged source, followed by the responsible generated property, then restored. [Machine-readable results](../mutants/tiffany4/strengthening-results.json), [independent survivor patches](../mutants/tiffany4/survivor-patches/), and individual logs preserve the actual outcomes.

| Initial Stryker ID | Improved property | Measured result |
| --- | --- | --- |
| 10 | R5 mixed files/directories | Killed by assertion |
| 35, 41, 46 | P1 alias suffix/exact matching | Each killed by assertion |
| 62 | P4 builtin submodules | Survived |
| 141, 147, 153, 167 | R2 purpose categories/grouping | Each killed by assertion |

Eight of nine selected survivors are now killed; this is **not a full mutation score**. Mutant 62 still passes because Bun 1.3.14 includes `bun:test` in `builtinModules`, so a later fallback recognizes the generated case despite the changed prefix check. That does not prove equivalence for every arbitrary `bun:*` string; it remains a contract/equivalence review item. All other unrerun survivors remain unverified after strengthening. **No final full Stryker score was measured.** The initial raw score remains 56.82%; the earlier 57.47% figure excludes only the two analyzed initial equivalents, not a new strengthened-suite measurement.

## Agent failure case

### Genuine provenance and disclosed adaptations

No original `directory_summary` property transcript was found in either local OpenCode session database. Accordingly, the assignment's alternative was used: ask OpenCode to propose an R2 property now, preserve the actual prompt/response, and test it. The first `opencode/big-pickle` attempt produced no text within 90 seconds; that unsuccessful attempt is retained in [agent-response.jsonl](../mutants/tiffany4/agent-response.jsonl) and is not treated as evidence of a generated property.

A second bounded request using **OpenCode 1.18.31**, model **opencode/glm-5.3-flash-free**, completed successfully. Actual session ID: `ses_e2cd12755ffeRs2tKuXHHYy8MK`. The exact [prompt](../mutants/tiffany4/agent-prompt.txt), [raw event transcript](../mutants/tiffany4/agent-response-fast.jsonl), and [rendered response](../mutants/tiffany4/agent-response.md) are preserved. No public share link was created.

Actual prompt excerpt:

> For CMU 313 Project 5, suggest one concise fast-check property for the OpenCode directory_summary tool's requirement R2: "Mark inferred purpose as tentative and explicitly state when no specific purpose can be inferred."

The prompt explicitly explained that `summarize()` executes the tool for **module**. Actual response excerpt:

```ts
yield* write(Object.fromEntries(gen.files.map((file) => [`${gen.dir}/${file.name}`, file.content])))
const result = yield* summarize()
if (gen.expect === "none") {
  expect(result.purpose).toMatch(/no specific|cannot|unclear|unknown|no clear|not inferred/i)
} else {
  expect(result.purpose).toMatch(/tentative|inferred|likely|appears|probably|possibly|may\b/i)
}
```

The generated code used `fc.hexaString`, unavailable in fast-check 4.10.2, and its unknown-purpose regex omitted the implementation's actual “no purpose can be inferred” wording. Before measuring survival, these baseline problems were corrected explicitly: equivalent hex-string generators use `fc.stringMatching`, and the unknown-purpose regex accepts that actual wording. The original response remains untouched; the exact adapted runnable property is archived as [agent-property-before.ts.txt](../mutants/tiffany4/agent-property-before.ts.txt). The fixture-path mistake and permissive “inferred” alternative were preserved so the test still represents the agent's proposed generator/oracle. Neither a compilation error nor a failing baseline is claimed as survival.

### Weakness, survivor, and improved property

The agent wrote generated files under `gen.dir`, but called the helper that always summarizes the empty `module` directory. Its tentative regex also accepts the word “inferred” inside the negative sentence “no purpose can be inferred”; consequently, it can accept the empty-directory fallback without ever exercising a named category. This is both a fixture-selection bug and a weak oracle.

Measured evidence:

- Adapted agent property on original source: **1 passed, 0 failed**, [baseline log](../mutants/tiffany4/logs/agent-baseline.log).
- The same property with Stryker mutant **147** (docs-purpose string replaced with `""`): **1 passed, 0 failed — survived**, [mutant log](../mutants/tiffany4/logs/agent-S147.log).
- Improved existing R2 property with the same independent mutant: **killed by a property assertion**, [log](../mutants/tiffany4/logs/S147-strengthened.log).
- Improved R2 now generates named category directories, passes the actual directory to `summarize(directory)`, and demands `^Likely ` for inferred categories instead of accepting the substring “inferred”. The real implementation passes all nine strengthened properties.

The temporary agent-property test was removed after verification; its historical source and logs remain as artifacts. No source mutation is left applied. This failure case uses a real newly obtained OpenCode response rather than attributing the earlier Project 4 tests to OpenCode without evidence.

## Red team

### Received attack and defense

My feature was claimed by **Anna Lin (`annalin`), Team SegFault**, as demonstrated by her [PR #22 attack comment](https://github.com/CMU-313/fall-26-opencode-letz/pull/22#issuecomment-6754439012). She targeted commit `6b7881bc84ff20f0307e895cb14f369d30bf9839`. Her [original comment and patches](../mutants/tiffany4/received/) are preserved and credited; no claims are made about signup-sheet timestamps.

Each patch was applied alone and tested against the original nine-property snapshot, then against the strengthened responsible property, and reversed/restored before the next patch.

| Anna's mutant | Requirement / bug | Original nine properties | Improved result / change |
| --- | --- | --- | --- |
| RT1 | P1: ignore alias `baseUrl` | 9 passed; survived | Killed by P1 with non-default base directories and root-level decoy files. |
| RT2 | P2: use target basename as dedup key | 9 passed; survived | Killed by P2 with distinct target directories sharing a filename. Original same-directory fixtures remain available. |
| RT3 | R4: discard parent folders from error paths | 9 passed; survived | Killed by R4 with nested missing and deleted directories. |

Logs: [RT1 original](../mutants/tiffany4/logs/RT1-original.log), [RT1 improved](../mutants/tiffany4/logs/RT1-strengthened.log), [RT2 original](../mutants/tiffany4/logs/RT2-original.log), [RT2 improved final](../mutants/tiffany4/logs/RT2-strengthened-final.log), [RT3 original](../mutants/tiffany4/logs/RT3-original.log), [RT3 improved](../mutants/tiffany4/logs/RT3-strengthened.log). Every reported kill is an assertion failure, not a setup or compilation failure.

### Outgoing attack

Target: **Mira Thope (`mthope`), Team Meap**, [PR #40](https://github.com/CMU-313/fall-26-opencode-meap/pull/40). The [existing submitted attack comment](https://github.com/CMU-313/fall-26-opencode-meap/pull/40#issuecomment-6787359290) and all three [unchanged attack patches](../mutants/tiffany4/redteam/) are preserved on this branch. Their target commit and original explanations remain in the attack README.

## Final local verification

Before the Project 5 commit:

- `bun test --timeout 60000 test/tool/directory_summary.property.test.ts test/tool/directory_summary.test.ts test/tool/parameters.test.ts test/tool/registry.test.ts` from `packages/opencode`: **110 passed, 0 failed**, 17 snapshots, 6293 assertions. This covers all nine properties plus the feature, parameter, and registry integration tests.
- `bun typecheck` from `packages/opencode`: **passed**.
- `bun run lint packages/opencode/test/tool/directory_summary.property.test.ts` from the repository root: **passed**.
- `bun run build --single --skip-install --skip-embed-web-ui` from `packages/opencode`: **passed**, including the resulting native binary's `--version` smoke test. The verification build used the existing models fixture, channel `p5-verification`, and release disabled; it did not publish anything or build the web UI.
- Full local browser E2E was not run: this is a property-test/documentation change, and the existing PR smoke workflow provides the available browser verification. No unrun E2E check is claimed as passed.
- [Exact commands/results](../mutants/tiffany4/final-checks.json) and logs are retained. Original hand-written predictions, patches and initial Stryker reports remain unchanged; production source matches the original commit.

A full final Stryker run and broader survivor/equivalence review remain incomplete. Teammate approval must cover the submitted changes before the authorized merge; CI and merge outcomes are tracked on the existing PR and in the local submission checklist, not assumed here.

### Bounded final-score attempt

After the required artifacts were pushed, one final scoped attempt used `bunx stryker run stryker.tiffany4.config.json --concurrency 8`, with a 600-second outer bound. The dry run passed, but eight concurrent Bun workers consumed roughly 760% CPU and the attempt reported five timeouts by 45/176 mutants; it was stopped rather than treating resource-related timeouts as genuine kills. The initial completed report is untouched, no partial report replaces it, and no final mutation score is claimed. [Attempt log](../mutants/tiffany4/stryker-final.log) and [execution metadata](../mutants/tiffany4/stryker-final-execution.json) preserve this limitation. A controlled final run at the original concurrency remains necessary to meet the final-score requirement.
