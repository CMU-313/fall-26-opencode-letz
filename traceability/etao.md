# Traceability: Ethan Tao (etao)

**Target feature:** opencode permission rules (allow / ask / deny for a tool or shell command). Main source files: `packages/opencode/src/permission/index.ts` (`evaluate`, `fromConfig`, `ask` / `reply`, new `explain`), `packages/core/src/util/wildcard.ts` (`Wildcard.match`), `packages/opencode/src/permission/arity.ts` (`BashArity.prefix`), and `packages/opencode/src/tool/shell.ts` (parses the command and builds the asked and "always" patterns).

## Requirements

All tests are in `packages/opencode/test/permission/permission.property.test.ts`.

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | S-3, O-2 | When the user picks "always allow" for a shell command, later commands that run the same command (same `BashArity` prefix, e.g. `git commit`) and differ only in the arguments after it are also allowed without asking again, however many spaces or tabs separate the words. Commands that put flags before the subcommand (`git -C dir commit`) are out of scope. | User picks "always allow" for `git commit -m "first"`. The agent then runs `git commit -m "second"` (or `git commit\t-m "second"`) with no prompt. `git commitx` still asks. | Yes | Same command with different args stays allowed (metamorphic); lookalike command is not covered (invariant) | "R1: after always-allow, the same command with different arguments is allowed"; "R1: always-allow does not cover a different command that shares a prefix" | None yet (H1 survives) |
| R2 | S-12, C-11, O-10 | After the user picks "always allow" for a command, the tool does not ask about that same command again for the rest of the session. | User picks "always allow" for `ls`. The agent then runs `ls` three more times in the same session, and the user sees zero further prompts. | No | Every later evaluation in the session stays allow, whatever the config and later approvals (invariant) | "R2: an always-allowed command stays allowed for the rest of the session" | H2 |
| R3 | S-6, C-6, O-4 | If the config has a catch-all `"*": "allow"` and no other rule matches, every command is allowed, including destructive ones. | With only the rule `{"*": "allow"}`, `rm file.txt`, `git push --force`, and `gh pr merge 12` all evaluate to allow and run with no prompt. | No | Any permission and any command evaluates to allow (invariant) | "R3: with only {"*": "allow"}, every command is allowed" | None yet (H4 survives) |
| R4 | S-9, S-11 | Rules that cannot both match the same command give the same result in any order. Order only matters between rules that overlap, and then the later rule wins (last match wins). | `{"rm *": "deny", "git push *": "ask"}` in either order gives deny for `rm file.txt` and ask for `git push`. `{"*": "ask", "rm *": "deny"}` gives deny for `rm file.txt` and ask for `ls`; in reverse order `rm file.txt` gives ask, because the later `"*"` overlaps and wins. | Yes | `evaluate` agrees with a plain last-match-wins reference (model/oracle); shuffling non-overlapping rules keeps the result (metamorphic) | "R4: evaluate agrees with a last-match-wins reference model"; "R4: reordering rules that cannot both match the command does not change the result"; "R4: {"*": "ask", "rm *": "deny"} denies rm, and reversed order asks" | H3 |
| R5 | S-10, S-8 | When a command matches more than one rule with different actions, the permission system reports which rule decided the outcome and which earlier matching rules with a different action it overrode. | With rules `{"*": "ask", "rm *": "deny"}`, `Permission.explain("bash", "rm file.txt", rules)` returns `decidedBy` = `"rm *"` (deny) and `overridden` = [`"*"` (ask)]. | Yes | `decidedBy` equals `evaluate`'s result and `overridden` equals every earlier matching rule with a different action (invariant) | "R5: explain names the deciding rule and the rules it overrode" | None yet (H5 survives) |

