# Changelog

All notable changes to LPG Modeler are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
