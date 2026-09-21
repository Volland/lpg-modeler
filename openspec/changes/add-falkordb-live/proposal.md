## Why

FalkorDB is the one database target where a required property is genuinely enforced, and the only one whose schema cannot be read back or deployed by this tool. It is also the awkward case, which is why it comes last in this series: its artifact is a shell script over `redis-cli`, not a file of statements, because an index is Cypher and a constraint is a Redis command and no single client speaks both.

That reasoning was about what a *file* can carry. It does not follow that the tool cannot apply one: a client that can send an arbitrary Redis command can send both halves, and the script's own lines are a small, fixed set of shapes this tool wrote itself.

## What Changes

- **Import from a running FalkorDB.** `lpg import redis://host:6379/<graph>` reads `CALL db.constraints()`, `CALL db.indexes()`, `db.labels()`, `db.relationshipTypes()` and `db.propertyKeys()`. `MANDATORY` makes a property required, `UNIQUE` makes it unique, and a property that is both, with a backing index, is read as the key — the rule already used on Memgraph, applied to FalkorDB's vocabulary.
- **A constraint's status is part of what it says.** Measured, a constraint is applied asynchronously and one the stored data violates ends `FAILED` and is never enforced. A `FAILED` or `PENDING` constraint SHALL NOT be read as an enforced part of the schema; it is reported.
- **Structure from the graph.** Label sets and edge endpoints have no catalogue in FalkorDB, so they come from bounded sampling queries, and the hierarchy inferred from them is reported as an inference — the same treatment a Memgraph import gets.
- **Apply to a running FalkorDB.** `lpg apply <script> --target falkordb --uri redis://…` reads the generated shell script's `$REDIS_CLI` lines back into the commands they invoke and sends each one, stopping at the first failure. A line that is not one of the shapes the generator writes is refused rather than interpreted.
- **A Redis client as an optional peer**, loaded lazily with an install hint, exactly as `@ladybugdb/core` and `neo4j-driver` already are.

## Non-goals

- Running arbitrary shell scripts. `apply` reads the generated shapes and nothing else; a hand-edited script with a loop or a variable in it is refused, not executed.
- Data, `GRAPH.COPY`, replication, or FalkorDB's vector and fulltext indexes.
- Waiting for a `PENDING` constraint to settle, or retrying a `FAILED` one.
- Recovering enums, cardinality, value bounds or mixins — FalkorDB holds none.

## Locked decisions

None amended. Decision 13 is upheld: every command and every result shape is measured against FalkorDB 4.20.4 in a container. Decision 8 governs the losses reported on import.

## Targets affected

**falkordb** gains live import and apply. Every other target is untouched; the emitted artifact itself does not change.

## Capabilities

### Modified Capabilities
- `schema-import`: reading a running FalkorDB instance.
- `schema-deployment`: `apply` accepts a falkordb script, read back into Redis commands.

## Impact

- `core`: `import/falkordb.ts` (a structural client type; no Redis client in core) and a reader for the script's command lines.
- `cli`: `redis://` URIs, a Redis client as an optional peer, `FALKORDB_PASSWORD`.
- Tests: unit tests over hand-written catalogs and over script text; container tests behind `LPG_FALKORDB_URI`.
- `lat.md` (importers, emitters#FalkorDB Target, architecture#Distribution), docs site, README, CHANGELOG.
