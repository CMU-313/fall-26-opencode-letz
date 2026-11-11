
# Traceability: Lynsey Li (xiaomol)

**Target feature:** repository_overview

## Current status — November 11, 2026

This traceability document includes historical Project 4 analysis and the subsequent Project 5 mutation-testing work. Earlier statements about uncommitted changes, pending dependency coordination, and unverified CI refer to the state of the repository when those sections were written.

Since those reviews:

- The original Project 4 R1/R5 production fixes and property-based tests have been retained.
- The team merged Stryker dependency PR #24 into `main` (merge commit `f845395`), adding `@stryker-mutator/core` 10.1.1.
- The updated team `main` was merged into the local `xiaomol/properties` branch (merge commit `6aca6b6`).
- The Project 5 work includes five handwritten mutants, Stryker mutation reports, strengthened R4 coverage, and an opencode Agent Failure Case.
- The original production implementation has been restored after the controlled mutation experiments.
- Local validation of the four original properties and the strengthened agent property passed: 5 tests, 0 failures, 1,850 assertions.

Final Project 5 property validation command (run from `packages/opencode`):
`bun test test/tool/repository-overview.property.test.ts test/tool/repository-overview.agent.test.ts`

Result: **5 passed, 0 failed, 1,850 assertions across 250 generated cases.**

The Project 5 changes described here are local working-tree changes pending final commit, push, and pull-request verification. The successful CI checks for PR #24 apply to the dependency change and should not be interpreted as CI validation of the full Project 5 submission.

R3 and R7 remain outstanding requirements, as documented in the earlier analysis.

**Current R1/R5 status:** the nested-language and literal-workspace-rename defects
are now fixed; see “R1/R5 production fixes and strengthened properties” below.
Earlier review findings describe the pre-fix implementation. R3 and R7 remain
unchanged and unresolved.
- packages/opencode/src/tool/repository-overview.ts
- packages/opencode/test/tool/repository-overview.test.ts

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | C-1, C-2, S-3, S-4, O-6 | The tool should display the repository's main directories, important files, and detected programming languages. | Given a repository containing frontend/, backend/, package.json, .tsx files and .py files, the overview identifies both main directories, package.json, TypeScript and Python. | No | Generated repositories report expected directories, files, and languages (model/oracle) | `packages/opencode/test/tool/repository-overview.property.test.ts` | H1 (confirmed); H5 (killed by the property suite, and independently confirmed by the strengthened agent R1 property); H4 (suite failure observed, individual R1 failure not confirmed) |
| R2 | C-4, C-5, O-4, O-11, O-12 | The tool must exclude dependency directories and sensitive file contents from the overview. | Given a repository with node_modules/, .git/, and .env containing API_KEY='secret', the overview does not include files inside the excluded directories or expose 'secret'. | No | Excluded directories and sensitive file contents never appear (invariant) | `packages/opencode/test/tool/repository-overview.property.test.ts` | H1 (preliminary language assertion); H2 (confirmed, direct invariant violation) |
| R3 | C-6, S-6, S-10, S-13, O-9, O-10 | The overview should report high-level repository structure and recognized important files without individually describing ordinary implementation files. | Given a repository with 100 small UI component files and one main application entry-point file, the overview includes the entry point but does not individually describe all 100 UI files. | Yes | — | — | — |
| R4 | C-9, S-9, S-12, O-16 | When a file is added and later deleted, rerunning the tool should produce the same repository overview as before, assuming the final repository contents are unchanged. | Generate overview A, add temporary.ts, delete it, and generate overview B. The repository-content sections of A and B are identical. | No | Adding and deleting a temporary file restores the original overview (round-trip) | `packages/opencode/test/tool/repository-overview.property.test.ts` | H1 (preliminary language assertion); H3 (confirmed, intermediate-state assertion) |
| R5 | C-10, C-11, S-14, S-16, O-17, O-18 | When a directory is renamed without changing its contents, the overview must update the affected directory paths while preserving unrelated programming language and framework information. | Rename user/ to client/ without modifying any files. The updated overview shows client/ instead of user/, while the detected languages and frameworks remain unchanged. | No | Renaming a folder updates its path while preserving languages and frameworks (metamorphic) | `packages/opencode/test/tool/repository-overview.property.test.ts` | H1 (initial language assertion); H4 (confirmed, post-rename folder assertion); H5 (confirmed, post-rename technology preservation assertion) |
| R6 | S-7, S-8, S-20 | The tool should provide repository structure information beyond the README rather than only repeating the README's description. | Given a repository whose README contains only "A task management application" and whose directories include src/ and tests/, the overview identifies the repository directories in addition to the description. | No | — | — | — |
| R7 | S-18, S-19 | The tool should indicate when or from which repository version the overview was generated. | Given a repository at commit abc123, the generated overview includes that commit identifier. After a new commit def456, a newly generated overview identifies def456. | No | — | — | — |
| R8 | O-3 | The tool should generate an overview from a local repository regardless of its remote hosting platform. | Given two local repositories with identical files, one configured with a GitHub remote and the other with a Bitbucket remote, the tool successfully generates equivalent repository-content overviews for both. | No | — | — | — |

