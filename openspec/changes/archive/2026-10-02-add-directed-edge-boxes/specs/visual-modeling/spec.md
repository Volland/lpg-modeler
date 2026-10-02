## ADDED Requirements

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
