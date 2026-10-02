## ADDED Requirements

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
