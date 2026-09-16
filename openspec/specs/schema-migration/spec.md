## Purpose

Lets a model that has already been deployed evolve safely: a committed lockfile records what was deployed, a semantic diff says what changed and how dangerous it is, and migration scripts carry each database target from the old schema to the new one.

## Requirements

### Requirement: Lockfile snapshots the resolved IR

The system SHALL write a lockfile named `<stem>.lpg.lock.json` beside a model. The lockfile SHALL hold the resolved IR of the model — inherited and mixin-applied properties on every node type that receives them, and types from imported models — together with a lockfile format version, the model format version, and a revision number. It SHALL NOT hold source locations, file paths, or anything from the layout sidecar.

#### Scenario: Locking a model for the first time

- **WHEN** `lpg lock` is run on a valid model that has no lockfile
- **THEN** a lockfile is written beside the model with revision 1
- **AND** every node type, edge type, mixin, enum, property and named constraint in the IR appears in it with its element id

#### Scenario: Lockfile is deterministic

- **WHEN** `lpg lock` is run twice on the same model without changes
- **THEN** both runs produce byte-identical lockfiles

#### Scenario: Reordering and layout do not change the lockfile

- **WHEN** node types are reordered in the model file, or boxes are moved on the canvas
- **THEN** a lockfile written afterwards is byte-identical to one written before

#### Scenario: A mixin reaches the lockfile through every type it applies to

- **WHEN** a mixin is applied to an abstract node type with two concrete subtypes
- **THEN** the mixin's properties appear on both concrete subtypes in the lockfile

#### Scenario: Model with errors cannot be locked

- **WHEN** `lpg lock` is run on a model with validation errors
- **THEN** the command exits non-zero and no lockfile is written or changed

### Requirement: Locking requires written element ids

The system SHALL refuse to write a lockfile, compute a diff, or generate a migration for a model in which any element id is derived rather than written in the file, because a rename of such an element cannot be distinguished from a drop-plus-add.

#### Scenario: Model with derived element ids

- **WHEN** `lpg lock` is run on a model where a property has no written element id
- **THEN** an `ids-not-written` error names the element and advises running `lpg ids`
- **AND** no lockfile is written

### Requirement: Changes are matched by element id

The system SHALL compute the change set between a lockfile and the current model by matching elements on element id. An element whose id is present on both sides with a different name SHALL be reported as a rename. An element whose id is absent on one side SHALL be reported as added or removed, regardless of how similar it is to an element on the other side.

#### Scenario: Renaming a node type

- **WHEN** a node type `Person` is renamed to `Individual` keeping its element id
- **THEN** the change set contains one rename of that node type and no addition or removal

#### Scenario: Replacing an element id by hand

- **WHEN** a property keeps its name but its element id is changed in the file
- **THEN** the change set reports the old property removed and a new property added

#### Scenario: Moving a property to an ancestor

- **WHEN** a property with a written element id is moved from a concrete node type to its abstract parent, and no other type inherits it
- **THEN** the change set reports the property as moved and reports no change to the concrete node type's properties

### Requirement: Changes are classified by impact

Every change in a change set SHALL carry exactly one class:

- `destructive` — removes something existing data may hold: a removed node type, edge type or property, or a removed enum value.
- `breaking` — existing data may become invalid or existing queries may stop matching: a rename, a property becoming required, a key change, a narrowed value type, a narrowed cardinality or value constraint, a type becoming closed, or a changed edge endpoint.
- `additive` — everything else, such as an added optional property, an added node type, or a relaxed constraint.

#### Scenario: Adding an optional property

- **WHEN** an optional property is added to a node type
- **THEN** the change is classified `additive`

#### Scenario: Making a property required

- **WHEN** an existing optional property is marked required
- **THEN** the change is classified `breaking`

#### Scenario: Removing a property

- **WHEN** a property is removed from a node type
- **THEN** the change is classified `destructive`

### Requirement: Diffing a model against its lockfile

`lpg diff` SHALL print the change set between a model and its lockfile with each change's class and element. With `--fail-on <class>` it SHALL exit non-zero when any change is of that class or a more severe one, in the order `additive` < `breaking` < `destructive`. `lpg lock --check` SHALL exit non-zero when the change set is not empty.

#### Scenario: Gating a pull request on breaking changes

- **WHEN** `lpg diff --fail-on breaking` is run on a model in which a property was renamed
- **THEN** the rename is printed as `breaking` and the command exits non-zero

#### Scenario: Only additive changes

- **WHEN** `lpg diff --fail-on breaking` is run on a model whose only change is an added node type
- **THEN** the command exits zero

