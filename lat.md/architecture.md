# Architecture

lpg-modeler is a VS Code extension and CLI for authoring Labeled Property Graph schemas as text, viewing them as ERD-like diagrams, and generating database DDL, migrations, and RDF artifacts from a single model.

## Source of Truth

The canonical artifact is a hand-editable YAML model file holding semantics only. Diagram coordinates live in a separate sidecar so rearranging a diagram never dirties the semantic diff.

Layout is keyed by [[metamodel#Stable Element IDs]] rather than by type name, so renaming a type preserves its position on every diagram. Sidecar entries nest under a named view, not under the model as a whole — see [[architecture#Views]].

## Surface Syntax

Models are YAML validated by a JSON Schema the extension contributes through `contributes.jsonValidation`, so completion, hover, and structural errors come from VS Code's existing YAML tooling at no cost.

Owning no parser is a deliberate trade. The durable asset is the intermediate representation and the emitters that consume it; the surface syntax stays swappable, and a concise custom DSL with a real language server remains a later option rather than a prerequisite.

The schema is written against JSON Schema 2020-12 but keeps to constructs an older validator still resolves, so the file is portable without giving up the current dialect. It lives once in `core` and is copied into the extension for `contributes.jsonValidation`; a test asserts the two are identical, because an editor and a CLI that disagree about what a model may say is the one failure this arrangement invites. A model file is self-describing through [[metamodel#Format Version]], so it can be validated by anything, not only inside VS Code.

## Package Boundary

The repository is a monorepo of three packages: `core` holds parsing, the IR, validation, diffing, and every emitter; `cli` wraps core for continuous integration; `vscode` adds only webview and diagnostics plumbing.

`core` must never import `vscode`, enforced by lint. This keeps emitter tests runnable in plain Node with no editor harness, and it is what allows a pull request to be gated on schema validity.

## Modularity

Modularity means two separate things, and only one of them ships in v1: models compose across files, while emitters sit behind a registry that is internal for now.

Model composition is a metamodel feature and cannot be retrofitted once models exist in the wild, so it lands first — see [[metamodel#Composition]]. A public plugin API is deliberately deferred until three real emitters have shown where the seam actually falls; the [[emitters#Capability Matrix]] is what that API will eventually expose.

## Editing Surface

The canvas is a companion webview opened beside the YAML editor, in the manner of Markdown preview. It is the authoring surface: a user creates node types, edge types, and properties without opening the file, which remains canonical and reviewable.

Registering the canvas as a `CustomTextEditorProvider` was rejected: it would become the default editor for model files and hide the YAML, forfeiting the schema-driven completion that motivated choosing YAML. Canvas edits reach the file as `WorkspaceEdit`s, so VS Code owns undo and dirty state.

### Creating a Model

`LPG: New Model` asks for a prefix and a base IRI, writes the file, opens it, and opens the canvas beside it. The template lives in `core`, not in the extension.

Every other entry point needs a model file to already exist — the canvas, and every CLI verb — so without this the first step was to know the shape of a file nobody had shown you yet. The template carries stable ids and one seeded node type with a key, because a model that generates nothing on its first run reads as a broken tool rather than an empty one. The seed is named `Thing` rather than after the model, so that it reads as a placeholder to rename.

The file suffix is forced to `.lpg.yaml` whatever the save dialog returns. A model saved as plain `.yaml` gets no schema validation and no canvas, which looks like the extension failing rather than a naming mistake. Keeping the template in `core` is what lets a test resolve it, validate it, and generate all seven targets from it without an editor.

### Reaching a model

A command that needs a model file looks for one instead of refusing: the active editor, then a focused canvas, then the workspace, and when the workspace holds none, the scaffold flow.

`activeTextEditor` is undefined whenever a webview has focus, so `LPG: Generate Schema` invoked from the canvas — the one place a user is looking at a model when they want a schema from it — reported that no model was open, beside the diagram of the model that was. A canvas therefore answers for itself while it is the focused tab.

A workspace holding exactly one model needs no question; more than one is a quick pick over workspace-relative paths. A workspace holding none runs [[architecture#Editing Surface#Creating a Model]] and carries on with the file it wrote, so the first use of the command teaches the format rather than demanding it.

### Command failures

Every palette command runs its async body through a wrapper that catches and reports. A handler that discards its promise turns any failure into silence.

`registerCommand('lpg.newModel', () => void newModel())` was the original form: the editor never sees the rejection, so a failure anywhere in the flow presents as a palette entry that does nothing at all — indistinguishable from an extension that never activated, and the one symptom a user cannot report usefully. Returning the promise also lets VS Code treat the command as still running. The extension host entry is driven end to end in tests against a stub `vscode` module, which is what makes a silent handler a test failure rather than a support ticket.

### Targeted edits

Every canvas action becomes a set of targeted text splices computed from the YAML syntax tree, never a re-serialization of the document.

`Document.toString()` normalizes flow-collection padding across the whole file, so re-serializing would turn a one-property change into a whole-file diff. Splicing keeps the change minimal: renaming a type alters exactly the lines that name it. A block's extent is found by indentation rather than by node range, because a YAML node's own range can run past its block into whatever follows.

### Intents

The webview holds no model state. It posts a named intent, the extension host turns that into edits, and a fresh projection comes back, so nothing on the canvas can diverge from the file.

Deleting a node type also deletes the edge types that reference it: leaving the reference behind would produce a model that cannot resolve. Renaming a type first records its previous IRI, so the ontology can assert equivalence to the identity consumers already have.

The projection carries whatever the metamodel carries, so an addition there is incomplete until the wire types grow with it: a canvas that cannot show a constraint silently invites someone to author a model that contradicts it. [[metamodel#Cardinality]] is edited on the edge rather than in a panel, because it belongs to the relationship and not to either type.

### Inspector

Constraints are edited in a panel beside the canvas rather than on the diagram. A type box shows only a count, so a model with rules stays readable at a glance.

Bounds, patterns and [[metamodel#Named Constraints]] have no place on an ERD box without crowding out the properties, which are what the diagram is for. The panel is also what makes the closed assertion vocabulary pay off twice: every operand is a dropdown of the selected type's own properties and edges, so a constraint cannot be written against something that does not exist, and there is no expression to parse.

## Examples

The example models the documentation site offers for download live under `docs/`, and a test resolves and generates every one of them.

Keeping them inside the published site rather than in a separate folder means there is exactly one copy, so the file a reader downloads is the file the test checked. An example that stopped parsing would be a broken promise on the front page, and it is the kind of breakage that a release otherwise finds only after it ships.

## Views

A view names a subset of types plus an optional neighbourhood expansion, and layout nests under the view. One model can therefore carry an overview diagram beside several focused ones.

A single diagram of the whole model is unreadable past a few dozen types, and welding diagram scope to module boundaries would make people split modules for presentation reasons. Views drift as a model grows, so validation reports types that appear in no view.

## Rendering

The canvas is built on React Flow with ELK for automatic layout. Custom React nodes render an ERD box with one row per property, and per-row handles let an edge attach to the exact property it references.

React Flow is DOM-based and degrades past a few hundred nodes, which is acceptable precisely because [[architecture#Views]] caps how much any one diagram shows. Note that `elkjs` is EPL-2.0 while React Flow and `dagre` are MIT.

A property row shows its type with a `[]` suffix when it is a [[metamodel#Lists|list]] and the [[metamodel#Enums|enum]] it is limited to; an open type carries a badge. [[metamodel#Cardinality]] rides in the edge label rather than as crow's-foot markers at each end: React Flow's default edge carries one label, and endpoint markers would need a custom edge whose geometry cannot be checked without looking at it. A number that is certainly right beats a marker that might be drawn wrong.

## Roadmap

v1 is a visual modeler: the full compiler pipeline plus a canvas that authors the model, generating Ladybug DDL, Neo4j constraints, SHACL shapes, and an OWL ontology.

The original plan deferred interactive editing to v2 and shipped a read-only canvas first. That was amended: building the compiler first would have left the tool unusable for its stated purpose until a second release, and the IR is exercised by every canvas action anyway, so real use validates the metamodel rather than tests alone.

### Still deferred

Migrations and the lockfile diff, the Memgraph target, and user-supplied template targets remain out of scope.

Nothing in the implementation assumes a lockfile exists. The IR serializer nevertheless orders keys stably, so introducing one later is a serialization call rather than a rework.

## Packages

Three packages: `core` holds the pipeline, `cli` wraps it for continuous integration, and `vscode` adds the webview and diagnostics.

`core` never imports `vscode`, enforced by an ESLint rule and by a test that scans the source. The intent translation used by the canvas lives in the extension package but imports no editor API, so the whole authoring surface is tested without a running VS Code.

## Distribution

The extension is published to the Visual Studio Marketplace as a self-contained bundle, and the documentation site is published to GitHub Pages from `docs/`.

A published `.vsix` carries no `node_modules`, so a bare `require('@lpg/core')` would not resolve inside it. The extension host entry is therefore bundled by esbuild over the `tsc` output, inlining `core` and leaving only `vscode` external — which is what makes `vsce package --no-dependencies` correct rather than a shortcut.

The CLI ships to npm the same way, as a single self-contained package, so `core` is never published at all and is marked private to keep it that way. Bundling also settles a naming problem rather than working around it: the `@lpg` scope is not ours, and a published package carrying a bare workspace dependency would not install. The published names differ by necessity — the extension owns `lpg-modeler` as its Marketplace id, so the CLI is `lpg-modeler-cli` — and `npx lpg` is deliberately not advertised, because an unrelated package already holds that name on npm.

### Documentation site

`docs/` is a hand-written static site that GitHub Pages serves verbatim from the branch folder. It is the public face of the material this knowledge graph holds, aimed at someone deciding whether to install rather than at someone changing the code.

Diagrams are authored as SVG and exported to PNG beside them. Both formats are kept because the Marketplace rejects SVG in a README, while the site prefers it. Neither is generated at build time: the site has no build step at all, so a broken toolchain can never take the documentation down.

The site fetches nothing from a third party. Fonts are self-hosted rather than loaded from a content delivery network, because a request to Google Fonts sends every visitor's IP address to Google, which LG München I held unlawful without consent (20.01.2022, 3 O 17493/20) and which triggered a wave of German warning letters. Both families are SIL Open Font Licence 1.1, so self-hosting is permitted. A test asserts that no page fetches a cross-origin subresource, because the privacy statement is only true while it is true, and a single convenient `<link>` would quietly make it false.

### Legal pages

The site carries a German Impressum, Datenschutzerklärung and Nutzungsbedingungen, linked from every footer, because the operator is a private individual resident in Germany.

An Impressum is arguably not required for a free, non-commercial project — § 5 DDG binds *geschäftsmäßige* digital services — but the term is read broadly, and the cost of publishing one is far below the cost of being wrong. The pages describe what the site actually does rather than boilerplate: they name GitHub as the host and the United States as a processing location, disclose that the contact address is a Gmail account, and state that no cookie is set. A test checks that each is reachable from every page and that the statutes cited are the ones in force, since the TMG was replaced by the DDG in 2024 and the EU online dispute platform closed in 2025.

### Marketplace page

The Marketplace page renders `packages/vscode/README.md`, which is a separate document from the repository README rather than a copy of it.

The two have different readers. The repository README explains the monorepo to someone about to change it; the Marketplace README sells the extension to someone deciding whether to install it, and so leads with the problem, the generated artifacts, and the capability reporting. Images there use absolute `raw.githubusercontent.com` URLs, because relative paths do not resolve on the Marketplace.
