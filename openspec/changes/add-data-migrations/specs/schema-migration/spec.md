## ADDED Requirements

### Requirement: Declared data mappings become migration steps

When a model change carries a declared data mapping (format to be designed in a prerequisite change), `lpg migrate` SHALL plan the data movement into the same per-target script as the schema statements, ordered so no data step runs against a shape that no longer exists, and gated by the destructive gate when any step discards values.

#### Scenario: A property split

- **WHEN** a property `name` is removed, `first` and `last` are added, and a mapping declares the split
- **THEN** each database target's script copies the data before dropping the column or property, and the change is not classed destructive

#### Scenario: No mapping declared

- **WHEN** the same structural change carries no mapping
- **THEN** the migration is planned exactly as today: a destructive removal plus an addition, gated
