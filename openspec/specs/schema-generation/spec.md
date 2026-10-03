## Purpose

Defines the artifacts generated from a model - Ladybug DDL, Neo4j constraints, SHACL
shapes, and an OWL ontology - and how the system reports model features that a chosen
target cannot express.

## Requirements

### Requirement: Generation is available from the canvas

A user SHALL be able to generate any supported target from the canvas without leaving
it, and SHALL be able to generate the same targets from the command line.

#### Scenario: Generating from the canvas

- **WHEN** a user chooses a target from the canvas
- **THEN** the generated artifact is written and opened for review

#### Scenario: Generating in continuous integration

- **WHEN** the command line is invoked for a target against a model
- **THEN** the same artifact content is produced as from the canvas
- **AND** a model with validation errors exits non-zero without writing an artifact

### Requirement: Downgrades are always reported

When a model uses a feature the chosen target cannot express, the system SHALL report a
downgrade as an editor diagnostic AND as a comment at the corresponding location in the
generated artifact. A constraint SHALL NOT be dropped silently.

#### Scenario: Required property against Neo4j Community

- **WHEN** a model marks a property required and the Neo4j target is configured as
  Community
- **THEN** a downgrade warning is reported for that property
- **AND** the generated artifact contains a comment recording the unenforced constraint

#### Scenario: Required property in the ontology

- **WHEN** a model marks a property required and the OWL target is generated
- **THEN** a downgrade is reported stating the constraint is carried by SHACL instead

### Requirement: Ladybug target

The Ladybug target SHALL generate a node table per concrete node type with inherited
properties included, a relationship table per edge type with declared endpoint pairs,
and a primary key per node table. Generated DDL SHALL execute successfully against
LadybugDB.

#### Scenario: Abstract hierarchy is flattened

- **WHEN** an abstract node type has two concrete subtypes
- **THEN** a node table is generated for each subtype carrying the inherited properties
- **AND** no table is generated for the abstract type

#### Scenario: Edge on an abstract endpoint

- **WHEN** an edge type declares an abstract endpoint with two concrete subtypes on each
  side
- **THEN** the generated relationship table declares an endpoint pair for each
  combination

#### Scenario: Generated DDL enforces key constraints

- **WHEN** generated DDL is executed and a row omitting the key is inserted
- **THEN** the database rejects the insert
- **AND** inserting a second row with a duplicate key value is also rejected

#### Scenario: Required property that is not the key

- **WHEN** a node type marks a non-key property as required
- **THEN** a downgrade is reported stating LadybugDB cannot enforce it
- **AND** the generated DDL records the unenforced constraint as a comment at that column

#### Scenario: Composite key

- **WHEN** a node type declares a key naming two properties
- **THEN** the generated table has a single primary key column synthesized from both
- **AND** the synthesized column is populated from the component properties
- **AND** a downgrade is reported explaining that composite keys are not expressible

### Requirement: Neo4j target

The Neo4j target SHALL generate constraints and indexes. An abstract hierarchy SHALL be
expressed as labels rather than as separate structures. The target SHALL be aware of
which edition is configured.

#### Scenario: Hierarchy becomes labels

- **WHEN** a node type extends an abstract parent
- **THEN** generated constraints address the subtype and the model records that the
  parent's label also applies

#### Scenario: Key becomes a node key constraint

- **WHEN** a node type declares a key and the Enterprise edition is configured
- **THEN** a node key constraint is generated for that property

### Requirement: SHACL target carries the constraints

The SHACL target SHALL generate a shape per node type expressing required, unique,
cardinality, and datatype constraints, such that data violating the model fails
validation.

#### Scenario: Required property produces a minimum count

- **WHEN** a node type declares a required property
- **THEN** the generated shape requires at least one value for that property

#### Scenario: Invalid data fails the shape

- **WHEN** data omitting a required property is validated against the generated shape
- **THEN** validation reports a violation

### Requirement: OWL target stays within the safe subset

