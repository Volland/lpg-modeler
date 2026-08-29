## Purpose

Defines the artifacts generated from a model - Ladybug DDL, Neo4j constraints, SHACL
shapes, and an OWL ontology - and how the system reports model features that a chosen
target cannot express.

## ADDED Requirements

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
