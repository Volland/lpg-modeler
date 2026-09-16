## Context

See proposal.md — Why. Requirements are in `specs/schema-migration/spec.md`; this document covers how.

**The metamodel does not change.** No model-file key is added or removed, so a 0.11 model resolves the same way.

**The IR changes in one way:** each element that carries an id also records whether that id was *written* in the file or *derived* from its name (see `lat.md/metamodel#Metamodel#Stable Element IDs`). Effect on the lockfile: none directly. A lockfile is only ever written for a model whose ids are all written, so the flag is always true there and is not stored. Effect on diffing: it is the gate that makes id matching trustworthy. No type naming or namespace rule changes, so IRIs are as stable as before. Rename detection goes from promised (`lat.md/emitters#Emitters#Migrations`) to implemented.

Constraints the design leans on:
- `lat.md/architecture#Architecture#Package Boundary`: all planning lives in `core`. The CLI only does file I/O. No `vscode` import is introduced.
- `lat.md/importers#Importers#Serializing a Model`: deterministic ordering is already settled for `.lpg.yaml`. That serializer deliberately omits inherited properties, so it is the wrong snapshot for migrations.
- `lat.md/emitters#Emitters#Ladybug Target`: one table per concrete leaf type, inherited columns copied down, and a synthesized column for a composite key. What 0.19.1 accepts is measured, never assumed.
- `lat.md/emitters#Emitters#Neo4j Target` and `lat.md/emitters#Emitters#FalkorDB Target`: schema objects are derived from names, and FalkorDB requires an index to exist before its constraint.
- `lat.md/emitters#Emitters#Capability Matrix`: a change a target cannot apply is a downgrade with a diagnostic and a comment at the site.

## Goals / Non-Goals

**Goals:**
- A migration's end state is exactly what `emit` would produce from the current model. That equivalence is the test oracle, not a hand-written expectation per case.
- One change set is computed once and shared by every target. Classification is target-neutral; each target adds only how it realizes a change.
- All-or-nothing: either every requested script and the new lockfile are written, or nothing is.

**Non-Goals:**
- Reconstructing a lockfile from git history or from a live database. Baselining an already-deployed model is a documented manual step (see Migration Plan).
- A plugin API for third-party migrators. The registration seam is internal, as the emitter registry is.

## Decisions

### D1. The lockfile is canonical JSON of the resolved IR

It holds the resolved `ModelIR` with `loc` and `file` stripped, arrays sorted by element id, object keys sorted, two-space indentation and a trailing newline. The header fields are `lockfileVersion: 1`, `lpg` (model format version) and `revision`.

- *Why resolved rather than declared:* the targets consume flattened IR. A mixin change reaching five tables shows up in the diff as five column changes, which is what the scripts must contain. Diffing declarations would force every planner to re-flatten both sides. (User decision.)
- *Why JSON rather than YAML:* the lockfile is machine-written and machine-read. Sorted-key JSON is trivially canonical, while the hand-built YAML writer exists to keep flow maps readable for humans.
- *Why sort by id:* reordering declarations then changes nothing. Sorting by name would make a rename look like a move in the file.
- *Rejected:* a content hash in the file (it churns on every change and the revision already orders migrations); a timestamp (non-deterministic, and it breaks the byte-identical scenario).

### D2. Revision numbering instead of timestamps

`migrate` writes `<stem>.<rev:4>.<target>.<ext>` and bumps `revision`. Two branches that both migrate will conflict on the lockfile. That is intentional: it is the moment someone must re-run `migrate` on the merged model, the way sequential SQL migrations surface the same collision. Timestamps would merge silently into two scripts that each assume the other did not run.

### D3. Diff by element id, owner-scoped for properties

Elements are matched per kind (`node`, `edge`, `mixin`, `enum`, `constraint`) by id. A flattened property is identified by *(owner type id, property id)*, because the same property id appears on every type that inherits it. A change to an inherited property therefore arrives once per concrete owner, which is exactly the Ladybug shape.

Change kinds: `added`, `removed`, `renamed`, `moved` (same id, different `inheritedFrom` — a no-op for every current target), `retyped`, `rekeyed`, `required-changed`, `unique-changed`, `cardinality-changed`, `endpoints-changed`, `hierarchy-changed`, `openness-changed`, `enum-values-changed`, `constraint-changed`, `iri-changed`. A single element can produce several changes; a rename plus a retype is two.

Classification (spec: *Changes are classified by impact*) is a pure table over change kind and direction, for example a widened versus narrowed type or cardinality. The rule for an ambiguous direction is to classify as `breaking`: a false alarm costs a look, a false `additive` costs production data.

*Rejected:* structural similarity matching (locked decision 12); a generic JSON diff (it cannot tell a rename from an edit and reports array index churn).

### D4. Written-versus-derived id flag

`parse` already knows when it derives an id. It records `idWritten` on the raw element, and `resolve` carries it into the IR. `lock`, `diff` and `migrate` raise `ids-not-written` for any element with a derived id, and `--allow-destructive` does not bypass this. The flag is not serialized into the lockfile and emitters ignore it.

### D5. Migration planners register beside emitters

