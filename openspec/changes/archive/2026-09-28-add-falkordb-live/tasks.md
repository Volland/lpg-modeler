## 1. Measure FalkorDB 4.20.4

- [x] 1.1 Extend `packages/core/test/falkordb.live.test.ts` (or add it) behind `LPG_FALKORDB_URI`, pinning:
  - `db.constraints()` and `db.indexes()` column names and shapes
  - a create returns `PENDING`; a constraint the data violates settles `FAILED` and enforces nothing
  - enforcement messages for a duplicate key and a missing mandatory property
  - a repeated create replies `Constraint already exists`
  - `GRAPH.QUERY` against an unknown key creates that key, and `GRAPH.LIST` then lists it
- [x] 1.2 Add a `falkordb-harness.ts`: connect, `send(args)`, `reset()` (delete the graph key), `schemaState()` (sorted constraints and indexes).

## 2. Reading the schema

- [x] 2.1 `import/falkordb.ts`: the structural client type, `readFalkorSchema(client, graphKey)` — the graph-key check against `GRAPH.LIST` first, then constraints, indexes, labels, relationship types, and the bounded sampling queries.
- [x] 2.2 `falkorCatalogToModel`: key from a `UNIQUE` plus `MANDATORY` plus index, required and unique from constraints, properties from the sample; reuse `import/labels.ts` for the hierarchy and the endpoint collapse.
- [x] 2.3 Drop non-operational constraints with `import-constraint-failed`, and report a truncated sample.
- [x] 2.4 Unit tests over hand-written catalogs: key selection, competing uniques, a `FAILED` constraint ignored, a `PENDING` one ignored, relationship constraints, a label with no key.

## 3. Reading the script back

- [x] 3.1 A reader in `core` turning a generated falkordb script into an ordered list of argument vectors: `$REDIS_CLI` lines only, quotes honoured, `$GRAPH_KEY` substituted, preamble and comments skipped, anything else an error naming the line and its number.
- [x] 3.2 Unit tests over the committed golden scripts — every `social.falkordb.sh` and migration golden parses, and the vectors match what the file says — plus refusals for a loop, a pipe and an unknown command.

## 4. CLI

- [x] 4.1 Add the Redis client as an optional peer dependency, external in the bundle, loaded beside the CLI then from cwd with an install hint. Check `dist/cli.js` does not inline it.
- [x] 4.2 `lpg import redis://…`: `--graph-key`, or the only graph, or a list and a refusal; read in one connection and close it in `finally`.
- [x] 4.3 `lpg apply --target falkordb --uri redis://…`: send each vector, print progress, stop at the first refusal, then read the constraints back and report anything `FAILED`.
- [x] 4.4 CLI tests without a server: the unreadable-line refusal, the missing-client hint, an unreachable URI, `--dry-run` printing the commands.
- [x] 4.5 CLI container tests: apply a generated script to an empty graph; apply against data that defeats a constraint and see `FAILED` reported; import back to a model file that checks clean; a mistyped graph key refused with no graph created (assert `GRAPH.LIST` afterwards).

## 5. Documentation

- [x] 5.1 `lat.md/importers.md`: a `Reading a FalkorDB Instance` section (the graph-key hazard, constraint status, sampling). `lat.md/emitters.md#FalkorDB Target`: that the script is now also readable by `apply`. `lat.md/architecture.md#Distribution`: the third optional peer.
- [x] 5.2 Docs site, README, CHANGELOG, CLI usage text.
- [x] 5.3 `openspec/config.yaml`: add the new FalkorDB measurements (FAILED status, graph creation on read, enforcement messages).

## 6. Verification

- [x] 6.1 `npm run build`, `npm test`, `npm run lint`; every existing golden file unchanged.
- [x] 6.2 Run the FalkorDB suites against a Podman `falkordb/falkordb:v4.20.4` container. Remove only the containers this change started.
- [x] 6.3 `lat check`.
