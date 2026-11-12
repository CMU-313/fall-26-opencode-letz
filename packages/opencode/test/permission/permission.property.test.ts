import { test, expect } from "bun:test"
import fc from "fast-check"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Permission } from "../../src/permission"
import { BashArity } from "../../src/permission/arity"
import { permissionPatterns } from "../../src/tool/shell"

// Fixed seed so mutation runs are reproducible (P5).
fc.configureGlobal({ seed: 42 })

type Rule = PermissionV1.Rule
type Action = Rule["action"]
type PermissionConfig = Parameters<typeof Permission.fromConfig>[0]

// Bash reserved words are not commands, so random names skip them.
const RESERVED = new Set(
  "if then else elif fi case esac for select while until do done in function time coproc".split(" "),
)

// Independent oracle for BashArity: the documented "human command" for each
// known tool, written out by hand (never computed with BashArity itself).
const HUMAN_COMMANDS: string[][] = [
  ["ls"],
  ["rm"],
  ["cat"],
  ["git", "commit"],
  ["git", "push"],
  ["git", "checkout"],
  ["npm", "install"],
  ["npm", "test"],
  ["npm", "run", "dev"],
  ["docker", "build"],
  ["docker", "compose", "up"],
  ["gh", "pr", "merge"],
  ["gh", "pr", "list"],
]

// Pairs of different subcommands of the same tool.
const SIBLING_SUBCOMMANDS: [string[], string[]][] = [
  [["git", "commit"], ["git", "push"]],
  [["git", "push"], ["git", "checkout"]],
  [["npm", "install"], ["npm", "test"]],
  [["npm", "run", "dev"], ["npm", "run", "build"]],
  [["docker", "compose", "up"], ["docker", "compose", "down"]],
  [["gh", "pr", "merge"], ["gh", "pr", "list"]],
]

// A "zq" prefix keeps random names out of the arity table, so their human
// command is just the name itself.
const unknownCommand = fc.stringMatching(/^[a-z]{1,6}$/).map((name) => "zq" + name)
const humanCommand = fc.oneof(fc.constantFrom(...HUMAN_COMMANDS), unknownCommand.map((name) => [name]))

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

// Independent wildcard matcher for the oracles: "*" is any run of characters,
// "?" one character, the rest literal, whole string. reached[j] means the
// pattern read so far can match the first j characters of the text.
function globMatch(pattern: string, text: string) {
  const chars = Array.from(text)
  let reached = chars.map(() => false)
  reached.unshift(true)
  for (const symbol of Array.from(pattern)) {
    const next = reached.map(() => false)
    let anyEarlier = false
    for (let j = 0; j <= chars.length; j++) {
      if (symbol === "*") {
        anyEarlier = anyEarlier || reached[j]
        next[j] = anyEarlier
      } else if (j > 0 && reached[j - 1] && (symbol === "?" || chars[j - 1] === symbol)) {
        next[j] = true
      }
    }
    reached = next
  }
  return reached[chars.length]
}

// A pattern ending in " *" also matches the text without that tail ("ls *" matches "ls").
function wildcardMatch(pattern: string, text: string) {
  if (pattern.endsWith(" *") && globMatch(pattern.slice(0, -2), text)) return true
  return globMatch(pattern, text)
}

function ruleMatches(rule: Rule, permission: string, pattern: string) {
  return globMatch(rule.permission, permission) && wildcardMatch(rule.pattern, pattern)
}

// Reference model: the documented "last matching rule wins, default ask".
function expectedRule(permission: string, pattern: string, rules: Rule[]): Rule {
  const matching = rules.filter((rule) => ruleMatches(rule, permission, pattern))
  if (matching.length === 0) return { action: "ask", permission, pattern: "*" }
  return matching[matching.length - 1]
}

