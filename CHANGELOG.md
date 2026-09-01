# Changelog

All notable changes to LPG Modeler are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2026-09-01

### Added

- **Twenty-one scalar types, drawn from what LadybugDB stores.** A property may now take the
  integer widths (`int8`, `int16`, `int32`, `int128`), their unsigned variants, `float32`,
  `decimal` — optionally with a precision and scale, written `"DECIMAL(18,3)"` — `duration`,
  `blob` and `zoneddatetime`, alongside the eight types that existed. Each also answers to its
  GQL and LadybugDB spellings, and the JSON Schema the editor completes from now offers exactly
  the set the parser accepts, checked by a test.

  Every one of them is a native LadybugDB column type, so that target reports no type downgrade
  at all. RDF names all but `uuid` and `json`; GQL carries the same; LinkML collapses the widths
  onto one `integer` and reports `duration` and `blob`. `STRUCT`, `MAP`, `UNION`, the fixed-size
  `ARRAY` and `SERIAL` are deliberately not included — the first four need a nested type syntax
  in the file format, and the last is a generated value rather than a value type.

- **The canvas offers the metamodel's own type set.** The property dropdown and the inspector's
  facet rules are sent by the extension host instead of living as a list inside the webview,
  which could drift from what validation enforces. A parameterised decimal reads as
  `decimal(18,3)` on the diagram.

### Changed

- **`zoneddatetime` is now its own type, split from `datetime`.** `ZONED_DATETIME` and
  `TIMESTAMP_TZ` mean a timestamp that carries an offset and generate `TIMESTAMP_TZ` for
  LadybugDB; `TIMESTAMP` and `LOCAL_DATETIME` mean the naive one and generate `LOCAL DATETIME`
  for GQL and PG-Schema. The single type contradicted itself — it emitted a naive column while
  declaring a zoned type — so a model written with `ZONED_DATETIME` now generates a column that
  can hold the offset it claims.

- **`json` is stored as LadybugDB's `JSON`, not `STRING`.** Measured against 0.19.1, the engine
  has a real JSON column type that reads the value back as a value. It is no longer reported as
  a downgrade on that target.

## [0.3.1] — 2026-09-01

### Fixed

- **Commands find a model instead of refusing without one.** `LPG: Generate Schema` and
  `LPG: Open Canvas` reported "Open a .lpg.yaml model file first" whenever no text editor
  held focus — which is exactly the case while the canvas is the focused tab, the one place
  a user is looking at a model when they want a schema from it.

  Both commands now resolve a target: the active editor, then a focused canvas, then the
  workspace — one model is used directly, several are offered as a quick pick — and when the
  workspace holds no model at all, the `LPG: New Model` flow writes one and the command
  carries on with it. The first use of Generate Schema now teaches the file format rather
  than demanding it.

## [0.3.0] — 2026-08-31

### Added

- **`LPG: New Model`.** A command that creates a model file: it asks for a namespace prefix
  and a base IRI, writes the file, opens it, and opens the canvas beside it. Every other
  entry point — the canvas and all four CLI verbs — needs a model file to already exist, so
  the first step used to be knowing the shape of a file nobody had shown you.

  The file it writes carries stable ids and one seeded node type with a key, so it validates
  and generates every target on the first run rather than reporting a missing key. The
  suffix is forced to `.lpg.yaml` whatever the save dialog returns, because a model saved as
  plain `.yaml` gets no schema validation and no canvas — which reads as the extension
  failing rather than as a naming mistake.

## [0.2.0] — 2026-08-30

### Added

- **German legal pages** — Impressum (§ 5 DDG), Datenschutzerklärung (Art. 13 DSGVO) and
  Nutzungsbedingungen — linked from every footer. They describe what the site actually does
  rather than boilerplate: GitHub named as host and the United States as a processing
  location, the Gmail contact address disclosed as a Google processing step, and no cookie
  banner because no cookie is set.

- **Value constraints.** `min`, `max`, `pattern`, `minLength` and `maxLength` on a property,
  each checked against the property's type. SHACL carries all five, LinkML all but length,
  and the other five targets report them.
- **Named constraints.** A node type may declare assertions spanning more than one property:
  `lessThan`, `lessThanOrEquals`, `equals`, `disjoint`, `atLeastOne`, `exactlyOne` and
  `count` — the last being a qualified count over an edge, which is what expresses "exactly
  one of a booking's guests leads it". The vocabulary is closed on purpose: a closed set can
  be translated per target and rendered as a form, where a raw expression could only be
  passed through to one target and would need a parser in the canvas.
- **A raw SHACL escape hatch.** `shacl: |` on a node type splices a fragment into that
  type's shape. Deliberately unportable, and every other target reports that it ignored it.
- **An inspector panel in the canvas.** Selecting a type opens a panel for its value
  constraints and named constraints, with a builder whose operands are dropdowns of the
  type's own properties. A type box on the diagram shows only a constraint count.
- **Four downloadable examples and an examples page** on the documentation site — a starter
  model, enums and lists, endpoint bounds, and constraints. A test resolves and generates
  every one of them, so the file a reader downloads is the file CI checked.

- **Numeric endpoint bounds.** Cardinality is now a bound per end — `*`, an exact count
  such as `2`, or a range such as `1..2` or `1..*` — written as
  `cardinality: { to: "2" }`. The four named forms stay as sugar and every model that used
  them is unchanged. This is what lets a model say "a child has exactly two parents", which
  no combination of `many` and `one` could express.

  SHACL carries it exactly in both directions, the reverse through `sh:inversePath`.
  LadybugDB emits the strongest multiplicity keyword that fits and reports whatever the
  keyword cannot hold, since it encodes only an upper bound of one per end.

- **The canvas shows the whole metamodel again.** The webview projection had fallen behind:
  list types, enums, open types and cardinality existed in the model but never reached the
  diagram. Property rows now show `STRING[]` for a list and the enum a property is limited
  to, a type carries an `open` badge, and an edge shows its multiplicity. Clicking an edge
  edits it.


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

### Fixed

- **A trailing separator in generated LadybugDB DDL.** When a downgrade comment was the last
  line inside a relationship table, the comma stripper acted on the comment instead of the
  last real entry, leaving a comma before the closing parenthesis — a parse error. Caught by
  executing the DDL rather than by a golden file.

### Changed

- **Fonts are self-hosted.** Every page loaded Inter, Instrument Serif and JetBrains Mono
  from Google's CDN, which sends each visitor's IP address to Google — held unlawful without
  consent by LG München I (20.01.2022, 3 O 17493/20). The Latin subsets now ship with the
  site under the SIL Open Font Licence. The site now fetches nothing cross-origin at all,
  and a test asserts it, since a single convenient `<link>` would quietly make the privacy
  statement false.

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
