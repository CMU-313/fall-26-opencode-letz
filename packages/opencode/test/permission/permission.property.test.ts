import { test, expect } from "bun:test"
import fc from "fast-check"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Permission } from "../../src/permission"
import { BashArity } from "../../src/permission/arity"
import { permissionPatterns } from "../../src/tool/shell"

type Rule = PermissionV1.Rule
type Action = Rule["action"]

// Bash reserved words are not commands, so random names skip them.
const RESERVED = new Set(
  "if then else elif fi case esac for select while until do done in function time coproc".split(" "),
)

// Generators.
// Commands are a real "human command" (from BashArity's table, incl. multi-token
// ones like git commit / npm run dev) or a random lowercase name.
const commandName = fc.oneof(
  fc.constantFrom(
    ["ls"],
    ["rm"],
    ["cat"],
    ["git", "commit"],
    ["git", "push"],
    ["gh", "pr", "merge"],
    ["npm", "install"],
    ["npm", "run", "dev"],
    ["docker", "compose", "up"],
  ),
  fc
    .stringMatching(/^[a-z][a-z0-9_-]{0,7}$/)
    .filter((name) => !RESERVED.has(name))
    .map((name) => [name]),
)

// Args hit the boundaries interviewees cared about: flags (-rf, --force),
// quoted text, regex metacharacters, backslashes, glob chars, and empty quotes.
const arg = fc.oneof(
  fc.constantFrom('""', "-rf", "--force", "-m", '"first"', "'a b'", "*", "?", "a\\b", "C:\\dir"),
  fc
    .constantFrom(".", "+", "^", "$", "(", ")", "[", "]", "|", "{", "}")
    .chain((meta) => fc.string({ maxLength: 4 }).map((rest) => meta + rest.replace(/\s/g, ""))),
  fc.string({ minLength: 1, maxLength: 8 }).filter((text) => !/\s/.test(text)),
)
const args = fc.array(arg, { maxLength: 4 })

// Raw shell source keeps the user's spacing, so tokens may be split by
// several spaces or a tab, not just one space. R1/R2 run the text through
// ShellTool's real parser (permissionPatterns) to get the asked pattern.
const separator = fc.constantFrom(" ", "  ", "\t")

// Single-quote anything that is not a plain word, so each arg stays one shell
// word (metacharacters like | ( $ would otherwise split the command).
function quote(token: string) {
  if (/^[A-Za-z0-9_.\/=:,@+%-]+$/.test(token)) return token
  return "'" + token.replaceAll("'", "'\\''") + "'"
}

// The single pattern ShellTool asks for when the user runs this text.
async function asked(text: string) {
  const patterns = await permissionPatterns(text)
  expect(patterns).toHaveLength(1)
  return patterns[0]
}

function join(tokens: string[], separators: string[]) {
  return tokens.map((token, i) => (i === 0 ? token : separators[i % separators.length] + token)).join("")
}

// Same construction as ShellTool: BashArity.prefix(tokens).join(" ") + " *".
function alwaysPattern(tokens: string[]) {
  return BashArity.prefix(tokens).join(" ") + " *"
}

// Same shape as Permission.reply pushes for an "always" answer.
function approve(tokens: string[]): Rule {
  return { permission: "bash", pattern: alwaysPattern(tokens), action: "allow" }
}

// R1: When the user picks "always allow" for a shell command, later commands
// that differ only in their arguments (same command, e.g. git commit) are also
// allowed without asking again.
// Kind: metamorphic (changing only the arguments must not change the result)
test("R1: after always-allow, the same command with different arguments is allowed", async () => {
  await fc.assert(
    fc.asyncProperty(
      commandName,
      args,
      args,
      fc.array(separator, { minLength: 1, maxLength: 4 }),
      async (name, argsA, argsB, seps) => {
        const first = [...name, ...argsA.map(quote)]
        const human = BashArity.prefix(first)
        const second = [...human, ...argsB.map(quote)]
        // "Same command" means BashArity sees the same human command for both.
        fc.pre(BashArity.prefix(second).join(" ") === human.join(" "))
        const approved = [approve(first)]
        const pattern = await asked(join(second, seps))
        expect(Permission.evaluate("bash", pattern, approved).action).toBe("allow")
      },
    ),
  )
})

// R1 (boundary): "same command" must not stretch to a lookalike command such
// as "git commitx" or "lsx".
// Kind: invariant
test("R1: always-allow does not cover a different command that shares a prefix", () => {
  fc.assert(
    fc.property(commandName, args, fc.stringMatching(/^[a-z0-9]{1,3}$/), (name, rest, glued) => {
      const human = BashArity.prefix([...name, ...rest])
      const lookalike = [...human.slice(0, -1), human[human.length - 1] + glued, ...rest]
      const approved = [approve([...name, ...rest])]
      expect(Permission.evaluate("bash", lookalike.join(" "), approved).action).toBe("ask")
    }),
  )
})