#### Scenario: Stale lockfile in continuous integration

- **WHEN** `lpg lock --check` is run on a model changed since its lockfile was written
- **THEN** the command exits non-zero and names the changed elements

#### Scenario: No lockfile

- **WHEN** `lpg diff` or `lpg migrate` is run on a model with no lockfile
- **THEN** a `lockfile-missing` error advises running `lpg lock` to record a baseline, and the command exits non-zero

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

### Requirement: Destructive changes are gated

`lpg migrate` SHALL refuse to proceed when the change set contains a `destructive` change, or when a target can only apply a change by discarding stored data, unless `--allow-destructive` is given. On refusal it SHALL report a `destructive-change` error for each such change, write no script, and leave the lockfile unchanged. With the flag, each destructive statement SHALL be preceded by a comment in the script marking it destructive and naming the element.

#### Scenario: Removing a node type without the flag

- **WHEN** a node type is removed and `lpg migrate` is run without `--allow-destructive`
- **THEN** a `destructive-change` error names the node type
- **AND** no migration script is written and the lockfile revision does not change

#### Scenario: Removing a node type with the flag

- **WHEN** the same migration is run with `--allow-destructive`
- **THEN** each target's script drops the node type's schema objects under a comment marking the statement destructive

### Requirement: Changes a target cannot apply in place are downgrades

When a target cannot apply a change in place, the migration SHALL report a downgrade diagnostic for that target naming the change, and SHALL write a comment at the corresponding location in the script. If the only way to apply it discards stored data, the change SHALL be subject to the destructive gate for that target. A change SHALL NOT be omitted from a script silently.

#### Scenario: Changing a key on the ladybug target

- **WHEN** a node type's key changes and a ladybug migration is generated with `--allow-destructive`
- **THEN** a downgrade diagnostic states that the ladybug target cannot change a primary key in place
- **AND** the script recreates the node table under a comment marking it destructive

#### Scenario: Changing a key without the flag

- **WHEN** the same change is migrated without `--allow-destructive`
- **THEN** a `destructive-change` error is reported for the ladybug target even though the change is classified `breaking`

### Requirement: Ladybug migration

For the ladybug target, applying the migration script to a database created from the previous revision's generated DDL SHALL yield the same node tables, rel tables, columns, column types, primary keys and multiplicities as the DDL generated from the current model, and SHALL preserve the data of every node type, edge type and property that was not removed.

#### Scenario: Adding a property to an abstract parent

- **WHEN** an optional property is added to an abstract node type with two concrete subtypes
- **THEN** the ladybug script adds the column to both concrete node tables and creates no table

#### Scenario: Renaming a node type preserves its rows

- **WHEN** a node type holding rows is renamed and the ladybug migration is applied
- **THEN** the renamed table holds the same rows and the key constraint still rejects a duplicate key

#### Scenario: Migrated schema matches a fresh schema

- **WHEN** a migration is applied to a database built from the previous revision's DDL
- **THEN** the resulting catalogue equals the catalogue of a database built from the current model's DDL

### Requirement: Neo4j migration

For the neo4j target, the script SHALL drop every constraint and index generated for the previous revision that the current model does not generate, create every one the current model generates that the previous revision did not, and for a renamed node type, edge type or property rewrite existing labels, relationship types or property names before creating the new constraints. The same edition downgrades SHALL apply as when generating the neo4j target.

#### Scenario: Renaming a node type

- **WHEN** a node type `Person` with a key is renamed to `Individual`
- **THEN** the neo4j script drops `person_key`, relabels existing `Person` nodes as `Individual`, and creates `individual_key`, in that order

#### Scenario: Adding a required property on Community edition

- **WHEN** a required property is added and the neo4j migration is generated for Community edition
- **THEN** a downgrade is reported for the unenforced existence constraint
- **AND** the script contains a comment at that site rather than the constraint

### Requirement: FalkorDB migration

For the falkordb target, the script SHALL drop and create constraints and indexes so the graph ends with those the current model generates, in the order the engine requires: a constraint is dropped before the index it depends on, and an index is created before the constraint that needs it. Renames SHALL rewrite existing labels, relationship types or property names before the new constraints are created.

#### Scenario: Removing a key property's uniqueness

- **WHEN** a unique non-key property becomes non-unique
- **THEN** the falkordb script drops the unique constraint before any statement that drops its index

#### Scenario: Adding a unique property

- **WHEN** a unique property is added to a node type
- **THEN** the falkordb script creates the exact-match index on the line before the unique constraint

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
