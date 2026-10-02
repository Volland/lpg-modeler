## Why

An edge type is drawn as one line between two node type boxes, with no arrowhead, so the diagram does not say which way it runs: `EMPLOYS` from `Company` to `Person` and the reverse look the same until the line is selected. Its name, properties and cardinality share one label, which past two properties covers the line it names.

An edge type with properties is a table in the database targets (a Ladybug rel table), and the diagram is where a user checks the model against that picture.

## What Changes

- **Edge types become boxes.** Each edge type shown in a view is drawn as a box of its own, carrying its name, its endpoints, its cardinality and one row per property, with the same property actions a node type box has.
- **Directed connectors.** A connector runs from the from node type's box into the edge box, and another from the edge box into the to node type's box. Each ends in an arrowhead, so direction reads without selecting anything. Either connector selects the edge type.
- **Edge boxes look different from node boxes, and not only in color.** An edge box has rounded corners, a double border, an `edge` badge and a `From → To` line. The inspector's kind colors also mark the boxes, so a node type box carries its kind color and an edge box its own.
- **Edge box positions persist.** They are stored in the layout sidecar under the edge type's element id, like a node type's. A diagram saved before this change places each edge box between its endpoints and moves no box the user arranged.

## Non-goals

- Changing how edges are declared, or anything in the model file.
- Crow's-foot or other cardinality markers at the connector ends. Cardinality stays a number, now on the edge box.
- Drawing an inherited edge type again from each descendant. It stays on the ancestor's box.
- Starting a new edge type from an edge box. Connections are still dragged between node type boxes.

## Locked decisions

None touched. Decision 1 is upheld: an edge box's position lives in the layout sidecar, keyed by element id, and moving it never changes the model file. Decision 3 is untouched: an edge box is a drawing of a binary edge type, not an edge on an edge.

## Targets affected

None. No emitter, importer or IR change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `visual-modeling`: edge types drawn as boxes joined by directed connectors; edge box positions persisted; edge and node boxes distinguishable without color.

## Impact

- `vscode` webview only: layout and connectors in a testable module, an edge box component, stylesheet kind marks, `.export-light` pins the kind colors. `core`, host and protocol untouched.
- Tests: connector direction, edge box placement, print-safe cues, kind color contrast.
- `lat.md/architecture.md`: an `Edge boxes` section under Rendering.
