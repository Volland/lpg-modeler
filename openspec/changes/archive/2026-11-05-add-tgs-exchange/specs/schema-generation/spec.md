## ADDED Requirements

### Requirement: TGS target writes schema notes

The `tgs` target SHALL write a model as Typed Graph Schema notes that the TGS reference reader accepts without a finding: each node type as a type with its properties (inherited and mixin properties flattened onto it) and its outgoing edges, each edge type with `from`, `to` and properties, and the namespace as a prefix used in every `uri`. An abstract endpoint SHALL be written as the list of its concrete descendants. Every type SHALL declare `edges`, so that an outgoing edge the model does not declare is not allowed.

#### Scenario: Generating the target

- **WHEN** `lpg emit social.lpg.yaml --target tgs` is run
- **THEN** one Markdown note is printed whose frontmatter declares every node type under `schemas` and every edge type under `edgeTypes`

#### Scenario: An abstract endpoint

- **WHEN** edge `OWNS` runs from abstract `Party` to `Car`
- **THEN** the `tgs` edge type declares `from: [Company, Person]` and both types list `OWNS` in their `edges`

### Requirement: TGS target reports what a validator will not enforce

The `tgs` target SHALL report as a downgrade every feature TGS cannot express — inheritance, keys, uniqueness, a scalar written as a wider kind, composite types, value and named constraints, closed types, and a cardinality beyond the to end's zero-or-one-or-more — and SHALL record each in the note's `lpg` key so the model can be read back.

#### Scenario: A unique property

- **WHEN** a model with a unique `email` is generated for `tgs`
- **THEN** a `downgrade-unique` warning names `email`, and the note's `lpg` key records it as unique

### Requirement: Exporting to a Types folder in a chosen layout

`lpg export <model> --to tgs` SHALL write the notes into a schema folder (`--out`, default `Types/` in the working directory) in one of two layouts: `folder`, one note per node type with each edge type in its source type's note, or `single`, one note holding the joint ontology. When `--layout` is not given the command SHALL ask on an interactive terminal and SHALL use `folder` otherwise, saying so. Writing to an existing note SHALL replace only its TGS keys and its `lpg` key, keeping its other keys and its body; no note SHALL be deleted; and a note that declares types the export does not contain SHALL be refused unless `--force` is given.

#### Scenario: Folder layout

- **WHEN** `lpg export social.lpg.yaml --to tgs --layout folder` is run
- **THEN** `Types/Person.md`, `Types/Company.md`, `Types/Car.md` and the other type notes are written, each declaring one type with `schema`

#### Scenario: Single layout

- **WHEN** `lpg export social.lpg.yaml --to tgs --layout single` is run
- **THEN** `Types/social.md` is written declaring every type and edge type

#### Scenario: An existing hand-written note

- **WHEN** `Types/social.md` already has a `cssclasses` key and a body
- **THEN** after export it still has both, with its TGS keys replaced

### Requirement: TGS export is available in the editor

VS Code SHALL offer **LPG: Export Typed Graph Schema…**, which asks for the layout (folder of notes or single note) and the schema folder (default `Types/` in the workspace), writes the notes, reports the downgrades, and opens the written note or folder.

#### Scenario: Exporting a single note from the editor

- **WHEN** the user runs the command on a model and picks "Single note"
- **THEN** one note is written into the chosen folder and opened beside the model
