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
  it.instance("should advance through progressive hint levels for the same problem", () =>
    Effect.gen(function* () {
      const hint = yield* Hint.Service
      const toolInfo = yield* HintTool
      const tool = yield* toolInfo.init()

      const problem = "Why does the login endpoint keep returning 401?"

      const first = yield* tool.execute({ problem }, ctx)
      const second = yield* tool.execute({ problem }, ctx)
      const third = yield* tool.execute({ problem }, ctx)
      const fourth = yield* tool.execute({ problem }, ctx)

      expect(first.output).toContain("Hint 1/3")
      expect(second.output).toContain("Hint 2/3")
      expect(third.output).toContain("Hint 3/3")
      expect(first.metadata.level).toBe(1)
      expect(second.metadata.level).toBe(2)
      expect(third.metadata.level).toBe(3)
      expect(fourth.metadata.level).toBe(3)
      expect(fourth.metadata.revealed).toBe(true)

      const state = yield* hint.get({ sessionID: ctx.sessionID, problem })
      
      expect(state.level).toBe(3)
      expect(state.maxLevel).toBe(3)
      expect(state.revealed).toBe(true)
    }),
  )
})