Properties written or suggested by opencode or another AI tool: R1, R2, R3, R4, R5 (properties and generators written by an AI coding assistant; reviewed by me).

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R1 | When the user picks "always allow" for a shell command, later commands that differ only in their arguments (same command, e.g. git commit) are also allowed without asking again. | Same, with "same command" defined as the same `BashArity` prefix, any spaces or tabs between words, and flag-before-subcommand commands (`git -C dir commit`) out of scope. | Checkability and feasibility. "Same command" had no testable definition. The property found that a tab between words made the user re-confirm (a code bug, fixed). It also found that `git -C dir commit` produces the always-pattern `git -C *`, which then allows `git -C dir push --force`. Fixing that needs a redesign of `BashArity`, so the case is scoped out and recorded as a known limitation. |
| R4 | The same set of rules gives the same result for a command no matter what order the rules are written in. | Rules that cannot both match the same command give the same result in any order; between overlapping rules the later one wins. | Conflict. opencode deliberately uses last-match-wins, and it is documented and covered by existing tests ("evaluate - last matching rule wins", "evaluate - wildcard at end overrides earlier exact match"). Order-independence for overlapping rules would break them. The user's real need (not having to think about order) is kept for every pair of rules that don't overlap. |
| R5 | When a command matches more than one rule with different actions, the tool tells the user which rule decided the outcome and which rules it overrode. | The permission system reports (via `Permission.explain`) the deciding rule and the earlier matching rules with a different action that it overrode. | Checkability and feasibility. No such message existed (`DeniedError` only carries the permission-filtered ruleset), and message wording can't be checked by a property. The new pure helper returns the data the message needs, and that data is checkable. Showing it in the prompt UI is left for later work. |

R2 and R3 are kept as written: both are checkable on `evaluate` as stated. R2's property did fail at first, but on a code bug (tabs), not a requirement problem.

## Triage of failures

| Property | Shrunk counterexample | Verdict | Action |
|---|---|---|---|
| R1 | `ls` approved, then `ls<tab>!` | Code bug: ShellTool asked with the raw command text, and a space in a rule only matches one literal space, so `"ls *"` missed `ls<tab>...`. The same bug let `rm  -rf /` (two spaces) past a `"rm -rf *": "deny"` rule. | Fixed in ShellTool: the asked pattern is rebuilt from the parsed command, with each whitespace gap between parsed words shrunk to one space; text inside a word (quotes, escapes, `$'...'`) is kept exactly. Two earlier attempts were dropped after independent review: a `Wildcard.match` change loosened path rules (`/project/my file` would match `/project/my  file`), and a hand-written quote scanner mis-read bash `$'a\'  b'` and PowerShell `"C:\"`. Added a deny-rule regression test, bash and PowerShell quoted-spacing invariants, and a ShellTool test. |
| R2 | `a` approved, then `a<tab>""` | Same code bug as R1 | Same fix |
| R5 | any input | Missing feature (`explain` did not exist) | Added `Permission.explain` |
| R1 (generator design) | `git -C dir commit` | Requirement problem (see R1 above) | R1 revised; recorded as a known limitation, not fixed |
| R2 (stress run) | random command name `if` | Wrong test: a bash reserved word is not a command | Generator skips reserved words |
| PowerShell spacing invariant | `Write-Output  -/  "C:\"` | Wrong test: `-/` is not valid PowerShell | Generator words no longer start with `-` |

Found, not fixed (out of scope): the PowerShell grammar returns a parse error for `Write-Host<tab>foo` (and for `Write-Output  -/`), so ShellTool finds no command and asks no bash permission at all. This exists on `main` too and only affects PowerShell; a fix needs a fail-closed rule for parse errors.

Mutation checks: making the spacing rebuild a no-op makes R1, R2, the regression test, both spacing invariants, and the ShellTool test fail; putting back the dropped quote scanner makes both spacing invariants fail on the reviewer's cases; dropping the action filter in `explain` makes R5 fail; switching `evaluate` from `findLast` to `find` makes the R4 oracle test fail.

## Hand-written mutants

Patches are in `mutants/etao/` (apply from the repo root with `git apply`). Predictions were written and committed before any mutant was run; the "Actual result" column is filled in afterward. Property tests run with fast-check seed 42.

