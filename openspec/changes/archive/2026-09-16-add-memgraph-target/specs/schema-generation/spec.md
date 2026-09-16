## ADDED Requirements

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
