## 1. Test harness

- [x] 1.1 Add `packages/core/test/memgraph-harness.ts`:
  - connect with `neo4j-driver` from the root dev dependencies to `LPG_MEMGRAPH_URI`
  - `run(q)` returning plain rows
  - `reset()`: detach-delete all nodes, then drop every constraint and index listed by `SHOW CONSTRAINT INFO`/`SHOW INDEX INFO`
  - `schemaState()`: sorted constraints, indexes and enums
  - suites gated with `describe.runIf(process.env.LPG_MEMGRAPH_URI)` and run sequentially
- [x] 1.2 Add `neo4j-driver` to root devDependencies and confirm it talks to Memgraph 3.13.1 over Bolt against a Podman container: run a query and read a record. If it does not work, record the driver version that does before going further.
- [x] 1.3 Pin the measured behaviour in `packages/core/test/memgraph.live.test.ts`:
  - accepted: unique, composite unique, exists and every `IS TYPED` type; index and edge index; `CREATE ENUM`/`ADD VALUE`
  - rejected: `NODE KEY`, relationship constraints, a named enum in `IS TYPED`, `DROP ENUM`, `REMOVE VALUE`
  - silent repeat of unique, exists and index; error on repeat of a type constraint and of `CREATE ENUM`
  - a synchronous refusal of a constraint that existing data violates
  - `CALL … IN TRANSACTIONS OF n ROWS` for `SET`, its refusal of `DELETE`, and `USING PERIODIC COMMIT n` for every data step
  - found during implementation: `SHOW CONSTRAINT INFO` reports `BOOL`, `LOCAL DATE TIME`, `LOCAL TIME` and `ZONED DATE TIME`, which the drop syntax does not accept; enums survive `DROP GRAPH` and a restart

## 2. Memgraph target

- [x] 2.1 Create `emit/memgraph.ts` with `MEMGRAPH_CAPABILITIES` and `memgraphSchema(model)` returning enum, constraint, index and note objects with identity, create and drop statements (design decisions 1 and 2).
- [x] 2.2 Implement the scalar-to-`IS TYPED` mapping and every downgrade in decision 1 (edge required/unique, cardinality, composite, enum identity, type width, untyped scalars, list element), each with a diagnostic and a comment at the site. Route value and named constraints through `reportUnsupportedConstraints`.
- [x] 2.3 Implement `emitMemgraph`: a header naming Memgraph 3.13.1 Community, the enum write syntax (`Status::active`) and that the script is for a fresh instance; enums first, then per-type objects. Register `memgraph` in the target registry.
- [x] 2.4 Golden files for `social`, `features`, `composites`, `types` and every published example. Assert that each downgrade code appears and that no required, unique or key constraint is silently absent.
- [x] 2.5 Container test: run the generated script for `social` and `booking` on a fresh instance. Assert that a missing key, a duplicate key, a wrong-typed value and a non-enum value are each rejected, and that a valid node is accepted.
- [x] 2.6 Extension: add a test that `memgraph` appears in the canvas generate targets and in the command-palette pick list, and that generating from the canvas writes the same content as `emit`. Add the `memgraph` keyword to the extension and CLI `package.json`.

## 3. Memgraph migration

- [x] 3.1 Extend `stepCypher` with a batching option for Memgraph. Implementation found that Memgraph refuses `DELETE` inside `CALL … IN TRANSACTIONS`, so it renders `USING PERIODIC COMMIT 1000` instead. Confirm that the Neo4j and FalkorDB migration golden files are byte-identical.
- [x] 3.2 Implement `emit/memgraph.migrate.ts`: constraint drops, index drops, data steps, enum value adds and new enums, then creates in emitter order; retype comments; `migration-downgrade` for removed enum values and removed enums (decision 3). Register the planner and add `memgraph` to `DATABASE_TARGETS`.
- [x] 3.3 Update the orchestration and CLI tests for the four default targets (`shop.0002.memgraph.cypher`) and the `partial-migration` wording.
- [x] 3.4 Golden files: add `<pair>.memgraph.cypher` for every migration pair, plus pairs for adding an enum value, removing an enum value and adding an enum. Add unit tests for the rename ordering and the retype scenarios.
- [x] 3.5 Container oracle: for every pair, `reset()`, apply `emit(before)`, apply the migration, and record `schemaState()`. Then `reset()`, apply `emit(after)`, and compare the two. The only allowed difference is enum values the migration reported as unremovable.
- [x] 3.6 Container data test: seed nodes, apply the `rename-node-type` and `rename-property` migrations, and assert that the data survives and the new key constraint rejects a duplicate.

