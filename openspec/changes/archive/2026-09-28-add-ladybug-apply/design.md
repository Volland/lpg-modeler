# Design

The metamodel does not change, the IR does not change, and no emitter changes. This is a command-line change over a runtime the CLI already loads.

## 1. The instance is a path

Every other engine `apply` reaches is a server, named by a URI. LadybugDB is embedded: the database is a directory or a file on disk, and there is nothing to connect to. Overloading `--uri` with `file://` would make the two look alike where they are not — a URI implies a server that could refuse a connection, be unreachable, or hold credentials, and none of that exists here. So the flag is `--database <path>`, and it takes the shapes `lpg import` already recognises as a database: a directory, or a `.lbdb`, `.lbug` or `.kuzu` file.

This is the first time the tool opens a LadybugDB database read-write. Importing opens it read-only and says so; applying cannot. The read-only flag is therefore a per-command decision rather than a constant, and the buffer-pool and size bounds the import uses are kept, because they exist to stop the defaults reserving 8 TiB of address space per open.

A database that does not exist is created, since the common case is a schema script against a fresh database and a user who wanted an existing one would rather be told the path is wrong. `--no-create` inverts that for a deployment script where the opposite is true. Creating a database is not destructive, so it is not behind the destructive gate; it is reported, so the user sees which path was made.

## 2. What runs, and what is already known about it

The statement splitter needs nothing new: a Ladybug script is `;`-terminated with `//` comments, exactly what the splitter already handles for Memgraph, and `emitters#Ladybug Target` records that `--` is not a comment there. The header reader needs the parenthetical form — `Target: ladybug (LadybugDB).` — which the Neo4j change already widened it to accept.

One statement per transaction is kept. LadybugDB DDL is auto-committed, so this is not a correctness requirement the way it is on Neo4j; it is what makes the partial-application report true. A failure mid-script leaves the statements before it applied, and the report names how many, which is the whole reason this command exists rather than a shell loop.

`emitters#Measured ALTER Support` already records what the engine refuses: there is no statement that changes a column's type, a primary key column cannot be dropped, and a node table cannot be dropped while a rel table references it. Those refusals reach the user as the engine words them, positioned. The planner already avoids the one hazard that is worse than a refusal — dropping a rel table's last endpoint pair crashes the engine process — so `apply` inherits that safety from the script it is given rather than re-deriving it.

## 3. Failure that is not a statement failing

Three failures precede the first statement and are reported without opening anything: a script generated for another target, a file this tool did not generate, and a destructive migration without `--allow-destructive`. Two more come from the path: a path that is not a database, and a database the runtime cannot open, which is where a version mismatch surfaces. The runtime being absent is the existing optional-peer message, with `apply` named rather than `import`.

## 4. Where the work lands

`cli` only. `core` gains nothing: there is no artifact to generate and no schema to read. The extension is unchanged and still never touches a database.

Cited: `emitters#Ladybug Target`, `emitters#Ladybug Target#Measured ALTER Support`, `emitters#Migrations#Destructive Gate`, `importers#Reading a LadybugDB Database`, `architecture#Distribution`.
