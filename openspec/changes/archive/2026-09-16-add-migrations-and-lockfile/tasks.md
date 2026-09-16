## 1. Written-versus-derived element ids

- [x] 1.1 Record in `parse` whether each element's id was written or derived, carry it through `resolve` into the IR, and confirm no emitter output changes (existing golden files stay byte-identical)
- [x] 1.2 Add a helper that lists elements with derived ids, with tests covering a hand-written model, a fully backfilled model, and a model with one missing property id

## 2. Lockfile

- [x] 2.1 Create `packages/core/src/migrate/lockfile.ts`: canonical JSON writer over the resolved IR (strip `loc` and `file`, sort arrays by element id, sort keys, two-space indent, trailing newline, header `lockfileVersion`/`lpg`/`revision`)
- [x] 2.2 Add the lockfile reader, with errors for an unreadable file and for a newer `lockfileVersion`
- [x] 2.3 Tests: byte-identical on repeat, unchanged by declaration reordering and by layout sidecar edits, mixin properties present on every concrete subtype, imported types present, and `ids-not-written` refusal
- [x] 2.4 Check that `packages/core/src/migrate/` introduces no `vscode` import (the boundary test covers the new directory)

## 3. Semantic diff and classification

- [x] 3.1 Create `migrate/diff.ts`: match per kind by element id, identify properties by (owner type id, property id), and emit added/removed/renamed/moved changes
- [x] 3.2 Extend the diff with retyped, rekeyed, required-changed, unique-changed, cardinality-changed, endpoints-changed, hierarchy-changed, openness-changed, enum-values-changed, constraint-changed and iri-changed
- [x] 3.3 Create `migrate/classify.ts`: a table from change kind and direction to `additive`/`breaking`/`destructive`, defaulting ambiguous directions to `breaking`
- [x] 3.4 Add fixture pairs (before/after models) under `packages/core/test/fixtures/migrate/` covering each change kind, and tests asserting change sets and classes for each spec scenario, including the hand-replaced-id and moved-to-ancestor cases

## 4. Migration orchestration

- [x] 4.1 Extend target registration with an optional migration planner, and report `not-migratable` for targets without one
- [x] 4.2 Implement orchestration: plan all requested targets, apply the destructive gate across all of them (including target-level destructive realizations), and return scripts plus the next lockfile, or errors with nothing to write
- [x] 4.3 Tests: empty change set writes nothing, a gate refusal leaves the revision unchanged, and a change with no schema effect produces a script saying so

## 5. Ladybug migration

- [x] 5.1 Measure against `@ladybugdb/core` 0.19.1 which forms are accepted (ALTER TABLE ADD with and without default, DROP column, RENAME column, RENAME table, adding and removing a rel table FROM/TO pair), and record the results in a live test
- [x] 5.2 Implement `emit/ladybug.migrate.ts` for added/removed/renamed node types, edge types and properties, reusing the emitter's column spelling and endpoint expansion, with statement ordering as in design D6
- [x] 5.3 Implement recreate fallbacks (key change, column type change, multiplicity change, and any form rejected in 5.1) as destructive steps with `migration-downgrade` diagnostics and comments at the site
- [x] 5.4 Golden-file tests for the ladybug migration script of each fixture pair
- [x] 5.5 In-process execution test (oracle): build from `emit(before)`, apply the migration, and assert the catalogue equals a database built from `emit(after)` for every fixture pair
- [x] 5.6 In-process execution test: insert rows, apply a rename migration, assert the rows survive, and assert the key and multiplicity constraints still reject a duplicate key and a second target on a MANY_ONE edge

## 6. Neo4j migration

- [x] 6.1 Expose the neo4j emitter's constraint and index builder as a set of `{identity, create statement}` without changing emitted output
- [x] 6.2 Implement `emit/neo4j.migrate.ts`: drop before−after, rename data steps (labels, relationship types, properties, ancestor labels) in batched transactions, then create after−before
- [x] 6.3 Golden-file tests for community and enterprise editions across the fixture pairs, including the rename-ordering scenario and the Community downgrade comment

## 7. FalkorDB migration

- [x] 7.1 Verify the `GRAPH.CONSTRAINT DROP` and `DROP INDEX` syntax against a FalkorDB container under Podman (without touching existing containers) and record the findings
- [x] 7.2 Expose the falkordb emitter's index and constraint builder as a set without changing emitted output
- [x] 7.3 Implement `emit/falkordb.migrate.ts` with constraint-before-index drops, index-before-constraint creates, and rename data steps via `GRAPH.QUERY`
- [x] 7.4 Golden-file tests for the falkordb migration script of each fixture pair, including both ordering scenarios

## 8. CLI

- [x] 8.1 Add `lpg lock <model> [--check]`, refusing on validation errors and derived ids
- [x] 8.2 Add `lpg diff <model> [--fail-on <class>] [--json]` with exit codes per the spec
- [x] 8.3 Add `lpg migrate <model> [--target …] [--out dir] [--allow-destructive] [--edition …] [--graph-key …]`: default to all three database targets, write `<stem>.<rev:4>.<target>.<ext>` scripts first and the lockfile last, and warn `partial-migration` on a target subset
- [x] 8.4 Update CLI usage text and add CLI tests for lock, diff gating, the missing lockfile, the destructive refusal, and file naming

## 9. Documentation

- [x] 9.1 Update `lat.md/emitters.md#Migrations` with the lockfile format, diff and classification, the destructive gate, and the per-target planners, adding `@lat:` refs in the new tests
- [x] 9.2 Record the measured Ladybug ALTER support in `lat.md/emitters.md#Ladybug Target` and the FalkorDB DROP syntax in `#FalkorDB Target`
- [x] 9.3 Update `lat.md/metamodel.md#Stable Element IDs` (written vs derived gate) and `lat.md/architecture.md#Roadmap#Still deferred` (migrations no longer deferred)
- [x] 9.4 Update `docs/cli.html` and add a migrations walkthrough (adopt by running `lpg ids`, baselining with `lpg lock`, then `lpg migrate`), plus a CHANGELOG entry
- [x] 9.5 Update the v1 IN/OUT scope in `openspec/config.yaml` context so migrations move from OUT to IN

## 10. Verification

- [x] 10.1 Run `npm run build`, `npm test` and `npm run lint`, and confirm every existing golden file is unchanged
- [x] 10.2 Run `lat check` and confirm all wiki links and code refs pass
