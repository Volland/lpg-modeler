# Emitters

An emitter turns the resolved intermediate representation into an artifact for one target: database DDL, a migration script, or an RDF document. Every emitter declares what it can and cannot express.

## Capability Matrix

Each emitter publishes a typed capability set. The compiler computes which capabilities a model requires and reports every downgrade as an editor diagnostic, with per-target configurable severity.

The set covers the hierarchy, identity, and edge properties, plus [[metamodel#Lists|lists]], [[metamodel#Enums]], [[metamodel#Open and Closed Types|openness]], and [[metamodel#Cardinality]].

A downgrade is reported only when a model actually uses the feature. A target that cannot enforce closure says so in the capability set, but does not raise a diagnostic on every closed type, which would be noise on every model rather than information.

Constraint downgrades are reported at `info` rather than `warning`. Five of the seven targets can carry no [[metamodel#Value Constraints|value]] or [[metamodel#Named Constraints|named]] constraint at all, so a warning apiece would bury the downgrades that are genuinely surprising — a `required` property that silently vanishes is a different class of problem from SHACL being the only place a regular expression can live. One shared reporter emits them, so the five cannot drift apart in what they say.

A capability value is not always a yes or a no. LadybugDB declares [[metamodel#Cardinality]] as `upper-bound-only`, because its multiplicity keyword says an end holds at most one and nothing else. Collapsing that to `enforced` would be the exact overstatement the matrix exists to prevent, so the partial case gets its own value rather than being rounded up.

A comment is also injected at the lossy site in the generated file, so an operator reading the DDL sees the same information as the author reading the editor.

Three lossiness cases exist before a line of emitter code is written: Ladybug has no multi-label nodes, Neo4j existence and node-key constraints are Enterprise-only, and generic Cypher engines have no schema facility at all. Silent best-effort was rejected because a `required` constraint that quietly vanishes is a data-integrity bug that surfaces in production. This declared capability set is also the seam the deferred public plugin API will expose — see [[architecture#Modularity]].

## Ladybug Target

LadybugDB, formerly Kuzu, is an embedded Cypher property graph database with a mandatory closed schema: `CREATE NODE TABLE` and `CREATE REL TABLE` with typed columns, a required primary key, and declared endpoint pairs.

An abstract hierarchy is flattened to one node table per concrete leaf type, with inherited columns copied down. The cost is that an edge declared on an abstract endpoint expands to a cross-product of endpoint pairs, and adding a subtype becomes a schema migration.

Every scalar in [[metamodel#Scalar Types]] is a native column type here, which is not a coincidence: the metamodel's type set was drawn from what this engine stores. The integer widths, the unsigned variants, `DECIMAL` with its parameters, `INTERVAL`, `BLOB` and `JSON` all exist, so this target reports no type downgrade at all. Measured against 0.19.1, `json` is a real column type that reads back as a value rather than as text, where it used to be stored as `STRING`.

Two more features are carried natively. A [[metamodel#Lists|list]] property becomes a `STRING[]` column, and [[metamodel#Cardinality]] becomes the trailing multiplicity keyword — `MANY_ONE` and its siblings — which, measured against a running instance, really is rejected on write. It is one of the few constraints this target enforces rather than reports.

The keyword encodes only an upper bound of one per end. A minimum, or a maximum above one, has no spelling at all, so a bound like `{ to: "2" }` emits no keyword and is reported instead. Because a downgrade is written as a comment where a column would go, the separator has to be attached to the last real entry rather than the last line: a comma before the closing parenthesis is a parse error, which the execution test caught and a golden file would not have.

Measured against LadybugDB 0.19.1, `CHECK` constraints, non-key `UNIQUE`, and an `ENUM` column type are all rejected by the parser. Richer constraints therefore have nowhere to go on this target, and belong to [[emitters#RDF Targets#SHACL Shapes]].

Measured against LadybugDB 0.19.1, the engine enforces less than the flattening suggests. `NOT NULL` is not accepted by the parser and a null non-key value inserts successfully, so a required property that is not the key is unenforceable and is reported as a downgrade. A composite `PRIMARY KEY` does not parse either, so a composite key must be emitted as a synthesized column. Only primary key uniqueness and primary key presence are actually enforced.

Comments in generated DDL use `//`. The SQL-style `--` is rejected by the parser, which the execution test caught and a golden file alone would not have.

The alternative of a single root table with a discriminator column is the idiom used by the multipartite pattern in the author's own work, and remains a reasonable per-model override, but it cannot enforce a property that is required on only one subtype.

## Neo4j Target

Neo4j is schema-optional: there is no table DDL, only constraints and indexes. Multi-label nodes are native, so an abstract hierarchy flattens to labels rather than to separate tables.

The emitter is edition-aware. Existence and node-key constraints require Enterprise, so under a Community configuration they are reported as downgrades and emitted as comments rather than silently dropped.

## Standards Targets

Three targets exist to make a model readable by tools this project does not own: GQL graph types, PG-Schema, and LinkML. None of them is a database dialect, and none can be executed against an engine, so all three carry golden coverage only.

The reason to emit a standard rather than adopt one as the model format is that no standard covers what a model file has to do. PG-Schema and GQL graph types are textual DSLs with nowhere to hang [[metamodel#Stable Element IDs]], import aliases, or a rename's previous IRI, and neither has a namespace concept the RDF targets need. LinkML is the closest serialization, but it has no binary edge carrying properties, so adopting it would force the uniform reification that [[emitters#RDF Targets#Gradual Reification]] exists to avoid.

## GQL Target

GQL graph types, per ISO/IEC 39075. A graph type is a list of element types, each naming an identifying label, the labels it implies, and its typed properties.

Label implication carries the hierarchy: a concrete type is identified by its own label and implies every ancestor's, so an edge on an abstract endpoint stays one element type rather than expanding to a cross-product the way [[emitters#Ladybug Target]] must. Abstract types therefore get no element type of their own — they exist only as implied labels. Mixins are property bundles rather than labels, so they contribute properties only, the same reading [[emitters#Neo4j Target]] takes.

Two things are lost. A key marker attaches to a single property, so a composite key is a reported downgrade, and `uuid` and `json` have no GQL value type. Engines disagree on the statement that installs a graph type — Neo4j writes the same body after `ALTER CURRENT GRAPH TYPE SET` — so the generated file says as much in a header comment rather than claiming portability it does not have.

## PG-Schema Target

PG-Schema, the LDBC Property Graph Schema Working Group formalism that GQL's graph types grew out of. It is the most faithful target: `ABSTRACT`, inheritance, mixins, and keys all have direct counterparts, so nothing about the hierarchy is flattened.

A mixin becomes an abstract type declared without a label, which is precisely what a mixin is here. Keys become PG-Keys constraints, stated once on the type that owns them because subtypes inherit them; a composite key needs no synthesized column, unlike [[emitters#Ladybug Target]]. `STRICT` is emitted because the closed-world reading it names is the one this metamodel already has. Only `uuid` and `json` are downgrades.

## LinkML Target

LinkML, the linked-data modelling language. Classes, `is_a`, and `mixins` line up almost directly with this metamodel, which is what makes the target worth having: it opens the LinkML generator ecosystem to a model authored here.

Every class and slot carries the IRI it has in this model, so identity survives the round trip rather than degrading to a local name. A single key becomes an `identifier`; a composite key and every other unique property become `unique_keys`, which is the only mechanism LinkML has for them.

The mismatch is edges. LinkML has no binary relation that can hold properties, so [[emitters#RDF Targets#Gradual Reification]] applies here too and the reification is a reported downgrade. The shortcut property the RDF targets emit is deliberately omitted: in a schema meant to be generated from, it would imply a second place the same fact is written.

A slot carries an upper bound of one as `multivalued: false` and a lower bound of one as `required`. Any other bound — an exact count, or a maximum above one — has no LinkML spelling and is reported.

LinkML has one `integer`, so every [[metamodel#Scalar Types#Integer Widths|width]] lands on it: a width is a storage detail there rather than a different type, and reporting each as a downgrade would bury the four that are real ones — `uuid`, `json`, `duration` and `blob`, none of which LinkML has a range for.

## Template Targets

Targets that cannot be tested against a running instance are not shipped as code. Instead the resolved IR is exposed to a user-supplied template, so an additional dialect is a small amount of configuration rather than a feature request.

Cypher compatibility is a marketing category rather than a dialect: Ladybug, Neo4j, Memgraph, and Apache AGE disagree on nearly everything schema-related, and a generic emitter would have no reference implementation to test against.

The rule is about reference implementations, not about running engines, which is why [[emitters#Standards Targets]] ship as code despite having no instance to execute against. A published specification is a reference an emitter can be held to; a dialect nobody has specified is not.

## RDF Targets

The ontology export is split in two because a property graph schema and an OWL ontology do not mean the same thing. A schema is a closed-world constraint; OWL is open-world inference.

Emitting `rdfs:domain` for an edge type does not constrain anything — it instructs a reasoner that anything with that relation belongs to the domain class, silently reclassifying unrelated individuals. Mapping constraints naively into OWL does not lose information so much as invert its meaning.

### SHACL Shapes

SHACL is the primary constraint artifact. It is closed-world validation, so required, datatype, [[metamodel#Cardinality]], [[metamodel#Enums]], and closure all translate faithfully, and a generated shape genuinely rejects invalid data.

Uniqueness is the exception: across all instances it needs a SPARQL-based constraint, which core SHACL cannot express, so it is reported as a downgrade rather than emitted.

This is the only target that carries [[metamodel#Value Constraints]], [[metamodel#Named Constraints]], and the [[metamodel#Escape Hatch]], which is what makes it the artifact a constraint goes to when no database can hold it. Each named constraint becomes a shape of its own targeting the same class, rather than another property on the type's shape: one shape per constraint is what lets each carry its own `sh:message`, which folded together would appear to explain every rule on the type. A qualified count becomes `sh:qualifiedValueShape`, a choice becomes `sh:or`, and a comparison becomes `sh:lessThan` and its siblings.

A closed type becomes `sh:closed`, which is only sound because a shape is emitted for every relation leaving the type as well as for every property. A shape that named only the datatype properties would reject any node that had an edge.

Cardinality is emitted in both directions and in full: the bound at the `to` end becomes `sh:minCount` and `sh:maxCount` on the forward relation, and the bound at the `from` end becomes the same counts under a `sh:inversePath` on the target's shape. This is the only target that expresses an exact count, which is what makes it the place a constraint goes when no database can hold it.

### OWL Subset

OWL is emitted alongside SHACL but restricted to the safe assertional subset: classes, `subClassOf`, `hasKey`, disjointness, and inverse properties. Domain and cardinality restrictions are deliberately omitted.

An [[metamodel#Enums|enum]] is the one constraint that does cross over, as an OWL 2 datatype definition — `rdfs:Datatype` with `owl:oneOf` — used as the property's range. That is assertional and stays inside OWL DL, so it neither invites a reasoner to reclassify individuals nor breaks one.

### Gradual Reification

An edge with no properties becomes a plain object property. An edge that carries properties becomes an n-ary relation class plus a shortcut property, and its SHACL shape targets that class.

Reifying only what needs it follows the treatment of property graphs as accidental metagraphs in the author's work, where edge properties are already implicit reified edges. Staying inside OWL DL keeps reasoners working, at the cost of the graph shape differing between edge types. RDF-star was rejected as the uniform representation because OWL DL reasoners do not handle quoted triples and SHACL cannot constrain them.

## Migrations

A canonical, stable-ordered snapshot of the IR is committed alongside the model. Diffing the snapshot against the current model produces an ordered migration script, reviewable in version control and requiring no database connection.

Destructive changes are gated behind an explicit flag. Renames are detected through [[metamodel#Stable Element IDs]] rather than inferred from structural similarity, because a diff alone cannot distinguish a rename from a drop-plus-add, and guessing wrong generates a migration that destroys data.

## Verification

Every emitter has golden-file tests for output stability. The Ladybug target additionally executes its generated DDL against an in-process LadybugDB instance, then asserts that the declared constraints actually reject invalid data.

The standards targets are the other side of this rule: GQL, PG-Schema, and LinkML have no engine to execute against, so they assert on the structures that matter — implied labels, PG-Keys constraints, `is_a` — rather than on a golden file alone. The LinkML output is additionally parsed back as YAML, so a formatting slip cannot pass as a valid schema.

Real execution is affordable here because the database is embedded: `@ladybugdb/core` provides native bindings and `@ladybugdb/wasm-core` a WebAssembly build, so no container is required. Neo4j and Memgraph have no embedded mode, so they keep golden coverage with containerised tests gated behind an opt-in flag. A golden file alone only proves that output has not changed, not that it is valid.