// R1: When the user picks "always allow" for a shell command, later commands
// that differ only in their arguments (same command, e.g. git commit) are also
// allowed without asking again.
// Kind: metamorphic (changing only the arguments must not change the result)
test("R1: after always-allow, the same command with different arguments is allowed", async () => {
  await fc.assert(
    fc.asyncProperty(
      humanCommand,
      args,
      args,
      fc.array(separator, { minLength: 1, maxLength: 4 }),
      async (human, argsA, argsB, seps) => {
        const approved = [approve([...human, ...argsA.map(quote)])]
        const pattern = await asked(join([...human, ...argsB.map(quote)], seps))
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
    fc.property(humanCommand, args, fc.stringMatching(/^[a-z0-9]{1,3}$/), (human, rest, glued) => {
      const lookalike = [...human.slice(0, -1), human[human.length - 1] + glued, ...rest]
      const approved = [approve([...human, ...rest])]
      expect(Permission.evaluate("bash", lookalike.join(" "), approved).action).toBe("ask")
    }),
  )
})

// R1 (arity oracle): the approval pattern is built from the human command,
// so BashArity must return exactly the hand-written human command.
// Kind: model/oracle (hard-coded table)
test("R1: BashArity.prefix returns the known human command whatever arguments follow", () => {
  fc.assert(
    fc.property(humanCommand, args, (human, rest) => {
      const tokens = [...human, ...rest]
      expect(BashArity.prefix(tokens)).toEqual(human)
      expect(approve(tokens).pattern).toBe(human.join(" ") + " *")
    }),
  )
})

// R1 (boundary): approving git commit must not approve git push.
// Kind: invariant
test("R1: always-allow for one subcommand still asks for a different subcommand of the same tool", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...SIBLING_SUBCOMMANDS),
      fc.boolean(),
      args,
      args,
      fc.array(separator, { minLength: 1, maxLength: 4 }),
      async ([one, other], swap, argsA, argsB, seps) => {
        const approvedCommand = swap ? other : one
        const laterCommand = swap ? one : other
        const approved = [approve([...approvedCommand, ...argsA.map(quote)])]
        const pattern = await asked(join([...laterCommand, ...argsB.map(quote)], seps))
        expect(Permission.evaluate("bash", pattern, approved).action).toBe("ask")
      },
    ),
  )
})

