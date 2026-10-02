# Design

The metamodel does not change, and neither does the IR, so the lockfile, diffing and rename detection are untouched. All work lands in the `vscode` webview; `core`, the host and the protocol are unchanged. Depends on `lat.md/architecture#Rendering`, `lat.md/architecture#Rendering#Inherited edges`, `lat.md/architecture#Rendering#Exporting the diagram`, `lat.md/architecture#Rendering#Canvas Theme` and `lat.md/architecture#Source of Truth`.

## Context

The projection already sends every edge type in the view with its element id, endpoints, formatted cardinality and properties. The webview turns each one into one React Flow edge with no marker and a label that holds the name, the property names and the cardinality. Layout (`place`) lives in `main.tsx`, which calls `acquireVsCodeApi()` at load, so no test can import it.

## Decisions

### 1. An edge box is a React Flow node whose id is the edge type's element id

Using the element id means the existing `move` message, `setPosition` and `pruneLayout` (which already treats edge ids as live) persist and prune edge boxes with no host change. Renaming an edge type keeps its id, so the box stays put, as a node type's box does.

*Alternative:* a custom React Flow edge with the table drawn at its midpoint. The midpoint is computed from the endpoints, so it cannot be dragged or saved, and its geometry cannot be checked without looking at it — the reason cardinality was never drawn as markers.

### 2. Two connectors per edge type, each with a closed arrowhead at its end, on facing sides

`<edgeId>:from` runs from the from box into the edge box, and `<edgeId>:to` from the edge box into the to box. Every box has one handle per side, and each connector attaches to the pair of sides that face each other, recomputed while a box is dragged. Fixed sides (out on the right, in on the left) send any connector whose target lies to the left back behind both boxes, and a self-edge always has one. The canvas runs in React Flow's loose connection mode, so a connection can also be dragged from either side, and the box it starts on is the from type. A self-edge's two connectors would share both sides and draw as one line with an arrowhead at each end, so the way back attaches to a hidden handle just below each side's own. Both use `MarkerType.ArrowClosed` coloured `var(--edge)`, so a theme or the print-safe export recolours them with everything else. Both carry the edge type's id, so clicking either selects the edge type. Selection highlights both, because two separately highlighted halves would read as two relationships.

The edge box's handles are anchors only. A connection dragged onto an edge box would mean an edge on an edge, which decision 3 keeps out of the core.

### 3. Placement

- **Nothing placed:** ELK lays out node boxes and edge boxes together, with each connector as an ELK edge. Layered layout running right puts an edge box in the layer between its endpoints, so a fresh diagram reads in the edge's direction.
- **Something placed:** missing node type boxes go in a fresh column as before. Each missing edge box then goes at the midpoint of its endpoints' box centres. Edge boxes that land on the same point (parallel edge types between one pair, in either direction) are stacked downwards by one box height plus a gap. An edge box whose from and to are the same type goes to the right of that type's box.

The midpoint may overlap a box in a tightly packed arrangement. The alternative, relaying out the whole diagram once, would move every box the user arranged, which the canvas never does.

### 4. Telling the kinds apart

| | Node type box | Edge box |
| --- | --- | --- |
| Corners | 4px | 14px |
| Border | 1px solid `--line`, with a 3px top rule in `--kind-node` | 3px double `--kind-edge` |
| Header | name, badges | `edge` badge, name, `From → To`, cardinality |

Shape and text carry the difference on their own, so it survives the print-safe export and a grayscale printout. The kind colors are the inspector's heading tokens, which already reach 4.5:1 against the background. The test gains 3:1 against the box fill, since they now mark boxes as well. `.export-light` pins both kind tokens to dark print-safe values, because a mixed or themed token is not re-derived under a descendant class.

### 5. Layout code moves into `webview/diagram.ts`

`place`, the box size estimates and a new `connectors(projection)` move into a module with no `acquireVsCodeApi` and no JSX, so tests import it directly. `elkjs` runs in Node.

## Risks / Trade-offs

- [Diagrams grow by one box per edge type] → Views already cap what one diagram shows. An edge box is narrower than a node type box (200px against 240px).
- [A midpoint-placed edge box can overlap a box] → It is dragged once and saved. Relaying out would move everything instead.
- [An arrowhead into the edge box can read as "Person points at WORKS_AT"] → The arrowheads form one continuous path from → box → to, and the box header spells `Person → Company`.

## Migration Plan

None needed. An existing layout sidecar has no edge box positions. They are computed on first open and saved as a new node type box's would be. Rolling back leaves harmless extra entries in the sidecar, which the older extension ignores because it draws no box with that id.
