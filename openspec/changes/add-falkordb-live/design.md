# Design

The metamodel does not change, and neither does the FalkorDB artifact. This change adds a reader for a running instance and a way to send an already-generated script to one. The IR is untouched, so the lockfile, diffing and rename detection are untouched with it.

## 1. Applying a shell script without running a shell

The artifact is a `.sh` file, and that is not revisited: `emitters#FalkorDB Target` chose it because a constraint is a Redis command and an index is Cypher, and because a shell comment can carry a downgrade note where a line in a redis pipe cannot. What changes is only that `apply` need not hand the file to `sh`.

Every command line the generator writes has one of two shapes:

```
$REDIS_CLI GRAPH.QUERY "$GRAPH_KEY" "<cypher>"
$REDIS_CLI GRAPH.CONSTRAINT CREATE "$GRAPH_KEY" UNIQUE NODE Car PROPERTIES 1 vin
```

and a migration adds the `GRAPH.CONSTRAINT DROP` and `DROP INDEX` forms. `apply` reads each `$REDIS_CLI` line into an argument vector — splitting on whitespace outside quotes, unquoting, and substituting `$GRAPH_KEY` — and sends that vector as one command. Anything else in the file is refused: the two assignments of the preamble are understood, a comment and a blank line are skipped, and any other line is an `apply-unreadable-line` error naming it.

Refusing rather than interpreting is the point. A general shell reader would be a shell, with the failure modes of one, applied to a file a user may have edited; a reader that accepts exactly the shapes this tool writes can say honestly what it is doing. It is the same rule the statement splitter already relies on — the generator writes a known form, and the reader is exact for that form and refuses everything else.

Executing `sh` remains what a user may do themselves, and the script says so. `apply` is for the case where the tool should say what ran and what did not.

## 2. Reading a running instance

Measured against FalkorDB 4.20.4:

- `CALL db.constraints()` returns `type` (`UNIQUE` or `MANDATORY`), `label`, `properties`, `entitytype` (`NODE` or `RELATIONSHIP`) and `status`.
- `CALL db.indexes()` returns `label`, `properties`, `types` (per property, e.g. `{id: [RANGE]}`), `entitytype` and `status`.
- A key is read as the generator writes one: a `UNIQUE` constraint whose every property also carries a `MANDATORY` constraint, with an index behind it. Where several qualify, the smallest wins and the choice is reported — the Memgraph rule in FalkorDB's vocabulary.
- `db.labels()`, `db.relationshipTypes()` and `db.propertyKeys()` name what exists but relate nothing to anything, so label sets, property placement and edge endpoints come from sampling queries: `MATCH (n) RETURN DISTINCT labels(n), count(*)` and the endpoint equivalent, each with a bound. A sample is evidence, not a declaration, so the hierarchy it supports is reported exactly as a Memgraph import's is, and a truncated sample is reported too.

### A constraint that is not enforcing anything

A constraint is applied asynchronously: the create returns `PENDING`, and one the stored data violates settles at `FAILED`. Measured: two `P` nodes sharing `id`, then a unique constraint on `id`, gives `status: FAILED`, and the constraint enforces nothing thereafter.

A `FAILED` constraint therefore may not be read as part of the schema. Reading it would put a key in the model that the database is not keeping, which is the same class of error as silently dropping a constraint on the way out — decision 8 pointed inbound. It is reported instead, with its status, and `PENDING` is reported the same way because it has not settled yet.

### Reading a graph that does not exist

`GRAPH.QUERY` against an unknown key **creates that key**: measured, `CALL db.constraints()` on `nosuchgraph` returned an empty result and `GRAPH.LIST` then listed `nosuchgraph`. An import with a mistyped graph key would otherwise write a model with nothing in it, having quietly added an empty graph to the user's server — a write, from the one command that promises not to write.

Measuring further found a better answer than the pre-check this design first proposed. `GRAPH.RO_QUERY` refuses an unknown key outright (`Invalid graph operation on empty key`) and creates nothing, and it refuses any write through it (`graph.RO_QUERY is to be executed only on read-only queries`). Every schema read therefore goes through `GRAPH.RO_QUERY`, which makes "an import cannot write" a property the server enforces rather than a discipline this code keeps.

`GRAPH.LIST` is still read first, but for what it can say rather than for safety: a key that is not listed is `import-no-graph` naming the keys that are, which is a better message than the engine's. When `--graph-key` is not given and the server holds exactly one graph, that one is read; when it holds several, they are listed and nothing is read — the rule `architecture#Editing Surface#Reaching a model` already applies to finding a model in a workspace.

## 3. The client

A Redis client is an optional peer dependency, loaded beside the CLI and then from the working directory, with an install hint naming the version — the arrangement `architecture#Distribution` describes for `@ladybugdb/core` and `neo4j-driver`, and for the same reason: every `check` and `emit` would otherwise download it. `core` never loads it. The reader takes a structural client type — send an argument vector, get a reply — so the whole of `import/falkordb.ts` is testable against a hand-written stub, and no `vscode` import is introduced.

The password comes from `FALKORDB_PASSWORD`, never a flag, as the other two engines' do.

Cited: `emitters#FalkorDB Target`, `emitters#FalkorDB Target#Measured DROP Syntax`, `importers#Reading a Memgraph Instance`, `importers#Reading Edges`, `architecture#Distribution`, `architecture#Editing Surface#Reaching a model`.
