import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Hint } from "../hint"
import DESCRIPTION from "./hint.txt"

const SOLUTION_INSTRUCTIONS = [
  "All staged hints have been used.",
  "State the specific root cause and the precise fix for this problem, grounded only in evidence you've actually gathered (code you've read, commands you've run, hints already given).",
  "Name the exact faulty line or condition, explain why it fails, and give the minimal correction.",
  "Do not give a generic or templated answer; it must resolve the stated problem specifically.",
].join(" ")

const HINT_INSTRUCTIONS: Record<Hint.HintLevel, readonly string[]> = {
  1: [
    "This is hint level 1 of 3 for this problem.",
    "Respond in 2-3 sentences MAX.",
    "Point the student toward the general category of the bug (for example, 'check input validation' or 'examine the comparison logic') and the general area of the file to inspect.",
    "You must NOT state specific line numbers, quote or describe the exact code/literals involved, judge whether a comment is accurate or a red herring, or describe the specific failure mechanism (such as whitespace, encoding, casing, or similar).",
    "If you already know the root cause from your investigation, do not reveal any part of it beyond what is permitted above.",
  ],
  2: [
    "This is hint level 2 of 3 for this problem.",
    "Respond in 2-3 sentences MAX.",
    "Narrow to the exact inputs, comparisons, or state transitions involved in the failure, and point to the general section of the code that is likely responsible.",
    "You must NOT jump to the final fix, name the exact failing literal, or describe the full root cause before the evidence is shown.",
    "Keep the hint grounded in the likely branch or condition rather than speculation.",
  ],
  3: [
    "This is hint level 3 of 3 for this problem.",
    "Respond in 2-3 sentences MAX.",
    "State the most likely root cause and the minimal fix area, grounded in the evidence you've observed.",
    "Do not speculate beyond the failing branch, and do not restate the whole investigation; the goal is to confirm the decisive cause and its fix.",
  ],
}

export const Parameters = Schema.Struct({
  problem: Schema.String.annotate({ description: "Problem or task to reason about" }),
})

type Metadata = {
  problem: string
  level: Hint.HintLevel
  maxLevel: typeof Hint.MAX_LEVEL
  revealed: boolean
}

export const HintTool = Tool.define(
  "hint",
  Effect.gen(function* () {
    const hint = yield* Hint.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const state = yield* hint.next({
            sessionID: ctx.sessionID,
            problem: params.problem,
          })

          const level = state.level
          const title = state.revealed ? "Solution" : `Hint ${level}/${Hint.MAX_LEVEL}`
          const output = state.revealed
            ? `Problem: ${params.problem}\n\n${SOLUTION_INSTRUCTIONS}`
            : `Problem: ${params.problem}\n\nHint ${level}/${Hint.MAX_LEVEL}: ${HINT_INSTRUCTIONS[level].join(" ")}`

          return {
            title,
            output,
            metadata: {
              problem: params.problem,
              level,
              maxLevel: Hint.MAX_LEVEL,
              revealed: state.revealed,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