// Config rules for bash that never deny the approved command (a deny would
// block it before the user could ever pick "always").
const configAction = fc.constantFrom<Action>("ask", "allow", "deny")
const configPattern = fc.constantFrom("*", "rm *", "git *", "git push *", "npm *", "ls", "cat *")
const configRules = fc.array(
  fc.record({ permission: fc.constantFrom("bash", "*"), pattern: configPattern, action: configAction }),
  { maxLength: 6 },
)

// R2: After the user picks "always allow" for a command, the tool does not ask
// about that same command again for the rest of the session.
// Kind: invariant (every later evaluation in the session stays "allow")
test("R2: an always-allowed command stays allowed for the rest of the session", async () => {
  await fc.assert(
    fc.asyncProperty(
      configRules,
      commandName,
      args,
      fc.array(fc.tuple(commandName, args), { maxLength: 4 }),
      fc.integer({ min: 1, max: 5 }),
      fc.array(separator, { minLength: 1, maxLength: 3 }),
      async (config, name, rest, laterApprovals, repeats, seps) => {
        const tokens = [...name, ...rest.map(quote)]
        const command = await asked(join(tokens, seps))
        fc.pre(Permission.evaluate("bash", command, config).action !== "deny")
        // Session approvals only grow, and only with allow rules.
        const approved = [approve(tokens), ...laterApprovals.map(([n, a]) => approve([...n, ...a.map(quote)]))]
        for (let i = 0; i < repeats; i++) {
          expect(Permission.evaluate("bash", command, config, approved).action).toBe("allow")
        }
      },
    ),
  )
})

// R3: If the config has a catch-all "*": "allow" and no other rule matches,
// every command is allowed, including destructive ones.
// Kind: invariant
test('R3: with only {"*": "allow"}, every command is allowed', () => {
  const destructive = fc.constantFrom<string[]>(
    ["rm", "-rf", "/"],
    ["git", "push", "--force"],
    ["gh", "pr", "merge", "12"],
  )
  const anyCommand = fc.oneof(
    destructive,
    fc.tuple(commandName, args).map(([n, a]) => [...n, ...a]),
  )
  // Permission names include real tools and arbitrary strings.
  const permission = fc.oneof(fc.constantFrom("bash", "edit", "read", "webfetch", "mcp_x"), fc.string())
  fc.assert(
    fc.property(permission, anyCommand, fc.array(separator, { minLength: 1 }), (perm, tokens, seps) => {
      const ruleset = Permission.fromConfig({ "*": "allow" })
      expect(Permission.evaluate(perm, join(tokens, seps), ruleset).action).toBe("allow")
    }),
  )
})

// Rules whose patterns are command prefixes like "rm *" or the catch-all "*".
const rule = fc.record({
  permission: fc.constantFrom("bash", "*"),
  pattern: fc.oneof(
    fc.constant("*"),
    commandName.map((name) => name.join(" ") + " *"),
    commandName.map((name) => name.join(" ")),
  ),
  action: configAction,
})

// Reference model: the documented "last matching rule wins, default ask".
function lastMatchWins(permission: string, pattern: string, rules: Rule[]): Action {
  let action: Action = "ask"
  for (const candidate of rules) {
    const permissionMatches = candidate.permission === "*" || candidate.permission === permission
    if (permissionMatches && matches(candidate.pattern, pattern)) action = candidate.action
  }
  return action
}

// Independent pattern check for the oracle: "*" matches anything, "cmd *"
// matches cmd alone or cmd followed by whitespace, otherwise exact text.
function matches(rulePattern: string, command: string) {
  if (rulePattern === "*") return true
  const words = command.split(/[ \t]+/)
  if (rulePattern.endsWith(" *")) {
    const head = rulePattern.slice(0, -2).split(" ")
    return head.every((word, i) => words[i] === word)
  }
  return words.join(" ") === rulePattern
}

// R4 (revised): Rules that cannot both match the same command can be written
// in any order without changing the result; order only matters between rules
// that overlap, where the later one wins.
// Kind: model/oracle (evaluate agrees with a plain last-match-wins model)
test("R4: evaluate agrees with a last-match-wins reference model", () => {
  fc.assert(
    fc.property(fc.array(rule, { maxLength: 8 }), commandName, args, (rules, name, rest) => {
      const command = [...name, ...rest].join(" ")
      expect(Permission.evaluate("bash", command, rules).action).toBe(lastMatchWins("bash", command, rules))
    }),
  )
})

// R4 (revised), second half.
// Kind: metamorphic (permuting rules that never overlap on the command keeps the result)
test("R4: reordering rules that cannot both match the command does not change the result", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(commandName, { selector: (name) => name.join(" "), maxLength: 6 }),
      fc.array(configAction, { minLength: 6, maxLength: 6 }),
      commandName,
      args,
      fc.integer(),
      (names, actions, target, rest, seed) => {
        // Exact-command rules for distinct human commands never overlap.
        const rules: Rule[] = names.map((name, i) => ({
          permission: "bash",
          pattern: name.join(" ") + " *",
          action: actions[i],
        }))
        const shuffled = [...rules].sort((a, b) => hash(a.pattern, seed) - hash(b.pattern, seed))
        const command = [...target, ...rest].join(" ")
        // A random name like "git" can overlap "git commit *", so skip those cases.
        fc.pre(rules.filter((r) => matches(r.pattern, command)).length <= 1)
        expect(Permission.evaluate("bash", command, shuffled).action).toBe(
          Permission.evaluate("bash", command, rules).action,
        )
      },
    ),
  )
})

