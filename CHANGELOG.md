# Changelog

All notable changes to LPG Modeler are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Migrations for a deployed schema.** `lpg lock` commits a lockfile beside the model
  recording what is deployed; `lpg diff` prints every change since then, matched by element
  id and classed additive, breaking or destructive, and `--fail-on breaking` gates a pull
  request on it; `lpg migrate` writes one reviewed script per database target — LadybugDB,
  Neo4j and FalkorDB — and advances the lockfile. A renamed type or property is migrated as a
  rename, keeping its data, never as a drop plus an add.

  A change that discards stored data is refused unless `--allow-destructive` is given, and a
  refusal writes nothing. That includes a change the model calls merely breaking but a target
  can only apply by discarding data: LadybugDB cannot change a primary key, a column type or a
  multiplicity in place. Each destructive statement is marked in the script.

  Every Ladybug migration is checked by applying it to a real database built from the previous
  revision and comparing the result with a fresh one. The FalkorDB migrations were run the same
  way against a FalkorDB 4.20.4 container while they were written.

  A model whose element ids are not written in the file cannot be locked, diffed or migrated
  (`ids-not-written`): run `lpg ids` first.

## [0.12.0] — 2026-09-16

### Added

- **A LadybugDB database can be imported directly.** `lpg import graph.lbdb --out
  domain.lpg.yaml` opens the database read-only and reads its catalog: node and rel tables,
  exact column types, primary keys and every endpoint pair. A directory or a `.lbdb`, `.lbug`
  or `.kuzu` file is recognised as a database; `--from ladybug-db` names any other path. A
  database imports to the same model as the DDL that created it, and combines with a shapes
  graph and an ontology exactly as the DDL does.

  What the catalog does not hold is reported rather than guessed: rel multiplicity
  (`import-multiplicity`) and table comments (`import-comment`), alongside the hierarchy,
  mixins and constraints no LadybugDB source carries.

  The engine runtime is an optional peer dependency of the CLI rather than a dependency,
  because its native binaries would otherwise be downloaded by every `check` and `emit`.
  A database import without it exits with the command that installs it.

## [0.11.0] — 2026-09-15

### Added

- **A named constraint may declare its severity.** `severity: warning` or `severity: info`
  marks a rule that should be reported rather than reject the data; `violation` is the
  default and is never written. Until now the only way to say "flag this" was the raw SHACL
  escape hatch.

  SHACL carries it as `sh:severity`, beside `sh:message` on whichever shape reports the
  result — the property shape for a comparison or a count, the node shape for a choice —
  because a severity on the enclosing node shape never reaches a property shape's results.
  The importer reads it back, the canvas offers a picker, and the JSON Schema accepts the
  three values. An unknown severity is an `unknown-severity` error that keeps the rule at
  the default.

  This adds a file-format key. A 0.10 model resolves exactly as before, but a model that
  uses `severity` is not readable by 0.10.

### Fixed

- **A count qualified on an imported type named a class that does not exist.** The SHACL
  emitter built the `sh:class` from the constrained type's prefix, so `of: common:Person`
  in an `app` model wrote `app:Person` and, with a minimum, rejected every node. The class is
  now looked up in its own namespace, and a count's edge and qualifier accept an import
  alias as an endpoint does.

- **A count qualifier unrelated to the edge's target is now an error.** It could never
  match, so a minimum rejected everything and a maximum constrained nothing. The new
  `incompatible-qualifier` error allows the target, its subtypes, and its supertypes.

- **A comparison's or count's `sh:message` was lost on SHACL import.** It sits in the
  property shape, and only the node shape was read.

Generated SHACL changes only for models that hit one of the fixes above or declare a
severity.

## [0.10.1] — 2026-09-12

### Fixed

- **A mixin applied to an abstract parent now reaches that parent's subtypes.** Flattening
  walked each ancestor's *declared* properties only, so a mixin on a parent contributed
  nothing below it — and because the parent is usually abstract when this pattern is
  reached for, the properties landed nowhere at all.

  What made it a defect rather than a stricter reading is that the targets disagreed.
  PG-Schema declares the type chain rather than flattening it, so the
  mixin arrived through the parent and the property was there; LadybugDB, Neo4j, FalkorDB,
  GQL, SHACL and OWL copy the flattened set down and emitted the property missing. One
  model, two answers.

  An ancestor's mixins are now walked with its declared properties, nearest ancestor first
  and declared-before-mixin within each, so *the nearer declaration wins* still reads the
  same way. The flattened property names the mixin rather than the ancestor it was applied
  on, which is where a reader finds it written, and is what the canvas marks with `◇`.

  A type's own `mixins:` list is unchanged, so the key, the `unused-mixin` warning, the
  serializer's round-trip, and the two targets that declare a mixin rather than flatten it
  behave exactly as before and nothing is emitted twice. An undeclared mixin name is still
  reported once, against the type that wrote it, rather than once per descendant.

