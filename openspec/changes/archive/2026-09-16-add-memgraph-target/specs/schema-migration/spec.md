## MODIFIED Requirements

### Requirement: Migrations are generated per database target and advance the lockfile

`lpg migrate` SHALL generate one migration script per requested target from the change set, name each `<stem>.<revision>.<target>.<extension>` where revision is the lockfile revision plus one written with four digits, and then rewrite the lockfile with the current model and that revision. When no target is given it SHALL generate for the ladybug, neo4j, falkordb and memgraph targets. Requesting any other target SHALL be a `not-migratable` error. When the change set is empty the command SHALL write nothing and report that the model is unchanged.

#### Scenario: Migrating after adding a property

- **WHEN** a model at lockfile revision 3 gains an optional property and `lpg migrate --out migrations` is run
- **THEN** `migrations/<stem>.0004.ladybug.cypher`, `<stem>.0004.neo4j.cypher`, `<stem>.0004.falkordb.sh` and `<stem>.0004.memgraph.cypher` are written
- **AND** the lockfile is rewritten at revision 4 and matches the current model

#### Scenario: Requesting a target that is regenerated rather than migrated

- **WHEN** `lpg migrate --target shacl` is run
- **THEN** a `not-migratable` error is reported and nothing is written

#### Scenario: A change no database target stores

- **WHEN** the only change is a new value pattern on a property and `lpg migrate` is run
- **THEN** each script states that the change has no schema effect on that target
- **AND** the lockfile advances

## ADDED Requirements

### Requirement: Memgraph migration

For the memgraph target, the script SHALL do the following, in this order:
1. drop every constraint and index the previous revision generated that the current model does not;
2. rewrite existing labels, relationship types and property names for a renamed node type, edge type or property;
3. add every enum value the current model adds;
4. create every constraint, index and enum the current model generates that the previous revision did not.

Applying it to a Memgraph instance built from the previous revision's script SHALL leave the same constraints, indexes and enums as a fresh instance built from the current revision's script. The exception is enum values Memgraph cannot remove.

#### Scenario: Renaming a node type

- **WHEN** a node type `Person` with a key is renamed to `Individual`
- **THEN** the memgraph script drops the key constraints on `Person`, relabels existing `Person` nodes as `Individual` in batched transactions, and creates the key constraints on `Individual`, in that order

#### Scenario: Retyping a property

- **WHEN** a property's type changes from int to string
- **THEN** the script drops the integer type constraint before creating the string one
- **AND** a comment states that the new constraint is rejected while existing values of the old type remain

#### Scenario: Removing an enum value

- **WHEN** a value is removed from an enum
- **THEN** a downgrade is reported that Memgraph cannot remove an enum value, and the script carries a comment at that site instead of a statement

#### Scenario: Migrated instance matches a fresh instance

- **WHEN** each migration fixture is applied to a Memgraph instance built from the previous revision's script
- **THEN** its constraints, indexes and enums equal those of an instance built from the current revision's script, apart from reported enum-value removals
