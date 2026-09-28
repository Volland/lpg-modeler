## Why

`lpg apply` and a live import reach exactly one engine. A team on Neo4j — the target this tool has carried since v1 — can generate a schema and a migration, but cannot read its running instance back into a model, and has to paste the script into a shell to deploy it. Nothing about Neo4j made it wait: the Bolt driver is already an optional peer for Memgraph, and Neo4j 5.26.30 Community runs in a container as readily as Memgraph 3.13.1 does.

Measuring it first turned up the reason this cannot be done by URI scheme alone. Memgraph answers `CALL dbms.components()` with a `Neo4j Kernel` row of its own, and answers `SHOW CONSTRAINTS` — Neo4j's syntax, not its own — with an empty list rather than an error. A `bolt://` URI read as the wrong engine would therefore report a schema with no constraints in it and no failure at all, which is the silent wrong answer decision 8 exists to prevent.

## What Changes

- **Import from a running Neo4j.** `lpg import bolt://host:7687` reads `SHOW CONSTRAINTS`, `SHOW INDEXES`, `db.schema.nodeTypeProperties()`, `db.schema.relTypeProperties()` and `db.schema.visualization()` in read sessions. Keys, uniqueness, required properties and indexes come from the constraints; labels, properties, observed types, the hierarchy and edge endpoints from the schema procedures. Every inference is reported, as a Memgraph import's is.
- **Which engine answered.** Both Bolt engines are probed with `CALL dbms.components()` and identified by a `Memgraph` row, not by the URI. `--from neo4j` or `--from memgraph` overrides the probe, and an engine that answers neither way is reported rather than guessed at.
- **Apply to a running Neo4j.** `lpg apply <script> --target neo4j --uri bolt://…` runs a generated schema or migration statement by statement. The password comes from `NEO4J_PASSWORD`.
- **Edition is checked before it bites.** `dbms.components()` reports the edition, so applying an enterprise script to Community is refused with the constraint that cannot exist there named, rather than failing mid-script.

## Non-goals

- Reading or writing data; `lpg import` stays a schema reader and `apply` still takes a script, never a model.
- Recovering mixins, abstractness beyond co-occurring labels, cardinality or value bounds — Neo4j holds none of them.
- Fulltext, point, vector and lookup indexes, and Enterprise-only property-type constraints, on import.
- `migrate` connecting to anything. It still never does.

## Locked decisions

None amended. Decision 13 is upheld: every statement and every reader shape here is measured against Neo4j 5.26.30 Community in a container. Decision 8 governs the losses the import reports.

## Targets affected

**neo4j** gains live import and apply. **memgraph** is affected only by the probe, which now identifies it explicitly rather than assuming it. **ladybug**, **falkordb**, **shacl**, **owl** and the standards targets are untouched.

## Capabilities

### Modified Capabilities
- `schema-import`: reading a running Neo4j, and telling two Bolt engines apart.
- `schema-deployment`: `apply` accepts a neo4j script, with an edition check.

## Impact

- `core`: `import/neo4j.ts` (a structural session; no driver in core).
- `cli`: engine probe, `neo4j` import source, `apply --target neo4j`, `NEO4J_PASSWORD`.
- Tests: unit tests over hand-written catalogs; container tests behind `LPG_NEO4J_URI`.
- `lat.md` (importers, architecture#Distribution), docs site, README, CHANGELOG.