function hash(text: string, seed: number) {
  let value = seed
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) | 0
  return value
}

// The P3 acceptance example for R4, kept as a concrete check of the revision:
// overlapping rules still follow last-match-wins.
test('R4: {"*": "ask", "rm *": "deny"} denies rm, and reversed order asks', () => {
  const ordered = Permission.fromConfig({ bash: { "*": "ask", "rm *": "deny" } })
  const reversed = Permission.fromConfig({ bash: { "rm *": "deny", "*": "ask" } })
  expect(Permission.evaluate("bash", "rm file.txt", ordered).action).toBe("deny")
  expect(Permission.evaluate("bash", "ls", ordered).action).toBe("ask")
  expect(Permission.evaluate("bash", "rm file.txt", reversed).action).toBe("ask")
})

// R5 (revised): When a command matches more than one rule with different
// actions, the result identifies the rule that decided the outcome and the
// matching rules it overrode.
// Kind: invariant (decidedBy is what evaluate returns; overridden is every
// earlier matching rule with a different action, in order)
test("R5: explain names the deciding rule and the rules it overrode", () => {
  fc.assert(
    fc.property(fc.array(rule, { maxLength: 8 }), commandName, args, (rules, name, rest) => {
      const command = [...name, ...rest].join(" ")
      const result = Permission.explain("bash", command, rules)
      const decider = Permission.evaluate("bash", command, rules)
      const earlier = rules.filter((r) => matches(r.pattern, command)).slice(0, -1)
      expect(result.decidedBy).toEqual(decider)
      expect(result.overridden).toEqual(earlier.filter((r) => r.action !== decider.action))
    }),
  )
})

// Regression for the whitespace fix found by R1/R2: extra spaces or a tab
// must not slip a command past a deny rule.
test('deny rule "rm -rf *" still applies with extra spaces or tabs', async () => {
  const ruleset = Permission.fromConfig({ bash: { "*": "allow", "rm -rf *": "deny" } })
  for (const command of ["rm -rf /", "rm  -rf /", "rm\t-rf /"]) {
    expect(Permission.evaluate("bash", await asked(command), ruleset).action).toBe("deny")
  }
})

// The fix must not loosen quoted arguments: spacing inside a quoted or escaped
// part is part of the argument, so only the gaps between parts shrink.
// Generators: plain words plus bash "..", '..', $'..' (with an escaped quote)
// and backslash-escaped spaces; PowerShell adds "C:\" (no backslash escape).
// PowerShell gaps use spaces only: its grammar already fails on a tab after
// the command name (no command is found at all), which is out of scope here.
// Kind: invariant
const inner = fc
  .array(fc.constantFrom("a", " ", "  ", "\t", "b"), { minLength: 1, maxLength: 5 })
  .map((x) => x.join(""))
const word = fc.stringMatching(/^[a-z0-9.\/-]{1,6}$/)
test("bash: spacing inside quotes and escapes is kept, gaps between words shrink", async () => {
  const part = fc.oneof(
    word,
    inner.map((x) => `"${x}"`),
    inner.map((x) => `'${x}'`),
    inner.map((x) => `$'\\'${x}'`),
    word.map((x) => `${x}\\  ${x}`),
  )
  await fc.assert(
    fc.asyncProperty(
      word,
      fc.array(part, { maxLength: 4 }),
      fc.array(separator, { minLength: 1 }),
      async (cmd, parts, seps) => {
        expect(await asked(join([cmd, ...parts], seps))).toBe([cmd, ...parts].join(" "))
      },
    ),
  )
})

test("powershell: spacing inside quotes is kept, gaps between words shrink", async () => {
  // A leading "-" makes a PowerShell parameter, and "-/" is not valid syntax.
  const psWord = fc.stringMatching(/^[a-z0-9.\/][a-z0-9.\/-]{0,5}$/)
  const part = fc.oneof(
    psWord,
    inner.map((x) => `"${x}"`),
    inner.map((x) => `'${x}'`),
    fc.constant('"C:\\"'),
  )
  const gap = fc.constantFrom(" ", "  ", "   ")
  await fc.assert(
    fc.asyncProperty(
      fc.array(part, { minLength: 1, maxLength: 4 }),
      fc.array(gap, { minLength: 1 }),
      async (parts, gaps) => {
        const command = ["Write-Output", ...parts]
        expect(await permissionPatterns(join(command, gaps), true)).toEqual([command.join(" ")])
      },
    ),
  )
})
