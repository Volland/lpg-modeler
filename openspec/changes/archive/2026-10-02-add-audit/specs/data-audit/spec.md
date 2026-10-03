## Purpose

Checks stored data against the constraints a target could not enforce, so a downgrade reported at generation time becomes a count of real violations rather than a hope.

## ADDED Requirements

### Requirement: Audit scripts check exactly what the target leaves unenforced

`lpg audit <model> --target <t>` SHALL generate, for each of the **ladybug**, **neo4j**, **memgraph** and **falkordb** targets, a script of read-only queries — one per constraint in the model that the target cannot enforce, selected from the target's capability set (and `--edition` for neo4j) — each preceded by a comment naming the constraint and each returning a single `violations` count. A constraint the target enforces SHALL NOT be audited. A constraint the engine cannot even query for SHALL be reported as `audit-unsupported` and named in the script as unchecked.

#### Scenario: Required non-key property on ladybug

- **WHEN** a model declares a required non-key property and the audit script is generated for ladybug
- **THEN** the script contains a query counting rows where that property is null

#### Scenario: Enforced constraints are not audited

- **WHEN** the audit script is generated for memgraph, which enforces node existence constraints
- **THEN** no check for a required node property appears, while checks for the unenforced bounds and cardinality do

#### Scenario: Edition changes the check set

- **WHEN** the audit script is generated for neo4j with `--edition enterprise`
- **THEN** required-property checks are absent, because existence constraints are enforced there

#### Scenario: Named constraints are audited

- **WHEN** a node type asserts `start lessThan end`
- **THEN** the audit script counts entities where both are present and the comparison fails

### Requirement: Audit runs are read-only and gate on violations

With a connection (`--uri` for the server engines, `--database` for LadybugDB), `lpg audit` SHALL run each check through a read-only channel — a read session, `GRAPH.RO_QUERY`, or a read-only embedded open — print each check's count, and exit non-zero when any count is positive and zero when all are zero. Audit SHALL NOT be able to write.

#### Scenario: Violations found

- **WHEN** audit runs against a LadybugDB database holding a null required value
- **THEN** the check prints a positive count and the command exits non-zero

#### Scenario: Clean database

- **WHEN** audit runs against a database with no violations
- **THEN** every check prints zero and the command exits zero
