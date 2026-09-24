import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { containsPath } from "@/project/instance-context"
import { Tool } from "./tool"
import DESCRIPTION from "./directory_summary.txt"

export const Parameters = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "Directory within the current workspace; relative paths use the active working directory.",
  }),
})

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/i
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".json"]
const LIMIT = 200

export const DirectorySummaryTool = Tool.define(
  "directory_summary",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const directory = FSUtil.resolve(path.resolve(instance.directory, params.path))
          if (!containsPath(directory, instance)) {
            throw new Error(`directory_summary path must be within the current workspace: ${directory}`)
          }
          const root = instance.worktree === "/" ? instance.directory : instance.worktree
          const relative = (file: string) => path.relative(root, file).split(path.sep).join("/") || "."
          const ask = (file: string) =>
            ctx.ask({ permission: "read", patterns: [relative(file)], always: ["*"], metadata: {} })
          yield* ask(directory)
          const stat = yield* fs.stat(directory).pipe(
            Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
          )
          if (!stat) throw new Error(`Directory not found: ${directory}`)
          if (stat.type !== "Directory") throw new Error(`Path is not a directory: ${directory}`)

          const entries = (yield* fs.readDirectoryEntries(directory)).sort((a, b) =>
            a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
          )
          const selected = entries.slice(0, LIMIT)
          const files = selected.filter((entry) => entry.type === "file").map((entry) => ({
            name: entry.name,
            role: role(entry.name),
          }))
          const dependencies: { file: string; specifier: string; target: string; directory: string }[] = []
          const unresolved: { file: string; specifier: string }[] = []
          const skipped: { file: string; reason: string }[] = selected
            .filter((entry) => entry.type === "symlink")
            .map((entry) => ({ file: entry.name, reason: "Symbolic links are not scanned" }))
          const coverage = { truncated: entries.length > LIMIT }

          for (const file of files.filter((file) => SOURCE.test(file.name))) {
            const source = path.join(directory, file.name)
            yield* ask(source)
            const info = yield* fs.stat(source)
            if (Number(info.size) > 256 * 1024) {
              skipped.push({ file: file.name, reason: "Source exceeds 256 KiB scan limit" })
              coverage.truncated = true
              continue
            }
            const imports = specifiers(yield* fs.readFileString(source))
            for (const specifier of imports) {
              if (dependencies.length + unresolved.length >= LIMIT) {
                coverage.truncated = true
                break
              }
              if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
                unresolved.push({ file: file.name, specifier })
                continue
              }
              const base = path.resolve(directory, specifier)
              const candidates = [
                ...EXTENSIONS.map((ext) => base + ext),
                ...EXTENSIONS.slice(1).map((ext) => path.join(base, "index" + ext)),
                ...(/\.[cm]?js$/.test(base) ? [base.replace(/js$/, "ts"), base.replace(/js$/, "tsx")] : []),
              ]
              const targets = yield* Effect.forEach(candidates, (candidate) =>
                Effect.gen(function* () {
                  const resolved = FSUtil.resolve(candidate)
                  if (!containsPath(resolved, instance)) return undefined
                  return (yield* fs.isFile(resolved)) ? resolved : undefined
                }),
              )
              const target = targets.find((item) => item !== undefined)
              if (!target) {
                unresolved.push({ file: file.name, specifier })
                continue
              }
              if (path.dirname(target) === directory) continue
              dependencies.push({
                file: file.name,
                specifier,
                target: relative(target),
                directory: relative(path.dirname(target)),
              })
            }
          }

          const summary = {
            path: directory,
            purpose: purpose(path.basename(directory), files, entries.length),
            files,
            importantFiles: files.filter((file) => file.role !== "file" && file.role !== "source").map((file) => file.name),
            subdirectories: selected.filter((entry) => entry.type === "directory").map((entry) => entry.name),
            dependencies,
            unresolvedImports: unresolved,
            skipped,
            scope: "Immediate entries; JavaScript/TypeScript literal imports only; relative modules resolved without alias configuration",
            truncated: coverage.truncated,
          }
          return {
            title: relative(directory),
            output: JSON.stringify(summary, null, 2),
            metadata: { summary, truncated: summary.truncated },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function role(name: string) {
  if (/^(readme|agents|contributing|license)(\.|$)/i.test(name)) return "documentation"
  if (/^(package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/.test(name)) return "package manifest"
  if (/^(bun|package-lock|yarn|pnpm-lock|Cargo)\.(lock|lockb|json|yaml)$/.test(name)) return "dependency lockfile"
  if (/(?:^|\.)(test|spec)\.[^.]+$/.test(name)) return "test"
  if (/^(index|main|mod)\.[^.]+$/.test(name)) return "entry point"
  if (/config\.|rc(?:\.|$)|^\.(?:gitignore|env)/i.test(name)) return "configuration"
  return SOURCE.test(name) ? "source" : "file"
}

function purpose(name: string, files: { role: string }[], count: number) {
  if (count === 0) return "Empty directory; no purpose can be inferred."
  if (files.some((file) => file.role === "package manifest"))
    return "Likely a package or project root, with dependency and build metadata."
  if (/^(test|tests|__tests__)$/.test(name) || files.some((file) => file.role === "test"))
    return "Likely contains automated tests and supporting fixtures."
  if (/^(docs?|documentation)$/.test(name)) return "Likely contains project documentation."
  if (/^(tools?|scripts?)$/.test(name)) return "Likely contains tools or automation scripts."
  if (files.some((file) => file.role === "source" || file.role === "entry point"))
    return "Likely a source module containing application or library implementation."
  return "Groups project files and subdirectories; no more specific purpose can be inferred."
}

function specifiers(source: string) {
  // Tokenize comments and strings together so examples in either are not treated as imports.
  // This is a bounded lexical inference, not a full module resolver or language parser.
  const tokens = Array.from(
    source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[\w$]+|[^\s]/g),
  )
    .map((match) => match[0])
    .filter((token) => !token.startsWith("//") && !token.startsWith("/*"))
  const found = new Set<string>()
  const literal = (token?: string) => token && /^(?:"[^"\\]*"|'[^'\\]*')$/.test(token)
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i - 1] === ".") continue
    if (tokens[i] === "require" || tokens[i] === "import") {
      const value = tokens[i + 1] === "(" ? tokens[i + 2] : tokens[i + 1]
      if (literal(value)) found.add(value.slice(1, -1))
    }
    if (tokens[i] !== "import" && tokens[i] !== "export") continue
    for (let j = i + 1; j < tokens.length; j++) {
      if ([";", "import", "export", "=", "("].includes(tokens[j])) break
      if (tokens[j] !== "from") continue
      if (literal(tokens[j + 1])) found.add(tokens[j + 1].slice(1, -1))
      break
    }
  }
  return [...found].sort()
}