The OWL target SHALL emit classes, subclass relations, keys, disjointness, and inverse
properties. It SHALL NOT emit property domains, property ranges, or cardinality
restrictions derived from model constraints, because those assert inference rather than
constraint.

#### Scenario: Hierarchy becomes subclass assertions

- **WHEN** a node type extends an abstract parent
- **THEN** the ontology asserts the subtype is a subclass of the parent

#### Scenario: No domain or range is asserted

- **WHEN** an edge type declares its endpoints
- **THEN** the generated ontology contains no property domain or range assertion for it

#### Scenario: Key becomes an ontology key

- **WHEN** a node type declares a key
- **THEN** the ontology asserts that key for the corresponding class

### Requirement: Edge properties map by gradual reification

An edge type with no properties SHALL become a plain relation in RDF. An edge type
carrying properties SHALL become a class with subject and object relations plus a
shortcut relation, and its SHACL shape SHALL target that class.

#### Scenario: Bare edge stays a plain relation

- **WHEN** an edge type declares no properties
- **THEN** the ontology declares it as a plain relation with no intermediate class

#### Scenario: Edge with properties becomes a class

- **WHEN** an edge type declares a property
- **THEN** the ontology declares a class for it with subject and object relations
- **AND** a shortcut relation directly connecting the endpoints is also declared
- **AND** the generated shape for that class constrains the edge property

### Requirement: Renaming preserves ontology identity

Because a type's global identity derives from its name, renaming a type SHALL record an
equivalence to its previous identity so existing ontology consumers are not broken.

#### Scenario: Renaming a type used in a published ontology

- **WHEN** a user renames a node type on the canvas and regenerates the ontology
- **THEN** the ontology asserts the new class is equivalent to the previous identity

### Requirement: Memgraph target

The Memgraph target SHALL generate a Cypher script of schema statements for Memgraph Community. It SHALL express an abstract hierarchy as labels. For every concrete node type it SHALL generate:
- a uniqueness constraint over the key, an existence constraint on each key property, and an index over the key's properties
- a uniqueness constraint for each other unique property
- an existence constraint for each required property
- a value-type constraint for each property whose type Memgraph can check
- an index for each required property that is neither unique nor part of the key

Each enum in the model SHALL be declared as a Memgraph enum, and a property limited to an enum SHALL carry an enum type constraint. Generated scripts SHALL execute against Memgraph, and the constraints they create SHALL reject data that violates them.

#### Scenario: Key becomes uniqueness plus existence

- **WHEN** a node type declares the key `(vin)`
- **THEN** the memgraph script asserts `vin` unique on that label, asserts that `vin` exists, and indexes `vin`

#### Scenario: Required property is enforced without an edition

- **WHEN** a node type declares a required property that is not the key
- **THEN** the memgraph script asserts that the property exists, and no downgrade is reported

#### Scenario: Value types are asserted

- **WHEN** a node type declares properties of type string, int, float, boolean, date, datetime, zoneddatetime and duration
- **THEN** each property carries a value-type constraint of the corresponding Memgraph type

#### Scenario: Integer width is a downgrade

- **WHEN** a property has type `int8` or `int128`
- **THEN** the property carries an integer type constraint
- **AND** a downgrade is reported that Memgraph does not enforce the width, with a comment at that site

#### Scenario: Enum becomes a Memgraph enum

- **WHEN** a property is limited to enum `Status` with values `active` and `retired`
- **THEN** the script declares enum `Status` with those values and constrains the property to an enum type
- **AND** a downgrade is reported that Memgraph cannot require that specific enum

#### Scenario: What Memgraph cannot express

- **WHEN** a model declares a required edge property, an edge cardinality, a value bound or pattern, or a composite-typed property
- **THEN** each is reported as a downgrade for the memgraph target, with a comment in the script, and none is silently dropped

#### Scenario: Generated constraints are enforced

- **WHEN** the generated script is run against a fresh Memgraph instance and a node is written without its key, with a duplicate key, or with a value of the wrong type
- **THEN** Memgraph rejects each write

#### Scenario: Generating Memgraph from the canvas

