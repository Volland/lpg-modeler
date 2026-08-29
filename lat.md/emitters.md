# Emitters

An emitter turns the resolved intermediate representation into an artifact for one target: database DDL, a migration script, or an RDF document. Every emitter declares what it can and cannot express.

## Capability Matrix

Each emitter publishes a typed capability set. The compiler computes which capabilities a model requires and reports every downgrade as an editor diagnostic, with per-target configurable severity.

A comment is also injected at the lossy site in the generated file, so an operator reading the DDL sees the same information as the author reading the editor.

Three lossiness cases exist before a line of emitter code is written: Ladybug has no multi-label nodes, Neo4j existence and node-key constraints are Enterprise-only, and generic Cypher engines have no schema facility at all. Silent best-effort was rejected because a `required` constraint that quietly vanishes is a data-integrity bug that surfaces in production. This declared capability set is also the seam the deferred public plugin API will expose — see [[architecture#Modularity]].

## Ladybug Target

LadybugDB, formerly Kuzu, is an embedded Cypher property graph database with a mandatory closed schema: `CREATE NODE TABLE` and `CREATE REL TABLE` with typed columns, a required primary key, and declared endpoint pairs.

An abstract hierarchy is flattened to one node table per concrete leaf type, with inherited columns copied down. This plays to the engine's strength of typed non-null columns and real constraint enforcement. The cost is that an edge declared on an abstract endpoint expands to a cross-product of endpoint pairs, and adding a subtype becomes a schema migration.

The alternative of a single root table with a discriminator column is the idiom used by the multipartite pattern in the author's own work, and remains a reasonable per-model override, but it cannot enforce a property that is required on only one subtype.

## Neo4j Target

Neo4j is schema-optional: there is no table DDL, only constraints and indexes. Multi-label nodes are native, so an abstract hierarchy flattens to labels rather than to separate tables.

The emitter is edition-aware. Existence and node-key constraints require Enterprise, so under a Community configuration they are reported as downgrades and emitted as comments rather than silently dropped.

## Template Targets

Targets that cannot be tested against a running instance are not shipped as code. Instead the resolved IR is exposed to a user-supplied template, so an additional dialect is a small amount of configuration rather than a feature request.

Cypher compatibility is a marketing category rather than a dialect: Ladybug, Neo4j, Memgraph, and Apache AGE disagree on nearly everything schema-related, and a generic emitter would have no reference implementation to test against. Only targets verifiable against a real engine ship as first-class code.

## RDF Targets

The ontology export is split in two because a property graph schema and an OWL ontology do not mean the same thing. A schema is a closed-world constraint; OWL is open-world inference.

Emitting `rdfs:domain` for an edge type does not constrain anything — it instructs a reasoner that anything with that relation belongs to the domain class, silently reclassifying unrelated individuals. Mapping constraints naively into OWL does not lose information so much as invert its meaning.

### SHACL Shapes

SHACL is the primary constraint artifact. It is closed-world validation, so required, unique, cardinality, and datatype translate faithfully and a generated shape genuinely rejects invalid data.

### OWL Subset

OWL is emitted alongside SHACL but restricted to the safe assertional subset: classes, `subClassOf`, `hasKey`, disjointness, and inverse properties. Domain, range, and cardinality restrictions are deliberately omitted.

### Gradual Reification

An edge with no properties becomes a plain object property. An edge that carries properties becomes an n-ary relation class plus a shortcut property, and its SHACL shape targets that class.

Reifying only what needs it follows the treatment of property graphs as accidental metagraphs in the author's work, where edge properties are already implicit reified edges. Staying inside OWL DL keeps reasoners working, at the cost of the graph shape differing between edge types. RDF-star was rejected as the uniform representation because OWL DL reasoners do not handle quoted triples and SHACL cannot constrain them.

## Migrations

A canonical, stable-ordered snapshot of the IR is committed alongside the model. Diffing the snapshot against the current model produces an ordered migration script, reviewable in version control and requiring no database connection.

Destructive changes are gated behind an explicit flag. Renames are detected through [[metamodel#Stable Element IDs]] rather than inferred from structural similarity, because a diff alone cannot distinguish a rename from a drop-plus-add, and guessing wrong generates a migration that destroys data.

## Verification

Every emitter has golden-file tests for output stability. The Ladybug target additionally executes its generated DDL against an in-process LadybugDB instance, then asserts that the declared constraints actually reject invalid data.

Real execution is affordable here because the database is embedded: `@ladybugdb/core` provides native bindings and `@ladybugdb/wasm-core` a WebAssembly build, so no container is required. Neo4j and Memgraph have no embedded mode, so they keep golden coverage with containerised tests gated behind an opt-in flag. A golden file alone only proves that output has not changed, not that it is valid.
