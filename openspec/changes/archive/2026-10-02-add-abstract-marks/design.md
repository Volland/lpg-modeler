# Design

The metamodel does not change, and neither does the IR, the protocol or the host: `WireNode.abstract` already reaches the canvas, and an edge type's abstractness is computed in the webview from its endpoints. Work lands in `vscode` only. Depends on `lat.md/architecture#Rendering#Edge boxes`, `lat.md/architecture#Rendering#Canvas Theme` and `lat.md/metamodel#Type Hierarchy`.

## Why derived for edges

An edge declared against an abstract node type belongs to every concrete descendant (`metamodel#Type Hierarchy`), and every database target expands it rather than storing it as written. That is the same claim "abstract" makes about a node type — no instances of its own — so the canvas draws it the same way. A model-level flag would be a second way to say something the endpoints already say, and could contradict them.

## Marks

Four, so that no single one carries the meaning and none depends on hue: border style (dashed), type style (italic name — UML's own convention), text (`«abstract»`), and texture (diagonal hatching on the title bar, a `repeating-linear-gradient` of `--line` at low weight over `--box-head`). Opacity is dropped because it lowered text contrast below the theme floor. Connectors of an abstract edge type get `strokeDasharray`, the one mark a line can carry.

`isAbstractEdge(edge, nodes)` lives in `diagram.ts` beside `connectors`, which uses it, so both are tested without a browser.
