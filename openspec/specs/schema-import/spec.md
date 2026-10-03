## Purpose

Reads foreign schemas back into a model, so a team can start from the schema a database or artifact already holds instead of retyping it. Every loss is reported rather than silently dropped.

## Requirements

### Requirement: A LadybugDB database is an import source

The command line SHALL accept an existing LadybugDB database as an import source. It SHALL produce a model from the database's catalog, through the same write-then-validate path as every other import. The database SHALL be opened read-only, and importing SHALL NOT change it.

#### Scenario: Importing a database to a model file

- **WHEN** `lpg import <database> --from ladybug-db --out model.lpg.yaml` is run against a database with node tables and rel tables
- **THEN** a model file is written with one node type per node table and one edge type per rel table
- **AND** the written model file is validated and its diagnostics are reported
- **AND** the command exits non-zero only if an error is reported

#### Scenario: Importing to standard output

- **WHEN** the same command is run without `--out`
- **THEN** the model text is written to standard output and the diagnostics to standard error

#### Scenario: The database is not modified

- **WHEN** a database is imported
- **THEN** its catalog and data are identical before and after the import

#### Scenario: Database recognised without naming the source

- **WHEN** the import path is a directory, or a file ending in `.lbdb`, `.lbug` or `.kuzu`, and no `--from` is given
- **THEN** it is read as a LadybugDB database

### Requirement: Catalog content maps onto the model

The ladybug import source SHALL carry the following from the catalog into the model:
- each node table's columns as properties, with their exact types, including composite, list and decimal types
- each node table's primary key as its key, with the key property marked required
- each rel table's columns as edge properties
- each rel table's endpoint pairs as the edge type's endpoints

#### Scenario: Exact widths survive

- **WHEN** a node table has columns of type `INT128`, `FLOAT`, `DECIMAL(10, 2)`, `STRUCT(lat DOUBLE, lon DOUBLE)` and `STRING[]`
- **THEN** the model declares them as `int128`, a 32-bit float, a decimal with precision 10 and scale 2, the struct with both fields, and a list of strings

#### Scenario: Primary key becomes the key

- **WHEN** a node table declares `id` as its primary key
- **THEN** the node type's key is `id` and `id` is required
- **AND** no other property is marked required

#### Scenario: Database and DDL agree

- **WHEN** the ladybug target's DDL for a model is executed into a fresh database, and both the DDL and the database are imported
- **THEN** the two imports produce the same model, except for edge cardinality, which only the DDL records

### Requirement: Losses from a LadybugDB database are reported

Whatever the catalog cannot carry SHALL be reported as a diagnostic instead of being guessed or dropped silently. That covers:
- the abstract hierarchy
- mixins
- enums
- value constraints
- required-ness of non-key properties
- uniqueness other than the key
- rel multiplicity
- table comments, because the metamodel has no description field

#### Scenario: Multiplicity is not recoverable

- **WHEN** a rel table was created with `MANY_ONE`
- **THEN** the edge type's cardinality is left unconstrained
- **AND** a diagnostic states that LadybugDB's catalog does not record rel multiplicity

#### Scenario: Table comment is not carried

- **WHEN** a node table has a comment
- **THEN** a diagnostic names the table and says its comment was not imported

#### Scenario: Edge expanded over several endpoint pairs

- **WHEN** a rel table declares more than one endpoint pair and no other import source supplies a hierarchy
- **THEN** the first pair is kept
- **AND** a warning names the edge type and the kept pair, and says how many pairs were dropped

#### Scenario: Unknown column type

- **WHEN** a column's type is not one the metamodel knows
- **THEN** that property is skipped and a warning names the table, the column and the type

### Requirement: A database combines with RDF sources

A LadybugDB database SHALL be importable in one command together with SHACL and OWL files. It SHALL contribute exactly what LadybugDB DDL contributes in the same position.

#### Scenario: Hierarchy from OWL, widths from the database

- **WHEN** a database and the owl and shacl artifacts of the same model are imported together
- **THEN** the hierarchy comes from the RDF sources
- **AND** column types from the database override the ambiguous XSD datatypes, on the type that declares each property
- **AND** endpoint pairs expanded from an abstract endpoint collapse back to that endpoint

### Requirement: Database import fails clearly

A database import that cannot proceed SHALL exit non-zero with a message that names the cause, and SHALL write no model file.

#### Scenario: Ladybug runtime is not installed

- **WHEN** a database import is requested and the LadybugDB runtime is not available to the command line
- **THEN** the message says the runtime is missing and how to install it

#### Scenario: Path is not a database

