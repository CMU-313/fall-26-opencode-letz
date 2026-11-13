```ts
const dirSummaryGen = fc.oneof(
  // names a purpose can genuinely be inferred from
  fc.record({
    dir: fc.constantFrom("tests", "utils", "config", "auth", "docs", "cache"),
    files: fc.array(
      fc.record({
        name: fc.stringMatching(/^[a-z]{2,10}(-[a-z]{2,10})?\.(ts|md|json)$/),
        content: fc.constant("placeholder"),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    expect: fc.constant("tentative"),
  }),
  // names carrying no interpretable signal at all
  fc.record({
    dir: fc.hexaString({ minLength: 8, maxLength: 12 }),
    files: fc.array(
      fc.record({
        name: fc.hexaString({ minLength: 4, maxLength: 8 }),
        content: fc.constant("placeholder"),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    expect: fc.constant("none"),
  }),
)

it.live(
  "directory_summary R2: inferred purpose is tentative and absent inference is stated explicitly",
  () =>
    check(dirSummaryGen, (gen) =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          yield* write(Object.fromEntries(gen.files.map((file) => [`${gen.dir}/${file.name}`, file.content])))
          const result = yield* summarize()
          if (gen.expect === "none") {
            expect(result.purpose).toMatch(/no specific|cannot|unclear|unknown|no clear|not inferred/i)
          } else {
            expect(result.purpose).toMatch(/tentative|inferred|likely|appears|probably|possibly|may\b/i)
          }
        }),
      ),
    ),
  60000,
)
```

**Generator.** `fc.oneof` over two cases, each tagged with an `expect` discriminator so the oracle knows which R2 clause applies without inspecting the tool's output. Case 1 draws the directory name from a fixed corpus of conventionally meaningful names (`tests`, `utils`, `config`, `auth`, `docs`, `cache`) plus 1–5 files with ordinary word-based names and common extensions — purpose is genuinely inferable from names alone, per the tool's contract. Case 2 uses hex strings (`0-9a-f`) for both the directory and file names, with no extensions. Hex is chosen deliberately: none of the meaningful stems consists solely of hex characters (e.g. `tests` needs `t`/`s`, `cache` needs `h`), so random hex names can never accidentally embed an inferable keyword — the two cases stay cleanly separated and the property won't flake. Omitting extensions removes the only other name-based signal, so in Case 2 the tool truly has nothing to infer from.

**Oracle.** `write` materializes the generated file map relative to the isolated workspace (creating the module directory), then the real tool runs via `summarize()`. The assertion is text-based on `result.purpose` and mirrors R2's two clauses:

- **Case `tentative`** — whenever a specific purpose is stated, it must be hedged (`tentative`, `inferred`, `likely`, `appears`, …), i.e. the tool must never assert an inferred purpose as fact.
- **Case `none`** — with no interpretable names, the tool must explicitly declare that no specific purpose can be inferred (`no specific purpose`, `cannot`, `unclear`, …) rather than fabricating one.

`check` runs 100 cases under fixed seed 17313 for reproducibility, and the 60s `it.live` budget covers real tool execution.

One caveat: the regexes encode the tool's expected phrasing. If the implementation exposes structured output (e.g. a `tentative: boolean` or `inferred: false` field on the result), assert those fields directly instead — the generator and case split stay identical.
