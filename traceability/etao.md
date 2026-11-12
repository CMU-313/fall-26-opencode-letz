# Traceability: Ethan Tao (etao)

**Target feature:** opencode permission rules (allow / ask / deny for a tool or shell command). Main source files: `packages/opencode/src/permission/index.ts` (`evaluate`, `fromConfig`, `ask` / `reply`, new `explain`), `packages/core/src/util/wildcard.ts` (`Wildcard.match`), `packages/opencode/src/permission/arity.ts` (`BashArity.prefix`), and `packages/opencode/src/tool/shell.ts` (parses the command and builds the asked and "always" patterns).

## Requirements

All tests are in `packages/opencode/test/permission/permission.property.test.ts`.

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | S-3, O-2 | When the user picks "always allow" for a shell command, later commands that run the same command (same `BashArity` prefix, e.g. `git commit`) and differ only in the arguments after it are also allowed without asking again, however many spaces, tabs, or line continuations (bash `\` + newline, PowerShell backtick + newline) separate the words. Every simple command in a pipeline or list is asked about with its own redirections. Commands that put flags before the subcommand (`git -C dir commit`) are out of scope. | User picks "always allow" for `git commit -m "first"`. The agent then runs `git commit -m "second"` (or `git commit\t-m "second"`) with no prompt. `git commitx` still asks. | Yes | Same command with different args stays allowed (metamorphic); lookalike command is not covered (invariant) | "R1: after always-allow, the same command with different arguments is allowed"; "R1: always-allow does not cover a different command that shares a prefix"; P5 added "R1: BashArity.prefix returns the known human command...", "R1: always-allow for one subcommand still asks for a different subcommand...", "R1: BashArity.prefix is a non-empty leading slice...", "R1: every simple command in a pipeline or list keeps its redirections", "R1: a command with a redirection is never dropped...", and three line-continuation properties | H1; Stryker: `arity.ts` lookup (15 of 17 killed or timed out; the other 2 are equivalent) and `shell.ts` pattern building (149 of 174) |
| R2 | S-12, C-11, O-10 | After the user picks "always allow" for a command, the tool does not ask about that same command again for the rest of the session. | User picks "always allow" for `ls`. The agent then runs `ls` three more times in the same session, and the user sees zero further prompts. | No | Every later evaluation in the session stays allow, whatever the config and later approvals (invariant) | "R2: an always-allowed command stays allowed for the rest of the session" | H2; Stryker: none beyond the `evaluate` mutants R4 also kills |
| R3 | S-6, C-6, O-4 | If the config has a catch-all `"*": "allow"` and no other rule matches, every command is allowed, including destructive ones. | With only the rule `{"*": "allow"}`, `rm file.txt`, `git push --force`, and `gh pr merge 12` all evaluate to allow and run with no prompt. | No | Any permission and any command evaluates to allow (invariant) | "R3: with only {"*": "allow"}, every command is allowed" | H4 (after P5 strengthening) |
| R4 | S-9, S-11 | Rules that cannot both match the same command give the same result in any order. Order only matters between rules that overlap, and then the later rule wins (last match wins). | `{"rm *": "deny", "git push *": "ask"}` in either order gives deny for `rm file.txt` and ask for `git push`. `{"*": "ask", "rm *": "deny"}` gives deny for `rm file.txt` and ask for `ls`; in reverse order `rm file.txt` gives ask, because the later `"*"` overlaps and wins. | Yes | `evaluate` agrees with a plain last-match-wins reference (model/oracle); shuffling non-overlapping rules keeps the result (metamorphic) | "R4: evaluate agrees with a last-match-wins reference model"; "R4: reordering rules that cannot both match the command does not change the result"; "R4: {"*": "ask", "rm *": "deny"} denies rm, and reversed order asks" | H3; Stryker: `evaluate` (`index.ts:28-38`) and `fromConfig` (`index.ts:196-208`) mutants |
| R5 | S-10, S-8 | When a command matches more than one rule with different actions, the permission system reports which rule decided the outcome and which earlier matching rules with a different action it overrode. | With rules `{"*": "ask", "rm *": "deny"}`, `Permission.explain("bash", "rm file.txt", rules)` returns `decidedBy` = `"rm *"` (deny) and `overridden` = [`"*"` (ask)]. | Yes | `decidedBy` equals `evaluate`'s result and `overridden` equals every earlier matching rule with a different action (invariant) | "R5: explain names the deciding rule and the rules it overrode" | H3, H5 (after P5 strengthening); Stryker: `explain` (`index.ts:41-48`) mutants except one equivalent |

Properties written or suggested by opencode or another AI tool: R1, R2, R3, R4, R5 (properties and generators written by an AI coding assistant; reviewed by me). The P5 strengthening was also written by an AI coding assistant working only from the requirements and the public interface, then checked by me against every mutant.

Stryker's command runner does not say which test killed a mutant, so the Stryker part of "Mutants it kills" lists the code each requirement's properties exercise.

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
| R1 line continuation (P5, from Stryker survivors on `isGap`) | `rm \` + newline + ` -rf /` | Code bug: the continuation was kept raw, so a `rm -rf *` deny rule was bypassed (allowed) | Fixed in `shell.ts`: spaces, tabs and continuations shrink to one space |
| R1 join (P5, found by the implementer) | `r\` + newline + `m -rf /` | Code bug: bash deletes backslash-newline, so this is `rm -rf /`, but the pattern kept `r\`+newline+`m` and bypassed the deny rule | Fixed: a bare continuation joins the word |
| R1 redirections (P5, test writer) | `. > /etc/- \| / > /etc/0` | Code bug: a redirection after `\|`, `&&` or `\|\|` was dropped from its command's pattern | Fixed: the trailing redirection stays on the last command |
| R1 vanishing command (P5, test writer) | `- 2>out.txt` | Code bug: the parser skips a bare `-` before `2>`, so no pattern was asked | Fixed: the skipped name is recovered from the input |
| Bash backslash-CRLF (P5) | `ec\` + CRLF + `ho` | Spec error: real bash 3.2.57 runs `ec\r` then `ho`, so it is not a continuation | Only backslash + LF counts in bash; PowerShell backtick + CRLF does |

Found, not fixed (out of scope): the PowerShell grammar returns a parse error for `Write-Host<tab>foo` (and for `Write-Output  -/`), so ShellTool finds no command and asks no bash permission at all. This exists on `main` too and only affects PowerShell; a fix needs a fail-closed rule for parse errors.

Found in P5, not fixed (all exist before the P5 fixes; each needs a new parser workaround, so they are recorded instead):

- Leading words the parser drops: `- 2>e x` asks `2>e x`, and `- \`+newline+`FOO=1 b >> f` asks `FOO=1 b >> f`.
- PowerShell backtick continuation right after `$(...)` or `@(...)` stays raw: `Write-Output $(Get-Item x)`+backtick+newline+` b`.
- PowerShell backtick with no space before it: `Write-Output`+backtick+newline+`0` gives `Write-Output`+backtick.
- PowerShell colon parameter with a digit in its name splits: `Write-Output -A0a:0` gives `["Write-Output -A", "0a:0"]`.
- Redirection on a group: `(a | b) > x` and `{ a; b; } > x` give `["a", "b"]`.
- Heredoc inside a pipeline: `cat <<EOF | b > x` gives the whole text as `cat`'s pattern.
- A joined word is fixed only in the pattern: ShellTool's own tokens for `r\`+newline+`m` are still `r`, `m`, so the "always" rule and the `rm` path check use `r`.

Mutation checks: making the spacing rebuild a no-op makes R1, R2, the regression test, both spacing invariants, and the ShellTool test fail; putting back the dropped quote scanner makes both spacing invariants fail on the reviewer's cases; dropping the action filter in `explain` makes R5 fail; switching `evaluate` from `findLast` to `find` makes the R4 oracle test fail.

## Hand-written mutants

Patches are in `mutants/etao/` (apply from the repo root with `git apply`). Predictions were written and committed before any mutant was run; the "Actual result" column is filled in afterward. Property tests run with fast-check seed 42.

| ID | Requirement targeted | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| [H1](../mutants/etao/H1.patch) | R1 | `permission/arity.ts`: `prefix` loops `len > 1` instead of `len > 0`, so a one-word entry like `git: 2` is never looked up. `git commit -m x` becomes `git`, and "always allow" for `git commit` turns into `git *`, which also allows `git push`. | Probably none. Both R1 properties build their expected "same command" with `BashArity.prefix` itself, so the oracle shrinks along with the code. The lookalike property only glues text onto the last word (`gitx`), never tries a different subcommand like `git push`. R2 also only checks the approved command stays allowed. I expect it to survive. | Survived, as predicted: all 11 tests passed. The R1 oracle uses `BashArity.prefix`, so it accepted the shortened `git *` approval. After strengthening: killed by three new R1 properties (independent arity table, sibling subcommands), counterexample `git push` with no args. |
| [H2](../mutants/etao/H2.patch) | R2 | `permission/index.ts`: `evaluate` reverses the rulesets before flattening (`rulesets.toReversed().flat()`), as if session approvals should be checked first. Since the last match wins, config rules now override the user's "always allow". | R2: "an always-allowed command stays allowed for the rest of the session". It calls `evaluate(command, config, approved)`, and the config generator often includes a matching `"*": "ask"` or `"git *": "ask"`, which now wins over the approval. R1, R3, R4, R5 pass one ruleset, so they should not notice. | Killed by R2, as predicted (1 failed, 10 passed). Counterexample: config `[{bash, "*", ask}]`, command `a`; the config ask beat the approval. |
| [H3](../mutants/etao/H3.patch) | R4 | `permission/index.ts`: `evaluate` returns the first matching deny rule before falling back to last match wins ("deny always wins, so a later allow can never undo it"). With `{"rm *": "deny", "*": "ask"}`, `rm file.txt` gives deny instead of ask. | R4: "evaluate agrees with a last-match-wins reference model". The rule generator mixes `"*"` and command rules with all three actions, so a deny followed by a later overlapping allow or ask should come up quickly. R5 should not catch it, because its oracle uses `evaluate`'s own answer as the decider. | Killed by R4 model property, as predicted, and also by the R4 `{"*": "ask", "rm *": "deny"}` example check (2 failed, 9 passed). Counterexample: `[{bash, "*", deny}, {bash, "*", ask}]` for `a`. R5 passed, as predicted. |
| [H4](../mutants/etao/H4.patch) | R3 | `core/util/wildcard.ts`: `match` drops the regex `s` flag (`"win32" ? "i" : undefined`), so `.*` no longer matches a newline. With only `{"*": "allow"}`, a multi-line command such as `rm a\nb` no longer matches `*` and falls back to ask. | Probably none. R3's commands never contain a newline: the arg generators strip whitespace, and `fc.string()` in fast-check 4.10.2 produces printable ASCII only, which also covers the random permission names. I expect it to survive. | Survived, as predicted: all 11 tests passed. No generated command contains a newline. After strengthening: killed by R3, which now generates newlines and `\r`; counterexample `rm -rf /` with a `\r` gap. |
| [H5](../mutants/etao/H5.patch) | R5 | `permission/index.ts`: `explain` filters matching rules by pattern only and forgets the permission check, so a rule for another tool (for example `edit` with pattern `*`) is reported as overridden for a bash command. | Probably none. R5's rule generator only uses permissions `bash` and `*`, and it always asks about `bash`, so every generated rule passes the permission check anyway. I expect it to survive. | Survived, as predicted: all 11 tests passed. No generated rule has a permission other than `bash` or `*`. After strengthening: killed by R5, which now generates rules for other tools; counterexample: two bash rules queried as `webfetch`. |

How each was run: `git apply mutants/etao/H<n>.patch`, then `bun test test/permission/permission.property.test.ts` from `packages/opencode`, then `git apply -R` the same patch. All 5 predictions held: 2 killed, 3 survived. The 3 survivors are handled under Strengthening. Rerun on the final properties (commit `eff99f2`): all 5 are killed; H2 by R2, H3 by R4 (model, fromConfig, example) and R5.

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
- H2 (`rulesets.toReversed()`): Stryker's method mutator removes a call or swaps it for a sibling (`every` and `some`, dropping `.trim()` or `.slice()`), but it does not add a new call like `.toReversed()`.
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

## Strengthening

All survivors were killed by changing properties only (no example-based tests were added). The changes, all in `permission.property.test.ts`:

- **R1 arity:** the old R1 properties computed the expected "same command" with `BashArity.prefix` itself, so even deleting the arity lookup survived. New properties check `prefix` against a hand-written table of human commands, check that approving one subcommand (`git commit`) still asks for a sibling (`git push`), and check that `prefix` always returns a non-empty leading slice (or `[]` for `[]`).
- **R3:** generators now include newlines, `\r` and heredoc-like text in commands and permission names (kills H4).
- **R4:** the model test compares the whole returned rule, including the default `{ask, <permission>, "*"}`, and a new property checks `fromConfig` output and evaluation against an independent last-match model.
- **R5:** rules now cover other tools, and the oracle requires the permission to match (kills H5). A first version of this change made R5 weaker: rules were spread so thin that only about 2% of cases had two matching rules with different actions, and three `explain` mutants that the P4 property had killed survived the second Stryker run. The generator now builds overlap on purpose (about 63% of cases).
- **Shell patterns (R1):** generators now produce redirections, pipelines and lists, line continuations (several in a row), PowerShell backtick continuations (LF and CRLF) and colon parameters.

Four real bugs came out of this (see Triage): line continuations between words and inside a word, redirections after `|`/`&&`/`||`, and a skipped `-` command. Each was fixed in `src/tool/shell.ts` only after its property was committed failing; undoing each fix separately makes its property fail again.

**How survivors were classified.** I did not label a survivor equivalent just because it was hard to kill. Each one was applied to the source and run on about 7,000 shell inputs I generated (2,506 bash, 4,500 PowerShell: gaps, continuations, pipes, lists, redirects, herestrings, heredocs, `-` commands, quotes, `$(...)`). This is a self-authored input set, not a benchmark. Survivors that changed any output were sent back for stronger properties (`isJoin` with one continuation, `skippedName` climbing, the PowerShell `-Name:v` case); the rest are argued below.

### Equivalent mutants (27)

| Mutant | Why it is equivalent |
|---|---|
| `arity.ts:2` `len > 0` to `len >= 0` | The extra pass looks up `ARITY[""]`, which is never defined, so the loop falls through exactly as before. |
| `arity.ts:7` `if (tokens.length === 0) return []` to `if (false)` | For empty input the fallback `tokens.slice(0, 1)` also returns `[]`. |
| `index.ts:46` `matching.slice(0, -1)` to `matching` | The extra element is the last matching rule, which is the deciding rule and has the same action, so the action filter removes it anyway. |
| `shell.ts:121`, `:122`, `:128` drop `.trim()` | A tree-sitter node's text starts and ends on a token, and these branches rebuild text from that node (or from the node to the end of its statement) without adding space at either end, so there is nothing to trim. (The plain `spaced(node).trim()` path at `shell.ts:124` does need its trim for PowerShell pipelines, and that mutant is killed.) |
| `shell.ts:122` `node.parent?.type` to `node.parent.type` | `source` only gets `command` nodes here (skipped statements return earlier), and a command always has a parent. |
| `shell.ts:131` `"heredoc_redirect"` and `"herestring_redirect"` to `""` | These names only matter when the redirect sits on a statement that wraps a whole pipeline or list, or on a statement whose command name was skipped. tree-sitter-bash attaches herestrings and heredocs to the command itself in every input tried, including pipelines, so neither lookup ever sees them. |
| `shell.ts:138` `lastChild?.equals` to `lastChild.equals` | The loop only reads `lastChild` of a pipeline or list node, which always has children. |
| `shell.ts:141` `body === node` to `false` | When the command is not inside a pipeline or list, a `redirected_statement` parent was already handled two lines earlier in `source`, so the remaining condition gives the same answer. |
| `shell.ts:141` `body.parent?.type` to `body.parent.type` | `body` is a command, pipeline or list inside a program, so it always has a parent. |
| `shell.ts:148` `node.type !== "redirected_statement"` to `false` | For a `command` node the next check fails anyway: a command always has a `command_name` child, so not every child is a redirect. |
| `shell.ts:152` `previousSibling?.endIndex` to `previousSibling.endIndex` | The loop above stops only when `before` is null or has a previous sibling, so when `before` is set the sibling exists. |
| `shell.ts:165` `isJoin` regex without `^` or without `$` | `isJoin` only sees the text between two parts of one command after `isGap` said no, and that text is either empty, a run of bare continuations, or non-whitespace that never contains a continuation, so the anchors never change the answer. |
| `shell.ts:181` `if (!child) continue` to `if (false)` | The children come from tree-sitter's child list or from non-null redirect nodes, so none is null. |
| `shell.ts:183` `if (at < 0) return text` to `if (false)` | Children appear in the text in order, so each child's text is always found at or after the cursor. |
| `shell.ts:187` `afterSpace = true` to `false` (gap branch) | The flag is only read by a following PowerShell separator, and the parser puts the whitespace inside the separator, so a whitespace gap is never directly followed by a separator. |
| `shell.ts:188` empty `isJoin` block, `:189` `afterSpace = false` to `true` | Joins only happen in bash, where there are no separator nodes; the flag is always false there and the next part resets it. |
| `shell.ts:190` `else if (gap)` to `true` | This only changes the empty-gap case to reset the flag, which matters only for two separators in a row; the PowerShell parser never produces those. |
| `shell.ts:194` separator condition to `true`, `:195` `if (!afterSpace)` to `true` | Only separator nodes are whitespace-only children, and a separator never follows a whitespace gap or another separator, so both conditions are already true or already false whenever they are reached. |
| `shell.ts:209` `if (!tree) throw` to `if (false)`, and its message to `""` | The parsers are created with a language set, and tree-sitter then always returns a tree for any string, so this branch cannot run. |
| `shell.ts:215` drop `.filter(Boolean)` | `descendantsOfType` never returns null entries. |

### Survivor that is not equivalent (1)

- `shell.ts:192` (`afterSpace = false` to `true` after non-gap text): it changes output only on PowerShell input like `Write-Output $(Get-Item x)`+backtick+newline+` b`, where the current code is already wrong (the continuation is kept raw, see Found, not fixed). A property for that input would have to assert the buggy output, so it is left alive and recorded with the bug.

### Final mutation score

| Run | Mutants | Killed (incl. timeout) | Survived | Raw score (Stryker) |
|---|---|---|---|---|
| Initial (`c2c5386`, P4 properties) | 104 | 75 | 29 | 72.12% |
| Final (`eff99f2`) | 226 | 198 | 28 | **87.61%** |

The final run has more mutants because the shell fixes added code inside the mutated range (`shell.ts:119-219`). **With the 27 equivalent mutants excluded: 198 / 199 = 99.50%.** Final report: [`mutants/etao/mutation.html`](../mutants/etao/mutation.html); first report: [`mutants/etao/mutation-initial.html`](../mutants/etao/mutation-initial.html).
