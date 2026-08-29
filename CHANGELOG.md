# Changelog

All notable changes to LPG Modeler are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Standards targets.** Three generators for schema languages this project does not own:
  `gql` (GQL graph types, ISO/IEC 39075), `pgschema` (PG-Schema, the LDBC Property Graph
  Schema Working Group formalism GQL's graph types grew out of), and `linkml` (LinkML, which
  opens its generator ecosystem to a model authored here). All three publish a capability set
  and report their downgrades like every other target.
- **Format version.** A model may declare `lpg: "1.0"`. A file that declares nothing is read
  as 1.0, so no existing model needs changing. A newer major version is a warning rather than
  an error, so a model from a future version stays readable instead of becoming opaque.
- **Prefix bindings.** A `prefixes:` map, shaped like a JSON-LD context, binds vocabularies
  beyond the model's own namespace. Every binding is declared in generated RDF, so a CURIE the
  model mentions no longer emits a document with an unbound prefix.
- **GQL type spellings.** Every scalar answers to its GQL name as well as its original one —
  `INTEGER` for `int`, `ZONED_DATETIME` for `datetime`. Matching ignores case and reads an
  underscore as a space. Both spellings resolve to the same type; this is vocabulary, not a
  second type system.

- **List-valued properties.** `list: true`, or the GQL `LIST<STRING>`, or `STRING[]` — all
  the same thing. Carried natively by every target: a `STRING[]` column on LadybugDB, arrays
  on Neo4j, `LIST<…>` in GQL and PG-Schema, `multivalued` in LinkML. A list may not form part
  of a key.
- **Enums.** An `enums:` block names a set of permitted string values that a property
  references with `enum:`. Enforced as `sh:in` in SHACL, an `owl:oneOf` datatype definition in
  OWL, and `permissible_values` in LinkML; reported as a downgrade by the four targets that
  have nowhere to put it.
- **Open and closed types.** A node type is closed by default; `open: true` admits undeclared
  properties, and openness is never inherited. SHACL now emits `sh:closed` for a closed type —
  along with a shape for every relation leaving it, without which closure would reject any
  node that had an edge — and PG-Schema emits `OPEN`.
- **Edge cardinality.** `cardinality: many-to-one` and its siblings, defaulting to
  `many-to-many`. LadybugDB emits the multiplicity keyword, which it genuinely rejects on
  write; SHACL bounds both directions, the reverse through `sh:inversePath`. Neo4j, GQL, OWL
  and PG-Schema report it rather than claiming it.

### Changed

- The capability set every target publishes gained four dimensions — `listProps`, `enums`,
  `openTypes` and `cardinality` — so each target has to state where it stands on the
  additions above rather than failing quietly.
- The model JSON Schema is now written against **JSON Schema 2020-12**, keeping to constructs
  an older validator still resolves. It also permits an optional `$schema` key, so a model can
  be validated outside VS Code. A test now asserts the schema `core` validates against and the
  copy the extension contributes are identical.

Nothing in this release changes the meaning of an existing model file.

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
