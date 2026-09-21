# Architecture

lpg-modeler is a VS Code extension and CLI for authoring Labeled Property Graph schemas as text, viewing them as ERD-like diagrams, and generating database DDL, migrations, and RDF artifacts from a single model.

## Source of Truth

The canonical artifact is a hand-editable YAML model file holding semantics only. Diagram coordinates live in a separate sidecar so rearranging a diagram never dirties the semantic diff.

Layout is keyed by [[metamodel#Stable Element IDs]] rather than by type name, so renaming a type preserves its position on every diagram. A file that carries no identifiers yet is read with derived ones, which follow the name: its positions survive a reload but not a rename, until the tool writes the identifiers in. Sidecar entries nest under a named view, not under the model as a whole — see [[architecture#Views]].

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

The file suffix is forced to `.lpg.yaml` whatever the save dialog returns. A model saved as plain `.yaml` gets no schema validation and no canvas, which looks like the extension failing rather than a naming mistake. Keeping the template in `core` is what lets a test resolve it, validate it, and generate all eight targets from it without an editor.

### Reaching a model

A command that needs a model file looks for one instead of refusing: the active editor, then a focused canvas, then the workspace, and when the workspace holds none, the scaffold flow.

`activeTextEditor` is undefined whenever a webview has focus, so `LPG: Generate Schema` invoked from the canvas — the one place a user is looking at a model when they want a schema from it — reported that no model was open, beside the diagram of the model that was. A canvas therefore answers for itself while it is the focused tab.

A workspace holding exactly one model needs no question; more than one is a quick pick over workspace-relative paths. A workspace holding none runs [[architecture#Editing Surface#Creating a Model]] and carries on with the file it wrote, so the first use of the command teaches the format rather than demanding it.

### Command failures

Every palette command runs its async body through a wrapper that catches and reports. A handler that discards its promise turns any failure into silence.

`registerCommand('lpg.newModel', () => void newModel())` was the original form: the editor never sees the rejection, so a failure anywhere in the flow presents as a palette entry that does nothing at all — indistinguishable from an extension that never activated, and the one symptom a user cannot report usefully. Returning the promise also lets VS Code treat the command as still running. The extension host entry is driven end to end in tests against a stub `vscode` module, which is what makes a silent handler a test failure rather than a support ticket. The stub really applies a `WorkspaceEdit` to the file: one that acknowledged the edit without writing would let every canvas flow pass while the model never changed, which is the one thing those flows do.

### Targeted edits

Every canvas action becomes a set of targeted text splices computed from the YAML syntax tree, never a re-serialization of the document.

`Document.toString()` normalizes flow-collection padding across the whole file, so re-serializing would turn a one-property change into a whole-file diff. Splicing keeps the change minimal: renaming a type alters exactly the lines that name it. A block's extent is found by indentation rather than by node range, because a YAML node's own range can run past its block into whatever follows.

### Intents

The webview holds no model state. It posts a named intent, the extension host turns that into edits, and a fresh projection comes back, so nothing on the canvas can diverge from the file.

Deleting a node type also deletes the edge types that reference it: leaving the reference behind would produce a model that cannot resolve. Renaming a type first records its previous IRI, so the ontology can assert equivalence to the identity consumers already have.

The projection carries whatever the metamodel carries, so an addition there is incomplete until the wire types grow with it: a canvas that cannot show a constraint silently invites someone to author a model that contradicts it. [[metamodel#Cardinality]] is edited on the selected edge rather than on either box, because it belongs to the relationship and not to either type.

An intent that creates, renames or deletes a node type also carries that through the views sidecar — see [[architecture#Views#Keeping a view current]]. A failing intent is reported rather than swallowed, for the same reason a palette command is: see [[architecture#Editing Surface#Command failures]].

The host handles one message at a time. One canvas gesture can post two intents — the drop that creates a type and the edge reaching it — and both would otherwise be spliced against the same original text, so the second would land at offsets the first had already moved. Serializing at the host rather than batching in the webview keeps the [[architecture#Editing Surface#Targeted edits|splices]] independent of how a gesture was composed.

### Asking

Every question the canvas asks — a name, a confirmation, a pair of endpoints — is rendered in the document. The webview never calls `window.prompt`, `window.confirm` or `window.alert`.

A VS Code webview is a sandboxed iframe in which those three return immediately without showing anything. An action routed through one therefore does nothing at all, and does it silently: `+ node type` read as a dead button, and a type's name read as uneditable, because the dialog that would have collected the name never appeared. That failure is invisible to types and to any test that does not run a browser, so a test asserts instead that no webview source reaches for them. Asking in the document also buys what a native prompt cannot express: an endpoint is a dropdown of types that exist rather than free text, and creating a type and the edge that reaches it is one question rather than two.

### Inspector

The panel beside the canvas holds what a type is — its name, its parent, its [[metamodel#Type Hierarchy#Mixins|mixins]], its endpoints and [[metamodel#Cardinality]] — together with its constraints. A box shows only a constraint count, so a model with rules stays readable.

Bounds, patterns and [[metamodel#Named Constraints]] have no place on an ERD box without crowding out the properties, which are what the diagram is for. The panel is also what makes the closed assertion vocabulary pay off twice: every operand is a dropdown of the selected type's own properties and edges, so a constraint cannot be written against something that does not exist, and there is no expression to parse. Identity fields commit on Enter or on blur rather than per keystroke, which would rewrite the model file on every letter typed.

A mixin is edited here too, selected from a chip on any type that applies it or from the panel's own list, and applied through a checkbox per mixin rather than a parent dropdown — the metamodel's distinction, made visible. The list is what the panel shows when nothing is selected, because a mixin no type applies has no box to be reached from.

The panel heading is the same `<h2>` for a node, an edge and a mixin, so its color carries the only cue for which kind is selected: blue for a node type, orange for an edge type, purple for a mixin, matching no other accent used on the canvas.

## Examples

The example models the documentation site offers for download live under `docs/`, and a test resolves and generates every one of them.

Keeping them inside the published site rather than in a separate folder means there is exactly one copy, so the file a reader downloads is the file the test checked. An example that stopped parsing would be a broken promise on the front page, and it is the kind of breakage that a release otherwise finds only after it ships.

One of them, `fleet.lpg.yaml`, carries the [[metamodel#Type Hierarchy|hierarchy]] and [[metamodel#Type Hierarchy#Mixins|mixins]] the front page explains, and is the model in every screenshot — so the picture a reader is persuaded by and the file they download are the same file. See [[architecture#Distribution#Documentation site#Screenshots]].

## Views

A view names a subset of types plus an optional neighbourhood expansion, and layout nests under the view. One model can therefore carry an overview diagram beside several focused ones.

A single diagram of the whole model is unreadable past a few dozen types, and welding diagram scope to module boundaries would make people split modules for presentation reasons. Views drift as a model grows, so validation reports types that appear in no view.

### Keeping a view current

A view names its members, so the host carries a canvas-driven creation, rename or deletion into the sidecar as well as into the model file.

Without it, a type created while a named view is on screen lands in the file and not on the diagram in front of the user, which is indistinguishable from a button that did nothing. A rename would likewise drop a type out of the diagram it was drawn on, because a view holds names while [[architecture#Source of Truth|layout]] holds ids. A wildcard view is left alone: `*` already covers whatever the model gains, and naming the new type as well would be a lie the moment it is renamed.

## Rendering

The canvas is built on React Flow with ELK for automatic layout. Custom React nodes render an ERD box with one row per property, and per-row handles let an edge attach to the exact property it references.

React Flow is DOM-based and degrades past a few hundred nodes, which is acceptable precisely because [[architecture#Views]] caps how much any one diagram shows. Note that `elkjs` is EPL-2.0 while React Flow and `dagre` are MIT.

ELK lays out a diagram that has no saved positions at all; once boxes are placed, a newly created type takes a free column beside them instead. A relayout would move every box the user had arranged, and the point of creating a type is to see the new one, so the canvas re-frames itself and persists the position it chose rather than waiting for a drag. A connection dropped on empty canvas means "and then there is one of these": it offers to create the type as well as the edge.

The canvas may zoom out far past React Flow's own floor of 0.5. A laid-out diagram of a few dozen types spans several thousand pixels, so framing it asks for roughly 0.15; clamped to 0.5 the canvas lands in the middle of a diagram it cannot fit, showing an empty patch of grid and reading as a model that failed to load.

### Inherited edges

An edge declared on an ancestor is drawn on the ancestor's box alone, and listed on each descendant in the inspector instead.

The diagram says where a thing is written: drawing `OWNS` again from every subtype of `Party` would suggest four declarations where the model has one, and on a hierarchy of any depth it multiplies the lines faster than it adds information. The reading a user actually needs — what can this type relate to — is a list rather than a picture, so the panel gives it, marked with the type each edge is declared on. What the [[emitters#Ladybug Target|targets]] do with the same fact is expansion, which is theirs to do and not the diagram's.

A property row shows its type with a `[]` suffix when it is a [[metamodel#Lists|list]] and the [[metamodel#Enums|enum]] it is limited to; an open type carries a badge. An inherited property names its source with `↑` and a [[metamodel#Type Hierarchy#Mixins|mixin's]] with `◇`, because a supertype and a bag of properties are not the same claim about the type. [[metamodel#Cardinality]] rides in the edge label rather than as crow's-foot markers at each end: React Flow's default edge carries one label, and endpoint markers would need a custom edge whose geometry cannot be checked without looking at it. A number that is certainly right beats a marker that might be drawn wrong.

### Exporting the diagram

The toolbar's PNG and SVG buttons rasterize `.react-flow__viewport` with `html-to-image` — the transformed layer holding boxes and edges, not the dotted `<Background>` or the zoom `<Controls>` beside it, so the export reads as the diagram alone.

The webview has no filesystem access, so it computes a tight crop with `getNodesBounds` and `getViewportForBounds` (the same utilities `fitView` uses), rasterizes at that framing, and sends the host a data URL over the existing `postMessage` channel. The host only asks where to save it and writes the bytes: a PNG data URL is base64, but `toSvg` percent-encodes the markup instead, so the two formats decode differently on the way to disk.

`toSvg` wraps the captured HTML in a `<foreignObject>` rather than emitting pure vector paths — a real limitation of rasterizing a DOM-based canvas, and the reason [[architecture#Rendering|React Flow itself]] was chosen despite it. The file opens correctly in a browser or image viewer; it is not the kind of SVG a vector editor decomposes into shapes.

Both formats depend on the same theme variables the rest of the canvas uses. React Flow's own edge-label and edge-stroke defaults track the OS light/dark preference rather than VS Code's theme, which goes unreadable exactly when those two disagree (a dark VS Code theme on a light-mode OS renders label text in React Flow's light-mode black); `--xy-edge-label-color`, `--xy-edge-label-bg-color`, `--xy-edge-stroke` and `--xy-edge-stroke-selected` are overridden in `styles.css` to the same `--fg`/`--bg`/`--line` the rest of the panel uses, so both the live canvas and an export are legible under whatever theme produced them.

The toolbar's "light" checkbox asks for a print-safe capture instead: white background, dark ink, no color-only cues. It adds an `.export-light` class to `.react-flow__viewport` for the duration of the capture and removes it once the data URL is sent, rather than switching the live canvas's theme — the class pins `--bg`, `--fg`, `--line`, `--muted`, `--accent` and the two raw editor-background names the box and title bar read directly, to fixed values chosen for contrast after grayscale conversion rather than for hue (`--accent` is a dark blue, not a bright one, so it doesn't wash out to the same lightness as the background on a black-and-white printout). Everything else the diagram draws already routes through those five variables, so nothing else needs to change for the export to come out print-safe.

#### Entry points outside the canvas

`lpg.exportPng` and `lpg.exportSvg` reach the same capture from the command palette and from a title-bar button, shown on a model file and on the canvas tab.

The toolbar buttons only exist once the canvas is open, which makes an export something you can only ask for after finding the panel that draws it. The commands take the model the same way every other command does — see [[architecture#Editing Surface#Reaching a model]] — and open the canvas when it is closed, so "export this model as a PNG" is one gesture rather than three.

Only the webview can rasterize, so the host relays an `exportRequest` and the bytes come back over the existing `export` message. A request that arrives before the projection is laid out is held until there are boxes, plus a tick for React Flow to measure them: capturing immediately would write an empty picture, which is worse than a slow one. The panel is revealed without taking focus, because a command that writes a picture of a diagram nobody can see is hard to trust, and because a hidden webview is not a dependable thing to screenshot.

The `light` checkbox stays the single place that preference lives — a command exports print-safe only when the canvas is set to. Duplicating it as a setting or a second pair of commands would give the same question two answers that can disagree.

## Roadmap

v1 is a visual modeler: the full compiler pipeline plus a canvas that authors the model, generating Ladybug DDL, Neo4j constraints, SHACL shapes, and an OWL ontology. It reads the RDF artifacts and the Ladybug DDL back as well — see [[importers]].

The original plan deferred interactive editing to v2 and shipped a read-only canvas first. That was amended: building the compiler first would have left the tool unusable for its stated purpose until a second release, and the IR is exercised by every canvas action anyway, so real use validates the metamodel rather than tests alone.

### Still deferred

User-supplied template targets remain out of scope.

The Memgraph target was deferred with them, because nothing could check its output. Measuring Memgraph Community in a container removed that reason, so it ships as code — see [[emitters#Memgraph Target]].

Migrations and the lockfile diff were deferred from v1 and have since landed — see [[emitters#Migrations]]. They were pulled forward once their prerequisites existed: stable element ids, a stable serializer, and three database targets to migrate. A lockfile is still optional: nothing but `lock`, `diff` and `migrate` reads one, and `emit` never does.

## Packages

Three packages: `core` holds the pipeline, `cli` wraps it for continuous integration, and `vscode` adds the webview and diagnostics.

`core` never imports `vscode`, enforced by an ESLint rule and by a test that scans the source. The intent translation used by the canvas lives in the extension package but imports no editor API, so the whole authoring surface is tested without a running VS Code.

## Distribution

The extension is published to the Visual Studio Marketplace as a self-contained bundle, and the documentation site is published to GitHub Pages from `docs/`.

A published `.vsix` carries no `node_modules`, so a bare `require('@lpg/core')` would not resolve inside it. The extension host entry is therefore bundled by esbuild over the `tsc` output, inlining `core` and leaving only `vscode` external — which is what makes `vsce package --no-dependencies` correct rather than a shortcut.

The CLI ships to npm the same way, as a single self-contained package, so `core` is never published at all and is marked private to keep it that way. Bundling also settles a naming problem rather than working around it: the `@lpg` scope is not ours, and a published package carrying a bare workspace dependency would not install. The published names differ by necessity — the extension owns `lpg-modeler` as its Marketplace id, so the CLI is `lpg-modeler-cli` — and `npx lpg` is deliberately not advertised, because an unrelated package already holds that name on npm.

One dependency is deliberately left out of that bundle. Importing a LadybugDB database needs `@ladybugdb/core`, which carries a native binding per platform that a bundle cannot inline. It is an optional peer dependency rather than a dependency, because the runtime and its platform binary come to roughly 38 MB, and every CI run that only checks and emits would otherwise download them. The command line loads it only when a database is imported, looking beside itself and then in the working directory, and says how to install it when it finds neither — see [[importers#Reading a LadybugDB Database]].

The Bolt driver, `neo4j-driver`, is kept out the same way, for size rather than a native binding: only reading a Memgraph or Neo4j instance and `lpg apply` use it. A Redis client is the third such peer, for FalkorDB, and follows the same rule: loaded beside the command line and then from the working directory, with an install hint naming the version when it is found in neither. `apply` is the one command that writes to a database. It takes a generated script rather than a model, so what runs is exactly what was reviewed; it refuses a script for another target or one marked destructive, runs each statement in its own transaction, and stops at the first failure saying what had already been applied. `emit` and `migrate` still never connect.

Both Bolt engines are wired to it, and which one is at a URI is asked of the instance rather than assumed — see [[importers#Telling Two Bolt Engines Apart]]. A script may also be refused for a reason the statements themselves cannot show: an Enterprise-only constraint against a Community instance fails at the first such statement, and the edition is readable before any of them runs, so the whole class is named up front and nothing is applied. A header may name the engine after the target, as `ladybug (LadybugDB)` does, so the check reads a parenthetical rather than rejecting the line.

### Applying to an embedded database

A LadybugDB database is named by `--database <path>` rather than by a URI, because it is embedded: there is no server to connect to, nothing to authenticate to, and no connection that could be refused.

Overloading `--uri` with a `file://` form would make the two look alike where they are not. The path takes the shapes an [[importers#Reading a LadybugDB Database|import]] already recognises as a database — a directory, or a `.lbdb`, `.lbug` or `.kuzu` file — so one idea of what a database is serves both commands.

This is also the only command that opens one for writing. Importing opens read-only and says so, which is what makes it safe against a database in use; read-only is therefore a per-command decision rather than a constant, while the bounded buffer pool and maximum size stay, since they exist to stop the defaults reserving 8 TiB of address space per open.

A path holding no database is created rather than refused, because a schema script against a fresh database is the common case, and the run says which path it made. `--no-create` inverts that for a deployment where applying to the wrong path is the greater risk. Creating a database discards nothing, so it sits outside the [[emitters#Migrations#Destructive Gate|destructive gate]] rather than inside it.

One statement at a time is kept here too. LadybugDB auto-commits its DDL, so it is not the correctness requirement it is on Neo4j; it is what makes the partial-application report true, which is the whole reason the command exists rather than a shell loop. What the engine refuses — no column retype, no dropping a primary key column, no dropping a node table a rel table still references — reaches the user as the engine words it, positioned. See [[emitters#Ladybug Target#Measured ALTER Support]].

The runtime is checked before the path, because without it no path could be opened and a missing-file message would send the user after the wrong problem.

### Documentation site

`docs/` is a hand-written static site that GitHub Pages serves verbatim from the branch folder. It is the public face of the material this knowledge graph holds, aimed at someone deciding whether to install rather than at someone changing the code.

Diagrams are authored as SVG and exported to PNG beside them. Both formats are kept because the Marketplace rejects SVG in a README, while the site prefers it. Neither is generated at build time: the site has no build step at all, so a broken toolchain can never take the documentation down.

The site fetches nothing from a third party. Fonts are self-hosted rather than loaded from a content delivery network, because a request to Google Fonts sends every visitor's IP address to Google, which LG München I held unlawful without consent (20.01.2022, 3 O 17493/20) and which triggered a wave of German warning letters. Both families are SIL Open Font Licence 1.1, so self-hosting is permitted. A test asserts that no page fetches a cross-origin subresource, because the privacy statement is only true while it is true, and a single convenient `<link>` would quietly make it false.

#### Screenshots

The site shows the canvas itself under `docs/assets/screenshots/`, not only the diagrams drawn for it, because the reader of a modelling tool's front page is deciding whether the editor is worth opening.

They are captures of the real webview bundle rendering a projection the extension host produced, rather than a mock-up: a drawn interface is a promise the product has to keep afterwards, and the details a screenshot is there to carry — the `↑` against `◇` on a property row, the mixin checkboxes, the edge listed on a descendant it is not drawn on — are exactly the ones a mock-up gets subtly wrong.

The model in every screenshot is a published [[architecture#Examples|example]], so the file a reader downloads is the one they were shown, and a change that broke it fails the examples test before it reaches the page. A test asserts that every screenshot a page references exists and that the model they are captured from is still published, since a missing image degrades silently to alt text. Like the diagrams, they are committed rather than generated at build time — the site still has no build step.

#### Blog

`article/` is rendered into `docs/blog/` by a generator that is run by hand and whose output is committed, so the published site stays a folder of static files rather than a build.

That is the same arrangement the diagrams already use: `npm run build:blog` is a tool for the author, not a step Pages depends on. A broken toolchain can therefore stop the next post from being rendered, but it cannot take the published ones down.

`article/posts.json` is an allowlist rather than a directory listing. A file reaches the site only by being named there, which is what keeps the folder's own README and the platform-specific companions — a LinkedIn body sized for the feed — out of a section meant for long reads. It also carries the date, since the git history of a file records when it was committed rather than when it was published.

A test renders the articles and compares the result to what is committed, so an article edited without regenerating fails the build instead of publishing the previous version indefinitely. The same test asserts that every page of the site links the section, because a section nothing links to is a section nobody reads.

A model an article is [[architecture#Distribution#Announcement writing|built around]] lives in `article/`, which Pages does not publish, so the generator copies it to `docs/blog/models/` and rewrites the link. The copy is derived, and a test compares it byte for byte against its source — the same rule the upload sets are held to, enforced rather than remembered.

Markup is deliberately thin. Alt text in these articles is written as a caption, so it becomes a `<figcaption>` and the `alt` is emptied rather than read out twice; comment lines in a fenced block pick up the muted and amber classes the hand-written pages already use, and a comment naming a loss an emitter reported is ambered like the ones quoted on the front page. Nothing finer is attempted, because distinguishing a comment from a `#` inside a string needs a grammar per language, and a highlighter that is wrong is worse than none.

### Legal pages

The site carries a German Impressum, Datenschutzerklärung and Nutzungsbedingungen, linked from every footer, because the operator is a private individual resident in Germany.

An Impressum is arguably not required for a free, non-commercial project — § 5 DDG binds *geschäftsmäßige* digital services — but the term is read broadly, and the cost of publishing one is far below the cost of being wrong. The pages describe what the site actually does rather than boilerplate: they name GitHub as the host and the United States as a processing location, disclose that the contact address is a Gmail account, and state that no cookie is set. A test checks that each is reachable from every page and that the statutes cited are the ones in force, since the TMG was replaced by the DDG in 2024 and the EU online dispute platform closed in 2025.

### Marketplace page

The Marketplace page renders `packages/vscode/README.md`, which is a separate document from the repository README rather than a copy of it.

The two have different readers. The repository README explains the monorepo to someone about to change it; the Marketplace README sells the extension to someone deciding whether to install it, and so leads with the problem, the generated artifacts, and the capability reporting. Images there use absolute `raw.githubusercontent.com` URLs, because relative paths do not resolve on the Marketplace.

### Announcement writing

Long-form posts about the tool live in `article/`, referencing the site's own diagrams and screenshots by relative path rather than carrying copies.

Keeping them in the repository is what makes a claim checkable: several are version-pinned measurements — LadybugDB 0.19.1 rejecting `NOT NULL`, Neo4j existence constraints being Enterprise-only, the number of targets — and a post held elsewhere would keep asserting them after [[emitters#Capability Matrix]] had moved. One copy of each image also means an article cannot show a [[architecture#Distribution#Documentation site#Screenshots|screenshot]] the site has already replaced. The folder's README carries the absolute `raw.githubusercontent.com` forms, for the same reason the [[architecture#Distribution#Marketplace page]] needs them: a renderer outside the repository does not resolve a relative path. The site's own [[architecture#Distribution#Documentation site#Blog|blog]] resolves them a third way, by rewriting each one to the single copy under `docs/assets/` as it renders.

A post whose argument is carried by a worked model keeps that model in `article/` beside it rather than in `docs/examples/`. The examples directory is a curriculum — each file teaches one feature and a test resolves and generates all of them — while an article's model is sized for the argument instead, and nothing but the post reads it. `agent-trust.lpg.yaml`, `assortment.lpg.yaml` and `agent-commerce.lpg.yaml` are the three, and all are held to a stricter rule than prose: every excerpt quoted in the post is pasted from a real `lpg emit` run, and every count the post states is countable from the model, so a change to any emitter is visible as a diff rather than as a quietly stale number.

A publishing platform that takes uploads rather than URLs needs the files themselves, so each article also has an `article/<slug>-images/` folder of copies, numbered in the order the post uses them. These are an export, not a source: the markdown still references `../docs/assets/`, so a regenerated diagram reaches the article but leaves the upload set behind until it is re-copied.

A long read also gets a feed-sized companion — `article/linkedin-<slug>.md` for LinkedIn — carrying the post body to paste, its first comment, and its hashtags. It compresses the long read rather than restating it: every claim in it is one the long read already makes, so a version-pinned measurement that moves gets corrected in one place. The body is stored between rules and free of markdown, because the feed renders none, and the links live in the first comment rather than the post.