AI assistance: The original R1, R2, R4, and R5 properties and generators were developed with assistance from ChatGPT/Codex. During Project 5, opencode was also used to generate and subsequently strengthen a separate R1 important-file recognition property. The prompts, responses, implementation changes, and mutation experiment are documented in the Agent Failure Case section and exported transcripts. All properties were reviewed and validated against their corresponding requirements.

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R3 | The tool should prioritize high-level repository information and avoid listing unnecessary implementation details. | The overview should report high-level repository structure and recognized important files without individually describing ordinary implementation files. | The original wording was difficult to check because "unnecessary implementation details" is subjective. The revised requirement makes the expected output more concrete while preserving the interviewees' preference for a concise, high-level overview. |

## P4 requirement audit

No requirements were revised during this implementation. The pre-existing R3 revision,
original wording, and rationale remain above. Interview transcripts and a separate
assignment template were not found in this checkout; evidence identifiers are preserved,
not independently authenticated. Passing selected properties does not establish all
acceptance criteria.

| ID | Feasibility, conflicts, and current evidence |
|---|---|
| R1 | The original frontend/backend acceptance scenario is now covered in every generated case: nested .tsx/.py evidence is detected without workspace declarations. Non-excluded directories are scanned independently of workspace membership. The former deeper-tree exclusion test now requires nested Rust detection while preserving generated-directory exclusions. Detection remains bounded and explicitly reports partial traversal; no P3 requirement wording was narrowed. |
| R2 | Testable for dependency/generated directories and sensitive `.env` contents. The property covers all current excluded names at root and nested levels, wildcard resolution, hostile metadata, and random secret sentinels. This is not a universal redaction guarantee for secrets placed in intentionally reported fields such as package names. That broader interpretation needs clarification. |
| R3 | The recorded revision makes the subjective original more concrete. Ordinary implementation files are not individually described. However, the preserved acceptance criterion also requires an entry point, and ordinary index.ts/main.ts entry points are not recognized. That part remains unmet; no property is claimed. |
| R4 | Feasible. The property compares exact serialized output and metadata after an add/delete cycle in the same repository. An intermediate observation must change, preventing a no-op property. If R7 later introduces timestamps, use the original acceptance criterion's repository-content comparison explicitly. |
| R5 | The original user/ to client/ acceptance scenario is now exercised in every generated case with the unchanged literal declaration ["user"]. The folder path updates and technology evidence survives because detection is independent of membership. The stale declaration truthfully resolves to no workspace after the rename. No declaration edit, cached technology result, or requirement revision is used. Large truncated traversals and excluded-name renames remain documented limits, not claims of universal satisfaction. |
| R6 | Feasible and supported by inspection: folders are collected from filesystem entries independently of README contents, which are not read. R1 provides related structural evidence but does not execute the exact README acceptance scenario. No dedicated property is claimed. |
| R7 | Feasible and testable, but **unmet**: output contains neither a timestamp nor a commit identifier. The commit acceptance criterion is preserved. Version reporting remains outstanding feature work. |
| R8 | Feasible and supported by inspection: overview uses local filesystem operations without consulting remote URLs. Equivalent-content comparisons across directories must omit root/name placement identity. No GitHub-versus-Bitbucket remote acceptance test was run; no property is claimed. |

## Properties and generator rationale

The four original Project 4 properties (R1, R2, R4, and R5) live in `packages/opencode/test/tool/repository-overview.property.test.ts`. Project 5 also introduces a separate opencode-generated and subsequently strengthened R1 property in `packages/opencode/test/tool/repository-overview.agent.test.ts`. The generator rationale below describes the original four properties.
Each test name explicitly includes its requirement ID, full wording, and kind.
Each runs 50 fast-check cases (200 total), with fresh state for every sample and shrink.
Failures propagate to fast-check for a seed, shrink path, and counterexample; no
precondition skips or swallowed assertion failures are used.

- **R1 — model/oracle:** every generated repository has frontend/ and backend/,
  root package.json, nested .tsx and .py files, and no workspace declarations. Generated
  safe path segments vary depth from 1–3; a generated token varies filenames. Nonempty
  subsets of six independent language/extension pairs add evidence to either subtree.
  The oracle requires exact folders, important files, and the sorted union of Python,
  TypeScript, and generated languages. JSON must match metadata and no truncation is
  permitted. Thus the P3 nested source case cannot be bypassed by root placement.

