## ADDED Requirements

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
