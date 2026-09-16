# Importers

An importer reads a foreign schema back into the intermediate representation, so a model can start from what a team already has rather than from an empty file. It is the inverse of an [[emitters|emitter]], and lossy in the other direction.

Every entry point before this one needed a model to already exist. Importing is what makes the tool adoptable by a team with a shapes graph, an ontology, or a database schema and no appetite for retyping it.

An importer never reports a clean result it did not achieve. What a source cannot carry is raised as a diagnostic, in the same voice the [[emitters#Capability Matrix]] uses for a downgrade: the inbound direction of the same rule that nothing disappears quietly.

## Importers

Each importer is registered by name, mirroring the emitter registry exactly, so adding a source is a file plus one entry. This is the same seam the deferred public plugin API would expose — see [[architecture#Modularity]].

The registry also records which extensions a source answers to. A file is placed by its name first and by its first lines second, so `schema.ttl` and a `.txt` file that opens with `@prefix` both arrive at the RDF reader, and a file that matches nothing is reported rather than skipped.

Reading is total, in the manner of [[architecture#Source of Truth|resolution]]: an importer always returns a model plus diagnostics and never throws, so a malformed input yields a partial model and a message rather than a stack trace.

## Why SHACL and OWL Are Read Together

Neither artifact is a model on its own. They are read into one RDF dataset and reconstructed together, which is why the importer takes a list of files rather than one.

SHACL says which class carries which property, what its datatype is, whether it is required, and whether the type is closed. What it does not have is inheritance: a shape is flat, so an inherited property is copied onto every subtype and an abstract parent emits no shape at all.

OWL has exactly what SHACL lacks — `rdfs:subClassOf` for the hierarchy and `owl:hasKey` for identity — and lacks exactly what SHACL has, because the [[emitters#RDF Targets#OWL Subset|OWL subset]] deliberately asserts no `rdfs:domain`. An ontology therefore knows every property in the vocabulary and not one of the types it belongs to.

Read together they reconstruct nearly the whole model. Read apart, each yields a fragment that would need the other to make sense of it.

## What Only OWL Says

A foreign ontology usually does assert `rdfs:domain` and `rdfs:range`, and those are then the only statement of where a property lives. Reading them is what makes an ontology this project did not generate importable at all.

The fallback runs after the shapes have been read and never overrides them: a shape knows the cardinality, the closure and the value constraints that a domain and a range cannot express. It contributes only properties no shape placed. On a round trip of this project's own output it therefore adds nothing, because [[emitters#RDF Targets#OWL Subset|the OWL subset]] asserts no domain — and on a foreign ontology it is the whole of the import.

A domain may name several classes, written as an `owl:unionOf` over a blank node. Those are read as the property belonging to the nearest type they all descend from, for the same reason a plain edge seen once per subtype is collapsed.

An object property with both a domain and a range becomes an edge. One with neither, and no shape naming it, cannot be attached to anything: it is reported as unplaced rather than dropped, because a property in the vocabulary that reached no type is exactly the kind of loss the [[emitters#Capability Matrix|capability matrix]] exists to surface, pointed inbound.

An import carrying no shapes at all is told so. An ontology alone has no cardinality, no value constraints, no open/closed distinction, and no way to tell a reified relation class from a node type — an n-ary relation is an ordinary class to OWL.

## Reading Edges

An edge is recovered from `sh:class` on the property shape that reaches it, and a reified edge from the subject/object pair its class carries.

The far endpoint is asserted rather than described. Emitting it was the change that made the round trip possible: before it, an edge's endpoints appeared only in a Turtle comment, which nothing but a reader can use. The near endpoint needs no assertion, being the class whose shape the property sits on.

[[emitters#RDF Targets#Gradual Reification|Reification]] is what distinguishes a relationship from a type. A class carrying `xSubject` and `xObject` object properties is an edge that happens to have properties, not a node type, and reading it as a type would put a spurious box on the diagram. Its remaining properties are the edge's own.

A plain edge is seen once per subtype allowed to travel it, because a shape is flat. Those sightings are collapsed to the nearest type they all descend from, which puts the declaration back where the model had it.

## Un-flattening Inheritance

A property carried identically by every subtype is moved back up to the parent. This is a reading of the evidence rather than a proof, so every move is reported.

Two subtypes are the least that can distinguish the two readings. A property on the *only* child of a type is exactly as consistent with the child declaring it as with the parent doing so, so nothing is hoisted through a single child — the conservative answer leaves the property where it was seen.

A key is the exception, because `owl:hasKey` attributes it to a type outright. A subtype repeating its parent's key is repeating an inherited declaration, so the key is removed from the child however many siblings it has.

What survives is the hierarchy, not the fact that part of it was abstract: OWL has no notion of an uninstantiable class, so `abstract: true` is reported as lost rather than guessed at. Mixins go the same way — a [[metamodel#Type Hierarchy#Mixins|mixin]] is flattened into the types that apply it, and nothing in the RDF records that the properties travelled together.

## Ambiguous Datatypes

The XSD map is not injective, so reading a datatype back is a choice rather than a recovery. The commonest scalar is taken and the ambiguity is reported.

`int` and `int128` both write `xsd:integer`; `datetime` and `zoneddatetime` both write `xsd:dateTime`; `string`, `uuid` and `json` all write `xsd:string`. Three scalars collapsing onto one datatype cannot be told apart afterwards by any amount of care.

A foreign datatype outside the XSD set is read as a string and reported, rather than failing the import: a vocabulary that uses one is otherwise perfectly readable.

## Constraints and Enums

Everything SHACL can carry comes back: bounds, lengths, patterns, closure, and the named constraints that live in their own shapes.

An `sh:in` list has values but no name, because the emitter writes the members inline rather than referring to a named enum. A name is made from the property the list sits on, and two properties constrained by the same values share one enum rather than declaring it twice.

A named constraint is recognised by the `<Type>_<name>Shape` naming the emitter uses, and read back into the closed set of [[metamodel#Named Constraints|assertions]] the metamodel allows. A shape that matches none of them is left alone and reported, rather than being forced into the nearest kind.

A constraint's `sh:message` and `sh:severity` are read from the node shape or from its property shape, whichever carries them, because that is where the emitter puts them. A comparison's message used to be lost on import for exactly this reason: it sits inside the property shape, and only the node shape was read.

Uniqueness is not recoverable. Core SHACL cannot express it, so the emitter writes a comment saying so, and a comment is prose for a reader rather than a record.

## Reading LadybugDB DDL

A DDL script is read by parsing its text. Like a database's catalog, it is the one artifact carrying an edge's endpoints and the exact width of every column.

Parsing a script keeps that reader offline and free of dependencies: `@ladybugdb/core` carries native bindings, and the extension inlines everything it uses. The generated script is also the thing a team usually has in version control. A team that has only a database reads it instead, as [[importers#Reading a LadybugDB Database]] describes.

The script is parsed into the same plain catalog a database yields, and [[packages/core/src/import/ladybug.ts#catalogToModel]] turns either into the IR. Every rule below therefore holds for both sources, and a script and a database holding the same schema import to the same model.

Column types go through the same [[metamodel#Composite Types|type reader]] the model format uses, so a nested `STRUCT` or `MAP` arrives whole rather than being re-parsed by a second, divergent implementation.

One spelling has to be translated: LadybugDB writes the 32-bit float as `FLOAT`, where the metamodel reads a bare `FLOAT` as the 64-bit one. Reading the DDL with the generic table would widen every `FLOAT32` to a `DOUBLE`, which is the opposite of why the DDL is consulted at all.

What the DDL cannot carry is the hierarchy. A table is emitted per concrete type with inherited columns copied down, so an abstract parent has no table, and an edge on an abstract endpoint is expanded to one pair per concrete subtype.

## Reading a LadybugDB Database

A database is read from its own catalog, opened read-only, for a team whose schema grew in the engine and was never kept as a script. `core` never opens it: the command line does and hands in a connection.

The catalog is three queries: `show_tables` lists the tables, `table_info` gives each one's columns with the engine's exact type spellings and which column is the primary key, and `show_connection` gives each rel table's endpoint pairs. [[packages/core/src/import/ladybug.ts#readLadybugCatalog]] asks them through a structural connection type, so `core` never imports the runtime, not even for its types — a test asserts this alongside the `vscode` rule in [[architecture#Package Boundary]].

What these queries return was measured against LadybugDB 0.19.1, not taken from documentation, and several details are easy to get wrong:

- The result columns are named with spaces (`primary key`, `source table name`). They are read from one table of names, and a missing one is an `import-catalog` error rather than an empty model, so a future release renaming one fails loudly.
- `show_tables` lists tables in no particular order. They are sorted by their `id`, which is assigned on creation, to get back declaration order, so the database and its script produce the same file.
- A decimal comes back as `DECIMAL(10, 2)`, with a space the script did not have, and a float as `FLOAT`. Both go through the same type reader and dialect fix as DDL.
- Rel multiplicity (`ONE_ONE`, `MANY_ONE`) appears in no catalog function. An edge read from a database therefore has unconstrained cardinality and `import-multiplicity` says so. This is the one difference from the script, which states it.
- A table comment is in the catalog but has nowhere to go, because the metamodel has no description field. It is reported per table as `import-comment` rather than widening the metamodel to keep it.

Opening read-only is what makes an import safe to run against a database in use. The engine rejects any write through such a connection, and a path that does not exist is refused rather than created. The runtime itself is optional for the command line — see [[architecture#Distribution]].

## Reading a Memgraph Instance

A running Memgraph is read over Bolt, in read sessions, through `SHOW CONSTRAINT INFO`, `SHOW INDEX INFO`, `SHOW ENUMS` and — when the server runs with `--schema-info-enabled` — `SHOW SCHEMA INFO`.

As with a LadybugDB database, `core` never loads the driver: [[packages/core/src/import/memgraph.ts#readMemgraphSchema]] reads through a session the command line opens, and [[packages/core/src/import/memgraph.ts#memgraphCatalogToModel]] builds the model. Constraints are declarations and outrank anything observed in the data.

A key is a uniqueness constraint whose every property also has an existence constraint. When several qualify, the one whose properties carry an index is taken, because [[emitters#Memgraph Target|the generator indexes the key]] for exactly this reason; otherwise the smallest wins and the choice is reported. Existence makes a property required, a single-property uniqueness makes it unique, and a type constraint gives its type. A uniqueness over several properties that is not the key has no place in the model and is reported.

Schema information adds what constraints cannot say: every label set nodes actually carry, the properties and observed value types under each, and every edge type with the labels at each end. It is also the only source that names an enum — a value observed as `Enum::Status` says which enum an `IS TYPED ENUM` property holds. When it is off, the import reads constraints and enums only and says how to turn it on.

A hierarchy is read from labels that occur together, conservatively. Label X is a parent of Y when every node carrying Y also carries X and some node carries X without Y; a label two types always share proves nothing about which is the parent, so nothing is inferred from it. A label is abstract when no node carries it with only its own ancestors. Every inference is reported, in the voice of [[importers#Un-flattening Inheritance]], because co-occurrence is evidence rather than a declaration. Properties are not hoisted to a parent, since a Memgraph schema never declared them there.

An edge seen between several label pairs collapses to the nearest type both ends descend from, as a LadybugDB endpoint set does. A property observed with more than one value type takes the commonest, and says so. What no Memgraph schema holds — edge constraints, cardinality, value bounds, mixins, widths — is reported as lost.

## Combining Sources

RDF and DDL are complementary, so an import given both uses each for what only it has. RDF is the base, because it alone carries the hierarchy.

A datatype from the DDL overrides the one read from RDF, for the reason [[importers#Ambiguous Datatypes]] gives: `INT128` and `UUID` each name one scalar, where `xsd:integer` and `xsd:string` name several. A width is applied to whichever ancestor declares the property rather than pushed back onto the subtype the generator copied it to.

A database takes exactly the DDL's place here, because both are read into one catalog before anything is merged. A database imported beside a shapes graph and an ontology gets its hierarchy from them and gives them its widths and endpoints.

An expanded endpoint set collapses when the hierarchy says what it expands from. Three pairs that are exactly the concrete descendants of one type become that type; without a hierarchy there is nothing to collapse to, so the first pair stands and the rest are reported as dropped.

## Serializing a Model

An importer ends at `.lpg.yaml` text, which needs the inverse of parsing. There was none: the only serializers wrote the [[architecture#Views|sidecars]].

Key order is fixed rather than incidental, so serializing one model twice gives the same bytes. That is what a lockfile diff would later be built on — see [[architecture#Roadmap#Still deferred]] — which is why the ordering is settled here rather than left to whatever order fields happen to be set in.

Lines are built by hand rather than dumped by a YAML library, for the same reason the sidecar serializer does it: the format uses inline flow maps for properties, and a generic dumper would expand each into a block map and turn a readable file into a tall one.

Two details are not cosmetic. A decimal's `(precision, scale)` rides inside the type spelling, which is where the type reader looks for it, so writing the pair as sibling keys would drop it silently. And a composite spelling carries brackets and commas, which end a flow map early unless the value is quoted.

An inherited property is not written by the type that received it. The IR carries inherited and mixin-applied properties on every type that has them, and writing those back would turn one declaration into several.

## Verification

The round trip is the test: emit an artifact, read it back, and compare. It is stronger evidence than a golden file, because it exercises both directions against each other rather than asserting that output has not changed.

The serializer is checked against every fixture and every published example, comparing the resolved IR rather than the text — a stable file that silently dropped `unique` would pass a text comparison and fail this one.

A database is checked against its own script: for the fixtures and every published example, the generated DDL is executed into a real in-process database, and importing the script and importing the database must serialize to the same file once edge cardinality — which only the script records — is set aside. The same tests confirm that an import leaves the database's catalog and data unchanged.

The importer is checked on what each source is supposed to carry, and equally on what it is not: that `abstract` and mixins come back missing is asserted, so the loss stays documented rather than becoming a surprise. A foreign ontology that names no vocabulary of ours is read too, since a source generated elsewhere is the case that matters.