- **The two-line note about abstract classes in the OWL export is no longer reversed.** It
  was written with two successive `unshift` calls, so every generated ontology carried the
  explanation above the thing it explains. Nothing the ontology asserts changed.

### Note

Unlike previous bumps, generated artifacts do change here: a model with a mixin on an
abstract parent gains the columns that were wrongly absent, and the OWL note swaps two
comment lines. No file-format key is added or removed, so a 0.10.0 model resolves exactly
as it did.

## [0.10.0] — 2026-09-12

### Added

- **The diagram export is reachable without the canvas toolbar.** `LPG: Export Diagram as
  PNG` and `LPG: Export Diagram as SVG` run the same capture from the command palette, and
  both are title-bar buttons on a model file as well as on the canvas tab. The commands
  resolve a model the way every other command does and open the canvas when it is closed,
  so exporting a model is one gesture rather than three.

  Only the webview can rasterize, so the host relays the request and the bytes come back
  over the channel the toolbar buttons already used; nothing about the path to disk
  changed. A request that arrives before the projection is laid out is held until there
  are boxes to capture, because rasterizing immediately would write an empty picture.

  The canvas toolbar's **light** checkbox stays the only place that preference lives: a
  command exports print-safe when the canvas is set to, rather than answering the same
  question in a second place.

## [0.9.0] — 2026-09-11

### Added

- **An ontology this project did not generate is read through `rdfs:domain`.** The OWL
  subset asserts none, so on a round trip of our own output the shapes supply every
  property and this contributes nothing. A foreign ontology is the other way round: domain
  and range are usually the only statement of where a property lives, so without reading
  them every property in it was dropped — silently, which is the one thing this project
  does not do. A domain written as an `owl:unionOf` resolves to the nearest type its
  members share, and an object property with both a domain and a range becomes an edge.

  The fallback never overrides a shape. A shape knows cardinality, closure and value
  constraints that a domain and a range cannot express, so it contributes only properties
  no shape placed.

- **A property that no type could claim is reported rather than dropped**, and an import
  carrying no shapes at all says what is therefore missing: an ontology alone has no
  cardinality, no value constraints, no open/closed distinction, and no way to tell a
  reified relation class from a node type, an n-ary relation being an ordinary class
  to OWL.

- **An eighth target: FalkorDB.** It is schema-optional and multi-label, so like Neo4j it
  carries a hierarchy as labels. What it does not share is the edition split —
  `MANDATORY` enforces existence on any instance, which makes it the only *database*
  target where a required property is genuinely enforced rather than reported. Ladybug can
  hold presence on the key alone, and Neo4j needs Enterprise.

  The artifact is a shell script over `redis-cli`, not a `.cypher` file, because the schema
  is split across two protocols: an index is Cypher, a constraint is the Redis command
  `GRAPH.CONSTRAINT CREATE`, and no client applies both. That also settles where the
  downgrade notes go — a line a redis pipe does not understand is an error, while a shell
  comment is a comment.

  Order is load-bearing rather than cosmetic. A unique constraint requires its exact-match
  index to already exist, so each index is emitted immediately above the constraint needing
  it. A key emits `UNIQUE` over its properties plus `MANDATORY` on each, because `UNIQUE`
  alone is enforced only where every constrained property is non-null, which is not what a
  key claims.

  Two operational facts are stated in the artifact rather than left to be discovered:
  enforcement is asynchronous — the command returns `PENDING`, and a constraint that
  existing data violates ends `FAILED` and is never enforced — and there is no
  `IF NOT EXISTS` for an index or a constraint, so a second run reports each as already
  existing. A map cannot be stored as a property value, so a composite is reported exactly
  as it is on Neo4j; an array can be, so a list is native.

  The graph key every command names defaults to the model's namespace prefix. Override it
  with `--graph-key` on the CLI, `lpg.targets.falkordb.graphKey` in the editor, or
  `GRAPH_KEY` in the environment when running the script.

### Fixed

- **The root build runs the workspaces in dependency order.** `npm run build --workspaces`
  visits them alphabetically — `cli`, then `core`, then `vscode` — so the CLI compiled
  against a `@lpg/core` that had not emitted its types yet and continuous integration failed
  on `Cannot find module '@lpg/core'`. It passed on a developer machine only because
  `core/dist` was already there from an earlier build. The script now names the three in the
  order the README always said it used.