- **WHEN** a user opens the target choice on the canvas
- **THEN** memgraph is offered alongside the other targets, and choosing it writes the same script the command line produces

### Requirement: TypeScript target generates compiling type declarations

The system SHALL provide a `typescript` target that generates, for the **typescript** target, a single self-contained `.ts` artifact: one `interface` per node type, mixin and edge type, one string-literal union type per enum, and named type aliases for the scalars drivers disagree on (`decimal`, `date`, `datetime`, `zoneddatetime`, `duration`). The artifact SHALL import nothing and SHALL type-check under `strict` TypeScript.

#### Scenario: Hierarchy and mixins become extends

- **WHEN** a model declares `Person extends Party` with mixin `Timestamped`
- **THEN** the artifact declares `interface Person extends Party, Timestamped` carrying only the properties `Person` itself declares

#### Scenario: Required and optional properties

- **WHEN** a node type declares a required property and an optional one
- **THEN** the required property is a plain member and the optional one is marked `?`

#### Scenario: Enum property compiles to a union

- **WHEN** a property is limited to enum `Status` with values `active` and `retired`
- **THEN** the artifact declares `type Status = 'active' | 'retired'` and the property's type is `Status`

#### Scenario: Composite types are carried natively

- **WHEN** a property's type is `STRUCT(street STRING, zip STRING)`
- **THEN** the member's type is an object type with those fields, and no downgrade is reported for it

#### Scenario: Open type gains an index signature

- **WHEN** a node type is declared open
- **THEN** its interface carries a `[key: string]: unknown` index signature

### Requirement: TypeScript target carries runtime facts in a SCHEMA const

The artifact SHALL export a `SCHEMA` const, `as const`, holding for every node type its labels (own name plus ancestors), its key and whether it is abstract, and for every edge type its endpoints and cardinality.

#### Scenario: Labels and key in the manifest

- **WHEN** `Person extends Party` declares key `email`
- **THEN** `SCHEMA.nodes.Person` holds `labels: ['Person', 'Party']` and `key: ['email']`

#### Scenario: Edge endpoints in the manifest

- **WHEN** an edge type `DRIVES` runs from `Person` to `Car` with many-to-many cardinality
- **THEN** `SCHEMA.edges.DRIVES` holds `from: 'Person'`, `to: 'Car'` and the cardinality's name

### Requirement: TypeScript target reports what a type cannot enforce

For the **typescript** target, uniqueness, value bounds, patterns, length bounds and named constraints SHALL be written as JSDoc at the member or interface they belong to and reported as downgrade diagnostics. They SHALL NOT be silently dropped.

#### Scenario: Unique property

- **WHEN** a non-key property is declared unique
- **THEN** its member carries a JSDoc note naming the uniqueness and a downgrade diagnostic is reported

#### Scenario: Value bounds

- **WHEN** a property declares `min` and `max`
- **THEN** the bounds appear in the member's JSDoc and a `downgrade-value-constraint` diagnostic is reported

### Requirement: Context target generates a compact schema card

The system SHALL provide a `context` target that generates, for the **context** target, a deterministic Markdown artifact holding every node type (with hierarchy, mixins, key, abstract and open marks, and every property with its type, requiredness, uniqueness, bounds and enum), every edge type (with endpoints and cardinality), every enum with its values, every mixin, and every named constraint in words. Nothing in the model SHALL be omitted, and no downgrade SHALL be reported.

#### Scenario: A node type is one line

- **WHEN** the card is generated for a model where `Person extends Party` applies mixin `Timestamped`, declares key `email`, and has a unique property
- **THEN** one bullet names `Person`, its parent, its mixin, its key, and the property with a uniqueness mark

#### Scenario: Card is deterministic

- **WHEN** the card is generated twice from the same model
- **THEN** both artifacts are byte-identical

#### Scenario: Everything appears

- **WHEN** the card is generated for a model with enums and named constraints
- **THEN** every enum value and every constraint name in the resolved IR appears in the artifact

#### Scenario: Raw SHACL is carried

