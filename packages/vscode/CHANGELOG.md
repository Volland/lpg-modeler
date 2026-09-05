# Changelog

All notable changes to LPG Modeler are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] — 2026-09-05

### Fixed

- **A model you wrote by hand now shows up on the canvas.** Opening the canvas on a model
  with no layout file beside it drew an empty grid. The canvas could not zoom out far
  enough to frame a diagram it had just laid out, so it sat in the middle of one, showing
  a couple of boxes out of thirty and empty grid everywhere else.

- **The canvas keeps the layout it works out for you.** Positions it chose were saved
  against identifiers that changed on the next read, so the arrangement was lost every
  time the diagram reloaded, and the layout file filled up with dead entries. It also
  means the first change you make to a model no longer scatters the boxes you just moved.

- **Valid types are no longer marked broken in the editor.** `INT64[][]`, `NUMERIC(9,2)`
  and a composite with a size suffix such as `STRUCT(a INT64)[3]` all worked but were
  underlined as errors.

- **A typo in a type name gives a readable message.** It names the twenty-one types and
  shows the alias rule by example, instead of listing all sixty accepted spellings.

## [0.6.0] — 2026-09-05

### Added

- **Composite property types: `STRUCT`, `MAP`, `UNION` and fixed-size arrays.** Written the way
  LadybugDB writes them — `STRUCT(lat DOUBLE, lon DOUBLE)`, `MAP(STRING, STRING)`,
  `UNION(num DOUBLE, text STRING)`, `FLOAT[128]` — and they nest, so
  `STRUCT(at TIMESTAMP, v DOUBLE[])[]` is a list of structs. Quote the type in YAML, since a
  comma would otherwise end the flow mapping.

- **Completion and validation know about them.** The contributed JSON Schema admits the
  composite forms, so a valid model is no longer marked broken in the editor, and a composite
  property on the canvas shows its whole type rather than a fallback.

- **The ladybug target stores them; the other six say what they lose.** Only LadybugDB has
  these types. Generating to GQL, PG-Schema, LinkML, Neo4j, SHACL or OWL now reports one
  warning per composite property and keeps whatever that target has a place for — a
  `FLOAT[128]` becomes a plain list and loses only its size.

- **A composite cannot be a key, reference an enum, or carry value bounds.** Each of those is
  defined on a single scalar value. You get a diagnostic naming the type as you wrote it.

## [0.5.0] — 2026-09-05

### Added

- **Inheritance and mixins on the canvas.** A type's box shows what it extends and a chip per
  mixin it applies, and marks each property with where it came from: `↑Party` for a supertype,
  `◇Timestamped` for a mixin. Both already generated into every target — now you can see and
  edit them without opening the file.

- **Author a mixin without leaving the diagram.** `+ mixin` declares one, a checkbox applies it
  to the selected type, and the mixin's own panel edits its properties — the change reaches
  every type applying it. Renaming carries into every application; deleting removes it from
  them.

- **The inspector edits what a type is.** Name, parent and the abstract flag for a node type;
  name, both endpoints, multiplicity and properties for an edge. An `Edges` section lists every
  edge the type takes part in, including ones declared on an ancestor.

- **`+ edge type`, and drawing outwards to a new type.** Add an edge from the toolbar with both
  endpoints as dropdowns, or drop a connection on empty canvas to create the target type and
  the edge in one step.

### Fixed

- **Canvas buttons that did nothing now work.** `+ node type`, renaming a type, deleting one and
  editing an edge's multiplicity all went through browser dialogs that a VS Code webview
  discards without showing anything, so each action silently did nothing. They are now dialogs
  in the panel itself.

- **A type you create appears on the diagram.** A view naming its members used to swallow the
  new type, and a new box now takes a free space beside the others instead of rearranging the
  diagram you had laid out.

## [0.4.0] — 2026-09-01

### Added

- **Rich property types.** Alongside the original eight, a property may now be an integer of a
  declared width (`int8`, `int16`, `int32`, `int128`) or an unsigned one, a `float32`, a
  `decimal` with an optional precision and scale (`"DECIMAL(18,3)"`), a `duration`, a `blob` or
  a `zoneddatetime` — twenty-one in all, each also spelled the GQL or LadybugDB way. All of them
  are native LadybugDB column types, so generating for that target loses nothing. The canvas
  dropdown and the schema completion in the YAML editor both offer the full set.

### Changed

- **`ZONED_DATETIME` now means a timestamp with an offset**, distinct from `TIMESTAMP`, and
  generates LadybugDB's `TIMESTAMP_TZ`. Previously the two were one type that emitted a naive
  column while calling itself zoned.
- **`json` generates a `JSON` column** for LadybugDB rather than a `STRING`, and is no longer
  reported as a downgrade there.

