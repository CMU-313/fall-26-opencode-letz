# Hand-written mutant predictions — Project 5

Author: Tiffany Liu (`tiffany4`)
Feature: `directory_summary`
Branch: `tiffany4/properties`
Studied commit: `6b7881bc84ff20f0307e895cb14f369d30bf9839`
Project 4 PR: https://github.com/CMU-313/fall-26-opencode-letz/pull/22

These predictions were recorded before generating, applying, or executing any of H1–H5. Work is deliberately stopped after the user's Step 2. No mutant outcomes or fresh baseline results are claimed. The designs follow the supplied task steps and the actual `traceability/tiffany4.md`. The official Project 5 handout was subsequently checked on November 12, 2026; see the rubric check below. The original designs and predictions are unchanged.

All proposed mutations affect `packages/opencode/src/tool/directory_summary.ts`. The future artifacts are independent `mutants/tiffany4/H1.patch` through `H5.patch`, each against the studied commit, never stacked. All named properties below are in `packages/opencode/test/tool/directory_summary.property.test.ts` (100 cases each, seed 17313).

## H1 — Remove uncertainty from the source-module purpose

**Requirement R2:** Mark inferred purpose as tentative and explicitly state when no specific purpose can be inferred.

**Proposed change:** In `purpose()`, change only the source-module return string from `Likely a source module containing application or library implementation.` to `A source module containing application or library implementation.`

**Plausible mistake:** A developer polishes the output wording and removes the qualifier, overlooking that purpose is inferred from filenames rather than verified from file semantics.

**Predicted killer:** `R2 invariant: purpose communicates uncertainty`.

**Why:** The generator includes the `source` fixture containing `module/index.ts`. For that fixture the property requires `summary.purpose` to match `/^Likely /`; the proposed text does not. A source-module fixture is a concrete witness. The prediction depends on the generated cases including this fixture, not on an already-observed run.

**Additional predicted detection:** `R3 invariant: purpose is a concise overview` compares the source-module string exactly, so a nonempty source set without a package manifest should also fail.

**Actual outcome:** NOT RUN.

## H2 — Collapse missing-directory errors into generic access errors

**Requirement R4:** Fail a summary request for a missing or deleted directory with an explicit Directory not found error identifying its path.

**Proposed change:** Replace the missing-stat branch ``if (!stat) return yield* Effect.fail(new Error(`Directory not found: ${directory}`))`` with `if (!stat) return yield* inaccessible()`.

**Plausible mistake:** A developer consolidates filesystem failure handling and accidentally treats a known missing path as an access failure. The tool still fails, but it loses the required diagnostic distinction.

**Predicted killer:** `R4 invariant: missing and deleted directories have explicit errors`.

**Why:** Both generated cases (never created and created then deleted) take this branch. The property checks the failure text contains `Directory not found:` followed by the absolute requested path. `inaccessible()` instead produces `Directory is not accessible: ...`; therefore the explicit-message assertion should fail while the failure-status assertion still passes.

**Actual outcome:** NOT RUN.

## H3 — Mislabel a resolved tsconfig alias as a relative dependency

**Requirement P1:** Report resolved imports outside the summarized directory with their target directory and resolution kind.

**Proposed change:** In the successful `if (alias)` resolution branch, change only `kind: "alias"` to `kind: "relative"`. Keep the resolved target and directory intact.

**Plausible mistake:** A copy-and-paste from the relative-import branch retains the wrong classification, or a refactor classifies all resolved filesystem paths as relative despite their different originating specifiers.

**Predicted killer:** `P1 model/oracle: resolved dependency targets`.

**Why:** With `alias === true` and a nonempty target set, the generated source imports `@lib/groupN/itemN`. The expected edge explicitly has `kind: "alias"`; exact edge comparison should reject `"relative"` even though resolution itself succeeds. An alias-enabled fixture with one target is a concrete witness. Empty target sets and relative-only cases will not expose this bug.

**Actual outcome:** NOT RUN.

## H4 — Deduplicate dependencies globally by target

**Requirement P2:** Count each distinct (source file, target) once and aggregate counts and source files by related directory.

**Proposed change:** Replace the dependency-map key `` const key = `${file.name}\0${resolved.target}` `` with `const key = resolved.target`.

