# Traceability: Zdenek Rusek Kotva (zrusekko)

**Target feature:** opencode's permission rules feature.

Main source files:

- [`packages/opencode/src/permission/index.ts`](../packages/opencode/src/permission/index.ts) — converts config rules, evaluates matching rules, and manages permission requests and approvals.
- [`packages/opencode/src/permission/arity.ts`](../packages/opencode/src/permission/arity.ts) — identifies command prefixes used to form shell permission patterns.
- [`packages/opencode/src/permission/evaluate.ts`](../packages/opencode/src/permission/evaluate.ts) — re-exports the permission rule evaluator.
- [`packages/opencode/src/util/wildcard.ts`](../packages/opencode/src/util/wildcard.ts) — matches commands and file paths against wildcard patterns.
- [`packages/opencode/src/agent/agent.ts`](../packages/opencode/src/agent/agent.ts) — defines default permission rules, including `.env` read behavior.
- [`packages/opencode/src/tool/shell.ts`](../packages/opencode/src/tool/shell.ts) — parses shell commands and requests permissions for them.
- [`packages/opencode/src/cli/cmd/run.ts`](../packages/opencode/src/cli/cmd/run.ts) — implements `--auto` replies to permission requests.
- [`packages/core/src/v1/permission.ts`](../packages/core/src/v1/permission.ts) — defines permission errors, including the denied-rule message.

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | C-2, S-8, O-6 | An explicit deny permission rule still blocks a command when `opencode` is in auto-approval mode (`opencode --auto`). | With permission rules `{"bash": {"*": "ask", "rm *": "deny"}}` and `opencode --auto`, `rm file.txt` is blocked and `file.txt` still exists, while `echo hi` is auto-approved. | No | Invariant | [`R1: deny permission rules block auto-approval`](../packages/opencode/test/permission/permission.property.test.ts#L60) |
| R2 | C-11, C-12, O-10, O-11 | A permission rule ending in `*` matches that command with any arguments but not other commands, and a permission rule without `*` matches only that exact command. | With permission rules `{"bash": {"*": "ask", "git status *": "allow"}}`, `git status --short` evaluates to allow and `git push` to ask. With permission rules `{"bash": {"*": "ask", "git status": "allow"}}`, `git status` evaluates to allow and `git status --short` to ask. | No | Metamorphic | [`R2: trailing wildcards match arguments while exact permission rules do not`](../packages/opencode/test/permission/permission.property.test.ts#L137) |
| R3 | C-3, O-3 | By default, reading files matching `*.env` or `*.env.*` requires approval, except files matching `*.env.example`, which are allowed. | With no user permission rules, reads of `.env`, `.env.local`, `config/.env`, and `src/.env.local` require approval; a read of `.env.example` is allowed without approval. | Yes | Model / oracle | [`R3: .env and .env.* reads require approval except .env.example`](../packages/opencode/test/permission/permission.property.test.ts#L180) |
| R4 | S-11, O-8 | Changes to the permission rules in the configuration file are automatically hot-reloaded and applied to the current `opencode` session without requiring a restart. | Start an `opencode` session with permission rules `{"bash": {"*": "ask", "rm *": "deny"}}` and confirm `rm a.txt` is denied. Delete `"rm *": "deny"` from the permission rules in the configuration file in the same `opencode` session, and `rm b.txt` is no longer denied. | No | N/A | N/a |
| R5 | C-16, C-17, S-16, O-15 | When `opencode` denies a command, it shows the permission rule (pattern and action) that caused the decision. | With permission rules `{"bash": {"*": "ask", "rm *": "deny"}}`, a blocked `file.txt` produces a message containing the text `"rm *": "deny"`. | No | Invariant | [`R5: denied commands show the matching permission rule`](../packages/opencode/test/permission/permission.property.test.ts#L202) |
| R6 | S-4, S-5, O-4 | Before executing a parsed shell command matching recursive `rm` deletion, such as `rm -rf <path>`, `opencode` asks for confirmation unless an applicable permission rule explicitly allows it. | With an empty configuration file that has no permission rules, `rm -rf build/` triggers an approval prompt. With the permission rule `"rm -rf *": "allow"` in the configuration file, the same command runs without approval. | Yes | N/A | N/A |
| R7 | S-7, S-8 | When `opencode` is in auto-approval mode (`opencode --auto`) and a deny permission rule blocks a command, `opencode` tells the user that their rule was enforced and that auto-approval mode did not override it. | With permission rules `{"bash": {"*": "ask", "rm *": "deny"}}` and `opencode --auto`, running `rm file.txt` shows a message that names the deny permission rule, `"rm *": "deny"`, and explains that `--auto` did not override this rule, while `echo hi` is auto-approved. | No | N/A | N/A |

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