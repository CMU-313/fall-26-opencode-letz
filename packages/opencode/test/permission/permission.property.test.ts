import { afterEach, describe, expect, test } from "bun:test"
import fc from "fast-check"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Skill } from "../../src/skill"
import { SessionID } from "../../src/session/schema"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

fc.configureGlobal({ seed: 42 })

const agentLayer = LayerNode.compile(
  LayerNode.group([
    Agent.node,
    Plugin.node,
    Provider.node,
    Auth.node,
    Config.node,
    Skill.node,
    RuntimeFlags.node,
    Permission.node,
  ]),
  [[RuntimeFlags.node, RuntimeFlags.layer({})]],
)
const it = testEffect(agentLayer)

// These overlapping, constrained inputs keep generated cases focused on rule matches and meaningful non-matches.

// Include command heads used by the permission examples and shell commands.
const commandHead = fc.constantFrom("git", "rm", "ls", "npm")
// Include subcommands and flags that create useful command-pattern boundaries.
const commandPart = fc.constantFrom("status", "push", "-rf", "--short", "build")
// Generate safe filename-like tokens with varied names and common extensions.
const filename = fc
  .tuple(fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/), fc.constantFrom(".txt", ".json", ".md"))
  .map(([name, extension]) => `${name}${extension}`)
// Keep path, directory, and flag examples alongside generated filenames.
const commandArgument = fc.oneof(fc.constantFrom("file.txt", "src/index.ts", "build/", "--short", "--json"), filename)
// Pair each base command with a guaranteed-different head to exercise non-matching rules.
const command = fc
  .tuple(fc.constantFrom("git", "npm"), fc.constantFrom("status", "test", "build"))
  .map(([head, sub]) => ({
    base: `${head} ${sub}`,
    other: `${head === "git" ? "npm" : "git"} ${sub}`,
  }))

afterEach(async () => {
  await disposeAllInstances()
})