- **The live LadybugDB tests bound the engine's resource defaults.** Each opens its own
  database, and `maxDBSize` reserves 8 TiB of address space by default, so fourteen of them
  running alongside the other test files exhausted the mapping — `Mmap for size
  8796093022208 failed` outright on a CI runner, and intermittently under load locally. The
  buffer pool is capped for the same reason. Both limits are far above what a fixture of a
  handful of rows needs.

## [0.8.0] — 2026-09-10

### Added

- **Importers: a model may now start from a schema that already exists.** Every entry point
  before this one needed a model file to already be there, and the only way to get one was
  the `Thing` placeholder `LPG: New Model` writes. A team with a shapes graph, an ontology or
  a database schema had no way in short of retyping it. Three sources are read:

  ```bash
  npx lpg-modeler-cli import domain.shacl.ttl domain.owl.ttl --out domain.lpg.yaml
  ```

  Several files are read together rather than one at a time, because neither RDF artifact is
  a model on its own. SHACL says which class carries which property, its datatype, whether it
  is required and whether the type is closed — but a shape is flat, so an inherited property
  is copied onto every subtype and an abstract parent emits no shape at all. OWL has exactly
  what SHACL lacks, `rdfs:subClassOf` and `owl:hasKey`, and lacks exactly what SHACL has,
  because the OWL subset deliberately asserts no `rdfs:domain` and so knows every property in
  the vocabulary and not one of the types it belongs to. Read together they reconstruct
  nearly the whole model; read apart, each yields a fragment.

- **The LadybugDB DDL is read as a third, complementary source.** It is the only artifact
  carrying an edge's endpoints and the exact width of every column, the scalar set having
  been drawn from what that engine stores. So `INT128`, `UUID`, `JSON` and a nested `STRUCT`
  survive a round trip that RDF alone flattens — `xsd:integer` is written by two scalars and
  `xsd:string` by three, and a collision cannot be undone by care afterwards. A datatype from
  the DDL therefore overrides the one read from RDF, applied to whichever ancestor declares
  the property rather than to the subtype the generator copied it onto.

  One spelling is translated rather than taken at face value: LadybugDB writes the 32-bit
  float as `FLOAT`, where the metamodel reads a bare `FLOAT` as the 64-bit one. Reading the
  DDL with the generic table would widen every `FLOAT32` to a `DOUBLE`, which is the opposite
  of why the DDL is consulted.

- **An expanded endpoint set collapses back to the abstract type it came from.** An edge on
  an abstract endpoint is generated as one `FROM … TO …` pair per concrete subtype. Given the
  hierarchy from an ontology in the same import, a set of pairs that is exactly the concrete
  descendants of one type becomes that type again — `STATIONED_AT` returns as one declaration
  on `Asset` rather than three. Without a hierarchy there is nothing to collapse to, so the
  first pair stands and the rest are reported as dropped.

- **A model serializer**, which had no equivalent: the only serializers wrote the sidecars.
  Key order is fixed rather than incidental, so serializing one model twice gives the same
  bytes — which is what the deferred lockfile diff would be built on, so the ordering is
  settled here rather than left to whatever order fields happen to be set in.

- **`LPG: Import Model…`**, which reads the files you pick, writes the model, opens it, and
  opens the canvas beside it — the same ending as `LPG: New Model`.

- **What could not be recovered is reported, not glossed.** Import diagnostics are the
  inbound direction of the capability matrix: the ambiguous datatypes, every property hoisted
  back onto a parent, every endpoint set collapsed or dropped, and the flat statement that
  RDF cannot express an abstract type, a mixin or a uniqueness constraint. A property carried
  identically by every subtype is moved up to the parent, but two agreeing subtypes are the
  least that justifies it: a property on the *only* child of a type is exactly as consistent
  with the child declaring it as with the parent doing so, so nothing is hoisted through one.

### Changed

- **The SHACL artifact asserts an edge's endpoints instead of only describing them.** A
  relation shape now carries `sh:class`, and both ends of a reified edge carry one, alongside
  the `# (:From)-[:EDGE]->(:To)` comment that was previously the only record. A comment is
  prose for a reader; anything a machine has to read back has to be asserted. The change adds
  eight lines to the `social` SHACL golden and removes none, and the OWL artifact is
  untouched — its assertional subset was already the reason the endpoints had nowhere to go.

- **Two `sh:property` shapes on one path are read as one property.** SHACL conjoins them,
  which is how the raw `shacl:` escape hatch adds a constraint to a property the model
  already declares. Merging takes the tightest of each bound, so a `max` of 30 narrowed by an
  escape hatch to 14 arrives as 14 rather than as a duplicate key.
