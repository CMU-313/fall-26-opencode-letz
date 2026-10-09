import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { HintTool } from "../../src/tool/hint"
import { Hint } from "../../src/hint"
import { SessionID, MessageID } from "../../src/session/schema"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_hint-session"),
  messageID: MessageID.make("msg_hint-message"),
  callID: "hint-call",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(LayerNode.compile(LayerNode.group([Hint.node, EventV2Bridge.node, Truncate.node, Agent.node])))

describe("tool.hint", () => {
  it.instance("advances through three hints, reveals the solution, and stays revealed", () =>
    Effect.gen(function* () {
      const hint = yield* Hint.Service
      const toolInfo = yield* HintTool
      const tool = yield* toolInfo.init()
      const problem = "Why does the login endpoint keep returning 401?"
      const initial = yield* hint.get({ sessionID: ctx.sessionID, problem })

      expect(initial).toEqual({ level: 0, maxLevel: Hint.MAX_LEVEL, revealed: false })

      const first = yield* tool.execute({ problem }, ctx)
      expect(first.title).toBe("Hint 1/3")
      expect(first.output).toContain("Point the student toward the general category")
      expect(first.output).toContain("must NOT state specific line numbers")
      expect(first.output).not.toContain("All staged hints have been used")
      expect(first.metadata).toMatchObject({
        problem,
        level: 1,
        maxLevel: Hint.MAX_LEVEL,
        revealed: false,
      })
      expect(yield* hint.get({ sessionID: ctx.sessionID, problem })).toEqual({
        level: 1,
        maxLevel: Hint.MAX_LEVEL,
        revealed: false,
      })

      const second = yield* tool.execute({ problem }, ctx)
      expect(second.title).toBe("Hint 2/3")
      expect(second.output).toContain("Narrow to the exact inputs, comparisons, or state transitions")
      expect(second.output).not.toBe(first.output)
      expect(second.metadata).toMatchObject({
        problem,
        level: 2,
        maxLevel: Hint.MAX_LEVEL,
        revealed: false,
      })
      expect(yield* hint.get({ sessionID: ctx.sessionID, problem })).toEqual({
        level: 2,
        maxLevel: Hint.MAX_LEVEL,
        revealed: false,
      })

      const third = yield* tool.execute({ problem }, ctx)
      expect(third.title).toBe("Hint 3/3")
      expect(third.output).toContain("State the most likely root cause and the minimal fix area")
      expect(third.output).not.toBe(second.output)
      expect(third.metadata).toMatchObject({
        problem,
        level: 3,
        maxLevel: Hint.MAX_LEVEL,
        revealed: false,
      })
      expect(yield* hint.get({ sessionID: ctx.sessionID, problem })).toEqual({
        level: 3,
        maxLevel: Hint.MAX_LEVEL,
        revealed: false,
      })

      const solution = yield* tool.execute({ problem }, ctx)
      expect(solution.title).toBe("Solution")
      expect(solution.output).toContain("All staged hints have been used.")
      expect(solution.output).toContain("the precise fix for this problem")
      expect(solution.metadata).toMatchObject({
        problem,
        level: 3,
        maxLevel: Hint.MAX_LEVEL,
        revealed: true,
      })
      expect(yield* hint.get({ sessionID: ctx.sessionID, problem })).toEqual({
        level: 3,
        maxLevel: Hint.MAX_LEVEL,
        revealed: true,
      })

      for (let call = 0; call < 5; call++) {
        const repeated = yield* tool.execute({ problem }, ctx)
        expect(repeated.title).toBe("Solution")
        expect(repeated.output).toContain("All staged hints have been used.")
        expect(repeated.metadata).toMatchObject({
          problem,
          level: 3,
          maxLevel: Hint.MAX_LEVEL,
          revealed: true,
        })
      }
      expect(yield* hint.get({ sessionID: ctx.sessionID, problem })).toEqual({
        level: 3,
        maxLevel: Hint.MAX_LEVEL,
        revealed: true,
      })
    }),
  )

  it.instance("isolates state by session and exact problem identity", () =>
    Effect.gen(function* () {
      const hint = yield* Hint.Service
      const firstSession = ctx.sessionID
      const secondSession = SessionID.make("ses_hint-other-session")
      const firstProblem = "Problem one"
      const secondProblem = "Problem two"

      expect(yield* hint.next({ sessionID: firstSession, problem: firstProblem })).toMatchObject({
        level: 1,
        revealed: false,
      })
      expect(yield* hint.get({ sessionID: firstSession, problem: secondProblem })).toEqual({
        level: 0,
        maxLevel: Hint.MAX_LEVEL,
        revealed: false,
      })
      expect(yield* hint.get({ sessionID: secondSession, problem: firstProblem })).toEqual({
        level: 0,
        maxLevel: Hint.MAX_LEVEL,
        revealed: false,
      })

      expect(yield* hint.next({ sessionID: secondSession, problem: firstProblem })).toMatchObject({
        level: 1,
        revealed: false,
      })
      expect(yield* hint.next({ sessionID: firstSession, problem: secondProblem })).toMatchObject({
        level: 1,
        revealed: false,
      })
      expect(yield* hint.next({ sessionID: firstSession, problem: firstProblem })).toMatchObject({
        level: 2,
        revealed: false,
      })

      const delimiterSession = SessionID.make("ses_hint-collision")
      const nestedDelimiterSession = SessionID.make("ses_hint-collision:problem")
      expect(
        yield* hint.next({ sessionID: delimiterSession, problem: "problem:details" }),
      ).toMatchObject({ level: 1, revealed: false })
      expect(
        yield* hint.next({ sessionID: nestedDelimiterSession, problem: "details" }),
      ).toMatchObject({ level: 1, revealed: false })
    }),
  )

  it.instance("accepts edge-case problem strings without normalization or key collisions", () =>
    Effect.gen(function* () {
      const hint = yield* Hint.Service
      const toolInfo = yield* HintTool
      const tool = yield* toolInfo.init()
      const problems = [
        "",
        " ",
        "\t\n ",
        "a".repeat(20_000),
        `quotes: "single' and double"; punctuation: !@#$%^&*()[]{}; newline:\nnext line`,
        "Unicode: 雪だるま ☃️ café Ελληνικά",
        "Case-sensitive problem",
        "case-sensitive problem",
        " leading whitespace",
        "leading whitespace",
      ]

      for (const problem of problems) {
        const result = yield* tool.execute({ problem }, ctx)
        expect(result.title).toBe("Hint 1/3")
        expect(result.output.startsWith(`Problem: ${problem}\n\nHint 1/3:`)).toBe(true)
        expect(result.metadata.problem).toBe(problem)
        expect(result.metadata).toMatchObject({ level: 1, revealed: false })
      }

      for (const problem of problems) {
        expect(yield* hint.get({ sessionID: ctx.sessionID, problem })).toEqual({
          level: 1,
          maxLevel: Hint.MAX_LEVEL,
          revealed: false,
        })
      }
    }),
  )

  it.instance("reads state deterministically without advancing progression", () =>
    Effect.gen(function* () {
      const hint = yield* Hint.Service
      const input = { sessionID: ctx.sessionID, problem: "A read-only state check" }

      const firstRead = yield* hint.get(input)
      const secondRead = yield* hint.get(input)
      expect(firstRead).toEqual({ level: 0, maxLevel: Hint.MAX_LEVEL, revealed: false })
      expect(secondRead).toEqual(firstRead)
      expect(yield* hint.get(input)).toEqual(firstRead)

      const advanced = yield* hint.next(input)
      expect(advanced).toMatchObject({ level: 1, revealed: false })
      expect(yield* hint.get(input)).toEqual(advanced)
      expect(yield* hint.get(input)).toEqual(advanced)
    }),
  )
})
