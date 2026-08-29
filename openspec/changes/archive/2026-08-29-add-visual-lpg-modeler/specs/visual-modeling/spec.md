## Purpose

Defines the canvas as the primary authoring surface: how a user creates and edits node
types, edge types, and properties visually, and how those edits reach the model file
without the user ever opening it.

## ADDED Requirements

### Requirement: Canvas is the authoring surface

The extension SHALL open a canvas beside the editor showing the node types, edge types,
and properties of a model. A user SHALL be able to perform every modeling action from
the canvas without editing text.

#### Scenario: Creating a model from an empty canvas

- **WHEN** a user opens a new model and adds a node type, two properties, and a key
  entirely from the canvas
- **THEN** the model file contains that node type with those properties and key
- **AND** the user has not typed into the file

#### Scenario: Creating an edge by dragging

- **WHEN** a user drags from one node type to another on the canvas
- **THEN** an edge type is created between them and appears in the model file
- **AND** the new edge type is selected so it can be named immediately

#### Scenario: Adding a property to an edge

- **WHEN** a user adds a property to an edge type on the canvas
- **THEN** the edge type in the model file carries that property

### Requirement: Model file remains canonical and readable

Canvas edits SHALL be applied to the model file as targeted modifications. Comments,
key order, and formatting elsewhere in the file SHALL be preserved.

#### Scenario: Editing a commented model

- **WHEN** a model file contains comments above several node types and the user renames
  one type on the canvas
- **THEN** every comment remains in place
- **AND** the only textual change is the renamed type

#### Scenario: Undo after a canvas edit

- **WHEN** a user makes a canvas edit and then invokes undo in the editor
- **THEN** the model file returns to its previous content

### Requirement: Text and canvas stay synchronized

The canvas SHALL reflect the model file as the single source of truth. Editing the file
directly SHALL update the canvas.

#### Scenario: Editing the file while the canvas is open

- **WHEN** a user adds a property by typing in the model file with the canvas open
- **THEN** the canvas shows the new property without being reopened

#### Scenario: File becomes structurally invalid

- **WHEN** a user types text that makes the model file unparseable
- **THEN** the canvas retains the last valid diagram and indicates the model is invalid
- **AND** the canvas does not go blank

### Requirement: Validation surfaces in the editor

Validation errors and downgrade warnings SHALL be reported as editor diagnostics
located at the position in the model file that caused them.

#### Scenario: Node type without a key

- **WHEN** a model contains a concrete node type with no key
- **THEN** a diagnostic appears on that node type in the Problems panel
- **AND** selecting it reveals the corresponding element on the canvas

### Requirement: Named views scope each diagram

A view SHALL name a subset of a model's types, forming one diagram. A model MAY have
several views. A user SHALL be able to create a view and add or remove types from it on
the canvas.

#### Scenario: Focusing a subset

- **WHEN** a model has twenty node types and a user creates a view containing three
- **THEN** the diagram for that view shows only those three and the edges among them

#### Scenario: Type belonging to no view

- **WHEN** a model contains a node type that no view includes
- **THEN** validation reports it so it cannot be silently invisible

### Requirement: Layout persists and survives rename

Positions arranged by a user SHALL be stored separately from the model's semantics,
per view, and SHALL be keyed so that renaming a type does not move it.

#### Scenario: Rearranging and reopening

- **WHEN** a user drags node types into an arrangement and reopens the model later
- **THEN** the arrangement is preserved

#### Scenario: Renaming a positioned type

- **WHEN** a user renames a node type that has been positioned on a diagram
- **THEN** the box remains in the same position under its new name

#### Scenario: Moving a box does not change semantics

- **WHEN** a user drags a node type to a new position and makes no other edit
- **THEN** the model file is unchanged
