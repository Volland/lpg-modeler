## 1. Measure Neo4j 5.26.30 Community

- [x] 1.1 Pin the measured behaviour in `packages/core/test/neo4j.live.test.ts`, behind `LPG_NEO4J_URI`:
  - refused on Community: node key, relationship key, node and relationship existence, property type constraints, each naming Enterprise
  - accepted: node uniqueness, composite uniqueness, relationship uniqueness, range index
  - `CREATE … IF NOT EXISTS` repeats silently; the same create without it raises `EquivalentSchemaRuleAlreadyExists`; `DROP … IF EXISTS` on something absent is silent
  - a uniqueness constraint that stored data violates fails and is not created
  - two statements in one query are refused; a schema change and a write in one explicit transaction are refused; a trailing `;` in a single statement is accepted
- [x] 1.2 Add a `neo4j-harness.ts` beside the Memgraph one: connect, `run`, `reset()` (detach delete, drop every constraint, drop every non-LOOKUP index), `schemaState()`.

## 2. Reading the schema

- [x] 2.1 Extract the label-set hierarchy inference from `import/memgraph.ts` into `import/labels.ts` unchanged, and confirm the Memgraph unit tests still pass byte for byte.
- [x] 2.2 `import/neo4j.ts`: the `Neo4jSession` structural type and `readNeo4jSchema(session)` — constraints, indexes, `nodeTypeProperties`, `relTypeProperties`, `visualization`, plus the edition from `dbms.components()`. A refused query is an `import-catalog` error; a missing schema procedure narrows the import and says so.
- [x] 2.3 `neo4jCatalogToModel`: key from a node key constraint, else recovered from a uniqueness constraint (index preferred, choice reported); unique and required from constraints; observed properties and types; `import-observed` for anything the data alone supports.
- [x] 2.4 Hierarchy from label sets and endpoint collapse from `visualization`, reporting every inference; `import-no-key` for a label with no recoverable key; report the losses (cardinality, bounds, named constraints, mixins, enums, widths).
- [x] 2.5 Unit tests over hand-written catalogs: key recovery with and without an index, competing uniqueness constraints, LOOKUP and constraint-owned indexes ignored, one relationship seen under several label pairs, a label with no key.

## 3. Telling the engines apart

- [x] 3.1 CLI: probe with `CALL dbms.components()`; memgraph when a `Memgraph` row is present, neo4j when only `Neo4j Kernel` is; `import-unknown-engine` otherwise. `--from` overrides.
- [x] 3.2 Register `neo4j` as an import source and route a probed catalog through `importModel`, leaving the Memgraph path and its tests unchanged.
- [x] 3.3 CLI tests: the probe on both engines behind their URIs; `--from` overriding; the unknown-engine refusal against a stub session.

## 4. Apply

- [x] 4.1 Widen the header check to accept a target named with a parenthetical engine, and cover `ladybug (LadybugDB)` and `falkordb (FalkorDB)` in a test now, so the later changes need not touch it.
- [x] 4.2 `apply --target neo4j`: connect with `NEO4J_PASSWORD`, run one statement per auto-commit transaction, and reuse the existing failure reporting.
- [x] 4.3 Refuse an enterprise script against a Community instance before running anything, naming the offending statements (`apply-edition`).
- [x] 4.4 CLI tests without a server: target mismatch, destructive gate, `--dry-run`, missing driver, unreachable URI. Container tests: a clean apply, a re-apply that changes nothing, a violated constraint mid-script, and the edition refusal.

## 5. Round trip

- [x] 5.1 Container round-trip test: apply the generated schema for `social` and `catalog`, seed one node per concrete type and one relationship per edge type, import, and assert node types, keys, unique and required properties, edge endpoints and hierarchy; assert the written file passes `check`.

## 6. Documentation

- [x] 6.1 `lat.md/importers.md`: a `Reading a Neo4j Instance` section and a `Telling Two Bolt Engines Apart` section, with `@lat:` refs from the new tests. `lat.md/architecture.md#Distribution`: apply is no longer Memgraph-only.
- [x] 6.2 Docs site (`cli.html`, `targets.html`, `migrations.html`), README, CHANGELOG, and the CLI usage text.
- [x] 6.3 `openspec/config.yaml`: add the Neo4j 5.26.30 Community measurements to the measured-behaviour block.

## 7. Verification

- [x] 7.1 `npm run build`, `npm test`, `npm run lint`; every existing golden file unchanged.
- [x] 7.2 Run the Neo4j suites against a Podman `neo4j:5-community` container, and the Memgraph suites against `memgraph:3.13.1`, to prove the probe on both. Remove only the containers this change started.
- [x] 7.3 `lat check`.
