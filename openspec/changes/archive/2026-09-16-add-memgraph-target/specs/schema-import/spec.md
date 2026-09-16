## ADDED Requirements

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
