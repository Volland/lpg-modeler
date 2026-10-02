## 1. Layout and connectors

- [x] 1.1 Move `place` and the box size estimates from `main.tsx` into `webview/diagram.ts`; add edge boxes to the ELK graph with one ELK edge per connector.
- [x] 1.2 Place a missing edge box at its endpoints' midpoint, stack coincident ones, put a self-edge's box to the right of its type; never move a placed box.
- [x] 1.3 `connectors(projection)`: two connectors per edge type with closed arrowheads, carrying the edge type's id.
- [x] 1.4 `faceSides`: attach each connector to the facing sides of its boxes, re-chosen on drag; a self-edge's way back attaches to a lower handle; loose connection mode.

## 2. Edge box

- [x] 2.1 `EdgeBox` component: `edge` badge, name (rename via the inspector selection), `From → To`, cardinality, property rows with add, rename and delete, delete button; non-connectable handles. Share the property row with the node type box.
- [x] 2.2 `main.tsx`: build edge box nodes and connectors, select the edge type from either connector, highlight both connectors when it is selected, ignore connections that touch an edge box.

## 3. Stylesheet

- [x] 3.1 Node type box top rule in `--kind-node`; edge box rounded corners, double `--kind-edge` border, badge and endpoint line.
- [x] 3.2 `.export-light` pins `--kind-node` and `--kind-edge`.

## 4. Tests

- [x] 4.1 Connectors: direction, arrowheads, self-edge, edge type id on both.
- [x] 4.2 Placement: fresh layout puts the box between its endpoints; legacy layout places boxes between endpoints and moves no node box; parallel edge types do not overlap.
- [x] 4.3 Stylesheet: edge box shape cues, export pins kind colors; every preset's kind colors reach 3:1 against the box fill.

## 5. Documentation

- [x] 5.1 `lat.md/architecture.md`: `Edge boxes` section under Rendering with `@lat:` refs from the tests; correct the cardinality-in-label note.
- [x] 5.2 CHANGELOG entries.
- [x] 5.3 `lat check`.
