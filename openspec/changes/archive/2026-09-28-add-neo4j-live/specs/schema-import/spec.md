## ADDED Requirements

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
