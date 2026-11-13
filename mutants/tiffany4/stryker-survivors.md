# Initial Stryker survivors

Stryker 10.1.1; original nine properties; seed 17313. IDs refer to mutation.json/mutation.html. See the traceability comparison for triage; survival alone does not establish equivalence.

| ID | Mutator | Lines | Original | Replacement |
| --- | --- | --- | --- | --- |
| 5 | ConditionalExpression | 107–107 | stat.type !== "Directory" | false |
| 8 | StringLiteral | 107–107 | &#96;Path is not a directory: ${directory}&#96; | &#96;&#96; |
| 9 | ArrowFunction | 110–110 | (a, b) => a.name.localeCompare(b.name) | () => undefined |
| 10 | MethodExpression | 114–115 | entries<br>              .filter((entry) => entry.type === "file") | entries |
| 12 | ConditionalExpression | 115–115 | entry.type === "file" | true |
| 18 | MethodExpression | 117–117 | entries.filter((entry) => entry.type === "directory") | entries |
| 19 | ArrowFunction | 117–117 | (entry) => entry.type === "directory" | () => undefined |
| 20 | ConditionalExpression | 117–117 | entry.type === "directory" | true |
| 21 | ConditionalExpression | 117–117 | entry.type === "directory" | false |
| 22 | EqualityOperator | 117–117 | entry.type === "directory" | entry.type !== "directory" |
| 24 | ArrowFunction | 117–117 | (entry) => entry.name | () => undefined |
| 23 | StringLiteral | 117–117 | "directory" | "" |
| 26 | StringLiteral | 218–218 | "dependency" | "" |
| 29 | ConditionalExpression | 222–224 | specifier.startsWith(item.prefix) &&<br>                  specifier.endsWith(item.suffix) &&<br>                  specifier.length >= item.prefix.length + item.suffix.length | true |
| 31 | LogicalOperator | 222–224 | specifier.startsWith(item.prefix) &&<br>                  specifier.endsWith(item.suffix) &&<br>                  specifier.length >= item.prefix.length + item.suffix.length | specifier.startsWith(item.prefix) && specifier.endsWith(item.suffix) &#124;&#124; specifier.length >= item.prefix.length + item.suffix.length |
| 32 | ConditionalExpression | 222–223 | specifier.startsWith(item.prefix) &&<br>                  specifier.endsWith(item.suffix) | true |
| 33 | LogicalOperator | 222–223 | specifier.startsWith(item.prefix) &&<br>                  specifier.endsWith(item.suffix) | specifier.startsWith(item.prefix) &#124;&#124; specifier.endsWith(item.suffix) |
| 35 | MethodExpression | 223–223 | specifier.endsWith(item.suffix) | specifier.startsWith(item.suffix) |
| 36 | ConditionalExpression | 224–224 | specifier.length >= item.prefix.length + item.suffix.length | true |
| 37 | EqualityOperator | 224–224 | specifier.length >= item.prefix.length + item.suffix.length | specifier.length > item.prefix.length + item.suffix.length |
| 39 | ArithmeticOperator | 224–224 | item.prefix.length + item.suffix.length | item.prefix.length - item.suffix.length |
| 41 | ConditionalExpression | 225–225 | specifier === item.prefix | false |
| 40 | ConditionalExpression | 225–225 | specifier === item.prefix | true |
| 42 | EqualityOperator | 225–225 | specifier === item.prefix | specifier !== item.prefix |
| 46 | ArithmeticOperator | 229–229 | specifier.length - alias.suffix.length | specifier.length + alias.suffix.length |
| 47 | StringLiteral | 230–230 | "" | "Stryker was here!" |
| 50 | ConditionalExpression | 233–233 | resolved | true |
| 53 | StringLiteral | 234–234 | "dependency" | "" |
| 62 | MethodExpression | 248–248 | specifier.startsWith("bun:") | specifier.endsWith("bun:") |
| 64 | ConditionalExpression | 248–248 | specifier === "bun" | false |
| 66 | StringLiteral | 248–248 | "bun" | "" |
| 82 | ConditionalExpression | 255–255 | !pkg | true |
| 100 | ArrowFunction | 394–394 | (a, b) => b.imports - a.imports &#124;&#124; a.directory.localeCompare(b.directory) | () => undefined |
| 101 | ConditionalExpression | 394–394 | b.imports - a.imports &#124;&#124; a.directory.localeCompare(b.directory) | true |
| 103 | LogicalOperator | 394–394 | b.imports - a.imports &#124;&#124; a.directory.localeCompare(b.directory) | b.imports - a.imports && a.directory.localeCompare(b.directory) |
| 102 | ConditionalExpression | 394–394 | b.imports - a.imports &#124;&#124; a.directory.localeCompare(b.directory) | false |
| 104 | ArithmeticOperator | 394–394 | b.imports - a.imports | b.imports + a.imports |
| 120 | ArrowFunction | 414–414 | (file) => file.role === "test" | () => undefined |
| 122 | ConditionalExpression | 414–414 | file.role === "test" | false |
| 124 | StringLiteral | 414–414 | "test" | "" |
| 129 | LogicalOperator | 416–416 | /^(?:test&#124;tests&#124;__tests__&#124;spec)$/i.test(name) &#124;&#124; (tests > 0 && tests * 2 >= code) | /^(?:test&#124;tests&#124;__tests__&#124;spec)$/i.test(name) && tests > 0 && tests * 2 >= code |
| 130 | Regex | 416–416 | /^(?:test&#124;tests&#124;__tests__&#124;spec)$/i | /(?:test&#124;tests&#124;__tests__&#124;spec)$/i |
| 128 | ConditionalExpression | 416–416 | /^(?:test&#124;tests&#124;__tests__&#124;spec)$/i.test(name) &#124;&#124; (tests > 0 && tests * 2 >= code) | false |
| 131 | Regex | 416–416 | /^(?:test&#124;tests&#124;__tests__&#124;spec)$/i | /^(?:test&#124;tests&#124;__tests__&#124;spec)/i |
| 132 | ConditionalExpression | 416–416 | tests > 0 && tests * 2 >= code | false |
| 137 | ConditionalExpression | 416–416 | tests * 2 >= code | true |
| 138 | EqualityOperator | 416–416 | tests * 2 >= code | tests * 2 > code |
| 139 | EqualityOperator | 416–416 | tests * 2 >= code | tests * 2 < code |
| 140 | ArithmeticOperator | 416–416 | tests * 2 | tests / 2 |
| 141 | StringLiteral | 417–417 | "Likely contains automated tests and supporting fixtures." | "" |
| 143 | ConditionalExpression | 418–418 | /^(?:docs?&#124;documentation)$/i.test(name) | false |
| 145 | Regex | 418–418 | /^(?:docs?&#124;documentation)$/i | /^(?:docs?&#124;documentation)/i |
| 144 | Regex | 418–418 | /^(?:docs?&#124;documentation)$/i | /(?:docs?&#124;documentation)$/i |
| 146 | Regex | 418–418 | /^(?:docs?&#124;documentation)$/i | /^(?:docs&#124;documentation)$/i |
| 147 | StringLiteral | 418–418 | "Likely contains project documentation." | "" |
| 149 | ConditionalExpression | 419–419 | /^(?:scripts?&#124;bin)$/i.test(name) | false |
| 150 | Regex | 419–419 | /^(?:scripts?&#124;bin)$/i | /(?:scripts?&#124;bin)$/i |
| 151 | Regex | 419–419 | /^(?:scripts?&#124;bin)$/i | /^(?:scripts?&#124;bin)/i |
| 152 | Regex | 419–419 | /^(?:scripts?&#124;bin)$/i | /^(?:scripts&#124;bin)$/i |
| 153 | StringLiteral | 419–419 | "Likely contains tools or automation scripts." | "" |
| 160 | ConditionalExpression | 421–421 | files.length === 0 && subdirectories.length > 0 | false |
| 162 | ConditionalExpression | 421–421 | files.length === 0 | true |
| 161 | LogicalOperator | 421–421 | files.length === 0 && subdirectories.length > 0 | files.length === 0 &#124;&#124; subdirectories.length > 0 |
| 163 | EqualityOperator | 421–421 | files.length === 0 | files.length !== 0 |
| 164 | ConditionalExpression | 421–421 | subdirectories.length > 0 | true |
| 166 | EqualityOperator | 421–421 | subdirectories.length > 0 | subdirectories.length <= 0 |
| 165 | EqualityOperator | 421–421 | subdirectories.length > 0 | subdirectories.length >= 0 |
| 167 | StringLiteral | 422–422 | &#96;Likely groups related modules or packages: ${subdirectories.slice(0, 5).join(", ")}${subdirectories.length > 5 ? ", ..." : ""}.&#96; | &#96;&#96; |
| 168 | MethodExpression | 422–422 | subdirectories.slice(0, 5) | subdirectories |
| 169 | StringLiteral | 422–422 | ", " | "" |
| 170 | ConditionalExpression | 422–422 | subdirectories.length > 5 | true |
| 171 | ConditionalExpression | 422–422 | subdirectories.length > 5 | false |
| 172 | EqualityOperator | 422–422 | subdirectories.length > 5 | subdirectories.length >= 5 |
| 174 | StringLiteral | 422–422 | ", ..." | "" |
| 173 | EqualityOperator | 422–422 | subdirectories.length > 5 | subdirectories.length <= 5 |
| 175 | StringLiteral | 422–422 | "" | "Stryker was here!" |
