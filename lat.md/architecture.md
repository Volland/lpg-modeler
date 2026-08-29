# Architecture

lpg-modeler is a VS Code extension and CLI for authoring Labeled Property Graph schemas as text, viewing them as ERD-like diagrams, and generating database DDL, migrations, and RDF artifacts from a single model.

## Source of Truth

The canonical artifact is a hand-editable YAML model file holding semantics only. Diagram coordinates live in a separate sidecar so rearranging a diagram never dirties the semantic diff.

Layout is keyed by [[metamodel#Stable Element IDs]] rather than by type name, so renaming a type preserves its position on every diagram. Sidecar entries nest under a named view, not under the model as a whole — see [[architecture#Views]].

## Surface Syntax

Models are YAML validated by a JSON Schema the extension contributes through `contributes.jsonValidation`, so completion, hover, and structural errors come from VS Code's existing YAML tooling at no cost.

Owning no parser is a deliberate trade. The durable asset is the intermediate representation and the emitters that consume it; the surface syntax stays swappable, and a concise custom DSL with a real language server remains a later option rather than a prerequisite.

## Package Boundary

The repository is a monorepo of three packages: `core` holds parsing, the IR, validation, diffing, and every emitter; `cli` wraps core for continuous integration; `vscode` adds only webview and diagnostics plumbing.

`core` must never import `vscode`, enforced by lint. This keeps emitter tests runnable in plain Node with no editor harness, and it is what allows a pull request to be gated on schema validity.

## Modularity

Modularity means two separate things, and only one of them ships in v1: models compose across files, while emitters sit behind a registry that is internal for now.

Model composition is a metamodel feature and cannot be retrofitted once models exist in the wild, so it lands first — see [[metamodel#Composition]]. A public plugin API is deliberately deferred until three real emitters have shown where the seam actually falls; the [[emitters#Capability Matrix]] is what that API will eventually expose.

## Editing Surface

The canvas is a companion webview opened beside the YAML editor, in the manner of Markdown preview. It is the authoring surface: a user creates node types, edge types, and properties without opening the file, which remains canonical and reviewable.

Registering the canvas as a `CustomTextEditorProvider` was rejected: it would become the default editor for model files and hide the YAML, forfeiting the schema-driven completion that motivated choosing YAML. Canvas edits reach the file as `WorkspaceEdit`s, so VS Code owns undo and dirty state.

### Targeted edits

Every canvas action becomes a set of targeted text splices computed from the YAML syntax tree, never a re-serialization of the document.

`Document.toString()` normalizes flow-collection padding across the whole file, so re-serializing would turn a one-property change into a whole-file diff. Splicing keeps the change minimal: renaming a type alters exactly the lines that name it. A block's extent is found by indentation rather than by node range, because a YAML node's own range can run past its block into whatever follows.

### Intents

The webview holds no model state. It posts a named intent, the extension host turns that into edits, and a fresh projection comes back, so nothing on the canvas can diverge from the file.

Deleting a node type also deletes the edge types that reference it: leaving the reference behind would produce a model that cannot resolve. Renaming a type first records its previous IRI, so the ontology can assert equivalence to the identity consumers already have.

## Views

A view names a subset of types plus an optional neighbourhood expansion, and layout nests under the view. One model can therefore carry an overview diagram beside several focused ones.

A single diagram of the whole model is unreadable past a few dozen types, and welding diagram scope to module boundaries would make people split modules for presentation reasons. Views drift as a model grows, so validation reports types that appear in no view.

## Rendering

The canvas is built on React Flow with ELK for automatic layout. Custom React nodes render an ERD box with one row per property, and per-row handles let an edge attach to the exact property it references.

React Flow is DOM-based and degrades past a few hundred nodes, which is acceptable precisely because [[architecture#Views]] caps how much any one diagram shows. Note that `elkjs` is EPL-2.0 while React Flow and `dagre` are MIT.

## Roadmap

v1 is a visual modeler: the full compiler pipeline plus a canvas that authors the model, generating Ladybug DDL, Neo4j constraints, SHACL shapes, and an OWL ontology.

The original plan deferred interactive editing to v2 and shipped a read-only canvas first. That was amended: building the compiler first would have left the tool unusable for its stated purpose until a second release, and the IR is exercised by every canvas action anyway, so real use validates the metamodel rather than tests alone.

### Still deferred

Migrations and the lockfile diff, the Memgraph target, and user-supplied template targets remain out of scope.

Nothing in the implementation assumes a lockfile exists. The IR serializer nevertheless orders keys stably, so introducing one later is a serialization call rather than a rework.

## Packages

Three packages: `core` holds the pipeline, `cli` wraps it for continuous integration, and `vscode` adds the webview and diagnostics.

`core` never imports `vscode`, enforced by an ESLint rule and by a test that scans the source. The intent translation used by the canvas lives in the extension package but imports no editor API, so the whole authoring surface is tested without a running VS Code.
