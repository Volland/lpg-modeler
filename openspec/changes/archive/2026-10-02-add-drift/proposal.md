# Add lpg drift: detect schema drift between a model and a deployed database

## Why

`lpg diff` guards the model against its lockfile, and `apply` writes reviewed scripts — but nothing yet answers "is the database still what the model says?" A schema changed by hand on the server, or a deploy that never ran, is invisible until a query fails. The importers already read every engine's schema and the emitters already compute what the schema should be; drift is the comparison between the two, as a CI-ready command.

## What Changes

- `lpg drift <model>` compares a live schema against the model and reports every difference as `missing` (the model declares it, the database lacks it), `unexpected` (the database holds it, the model does not), or `different` (same object, different shape). It exits non-zero when anything drifted, with `--json` for machines.
- Sources: `--database <path>` (LadybugDB, opened read-only), `--uri bolt://…` (engine probed, Memgraph first, as import does), `--uri redis://…` with `--graph-key` (FalkorDB), and `--script <ddl>` to drift against a committed LadybugDB DDL artifact with no database at all.
- The comparison is per target over the objects that target actually stores — tables, columns, keys and endpoint pairs on LadybugDB; constraints and indexes on the three server engines — built by the emitters' own schema-object functions, so drift can never spell an expectation differently from `emit`. What an engine cannot store is out of scope by construction, so a lossy import never reads as drift.
- Matching is structural (kind, entity, label, properties), never by constraint name: a schema deployed by another tool with different names but the same shape is not drift.

## Non-goals

- No reconciliation: drift reports; `lpg migrate` and `lpg apply` remain the way to change a database.
- No data inspection — this is schema drift; `lpg audit` owns the data.
- No drift against the lockfile: the lockfile-vs-model question is `lpg diff`; drift is model-vs-database. Combining the two reads is a shell pipeline, not a mode.

## Locked decisions

None amended. Decision 12 is respected by not pretending: a live schema carries no element ids, so drift matches structurally and says so. Decision 13: the LadybugDB comparison is verified in-process; the server engines' comparisons are unit-tested over hand-written catalogs and exercised by the live suites.

## Targets affected

**ladybug, neo4j, memgraph, falkordb** become drift-checkable. Emitted artifacts do not change.

## Capabilities

### Modified Capabilities
- `schema-deployment`: drift detection joins apply.

## Impact

- `core`: `src/drift.ts`; small structured-field additions to the Neo4j schema objects. No `vscode` import; no connection opened in core.
- `cli`: the `drift` command over the existing connection and catalog plumbing.
- Tests: in-process LadybugDB round trip (apply then drift-clean, mutate then drift-reported); catalog-based unit tests for the server engines; live suites extended.
- `lat.md`: drift section beside the importers; CLI usage, CHANGELOG.
