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

## Composition

A model imports other models under a local alias and may subtype an imported label, apply a mixin, or declare edges touching imported types. It may never mutate an imported definition.

Sealing imports keeps them referentially transparent: a shared type means the same thing to every consumer, so generated output is deterministic and cacheable. The diamond case — two modules importing a common vocabulary into a third — resolves by identity rather than by merge.

## Namespaces

Each model declares a prefix and a base IRI. The import alias is only a local binding; the IRI is the global identity of every type the model defines.

A single concept serves both composition and RDF. Identity by IRI rather than by file path means the diamond case still resolves when the same vocabulary is vendored at two different paths, which path identity alone would get wrong. Because IRIs are name-derived, renaming a type changes its identity for RDF consumers, so a rename should also emit an equivalence assertion to the previous IRI.
