## ADDED Requirements

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