`registerTarget` gains an optional `migrate(before: ModelIR, after: ModelIR, changes, options) → { steps, diagnostics }`. A step is `{ statement, destructive, element }`. `migrate` over a target without a planner is `not-migratable`, the same way a capability is declared rather than discovered. The code lives in `packages/core/src/migrate/` (`lockfile.ts`, `diff.ts`, `classify.ts`, `index.ts`) plus `emit/ladybug.migrate.ts`, `emit/neo4j.migrate.ts` and `emit/falkordb.migrate.ts`, reusing the emitters' own column spelling, endpoint expansion and constraint naming. A migration and an `emit` then cannot disagree on how a name is spelled.

Orchestration first plans every target, then evaluates the destructive gate across all of them, and only then writes. Scripts are written first and the lockfile last, so an I/O failure leaves the old lockfile in place and a re-run regenerates everything.

### D6. Ladybug: plan from changes, fall back to recreate, measure first

Statements are ordered as: drop rel tables, drop node tables, rename tables, alter columns, create node tables, create rel tables. A rel table depends on its endpoint tables in both directions.

The `ALTER` forms the planner may use are fixed by a measurement task against `@ladybugdb/core` 0.19.1, recorded in `lat.md` the way the `NOT NULL` finding was: `ADD` column (with or without default), `DROP` column, `RENAME` column, `RENAME` table, and adding or removing a `FROM … TO …` pair on a rel table. Anything not accepted is realized as recreate: `DROP` plus `CREATE`, marked destructive, reported as a `migration-downgrade`. Known recreates before measuring: a key change (the primary key is fixed at creation, including the synthesized composite column), a column type change, and a multiplicity change.

Flattening consequences are handled by D3's owner-scoped identity. A property added to an abstract parent becomes one `ADD` per concrete leaf. A new concrete subtype under an abstract endpoint becomes a new node table plus new endpoint pairs on the rel tables, and those pairs are applied in place if measured possible, otherwise by a recreate.

**Oracle:** for every fixture pair *(before, after)*, build a database from `emit(before)`, apply the migration, and compare `CALL show_tables()` and `table_info` against a database built from `emit(after)`. Additional tests insert rows before migrating and assert that they survive a rename, and that key and multiplicity constraints still reject bad writes afterwards.

### D7. Neo4j and FalkorDB: set difference over emitted schema objects

Both targets are schema objects addressed by name or by label and properties. The planner runs the emitter's constraint and index builder on both IRs to get two sets of `{identity, create statement}`, drops *before − after*, and creates *after − before*. Renames add data steps between the drops and the creates:
- neo4j: `MATCH (n:Old) CALL { WITH n SET n:New REMOVE n:Old } IN TRANSACTIONS`, and similarly `SET n.new = n.old REMOVE n.old` for a property. A relationship type cannot be renamed in place, so it is `CREATE` new plus `DELETE` old, per batch, marked breaking but not destructive because values are copied. A hierarchy change adds or removes ancestor labels.
- falkordb: the same Cypher through `GRAPH.QUERY`. `GRAPH.CONSTRAINT DROP` precedes `DROP INDEX` on the same label and property, and creates keep the emitter's index-then-constraint order. The exact `DROP` syntax is verified against a FalkorDB container under Podman before the golden files are frozen.

Edition downgrades come for free because the builder is the emitter's own. Dropping a node type on either target drops its constraints and indexes only; deleting the nodes is a destructive step emitted solely under the flag.

### D8. CLI surface

`lpg lock <model> [--check]`, `lpg diff <model> [--fail-on additive|breaking|destructive] [--json]`, and `lpg migrate <model> [--target …] [--out dir] [--allow-destructive] [--edition …] [--graph-key …]`. The default `--out` is `migrations/` beside the model. Exit codes follow `check`: 1 for errors or a gate failure, 2 for usage.

## Risks / Trade-offs

- [Migrating one target leaves another behind, because the lockfile is per model] → The default is all three database targets. An explicit subset prints a `partial-migration` warning naming the skipped targets.
- [Ladybug 0.19.1 rejects an `ALTER` form the plan relies on] → Measurement is the first Ladybug task, and every unsupported form falls back to a gated recreate rather than failing.
- [An imported model changes under a consumer and produces migrations its author never wrote] → Intended: the tables really change. The diff names the imported prefix so the source is visible.
- [Relabeling large Neo4j graphs is slow] → Batched `IN TRANSACTIONS`, and the script says so in a header comment. Running it is the operator's call.
- [FalkorDB constraint creation is asynchronous and can end `FAILED`] → Stated in the script header, as `emit` already does.
- [Hand-edited ids defeat rename detection] → An edited id reads as remove plus add, which is destructive and therefore gated. The failure mode is a refusal, not data loss.

## Migration Plan

Existing users adopt in three steps. First, `lpg ids` writes element ids. Second, check out the model at the commit that matches what is deployed and run `lpg lock` there, which records the baseline. Third, return to the current model and run `lpg migrate`. The docs page walks through this. Rollback: delete the lockfile and the scripts. Nothing else in the tool reads them, and `emit` is unaffected.

## Open Questions

- Whether `lpg diff --json` output should become a documented, versioned format, or stay internal until an editor integration consumes it.