## [0.7.0] — 2026-09-06

### Added

- **Export the diagram as PNG or SVG.** A toolbar Export control rasterizes
  `.react-flow__viewport` with `html-to-image`, framed the same way `fitView` frames it, and
  hands the host a data URL to save — the webview has no filesystem access of its own.
  `toSvg` wraps the captured HTML in a `<foreignObject>` rather than emitting pure vector
  paths, so the file opens correctly in a browser or image viewer but is not the kind of SVG
  a vector editor decomposes into shapes.

- **A "light" export mode for print.** A checkbox beside Export swaps in a fixed white/dark-ink
  palette for the duration of the capture — chosen for contrast after grayscale conversion,
  not just for hue — without touching the live canvas's theme.

- **The inspector heading is color-coded by what's selected.** A node type, an edge type, and
  a mixin all rendered the same plain heading; blue, orange, and purple now tell them apart
  at a glance.

### Fixed

- **An edge and its label could go nearly invisible.** Both defaulted to React Flow's own
  light/dark heuristic, which follows the OS color-scheme setting rather than VS Code's
  theme — a dark VS Code theme on a light-mode OS rendered them in React Flow's light-mode
  colors, low-contrast against a dark canvas. Both now track the same theme variables the
  rest of the canvas does.

## [0.6.1] — 2026-09-05

### Fixed

- **A model with no sidecar files now appears on the canvas.** Opening the canvas on a
  hand-written model showed an empty grid. React Flow's zoom floor is 0.5, and ELK lays a
  few dozen ERD boxes out across several thousand pixels, so framing that diagram asks for
  roughly 0.15, gets clamped, and parks the viewport in the middle of a diagram it cannot
  fit — one or two boxes of thirty-four in frame, and empty grid everywhere the model
  should be. The canvas sets its own floor now.

- **Automatic layout is kept instead of thrown away.** An element the file gives no `id:`
  was resolved with a random identifier minted afresh on every read, so the canvas would
  lay a diagram out, persist those positions and then never recognise them again; the
  layout sidecar grew by a dead entry per element per refresh. Identifiers are now derived
  from what names the element — its kind, and its name within its owner — so two reads of a
  file agree. `backfillIdEdits` writes the same identifiers, so the first canvas edit no
  longer scatters an arrangement that was just made. A derived identifier follows the name,
  so a rename still moves the box until the tool has written the identifiers into the file.

- **The contributed JSON Schema accepts exactly what the type parser accepts.** Its pattern
  branches had drifted: a stacked suffix like `INT64[][]`, a `NUMERIC(9,2)`, and a composite
  carrying a fixed-size suffix all parsed but were marked broken in the editor. The test now
  asserts both directions against the parser rather than a handful of accepted forms.

- **An unknown type is reported against the twenty-one canonical names** rather than all
  sixty accepted spellings, with the alias rule taught by example. A list that long is a
  wall to scan rather than an answer.

## [0.6.0] — 2026-09-05

### Added

- **Composite types: `STRUCT`, `MAP`, `UNION` and the fixed-size `ARRAY`.** 0.4.0 drew the
  scalar set from what LadybugDB stores natively and stopped at the composites, on the grounds
  that they need a nested type syntax and a story for every other target. They are in now, with
  the syntax the database itself uses, so a model reads the way the DDL it generates does:

  ```yaml
  location:  { type: "STRUCT(lat DOUBLE, lon DOUBLE)" }
  tags:      { type: "MAP(STRING, STRING)" }
  reading:   { type: "UNION(num DOUBLE, text STRING)" }
  embedding: { type: "FLOAT[128]" }                       # also ARRAY<FLOAT, 128>
  history:   { type: "STRUCT(at TIMESTAMP, v DOUBLE[])[]" }
  ```

  They nest, in any combination and to any depth — a list of structs one of whose fields is
  itself a list, a map of arrays, a list of lists. Because a composite nests, it cannot be read
  with the regular expression a bare scalar could, so the type parser is now a tokenizer and a
  recursive-descent reader.

- **The ladybug target stores every one of them, verified against a running engine.** The
  execution test creates the table and then reads the column type back out of `TABLE_INFO`,
  so it proves the composite reached the catalogue intact rather than only that the DDL parsed.
  All seven forms round-trip byte-identical, and a second test writes a struct and a map value
  and reads both back through `s.location.label` and `map_extract`.