## 4. Import from Memgraph

- [x] 4.1 Create `import/memgraph.ts` with the `MemgraphSession` structural type and `readMemgraphSchema(session)`: the four queries; the schema-info-disabled fallback with `import-schema-info-disabled`; `import-catalog` errors on unexpected result shapes.
- [x] 4.2 Implement `memgraphCatalogToModel`: key selection, required/unique/type mapping, enums, and properties observed from schema info with `import-ambiguous-type`.
- [x] 4.3 Implement label-set hierarchy inference and edge endpoint collapse, reporting every inference, plus `import-no-key` for a label without a key. Unit-test on hand-written catalogs covering single-child, shared-parent and abstract-parent cases.
- [x] 4.4 Route catalog inputs through `importModel`: accept `memgraph` as a source and let a catalog input be tagged by source. Confirm that the Ladybug catalog path and its tests are unchanged.
- [x] 4.5 Container round-trip test: apply `emit(model)` for `social` and `catalog` to an instance started with `--schema-info-enabled`, seed one node per concrete type and one edge per edge type, import, and assert the node types, keys, required and unique properties and enums. Test the disabled-schema-info fallback against the same instance through a session that returns the measured error.

## 5. CLI: import and apply

- [x] 5.1 Add `neo4j-driver` as an optional peer dependency of the CLI, external in the bundle, loaded lazily beside the CLI and then from cwd, with an install hint. Check that `dist/cli.js` does not inline it.
- [x] 5.2 `lpg import bolt://…` (or `--from memgraph`): connect with `--user` and `MEMGRAPH_PASSWORD`, read the schema over a read session, close in `finally`. On an unreachable instance or failed authentication, report the URI and reason, exit 1, write nothing.
- [x] 5.3 `lpg apply <script> --target memgraph --uri …`:
  - header check: `apply-target-mismatch`, `apply-not-generated`, `apply-unsupported` for other targets
  - destructive gate
  - statement splitting
  - one auto-commit run per statement, printing each as it succeeds, and stopping at the first failure with its position, statement and message
  - `--dry-run`, usage text
- [x] 5.4 CLI tests without a server: the header and target refusals, the destructive refusal, `--dry-run` output, the missing-driver hint (as in the LadybugDB runtime test), and an unreachable URI.
- [x] 5.5 CLI container tests: apply a generated script to a fresh instance (exit 0); apply a script whose unique constraint is violated by seeded data (earlier statements applied, exit 1, position reported); import from the instance to a model file that checks clean.
- [x] 5.6 Add a CI job in `.github/workflows/ci.yml` with a `memgraph/memgraph:3.13.1` service started with `--schema-info-enabled=true`, setting `LPG_MEMGRAPH_URI` and running the Memgraph suites.

## 6. Documentation

- [x] 6.1 `lat.md/emitters.md`:
  - new `Memgraph Target` section: capability set, the enum write-syntax trade-off, and a `Measured Schema Syntax` subsection
  - `Template Targets`: stop naming Memgraph as untestable
  - `Migrations#Target Planners`: add the Memgraph planner
  - `Verification`: the opt-in container recipe
  - `@lat:` refs from the new tests
- [x] 6.2 `lat.md/importers.md`: new `Reading a Memgraph Instance` section (queries, schema-info flag, key selection, label-set hierarchy inference, losses). `lat.md/architecture.md`: Roadmap (Memgraph no longer deferred) and Distribution (`neo4j-driver` optional peer, `apply` as the one command that connects).
- [x] 6.3 Docs site:
  - `targets.html`: Memgraph section including enum write syntax
  - `cli.html`: `apply`, the `import` Bolt source, the migrate default set
  - `migrations.html`: applying to Memgraph
- [x] 6.4 README targets list, CLI examples and CHANGELOG entry. The entry states that `lpg migrate` with no `--target` now also writes a memgraph script.
- [x] 6.5 `openspec/config.yaml`: move memgraph from OUT to IN with the reason; add the Memgraph 3.13.1 measurements to the measured-behaviour block; add memgraph to the `target` vocabulary line if it is missing.

## 7. Verification

- [x] 7.1 Run `npm run build`, `npm test` and `npm run lint`. Confirm that every existing golden file is unchanged, apart from new memgraph files.
- [x] 7.2 Run the Memgraph suites against a Podman `memgraph/memgraph:3.13.1` container with `LPG_MEMGRAPH_URI` set, all passing. Remove the container afterwards without touching other containers.
- [x] 7.3 Run `lat check` and confirm that all wiki links and code refs pass.