| ID | Requirement targeted | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| [H1](../mutants/etao/H1.patch) | R1 | `permission/arity.ts`: `prefix` loops `len > 1` instead of `len > 0`, so a one-word entry like `git: 2` is never looked up. `git commit -m x` becomes `git`, and "always allow" for `git commit` turns into `git *`, which also allows `git push`. | Probably none. Both R1 properties build their expected "same command" with `BashArity.prefix` itself, so the oracle shrinks along with the code. The lookalike property only glues text onto the last word (`gitx`), never tries a different subcommand like `git push`. R2 also only checks the approved command stays allowed. I expect it to survive. | Survived, as predicted: all 11 tests passed. The R1 oracle uses `BashArity.prefix`, so it accepted the shortened `git *` approval. |
| [H2](../mutants/etao/H2.patch) | R2 | `permission/index.ts`: `evaluate` reverses the rulesets before flattening (`rulesets.toReversed().flat()`), as if session approvals should be checked first. Since the last match wins, config rules now override the user's "always allow". | R2: "an always-allowed command stays allowed for the rest of the session". It calls `evaluate(command, config, approved)`, and the config generator often includes a matching `"*": "ask"` or `"git *": "ask"`, which now wins over the approval. R1, R3, R4, R5 pass one ruleset, so they should not notice. | Killed by R2, as predicted (1 failed, 10 passed). Counterexample: config `[{bash, "*", ask}]`, command `a`; the config ask beat the approval. |
| [H3](../mutants/etao/H3.patch) | R4 | `permission/index.ts`: `evaluate` returns the first matching deny rule before falling back to last match wins ("deny always wins, so a later allow can never undo it"). With `{"rm *": "deny", "*": "ask"}`, `rm file.txt` gives deny instead of ask. | R4: "evaluate agrees with a last-match-wins reference model". The rule generator mixes `"*"` and command rules with all three actions, so a deny followed by a later overlapping allow or ask should come up quickly. R5 should not catch it, because its oracle uses `evaluate`'s own answer as the decider. | Killed by R4 model property, as predicted, and also by the R4 `{"*": "ask", "rm *": "deny"}` example check (2 failed, 9 passed). Counterexample: `[{bash, "*", deny}, {bash, "*", ask}]` for `a`. R5 passed, as predicted. |
| [H4](../mutants/etao/H4.patch) | R3 | `core/util/wildcard.ts`: `match` drops the regex `s` flag (`"win32" ? "i" : undefined`), so `.*` no longer matches a newline. With only `{"*": "allow"}`, a multi-line command such as `rm a\nb` no longer matches `*` and falls back to ask. | Probably none. R3's commands never contain a newline: the arg generators strip whitespace, and `fc.string()` in fast-check 4.10.2 produces printable ASCII only, which also covers the random permission names. I expect it to survive. | Survived, as predicted: all 11 tests passed. No generated command contains a newline. |
| [H5](../mutants/etao/H5.patch) | R5 | `permission/index.ts`: `explain` filters matching rules by pattern only and forgets the permission check, so a rule for another tool (for example `edit` with pattern `*`) is reported as overridden for a bash command. | Probably none. R5's rule generator only uses permissions `bash` and `*`, and it always asks about `bash`, so every generated rule passes the permission check anyway. I expect it to survive. | Survived, as predicted: all 11 tests passed. No generated rule has a permission other than `bash` or `*`. |

How each was run: `git apply mutants/etao/H<n>.patch`, then `bun test test/permission/permission.property.test.ts` from `packages/opencode`, then `git apply -R` the same patch. All 5 predictions held: 2 killed, 3 survived. The 3 survivors are handled under Strengthening.

## Stryker comparison

**Setup.** Config: `packages/opencode/stryker.etao.config.json` (command runner, runs only `bun test test/permission/permission.property.test.ts`, coverage analysis off). fast-check seed: **42** (`fc.configureGlobal({ seed: 42 })` at the top of the property file). Run with `bunx stryker run stryker.etao.config.json` from `packages/opencode` (Stryker 10.1.1, about 38 s). Report: [`mutants/etao/mutation.html`](../mutants/etao/mutation.html).

