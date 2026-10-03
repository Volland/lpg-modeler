## Purpose

Checks the queries an application runs against the model they assume, so a schema change surfaces at lint time rather than in production.

## ADDED Requirements

### Requirement: Queries are checked against the model

`lpg lint-queries <model> <files…>` SHALL parse each query and report: a label no node type declares, a relationship type no edge type declares, a property access no resolved type carries, a traversal violating an edge's declared endpoints or direction, and a literal comparison impossible for the property's scalar. A query the parser cannot read SHALL be reported as unreadable, never guessed at, and a variable whose type cannot be resolved SHALL NOT produce findings.

#### Scenario: Renamed property

- **WHEN** a model renames `mail` to `email` and a lint runs over a query matching `(p:Person) WHERE p.mail = $x`
- **THEN** an unknown-property finding names `Person.mail` and the command exits non-zero

#### Scenario: Edge traversed backwards

- **WHEN** a query matches `(c:Car)-[:OWNS]->(p:Person)` and the model declares `OWNS: Person → Car`
- **THEN** a direction finding is reported

#### Scenario: Unlabelled variable

- **WHEN** a query matches `(n) WHERE n.whatever = 1`
- **THEN** no finding is reported for `n`