- **WHEN** the path does not exist, or cannot be opened as a LadybugDB database
- **THEN** the message names the path and the reason the engine gave

#### Scenario: Other commands do not need the runtime

- **WHEN** `check`, `emit`, `ids` or a DDL or RDF import is run without the LadybugDB runtime installed
- **THEN** it behaves exactly as before

### Requirement: A live Memgraph instance is an import source

The command line SHALL accept a Memgraph instance, named by a `bolt://` or `bolt+s://` URI, as an import source. It SHALL read the instance's schema without writing to it, and produce a model through the same write-then-validate path as every other import. The model SHALL carry:
- a node type for each label the schema names, with a key taken from a uniqueness constraint whose every property also has an existence constraint, preferring the one whose properties carry exactly one index
- required and unique properties from existence and uniqueness constraints
- property types from value-type constraints
- enums from the instance's enums

When the instance exposes its schema information, the import SHALL also read each label's properties and their observed types, each edge type with its observed endpoint labels and properties, and a hierarchy from labels that always occur together.

#### Scenario: Importing constraints and enums

- **WHEN** `lpg import bolt://localhost:7687 --from memgraph --out model.lpg.yaml` is run against an instance with key, existence, uniqueness and type constraints and an enum
- **THEN** the written model declares the corresponding node types, keys, required and unique properties, property types and enum, and it is validated

#### Scenario: Schema information enabled

- **WHEN** the instance was started with schema information enabled and holds `Person` nodes that also carry the `Party` label, and `OWNS` relationships from them to `Car` nodes
- **THEN** the model declares `Person` extending `Party`, and an edge type `OWNS` from `Person` to `Car`

#### Scenario: Round trip through a running instance

- **WHEN** the memgraph script generated from a model is applied to a fresh instance, and that instance is imported
- **THEN** every node type, key, required property, unique property and enum of the model's concrete types is present in the imported model

### Requirement: Losses from a Memgraph instance are reported

The memgraph import source SHALL report as a diagnostic whatever the instance cannot carry, rather than guessing:
- property types that Memgraph records without width or precision
- a property observed with more than one type
- an enum type constraint that names no specific enum
- a label with no uniqueness constraint to serve as its key
- schema information being disabled on the server

#### Scenario: Schema information disabled

- **WHEN** the instance was started without schema information enabled
- **THEN** the import reads constraints, indexes and enums only
- **AND** a diagnostic states that edge types and unconstrained properties were not read and how to enable schema information

#### Scenario: Label without a key

- **WHEN** a label has no uniqueness constraint
- **THEN** a diagnostic names the node type and states that a key must be declared before the model validates

#### Scenario: Instance unreachable

- **WHEN** the URI cannot be reached or authentication fails
- **THEN** the command exits non-zero, names the URI and the reason, and writes no model file

### Requirement: Identifying the engine behind a Bolt URI

`lpg import <bolt-uri>` SHALL ask the instance which engine it is before reading its schema, and SHALL NOT infer it from the URI. The engine SHALL be identified as memgraph when `CALL dbms.components()` returns a row named `Memgraph`, and as neo4j when it returns a row named `Neo4j Kernel` and no `Memgraph` row. `--from memgraph` or `--from neo4j` SHALL override the probe.

#### Scenario: A Memgraph instance is not read as a Neo4j

- **WHEN** a running Memgraph is imported from a `bolt://` URI with no `--from`
- **THEN** it is read as a memgraph instance, because its components name Memgraph even though they also name a Neo4j kernel

#### Scenario: A Neo4j instance is read as a Neo4j

- **WHEN** a running Neo4j is imported from a `bolt://` URI with no `--from`
- **THEN** it is read as a neo4j instance

#### Scenario: An engine the tool has not met

- **WHEN** a Bolt instance answers `CALL dbms.components()` with neither a Memgraph nor a Neo4j Kernel row
- **THEN** an `import-unknown-engine` error names what the instance called itself, nothing is read, and the command exits non-zero

### Requirement: Reading a running Neo4j instance

`lpg import <bolt-uri>` against a Neo4j SHALL read its schema in read sessions only, leaving the instance unchanged. A uniqueness constraint SHALL make a property unique; a node key constraint SHALL make its properties the node type's key; an existence constraint SHALL make a property required. Where no key constraint exists, the key SHALL be recovered from a uniqueness constraint, preferring one whose properties carry an index, and the choice SHALL be reported. Labels, properties, observed property types, the label hierarchy and edge endpoints SHALL be read from the schema procedures. Every reading that is an inference rather than a declaration SHALL be reported.

