# Design

The metamodel and the IR do not change. Work lands in `core` (`import/sql.ts`); no `vscode` import and no parser dependency. Depends on `lat.md/importers#Importers`, `lat.md/importers#Serializing a Model`, `lat.md/metamodel#Cardinality`.

## Decisions

### 1. A hand-written reader over a statement splitter

Statements are split on `;` outside quotes (`'…'`, `"…"`, `$$…$$`) and parentheses, then each is matched by its leading keywords. Recognised: `CREATE TABLE`, `ALTER TABLE … ADD CONSTRAINT` (PK, FK, UNIQUE), `CREATE TYPE … AS ENUM`, `CREATE UNIQUE INDEX` (single column, read as uniqueness). Everything else — `CREATE INDEX`, `COMMENT`, `SET`, `GRANT`, inserts — is counted per leading keyword and reported once (`import-skipped-statements`). Reading is total: a malformed statement yields a diagnostic naming it, never a throw.

### 2. Foreign keys become edges; the column goes away

A single-column FK on table `car` named `owner_id → person(id)` becomes edge `OWNER: Car → Person`, cardinality from `*`, to `0..1` (`1` when `NOT NULL`); a `UNIQUE` FK column also bounds the from end at one. The edge name is the constraint name when one was written, else the column name minus a trailing `_id`/`_fk`, upper-snake; collisions take a numeric suffix, and every naming is reported. The FK column is removed from the type — the edge is where that fact now lives — **except** when the column is part of the table's primary key, where removing it would break the key: then both the column and the edge are kept and the duplication is reported. A multi-column FK keeps its columns and gains the edge, reported, for the same reason.

### 3. The join-table rule is exact, not fuzzy

A table is an edge type only when its primary key is exactly the union of its (two) single-column foreign keys. Anything looser — extra PK columns, a third FK, no PK — stays a node type with FK edges, because a wrong edge-reading deletes a type a query may name. The reading is reported as an inference, in the voice of the label-hierarchy inferences.

### 4. Type map

`smallint→int16`, `integer→int32`, `bigint→int`, `serial` family likewise plus an `import-serial` note (the sequence is not carried), `varchar(n)→string` with `maxLength`, `text/char→string`, `numeric(p,s)→decimal(p,s)`, `real→float32`, `double precision→float`, `boolean`, `date`, `timestamp→datetime`, `timestamptz→zoneddatetime`, `interval→duration`, `uuid`, `bytea→blob`, `json/jsonb→json`, `t[]→list`. A column whose type names a `CREATE TYPE … AS ENUM` becomes a string property with that enum. Anything else is a string plus `import-foreign-datatype`.

### 5. Naming

`snake_case` table names become PascalCase type names, reported once with the list; column names are untouched, because they are how the reader maps the model back to their data. No singularisation: `users` stays `Users`, because guessing `User` wrong is worse than a plural type name.

### 6. Alone, like a live instance

A SQL input beside RDF or LadybugDB sources is `import-mixed-sources`: nothing in a SQL dump aligns with either, and a half-merged model would be a guess.

## Verification

Unit tests over fixture DDL: the join-table rule's positive and negative cases, FK cardinality including `NOT NULL` and `UNIQUE`, PK-member FK retention, enum columns, the type map, skipped-statement reporting. The imported model is serialized and re-resolved, and must validate cleanly — the same round-trip discipline the other importers are held to.