- **R2 — invariant:** varied baseline repositories and random 8–32 character secret
  tokens; every one of the 14 excluded directory names is inserted at root and inside
  a potential workspace, with hostile package metadata and language evidence. Wildcard
  workspace discovery must still exclude these directories. Exact workspace, folder,
  language, and framework assertions plus secret and `.env` absence prevent false positives.

- **R4 — round-trip:** varied language baselines and generated temporary README filenames. The strengthened property first adds a `NOTREADME-${token}.md` file and verifies that it does not change the overview, checking false-positive README recognition. It then adds a valid `README-${token}.md` file and requires a visible change. Removing the temporary files must restore the exact original output and metadata. This tests both recognition boundaries and round-trip consistency.

- **R5 — metamorphic:** every sample uses the literal workspace declaration ["user"],
  a user/ folder with React and nonempty generated source evidence at its root and
  nested paths, plus unrelated root Vue/JavaScript evidence. Rename only user/ to
  client/, leaving package.json and all file contents unchanged. The exact overview
  oracle changes folders to ["client", "unrelated"] and resolved workspaces to [],
  preserving every other field, including nonempty language/framework lists and the
  stale workspacePatterns value. The moved React evidence is unique, so lost discovery
  cannot be masked by an unrelated copy. Path depths, language combinations, and names
  vary while the original literal rename scenario is guaranteed in every case.

The layer matches `packages/opencode/test/tool/repository-overview.test.ts`
(FSUtil, Truncate, Agent). `testEffect(...).live` supplies live OS behavior.
Services are captured before crossing fast-check's Promise callback boundary;
`withTmpdirInstance()`, `Effect.scoped`, and the captured context provide independent
repositories, instance context, and finalizer cleanup for every sample and shrink.
No custom runtime, global context patch, model call, or network access is used.
Permission callbacks follow the existing unit tests; permission-policy enforcement
is outside these properties.

## Validation and triage

Run from `packages/opencode`:

`bun test test/tool/repository-overview.property.test.ts test/tool/repository-overview.test.ts`

Result: **39 passing tests**, **0 failures** (4 properties, 200 generated cases,
35 existing tests), approximately 3.5 seconds. No generated counterexample exposed a
production bug; no production code changes or weakened existing assertions were needed.
The R1/R3/R5 scope issues and absent R7 above are inspection findings classified as
requirement/implementation gaps, not evidence that the full requirements pass.
An initial failed file write left the property file empty; its 35-test run is not
counted as property validation.

## CI verification and coordination

Inspected `TESTING.md`, `turbo.json`, `.github/workflows/test.yml`,
`.github/actions/setup-bun/action.yml`, `packages/opencode/package.json`, and
`packages/opencode/bunfig.toml`. The workflow triggers on `pull_request`, installs
Bun dependencies, and runs `GITHUB_ACTIONS=false bun turbo test --concurrency=4`.
Turbo includes `opencode#test`, whose script is
`bun test --timeout 30000 --only-failures`. Bun discovers this `.test.ts` file under
`test/tool` using the existing test preloads. No workflow, TESTING.md, or Turbo change
is needed. This is configuration verification, not a claim that remote CI ran.

The pre-existing fast-check **4.10.2** devDependency in
`packages/opencode/package.json` and corresponding `bun.lock` change are retained.
Coordinate the team's recommended separate dependency PR before submission; do not
drop these changes until the shared dependency change has landed and been reconciled.
No branch changes, commits, merges, pushes, or PR creation were performed.

Final verification: the properties also place React evidence inside the renamed
workspace when workspace mode is selected, so preserved framework detection exercises
the moved directory itself. After formatting and this strengthening, the targeted
CI-style command above again passed all 39 tests. `bun typecheck` from
`packages/opencode` passed. Existing dependency changes remain untouched.

## Follow-up review: original acceptance criteria, feasibility, and revisions

This review uses the P3 acceptance criteria preserved in the table above. The full
Project 4A rubric and original interview transcripts are not available locally, so
rubric judgments here apply the supplied rule: revise infeasible, conflicting, or
untestable requirements with evidence and rationale, rather than revising away missing
behavior. No acceptance criterion or requirement wording was changed in this review.
The following qualifications supersede any implication above that selected passing
properties establish complete R1 or R5 satisfaction.