**Plausible mistake:** A developer simplifies deduplication to identify a dependency solely by its destination, unintentionally merging edges from distinct source files.

**Predicted killer:** `P2 metamorphic: duplicate imports preserve frequency`.

**Why:** For any nonempty generated target set with `count > 1`, each target is imported by multiple source files. The first assertion expects `targets.length * count` edges; the mutant retains only `targets.length`. The independent aggregate count and source-list assertion should also disagree. One target imported by two files is a concrete witness. Single-source or empty-target cases may pass.

**Actual outcome:** NOT RUN.

## H5 — Treat similarly prefixed sibling directories as internal

**Requirement P3:** Exclude imports within the summarized directory and do not scan nested source files.

**Proposed change:** Replace `if (FSUtil.contains(directory, resolved.target)) continue` with `if (resolved.target.startsWith(directory)) continue`.

**Plausible mistake:** A developer substitutes a simple string-prefix check for path containment, forgetting that a shared prefix is not a directory boundary.

**Predicted killer:** `P3 metamorphic: internal and nested files preserve outward dependencies`.

**Why:** Every generated fixture includes `module/index.ts` importing `../module-other/value`. The absolute target begins with the absolute `module` path but is a sibling, not a descendant. The mutant drops it as internal. The property's initial assertion requires the dependency-directory list to equal `["module-other"]`, so it should fail before the nested-file transformation. This also violates P3's explicit acceptance criterion that a similarly named sibling still appears as a dependency.

**Actual outcome:** NOT RUN.

## Planned focused execution (not performed)

For each mutant, independently verify its patch against the studied commit, apply only that mutant, and run the named property from `packages/opencode`:

```sh
bun test --timeout 60000 test/tool/directory_summary.property.test.ts --test-name-pattern 'R2 invariant: purpose communicates uncertainty'
bun test --timeout 60000 test/tool/directory_summary.property.test.ts --test-name-pattern 'R4 invariant: missing and deleted directories have explicit errors'
bun test --timeout 60000 test/tool/directory_summary.property.test.ts --test-name-pattern 'P1 model/oracle: resolved dependency targets'
bun test --timeout 60000 test/tool/directory_summary.property.test.ts --test-name-pattern 'P2 metamorphic: duplicate imports preserve frequency'
bun test --timeout 60000 test/tool/directory_summary.property.test.ts --test-name-pattern 'P3 metamorphic: internal and nested files preserve outward dependencies'
```

Restore and verify the original source between mutants. Record exit status, failed assertion, and fast-check counterexample/seed/replay path when available. A build, setup, or environment error alone must not be reported as a property killing a mutant. Do not revise these predictions retrospectively to match outcomes.

Before mutation testing, run the original property suite to establish a baseline. After restoring the last mutant, rerun that same complete property suite:

```sh
bun test --timeout 60000 test/tool/directory_summary.property.test.ts
```

The main traceability table's `Mutants it kills` column and its Hand-written mutants section are deferred to Steps 7–8. Fill observed kills only after execution; distinguish any survivors and infrastructure failures explicitly.

## Verification status at the Step 2 stopping point

- H1–H5 designs and predictions: recorded before execution.
- Mutant patch files: not generated (Step 3 deferred).
- Mutants applied or executed: none.
- Actual kills/survivors: unknown; all five are predicted to be killed by the properties above.
- Baseline and restoration test results: not run in this phase.
- Production source, property tests, and existing traceability table: unchanged.
- No branch, PR, commit, or push was created.
- Existing untracked `fall-26-opencode-meap/` directory: left untouched.

## Official assignment check — November 12, 2026

Source: https://cmu-313.github.io/assignments/P5/1_break/

The five requirement-linked designs and pre-execution predictions meet the design-stage expectations. Completion still requires independent patches, observed results in the traceability file, and its `Mutants it kills` column.

Before implementation, check synchronization with team `main`; preserve these predictions and record any changed patch base. Continue on the existing Project 4 branch and PR.

The full project separately requires an actual surviving mutant for the agent-failure analysis, plus Stryker and retrospective work. Five predicted kills do not establish that evidence. Final submission requires teammate approval and a merge, but the current user instructions still prohibit pushing and stop work after Step 2. No synchronization, mutation execution, push, or merge was performed during this check.
