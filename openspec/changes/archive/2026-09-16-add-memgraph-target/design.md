## Context

**The metamodel does not change. The IR does not change.** The effects follow from that:
- Lockfile: unchanged in format. A model locked before this change migrates to memgraph like any other target.
- Diffing: unchanged. Memgraph consumes the existing change set.
- IRI stability and rename detection: unaffected. Import names types by label and uses the importer default namespace, exactly as the LadybugDB importer does.

What already exists:
- Neo4j and FalkorDB emitters, which expose their schema objects to planners.
- `dataSteps`/`stepCypher` for relabels, renames and deletes.
- `planMigration`, with the destructive gate over realizations.
- An import pipeline that accepts pre-read inputs; the LadybugDB database source set that pattern.
- The CLI's optional-peer pattern for native or heavy runtimes.
- The extension, which lists generate targets from `targetNames()` on both the canvas and the command palette.

### Measured against Memgraph 3.13.1 Community (Podman, `memgraph/memgraph:latest`) while writing this design

| Area | Finding |
|---|---|
| Constraints | `CREATE CONSTRAINT ON (n:L) ASSERT n.p IS UNIQUE` (composite `n.a, n.b` too), `ASSERT EXISTS (n.p)` and `ASSERT n.p IS TYPED <T>` are all accepted and enforced on write. |
| Types | `IS TYPED` accepts BOOLEAN, DATE, DURATION, ENUM, FLOAT, INTEGER, LIST, LOCALDATETIME, LOCALTIME, MAP, POINT, STRING and ZONEDDATETIME. It does not accept a specific enum name. |
| Unsupported | No `NODE KEY`. No relationship constraints of any kind. No `IF NOT EXISTS` in the `ON … ASSERT` form. |
| Re-creation | Repeating a unique or existence constraint, or an index, is silently accepted. Repeating a type constraint errors with "already exists", and so does repeating `CREATE ENUM`. |
| Existing data | A constraint that existing data violates is refused synchronously ("because an existing node violates it"). |
| Indexes | `CREATE INDEX ON :L(p)`, `CREATE INDEX ON :L` and `CREATE EDGE INDEX ON :T(p)`. |
| Drops | `DROP CONSTRAINT ON … ASSERT …`, `DROP INDEX ON :L(p)` and `DROP EDGE INDEX ON :T(p)`. Repeating a unique or existence drop or an index drop does not error. |
| Enums | `CREATE ENUM S VALUES { a, b }`, `ALTER ENUM S ADD VALUE c` and `ALTER ENUM S UPDATE VALUE c TO d` work. `DROP ENUM` and `ALTER ENUM … REMOVE VALUE` are "Not yet implemented". A value is written as `S::a`; a string is rejected by an `IS TYPED ENUM` constraint. |
| Batching | `MATCH … CALL { WITH n … } IN TRANSACTIONS OF 1000 ROWS` and `USING PERIODIC COMMIT n` both work for `SET`. Found during implementation: `DELETE` inside `CALL … IN TRANSACTIONS` is refused ("Not yet implemented"), while `USING PERIODIC COMMIT n` works for every data step, including `DELETE` and the relationship copy. |
| Introspection | `SHOW CONSTRAINT INFO`, `SHOW INDEX INFO` and `SHOW ENUMS` always work. `SHOW SCHEMA INFO` needs the server flag `--schema-info-enabled`; without it the query errors. With it, it returns JSON: node label sets with property types and counts, edges with start and end label sets, constraints, indexes and enums. `SHOW NODE_LABELS INFO` needs a different flag. |

Design sections this depends on:
- `lat.md/emitters#Capability Matrix`
- `lat.md/emitters#Neo4j Target`
- `lat.md/emitters#FalkorDB Target`
- `lat.md/emitters#Template Targets`
- `lat.md/emitters#Migrations#Target Planners`
- `lat.md/emitters#Migrations#Destructive Gate`
- `lat.md/importers#Importers`
- `lat.md/importers#Reading a LadybugDB Database`
- `lat.md/importers#Un-flattening Inheritance`
- `lat.md/architecture#Package Boundary`
- `lat.md/architecture#Distribution`
- `lat.md/architecture#Roadmap#Still deferred`

