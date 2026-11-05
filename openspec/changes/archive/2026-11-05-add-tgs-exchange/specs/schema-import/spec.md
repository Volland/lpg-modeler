## ADDED Requirements

### Requirement: TGS schema notes are an import source

The system SHALL read Typed Graph Schema (TGS) notes into a model. A folder SHALL be read as a schema folder: every Markdown note directly in it is a schema note and notes in subfolders are not. A single `.md` note SHALL be read on its own. Both SHALL produce one model holding the joint ontology, through the same write-then-validate path as every other import. A note SHALL be recognised as TGS by `--from tgs`, by being in a folder given as the input, or by a frontmatter declaring `schema`, `schemas`, `edgeTypes` or `tgs`.

#### Scenario: Importing a Types folder of several ontologies

- **WHEN** `lpg import Types/` is run on a folder holding `code-types.md` and `spec-types.md`
- **THEN** one model is written declaring the types and edge types of both notes

#### Scenario: Importing one note

- **WHEN** `lpg import Types/code-types.md` is run
- **THEN** the model declares exactly the types and edge types of that note

#### Scenario: A folder is not mistaken for a database

- **WHEN** a folder holding Markdown schema notes is imported without `--from`
- **THEN** it is read as TGS, not opened as a LadybugDB database

### Requirement: TGS declarations map onto the model

A TGS type SHALL become a node type with its properties: `text` as string, `number` as float, `boolean`, `date` and `datetime` as themselves, `link` as string, `list` as a string list, `many: true` as a list, `required: true` as required, and `values` as an enum shared by every property with the same value list. An edge type SHALL become an edge type with its properties; its endpoints SHALL be taken from its `from` and `to` and from every type whose `edges` names it, and a type's `many: false` and `required: true` SHALL become the to end's upper and lower bound of one.

#### Scenario: A subsystem note

- **WHEN** a note declares `Person` with `edges: {worksAt: Company}` and an edge type `worksAt` with property `since: date`
- **THEN** the model declares edge type `worksAt: Person → Company` with a `since` date property

#### Scenario: Several endpoint types without a common ancestor

- **WHEN** an edge type's `to` lists `Decision` and `Requirement` and no hierarchy relates them
- **THEN** the edge keeps the first type as its endpoint and an `import-tgs-endpoint-union` diagnostic names the types dropped

#### Scenario: An unrestricted endpoint

- **WHEN** an edge type declares `from: Concept` and no `to`
- **THEN** no edge type is declared and an `import-tgs-open-endpoint` warning names it

#### Scenario: A type named but never declared

- **WHEN** an edge type's `from` names `CodeSymbol`, which no note declares
- **THEN** the model declares an empty node type `CodeSymbol` and reports `import-tgs-undeclared-type`

### Requirement: An imported TGS type has a key

Every concrete node type read from TGS SHALL have a key. The key SHALL be the one recorded in the note's `lpg` key, else the property named by the type's first `id` rule, else a synthesized required string property `title`, and a synthesized key SHALL be reported as `import-tgs-title-key`.

#### Scenario: A type with an id rule

- **WHEN** a type declares `id: {kind: uuid7, property: uid}`
- **THEN** the node type's key is `uid`, a required string

#### Scenario: A type with no identity

- **WHEN** a type declares neither an id rule nor an `lpg` key
- **THEN** the node type gains a required `title` property as its key and `import-tgs-title-key` is reported

### Requirement: What TGS carries that the model does not is reported

Templates, property defaults, id rules not used as the key, visualization hints, and type IRIs outside the model's namespace SHALL be reported on import, never dropped silently. A note declaring an unsupported TGS major version SHALL be reported and not read, and a type, edge type or prefix declared twice SHALL keep the declaration from the note whose path sorts first and be reported.

#### Scenario: Templates and visualization

- **WHEN** an imported type declares `template` and `visualization`
- **THEN** an `import-tgs-not-carried` diagnostic counts what was not carried

#### Scenario: A newer major version

- **WHEN** a note declares `tgs: "1.0"`
- **THEN** an `import-tgs-version` diagnostic names the note and none of its declarations are imported

### Requirement: A model exported to TGS imports back unchanged

When the notes carry the `lpg` key written by the `tgs` target, the import SHALL restore what TGS cannot say: abstract types, inheritance, mixins, keys, uniqueness, exact scalar types, enum names, value constraints, declared endpoints and cardinality. Inherited and mixin properties flattened onto a type SHALL be factored back onto their owner. An `lpg` entry naming an element the TGS keys no longer declare SHALL be reported and ignored.

#### Scenario: Round trip of a model with a hierarchy

- **WHEN** a model with an abstract parent, a mixin and an edge from the abstract parent is exported in either layout and imported again
- **THEN** the imported model has the same node types, edge types, keys, hierarchy, mixins, enums and cardinality

#### Scenario: A note edited by hand

- **WHEN** a type is deleted from the TGS keys of an exported note but left in its `lpg` key
- **THEN** the type is not imported and the stale `lpg` entry is reported

### Requirement: TGS import is available in the editor

VS Code SHALL offer **LPG: Import Typed Graph Schema…**, which asks whether to import a folder of schema notes or a single note, opens the matching dialog, and saves, opens and draws the model as the existing import does.

#### Scenario: Importing a folder from the editor

- **WHEN** the user runs the command, picks "Folder of notes" and chooses `Types/`
- **THEN** a model is saved, opened and shown on the canvas, and what was not carried is offered as notes