- **WHEN** a node type carries a raw SHACL fragment
- **THEN** the fragment appears verbatim under that type and no `downgrade-raw-shacl` diagnostic is reported

### Requirement: Docs target generates a self-contained data dictionary

The system SHALL provide a `docs` target that generates, for the **docs** target, one self-contained HTML artifact: a table of contents, a section per node type (hierarchy, mixins, key, a property table with provenance marks for inherited and mixin-applied properties, named constraints in words, and the type's incoming and outgoing edge types), and sections for edge types, mixins and enums. The page SHALL reference no external subresource.

#### Scenario: Every type is reachable from the table of contents

- **WHEN** the artifact is generated
- **THEN** every node type, edge type, mixin and enum has an anchored section linked from the table of contents

#### Scenario: Inherited properties are marked with their source

- **WHEN** a node type inherits a property and receives another from a mixin
- **THEN** its property table shows both with the declaring type or mixin named

#### Scenario: No external fetches

- **WHEN** the artifact is generated for any model
- **THEN** the page contains no `src` or `href` that resolves to another origin

### Requirement: Docs target displays the enforcement matrix

The artifact SHALL contain a matrix with one row per capability the model actually uses and one column per database and validation target, each cell stating that target's declared capability (enforced, partial, documented, unsupported — in reader's words). The cells SHALL be derived from the same capability sets `emit` reports downgrades from.

#### Scenario: A model that uses enums

- **WHEN** the model constrains a property to an enum
- **THEN** the matrix has an enums row showing, among others, that memgraph enforces it partially and neo4j does not enforce it

#### Scenario: A feature the model does not use

- **WHEN** the model declares no named constraints
- **THEN** the matrix has no named-constraints row

### Requirement: SQL/PGQ target generates DuckDB tables and a property graph

The system SHALL provide a `sqlpgq` target that generates, for the **sqlpgq** target, DuckDB SQL: one table per concrete node type with every property as a typed column, `NOT NULL` for a required property, `UNIQUE` for a unique one, `CHECK` for bounds, lengths and patterns, and a `PRIMARY KEY` over the key; one edge table per concrete endpoint pair with foreign keys to both endpoint tables; one `CREATE TYPE … AS ENUM` per enum; and a `CREATE OR REPLACE PROPERTY GRAPH` mapping them. The artifact SHALL apply to a DuckDB with the `duckpgq` extension, twice in a row.

#### Scenario: A concrete type becomes a vertex table

- **WHEN** the artifact is generated for a model with `Person` keyed by `id`
- **THEN** a `Person` table with `PRIMARY KEY (id)` appears and the property graph names it as a vertex table with label `Person`

#### Scenario: What the model requires is refused on write

- **WHEN** a row without a required value, a duplicate of a unique value, a value outside its bounds, or an edge to a missing node is inserted
- **THEN** DuckDB refuses it

#### Scenario: A composite key is native

- **WHEN** a node type declares a composite key
- **THEN** the table has a composite `PRIMARY KEY` and an edge to it has a composite foreign key, with no synthesized column

### Requirement: An abstract endpoint expands to one edge table and label per pair

An edge type reaching an abstract endpoint SHALL be generated as one edge table per concrete endpoint pair, each with its own unique label, and a `downgrade-edge-expansion` diagnostic SHALL be reported, because a DuckDB property graph requires every label to be unique.

#### Scenario: An abstract source

- **WHEN** an edge type runs from an abstract type with two concrete subtypes
- **THEN** two edge tables and two labels are generated, and the downgrade is reported

### Requirement: SQL/PGQ target reports what a table cannot hold

For the **sqlpgq** target, an open node type, an end bounded other than at-most-one, an end bounded at one on an expanded edge set, and an edge `count` assertion SHALL each be reported as a downgrade and noted in a comment at the site. A name DuckDB refuses bare SHALL be quoted.

#### Scenario: A keyword as a name

- **WHEN** a node type or property is named with a keyword that is not unreserved, such as `order` or `AT`
- **THEN** it is quoted and the artifact still applies