## Goals / Non-Goals

**Goals:**
- A Memgraph target that enforces everything Memgraph Community can enforce, and reports the rest.
- Migrations, import and apply built on the existing seams. No new orchestration and no second planner style.
- Every Memgraph claim in code or docs traces back to a measurement or a container test.

**Non-Goals:**
- Running Memgraph tests by default in `npm test`. They are opt-in, as the design already anticipated for server engines.
- A generic `apply` for all targets. The command is shaped for it, but only memgraph is wired up.

## Decisions

### 1. Target capability set

```ts
MEMGRAPH_CAPABILITIES = {
  target: 'memgraph',
  multiLabel: true,
  inheritance: 'labels',
  requiredConstraint: 'enforced',
  uniqueConstraint: 'enforced',
  compositeKey: 'native',
  edgeProps: 'native',
  nestedEdges: false,
  listProps: 'native',
  compositeTypes: 'unsupported',
  enums: 'enforced',
  openTypes: 'always-open',
  valueConstraints: 'unsupported',
  namedConstraints: 'unsupported',
  rawPassthrough: false,
  cardinality: 'unsupported',
}
```

Every downgrade this implies, each raised as a diagnostic with a comment at the site:
- `downgrade-edge-required` and `downgrade-edge-unique`: Memgraph has no relationship constraints.
- `downgrade-cardinality`.
- `downgrade-composite`: a struct, map, union or array value. `IS TYPED MAP` would admit any map, so it is not claimed.
- `downgrade-enum-identity`: `IS TYPED ENUM` accepts any enum's value, not the named one.
- `downgrade-type-width`, raised for:
  - `int8`/`int16`/`int32`/`uint*`/`int128` → INTEGER, which is 64-bit; `int128` and `uint64` are range-lossy.
  - `float32` → FLOAT.
  - `decimal` → FLOAT, which also loses precision.
- `downgrade-type`, with no type constraint emitted, for `uuid`, `json` and `blob`. They have no Memgraph type: a uuid would be STRING, which admits any string, and json and blob have nothing.
- Value constraints and named constraints go through the shared `reportUnsupportedConstraints`.
- A list property gets `IS TYPED LIST`, and `downgrade-list-element` is raised because the element type is not enforced.

Scalar mapping: string → STRING, integer family → INTEGER, float family → FLOAT, boolean → BOOLEAN, date → DATE, datetime → LOCALDATETIME, zoneddatetime → ZONEDDATETIME, duration → DURATION.

Emission order per concrete type: enum declarations first (for the whole model), then key constraints and an index over the key's properties, then unique, existence, type constraints, and finally indexes.

