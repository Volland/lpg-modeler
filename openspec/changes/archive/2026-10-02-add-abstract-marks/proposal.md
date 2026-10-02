## Why

An abstract node type differs from a concrete one on the canvas only by a dashed border and an `abstract` badge, and it is drawn at 90% opacity — which lowers the contrast of its text, against the floor the canvas themes set. An edge type that reaches an abstract node type looks exactly like one between concrete types, although no target stores it as declared: every database target expands it to one relationship per concrete descendant.

## What Changes

- **Abstract node types are marked four ways, none of them color or opacity:** a dashed border all round, an italic name, a `«abstract»` badge, and a hatched title bar. The opacity goes.
- **Abstract edge types are marked the same way.** An edge type is abstract on the canvas when either endpoint is an abstract node type. Its box takes the dashed border, italic name, `«abstract»` badge and hatched title bar; its connectors are dashed; and the abstract endpoint is italic in the box's `From → To` line.
- **Tooltips say what it means:** an abstract node type has no instances of its own; an abstract edge type is realised once per concrete descendant of its abstract end.

## Non-goals

- An `abstract` flag on edge types in the model. Abstractness of an edge is derived from its endpoints; nothing in the model file changes.
- Changing what any target emits.

## Locked decisions

None touched. Decision 3 is untouched: the edge type stays a binary edge; only its drawing changes.

## Targets affected

None.

## Capabilities

### Modified Capabilities
- `visual-modeling`: abstract node and edge types told apart from concrete ones without color.

## Impact

- `vscode` webview: `isAbstractEdge` and dashed connectors in `diagram.ts`, both box components, stylesheet.
- Tests: abstract edge detection, dashed connectors, stylesheet cues, no opacity on abstract boxes.
- `lat.md/architecture.md`: an `Abstract types` section under Rendering.
