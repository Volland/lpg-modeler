## ADDED Requirements

### Requirement: Drift compares a deployed schema against the model

`lpg drift <model>` SHALL compare the schema a target actually stores against what the model requires for that target, and report each difference as `missing` (declared by the model, absent from the database), `unexpected` (present in the database, undeclared by the model), or `different` (same object, different shape). The expected side SHALL be built by the same functions `emit` uses for that target. The command SHALL exit non-zero when any difference is found and zero when none is, and `--json` SHALL print the findings machine-readably. Reading SHALL be read-only on every engine.

#### Scenario: A database the script was applied to is clean

- **WHEN** a model's generated LadybugDB DDL is applied to a fresh database and `lpg drift --database` is run with that model
- **THEN** no finding is reported and the command exits zero

#### Scenario: A property added to the model

- **WHEN** the model gains a property the database has never seen
- **THEN** drift reports the column or constraint as `missing` and exits non-zero

#### Scenario: A table changed by hand

- **WHEN** a column is added to a LadybugDB table outside the tool
- **THEN** drift reports that column as `unexpected`

#### Scenario: What the target cannot store is not drift

- **WHEN** the model declares value bounds, which no database target stores
- **THEN** drift reports nothing about them

### Requirement: Drift matches structurally, never by name

On the constraint engines (**neo4j**, **memgraph**, **falkordb**), objects SHALL be matched by kind, entity, label and property set — never by constraint or index name — so a schema deployed with different names but the same shape is not drift. Catalog rows the importer already excludes (LOOKUP indexes, constraint-owned indexes) SHALL be excluded here too, and a FalkorDB constraint that is not `OPERATIONAL` SHALL be reported with its status rather than counted as present.

#### Scenario: Same constraint, different name

- **WHEN** a Neo4j database holds a uniqueness constraint on the same label and properties under a name this tool would not generate
- **THEN** drift reports nothing for it

#### Scenario: A failed FalkorDB constraint

- **WHEN** the FalkorDB catalog reports a constraint with status `FAILED`
- **THEN** drift reports it as not enforcing rather than as present

### Requirement: Drift sources

Drift SHALL read the actual schema from `--database <path>` (LadybugDB, read-only), `--uri bolt://…` (engine identified positively, Memgraph first, `--from` overriding), `--uri redis://…` (FalkorDB, `--graph-key` as import takes it), or `--script <path>` (a generated LadybugDB DDL artifact, no database needed). Multiplicity SHALL be compared only against a script, because a database's catalog does not record it.

#### Scenario: Drift against a committed DDL artifact

- **WHEN** `lpg drift model.lpg.yaml --script schema.cypher` is run against a stale generated script
- **THEN** the differences are reported without any database connection
