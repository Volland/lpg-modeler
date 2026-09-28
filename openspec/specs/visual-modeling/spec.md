## Purpose

Defines the canvas as the primary authoring surface: how a user creates and edits node
types, edge types, and properties visually, and how those edits reach the model file
without the user ever opening it.

## Requirements

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

### Requirement: Canvas meets a contrast floor

Every element the canvas draws SHALL be distinguishable from what it is drawn on, under the default palette and under every built-in theme. Measured as WCAG 2.1 contrast ratio: primary text SHALL reach 7:1 against the canvas background, the box fill and the box header; secondary text and accent text SHALL reach 4.5:1 against the same three; box borders SHALL reach 3:1 against the canvas background and the box fill; edge strokes SHALL reach 3:1 against the canvas background. Every control on the canvas, including the key toggle on a property row, SHALL be drawn in a color from the active palette rather than a browser default.

#### Scenario: Built-in theme contrast

- **WHEN** any built-in theme is active
- **THEN** each of its color pairs above meets the stated ratio

#### Scenario: Default palette on a dark editor theme

- **WHEN** no theme is chosen and VS Code uses a dark theme whose panel border is translucent
- **THEN** box borders, edges and secondary text are derived from the editor's foreground and background rather than borrowed from panel or widget colors, and remain visible

#### Scenario: Key toggle is visible

- **WHEN** a node type is shown on the canvas under any palette
- **THEN** the key toggle on each property row is drawn in the palette's colors, not in the browser's default button text color

### Requirement: Built-in canvas themes

The extension SHALL offer a `lpg.canvas.theme` setting with the values `auto`, `solarizedLight`, `solarizedDark`, `black` and `white`. `auto` SHALL follow the VS Code theme's background and foreground. Every other value SHALL fix the canvas palette regardless of the VS Code theme. A change to the setting SHALL reach every open canvas without reopening it.

#### Scenario: Choosing a theme in settings

- **WHEN** a user sets `lpg.canvas.theme` to `solarizedDark` with a canvas open
- **THEN** the open canvas redraws in the Solarized Dark palette

#### Scenario: Theme independent of the editor

- **WHEN** `lpg.canvas.theme` is `white` and VS Code uses a dark theme
- **THEN** the canvas is drawn on a white background with dark text

### Requirement: Canvas colors are user-configurable

The extension SHALL offer one setting per canvas color token under `lpg.canvas.colors.*`: `background`, `foreground`, `muted`, `border`, `accent`, `box`, `boxHeader`, `edge`, `grid`, `nodeKind`, `edgeKind` and `mixinKind`. Each SHALL accept a hex color or be empty. A non-empty value SHALL override that token of the active theme, including `auto`; an empty value SHALL leave the theme's color. A value that is not a hex color SHALL be ignored rather than applied.

#### Scenario: Overriding one color

- **WHEN** a user sets `lpg.canvas.colors.edge` to `#ff0000` under the `black` theme
- **THEN** edges are drawn red and every other color remains the Black palette's

#### Scenario: A malformed value

- **WHEN** a color setting holds `red-ish`
- **THEN** the canvas uses the active theme's color for that token

### Requirement: Themes and colors are set from the canvas

The canvas toolbar SHALL offer a theme picker and a colors dialog. The dialog SHALL show every color token with a color picker set to its current color, SHALL offer a reset per token and a reset of all tokens, and SHALL write the chosen values to the same user settings the Settings UI edits. Neither the model file nor the layout or views sidecar SHALL change when a theme or color is chosen.

#### Scenario: Picking a theme from the toolbar

- **WHEN** a user selects Solarized Light in the canvas toolbar
- **THEN** `lpg.canvas.theme` becomes `solarizedLight` in user settings and the canvas redraws in it
- **AND** the model file is unchanged

#### Scenario: Resetting a color

- **WHEN** a user resets the `border` color in the colors dialog
- **THEN** `lpg.canvas.colors.border` is cleared and the theme's border color returns

### Requirement: Key is chosen in the inspector

The inspector for a node type SHALL list the type's properties with a key checkbox each, reflecting the current key. Checking or clearing a box SHALL set the node type's key to the checked properties in the order they are declared, so a composite key is authored without editing text.

#### Scenario: Setting a composite key

- **WHEN** a user checks `country` and `number` in the inspector for a node type with no key
- **THEN** the node type in the model file declares `key: [country, number]`

#### Scenario: Clearing the key

- **WHEN** a user clears the only checked key property
- **THEN** the node type declares no key and validation reports that a concrete type needs one
