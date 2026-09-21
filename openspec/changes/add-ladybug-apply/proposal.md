## Why

LadybugDB is the primary target and the best understood: the metamodel's type set was drawn from it, its migrations are checked against a real database, and its schema can already be read back from a database file. It is nonetheless the one engine where the last step has no command. A user generates `domain.ladybug.cypher`, and then has to write the loop that feeds it to a connection — the step where a half-applied schema comes from, because a hand-rolled loop rarely says what had already run when a statement failed.

It is also the cheapest of the three: the runtime is already an optional peer for importing a database, the statements are already one per `;`, and `emitters#Measured ALTER Support` already records what the engine accepts.

## What Changes

- **Apply to a LadybugDB database.** `lpg apply <script> --target ladybug --database <path>` opens the database read-write, runs each statement in file order, prints each as it succeeds, and stops at the first failure saying what had already been applied.
- **A path, not a URI.** LadybugDB is embedded, so the instance is a directory or a `.lbdb`, `.lbug` or `.kuzu` file — the same shapes `lpg import` already recognises. `--database` names it, and `--uri` remains for the engines reached over a network.
- **A database that does not exist yet is created**, because applying a generated schema to a fresh database is the common case. `--no-create` refuses instead, for the case where applying to the wrong path is the thing to avoid.
- **The destructive gate keeps its meaning.** A migration marked destructive still needs `--allow-destructive`, and LadybugDB's own refusals — no column retype, no dropping a primary key column, no dropping a node table a rel table still references — are reported as the engine words them.

## Non-goals

- Data: no loading, no copying, no `COPY FROM`.
- A dry run that validates statements against the engine without applying them; `--dry-run` prints, as it does for every other target.
- Reaching a LadybugDB database over a network. It is embedded; there is no server to reach.
- Changing what `migrate` writes, or what the emitter emits.

## Locked decisions

None amended. Decision 13 is upheld: the statements this runs are the ones already measured against LadybugDB 0.19.1, and the tests apply real scripts to a real database in process. Decision 9 is untouched.

## Targets affected

**ladybug** gains apply. Every other target is untouched.

## Capabilities

### Modified Capabilities
- `schema-deployment`: `apply` accepts a ladybug script against a database path.

## Impact

- `cli`: `--database`, `--no-create`, the ladybug apply path; the LadybugDB runtime opened read-write for the first time, having only ever been opened read-only.
- `core`: nothing, beyond the header reader the Neo4j change widened.
- Tests: in-process apply of a generated schema and of a migration, plus the partial-application report.
- `lat.md` (architecture#Distribution, emitters#Migrations), docs site, README, CHANGELOG.