Mutated ranges, chosen as the functions my properties actually call:

- `src/permission/index.ts:28-48` (`evaluate`, `explain`)
- `src/permission/index.ts:196-208` (`fromConfig`)
- `src/permission/arity.ts:1-9` (`BashArity.prefix`)
- `src/tool/shell.ts:119-152` (`source`, `spaced`, `permissionPatterns`)

Left out on purpose: `ask` / `reply` (`index.ts:77-177`), because no property calls them (R1 and R2 build the "always" rule the same way `reply` does, then call `evaluate`), so every mutant there would survive without saying anything about the properties. `packages/core/src/util/wildcard.ts` is in another package, outside the folder Stryker runs from; H4 covers it by hand instead.

**Initial mutation score (raw, as Stryker reports it): 72.12%.** 104 mutants: 73 killed, 2 timed out (counted as killed), 29 survived, 0 without coverage, 0 errors. Rerunning with the same seed gave the same numbers.

| File | Score | Killed | Timeout | Survived |
|---|---|---|---|---|
| `permission/index.ts` | 91.43% | 32 | 0 | 3 |
| `permission/arity.ts` | 47.06% | 7 | 1 | 9 |
| `tool/shell.ts` | 67.31% | 34 | 1 | 17 |

**(a) Which hand-written mutants did Stryker never generate, and why not?**

- H1 (`len > 0` to `len > 1`): Stryker's equality mutator only swaps the operator (`>=`, `<=`) and never changes the constant, so it made `len >= 0` and `len <= 0` but not `len > 1`. Its `len <= 0` and `false` mutants (lookup skipped entirely) do survive for the same reason H1 does.
- H2 (`rulesets.toReversed()`): Stryker removes or swaps method calls but never inserts a new one.
- H3 (deny-first early return): this adds a new branch and a new idea ("deny always wins"). Stryker only makes small edits to existing code.
- H4 (drop the regex `s` flag): `wildcard.ts` is outside my Stryker scope. If it were in scope, a string mutation of `"s"` to `""` would come close.
- H5 (drop one operand of `&&` in `explain`): Stryker swapped `&&` for `||` and replaced the whole condition with `true` or `false` (all killed), but it did not replace just one operand inside this arrow function, so the exact H5 change was never made.

**(b) Which Stryker survivors would I never have thought of? Would a real developer plausibly write them?**

- `BashArity.prefix` with the lookup loop removed or disabled (`for (...) {}`, `false`, `if (false) return ...`, `tokens.join(" ")` instead of `tokens.slice(0, len)`): I would not have guessed that removing the whole arity lookup survives. A developer is unlikely to delete the loop, but `tokens.join(" ")` (forgetting the slice) is a plausible slip. It shows the R1 properties never check the arity result against anything independent.
- The default rule's `pattern: "*"` changed to `""` in `evaluate`: plausible as a careless edit, and visible to anyone who reads the returned rule (for example through `explain`).
- `shell.ts` redirect handling (`node.parent?.type === "redirected_statement"` flipped or forced): I did not think about redirections (`ls > out.txt`) at all. A developer could easily get this condition backwards.
- `shell.ts` details such as the `isGap` regex anchors, `NESTED` set entries, and the PowerShell `command_argument_sep` check: I would not have written these; some may be equivalent (decided under Strengthening).

**(c) What does each approach find that the other doesn't?**

Hand-written mutants test the ideas behind a requirement: wrong ruleset order (H2), a "safer" precedence rule (H3), and input classes the generators never reach (H4 newlines, H5 other tools). Stryker cannot invent these, because each needs a new expression rather than a small edit. Stryker is exhaustive over small edits in the code I scoped, and found whole areas no property checks: the arity lookup, the default rule's shape, and redirections in the shell parser. It also produces mutants that change nothing observable, which hand-written mutants avoid by design.