| ID | Are the original acceptance criteria satisfied? | Is a code fix feasible? | Is a requirement revision justified? |
|---|---|---|---|
| R1 | **Not established in full.** frontend/ and backend/ are reported, and root package.json is recognized. Root-level .tsx/.py evidence is detected, as is evidence at declared workspace roots. If those source files are inside ordinary frontend/backend folders without workspace declarations, the requested TypeScript/Python detection fails. The criterion does not require root placement or workspaces, so a root-only property cannot establish full satisfaction. | **Yes.** Collect language evidence from non-excluded source directories, independently of workspace declarations. Keep symlink exclusions and bounded traversal, make partial results explicit, and avoid reading source contents merely to identify extensions. The existing test that deliberately ignores deeper language evidence and the tool description would need an intentional behavior update; changing that old expectation to require newly implemented detection would not weaken the P3 requirement. Add the exact frontend/backend fixture before claiming completion. | **No narrowing is justified.** Ordinary nested source files are feasible evidence. Restricting P3 to root/workspace roots solely to match today's implementation would weaken it. Defining the recognized language set and explicit behavior on very large/truncated repositories could be a useful measurable clarification, but would require documented scope justification; no such change is made here. |
| R3 | **No.** Suppression of the 100 ordinary UI files is satisfied by the selective output design, but identifying the application entry point is not: ordinary index.ts/main.ts files are absent from the recognized-file set. The whole acceptance criterion therefore fails. | **Yes.** Add evidence-based entry-point reporting using manifest entry declarations and/or a documented set of application entry conventions, with local-path validation and exclusion rules. Do not assume every file named index is an application entry point. Test an explicitly identified application entry point alongside 100 component files, asserting inclusion of the former and absence of individual component descriptions. The unspecified entry-point filename is a fixture-definition ambiguity, not evidence of infeasibility. | **Clarification is justified; removal is not.** P3's “unnecessary implementation details” is subjective, so making concise structure reporting observable is reasonable. However, the pre-existing revision's phrase “recognized important files” is insufficient if “recognized” means only today's allowlist. It must still include the acceptance criterion's identifiable application entry point. The recorded revision remains historical; it is not grounds to mark R3 complete or delete the entry-point obligation. No new wording is adopted without the missing interview/template context. |
| R5 | **Only for some fixtures; not universally satisfied.** A visible top-level user/ renamed to client/ updates folders. Root evidence and evidence in workspaces whose wildcard matches both names retain detected technologies. But with workspaces: ["user"], a sole user/main.py and user/package.json framework dependency disappear from discovery after the rename, so language/framework equality fails. Also, a nested non-workspace path is not individually reported at either name. The current property excludes these cases and is partial evidence. | **Yes, with a deliberate discovery design.** Separate repository-wide technology evidence from workspace membership so ordinary non-excluded folder renames preserve evidence even when a literal workspace declaration becomes stale. Continue to report actual resolved workspace membership accurately; inventing a client workspace or retaining cached technologies would be incorrect. Add a literal user-to-client case with nonempty technology evidence in the moved folder, plus unrelated evidence elsewhere. If nested path reporting is intended, define and implement the structural representation rather than inferring it from a root-only test. | **No restriction to wildcard workspaces is justified by incompleteness.** The original acceptance example is a rename without content edits; requiring edits to workspace declarations would change that example. “Unrelated” can justify limiting preservation to unaffected technology evidence in the prose requirement, but the acceptance criterion explicitly compares detected lists; that tension warrants clarification, not silently choosing the weaker interpretation. A rename into an excluded name such as node_modules would genuinely conflict with R2 and could justify an explicit non-excluded-to-non-excluded scope. The user-to-client example has no such conflict, so that exception would not resolve today's failure. No revision is made. |
| R7 | **No.** Neither a generation time nor a commit ID is emitted. Moreover, adding only a timestamp would satisfy the prose's “when or version” alternative but still fail the preserved commit-based acceptance criterion. | **Yes.** Resolve the current Git HEAD on each execution via an existing Effect process service, using the current directory so Git worktrees and nested directories resolve correctly. Return the observed commit ID, tolerate non-Git/unborn repositories explicitly, and do not cache the initial commit. A temporary Git fixture should verify two distinct observed HEAD values across a new fixture commit. This review did not create any commits. HEAD identifies the base commit, not necessarily uncommitted content; any dirty-state reporting would be an additional documented behavior. | **No relaxation is justified.** Local Git version reporting is feasible and testable. Keep the commit acceptance criterion; replacing it with merely a timestamp because HEAD is absent today would weaken acceptance. Defining a null version for non-Git/unborn repositories is a defensible edge-case clarification consistent with local-repository support, but does not remove the Git scenario. No revision is made. |

R1 and R3 can coexist: inspect filenames to infer languages and identify entry-point
evidence while keeping the serialized overview concise. R4 and R7 can also coexist:
R4 explicitly compares repository-content sections; adding and deleting an uncommitted
file leaves HEAD unchanged, while generation timestamps would belong outside that
comparison. None of these interactions makes the original ordinary acceptance
scenarios infeasible.