describe("permission rules", () => {
  // R1: An explicit deny permission rule still blocks a command when `opencode` is in auto-approval mode (`opencode --auto`).
  // Kind: invariant
  it.instance("R1: deny permission rules block auto-approval", () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const context = yield* Effect.context()
      const sessionID = SessionID.make("session_property")

      // Repeatedly compare a denied command with an ask command using generated arguments.
      yield* Effect.promise(() =>
        fc.assert(
          // Generate varied arguments while preserving the `rm *` deny and `echo` ask matches.
          fc.asyncProperty(commandArgument, commandArgument, async (rmArgument, echoArgument) => {
            const result = await Effect.runPromise(
              Effect.gen(function* () {
                // A deny must fail directly instead of becoming a request that auto mode could approve.
                const denied = yield* Effect.exit(
                  permission.ask({
                    sessionID,
                    permission: "bash",
                    patterns: [`rm ${rmArgument}`],
                    metadata: {},
                    always: [],
                    ruleset: [
                      { permission: "bash", pattern: "*", action: "ask" as const },
                      { permission: "bash", pattern: "rm *", action: "deny" as const },
                    ],
                  }),
                )
                const pendingAfterDeny = yield* permission.list()

                // Model --auto by approving the ask request once it appears in the pending list.
                const autoApproved = yield* permission
                  .ask({
                    sessionID,
                    permission: "bash",
                    patterns: [`echo ${echoArgument}`],
                    metadata: {},
                    always: [],
                    ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
                  })
                  .pipe(Effect.forkChild)
                const request = yield* Effect.gen(function* () {
                  while (true) {
                    const pending = yield* permission.list()
                    const request = pending.find((item) => item.sessionID === sessionID)
                    if (request) return request
                    yield* Effect.sleep("1 millis")
                  }
                }).pipe(
                  Effect.timeoutOrElse({
                    duration: "1 second",
                    orElse: () => Effect.fail(new Error("timed out waiting for auto-approved permission request")),
                  }),
                )

                yield* permission.reply({ requestID: request.id, reply: "once" })
                const approved = yield* Effect.exit(Fiber.join(autoApproved))
                return { denied, pendingAfterDeny, request, approved }
              }).pipe(Effect.provideContext(context), Effect.orDie),
            )

            // Confirm deny never reached approval, while the ask request completed after the auto-style reply.
            expect(Exit.isFailure(result.denied)).toBe(true)
            if (Exit.isFailure(result.denied)) {
              expect(Cause.squash(result.denied.cause)).toBeInstanceOf(PermissionV1.DeniedError)
            }
            expect(result.pendingAfterDeny).toHaveLength(0)
            expect(result.request.permission).toBe("bash")
            expect(result.request.patterns).toEqual([`echo ${echoArgument}`])
            expect(Exit.isSuccess(result.approved)).toBe(true)
          }),
        ),
      )
    }),
  )

  // R2: A permission rule ending in `*` matches that command with any arguments but not other commands, and a permission rule without `*` matches only that exact command.
  // Kind: metamorphic
  test("R2: trailing wildcards match arguments while exact permission rules do not", () => {
    fc.assert(
      fc.property(command, commandArgument, ({ base, other }, args) => {
        const rules = [{ permission: "*", pattern: "*", action: "ask" as const }]
        const trailingWildcardRules = [...rules, { permission: "bash", pattern: `${base} *`, action: "allow" as const }]
        const exactRules = [...rules, { permission: "bash", pattern: base, action: "allow" as const }]
        const prefixed = `${other} ${base}`

        // Check that the trailing wildcard matches both the bare command and a generated argument.
        expect(Permission.evaluate("bash", base, trailingWildcardRules).action).toBe("allow")
        expect(Permission.evaluate("bash", `${base} ${args}`, trailingWildcardRules).action).toBe("allow")
        expect(Permission.evaluate("bash", other, trailingWildcardRules).action).toBe("ask")
        expect(Permission.evaluate("bash", prefixed, trailingWildcardRules).action).toBe("ask")

        // Check that an exact pattern stops matching as soon as an argument is added.
        expect(Permission.evaluate("bash", base, exactRules).action).toBe("allow")
        expect(Permission.evaluate("bash", `${base} ${args}`, exactRules).action).toBe("ask")
        expect(Permission.evaluate("bash", other, exactRules).action).toBe("ask")
        expect(Permission.evaluate("bash", prefixed, exactRules).action).toBe("ask")
      }),
    )
  })

  // R3: By default, `.env` and `.env.*` reads require approval except `.env.example`.
  // Kind: model / oracle
  it.instance("R3: .env and .env.* reads require approval except .env.example", () =>
    Effect.gen(function* () {
      const build = yield* Agent.Service.use((agent) => agent.get("build"))
      const envFilename = fc.oneof(
        fc.constant(".env"),
        fc.constantFrom("local", "development", "production", "test").map((suffix) => `.env.${suffix}`),
        fc.constantFrom("config/.env", "src/.env.local"),
        fc.constant(".env.example"),
      )

      // Include exact and nested .env paths, varied suffixes, and the .env.example exception.
      fc.assert(
        fc.property(envFilename, (filename) => {
          const expected = filename === ".env.example" ? "allow" : "ask"
          expect(Permission.evaluate("read", filename, build.permission).action).toBe(expected)
        }),
      )
    }),
  )

  // R5: When `opencode` denies a command, it shows the permission rule (pattern and action) that caused the decision.
  // Kind: invariant
  it.instance("R5: denied commands show the matching permission rule", () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const context = yield* Effect.context()
      yield* Effect.promise(() =>
        fc.assert(
          // Generate command heads, parts, and arguments that always match the generated deny pattern.
          fc.asyncProperty(
            commandHead,
            commandPart,
            commandArgument,
            fc.constantFrom("read", "edit", "glob"),
            async (head, part, args, unrelatedPermission) => {
              // Put a matching deny after the general ask rule to exercise the winning rule.
              const pattern = `${head} ${part} *`
              const ruleset = [
                { permission: "bash", pattern: "*", action: "ask" as const },
                { permission: "bash", pattern, action: "deny" as const },
                { permission: unrelatedPermission, pattern: "*", action: "deny" as const },
              ]
              const exit = await Effect.runPromise(
                Effect.exit(
                  permission.ask({
                    sessionID: SessionID.make("session_property"),
                    permission: "bash",
                    patterns: [`${head} ${part} ${args}`],
                    metadata: {},
                    always: [],
                    ruleset,
                  }),
                ).pipe(Effect.provideContext(context)),
              )

              // Check both the structured ruleset and serialized error message expose the deny rule.
              expect(Exit.isFailure(exit)).toBe(true)
              if (!Exit.isFailure(exit)) return
              const error = Cause.squash(exit.cause)
              expect(error).toBeInstanceOf(PermissionV1.DeniedError)
              if (!(error instanceof PermissionV1.DeniedError)) return
              expect(error.ruleset).toContainEqual(expect.objectContaining({ pattern, action: "deny" }))
              expect(error.ruleset).not.toContainEqual(expect.objectContaining({ permission: unrelatedPermission }))
              expect(error.message).toContain(`"pattern":"${pattern}"`)
              expect(error.message).toContain(`"action":"deny"`)
            },
          ),
        ),
      )
    }),
  )

  // R5: When `opencode` denies a command, it shows the permission rule (pattern and action) that caused the decision.
  // Kind: invariant
  it.instance("Agent R5 property: matching denied bash commands fail with DeniedError", () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const context = yield* Effect.context()
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(commandHead, commandPart, commandArgument, async (head, part, args) => {
            const pattern = `${head} ${part} *`
            const exit = await Effect.runPromise(
              Effect.exit(
                permission.ask({
                  sessionID: SessionID.make("session_agent_r5_property"),
                  permission: "bash",
                  patterns: [`${head} ${part} ${args}`],
                  metadata: {},
                  always: [],
                  ruleset: [{ permission: "bash", pattern, action: "deny" }],
                }),
              ).pipe(Effect.provideContext(context)),
            )

            expect(Exit.isFailure(exit)).toBe(true)
            if (!Exit.isFailure(exit)) return
            const error = Cause.squash(exit.cause)
            expect(error).toBeInstanceOf(PermissionV1.DeniedError)
            if (!(error instanceof PermissionV1.DeniedError)) return
            expect(error.ruleset).toContainEqual(expect.objectContaining({ pattern, action: "deny" }))
          }),
        ),
      )
    }),
  )
})
