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

The canvas is a companion webview opened beside the YAML editor, in the manner of Markdown preview. The text editor stays primary, which preserves the schema-driven completion that motivated choosing YAML.

Registering the canvas as a `CustomTextEditorProvider` was rejected: it would become the default editor for model files and hide the YAML, forfeiting that tooling. Canvas edits apply as surgical `WorkspaceEdit`s through the `yaml` package's Document API so comments, key order, and formatting survive a round trip.

## Views

A view names a subset of types plus an optional neighbourhood expansion, and layout nests under the view. One model can therefore carry an overview diagram beside several focused ones.

A single diagram of the whole model is unreadable past a few dozen types, and welding diagram scope to module boundaries would make people split modules for presentation reasons. Views drift as a model grows, so validation reports types that appear in no view.

## Rendering

The canvas is built on React Flow with ELK for automatic layout. Custom React nodes render an ERD box with one row per property, and per-row handles let an edge attach to the exact property it references.

React Flow is DOM-based and degrades past a few hundred nodes, which is acceptable precisely because [[architecture#Views]] caps how much any one diagram shows. Note that `elkjs` is EPL-2.0 while React Flow and `dagre` are MIT.

## Roadmap

v1 proves the compiler pipeline end to end against a real database before expensive interactive UI is built on top of it: parse, IR, validate, emit, with a read-only auto-laid-out canvas.

Deferred to later releases: migrations and the lockfile diff, the SHACL and OWL targets, editable views and the layout sidecar, bidirectional canvas editing, the Memgraph target, and template targets. The metamodel is the least reversible decision in the project, so validating it against executing DDL is the highest-value first move. Every deferred item is cheaper once the IR is settled.
