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

### Requirement: Edge types are drawn as boxes joined by directed connectors

The canvas SHALL draw each edge type shown in a view as a box of its own, carrying its name, its from and to node types, its cardinality when it constrains anything, and one row per property. The edge box SHALL be joined to its from node type by a connector running from that node type's box into the edge box, and to its to node type by a connector running from the edge box into that node type's box. Each connector SHALL end in an arrowhead at the box it runs into, so the direction of the edge type reads without selecting anything. A user SHALL be able to add, rename and delete an edge type's properties from its box.

#### Scenario: Edge type between two node types

- **WHEN** a model declares `WORKS_AT` from `Person` to `Company` and both are in the view
- **THEN** the diagram shows a `WORKS_AT` box
- **AND** a connector runs from the `Person` box to the `WORKS_AT` box, ending in an arrowhead at `WORKS_AT`
- **AND** a connector runs from the `WORKS_AT` box to the `Company` box, ending in an arrowhead at `Company`

#### Scenario: Edge type from a node type to itself

- **WHEN** a model declares `KNOWS` from `Person` to `Person`
- **THEN** one connector runs from the `Person` box into the `KNOWS` box and another from the `KNOWS` box back into the `Person` box, each ending in an arrowhead
- **AND** the two connectors are drawn apart, so they do not read as one line with an arrowhead at each end

#### Scenario: Connectors follow the arrangement

- **WHEN** a user drags a node type box to the other side of an edge box it is joined to
- **THEN** the connector between them attaches to the sides of the two boxes that face each other, rather than running back behind either box

#### Scenario: Edge properties on the edge box

- **WHEN** an edge type carries properties
- **THEN** each property is a row on the edge box showing its name and type
- **AND** a user can add a property from the edge box and it appears on that edge type in the model file

#### Scenario: Selecting a connector

- **WHEN** a user clicks either connector of an edge type
- **THEN** the inspector shows that edge type and both of its connectors are highlighted

#### Scenario: A fresh layout reads in the edge's direction

- **WHEN** a view with no saved positions is laid out and an edge type joins two different node types that form no cycle
- **THEN** the edge box lies to the right of its from node type's box and to the left of its to node type's box

### Requirement: Edge box positions persist and never move arranged boxes

An edge box's position SHALL be stored in the layout sidecar under the edge type's element id, per view, like a node type's. An edge box with no saved position SHALL be placed between its endpoints' boxes, and placing it SHALL NOT move any box that already has a position.

#### Scenario: Diagram arranged before edge boxes existed

- **WHEN** a view has saved positions for its node types and none for its edge types
- **THEN** each edge box is placed between the boxes of its from and to node types
- **AND** every node type box stays where it was saved

#### Scenario: Several edge types between the same pair

- **WHEN** two edge types join the same two node types and neither has a saved position
- **THEN** their boxes are placed so they do not cover each other

#### Scenario: Moving an edge box

- **WHEN** a user drags an edge box to a new position and makes no other edit
- **THEN** the position is saved in the layout sidecar
- **AND** the model file is unchanged

### Requirement: Edge boxes and node type boxes are told apart without color

An edge box SHALL differ from a node type box in shape and in text, not by color alone. It SHALL have rounded corners and a double border, carry an `edge` badge, and name its endpoints as `From → To`. The inspector's kind colors SHALL also mark the boxes: a node type box with the node kind color and an edge box with the edge kind color. In every built-in theme each kind color SHALL reach 3:1 against the canvas background and the box fill. The print-safe export SHALL keep the shape and text cues and SHALL draw the kind marks in fixed print-safe colors.

#### Scenario: Print-safe export

- **WHEN** a diagram is exported with the light option
- **THEN** edge boxes keep their rounded corners, double border, `edge` badge and endpoint line
- **AND** the kind marks are drawn in the export's fixed colors rather than the live palette's

#### Scenario: Kind marks under a built-in theme

- **WHEN** any built-in theme is active
- **THEN** the node kind and edge kind colors each reach 3:1 against the canvas background and the box fill

### Requirement: Abstract types are told apart without color

The canvas SHALL draw an abstract node type with a dashed border, an italic name, an `«abstract»` badge and a hatched title bar, and SHALL NOT reduce its opacity. An edge type SHALL be drawn as abstract when its from or to node type is abstract: its box SHALL carry the same four marks, both its connectors SHALL be dashed, and each abstract endpoint SHALL be italic in the box's endpoint line. A concrete node type and an edge type between concrete node types SHALL carry none of these marks. The marks SHALL survive a print-safe export.

#### Scenario: Abstract node type

- **WHEN** the model declares `Vehicle` with `abstract: true`
- **THEN** its box has a dashed border, an italic name, an `«abstract»` badge and a hatched title bar, at full opacity

#### Scenario: Edge type reaching an abstract node type

- **WHEN** `STATIONED_AT` runs from the abstract `Asset` to the concrete `Depot`
- **THEN** its box carries the abstract marks, both its connectors are dashed, and `Asset` is italic in its endpoint line

#### Scenario: Edge type between concrete node types

- **WHEN** `TOWS` runs from the concrete `Truck` to the concrete `Trailer`
- **THEN** its box and its connectors carry no abstract mark

#### Scenario: Grayscale export

- **WHEN** a diagram holding abstract and concrete types is exported with the print-safe palette
- **THEN** abstract types remain distinguishable by border style, badge, italics and hatching alone
