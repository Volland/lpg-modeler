# Add a SQL/PGQ target

## Why

SQL:2023 property graph queries (SQL/PGQ) are the second half of the standards story the GQL target already tells: the same model should generate the `CREATE PROPERTY GRAPH` definition that Oracle 23ai and DuckDB's PGQ extension consume, so a team on a relational engine gets the graph view of their schema from the same file.

## What Changes

- A `sqlpgq` target: DuckDB tables for node and edge types carrying the constraints, plus a `CREATE PROPERTY GRAPH` statement mapping them — vertex tables with keys and labels, edge tables with source and destination foreign keys. An edge reaching an abstract endpoint is one edge table and label per concrete pair, reported.

## Gate (resolved)

DuckDB 1.4.4 with the `duckpgq` community extension installs and runs, so the surface was measured, not recalled (decision 13). Measured: NOT NULL, UNIQUE, CHECK, foreign keys and enum types are all enforced; every property-graph label must be unique across tables, and `[:A|B]` does not parse; `AT` fails as a table name although it is not reserved, while all 330 unreserved keywords parse bare. The target is DuckDB-flavoured SQL/PGQ; Oracle's dialect is not attempted.

## Non-goals

- No query translation; schema definition only.
- No Oracle dialect, and no migrations: the target is regenerated, like the RDF ones.

## Locked decisions

None amended. Decision 13 is upheld: the target ships because DuckDB with `duckpgq` could be installed and every claim is executed in it. Widening `Capabilities.namedConstraints` to admit `partial` is a type change, not a metamodel one.

## Targets affected

New target **sqlpgq**. Its capability set is ladybug-like in structure (leaf tables) and unlike it in enforcement: required, unique, enums and value constraints are all enforced, because the engine is relational.

## Capabilities

### Modified Capabilities
- `schema-generation` (deferred addition).

## Impact

- `core`: `emit/sqlpgq.ts`; a DuckDB-PGQ measured-behaviour section in the config when implemented.
