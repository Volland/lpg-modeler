## ADDED Requirements

### Requirement: Applying a script to a LadybugDB database

`lpg apply <script> --target ladybug --database <path>` SHALL run each statement of a ladybug script against the database at that path, in file order, and print each statement as it succeeds. It SHALL stop at the first failing statement, report that statement's position, its text and the engine's message, report how many statements had already been applied, and exit non-zero. The path SHALL be a directory or a `.lbdb`, `.lbug` or `.kuzu` file, as an import recognises one.

#### Scenario: Applying a generated schema to a fresh database

- **WHEN** the ladybug script generated for a model is applied to a path holding no database
- **THEN** the database is created, every statement runs, the command exits zero, and importing the database back yields the model's node types, keys and edge endpoints

#### Scenario: A statement the engine refuses

- **WHEN** a script's statement is one LadybugDB refuses, such as changing a column's type
- **THEN** the statements before it have been applied, it is reported with the engine's message, no later statement runs, and the command exits non-zero

#### Scenario: Applying a migration

- **WHEN** a migration generated between two revisions is applied to a database built from the earlier revision
- **THEN** the database afterwards holds the later revision's schema and the rows that the renamed elements carried

#### Scenario: A path that is not a database

- **WHEN** `--database` names a file that exists but is not a LadybugDB database
- **THEN** the failure is reported with the engine's message, nothing is applied, and the command exits non-zero

### Requirement: Creating the database is a choice the user can refuse

`lpg apply --target ladybug` SHALL create a database at the named path when none exists, and SHALL report that it did. Given `--no-create`, it SHALL instead refuse a path holding no database, before running any statement.

#### Scenario: A mistyped path with --no-create

- **WHEN** a script is applied with `--no-create` to a path holding no database
- **THEN** an `apply-no-database` error names the path, nothing is created and nothing is applied

#### Scenario: A fresh database is reported

- **WHEN** a script is applied to a path holding no database and `--no-create` is not given
- **THEN** the run states that it created the database at that path before it reports the statements
