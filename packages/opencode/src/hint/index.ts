import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"

export const MAX_LEVEL = 3

export type HintLevel = 1 | 2 | 3

export interface HintState {
  level: 0 | HintLevel
  maxLevel: typeof MAX_LEVEL
  revealed: boolean
}

export interface HintProgress extends HintState {
  level: HintLevel
}

const emptyState = (): HintState => ({ level: 0, maxLevel: MAX_LEVEL, revealed: false })

interface State {
  entries: Map<string, HintState>
}

export interface HintInterface {
  readonly get: (input: { sessionID: SessionID; problem: string }) => Effect.Effect<HintState>
  readonly next: (input: { sessionID: SessionID; problem: string }) => Effect.Effect<HintProgress>
  readonly reset: (input: { sessionID: SessionID; problem: string }) => Effect.Effect<HintState>
}

export class Service extends Context.Service<Service, HintInterface>()("@opencode/Hint") {}

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

    const key = (sessionID: SessionID, problem: string) => JSON.stringify([sessionID, problem])

    const get = Effect.fn("Hint.get")(function* (input: { sessionID: SessionID; problem: string }) {
      const entries = (yield* InstanceState.get(state)).entries
      const existing = entries.get(key(input.sessionID, input.problem))
      return existing ?? emptyState()
    })

    const next = Effect.fn("Hint.next")(function* (input: { sessionID: SessionID; problem: string }) {
      const entries = (yield* InstanceState.get(state)).entries
      const entryKey = key(input.sessionID, input.problem)
      const current = entries.get(entryKey) ?? emptyState()
      const alreadyMaxed = current.level >= MAX_LEVEL
      const nextLevel: HintLevel = current.level === 0 ? 1 : current.level === 1 ? 2 : MAX_LEVEL
      const next: HintProgress = alreadyMaxed
        ? { ...current, level: MAX_LEVEL, revealed: true }
        : { level: nextLevel, maxLevel: MAX_LEVEL, revealed: false }
      entries.set(entryKey, next)
      return next
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
