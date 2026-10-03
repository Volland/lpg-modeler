## ADDED Requirements

### Requirement: SQL DDL is read into a model

The system SHALL read a SQL DDL text (`.sql`, or named with `--from sql`) into the IR: a `CREATE TABLE` becomes a node type with its columns as properties, a primary key becomes the key, `NOT NULL` becomes required, `UNIQUE` (column, table constraint, or single-column unique index) becomes unique, and `CREATE TYPE … AS ENUM` becomes an enum that columns of that type reference. Statements outside the recognised subset SHALL be counted and reported, never silently skipped.

#### Scenario: A table with a primary key

- **WHEN** `CREATE TABLE person (id uuid PRIMARY KEY, email varchar(255) NOT NULL UNIQUE)` is imported
- **THEN** node type `Person` has key `id`, and `email` is a required, unique string with `maxLength` 255

#### Scenario: An enum column

- **WHEN** the DDL declares `CREATE TYPE status AS ENUM ('active', 'retired')` and a column of type `status`
- **THEN** the model declares the enum and the property references it

#### Scenario: Unreadable statements are reported

- **WHEN** the DDL contains `CREATE INDEX` and `GRANT` statements
- **THEN** the import reports how many statements of each kind were not read

### Requirement: Foreign keys become edges

A single-column foreign key SHALL become an edge type from the declaring type to the referenced type, many-to-one, with the to end's lower bound 1 when the column is `NOT NULL` and the from end bounded at one when the column is `UNIQUE`. The foreign key column SHALL be dropped from the type unless it is part of the primary key, and every naming and every drop SHALL be reported.

#### Scenario: A plain foreign key

- **WHEN** table `car` declares `owner_id uuid NOT NULL REFERENCES person(id)`
- **THEN** the model declares edge `OWNER: Car → Person` with to-cardinality exactly one, and `Car` has no `owner_id` property

#### Scenario: A foreign key inside the primary key

- **WHEN** a table's primary key includes a foreign key column
- **THEN** the column is kept, the edge is declared as well, and the duplication is reported

### Requirement: Join tables become edge types

A table whose primary key is exactly its two single-column foreign keys SHALL be read as an edge type between the two referenced types, carrying its remaining columns as edge properties, and the reading SHALL be reported as an inference. A table that misses the rule in any way SHALL remain a node type.

#### Scenario: A classic join table

- **WHEN** `person_car (person_id REFERENCES person, car_id REFERENCES car, since date, PRIMARY KEY (person_id, car_id))` is imported
- **THEN** the model declares edge `PERSON_CAR: Person → Car` with property `since` and no node type for the table

#### Scenario: A join table with its own identity

- **WHEN** a table has two foreign keys but its primary key is its own `id` column
- **THEN** it stays a node type with two edges

### Requirement: SQL is imported on its own

An import mixing a SQL source with RDF or LadybugDB sources SHALL be refused with `import-mixed-sources`.

#### Scenario: SQL beside a shapes graph

- **WHEN** `lpg import schema.sql shapes.ttl` is run
- **THEN** the command reports `import-mixed-sources` and exits non-zero
