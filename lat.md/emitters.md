# Emitters

An emitter turns the resolved intermediate representation into an artifact for one target: database DDL, a migration script, or an RDF document. Every emitter declares what it can and cannot express.

## Capability Matrix

Each emitter publishes a typed capability set. The compiler computes which capabilities a model requires and reports every downgrade as an editor diagnostic, with per-target configurable severity.

The set covers the hierarchy, identity, and edge properties, plus [[metamodel#Lists|lists]], [[metamodel#Composite Types|composites]], [[metamodel#Enums]], [[metamodel#Open and Closed Types|openness]], and [[metamodel#Cardinality]].

A downgrade is reported only when a model actually uses the feature. A target that cannot enforce closure says so in the capability set, but does not raise a diagnostic on every closed type, which would be noise on every model rather than information.

Constraint downgrades are reported at `info` rather than `warning`. Six of the eight targets can carry no [[metamodel#Value Constraints|value]] or [[metamodel#Named Constraints|named]] constraint at all, so a warning apiece would bury the downgrades that are genuinely surprising — a `required` property that silently vanishes is a different class of problem from SHACL being the only place a regular expression can live. One shared reporter emits them, so the five cannot drift apart in what they say.

A capability value is not always a yes or a no. LadybugDB declares [[metamodel#Cardinality]] as `upper-bound-only`, because its multiplicity keyword says an end holds at most one and nothing else. Collapsing that to `enforced` would be the exact overstatement the matrix exists to prevent, so the partial case gets its own value rather than being rounded up.

A comment is also injected at the lossy site in the generated file, so an operator reading the DDL sees the same information as the author reading the editor. A comment is prose for a reader, not a record: anything a machine has to read back is asserted instead — see [[importers#Reading Edges]].

Three lossiness cases exist before a line of emitter code is written: Ladybug has no multi-label nodes, Neo4j existence and node-key constraints are Enterprise-only, and generic Cypher engines have no schema facility at all. Silent best-effort was rejected because a `required` constraint that quietly vanishes is a data-integrity bug that surfaces in production. This declared capability set is also the seam the deferred public plugin API will expose — see [[architecture#Modularity]].

## Ladybug Target

LadybugDB, formerly Kuzu, is an embedded Cypher property graph database with a mandatory closed schema: `CREATE NODE TABLE` and `CREATE REL TABLE` with typed columns, a required primary key, and declared endpoint pairs.

An abstract hierarchy is flattened to one node table per concrete leaf type, with inherited columns copied down. The cost is that an edge declared on an abstract endpoint expands to a cross-product of endpoint pairs, and adding a subtype becomes a schema migration.

Every scalar in [[metamodel#Scalar Types]] is a native column type here, which is not a coincidence: the metamodel's type set was drawn from what this engine stores. The integer widths, the unsigned variants, `DECIMAL` with its parameters, `INTERVAL`, `BLOB` and `JSON` all exist, so this target reports no type downgrade at all. Measured against 0.19.1, `json` is a real column type that reads back as a value rather than as text, where it used to be stored as `STRING`.

Its [[metamodel#Composite Types|composites]] are native here too, and only here: `STRUCT`, `MAP`, `UNION` and the fixed-size `ARRAY` reach a column exactly as written, nesting included. The execution test reads the column type back out of the catalogue, so it proves the type survived rather than only that the DDL parsed.

Two more features are carried natively. A [[metamodel#Lists|list]] property becomes a `STRING[]` column, and [[metamodel#Cardinality]] becomes the trailing multiplicity keyword — `MANY_ONE` and its siblings — which, measured against a running instance, really is rejected on write. It is one of the few constraints this target enforces rather than reports.

The keyword encodes only an upper bound of one per end. A minimum, or a maximum above one, has no spelling at all, so a bound like `{ to: "2" }` emits no keyword and is reported instead. Because a downgrade is written as a comment where a column would go, the separator has to be attached to the last real entry rather than the last line: a comma before the closing parenthesis is a parse error, which the execution test caught and a golden file would not have.

Measured against LadybugDB 0.19.1, `CHECK` constraints, non-key `UNIQUE`, and an `ENUM` column type are all rejected by the parser. Richer constraints therefore have nowhere to go on this target, and belong to [[emitters#RDF Targets#SHACL Shapes]].

Measured against LadybugDB 0.19.1, the engine enforces less than the flattening suggests. `NOT NULL` is not accepted by the parser and a null non-key value inserts successfully, so a required property that is not the key is unenforceable and is reported as a downgrade. A composite `PRIMARY KEY` does not parse either, so a composite key must be emitted as a synthesized column. Only primary key uniqueness and primary key presence are actually enforced.

Comments in generated DDL use `//`. The SQL-style `--` is rejected by the parser, which the execution test caught and a golden file alone would not have.

The alternative of a single root table with a discriminator column is the idiom used by the multipartite pattern in the author's own work, and remains a reasonable per-model override, but it cannot enforce a property that is required on only one subtype.

### Measured ALTER Support

What a Ladybug migration may change in place was measured against 0.19.1, not taken from documentation, and the planner is built on exactly these findings.

Accepted: adding a column (with or without `DEFAULT`), dropping a column, renaming a column — the primary key column included — renaming a table, and adding or dropping a `FROM … TO …` pair on a rel table. A rename carries its rows and relationships with it, and a rel table's pairs follow a renamed node table.

Refused: there is no statement that changes a column's type (`ALTER` accepts only `ADD`, `DROP`, `RENAME` and `SET`); a primary key column cannot be dropped; and a node table cannot be dropped while a rel table still references it.

One finding is a hazard rather than a refusal. Dropping a rel table's *last* endpoint pair is accepted, and the next statement against that table crashes the engine process. Adding the new pair before dropping the old one is safe, so the planner never empties a table's pairs and recreates the table instead.

## Neo4j Target

Neo4j is schema-optional: there is no table DDL, only constraints and indexes. Multi-label nodes are native, so an abstract hierarchy flattens to labels rather than to separate tables.

The emitter is edition-aware. Existence and node-key constraints require Enterprise, so under a Community configuration they are reported as downgrades and emitted as comments rather than silently dropped.

## FalkorDB Target

FalkorDB is schema-optional and multi-label, so like Neo4j it carries a hierarchy as labels rather than as tables. What it does not share is the edition split.

`MANDATORY` enforces existence on any instance, so a required property is genuinely enforced here — the only database target where it is. Ladybug can enforce presence on the key alone, and Neo4j needs Enterprise, so this is the one target where the model's commonest constraint costs nothing to hold.

The schema is split across two protocols: an index is Cypher, a constraint is the Redis command `GRAPH.CONSTRAINT CREATE`. No client applies both, so the artifact is a shell script over `redis-cli` rather than a `.cypher` file. That also settles where the downgrade notes go: a line a redis pipe does not understand is an error, while a shell comment is a comment.

A unique constraint requires its exact-match index to already exist, so the index is emitted immediately above the constraint needing it rather than in a block of its own — the order of the file is the order the engine requires. A key emits `UNIQUE` over its properties plus `MANDATORY` on each, because `UNIQUE` alone is enforced only where every constrained property is non-null, which is not what a key claims.

Two operational facts are stated in the artifact rather than assumed away. Enforcement is asynchronous — the command returns `PENDING`, and a constraint that existing data violates ends `FAILED` and is never enforced — and there is no `IF NOT EXISTS` for either an index or a constraint, so a second run reports each as already existing.

A map cannot be stored as a property value, so a [[metamodel#Composite Types|composite]] has nowhere to go and is reported, exactly as on [[emitters#Neo4j Target|Neo4j]]. An array can be stored, so a list is native.

### Measured DROP Syntax

What a FalkorDB migration may drop, and in what order, was measured against a FalkorDB 4.20.4 container rather than inferred from the create syntax.

A constraint is dropped with `GRAPH.CONSTRAINT DROP <key> UNIQUE|MANDATORY NODE|RELATIONSHIP <label> PROPERTIES <n> <props>` and an index with the Cypher `DROP INDEX FOR (n:<label>) ON (n.<prop>)`. Neither has `IF EXISTS`, and dropping what is absent is an error.

An index that a unique constraint depends on cannot be dropped ("Index supports constraint"), so every constraint drop comes before every index drop. Indexes are per property: `CREATE INDEX … ON (n.a, n.b)` creates two, `DROP INDEX … ON (n.a, n.b)` removes only one, and a composite create fails outright if any of its properties is already indexed. A migration therefore drops, and adds to, an index one property at a time.

The status of constraints is read with `CALL db.constraints()`. `GRAPH.CONSTRAINT LIST` is rejected by 4.20.4, although the emitted schema script's header still names it.

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

This is the only target that carries [[metamodel#Value Constraints]], [[metamodel#Named Constraints]], and the [[metamodel#Escape Hatch]], which is what makes it the artifact a constraint goes to when no database can hold it. Each named constraint becomes a shape of its own targeting the same class, rather than another property on the type's shape: one shape per constraint is what lets each carry its own `sh:message`, which folded together would appear to explain every rule on the type. A qualified count becomes `sh:qualifiedValueShape`, a choice becomes `sh:or`, and a comparison becomes `sh:lessThan` and its siblings. The qualifying class is looked up the way an edge endpoint is, so a type from an imported model keeps its own namespace; building it from the constrained type's prefix named a class that did not exist.

A [[metamodel#Named Constraints#Severity|severity]] becomes `sh:severity`, written beside the `sh:message` on whichever shape reports the result. For a comparison or a count that is the property shape, because SHACL takes a result's severity from the shape that produced it, and a severity on the enclosing node shape would never reach it. A choice reports from the node shape itself. `violation` is SHACL's default, so it is never written.

A closed type becomes `sh:closed`, which is only sound because a shape is emitted for every relation leaving the type as well as for every property. A shape that named only the datatype properties would reject any node that had an edge.

Cardinality is emitted in both directions and in full: the bound at the `to` end becomes `sh:minCount` and `sh:maxCount` on the forward relation, and the bound at the `from` end becomes the same counts under a `sh:inversePath` on the target's shape. This is the only target that expresses an exact count, which is what makes it the place a constraint goes when no database can hold it.

### OWL Subset

OWL is emitted alongside SHACL but restricted to the safe assertional subset: classes, `subClassOf`, `hasKey`, disjointness, and inverse properties. Domain and cardinality restrictions are deliberately omitted.

An [[metamodel#Enums|enum]] is the one constraint that does cross over, as an OWL 2 datatype definition — `rdfs:Datatype` with `owl:oneOf` — used as the property's range. That is assertional and stays inside OWL DL, so it neither invites a reasoner to reclassify individuals nor breaks one.

### Gradual Reification

An edge with no properties becomes a plain object property. An edge that carries properties becomes an n-ary relation class plus a shortcut property, and its SHACL shape targets that class.

The subject and object properties of a reified class each carry an `sh:class`, which is what lets a reader tell a relationship from an ordinary node type without parsing a comment. See [[importers#Reading Edges]].

Reifying only what needs it follows the treatment of property graphs as accidental metagraphs in the author's work, where edge properties are already implicit reified edges. Staying inside OWL DL keeps reasoners working, at the cost of the graph shape differing between edge types. RDF-star was rejected as the uniform representation because OWL DL reasoners do not handle quoted triples and SHACL cannot constrain them.

## Composite Types

Only the ladybug target stores a [[metamodel#Composite Types|composite]]. The other six report one downgrade per composite property and emit the scalar it degrades to, so a model that uses a struct still generates a usable artifact everywhere else.

The downgrade is raised by one shared reporter rather than per emitter, for the same reason the constraint downgrades are: six targets saying the same thing in six wordings would drift. It is a `warning` rather than the `info` used for constraints, because a property whose structure silently flattens is the surprising kind of loss — the kind the capability matrix exists to surface.

What each target keeps is what it already had a place for. GQL and PG-Schema write the element scalar, wrapped in `LIST<…>` when the composite holds many; LinkML writes the corresponding range with `multivalued`; SHACL and OWL write the XSD datatype. Neo4j has no type DDL at all, so it writes a comment saying the value is unstorable: a Neo4j property is a primitive or an array of primitives, and a struct would have to become its own node, which the model does not say to do.

Reifying a struct into a node shape was the alternative for the RDF targets. It was rejected because it invents graph structure the author did not write — a node with an identity the model never gave it — which is the [[metamodel#Composition]] problem rather than a datatype mapping.

## Migrations

A canonical, stable-ordered snapshot of the IR is committed alongside the model. Diffing the snapshot against the current model produces an ordered migration script, reviewable in version control and requiring no database connection.

Destructive changes are gated behind an explicit flag. Renames are detected through [[metamodel#Stable Element IDs]] rather than inferred from structural similarity, because a diff alone cannot distinguish a rename from a drop-plus-add, and guessing wrong generates a migration that destroys data.

`lpg lock` records the baseline, `lpg diff` prints and gates on the change set, and `lpg migrate` writes one script per database target — `<stem>.<revision>.<target>.<ext>`, the revision four digits wide — and then advances the lockfile. Only ladybug, neo4j and falkordb are migrated; every other target is regenerated, and naming one is `not-migratable`. Migrating a subset of the three is allowed but warned about, because the lockfile is per model rather than per target.

### Lockfile

The lockfile is `<stem>.lpg.lock.json` beside the model: canonical JSON of the resolved IR, headed by `lockfileVersion`, the model format `lpg`, and a `revision` that numbers the migrations taken from it.

It snapshots the *resolved* model, not the declarations, because the targets consume flattened IR: a mixin change reaching five tables should read as five column changes, which is what a script must contain. JSON rather than YAML, because it is machine-written and sorted-key JSON is trivially canonical.

[[packages/core/src/migrate/lockfile.ts#writeLockfile]] makes it byte-identical for the same model whatever the file's layout. Keys are sorted in code-unit order, so the locale cannot change it. Every array of identified elements is sorted by element id, so reordering declarations changes nothing, while arrays whose order carries meaning — a key, an ancestor chain, a mixin list — keep it. What is not semantics is stripped: source locations, the file path, and whether an id was derived. Sorting by name was rejected because a rename would then look like a move within the file.

Reading is total, as everywhere else: [[packages/core/src/migrate/lockfile.ts#readLockfile]] reports a file that is not JSON or not the expected shape as `lockfile-unreadable`, and one written by a newer format as `lockfile-newer`, telling the user to upgrade rather than overwrite it.

A model is lockable only when every element id is written in its file. A derived id follows the element's name, so a rename would read as a removal plus an addition; [[packages/core/src/migrate/lockfile.ts#idsNotWritten]] raises `ids-not-written` for each such element, once where it is declared rather than once per type it reaches.

### Change Classification

The lockfile and the current model are diffed by element id, and every change is classed `additive`, `breaking` or `destructive` so a pull request can be gated on how dangerous it is.

Elements are matched per kind by id. A flattened property is identified by its owner type's id together with its own, because one property id appears on every type that inherits it — so a change to an inherited property arrives once per concrete owner, which is the shape a flattening target needs. One element can yield several changes: a rename plus a retype is two. A property whose id was replaced by hand is therefore a removal and an addition, and a property moved up to an ancestor is a `moved` change that no flattened target sees.

Classification is a pure table over the change's kind and its direction — whether it loosens, tightens, or loses data — so the diff decides *what* happened and [[packages/core/src/migrate/classify.ts#classify]] decides how much it matters:

- Losing data is always `destructive`, whatever the kind.
- A rename, a rekey, changed endpoints and a changed namespace are always `breaking`: every query naming the old form stops matching, whichever way it moved.
- A move between owners is always `additive`.
- Otherwise loosening is `additive` and tightening is `breaking`.

An unknown direction is classed as tightening. A false alarm costs a reviewer a look; a false `additive` costs production data.

### Destructive Gate

`lpg migrate` refuses a migration that would discard stored data unless `--allow-destructive` is given, and a refusal writes no script and leaves the lockfile where it was.

The gate asks two questions, because a change can be safe in the model and still unsafe on a target. The first is whether the change set holds a `destructive` change. The second is whether any target can only *apply* a change by discarding data: a key change is merely `breaking`, but Ladybug cannot change a primary key in place and has to recreate the table. A planner reports such a statement as a realization, the gate refuses on it as it would on a destructive change, and the target raises a `migration-downgrade` naming what it cannot do.

Every target is planned before anything is written, so the gate judges the whole migration; refusing after two of three scripts were on disk would leave a half-migrated set and a lockfile agreeing with neither. [[packages/core/src/migrate/index.ts#planMigration]] holds that order. When permitted, every destructive statement is preceded by a `DESTRUCTIVE:` comment naming the element, and the CLI writes the scripts first and the lockfile last, so a failed write keeps the old baseline.

A change no target stores — a value pattern, an enum value — still advances the lockfile, and each script says it has no schema effect rather than being left empty.

### Target Planners

Each database target registers a planner beside its emitter, and every planner builds statements with the emitter's own functions, so a migration cannot spell a table, column or constraint differently from `emit`.

The Ladybug planner, [[packages/core/src/emit/ladybug.migrate.ts#migrateLadybug]], diffs the *tables* the two revisions flatten to, not the declarations. Tables are matched by type id and columns by property identity, so a property added to an abstract parent is one column per concrete table, and a mixin or hierarchy change is simply columns gained or lost. The order follows the [[emitters#Ladybug Target#Measured ALTER Support|measured]] constraints: drop rel tables and vanished endpoint pairs, drop node tables, rename tables, alter columns, then create node tables, rel tables and new pairs. What cannot be done in place is realized destructively and gated: a key change or a multiplicity change recreates the table, a type change drops and re-adds the column, and a rel table losing every pair is recreated.

The Neo4j and FalkorDB planners, [[packages/core/src/emit/neo4j.migrate.ts#migrateNeo4j]] and [[packages/core/src/emit/falkordb.migrate.ts#migrateFalkorDb]], are set differences over the schema objects the emitter builds for each revision. They drop what only the old revision had, rewrite the data a rename or a hierarchy change touches — relabelling nodes, moving a property, copying relationships to a new type, adding or removing ancestor labels — and then create what only the new revision has, so a renamed type's old constraint never sees the relabelled nodes. Neo4j batches data steps in `CALL { … } IN TRANSACTIONS`; FalkorDB follows its [[emitters#FalkorDB Target#Measured DROP Syntax|measured]] drop order. A removed concrete type also has its nodes deleted, and only under the flag, since that step is destructive.

The Ladybug planner is checked by an oracle: for every before/after fixture pair, a database built from the old DDL and migrated must have the same catalogue as one built from the new DDL, and rows must survive a rename. The catalogue does not record multiplicity, so that is checked by writing. The FalkorDB scripts were run the same way against a container, once, while the planner was written; they are pinned by golden files, as are the Neo4j scripts, which have no embedded engine to run against.

## Verification

Every emitter has golden-file tests for output stability. The Ladybug target additionally executes its generated DDL against an in-process LadybugDB instance, then asserts that the declared constraints actually reject invalid data.

The standards targets are the other side of this rule: GQL, PG-Schema, and LinkML have no engine to execute against, so they assert on the structures that matter — implied labels, PG-Keys constraints, `is_a` — rather than on a golden file alone. The LinkML output is additionally parsed back as YAML, so a formatting slip cannot pass as a valid schema.

Real execution is affordable here because the database is embedded: `@ladybugdb/core` provides native bindings and `@ladybugdb/wasm-core` a WebAssembly build, so no container is required. Two engine defaults are bounded for that to hold: `maxDBSize` reserves 8 TiB of address space per database, and the buffer pool is sized from system memory, so a test file opening one database per test exhausts the mapping when several files run in parallel. Neo4j and Memgraph have no embedded mode, so they keep golden coverage with containerised tests gated behind an opt-in flag. A golden file alone only proves that output has not changed, not that it is valid.
