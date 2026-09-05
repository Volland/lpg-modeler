# Metamodel

The metamodel defines what a model may legally say: a Labeled Property Graph core extended with an abstract label hierarchy and mixins, first-class identity, and stable element identifiers.

## Type Hierarchy

Node types support multi-label membership, single-parent inheritance from abstract labels, and mixin traits for shared property sets. Edge types are binary, typed, directed, and may carry properties.

The hierarchy exists for two reasons. It removes copy-pasted property sets across sibling types, and it is the backbone that makes an ontology export worth producing at all: without `subClassOf`, OWL output degenerates into a flat list of classes. The cost is borne by the emitters, which must flatten it for targets that have no inheritance — see [[emitters#Ladybug Target]].

Edges that are themselves endpoints of other edges — the metagraph case — are deliberately outside the core. Neo4j cannot represent them natively, so admitting them would force every emitter to grow a silent reification path.

### Inheritance

A node type may extend one other type. It gains that type's properties and, when it declares none of its own, its key; every ancestor is recorded so a target can either declare the hierarchy or flatten it.

Properties are flattened onto the subtype during resolution, each carrying the name of the type it came from, so an emitter never walks the chain and a diagram can say where a property is written. What is *not* inherited is stated where each concept is: [[metamodel#Open and Closed Types|openness]] and [[metamodel#Named Constraints|named constraints]] both stop at the type that declares them. An edge declared on an abstract parent belongs to every descendant, which is what makes the parent worth declaring; the emitters differ only in whether they can say so directly — see [[emitters#GQL Target]] against [[emitters#Ladybug Target]].

### Mixins

A mixin is a named bag of properties a node type applies. It declares no supertype, has no identity of its own, and never appears in an ancestor chain.

Reuse and subtyping are different needs, and conflating them produces a hierarchy shaped by which properties happen to travel together rather than by what a thing is: `createdAt` on twenty types does not make twenty subtypes of a Timestamped. Because a mixin is not a label it costs the emitters nothing — its properties are flattened into every type that applies it before any target sees the model, so a target with no inheritance and one with rich subtyping generate the same columns. It contributes no key, though a type may name a mixin's property in its own key.

The nearer declaration wins: a type's own property beats a mixin's, and a mixin's beats an ancestor's. The first is reported at `info` and a mixin nothing applies at `warning`, because neither is visible in the file — one silently drops a property the reader can see written, the other reaches no artifact at all.

## Identity

Every concrete node type declares exactly one key, single or composite; validation fails without one. Keys are inherited, so declaring a key once on an abstract parent covers every subtype.

One concept pays off three times: a Ladybug `PRIMARY KEY`, a Neo4j `NODE KEY` constraint, and `owl:hasKey` in the ontology export. Identity was promoted from an emitter detail to a modeling concept because Ladybug refuses to create a node table without a primary key.

Two caveats. Ladybug primary keys are single-column, so a composite key is emitted as a synthesized concatenated column. And under [[emitters#Ladybug Target]] flattening, key uniqueness is enforced per table, so two subtypes of one abstract parent can hold the same key value.

## Stable Element IDs

Every node type, edge type, and property carries a short generated identifier, written once by the tool and never edited by hand.

Identifiers make a rename distinguishable from a drop-plus-add, which a structural diff alone cannot do — see [[emitters#Migrations]]. They also give diagram layout a stable anchor, so a rename moves nothing on screen. Because identifiers are copied along with the text, validation must reject duplicates introduced by copy-paste.

## Format Version

A model file may declare the format version it is written against with a top-level `lpg:` key. A file that declares nothing is read as 1.0, which is what every model written before the key existed is.

Self-description is what lets a file be validated outside the editor that produced it, and it is the cheapest thing a format can do for interoperability. A newer major version is a warning rather than an error: the keys this build knows still resolve, so a model from a future version stays readable instead of becoming opaque. The file may also carry a `$schema` key pointing at the JSON Schema, so a generic validator finds it without VS Code's contribution.

## Scalar Types

A property takes one of twenty-one scalars: five integer widths and four unsigned ones, two floats and a decimal, boolean, four temporal types, and `uuid`, `blob` and `json`.

The set is what LadybugDB stores natively, minus what is not a value type. Taking the primary target's own vocabulary as the ceiling means an attribute a model can write is an attribute that target can hold without a downgrade, while every other target either has the type or says honestly that it does not: RDF names all of them but `uuid` and `json`, GQL carries the same, and LinkML collapses the widths onto one `integer` and reports `duration` and `blob`. See [[emitters#Capability Matrix]].

Two things LadybugDB has are deliberately not types here. `SERIAL` is a generated value rather than a value type, and the metamodel has no notion of a generated column. `TIMESTAMP_NS`, `TIMESTAMP_MS` and `TIMESTAMP_SEC` are storage precisions of one instant, not distinct types. LadybugDB's composites are admitted, but as a separate shape rather than a row in this table — see [[metamodel#Composite Types]].

### Parameters

`decimal` may carry a precision and a scale, written as part of the type: `DECIMAL(18,3)`. Nothing else takes parameters.

Without them a decimal is whatever the target defaults to; with them, the same digits reach LadybugDB, GQL and PG-Schema, which each spell the parameters the same way. A precision on any other type is reported as an unknown type rather than ignored, because a silently dropped width is worse than a rejected one. In YAML flow style the type has to be quoted — `type: "DECIMAL(18,3)"` — since a comma would otherwise end the mapping it sits in.

### Integer Widths

`int` stays 64-bit, and `INT`, `INTEGER` and `BIGINT` all spell it. The narrower widths are named explicitly: `int8`, `int16`, `int32`.

SQL reads a bare `INT` as 32-bit, so the widths could have been introduced by redefining it to match. Every model written before the widths existed would then have silently narrowed on its next generation, which is the one kind of change a schema tool must never make quietly.

### Zoned and Naive Timestamps

`datetime` is an instant with no offset and `zoneddatetime` is one that carries it. `TIMESTAMP` and `LOCAL_DATETIME` spell the first; `ZONED_DATETIME` and `TIMESTAMP_TZ` spell the second.

They were a single type until LadybugDB's `TIMESTAMP_TZ` was admitted, and that type contradicted itself: it generated a naive `TIMESTAMP` column while declaring `ZONED DATETIME` in GQL. Splitting them changes what an existing model saying `ZONED_DATETIME` generates, which is the point — it now gets a column that can hold the offset it claims.

## Type Spellings

Every scalar type has at least two accepted spellings: the original lower-case name, and the GQL (ISO/IEC 39075) or LadybugDB name. Matching ignores case and reads an underscore as a space, so `ZONED_DATETIME` and `zoned datetime` are one type.

Both spellings resolve to the same canonical name in the IR, so nothing downstream has to know which was written. Adopting the standard's vocabulary where it costs nothing means a model reads the way the schema it generates does. The reverse mapping is not total — `uuid` and `json` have no GQL value type and stay reported downgrades, as they already were for RDF.

An unknown type is reported against the canonical names, not against every spelling. Listing all sixty aliases is a wall to scan rather than an answer, so the message names the twenty-one scalars once, teaches the alias rule by example — `STRING` alongside `string` — and gives the composite forms as syntax. A test pins the example, because the rule is the part a reader most needs and the part a shortened message most easily drops.

The set the parser accepts is also the set the JSON Schema offers, checked by a test in both directions: a spelling the editor rejects but the CLI takes would make a valid model look broken in the one place most models are written. The schema needs pattern branches as well as an enum, because a parameterised decimal, a stacked suffix like `INT64[][]` and every [[metamodel#Composite Types|composite]] are open sets rather than names.

## Lists

A property may hold a list of its type rather than a single value, written `list: true`, or as the GQL `LIST<STRING>` or the bracket form `STRING[]`. All three say the same thing.

Lists were admitted because every target already has them: LadybugDB stores a `STRING[]` column, Neo4j stores arrays natively, GQL and PG-Schema spell the type `LIST<…>`, and LinkML calls it `multivalued`. Nothing has to be downgraded to carry one. A list may not take part in a key — see [[metamodel#Identity]] — because a key has to identify one node and a list of values cannot.

## Composite Types

A property may hold a composite value: a fixed-size `ARRAY`, a `STRUCT` of named fields, a `MAP` from a scalar key to a value, or a `UNION` of named members. They nest, in any combination and to any depth.

They were admitted because LadybugDB stores all four natively and models written for it were losing them at the door. The metamodel's type set was drawn from that engine to begin with — see [[metamodel#Scalar Types]] — and stopping short of its composites meant a schema the tool could not describe was still a schema the tool's primary target would run.

The syntax is LadybugDB's own, so a model reads the way the DDL it generates does: `STRUCT(lat DOUBLE, lon DOUBLE)`, `MAP(STRING, INT64)`, `UNION(num INT64, text STRING)`, and `FLOAT[128]` for a fixed-size array, which is also spelled `ARRAY<FLOAT, 128>`. The `[]` and `[n]` suffixes apply outward, so `STRUCT(at TIMESTAMP)[]` is a list of structs. In YAML the type has to be quoted, since a comma would otherwise end the mapping it sits in.

A composite nests, so it cannot be read with a regular expression the way a bare scalar can. The parser is a hand-written recursive-descent reader over a small token stream, which is shorter than the grammar would be if the forms were kept flat and separate.

### What a Composite May Not Do

A composite property cannot be part of a key, cannot reference an [[metamodel#Enums|enum]], and takes no [[metamodel#Value Constraints|value constraints]].

The reason is the same in each case: those things are defined on one scalar value, and a composite is not one. A key is a scalar column in every target that has a key at all, an enum constrains string values, and a bound compares two values of one ordered type. Three further rules are internal to the type rather than target-specific — a `STRUCT` or `UNION` may not name a field twice, a fixed-size array holds at least one element, and a map key must be a scalar — because none of them is writable in LadybugDB itself.

### Degradation

A composite property also carries the scalar it degrades to on a target that has no composites: the element scalar when every value inside it is the same scalar, and `json` otherwise.

This is what lets the six other targets keep behaving as they did without knowing the composite shape at all. A `UINT8[3]` degrades to a list of `UINT8`, so GQL still writes `LIST<UINT8>` and only the fixed size is reported lost; a `STRUCT` has no single element type, so it keeps `json` — the one scalar in the set that already stands for a value with structure inside it. The degradation is recorded once, in the parser, rather than reinvented per emitter. See [[emitters#Composite Types]].

## Enums

An enum names a set of permitted string values. A property references one with `enum:`, and its type must be `string`.

The value set is a modelling concept rather than an emitter detail because only some targets can enforce it: SHACL turns it into `sh:in`, OWL into a datatype definition with `owl:oneOf`, and LinkML into `permissible_values`, while LadybugDB, Neo4j, GQL, and PG-Schema have nowhere to put it and report a downgrade. Enums resolve by name across an import closure, like every other type.

## Open and Closed Types

A node type is closed by default: an instance carries only the properties the type declares. Declaring `open: true` admits others. Openness is never inherited.

The distinction exists because the targets genuinely disagree. LadybugDB's schema is mandatory and closed, so an open type is a downgrade there; Neo4j is schema-optional and cannot enforce closure either way; SHACL expresses closure exactly, as `sh:closed`; and PG-Schema has an `OPEN` keyword for it. Without the concept, a model could not say which of those it meant.

Closure is not inherited because a subtype that admitted extra properties would silently widen its parent's contract, and the reader of the parent would have no way to see it.

## Cardinality

An edge type may declare endpoint multiplicity, either as one of four named forms or as a bound per end. The bound written at an end says how many nodes at that end may relate to one node at the other, which is the UML reading.

A bound is `*` for unbounded, an exact count such as `2`, or a range such as `1..2` or `1..*`. The named forms are sugar over bounds: `many-to-one` is `{ from: "*", to: "0..1" }`. The default is unbounded at both ends, which constrains nothing, and is written by leaving the field out.

Bounds replaced a four-value enum because the enum could not say the thing people actually ask for. "A child has exactly two parents" is `{ to: "2" }`, and no combination of `many` and `one` expresses it. The named forms stayed because they read better for the common cases and because every model written before bounds used them. The LadybugDB spellings `MANY_ONE` and the rest are accepted as aliases.

Cardinality earns its place because it is genuinely enforced somewhere. SHACL carries it exactly, in both directions: the forward bound as `sh:minCount` and `sh:maxCount`, the reverse as the same counts under a `sh:inversePath`. LadybugDB carries only an upper bound of one per end, because its multiplicity keyword encodes nothing else, so it emits the strongest keyword that fits and reports whatever the keyword drops. Neo4j, GQL, OWL, and PG-Schema report it whole.

## Value Constraints

A property may bound its own values: `min` and `max` for anything ordered, and `pattern`, `minLength` and `maxLength` for a string. Each is checked against the property's type, so a pattern on an integer is an error rather than a silent no-op.

These are the cheapest constraints to add and the least portable to carry. SHACL expresses all five, LinkML all but length, and the five remaining targets none — measured, not assumed: LadybugDB 0.19.1 rejects `CHECK` outright. Their value is that the model records the intent even where no database can hold it, and [[emitters#Capability Matrix|every target says which]].

## Named Constraints

A node type may declare constraints that span more than one property: a comparison between two of them, a choice among several, or a count over one of its edges. Each has a name, an assertion, and an optional message.

The assertion vocabulary is closed — seven kinds, no expression language. That is the load-bearing decision. A closed vocabulary can be translated per target or honestly downgraded, where a raw expression could only ever be passed through to one; and it lets the canvas offer a form per kind with operands drawn from the type itself, rather than shipping a parser. See [[architecture#Editing Surface#Inspector]].

Constraints are not inherited. One written against a subtype's property would be meaningless on the parent, and a subtype that silently widened its parent's contract would give the reader of the parent no way to see it — the same reasoning as [[metamodel#Open and Closed Types]].

## Escape Hatch

A node type may carry a raw SHACL fragment, spliced verbatim into its shape. It is the long tail: anything the closed vocabulary cannot say.

The hatch exists because a closed vocabulary that cannot be escaped becomes a reason not to adopt the tool at all. It is deliberately unportable, and that is stated rather than hidden: only the SHACL target uses it, and every other target reports that it ignored it. Widening the vocabulary is always the better fix, and the hatch is what makes waiting for that bearable.

## Composition

A model imports other models under a local alias and may subtype an imported label, apply a mixin, or declare edges touching imported types. It may never mutate an imported definition.

Sealing imports keeps them referentially transparent: a shared type means the same thing to every consumer, so generated output is deterministic and cacheable. The diamond case — two modules importing a common vocabulary into a third — resolves by identity rather than by merge.

## Namespaces

Each model declares a prefix and a base IRI. The import alias is only a local binding; the IRI is the global identity of every type the model defines.

A single concept serves both composition and RDF. Identity by IRI rather than by file path means the diamond case still resolves when the same vocabulary is vendored at two different paths, which path identity alone would get wrong. Because IRIs are name-derived, renaming a type changes its identity for RDF consumers, so a rename should also emit an equivalence assertion to the previous IRI.

## Prefixes

Beyond its own namespace, a model may bind further prefixes to base IRIs with a `prefixes:` map. Every binding is declared in the RDF documents generated from the model.

The shape is a JSON-LD context: prefix to base IRI, and nothing else. Without it a model that mentions a vocabulary by CURIE emits a document where that CURIE is unbound, which no RDF parser will read. Bindings resolve across a closure with the entry file winning, so a consumer can rebind a vendored vocabulary without editing it — the same rule [[metamodel#Composition]] applies to imports.