- **Every other target reports the loss and keeps what it has a place for.** A composite
  property also carries the scalar it degrades to — the element scalar when every value inside
  it is the same scalar, `json` otherwise — computed once in the parser rather than reinvented
  per emitter. So `UINT8[3]` still writes `LIST<UINT8>` in GQL and only its size is reported
  lost, while a `STRUCT` has no single element type and falls back to `json`. Neo4j writes that
  the value is unstorable outright: a Neo4j property is a primitive or an array of primitives.

  Reifying a struct into an RDF node shape was the alternative for SHACL and OWL. It was
  rejected because it invents a node with an identity the model never gave it, which is the
  composition problem rather than a datatype mapping.

- **`compositeTypes` in the capability matrix**, native on ladybug and unsupported on the other
  six. One shared reporter raises the downgrade, for the same reason the constraint downgrades
  have one: six targets saying the same thing in six wordings would drift. It is a `warning`
  rather than the `info` used for constraints, because a property whose structure silently
  flattens is the surprising kind of loss.

- **Six rules on what a composite may not do.** It cannot be part of a key, reference an enum,
  or carry value bounds — each of those is defined on one scalar value, and a composite is not
  one. Three more are internal to the type rather than target-specific: a `STRUCT` or `UNION`
  may not name a field twice, a fixed-size array holds at least one element, and a map key must
  be a scalar, because none of the three is writable in LadybugDB either. Diagnostics name the
  type as written rather than the scalar it happens to degrade to.

- **The composite forms reach the file format and the canvas.** The contributed JSON Schema
  admits them, so the editor does not mark a valid model broken, and a composite property on a
  diagram shows its full spelling instead of the fallback scalar.

## [0.5.0] — 2026-09-05

### Added

- **Inheritance and mixins are visible and editable on the canvas.** The compiler has always
  resolved `extends` and `mixins` and generated every inherited and mixed-in property into all
  seven targets; the editor knew nothing about either. A type's box now shows what it extends,
  a chip per mixin it applies, and marks each property with where it came from — `↑Party` for a
  supertype, `◇Timestamped` for a mixin, because those are not the same claim about the type.

  A mixin is authored from the canvas: `+ mixin` declares one, a checkbox per mixin applies it
  to the selected type, and the mixin's own panel edits its properties — a change there reaches
  every type applying it, which is the point. Renaming a mixin carries into every application,
  and deleting one removes it from them, since a type left applying a mixin the model no longer
  has would not resolve. The panel with nothing selected lists the model's mixins, because a
  mixin no type applies has no box to be reached from.

- **The inspector edits what a type is, not only its constraints.** Name, parent, and the
  abstract flag for a node type; name, both endpoints, multiplicity, and properties for an
  edge type. Each field commits on Enter or on blur rather than per keystroke, which would
  rewrite the model file on every letter typed.

- **An `Edges` section lists every edge a type takes part in, including inherited ones.**
  `OWNS` declared on an abstract `Party` is drawn on `Party` alone — the diagram says where a
  thing is written, and re-drawing it from four subtypes would suggest four declarations. The
  reading a user needs, what can this type relate to, is a list, so the panel gives it, marked
  with the type each edge is declared on.

- **`+ edge type`, and a type created by drawing outwards.** An edge type can be added from the
  toolbar with both endpoints as dropdowns of types that exist. A connection dropped on empty
  canvas means "and then there is one of these": it offers to create the target type and the
  edge in one step.

- **Two diagnostics for mixins.** A mixin no node type applies is a warning — it reaches no
  generated artifact. A property a type declares itself where a mixin also declares one is an
  `info`: the type's own wins, which is the useful reading, but it is invisible in the file.

### Fixed

- **The canvas asks its questions in the document.** `+ node type` did nothing at all, a type's
  name could not be renamed, deleting a type never confirmed, and an edge's multiplicity could
  not be edited. Every one of those routed through `window.prompt` or `window.confirm`, which a
  VS Code webview is a sandboxed iframe for: they return immediately without showing anything,
  so the action did nothing and did it silently.

  Each is now a dialog rendered in the page. A test asserts that no webview source reaches for
  those three again, because the failure mode is silence — invisible to types and to any test
  that does not run a browser.

- **A type created on the canvas appears on the diagram.** A view that names its members used
  to swallow a new type: the file gained it and the diagram in front of the user did not. The
  host now carries a creation, rename or deletion through the views sidecar. A new box also
  takes a free column beside the boxes already placed rather than triggering a relayout that
  moves everything, and the canvas re-frames itself so the new type is on screen.

- **Two intents posted together apply in order.** One gesture can send two — create the type,
  then the edge reaching it — and both were spliced against the same original text, so the
  second landed at offsets the first had already moved. The host now handles one message at a
  time, and reports a failing canvas action instead of swallowing it.

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