// R1 (shape): the human command is a leading slice of the tokens, empty only
// for empty input.
// Kind: invariant
test("R1: BashArity.prefix is a non-empty leading slice of its input, and [] only for []", () => {
  const token = fc.oneof(
    fc.constantFrom("git", "commit", "npm", "run", "gh", "pr", "docker", "compose", "ls", "rm"),
    fc.string({ maxLength: 6 }),
  )
  fc.assert(
    fc.property(fc.array(token, { maxLength: 5 }), (tokens) => {
      const human = BashArity.prefix(tokens)
      expect(human).toEqual(tokens.slice(0, human.length))
      expect(human.length === 0).toBe(tokens.length === 0)
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

// Text that may hold newlines, carriage returns and other whitespace.
const multilineText = fc
  .array(fc.constantFrom("a", "b", " ", "\t", "\n", "\r", "\r\n", "*", "\\", "/"), { maxLength: 10 })
  .map((pieces) => pieces.join(""))

// R3: If the config has a catch-all "*": "allow" and no other rule matches,
// every command is allowed, including destructive ones.
// Kind: invariant
test('R3: with only {"*": "allow"}, every command is allowed', () => {
  const destructive = fc.constantFrom<string[]>(
    ["rm", "-rf", "/"],
    ["git", "push", "--force"],
    ["gh", "pr", "merge", "12"],
    ["rm", "-rf", "/\necho", "done"],
    ["cat", "<<EOF\nrm -rf /\nEOF"],
    ["bash", "-c", "'a\nb'"],
  )
  const anyCommand = fc.oneof(
    destructive,
    fc.tuple(commandName, args).map(([n, a]) => [...n, ...a]),
    fc.tuple(commandName, fc.array(multilineText, { maxLength: 3 })).map(([n, a]) => [...n, ...a]),
  )
  // Permission names include real tools, arbitrary strings, and multi-line text.
  const permission = fc.oneof(
    fc.constantFrom("bash", "edit", "read", "webfetch", "mcp_x"),
    fc.string(),
    multilineText,
  )
  const anySeparator = fc.constantFrom(" ", "  ", "\t", "\n", "\r", "\r\n", " \n ", "\\\n")
  fc.assert(
    fc.property(permission, anyCommand, fc.array(anySeparator, { minLength: 1 }), (perm, tokens, seps) => {
      const ruleset = Permission.fromConfig({ "*": "allow" })
      expect(Permission.evaluate(perm, join(tokens, seps), ruleset).action).toBe("allow")
    }),
  )
})

// Rules for several tools (not only bash), with command-prefix patterns or the
// catch-all "*". "*" is rare so that often no rule matches.
const permissionName = fc.constantFrom("bash", "edit", "read", "webfetch", "mcp_x")
const rulePermission = fc.oneof(permissionName, fc.constantFrom("*", "mcp_*"))
const rule = fc.record({
  permission: rulePermission,
  pattern: fc.oneof(
    { weight: 1, arbitrary: fc.constant("*") },
    { weight: 4, arbitrary: commandName.map((name) => name.join(" ") + " *") },
    { weight: 3, arbitrary: commandName.map((name) => name.join(" ")) },
  ),
  action: configAction,
})

// A query (permission, command) and rules built around it, so that several
// rules often match it: permission is the queried one, "*" or another tool;
// pattern is "*", the first word + " *", the exact command, or an unrelated one.
const overlapCase = fc.tuple(permissionName, commandName, args).chain(([perm, name, rest]) => {
  const command = [...name, ...rest].join(" ")
  const otherTool = permissionName.filter((tool) => tool !== perm)
  const overlappingRule = fc.record({
    permission: fc.oneof(
      { weight: 3, arbitrary: fc.constant(perm) },
      { weight: 2, arbitrary: fc.constant("*") },
      { weight: 1, arbitrary: otherTool },
    ),
    pattern: fc.oneof(
      { weight: 2, arbitrary: fc.constant("*") },
      { weight: 3, arbitrary: fc.constant(name[0] + " *") },
      { weight: 3, arbitrary: fc.constant(command) },
      { weight: 2, arbitrary: unknownCommand.map((other) => other + " *") },
    ),
    action: configAction,
  })
  // Mostly overlapping rules; some fully random rule lists keep the no-match cases.
  const rules = fc.oneof(
    { weight: 5, arbitrary: fc.array(overlappingRule, { minLength: 2, maxLength: 8 }) },
    { weight: 1, arbitrary: fc.array(rule, { maxLength: 8 }) },
  )
  return rules.map((generated) => ({ perm, command, rules: generated }))
})

// R4 (revised): Rules that cannot both match the same command can be written
// in any order without changing the result; order only matters between rules
// that overlap, where the later one wins.
// Kind: model/oracle (evaluate agrees with a plain last-match-wins model)
test("R4: evaluate agrees with a last-match-wins reference model", () => {
  fc.assert(
    fc.property(overlapCase, ({ perm, command, rules }) => {
      expect(Permission.evaluate(perm, command, rules)).toEqual(expectedRule(perm, command, rules))
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
        fc.pre(rules.filter((r) => wildcardMatch(r.pattern, command)).length <= 1)
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

// Config entries: a bare action, or patterns mapped to actions. Patterns never
// start with "~" or "$HOME", so no home-dir expansion applies.
const plainPattern = fc.oneof(
  fc.constantFrom("*", "rm *", "git *", "git push *", "npm *", "ls", "cat *", "src/*", "*.ts", "a?c"),
  commandName.map((name) => name.join(" ") + " *"),
)
const configValue = fc.oneof(
  configAction,
  fc.uniqueArray(fc.tuple(plainPattern, configAction), { selector: ([pattern]) => pattern, maxLength: 4 }),
)
const configEntries = fc.uniqueArray(fc.tuple(rulePermission, configValue), {
  selector: ([key]) => key,
  maxLength: 5,
})

// The rules a config should produce, written out in config order.
function expectedRules(entries: [string, Action | [string, Action][]][]): Rule[] {
  const rules: Rule[] = []
  for (const [permission, value] of entries) {
    if (typeof value === "string") {
      rules.push({ permission, pattern: "*", action: value })
      continue
    }
    for (const [pattern, action] of value) rules.push({ permission, pattern, action })
  }
  return rules
}

function toConfig(entries: [string, Action | [string, Action][]][]) {
  const config: Record<string, Action | Record<string, Action>> = {}
  for (const [permission, value] of entries) {
    config[permission] = typeof value === "string" ? value : Object.fromEntries(value)
  }
  return config as PermissionConfig
}

// R4 through config: fromConfig keeps config order, so evaluate over its
// output must still follow last-match-wins (and ask when nothing matches).
// Kind: model/oracle
test("R4: fromConfig yields the config's rules in order, and evaluate over them follows last-match-wins", () => {
  const queried = fc.oneof(
    fc.tuple(commandName, args).map(([n, a]) => [...n, ...a].join(" ")),
    fc.constantFrom("src/a.ts", "a.ts", "abc", "ac", "README.md", ""),
  )
  fc.assert(
    fc.property(configEntries, permissionName, queried, (entries, perm, pattern) => {
      const rules = Permission.fromConfig(toConfig(entries))
      expect(rules).toEqual(expectedRules(entries))
      expect(Permission.evaluate(perm, pattern, rules)).toEqual(expectedRule(perm, pattern, expectedRules(entries)))
    }),
  )
})

// R5 (revised): When a command matches more than one rule with different
// actions, the result identifies the rule that decided the outcome and the
// matching rules it overrode.
// Kind: invariant (decidedBy is what evaluate returns; overridden is every
// earlier matching rule with a different action, in order)
test("R5: explain names the deciding rule and the rules it overrode", () => {
  fc.assert(
    fc.property(overlapCase, ({ perm, command, rules }) => {
      const result = Permission.explain(perm, command, rules)
      const decider = expectedRule(perm, command, rules)
      const earlier = rules.filter((r) => ruleMatches(r, perm, command)).slice(0, -1)
      expect(result.decidedBy).toEqual(Permission.evaluate(perm, command, rules))
      expect(result.decidedBy).toEqual(decider)
      expect(result.overridden).toEqual(earlier.filter((r) => r.action !== decider.action))
      // A rule for another tool never decides or gets reported as overridden.
      for (const reported of [result.decidedBy, ...result.overridden]) {
        expect(globMatch(reported.permission, perm)).toBe(true)
      }
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
const bashPart = fc.oneof(
  word,
  inner.map((x) => `"${x}"`),
  inner.map((x) => `'${x}'`),
  inner.map((x) => `$'\\'${x}'`),
  word.map((x) => `${x}\\  ${x}`),
)

// One piece of a simple command: how it is typed, and how the pattern shows it.
type Piece = { source: string; expected: string }

// A redirection keeps its place on its command; a gap after the operator
// shrinks to one space, and no gap stays no gap (">out.txt").
const redirection = fc
  .tuple(fc.constantFrom(">", "2>"), fc.constantFrom("", " ", "  ", "\t"), fc.constantFrom("out.txt", "err.txt"))
  .map(([operator, gap, target]): Piece => ({
    source: operator + gap + target,
    expected: operator + (gap === "" ? "" : " ") + target,
  }))
const bashPiece = fc.oneof(
  { weight: 3, arbitrary: bashPart.map((text): Piece => ({ source: text, expected: text })) },
  { weight: 1, arbitrary: redirection },
)
const bashCommand = fc.tuple(
  word.filter((name) => !RESERVED.has(name)),
  fc.array(bashPiece, { maxLength: 4 }),
  fc.array(separator, { minLength: 1 }),
)
const optionalGap = fc.constantFrom("", " ", "  ", "\t")

test("bash: spacing inside quotes and escapes is kept, gaps between words shrink", async () => {
  const connector = fc.tuple(optionalGap, fc.constantFrom("|", ";", "&&", "||"), optionalGap)
  await fc.assert(
    fc.asyncProperty(
      fc.array(bashCommand, { minLength: 1, maxLength: 3 }),
      fc.array(connector, { minLength: 2, maxLength: 2 }),
      optionalGap,
      optionalGap,
      async (commands, connectors, leading, trailing) => {
        const typed = commands.map(([cmd, pieces, seps]) => join([cmd, ...pieces.map((p) => p.source)], seps))
        const expected = commands.map(([cmd, pieces]) => [cmd, ...pieces.map((p) => p.expected)].join(" "))
        expect(await permissionPatterns(leading + chain(typed, connectors) + trailing)).toEqual(expected)
      },
    ),
  )
})

// Joins typed commands with "before operator after" connectors, in order.
function chain(typed: string[], connectors: [string, string, string][]) {
  let text = typed[0]
  for (let i = 1; i < typed.length; i++) {
    const [before, operator, after] = connectors[(i - 1) % connectors.length]
    text += before + operator + after + typed[i]
  }
  return text
}

// R1 (redirections): each simple command keeps its own redirection, wherever
// it sits in a pipeline or list, so a rule about "> /etc/" applies to every one.
// Kind: invariant
test("R1: every simple command in a pipeline or list keeps its redirections", async () => {
  const ruleset = Permission.fromConfig({ bash: { "*": "allow", "* > /etc/*": "deny" } })
  const writer = fc.tuple(
    word.filter((name) => !RESERVED.has(name)),
    fc.array(word, { maxLength: 2 }),
    fc.constantFrom(" ", "  ", "\t"),
    word,
  )
  const connector = fc.tuple(optionalGap, fc.constantFrom("|", ";", "&&", "||"), optionalGap)
  await fc.assert(
    fc.asyncProperty(
      fc.array(writer, { minLength: 2, maxLength: 3 }),
      fc.array(connector, { minLength: 2, maxLength: 2 }),
      async (commands, connectors) => {
        const typed = commands.map(([cmd, rest, gap, file]) => [cmd, ...rest].join(" ") + " >" + gap + "/etc/" + file)
        const expected = commands.map(([cmd, rest, , file]) => [cmd, ...rest, ">", "/etc/" + file].join(" "))
        const patterns = await permissionPatterns(chain(typed, connectors))
        expect(patterns).toEqual(expected)
        for (const pattern of patterns) {
          expect(Permission.evaluate("bash", pattern, ruleset).action).toBe("deny")
        }
      },
    ),
  )
})

// R1 (no silent commands): every simple command yields a pattern, even one
// named "-" with a redirection; a dropped command would run without being asked.
// Kind: invariant
test("R1: a command with a redirection is never dropped from the asked patterns", async () => {
  const dashName = fc.oneof(fc.constant("-"), fc.stringMatching(/^-[a-z0-9.\/-]{0,4}$/))
  // The redirection, if any, comes last ("- 2>e x" is a known, documented gap).
  const command = fc
    .tuple(
      fc.oneof(dashName, word.filter((name) => !RESERVED.has(name))),
      fc.array(word, { maxLength: 2 }),
      fc.option(redirection, { freq: 2 }),
    )
    .map(([cmd, rest, redirect]) => ({
      typed: [cmd, ...rest, ...(redirect ? [redirect.source] : [])].join(" "),
      expected: [cmd, ...rest, ...(redirect ? [redirect.expected] : [])].join(" "),
    }))
  // A list of pipelines, so a "- 2>e" statement can open a pipeline after ";" or "&&".
  const pipeline = fc.array(command, { minLength: 1, maxLength: 3 })
  const pipe = fc.tuple(optionalGap, fc.constant("|"), optionalGap)
  const listConnector = fc.tuple(optionalGap, fc.constantFrom(";", "&&", "||"), optionalGap)
  await fc.assert(
    fc.asyncProperty(
      fc.array(pipeline, { minLength: 1, maxLength: 3 }),
      fc.array(pipe, { minLength: 2, maxLength: 2 }),
      fc.array(listConnector, { minLength: 2, maxLength: 2 }),
      async (pipelines, pipes, connectors) => {
        const typed = pipelines.map((commands) => chain(commands.map((c) => c.typed), pipes))
        const expected = pipelines.flatMap((commands) => commands.map((c) => c.expected))
        expect(await permissionPatterns(chain(typed, connectors))).toEqual(expected)
      },
    ),
  )
})

// A leading "-" makes a PowerShell parameter, and "-/" is not valid syntax.
const psWord = fc.stringMatching(/^[a-z0-9.\/][a-z0-9.\/-]{0,5}$/)
// A named parameter with its value after a colon ("-Name:v", "-Path:C:\x"),
// kept as one exact part. Gaps go around it, never next to the colon. Names
// are letters only: a digit in the name ("-A0a:0") splits the command today.
const colonParameter = fc
  .tuple(fc.stringMatching(/^[A-Za-z]{1,6}$/), fc.oneof(psWord, fc.constant("C:\\x")))
  .map(([name, value]) => `-${name}:${value}`)

test("powershell: spacing inside quotes is kept, gaps between words shrink", async () => {
  const part = fc.oneof(
    psWord,
    colonParameter,
    inner.map((x) => `"${x}"`),
    inner.map((x) => `'${x}'`),
    fc.constant('"C:\\"'),
  )
  const gap = fc.constantFrom(" ", "  ", "   ")
  const psCommand = fc.tuple(
    fc.constantFrom("Write-Output", "Get-Item", "Select-Object", "Where-Object"),
    fc.array(part, { minLength: 1, maxLength: 4 }),
    fc.array(gap, { minLength: 1 }),
  )
  const connector = fc.tuple(fc.constantFrom("", " ", "  "), fc.constantFrom("|", ";"), fc.constantFrom("", " ", "  "))
  await fc.assert(
    fc.asyncProperty(
      fc.array(psCommand, { minLength: 1, maxLength: 3 }),
      fc.array(connector, { minLength: 2, maxLength: 2 }),
      async (commands, connectors) => {
        const typed = commands.map(([name, parts, gaps]) => join([name, ...parts], gaps))
        const expected = commands.map(([name, parts]) => [name, ...parts].join(" "))
        let text = typed[0]
        for (let i = 1; i < typed.length; i++) {
          const [before, operator, after] = connectors[(i - 1) % connectors.length]
          text += before + operator + after + typed[i]
        }
        expect(await permissionPatterns(text, true)).toEqual(expected)
      },
    ),
  )
})

// R1 (line continuation): backslash-newline with whitespace beside it is a gap
// between words, so it must shrink to one space like any other gap.
// Kind: invariant
test("R1: a bash line continuation between words is a gap, so deny rules still apply", async () => {
  const gap = fc.constantFrom(" ", "\t", " \\\n", "\\\n ", " \\\n ", "\t\\\n\t", "  \\\n")
  const ruleset = Permission.fromConfig({ bash: { "*": "allow", "rm -rf *": "deny" } })
  await fc.assert(
    fc.asyncProperty(
      word.filter((name) => !RESERVED.has(name)),
      fc.array(word, { maxLength: 3 }),
      fc.array(gap, { minLength: 1, maxLength: 4 }),
      async (cmd, rest, gaps) => {
        expect(await permissionPatterns(join([cmd, ...rest], gaps))).toEqual([[cmd, ...rest].join(" ")])
        const destructive = ["rm", "-rf", ...rest]
        const [pattern] = await permissionPatterns(join(destructive, gaps))
        expect(Permission.evaluate("bash", pattern, ruleset).action).toBe("deny")
      },
    ),
  )
})

// Inserts a run of bash line continuations at each [position, count] cut
// inside a word (count backslash-newlines in a row at that position).
function splitWord(text: string, cuts: [number, number][]) {
  const byPosition = new Map(cuts.filter(([at]) => at > 0 && at < text.length))
  const positions = [...byPosition.keys()].sort((a, b) => a - b)
  let result = ""
  let start = 0
  for (const at of positions) {
    result += text.slice(start, at) + "\\\n".repeat(byPosition.get(at)!)
    start = at
  }
  return result + text.slice(start)
}

// R1 (line continuation inside a word): bash deletes every backslash-newline
// before splitting words, so "r\<newline>m" is "rm" and the pattern must say so.
// Only backslash-LF: in bash, backslash-CRLF is not a continuation.
// Kind: invariant
test("R1: a bash line continuation inside a word joins it, so deny rules still apply", async () => {
  const ruleset = Permission.fromConfig({ bash: { "*": "allow", "rm -rf *": "deny" } })
  const plainWord = fc.stringMatching(/^[a-z0-9.\/-]{1,6}$/)
  const run = fc.integer({ min: 1, max: 3 })
  const cuts = fc.array(fc.tuple(fc.integer({ min: 1, max: 5 }), run), { maxLength: 3 })
  await fc.assert(
    fc.asyncProperty(
      fc.stringMatching(/^[a-z][a-z0-9-]{1,5}$/).filter((name) => !RESERVED.has(name)),
      cuts,
      fc.array(fc.tuple(plainWord, cuts), { maxLength: 3 }),
      fc.array(separator, { minLength: 1, maxLength: 3 }),
      fc.integer({ min: 0, max: 3 }),
      fc.uniqueArray(fc.tuple(fc.integer({ min: 1, max: 2 }), run), { selector: ([at]) => at, minLength: 1 }),
      async (cmd, cmdCuts, rest, seps, rmRun, flagCuts) => {
        const words = [cmd, ...rest.map(([text]) => text)]
        const typed = [splitWord(cmd, cmdCuts), ...rest.map(([text, at]) => splitWord(text, at))]
        expect(await permissionPatterns(join(typed, seps))).toEqual([words.join(" ")])

        // The real command is rm -rf, typed with at least one split.
        const destructive = [splitWord("rm", [[1, rmRun]]), splitWord("-rf", flagCuts), ...typed.slice(1)]
        const [pattern] = await permissionPatterns(join(destructive, seps))
        expect(pattern).toBe(["rm", "-rf", ...words.slice(1)].join(" "))
        expect(Permission.evaluate("bash", pattern, ruleset).action).toBe("deny")
      },
    ),
  )
})

// Same as above for PowerShell, where a backtick before the newline continues the line.
// Kind: invariant
test("R1: a PowerShell backtick line continuation between words is a gap", async () => {
  const gap = fc.constantFrom(" ", "  ", " `\n", " `\n  ", "  `\n ", " `\r\n", " `\r\n  ")
  await fc.assert(
    // No $(...) or @(...) here: a continuation right after them is a documented gap.
    fc.asyncProperty(fc.array(fc.oneof(psWord, colonParameter), { minLength: 1, maxLength: 3 }), fc.array(gap, { minLength: 1 }), async (parts, gaps) => {
      const command = ["Write-Output", ...parts]
      expect(await permissionPatterns(join(command, gaps), true)).toEqual([command.join(" ")])
    }),
  )
})
