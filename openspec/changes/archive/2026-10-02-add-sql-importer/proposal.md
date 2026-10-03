# Add a SQL DDL importer

## Why

The teams this tool wants are already modelling graphs — as foreign keys and join tables in a relational schema. Today they would retype that schema by hand, which is the wall the importers exist to remove. Reading a SQL DDL dump (the file `pg_dump --schema-only` produces, or hand-written `CREATE TABLE`s) turns "you already model graphs" from an argument into a command.

## What Changes

- A new `sql` importer: `lpg import schema.sql` reads `CREATE TABLE`, `ALTER TABLE … ADD CONSTRAINT` (primary key, foreign key, unique), `CREATE TYPE … AS ENUM` and `CREATE UNIQUE INDEX` into the IR.
- A foreign key becomes an edge type from the declaring table's type to the referenced one, many-to-one, with the lower bound 1 when the column is `NOT NULL` and one-to-one when it is `UNIQUE`. The FK column itself is dropped from the type, because the edge now carries that fact — reported per key.
- A join table — one whose primary key is exactly its two foreign keys — becomes an edge type carrying the remaining columns as properties. The reading is reported as an inference.
- SQL types map onto the scalar set, `varchar(n)` keeping its length as `maxLength`, `numeric(p,s)` its precision, enum-typed columns their enum. A type outside the map is read as a string and reported, as the RDF importer does.
- Table names are read into PascalCase type names and the mapping reported; column names are kept verbatim.
- Every statement the reader does not understand is counted and reported, never silently skipped.

## Non-goals

- No live database connection, no `information_schema` reader — text DDL only in this change.
- No hierarchy inference from `parent_id` self-references or table prefixes: a self-referencing FK is an ordinary edge.
- No CHECK constraint translation, no views, no triggers.
- Not combinable with other sources: a SQL schema is imported on its own, like a live instance.

## Locked decisions

None amended. Decision 8 pointed inbound (the importers' standing rule) governs every loss and every inference. Decision 12 is untouched: imported elements get fresh ids.

## Targets affected

None; this is a source. Importers gain one registry entry.

## Capabilities

### Modified Capabilities
- `schema-import`: a SQL DDL source.

## Impact

- `core`: `import/sql.ts` plus a registry entry and format detection. No `vscode` import, no SQL parser dependency: the subset is read by a hand-written statement reader, as the LadybugDB DDL already is.
- `cli`: the caveat block for the new source.
- Tests: fixture DDL files including a pg_dump-shaped one; join-table and FK-edge unit tests; serialize-and-revalidate round trip.
- `lat.md/importers.md` (new Reading SQL DDL section), CLI usage, CHANGELOG.
