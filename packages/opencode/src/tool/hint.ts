import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./hint.txt"

export const Parameters = Schema.Struct({
  problem: Schema.String.annotate({ description: "Problem or task to reason about" }),
})

export const HintTool = Tool.define(
  "hint",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
      Effect.succeed({
        title: "Hint 1/3",
        output: `Problem: ${params.problem}\n\nHint 1/3: Start by identifying the general area of the code that is relevant to the problem.`,
        metadata: {},
      }),
  }),
)