Found during implementation: Memgraph constraints carry no name, so a type with two unique, present properties (`social`'s `Person.id` and `Person.email`) did not say which one is the key, and the import round trip picked the wrong one. The key index is the assertion that makes it recoverable, following the rule in `lat.md/emitters#Capability Matrix` that anything a machine reads back is asserted rather than left in a comment. It also serves key lookups. A composite `CREATE INDEX ON :L(a, b)` was measured to work, and repeating it is silent. The enum declarations come first because a type constraint does not reference an enum, but data written afterwards needs the enum to exist.

*Alternative considered:* store enum properties as STRING and report the enum as documentation, as on Neo4j. That was rejected because Memgraph really enforces enums, and the capability matrix exists to use what a target can hold. The cost is that application code must write `Status::active`. This is stated in the script header, in `lat.md/emitters#Memgraph Target` and in the targets page.

### 2. Schema objects shared by the emitter and the planner

`emit/memgraph.ts` exports `memgraphSchema(model) → { objects, diagnostics }`, where each object is:

```ts
{
  kind: 'enum' | 'constraint' | 'index' | 'note',
  identity: string,
  create: string,
  drop?: string,
  owner: string,
  enum?: { name: string, values: string[] },
}
```

The emitter prints the `create` statements, so output and planner input cannot diverge. This follows the precedent set by the Neo4j and FalkorDB sinks. The Memgraph target is new, so the objects are its primary representation rather than a sink retrofitted onto line-based code.

Identity is the full definition: kind, label or type, properties and data type. Changing a constraint is therefore a drop plus a create, never an in-place edit.

### 3. Migration planner: same shape as Neo4j, with Memgraph's order and gaps

`emit/memgraph.migrate.ts`:
1. Drop what only the previous revision has: constraints, then indexes.
2. Run the data steps from `dataSteps(before, after)`, rendered with `stepCypher` and batched as `USING PERIODIC COMMIT 1000` (measured: Memgraph refuses `DELETE` inside `CALL … IN TRANSACTIONS`). The helper gains that form; Neo4j keeps `CALL … IN TRANSACTIONS`, so its golden files stay unchanged.
3. Handle enums by comparing each enum across the two revisions:
   - added values → `ALTER ENUM … ADD VALUE`;
   - a new enum → `CREATE ENUM`;
   - removed values, and removed enums → `migration-downgrade` with a comment, and no statement, because Memgraph cannot do either.

   These are not realizations. No data is discarded, and the stale value simply stays admissible.
4. Create what only the current revision has, in emitter order.

A retyped property drops the old type constraint and creates the new one. The comment warns that the create is refused while existing values of the old type remain; that refusal was measured to be synchronous. No data conversion is attempted, which matches the migrations non-goal.

*Alternative considered:* `ALTER ENUM UPDATE VALUE` for a renamed value. Rejected because the diff cannot tell a renamed value from a removed one plus an added one. Enum values carry no element id.

### 4. Import reads through a structural session; core never loads a driver

`import/memgraph.ts` has two parts:
- `readMemgraphSchema(session) → Promise<{ catalog, diagnostics }>` issues `SHOW CONSTRAINT INFO`, `SHOW INDEX INFO`, `SHOW ENUMS` and `SHOW SCHEMA INFO`. The session is `{ run(q): Promise<Array<Record<string, unknown>>> }`. When the schema-info query errors with "SchemaInfo query is disabled", the reader raises an `import-schema-info-disabled` info diagnostic and continues without it.
- `memgraphCatalogToModel(catalog)` builds the model. The CLI converts neo4j-driver records into plain rows before calling it.

Mapping rules:
- **Key:** a unique constraint whose every property also has an existence constraint. Among several candidates, the one whose properties carry exactly one label/property index wins (the emitter indexes the key); otherwise the one with the fewest properties wins, and the choice is reported. The reader therefore issues `SHOW INDEX INFO` too.
- **Hierarchy:** read from co-occurring label sets. Label X is an ancestor of Y when every node set containing Y also contains X, and X occurs in some set without Y. X is abstract when it never occurs alone. Every inference is reported, in the voice of `importers#Un-flattening Inheritance`.
- **Property types:** observed data types (`String`, `Integer`, …) map back to scalars. More than one observed type → the commonest is taken and `import-ambiguous-type` is raised. A type constraint outranks an observation.
- **Edges:** the endpoints are the nearest common ancestor of the observed start labels, and likewise for end labels. This is the same collapse the RDF importer uses.

*Alternative considered:* sample the data with Cypher when schema info is disabled. Rejected because it is a full scan on a production instance, and because the non-goals exclude inferring from data.

### 5. `lpg apply`: explicit, gated, and memgraph only

The migrations change said the tool never connects to a database, and meant it: `emit` and `migrate` stay offline. The reversal is argued in two parts.

First, the reviewed script is still the artifact. `apply` takes a script file, never a model, so what runs is exactly what was reviewed and committed.

Second, Memgraph gives a one-command path no other workflow step does. Unlike LadybugDB it has no embedded mode, and unlike FalkorDB it has no redis-cli pipeline. Without `apply`, running a script means installing mgconsole or writing a driver script, and `mgconsole` would run it as one blob with no per-statement stop and no report.

Mechanics:
- **Header check:** the script's second line must read `Target: memgraph` or `Target: memgraph migration`. Otherwise `apply-target-mismatch`, or `apply-not-generated` for a file without the header.
- **Destructive gate:** any `// DESTRUCTIVE:` marker without `--allow-destructive` gives `destructive-change`. This mirrors `migrate`.
- **Splitting:** statements are split at `;` at end of line after removing `//` comment lines. That is safe because the generator writes one statement per terminated line group and never puts `;` inside a string.
- **Execution:** each statement runs in its own auto-commit transaction (`session.run`), because schema statements and `CALL … IN TRANSACTIONS` need that. Execution stops at the first error, with position, statement and message, and exit 1.
- **Options:** `--dry-run` prints the statements without connecting. Credentials come from `--user` and the `MEMGRAPH_PASSWORD` environment variable, so no password lands in shell history.
- **Driver:** `neo4j-driver` is an optional peer dependency of the CLI, kept external to the bundle and loaded lazily from beside the CLI, then from the working directory. It follows the `@ladybugdb/core` pattern in `architecture#Distribution`, and its roughly 5 MB is paid only by users of `apply` or `import --from memgraph`. `--from memgraph` or a `bolt://` or `bolt+s://` positional path selects the Memgraph import source.

The emitted full-schema script is not idempotent: type constraints and `CREATE ENUM` error on a second run. The header therefore says to apply it to a fresh instance and use `migrate` afterwards, and `apply`'s failure message points there.

*Alternatives considered:*
- An `--apply` flag on `migrate`. Rejected because it would couple planning to deployment and bypass review.
- A generic `apply` for every target now. Rejected because every other target would need its own client, statement-splitting rules and container tests.

### 6. Tests: golden files by default, the container behind an opt-in variable

- **Golden files, always:** emit, and every migration pair.
- **Container tests, only when `LPG_MEMGRAPH_URI` is set.** The `describe.runIf` suites cover:
  - constraints reject bad writes;
  - the migration oracle compares `SHOW CONSTRAINT INFO`/`SHOW INDEX INFO`/`SHOW ENUMS` for migrated vs fresh, for every pair;
  - import round trip;
  - `apply` success and part-way failure.

  The local recipe is documented in `lat.md/emitters#Verification`: `podman run -p 7697:7687 memgraph/memgraph:3.13.1 --schema-info-enabled=true`, then `LPG_MEMGRAPH_URI=bolt://localhost:7697 npm test`. The image is pinned in docs and tests to the measured version.
- **Isolation:** each test clears the instance (`MATCH (n) DETACH DELETE n` plus dropping every listed constraint and index) because Memgraph has one database per instance. The suite is therefore serialised with `describe.sequential`.

*Alternative considered:* testcontainers started from vitest. Rejected because Docker Desktop does not start here and Podman needs socket configuration; it would add a dependency and make CI flaky. The explicit URI works with Podman, Docker or a remote instance.

## Risks / Trade-offs

- [Container tests don't run by default, so regressions may land unnoticed] → Golden files cover every script. The CI workflow adds a job with a Memgraph service container that sets `LPG_MEMGRAPH_URI`. The apply task list includes that job.
- [Memgraph `latest` moves on] → Measurements and docs name 3.13.1, and the recipe pins the tag. The script header names the version the target was measured against.
- [Native enums change how applications write values (`Status::active`)] → Stated in the script header, the targets page and `lat.md`. An enum is also reported per property with the identity downgrade.
- [Hierarchy inference from label sets can be wrong on sparse data] → Every inference is reported, and nothing is inferred from a single co-occurrence when the parent never appears without that child. That is the same conservative rule as `importers#Un-flattening Inheritance`.
- [`apply` against production] → Guards: the header check, the destructive gate, `--dry-run`, stopping at the first failure, and a printed record of what ran. Rollback is not automatic, and the docs say to take a snapshot first.
- [The default migrate target set grows, so existing users get a fourth script] → That is intended, and the CHANGELOG says so. `--target` narrows the set, with the existing `partial-migration` warning.

## Migration Plan

Additive for model files and existing artifacts. The one visible change for existing users is that `lpg migrate` with no `--target` also writes a `.memgraph.cypher` script. Rollback is reverting the change; nothing reads the new files.
