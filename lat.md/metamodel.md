# Metamodel

The metamodel defines what a model may legally say: a Labeled Property Graph core extended with an abstract label hierarchy and mixins, first-class identity, and stable element identifiers.

## Type Hierarchy

Node types support multi-label membership, single-parent inheritance from abstract labels, and mixin traits for shared property sets. Edge types are binary, typed, directed, and may carry properties.

The hierarchy exists for two reasons. It removes copy-pasted property sets across sibling types, and it is the backbone that makes an ontology export worth producing at all: without `subClassOf`, OWL output degenerates into a flat list of classes. The cost is borne by the emitters, which must flatten it for targets that have no inheritance — see [[emitters#Ladybug Target]].

Edges that are themselves endpoints of other edges — the metagraph case — are deliberately outside the core. Neo4j cannot represent them natively, so admitting them would force every emitter to grow a silent reification path.

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

## Type Spellings

Every scalar type has two accepted spellings: the original lower-case name and the GQL (ISO/IEC 39075) name. Matching ignores case and reads an underscore as a space, so `ZONED_DATETIME` and `zoned datetime` are one type.

Both spellings resolve to the same canonical name in the IR, so nothing downstream has to know which was written. Adopting the standard's vocabulary where it costs nothing means a model reads the way the schema it generates does. The reverse mapping is not total — `uuid` and `json` have no GQL value type and stay reported downgrades, as they already were for RDF.

## Lists

A property may hold a list of its type rather than a single value, written `list: true`, or as the GQL `LIST<STRING>` or the bracket form `STRING[]`. All three say the same thing.

Lists were admitted because every target already has them: LadybugDB stores a `STRING[]` column, Neo4j stores arrays natively, GQL and PG-Schema spell the type `LIST<…>`, and LinkML calls it `multivalued`. Nothing has to be downgraded to carry one. A list may not take part in a key — see [[metamodel#Identity]] — because a key has to identify one node and a list of values cannot.

## Enums

An enum names a set of permitted string values. A property references one with `enum:`, and its type must be `string`.

The value set is a modelling concept rather than an emitter detail because only some targets can enforce it: SHACL turns it into `sh:in`, OWL into a datatype definition with `owl:oneOf`, and LinkML into `permissible_values`, while LadybugDB, Neo4j, GQL, and PG-Schema have nowhere to put it and report a downgrade. Enums resolve by name across an import closure, like every other type.

## Open and Closed Types

A node type is closed by default: an instance carries only the properties the type declares. Declaring `open: true` admits others. Openness is never inherited.

The distinction exists because the targets genuinely disagree. LadybugDB's schema is mandatory and closed, so an open type is a downgrade there; Neo4j is schema-optional and cannot enforce closure either way; SHACL expresses closure exactly, as `sh:closed`; and PG-Schema has an `OPEN` keyword for it. Without the concept, a model could not say which of those it meant.

Closure is not inherited because a subtype that admitted extra properties would silently widen its parent's contract, and the reader of the parent would have no way to see it.

## Cardinality

An edge type may declare endpoint multiplicity, read as `<from end>-to-<to end>`. `many-to-one` says each source node has at most one target. The default is `many-to-many`, which constrains nothing.

Cardinality earns its place because it is genuinely enforced somewhere: LadybugDB rejects a violating write, which was measured rather than assumed, and SHACL expresses both directions — the forward bound as `sh:maxCount`, the reverse as a `sh:inversePath` shape. Neo4j, GQL, and OWL each report it as a downgrade instead. The LadybugDB spellings `MANY_ONE` and the rest are accepted as aliases.

## Composition

A model imports other models under a local alias and may subtype an imported label, apply a mixin, or declare edges touching imported types. It may never mutate an imported definition.

Sealing imports keeps them referentially transparent: a shared type means the same thing to every consumer, so generated output is deterministic and cacheable. The diamond case — two modules importing a common vocabulary into a third — resolves by identity rather than by merge.

## Namespaces

Each model declares a prefix and a base IRI. The import alias is only a local binding; the IRI is the global identity of every type the model defines.

A single concept serves both composition and RDF. Identity by IRI rather than by file path means the diamond case still resolves when the same vocabulary is vendored at two different paths, which path identity alone would get wrong. Because IRIs are name-derived, renaming a type changes its identity for RDF consumers, so a rename should also emit an equivalence assertion to the previous IRI.

## Prefixes

Beyond its own namespace, a model may bind further prefixes to base IRIs with a `prefixes:` map. Every binding is declared in the RDF documents generated from the model.

The shape is a JSON-LD context: prefix to base IRI, and nothing else. Without it a model that mentions a vocabulary by CURIE emits a document where that CURIE is unbound, which no RDF parser will read. Bindings resolve across a closure with the entry file winning, so a consumer can rebind a vendored vocabulary without editing it — the same rule [[metamodel#Composition]] applies to imports.
