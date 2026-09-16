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