#### Scenario: A generated schema round-trips

- **WHEN** the neo4j script generated for a model is applied to an empty instance, one node per concrete type and one relationship per edge type are written, and the instance is imported
- **THEN** the model holds every node type with its key, its unique properties and its edge types, and the resulting file passes `lpg check`

#### Scenario: Recovering a key without a key constraint

- **WHEN** a Community instance carries a uniqueness constraint on `Person.id` and an index on those properties, and no node key constraint
- **THEN** `id` is read as the key of `Person` and the recovery is reported

#### Scenario: A property observed but not declared

- **WHEN** a label carries a property that no constraint mentions
- **THEN** the property is read with its observed type, and the import reports that it came from stored data rather than from a constraint

#### Scenario: A Community instance is not credited with constraints it cannot hold

- **WHEN** a Community instance is imported, where no existence constraint can exist
- **THEN** no property is read as required except the parts of a key, whatever the stored data happens to carry, and the import says that the edition is why

#### Scenario: Token lookup and constraint-owned indexes

- **WHEN** an instance is imported whose indexes include the token lookup indexes present on every database and the index a uniqueness constraint owns
- **THEN** neither appears in the model as an index of its own

#### Scenario: What Neo4j cannot hold

- **WHEN** any Neo4j instance is imported
- **THEN** the import reports that cardinality, value bounds, named constraints, mixins, enums and integer widths are not recoverable from it

### Requirement: Reading a running FalkorDB instance

`lpg import redis://host:port` SHALL read a FalkorDB graph's schema from `CALL db.constraints()` and `CALL db.indexes()`, and its structure from bounded sampling queries. A `MANDATORY` constraint SHALL make a property required; a `UNIQUE` constraint SHALL make it unique; a `UNIQUE` constraint whose every property is also `MANDATORY` and indexed SHALL be read as the node type's key, and where several qualify the smallest SHALL be taken and the choice reported. A hierarchy inferred from sampled label sets, and edge endpoints from sampled relationships, SHALL each be reported as an inference.

#### Scenario: A generated schema round-trips

- **WHEN** the falkordb script generated for a model is applied to an empty graph, one node per concrete type and one relationship per edge type are written, and the graph is imported
- **THEN** the model holds every node type with its key, its required and unique properties and its edge types, and the resulting file passes `lpg check`

#### Scenario: What FalkorDB cannot hold

- **WHEN** any FalkorDB graph is imported
- **THEN** the import reports that enums, cardinality, value bounds, named constraints and mixins are not recoverable from it

#### Scenario: A sample that was cut short

- **WHEN** a graph holds more distinct label sets or relationship endpoint pairs than the sampling bound returns
- **THEN** the import reports that the structure was read from a bounded sample, so a type or an endpoint pair may be missing

### Requirement: A constraint that is not enforcing is not part of the schema

An import SHALL read a constraint as part of the schema only when its status is operational. A constraint reported `FAILED` or `PENDING` SHALL NOT contribute a key, a required property or a unique property to the model, and SHALL be reported with its status.

#### Scenario: A constraint the stored data defeated

- **WHEN** a graph holds a `UNIQUE` constraint whose status is `FAILED` because two stored nodes share the value
- **THEN** the property is not read as unique, the node type does not take it as a key, and an `import-constraint-failed` diagnostic names the constraint and its status

#### Scenario: A constraint that has not settled

- **WHEN** a graph holds a constraint whose status is still `PENDING`
- **THEN** it does not contribute to the model and is reported as not yet enforcing

### Requirement: Importing names the graph and never creates one

An import SHALL read a graph only through read-only queries, which the server refuses to write through, and SHALL confirm that the graph key exists before querying it — because a writable query against an unknown key creates that key. When `--graph-key` is not given and the server holds exactly one graph, that graph SHALL be read; when it holds several, they SHALL be listed and nothing read.

#### Scenario: A mistyped graph key

- **WHEN** a graph key that the server does not hold is imported
- **THEN** an `import-no-graph` error names the keys the server does hold, no graph is created, nothing is written, and the command exits non-zero

#### Scenario: An import cannot write even by mistake

- **WHEN** any graph is imported
- **THEN** every command the import sends is a read-only query, which the server refuses to perform a write through

#### Scenario: One graph needs no naming

- **WHEN** an instance holding exactly one graph is imported with no `--graph-key`
- **THEN** that graph is read and its key is reported

#### Scenario: Several graphs

- **WHEN** an instance holding more than one graph is imported with no `--graph-key`
- **THEN** the graph keys are listed, nothing is read, and the command exits non-zero

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