## [0.3.1] — 2026-09-01

### Fixed

- **`LPG: Generate Schema` and `LPG: Open Canvas` no longer dead-end on "Open a .lpg.yaml
  model file first".** They look for a model: the active editor, the focused canvas, or the
  workspace — and if there is none, they create one first and carry on. Running Generate
  Schema from the canvas used to report that no model was open, beside the diagram of the
  model that was.

## [0.3.0] — 2026-08-31

### Added

- **`LPG: New Model`** — creates a model file, opens it, and opens the canvas on it. Asks
  only for a namespace prefix and a base IRI. Works with nothing open, so getting started no
  longer means knowing the shape of a model file first.

## [0.2.0] — 2026-08-30

### Added

- **Three standards targets.** `gql` (GQL graph types, ISO/IEC 39075), `pgschema` (PG-Schema)
  and `linkml` — seven generators in total from one model.
- **Endpoint bounds.** `cardinality: { to: "2" }` says a child has exactly two parents, which
  the four named multiplicities could not express. The named forms still work unchanged.
- **Constraints.** Bounds and patterns on values (`min`, `max`, `pattern`, `minLength`,
  `maxLength`); named assertions across properties (`lessThan`, `atLeastOne`, a qualified
  `count` over an edge); and a raw SHACL escape hatch for the long tail.
- **An inspector panel** beside the canvas for editing all of it, with a constraint builder
  whose operands are dropdowns of the selected type's own properties.
- **Lists, enums and open types**, plus a `lpg:` format version, a `prefixes:` map, and the
  GQL spelling of every scalar type accepted alongside the original.
- **Downloadable examples** on the documentation site.

### Changed

- The model JSON Schema is now JSON Schema 2020-12.
- Constraint downgrades are reported at `info` rather than `warning`, so they do not bury
  the downgrades that are genuinely surprising.

### Fixed

- A trailing separator in generated LadybugDB DDL, where a downgrade comment left a comma
  before the closing parenthesis.

## [0.1.0] — 2026-08-29

First release. A visual modeler: the full compiler pipeline plus a canvas that authors the
model.

### Added

- **Model format.** A Labeled Property Graph core extended with an abstract label hierarchy,
  mixins, first-class identity, and stable element identifiers. Models compose across files
  under a local alias; imports are sealed, and the diamond case resolves by IRI identity rather
  than by file path.
- **Schema-driven YAML editing.** The model format ships as a JSON Schema contributed through
  `contributes.jsonValidation`, so completion, hover and structural errors come from VS Code's
  existing YAML tooling.
- **Canvas.** A companion webview beside the model file, built on React Flow with ELK for
  automatic layout. Create node types, add and rename properties, draw edges, set an abstract
  parent, and choose a key — each becoming a targeted text splice applied as a `WorkspaceEdit`,
  so VS Code owns undo and dirty state.
- **Views.** A view names a subset of types plus an optional neighbourhood expansion. Layout
  nests under the view and is keyed by stable element id, so renaming a type preserves its
  position on every diagram. Validation reports types that appear in no view.
- **Four generation targets.** LadybugDB DDL, Neo4j constraints and indexes, SHACL node shapes,
  and an OWL ontology restricted to the safe assertional subset.
- **Capability matrix.** Every target declares what it can express. Each downgrade is reported
  as an editor diagnostic with a configurable severity, and as a comment at the lossy site in
  the generated artifact.
- **Gradual reification for RDF.** An edge with no properties becomes a plain object property;
  an edge that carries properties becomes an n-ary relation class plus a shortcut, with its
  SHACL shape targeting that class.
- **Neo4j edition awareness.** Existence and node key constraints require Enterprise, so under
  a Community configuration they are reported as downgrades and emitted as comments rather than
  silently dropped. Controlled by `lpg.targets.neo4j.edition`.
- **CLI.** `lpg check`, `lpg emit`, `lpg ids` and `lpg targets`, running the same pipeline with
  no editor present so a pull request can be gated on schema validity.
- **Commands.** `LPG: Open Canvas` and `LPG: Generate Schema`.

### Verified

- Ladybug DDL is executed against an in-process LadybugDB 0.19.1 instance, and the declared
  constraints are asserted to actually reject invalid data. This is how the engine's real
  enforcement was measured: `NOT NULL` is not accepted by the parser, a composite `PRIMARY KEY`
  does not parse, and only primary key uniqueness and presence are enforced. Each of those is
  reported as a downgrade rather than assumed to work.
- Every generator has golden-file tests for output stability.

### Not in this release

Migrations and the lockfile diff, the Memgraph target, and user-supplied template targets. A
public plugin API for generators is deliberately deferred until three real generators have
shown where the seam falls.

[0.1.0]: https://github.com/Volland/lpg-modeler/releases/tag/v0.1.0
