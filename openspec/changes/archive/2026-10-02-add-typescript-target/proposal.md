# Add a TypeScript target

## Why

Every current target speaks to a database or a validator, so the model is consulted only when the schema changes. The application code that reads and writes the graph re-declares the same shapes by hand, and nothing fails when the two drift apart. A generated TypeScript declaration makes the model load-bearing on every compile: a renamed property breaks the build instead of a query at runtime.

## What Changes

- A new `typescript` target: one `.ts` file of `interface` declarations per node type, edge type and mixin, string-literal union types per enum, and a `SCHEMA` const carrying what the type system cannot — labels, keys, endpoints and cardinality — for query builders and text-to-Cypher grounding.
- Inheritance maps to `extends`, a mixin to an additional `extends` entry, so a type declares only its own properties. An optional property is `?`; a list is `T[]`; composite types map natively (`STRUCT` to an object type, `MAP` to `Record`/`Map`, `UNION` to a union).
- Scalars the driver ecosystem disagrees on — temporal types, `decimal`, `int128` — are emitted as named type aliases a consumer can remap once.
- What a type cannot enforce — uniqueness, value bounds, named constraints — is written as JSDoc at the site and reported, per the capability rule.

## Non-goals

- No runtime validation, no query builder, no driver bindings: a single generated file with zero imports.
- No Zod/Pydantic variants in this change; they reuse the same IR walk later.
- Not a migratable target: it is regenerated, like the RDF targets.

## Locked decisions

None amended. Decision 13 is upheld in its spirit: the "engine" here is the TypeScript compiler, and the test type-checks the generated artifact with `tsc` in-process rather than snapshotting it alone. Decision 8 governs every downgrade.

## Targets affected

New target **typescript**. No existing target changes.

## Capabilities

### Modified Capabilities
- `schema-generation`: a tenth target.

## Impact

- `core`: `emit/typescript.ts` plus one registry entry. No `vscode` import.
- Tests: golden file for the social fixture; a compile test that type-checks the output of every fixture with the `typescript` package.
- `lat.md/emitters.md` (new TypeScript Target section), CLI usage text, CHANGELOG.
