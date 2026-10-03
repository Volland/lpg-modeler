# Design

The metamodel does not change and the IR does not change, so the lockfile, diffing and rename detection are untouched. Work lands in `core` (`emit/typescript.ts`); no `vscode` import. Depends on `lat.md/emitters#Emitters#Capability Matrix`, `lat.md/metamodel#Type Hierarchy#Mixins`, `lat.md/metamodel#Composite Types`.

## Capability set

`typescript`: multiLabel true (labels live in `SCHEMA`), inheritance `subclass`, requiredConstraint `enforced` (an omitted non-optional field fails to compile), uniqueConstraint `unsupported`, compositeKey `native` (listed in `SCHEMA`), edgeProps `native`, nestedEdges false, listProps `native`, compositeTypes `native`, enums `enforced` (a value outside the union fails to compile), openTypes `native` (an open type gains an index signature), valueConstraints `unsupported`, namedConstraints `unsupported`, rawPassthrough false, cardinality `unsupported` (carried in `SCHEMA`, not enforced).

Downgrades: uniqueness, bounds, patterns, lengths and named constraints are JSDoc at the site plus the shared `reportUnsupportedConstraints` info diagnostics; cardinality beyond the manifest is a comment on the edge interface.

## Decisions

### 1. Own properties only; `extends` carries the rest

The IR flattens inherited (`inheritedFrom`) and mixin-applied (`sourceId`) properties onto every type. The emitter declares only properties with neither marker, and writes `extends Parent, MixinA` — so the declaration reads like the model file, and a mixin change edits one interface.

### 2. Scalar mapping, with aliases for the contested ones

`string`→`string`, integer widths through `int32`→`number`, `int128`/`uint64`→`bigint`, floats→`number`, `boolean`→`boolean`, `uuid`→`string`, `blob`→`Uint8Array`, `json`→`unknown`. `decimal`, `date`, `datetime`, `zoneddatetime` and `duration` become exported aliases (`LpgDecimal = string`, `LpgDate = string`, …) declared once at the top: drivers disagree about these (a Neo4j driver hands back temporal objects, a JSON pipeline hands back strings), so the consumer remaps one line instead of every field.

### 3. A `SCHEMA` const for what types cannot say

`SCHEMA.nodes.<Name> = { labels, key, abstract }` (labels = own name plus ancestors, the multi-label targets' reading) and `SCHEMA.edges.<NAME> = { from, to, cardinality }`, all `as const`. This is the grounding a query builder or an agent needs at runtime, and it is derived from the same IR as the interfaces, so the two cannot disagree.

### 4. Name collisions

An edge interface that would collide with a node type, mixin or enum name is emitted as `<Name>Edge`, and the collision is reported. A name that is not a TypeScript identifier is not expected from a validated model; if one arrives, it is reported as a downgrade and sanitized.

## Verification

A golden file pins the social fixture. A compile test runs `ts.createProgram` over the emitted artifact of every fixture with `strict: true` and asserts zero diagnostics — the TypeScript compiler is the engine this target is measured against.
