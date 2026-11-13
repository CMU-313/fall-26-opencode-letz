# Project 5 Extra Credit: Cross-Team Red Team

Author: Tiffany Liu (`tiffany4`)
Target: Mira Thope (`mthope`), Team Meap
Target PR: https://github.com/CMU-313/fall-26-opencode-meap/pull/40
Exact studied PR head: `52afff417ea1ae9f1e16921eb0800c7da7b726eb`

All three patches independently modify only `packages/opencode/src/permission/index.ts`. Apply one at a time to the exact commit above, not cumulatively. No target tests were edited. The entire `traceability/mthope.md`, permission implementation, property file, and supporting wildcard implementation were inspected. Requirements below quote the revised requirements table at this commit.

## Mutant 1 — Reverse precedence between rulesets

**Exact requirement R2:** When more than one rule matches a command, `evaluate()` always picks the last matching rule in the order the rulesets were given, and reordering the rules changes the result in exactly that predictable way.

**Bug:** Add `.toReversed()` before flattening the supplied rulesets. A developer trying to search later sources first accidentally reverses the sources while retaining `findLast()`, so the earlier source wins. Rules within a single source retain their original precedence.

**Concrete violation:** Evaluating `bash`, `git status` with first ruleset `[{permission: "bash", pattern: "*", action: "allow"}]` and second ruleset `[{permission: "bash", pattern: "git status", action: "deny"}]` returns allow instead of deny.

**Property gap:** `R2: swapping two matching rules swaps which one wins` supplies both rules in one array. It never swaps or compares separate ruleset arguments. R1 also supplies a single array; R5 merges its arrays before evaluation. All four properties passed in the observed run. The existing unit test `evaluate - merges multiple rulesets` kills this mutant (78 pass, 1 fail).

```diff
diff --git a/packages/opencode/src/permission/index.ts b/packages/opencode/src/permission/index.ts
index 2e27ff2..45c7955 100644
--- a/packages/opencode/src/permission/index.ts
+++ b/packages/opencode/src/permission/index.ts
@@ -28,6 +28,7 @@ interface State {
 export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
   return (
     rulesets
+      .toReversed()
       .flat()
       .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
       action: "ask",
```

## Mutant 2 — Broaden remembered always grants

**Exact requirement R5:** Replying "always" to a request adds allow rules for exactly the patterns in that request's `always` list, and no other pattern is affected.

**Bug:** Store `pattern.split(" ")[0] + " *"` instead of the supplied pattern in `reply()`. This is a plausible attempt to normalize a command into a reusable command-family grant, but it silently broadens approval beyond the user's supplied `always` list.

**Concrete violation:** Always-approving exactly `git status` remembers `git *`. A subsequent `git push origin main` becomes allowed, even with a matching configured deny rule, because remembered grants have later precedence. The actual wildcard matcher treats the trailing ` *` as optional, so the original command still matches.

**Property gap:** `R5: an 'always allow' grant covers exactly its own patterns, nothing more` constructs grants itself with `alwaysPatterns.map(...)`, calls `merge()`, and never calls `reply()`. It therefore cannot observe this implementation bug. All four properties and all 79 existing permission unit/integration tests passed. A supplemental real-service check calling `ask()`, `reply("always")`, then `ask()` for the unapproved command fails only with this mutant.

```diff
diff --git a/packages/opencode/src/permission/index.ts b/packages/opencode/src/permission/index.ts
index 2e27ff2..e5adff3 100644
--- a/packages/opencode/src/permission/index.ts
+++ b/packages/opencode/src/permission/index.ts
@@ -145,7 +145,7 @@ const layer = Layer.effect(
       for (const pattern of existing.info.always) {
         approved.push({
           permission: existing.info.permission,
-          pattern,
+          pattern: pattern.split(" ")[0] + " *",
           action: "allow",
         })
       }
```

## Mutant 3 — Stale rules after adding/removing entries

**Exact requirement R6:** A rule change takes effect on the very next `evaluate()` call, and removing it restores the exact earlier result, with nothing left over.

**Bug:** Cache flattened rule snapshots in a `WeakMap` keyed by the ruleset array. This plausible allocation-saving optimization assumes array identity implies unchanged contents. It never invalidates cached snapshots after `push()`, `pop()`, or another in-place edit. No remove-rule API exists here; the feature and R6 property operate on caller-owned arrays.

**Concrete violation:** Evaluate an array containing a wildcard ask rule, append a matching deny rule to the same array, then evaluate again. The original implementation returns deny immediately; the mutant still returns ask. Conversely, if the first evaluation happens while an added rule is present, removing that rule leaves its cached decision active.

**Property gap:** `R6: adding then removing a rule returns to the original decision` evaluates after `live.push(newRule)` but discards that result. It only asserts that the final result after `pop()` equals the original. A stale snapshot satisfies that assertion while completely ignoring the addition. All four properties passed. The wider suite catches related stale remembered grants: `reply - always persists approval and resolves` and `reply - always resolves matching pending requests in same session` time out (77 pass, 2 fail; 10-second timeout per test).

```diff
diff --git a/packages/opencode/src/permission/index.ts b/packages/opencode/src/permission/index.ts
index 2e27ff2..72601e1 100644
--- a/packages/opencode/src/permission/index.ts
+++ b/packages/opencode/src/permission/index.ts
@@ -25,10 +25,18 @@ interface State {
   approved: PermissionV1.Rule[]
 }
 
+const ruleCache = new WeakMap<PermissionV1.Ruleset, PermissionV1.Rule[]>()
+
 export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
   return (
     rulesets
-      .flat()
+      .flatMap((ruleset) => {
+        const cached = ruleCache.get(ruleset)
+        if (cached) return cached
+        const rules = [...ruleset]
+        ruleCache.set(ruleset, rules)
+        return rules
+      })
       .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
       action: "ask",
       permission,
```

## Validation

Environment: Bun 1.3.14 on macOS; dependencies installed with `bun install --frozen-lockfile` in an isolated detached worktree. Source was restored to the exact studied commit before each independent mutation and after testing. `git apply --check` passed for each patch against that commit.

Commands run from `packages/opencode`:

```sh
bun test test/permission/permission.property.test.ts --timeout 10000
bun test test/permission/next.test.ts --timeout 10000
bun typecheck
```

| Version | Mira's properties | Existing next.test.ts | Supplemental checks | Typecheck |
| --- | --- | --- | --- | --- |
| Original commit | 4 pass | 79 pass | 3 pass | pass |
| Mutant 1 | 4 pass | 78 pass, 1 fail | 2 pass, precedence check fails | pass |
| Mutant 2 | 4 pass | 79 pass | 2 pass, grant-scope check fails | pass |
| Mutant 3 | 4 pass | 77 pass, 2 timeout failures | 2 pass, immediate-addition check fails | pass |

Supplemental checks were run in a separate temporary test file, removed afterward; Mira's existing tests were unchanged. These checks exercised exported functions and the real permission service, without replacing their logic. Property outcomes describe the observed randomized runs, not a proof of survival for every seed. Mutants are intentionally incorrect; they are submitted only as patch artifacts, not applied to the submission branch.

To reproduce patch application in an isolated checkout of the studied commit:

```sh
git apply --check /absolute/path/to/mutant1.patch
git apply /absolute/path/to/mutant1.patch
# Run the package-level commands above.
git apply --reverse /absolute/path/to/mutant1.patch
# Repeat independently with mutant2.patch and mutant3.patch.
```
