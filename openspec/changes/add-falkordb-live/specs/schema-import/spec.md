## ADDED Requirements

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
