import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"

export interface HintState {
  level: 0 | 1 | 2 | 3
  maxLevel: 3
  revealed: boolean
}

const emptyState = (): HintState => ({ level: 0, maxLevel: 3, revealed: false })

interface State {
  entries: Map<string, HintState>
}

export interface Interface {
  readonly get: (input: { sessionID: SessionID; problem: string }) => Effect.Effect<HintState>
  readonly next: (input: { sessionID: SessionID; problem: string }) => Effect.Effect<HintState>
  readonly reset: (input: { sessionID: SessionID; problem: string }) => Effect.Effect<HintState>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Hint") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("Hint.state")(function* () {
        return {
          entries: new Map<string, HintState>(),
        }
      }),
    )

    const key = (sessionID: SessionID, problem: string) => `${sessionID}:${problem}`

    const get = Effect.fn("Hint.get")(function* (input: { sessionID: SessionID; problem: string }) {
      const entries = (yield* InstanceState.get(state)).entries
      const existing = entries.get(key(input.sessionID, input.problem))
      return existing ?? emptyState()
    })

    const next = Effect.fn("Hint.next")(function* (input: { sessionID: SessionID; problem: string }) {
      const entries = (yield* InstanceState.get(state)).entries
      const current = entries.get(key(input.sessionID, input.problem)) ?? emptyState()
      if (current.revealed) {
        const hint: HintState = { ...current, revealed: true }
        entries.set(key(input.sessionID, input.problem), hint)
        return hint
      }

      const level = Math.min(current.level + 1, 3) as HintState["level"]
      const revealed = level === 3 && current.level >= 3
      const hint: HintState = { level, maxLevel: 3, revealed }
      entries.set(key(input.sessionID, input.problem), hint)
      return hint
    })

    const reset = Effect.fn("Hint.reset")(function* (input: { sessionID: SessionID; problem: string }) {
      const entries = (yield* InstanceState.get(state)).entries
      const cleared: HintState = { level: 0, maxLevel: 3, revealed: false }
      entries.set(key(input.sessionID, input.problem), cleared)
      return cleared
    })

    return Service.of({ get, next, reset })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [] })

export * as Hint from "./index"