Production code and test assertions were left unchanged in this review. The existing
39-test suite is rerun as regression validation, not as proof that the unimplemented
acceptance cases above pass. Follow-up review and feasibility analysis were assisted
by ChatGPT/Codex; no additional interview evidence was introduced.

Follow-up validation result: from `packages/opencode`,
`bun test --timeout 30000 --only-failures test/tool/repository-overview.property.test.ts test/tool/repository-overview.test.ts`
passed **39 tests, 0 failures** (200 generated cases), in **3.04 seconds**.
`git diff --check` also passed. No production or test code changed, so no additional
typecheck was required for this documentation-only follow-up. No commits, pushes,
branch changes, or PR creation occurred; existing dependency changes were preserved.


## R1/R5 production fixes and strengthened properties

This implementation supersedes the pre-fix R1/R5 conclusions in the earlier review.
Their original requirement wording, evidence IDs, and acceptance criteria remain
unchanged. R3 and R7 behavior and requirements were not modified.

### Defects reproduced before fixing production

Strengthening the existing properties exposed both bugs while R2/R4 continued to pass.
A later controlled check ran the strengthened R1/R5 properties against the original
HEAD version of `packages/opencode/src/tool/repository-overview.ts`, then restored the
fixed source in a finally block. Both failed, showing the assertions detect the old
behavior rather than merely accepting the new implementation:

