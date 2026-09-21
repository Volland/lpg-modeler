# Design

The metamodel does not change. Nothing here adds a way for a model to say something it could not say before: a live Neo4j is a third source for the importer and a second engine for `apply`, and both produce or consume artifacts the tool already generates. The IR is untouched, so the lockfile, diffing and rename detection are untouched with it.

## 1. Which engine is on the other end of the URI

`bolt://` names a protocol, not a product. Measured against both containers:

| Query | Neo4j 5.26.30 Community | Memgraph 3.13.1 |
| --- | --- | --- |
| `CALL dbms.components()` | one row, `Neo4j Kernel` 5.26.30 | two rows, `Memgraph` 5.9.0 **and** `Neo4j Kernel` 5.9.0 |
| `SHOW VERSION` | syntax error | `3.13.1` |
| `SHOW CONSTRAINT INFO` | syntax error | the constraints |
| `SHOW CONSTRAINTS` | the constraints | **empty list, no error** |

The last row is the hazard. Memgraph accepts Neo4j's `SHOW CONSTRAINTS` and answers it with nothing, so a Memgraph read as a Neo4j does not fail — it reports an instance whose schema is empty, and the user gets a model with no keys and no explanation. The probe is therefore positive rather than negative: the engine is Memgraph when `dbms.components()` carries a row named `Memgraph`, and Neo4j when it carries `Neo4j Kernel` and no `Memgraph` row. A `Neo4j Kernel` row alone cannot mean Neo4j unless the Memgraph row is absent, because Memgraph answers with both.

An engine that names neither is reported as `import-unknown-engine` and nothing is read, rather than trying Neo4j's syntax and reporting whatever comes back. `--from` overrides the probe, for an engine this tool has not met.

## 2. What the import reads, and what it may not claim

Constraints are declarations and outrank anything observed, exactly as on Memgraph.

- `SHOW CONSTRAINTS` gives `type`, `entityType`, `labelsOrTypes`, `properties`, `ownedIndex`. `UNIQUENESS` over one property makes it unique; `NODE_KEY` makes those properties the key; `NODE_PROPERTY_EXISTENCE` makes a property required. `RELATIONSHIP_*` rows apply to an edge type.
- On Community, existence and key constraints cannot exist at all (measured: `Node Key constraint requires Neo4j Enterprise Edition`). A key must therefore be recovered from a uniqueness constraint, and — as on Memgraph — the one whose properties carry an index is preferred, with the choice reported when several qualify.
- `SHOW INDEXES` is read for indexes that are not owned by a constraint and not `LOOKUP`: a token lookup index exists on every database and says nothing about a model.
- `db.schema.nodeTypeProperties()` gives label sets, property names, observed types and a `mandatory` flag. That flag is an observation over the stored data, not a declaration — with one node stored, every property it carries looks mandatory — so it contributes **nothing**. On Community, where no existence constraint can exist, no property is read as required except the parts of a key, and `import-edition` says why. Crediting a Community instance with constraints it cannot hold would be the inbound form of silently dropping one. What observation does contribute is a property's presence and its type, reported once as `import-observed`.
- Endpoints come from `db.schema.visualization()`, which names one pair per label rather than per label set: a `:Person:Party` node produces `Person→Order` and `Party→Order` for one relationship. Those sightings collapse to the nearest type both ends descend from, the rule `importers#Reading Edges` already applies to a flat SHACL shape and a Memgraph catalog.

Hierarchy inference reuses the Memgraph rule unchanged — X is an ancestor of Y when every observed label set holding Y holds X, and some set holds X without Y — because `nodeTypeProperties` reports the same label sets `SHOW SCHEMA INFO` does. The shared function moves to `import/labels.ts` so neither importer owns it; nothing else about the Memgraph reader changes, and its tests pin that.

What no Neo4j holds is reported as lost: cardinality, value bounds, named constraints, mixins, enums, abstractness beyond what label sets show, and integer widths.

## 3. Apply, and the edition

`apply` gains a target rather than a shape. The statement splitter already matches what the generator writes, and the measurements confirm the rules it depends on: Neo4j refuses two statements in one query (`Expected exactly one statement per query`), refuses a schema change and a write in one explicit transaction (`ForbiddenDueToTransactionType`), and accepts a trailing `;` in a single statement. One auto-commit statement per run is therefore the only correct shape, which is what `apply` already does.

Two failures are worth distinguishing before connecting. A script generated with `--edition enterprise` applied to Community fails at its first existence constraint with a `ConstraintCreationFailed` naming Enterprise; the edition is readable up front from `dbms.components()`, so the refusal names the whole class of statements that cannot run rather than stopping at the first. A uniqueness constraint that existing data violates fails at that statement with the two offending nodes named, and is not created — the generic partial-application report already covers it.

The header check needs widening, not rewriting: the target line is `Target: neo4j.` but also `Target: ladybug (LadybugDB).` and `Target: falkordb (FalkorDB).`, and today's pattern rejects a parenthetical. It is widened to accept one, so the other two changes in this series do not each touch it.

## 4. Where the work lands

`core` gets `import/neo4j.ts` and `import/labels.ts`, and imports no driver: the reader takes the same structural session type the Memgraph reader does, and the command line opens it. No `vscode` import is introduced, directly or transitively. The extension is unchanged — it still never connects to an instance.

Cited: `importers#Reading a Memgraph Instance`, `importers#Reading Edges`, `importers#Un-flattening Inheritance`, `emitters#Neo4j Target`, `emitters#Capability Matrix`, `architecture#Distribution`.
