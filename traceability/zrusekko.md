# Traceability: Zdenek Rusek Kotva (zrusekko)

**Target feature:** opencode's permission rules feature.

Main source files:

- [`packages/opencode/src/permission/index.ts`](../packages/opencode/src/permission/index.ts) — converts config rules, evaluates matching rules, and manages permission requests and approvals.
- [`packages/opencode/src/permission/arity.ts`](../packages/opencode/src/permission/arity.ts) — identifies command prefixes used to form shell permission patterns.
- [`packages/opencode/src/permission/evaluate.ts`](../packages/opencode/src/permission/evaluate.ts) — re-exports the permission rule evaluator.
- [`packages/core/src/util/wildcard.ts`](../packages/core/src/util/wildcard.ts) — wildcard matcher imported by permission evaluation.
- [`packages/opencode/src/agent/agent.ts`](../packages/opencode/src/agent/agent.ts) — defines default permission rules, including `.env` read behavior.
- [`packages/opencode/src/tool/shell.ts`](../packages/opencode/src/tool/shell.ts) — parses shell commands and requests permissions for them.
- [`packages/opencode/src/cli/cmd/run.ts`](../packages/opencode/src/cli/cmd/run.ts) — implements `--auto` replies to permission requests.
- [`packages/core/src/v1/permission.ts`](../packages/core/src/v1/permission.ts) — defines permission errors, including the denied-rule message.

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | C-2, S-8, O-6 | An explicit deny permission rule still blocks a command when `opencode` is in auto-approval mode (`opencode --auto`). | With permission rules `{"bash": {"*": "ask", "rm *": "deny"}}` and `opencode --auto`, `rm file.txt` is blocked and `file.txt` still exists, while `echo hi` is auto-approved. | No | Invariant | [`R1: deny permission rules block auto-approval`](../packages/opencode/test/permission/permission.property.test.ts#L60) | H1 |
| R2 | C-11, C-12, O-10, O-11 | A permission rule ending in `*` matches that command with any arguments but not other commands, and a permission rule without `*` matches only that exact command. | With permission rules `{"bash": {"*": "ask", "git status *": "allow"}}`, `git status --short` evaluates to allow and `git push` to ask. With permission rules `{"bash": {"*": "ask", "git status": "allow"}}`, `git status` evaluates to allow and `git status --short` to ask. | No | Metamorphic | [`R2: trailing wildcards match arguments while exact permission rules do not`](../packages/opencode/test/permission/permission.property.test.ts#L137) | H2, H3 |
| R3 | C-3, O-3 | By default, reading files matching `*.env` or `*.env.*` requires approval, except files matching `*.env.example`, which are allowed. | With no user permission rules, reads of `.env`, `.env.local`, `config/.env`, and `src/.env.local` require approval; a read of `.env.example` is allowed without approval. | Yes | Model / oracle | [`R3: .env and .env.* reads require approval except .env.example`](../packages/opencode/test/permission/permission.property.test.ts#L180) | H4 |
| R4 | S-11, O-8 | Changes to the permission rules in the configuration file are automatically hot-reloaded and applied to the current `opencode` session without requiring a restart. | Start an `opencode` session with permission rules `{"bash": {"*": "ask", "rm *": "deny"}}` and confirm `rm a.txt` is denied. Delete `"rm *": "deny"` from the permission rules in the configuration file in the same `opencode` session, and `rm b.txt` is no longer denied. | No | N/A | N/A | N/A |
| R5 | C-16, C-17, S-16, O-15 | When `opencode` denies a command, it shows the permission rule (pattern and action) that caused the decision. | With permission rules `{"bash": {"*": "ask", "rm *": "deny"}}`, a blocked `file.txt` produces a message containing the text `"rm *": "deny"`. | No | Invariant | [`R5: denied commands show the matching permission rule`](../packages/opencode/test/permission/permission.property.test.ts#L202) | H1, H5 |
| R6 | S-4, S-5, O-4 | Before executing a parsed shell command matching recursive `rm` deletion, such as `rm -rf <path>`, `opencode` asks for confirmation unless an applicable permission rule explicitly allows it. | With an empty configuration file that has no permission rules, `rm -rf build/` triggers an approval prompt. With the permission rule `"rm -rf *": "allow"` in the configuration file, the same command runs without approval. | Yes | N/A | N/A | N/A |
| R7 | S-7, S-8 | When `opencode` is in auto-approval mode (`opencode --auto`) and a deny permission rule blocks a command, `opencode` tells the user that their rule was enforced and that auto-approval mode did not override it. | With permission rules `{"bash": {"*": "ask", "rm *": "deny"}}` and `opencode --auto`, running `rm file.txt` shows a message that names the deny permission rule, `"rm *": "deny"`, and explains that `--auto` did not override this rule, while `echo hi` is auto-approved. | No | N/A | N/A | N/A |

Properties written or suggested by opencode or another AI tool: R1, R2, R3, R5 (the properties and generators for these four requirements were written with assistance from GitHub Copilot in VS Code and reviewed by me).

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R3 | Reading a `.env` file requires approval by default. | By default, reading files matching `*.env` or `*.env.*` requires approval, except files matching `*.env.example`, which are allowed. | This requirement changed because the original requirement focused on the `.env` file, which did not specify whether suffixed names or nested paths were included, making the expected behavior ambiguous. This revision makes those cases explicit and preserves the user's need to protect environment secrets while allowing example files for the opencode AI agent to read. |
| R6 | Before running a command that recursively deletes files, `opencode` should ask for confirmation, unless the user has explicitly allowed it. | Before executing a parsed shell command matching recursive `rm` deletion, such as `rm -rf <path>`, `opencode` asks for confirmation unless an applicable permission rule explicitly allows it. | This requirement changed because the original requirement could have included arbitrary commands or scripts whose recursive deletion behavior is difficult to identify, leaving the intended coverage unclear. This revision narrows the check to parsed recursive `rm` commands while preserving the user's need to ensure the opencode AI agent cannot accidentally perform deletion and still allow it to execute explicitly approved commands. |

## Requirements not changed

R1, R2, R4, R5, and R7 were kept because they describe observable behaviors that can be implemented and checked. R1 was kept because it specifies observable outcomes, which is that an explicitly denied command is blocked in `--auto`, while an ask-level command is auto-approved—which can be checked with tests. R2 was kept because its wildcard and exact-match behaviors have clear, testable outcomes. R4 does require adding config-change detection and refreshing config-derived permission state, which the current implementation does not do, but the code architecture presents no evident barrier that makes this unreasonable. R5 was kept because a denial can expose the matching rule's pattern and action in a checkable form. R7 was kept because whether the denial message explains that `--auto` did not override the rule is directly testable.

## Property test results

All four property tests for each of the four requirements (R1, R2, R3, and R5) passed in the opencode package. From `packages/opencode`, `bun test test/permission/permission.property.test.ts` reported 4 passed and 0 failed.

## Hand-written mutants

| ID | Requirement targeted | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| H1 | R1 | In [`index.ts`](../packages/opencode/src/permission/index.ts#L75), replace the explicit-deny error with `continue`, allowing the denied permission request to succeed. Patch: [`H1.patch`](../mutants/zrusekko/H1.patch). | [`R1: deny permission rules block auto-approval`](../packages/opencode/test/permission/permission.property.test.ts#L60) should kill it because the property expects an explicit deny to fail even when ask-level requests are auto-approved. | Killed the H1 mutant: the R1 property test failed as predicted, but the R5 property test also failed because this mutation bypassed the denial error that R5 checks. |
| H2 | R2 | In [`wildcard.ts`](../packages/core/src/util/wildcard.ts#L11), remove the special handling that makes a trailing `" *"` optional, so `git status *` no longer matches bare `git status`. Patch: [`H2.patch`](../mutants/zrusekko/H2.patch). | [`R2: trailing wildcards match arguments while exact permission rules do not`](../packages/opencode/test/permission/permission.property.test.ts#L137) should kill it because the property expects a trailing-wildcard rule to allow the bare command. | Killed the H2 mutant: the R2 property test failed because the trailing-wildcard rule no longer matched the bare command. |
| H3 | R2 | In [`wildcard.ts`](../packages/core/src/util/wildcard.ts#L13), remove the regex end anchor, so an exact pattern such as `git status` also matches a longer command like `git status --short`. Patch: [`H3.patch`](../mutants/zrusekko/H3.patch). | [`R2: trailing wildcards match arguments while exact permission rules do not`](../packages/opencode/test/permission/permission.property.test.ts#L137) should kill it because the property expects an exact rule not to match a command with added arguments. | Killed the H3 mutant: the R2 property test failed because the exact rule matched a command with added arguments. |
| H4 | R3 | In [`agent.ts`](../packages/opencode/src/agent/agent.ts#L132), change the default read action for `*.env` files from `"ask"` to `"allow"`. Patch: [`H4.patch`](../mutants/zrusekko/H4.patch). | [`R3: .env and .env.* reads require approval except .env.example`](../packages/opencode/test/permission/permission.property.test.ts#L180) should kill it because the property expects `.env` reads to require approval. | Killed the H4 mutant: the R3 property test failed because a read of `config/.env` returned `"allow"` instead of `"ask"`. |
| H5 | R5 | In [`index.ts`](../packages/opencode/src/permission/index.ts#L77), set the ruleset passed to `DeniedError` to an empty array instead of including applicable rules, so the error no longer exposes the matching pattern and action. Patch: [`H5.patch`](../mutants/zrusekko/H5.patch). | [`R5: denied commands show the matching permission rule`](../packages/opencode/test/permission/permission.property.test.ts#L202) should kill it because the property checks that the denial error's ruleset and message include the matching pattern and `"deny"` action. | Killed the H5 mutant: the R5 property test failed because the denied error's ruleset was empty and did not contain the matching rule. |

## Stryker comparison

The baseline Stryker run used fast-check seed `42` and tested 53 mutants across the four configured source files. It killed 33 mutants, 20 survived, and none timed out, for a Stryker-reported mutation score of **62.26%**. Its report is [`mutation-baseline.html`](../mutants/zrusekko/mutation-baseline.html). After strengthening the properties, the final run tested 53 mutants, killed 35, had 18 survivors and no timeouts, for a Stryker-reported mutation score of **66.04%**. The final report is [`mutation-final.html`](../mutants/zrusekko/mutation-final.html).

Stryker generated mutations matching the behavior targeted by hand-written mutants H2 and H3: it disabled the trailing-`" *"` special case and removed the regex end anchor, and the R2 property killed those mutants. It did not generate the specific changes in H1, H4, or H5. H1 changes the deny branch to continue instead of throwing; H4 changes the `*.env` default action from `"ask"` to `"allow"`; and H5 replaces the denied error's ruleset with an empty array. These are broader, requirement-directed changes than the individual expression replacements generated by Stryker.

One Stryker survivor I would not have thought to test is a mutation in `Permission.ask` that changes the `"allow"` branch so it no longer skips the approval path (`if (false) continue`). A developer could plausibly introduce this bug while changing permission handling: a command with an explicit `"allow"` rule might unexpectedly prompt the user instead of proceeding without approval. I was focused on the requirement that rules evaluate to the correct action, so I did not think to separately check how `Permission.ask` acts on an `"allow"` result.

The hand-written mutants directly model requirement-level faults, including changes Stryker did not propose, while Stryker explores many smaller expression-level changes and exposes untested behaviors such as how `Permission.ask` handles an allow result. The approaches complement each other: hand-written mutants reflect the intended requirements, and Stryker helps find gaps those scenarios did not anticipate.

## Strengthening

The R2 property was strengthened with a generated prefixed command that must not match either the trailing-wildcard or exact rule. This killed a mutant that removed the start anchor from the wildcard regular expression. The R5 property now generates an unrelated permission rule and checks that it is excluded from the denied error while the matching deny rule remains present; this killed the mutant that passed the entire ruleset into the error. Both changes extend existing properties with generated inputs and stronger assertions; no example-based tests were added.

The remaining survivors were not all addressed because several behaviors are outside the stated requirements. R2 specifies `*` and exact-command matching, not slash normalization, case sensitivity, or the `?` wildcard; platform-specific behavior also cannot be established from this run alone. R2's acceptance criteria checks the evaluator's `"allow"` result, not the later permission-request execution path. The requirements also do not specify the no-match fallback, the general agent permission default, or diagnostic logging behavior. These areas are left out rather than expanding requirement scope solely to improve the mutation score.

The strengthened property test passed with seed `42` (4 passed, 0 failed). The final Stryker score is **66.04% (35/53)**, which is a slight improvement from the baseline Stryker score. No survivors are claimed equivalent, so the score with equivalent mutants excluded is also **66.04% (35/53)**. No example-based tests were added.

## Agent failure case

### Why I used GitHub Copilot in VS Code instead of OpenCode
I initially intended to use OpenCode, but when I tried to prompt the OpenCode agent, it reported that my free usage was exceeded even though I had not used it for coding at all. I also tried to switch between any and all of the free models from OpenRouter, and it still displayed the same message each and everyime time. Therefore, I had to use GitHub Copilot in VS Code to get the required agent-generated property rather than spend time troubleshooting access to OpenCode. Thus, the property below was written by GitHub Copilot in VS Code instead of OpenCode.

### Relevant prompt to agent
> Could you add a new property-based test for R5 in `test/permission/permission.property.test.ts`? Generate bash command patterns and commands that match a generated deny rule, call the permission service, and verify that each call is denied by checking that it fails with a `PermissionV1.DeniedError`. Please give the new test a unique name containing “Agent R5 property” so I can run it by itself. Keep this as a separate test from the existing R5 property, and don’t modify the existing properties.

### Relevant response from agent
> Added a separate “Agent R5 property” test in `permission.property.test.ts`. It generates bash deny patterns and matching commands, calls the permission service, and verifies each failure is a `PermissionV1.DeniedError`. The existing properties are unchanged.

> Validation passed: `bun test test/permission/permission.property.test.ts -t "Agent R5 property"` — 1 test passed.

The relevant code in `packages/opencode/test/permission/permission.property.test.ts` generated by the agent from the response:

```ts
it.instance("Agent R5 property: matching denied bash commands fail with DeniedError", () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const context = yield* Effect.context()
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(commandHead, commandPart, commandArgument, async (head, part, args) => {
            const pattern = `${head} ${part} *`
            const exit = await Effect.runPromise(
              Effect.exit(
                permission.ask({
                  sessionID: SessionID.make("session_agent_r5_property"),
                  permission: "bash",
                  patterns: [`${head} ${part} ${args}`],
                  metadata: {},
                  always: [],
                  ruleset: [{ permission: "bash", pattern, action: "deny" }],
                }),
              ).pipe(Effect.provideContext(context)),
            )

            expect(Exit.isFailure(exit)).toBe(true)
            if (!Exit.isFailure(exit)) return
            expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.DeniedError)
          }),
        ),
      )
    }),
  )
```

### The mutant it let survive
[H5](../mutants/zrusekko/H5.patch) sets the `ruleset` passed into `DeniedError` to an empty array, removing the permission-rule details from the denial error.

### Explanation of why the property was too weak
The property had a weak oracle: it checked that a generated matching command was denied and that the failure was a `DeniedError`, but did not check the information contained in that error. H5 preserves the denial while replacing the error's ruleset with an empty list, so every assertion in the original property still passes even though the behavior required by R5 is broken.

### Strengthened version and evidence that it kills the mutant
The strengthened property keeps the generated matching deny commands and adds an assertion that `DeniedError.ruleset` contains the generated matching `{ pattern, action: "deny" }` rule. This checks R5's rule-detail requirement, rather than only checking that denial occurred.

- Without H5: `cd packages/opencode && bun test -t "Agent R5 property" test/permission/permission.property.test.ts` — passed (1 test, 0 failures).
- With H5 applied: the same command failed (0 passed, 1 failed). With seed `42`, fast-check produced the counterexample `["git", "status", "file.txt"]`; the assertion expected the matching `{ pattern: "git status *", action: "deny" }` entry but received an empty ruleset. This demonstrates that the strengthened assertion kills H5.
