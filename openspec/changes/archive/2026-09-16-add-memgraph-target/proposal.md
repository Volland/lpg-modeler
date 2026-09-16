## Why

Memgraph was held back on principle (locked decision 13): no reference implementation to test against. Measuring Memgraph 3.13.1 Community under Podman changed that. It runs locally in seconds and enforces more than Neo4j Community: existence, uniqueness, value-type constraints and native enums, all synchronously. A team on Memgraph today gets no emit, no migrations and no import.

## What Changes

- **New target `memgraph`** (`.cypher`): existence, uniqueness and `IS TYPED` constraints, indexes, native `CREATE ENUM`, hierarchy as labels. Downgrades for edge constraints, cardinality, value constraints, integer widths, and naming a specific enum in a type constraint.
- **Migrations:** a Memgraph planner joins `lpg migrate`. The default target set becomes ladybug, neo4j, falkordb and memgraph. Enum values cannot be removed on Memgraph (measured), and that is reported as a downgrade.
- **Import from a live Memgraph:** `lpg import bolt://host:7687 --from memgraph` reads constraints, indexes and enums over Bolt, plus node and edge structure when the server has `--schema-info-enabled`. Read-only, with losses reported.
- **Apply to a running Memgraph:** `lpg apply <script> --target memgraph --uri bolt://…` runs a script statement by statement, stops at the first failure, and prints what ran.
- **Canvas:** Memgraph appears in the extension's generate picker. The extension never connects to an instance.

## Non-goals

- Memgraph Enterprise, or an edition flag.
- `apply` for other targets (shaped so neo4j can follow).
- Data export or import; triggers, streams, MAGE, vector or text indexes.
- Recovering mixins, or a hierarchy beyond co-occurring labels, on import.

## Locked decisions

None amended. Decision 13 is upheld: Memgraph is now engine-testable, so `emitters#Template Targets` stops naming it as untestable. Decision 8 applies to the new target. Memgraph is pulled forward from the v1 OUT list for the reason above. The migrations change's non-goal "applying a migration to a running database" is reversed for memgraph only, and argued in the design; `apply` is a separate command, so `migrate` still never connects.

## Targets affected

**memgraph** is new (emit, migrate, import, apply). **ladybug**, **neo4j** and **falkordb** are affected only by the default migration set growing by one. **shacl**, **owl**, **template** are unaffected.

## Capabilities

### New Capabilities
- `schema-deployment`: applying a generated or migration script to a running database instance. Memgraph only for now.

### Modified Capabilities
- `schema-generation`: adds the Memgraph target requirement.
- `schema-migration`: the default database target set gains memgraph, and a Memgraph migration requirement is added.
- `schema-import`: adds importing from a live Memgraph instance.

## Impact

- `core`: `emit/memgraph.ts`, `emit/memgraph.migrate.ts`, `import/memgraph.ts` (structural session; no driver in core).
- `cli`: import source `memgraph`, `apply` command, `neo4j-driver` as an optional peer.
- Tests: golden files; container tests against Memgraph behind an opt-in environment variable.
- `lat.md` (emitters, importers, architecture#Roadmap), `openspec/config.yaml`, docs site, README, CHANGELOG.