- R1 seed **-228598289**, shrink path **0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0**:
  generated folders ["a"], extra TypeScript evidence, false placement flag, token
  "Aaaaa0AA". Nested frontend/a/*.tsx and backend/a/*.py required Python/TypeScript;
  the original implementation returned an empty language list.
- R5 seed **-339394719**, shrink path **0:0:0:0:0:0:0:0:0:0:0:0:0:0:0**:
  generated folders ["a"], TypeScript evidence, false placement flag, token "a0AAAa00".
  Baseline assertions passed with nonempty technologies. After user/ became client/,
  the exact overview comparison failed because the original implementation lost React
  and moved language evidence when ["user"] stopped resolving. This failure occurred
  at the **post-rename** assertion, independently of the earlier nested-source bug.

Both are classified as **production code bugs against P3 acceptance**, not incorrect
properties or grounds for revising requirements. The test generator is shared with
R2/R4, so some inputs are unused by particular properties; no preconditions discard cases.

### Production behavior

`packages/opencode/src/tool/repository-overview.ts` now supplements existing root and
resolved-workspace evidence with a sorted breadth-first directory scan, independent
of workspace declarations. It reuses already detected root/workspace technology
results and reads other package.json files through the existing permission-checked,
malformed-metadata-tolerant reader. Only language/config filenames and recognized
package metadata contribute evidence; source files and .env contents are not read.
The existing EXCLUDED set and directory-entry type checks skip excluded directories
and symlinks at every depth. Ordinary source filenames are not added to importantFiles.

The independent scan has a 1000-directory budget, counting the root. Results expose
`technologyTraversal` if directories remain and `technologyRead` if a directory cannot
be read, using the existing truncated/truncationReasons fields. Sorted traversal is
repeatable; it uses an iterative queue rather than recursive call-stack growth.
Large or unreadable trees may still yield partial technology results, explicitly
reported as such. This operational limit does not narrow the original requirement or
establish unconditional rename invariance when traversal is partial.

`packages/opencode/src/tool/repository-overview.txt` describes the updated evidence
scope and truncation reasons. Root folder reporting, recognized important files,
workspace declaration semantics, output limits, and version reporting are unchanged.
No public Protocol/Server HttpApi or generated client files changed.

### Test references and preservation

- `packages/opencode/test/tool/repository-overview.property.test.ts`: strengthened
  **R1 (model/oracle)** and **R5 (metamorphic)**, 50 cases each, with the mandatory
  P3 examples and generator coverage described above. Exact JSON/metadata assertions
  and nontruncation checks remain. Per-sample scoped Effect instances remain independent.
- The same file's **R2 (invariant)** and **R4 (round-trip)** setup and assertions are
  preserved. R2 now also guards exclusions under the new independent traversal; R4
  still checks a visible intermediate change followed by exact output restoration.
- `packages/opencode/test/tool/repository-overview.test.ts`: “detects nested source
  languages while excluding generated directories” intentionally replaces the former
  expectation that ignored deeper source evidence. It now requires Rust while still
  excluding TypeScript/JavaScript/Python/Java evidence in generated directories.
- Same file: “requests read permission for root, workspace, and non-workspace package
  metadata” adds a nested non-workspace Vue manifest and requires its exact read
  permission request, retaining the prior root/workspace checks without duplicate reads.
- Same file: “does not follow symlink directories during independent technology
  discovery” prevents linked excluded language/framework evidence from leaking.
- Same file: “reports deterministic partial technology detection only when its
  directory budget is exceeded” checks evidence at the last allowed directory,
  truncation immediately beyond the boundary, and repeatable output.

### Local validation

From `packages/opencode`:

- `bun test --timeout 30000 --only-failures test/tool/repository-overview.property.test.ts test/tool/repository-overview.test.ts`:
  **41 passed, 0 failed**, **1610 assertions**, **200 generated cases**, approximately
  **7.25 seconds** (including the 1000-directory boundary integration test).
- `bun typecheck`: **passed**.

The PR test wiring previously verified remains applicable; no workflow or dependency
changes were made in this follow-up. The user's pre-existing dependency changes are
preserved. ChatGPT/Codex assisted with the production fix, regression properties,
validation, and traceability update. No commits, pushes, branch changes, or PR creation
were performed. R3 and R7 remain outstanding as previously documented.

## Project 5: Hand-written mutants

| ID | Requirement targeted | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| H1 | R1 | Incorrectly map TypeScript React files (.tsx) to JavaScript rather than TypeScript. | R1 model/oracle should kill this mutant because every generated repository contains a nested .tsx file and the expected languages include TypeScript. | **Killed** — All four existing properties failed (R1, R2, R4, R5). R1 directly detected that `.tsx` files were classified as JavaScript instead of TypeScript. R2 and R4 failed at their preliminary language assertions, while R5 detected missing TypeScript in its initial language comparison. Fast-check shrank R1 to a counterexample containing a single `.tsx` language entry. The mutation demonstrates that the R1 model/oracle checks language classification and that other properties share overlapping language assertions. |
| H2 | R2 | Remove node_modules from EXCLUDED, allowing dependency directories to be scanned. | R2 invariant should kill this mutant because the generator deliberately creates node_modules containing excluded technology evidence. | **Killed by R2 invariant.** Removing `node_modules` from `EXCLUDED` caused the overview to include both root and nested dependency directories as folders or workspaces. The generated secret `PRIVATE_SENTINEL_aaaaaaaa` appeared in workspace names, and the excluded Vue metadata contaminated framework detection. R2 failed at its `after.output` secret-exclusion assertion (line 211), while R1, R4, and R5 passed. Fast-check seed: `-178665292`; 3 tests passed and 1 failed. |
| H3 | R4 | Restrict README recognition to the exact name README, excluding README-*.md. | R4 round-trip should kill this mutant because its intermediate assertion expects a newly added README file to change the overview. | **Killed by R4 round-trip.** Restricting README recognition to the exact filename `README` caused the tool to ignore generated files named `README-${token}.md`. Consequently, adding a temporary README did not change the overview, violating R4's intermediate-state assertion at line 226. R4 failed, while R1, R2, and R5 passed. Test results: 3 passed, 1 failed, 1,160 assertions. |
| H4 | R5 | Report only workspace directories instead of all top-level repository directories. | R5 metamorphic should kill this mutant because renaming user/ to client/ leaves a stale workspace declaration, but the actual client/ directory must still appear. | **Killed by R5 metamorphic.** Replacing actual directory enumeration with workspace-derived folder reporting caused the overview to lose directory information after `user/` was renamed to `client/`. Because the unchanged workspace declaration `["user"]` no longer resolved, the mutant returned `folders: []` instead of the required `["client", "unrelated"]`. R5 failed at its post-rename assertion (line 145). The full suite reported 1 passed and 3 failed, with 537 assertions. Fast-check seed: `-2067914523`. The other two failing properties require individual failure-output confirmation. |
| H5 | R1 | Stop recursively traversing nested directories for language detection. | R1 model/oracle should kill this mutant because TypeScript and Python evidence is deliberately placed in nested frontend/ and backend/ directories. | **Killed.** Disabling independent nested-directory traversal caused the overview to lose technology evidence from ordinary source directories. R5 failed at its post-rename assertion (line 145): after renaming `user/` to `client/`, the mutant preserved the folder paths but lost React, Python, and TypeScript, retaining only Vue and JavaScript. The unchanged workspace declaration no longer matched the renamed directory, and the disabled traversal could not recover its technology evidence. Fast-check seed: `877758806`. The suite reported 2 passed and 2 failed (960 assertions). R5 is confirmed as a killer; the second failing property requires confirmation from the complete output. |

## Project 5: Stryker survivor strengthening

### README recognition — R4

The initial Stryker run reported a surviving Regex mutant in
`src/tool/repository-overview.ts` near line 272. The mutant removed the
start-of-string anchor from `/^README/i`, changing it to `/README/i`.

The original R4 round-trip property generated only filenames beginning
with `README`, so both the correct implementation and the mutant
recognized those files. Consequently, the original property could not
distinguish their behavior.

I strengthened R4 to generate `NOTREADME-${token}.md` files and assert
that adding them does not change the repository overview. The property
continues to check that adding a valid README changes the overview and
deleting it restores the original output.

Verification: the strengthened R4 property killed the mutant at line 232.
Fast-check seed: `20261111`; shrunk counterexample:
`[["a"], [{"ext":"tsx","name":"TypeScript"}], false, "AAaA0A0a"]`.
The mutant run produced 3 passing tests and 1 failing test.


## Project 5: Stryker comparison

### Configuration and results

Stryker 10.1.1 was run using `packages/opencode/stryker.xiaomol.config.json`. The command runner executed only `test/tool/repository-overview.property.test.ts`, with mutation scoped to `src/tool/repository-overview.ts`. Coverage analysis was disabled, and fast-check used the fixed seed `20261111`.

The initial run generated 560 mutants: 234 killed, 325 survived, and 1 timed out, for a raw mutation score of 41.96%.

After strengthening R4, the second run generated 560 mutants: 237 killed, 322 survived, and 1 timed out, for a raw mutation score of 42.50%.

The initial HTML report is preserved in `mutants/xiaomol/mutation-baseline.html`. The updated report is saved as `mutants/xiaomol/mutation.html`.

### Hand-written mutants versus Stryker

The five hand-written mutants targeted specific interview-derived requirements. H1 modified TypeScript classification (R1), H2 removed dependency-directory exclusion (R2), H3 restricted README recognition (R4), H4 replaced filesystem-based folder reporting with workspace-derived reporting (R5), and H5 disabled independent nested technology discovery (R1).

Stryker generated many smaller mutations to operators, predicates, regular expressions, array operations, and control-flow conditions. For example, it removed the beginning-of-string anchor from the README recognition regex, a defect that the original R4 property did not detect.

The hand-written approach was useful for constructing meaningful, multi-statement behavioral defects, particularly the workspace-only folder reporting defect in H4. Stryker systematically explored smaller code changes that were less obvious to anticipate, including README regex boundaries, package-manager parsing, workspace validation, and truncation behavior.

The two approaches therefore complement one another: hand-written mutants test deliberately chosen requirement violations, while automated mutation testing reveals additional weaknesses and untested implementation branches.

### Strengthening R4

One surviving Stryker mutant changed `/^README/i` to `/README/i`, causing filenames such as `NOTREADME-abc.md` to be classified as README files.

The original R4 property only generated filenames beginning with README, so the incorrect regex still passed.

I strengthened R4 to generate `NOTREADME-${token}.md` filenames and assert that they do not change the overview. The property also retains the positive README recognition check and the final restoration check.

With the mutant applied, R4 failed at its new assertion (line 232), using fast-check seed `20261111`. The shrunk counterexample included filename `NOTREADME-AAaA0A0a.md`. R1, R2, and R5 passed.

The subsequent full Stryker run killed three additional mutants, increasing the raw mutation score from 41.96% to 42.50%.

### Remaining survivors and limitations

The second run left 322 surviving mutants. These include mutations affecting package-manager parsing, workspace resolution, traversal boundaries, and output truncation.

Not all survivors are equivalent mutants. Some modify observable behavior that the current four properties do not exercise, while others may affect behavior outside the specific acceptance criteria being tested.

The current properties provide strong evidence for their generated scenarios, but do not demonstrate complete correctness across all implementation branches.


### Equivalent-adjusted score

The final Stryker run generated 560 mutants: 237 killed, 1 timed out, and 322 survived.

The raw mutation score is (237 + 1) / 560 = **42.50%**.

I identified two equivalent surviving mutants in the `importantFiles` sorting comparator at `src/tool/repository-overview.ts:275`:

- **E1 — EqualityOperator:** Changes `a.path < b.path` to `a.path <= b.path`.
- **E2 — EqualityOperator:** Changes `a.path > b.path` to `a.path >= b.path`.

The comparator sorts recognized root-level filenames. Each directory entry has a unique name, and each recognized file contributes at most one result, so distinct entries cannot have equal `path` values.

Both mutations change comparison behavior only for equal paths. Since duplicate paths cannot occur in this array, the mutations do not change the observable sorted result for valid repository inputs.

I therefore exclude these two mutants as equivalent.

**Equivalent-adjusted mutation score:**

(237 killed + 1 timeout) / (560 total - 2 equivalent)
= 238 / 558
= **42.65%**

The remaining 320 survivors are not classified as equivalent. Their survival may reflect incomplete property coverage, unexercised branches, or additional equivalent mutations that have not been established.




### Hand-written mutations versus Stryker-generated mutations

I inspected Stryker's HTML report at the source locations corresponding to H1–H5 and compared the reported mutations with the five handwritten patches.

| Mutant | Exact mutation generated? | Evidence |
|---|---|---|
| H1 | Not observed | Stryker generated nearby language-mapping mutations, but the exact change from `"TypeScript"` to `"JavaScript"` for `typescriptreact` was not observed. |
| H2 | No match shown | The `EXCLUDED` set entries, including `"node_modules"`, have no mutation markers in the report. |
| H3 | Not confirmed | Stryker generated README-regex mutations, including changes to the regex and its surrounding expression. The exact change from `/^README/i` to `/^README$/i` was not identified. |
| H4 | No match shown | Stryker did not show mutations replacing filesystem-derived folder reporting with workspace-derived paths. |
| H5 | No match shown | Stryker did not show a mutation replacing `const directories = [instance.directory]` with an empty array. |

The handwritten mutants deliberately introduce specific behavioral defects connected to R1, R2, R4, and R5. Stryker instead systematically transforms eligible operators, literals, conditions, and expressions.

The handwritten mutants therefore complement the automated analysis, particularly for semantic substitutions such as H4 and H5. Related Stryker mutants are not treated as exact matches to handwritten patches.

## Project 5: Agent Failure Case

### Agent and prompt

I used opencode (Build mode, GPT-5.6 Luna Fast) to generate a property-based test for requirement R1, which requires the repository overview to report main directories, important files, and programming languages.

The initial prompt asked opencode to propose a fast-check property for important-file recognition, including a generator, assertions, and an independent oracle.

The original proposal required corrections to its README classification and temporary-instance setup. After these corrections, opencode implemented the property in `packages/opencode/test/tool/repository-overview.agent.test.ts`.

The property generated subsets of recognized and irrelevant filenames, then compared the expected `importantFiles` entries against both the metadata and serialized output. It executed 50 generated cases using seed `20261111`.

### Original agent property: mutant survived

The original agent property passed against the normal implementation:

- 1 passed, 0 failed
- 100 assertions
- 50 generated cases

I then applied handwritten mutant H5, which changed:

`const directories = [instance.directory]`

to:

`const directories: string[] = []`

This disables independent directory traversal for technology detection.

The original agent property still passed:

- 1 passed, 0 failed
- 100 assertions

H5 therefore survived the agent-generated property, despite violating the language-detection part of R1.

### Why the agent property missed H5

The agent focused on the requested important-file recognition subproblem and asserted only the `importantFiles` field. It generated no nested source directories and made no assertions about detected programming languages.

Therefore, the property could not distinguish an implementation that correctly traversed nested directories from one that skipped nested technology detection.

The test was meaningful for important-file recognition, but its success did not establish satisfaction of R1 as a whole.

### Strengthening the property

I asked opencode to strengthen its original test while preserving the important-file generator and assertions.

The strengthened property creates `frontend/src/app.tsx` and `backend/src/app.py` inside every generated repository. It then requires Python and TypeScript to appear in both the metadata and serialized output.

Containment assertions were used rather than exact equality because generated recognized files can legitimately provide additional language evidence.

The strengthened property passed on the normal implementation:

- 1 passed, 0 failed
- 300 assertions
- 50 generated cases

### Mutant killed after strengthening

I reapplied H5 and ran only the strengthened agent property.

The test failed immediately:

- 0 passed, 1 failed
- Fast-check seed: `20261111`
- Shrink path: `0:0:0`
- Counterexample: `{"recognized":[{"path":"pnpm-lock.yaml","kind":"lockfile"}],"irrelevant":[]}`

The failing assertion expected `result.metadata.overview.languages` to contain `"Python"`, but received `[]`.

The test failed at line 86 of `repository-overview.agent.test.ts`, demonstrating that disabling nested traversal now violates an observable assertion.

The same H5 mutant that survived the original agent property was therefore killed by the strengthened property.

### Reflection

The agent produced a useful property for one part of R1, but it did not independently cover the other required output fields. Mutation testing exposed this gap by showing that a significant defect could survive while all of the original assertions passed.

The improvement came from mapping the full requirement to independent, observable assertions and ensuring each generated case contained meaningful nested language evidence.

This case illustrates that an AI-generated test can pass consistently while still providing incomplete coverage of its stated requirement.

### Evidence

- Agent-generated test: `packages/opencode/test/tool/repository-overview.agent.test.ts`
- Handwritten mutant: `mutants/xiaomol/H5.patch`
- Original opencode conversation: "Property-Based Test for Important-File Recognition"
- Strengthening conversation: "Strengthening Nested Language Detection Property"
- Original-property survivor and strengthened-property failure: local Bun test logs
- Original opencode transcript: `mutants/xiaomol/agent-original-transcript.json`
- Strengthening transcript: `mutants/xiaomol/agent-strengthening-transcript.json`
