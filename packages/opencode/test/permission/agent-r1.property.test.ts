import { expect, test } from "bun:test"
import fc from "fast-check"
import { Permission } from "../../src/permission"
import { BashArity } from "../../src/permission/arity"

fc.configureGlobal({ seed: 42 })

// Arguments are single whitespace-free shell words, so joining with spaces
// reconstructs the command text the shell tool would ask about.
const argument = fc.stringMatching(/^[A-Za-z0-9_./:=@%+-]{1,8}$/)
const trailingArguments = fc.array(argument, { maxLength: 4 })

function alwaysAllow(tokens: string[]) {
  return {
    permission: "bash",
    pattern: BashArity.prefix(tokens).join(" ") + " *",
    action: "allow" as const,
  }
}

function actionFor(tokens: string[], rules: ReturnType<typeof alwaysAllow>[]) {
  return Permission.evaluate("bash", tokens.join(" "), rules).action
}

// The opencode agent's original R1 property (free model), kept unchanged as
// evidence. The strengthened version below fixes its generator and oracle.
test("R1: always allow covers the same bash command with different trailing arguments", () => {
  fc.assert(
    fc.property(trailingArguments, trailingArguments, (first, second) => {
      const approved = [alwaysAllow(["git", "commit", ...first])]

      // Later commands with the same BashArity prefix are allowed.
      expect(actionFor(["git", "commit", ...second], approved)).toBe("allow")

      // The acceptance example: approving `git commit -m "first"` covers
      // `git commit -m "second"`.
      expect(actionFor(["git", "commit", "-m", '"second"'], approved)).toBe("allow")

      // A lookalike command is a different prefix, so it still asks.
      expect(actionFor(["git", "commitx"], approved)).toBe("ask")
    }),
  )
})

// Independent oracle: each known command with its human command written out
// by hand (never computed with BashArity itself).
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
// command is just their first word.
const unknownCommand = fc.stringMatching(/^[a-z]{1,6}$/).map((name) => ["zq" + name])
const humanCommand = fc.oneof(fc.constantFrom(...HUMAN_COMMANDS), unknownCommand)

test("R1 (strengthened agent property): always allow covers the same command with any arguments, and nothing else", () => {
  fc.assert(
    fc.property(
      humanCommand,
      trailingArguments,
      trailingArguments,
      fc.constantFrom(...SIBLING_SUBCOMMANDS),
      fc.boolean(),
      fc.stringMatching(/^[a-z]{1,3}$/),
      (human, first, second, [one, other], swap, glued) => {
        // Same command, any arguments (including none) on either side.
        const approved = [alwaysAllow([...human, ...first])]
        expect(actionFor([...human, ...second], approved)).toBe("allow")

        // A lookalike (last human word with letters glued on) still asks.
        const lookalike = [...human.slice(0, -1), human[human.length - 1] + glued, ...second]
        expect(actionFor(lookalike, approved)).toBe("ask")

        // A different subcommand of the same tool still asks.
        const approvedCommand = swap ? other : one
        const laterCommand = swap ? one : other
        const siblingApproved = [alwaysAllow([...approvedCommand, ...first])]
        expect(actionFor([...laterCommand, ...second], siblingApproved)).toBe("ask")
      },
    ),
  )
})
