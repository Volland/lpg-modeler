## Context

**The metamodel does not change. The IR does not change.** A database import produces the same `ModelIR` shape as the DDL import. The lockfile format and diffing are unaffected. Type names are the table names and IRIs come from the importer's default namespace, exactly as for DDL today. The effect on IRI stability and on rename detection is the same as for any import: element ids are derived until `lpg ids` writes them. The sibling change `add-migrations-and-lockfile` refuses to lock derived ids, so the user runs `lpg ids` before locking.

Current state (see proposal.md, "Why"):
- The DDL reader parses statement text straight into the IR. It owns the rules that matter: the `FLOAT` → `FLOAT32` dialect fix, composite type parsing through `parsePropertyType`, key → required, and `collapse` of expanded endpoint pairs.
- Importers are text-only, with inputs of `{ path, text }`. `importModel` groups inputs by kind and merges RDF with DDL.
- `core` has no native dependency. `@ladybugdb/core` is a root dev dependency, used only by `ladybug.live.test.ts`.
- The CLI is a single esbuild bundle with no runtime dependencies, and `main` is synchronous.

Measured against LadybugDB 0.19.1 on an on-disk database while writing this design:

| Query | Returns |
|---|---|
| `CALL show_tables() RETURN *` | `id`, `name`, `type` (`NODE`/`REL`), `database name`, `comment` |
| `CALL table_info('<t>') RETURN *` (node table) | `property id`, `name`, `type`, `default expression`, `primary key` |
| `CALL table_info('<t>') RETURN *` (rel table) | the same, with `storage_direction` in place of `primary key` |
| `CALL show_connection('<t>') RETURN *` | one row per pair: `source table name`, `destination table name` and the two PK names |

- Type spellings match DDL, except for padding: a decimal is spelled `DECIMAL(10, 2)`.
- A float column is spelled `FLOAT`, so it needs the same dialect fix as DDL.
- Rel multiplicity does not appear in `show_tables`, `table_info`, `show_connection` or `storage_info`. `show_functions` lists no other catalog function that could hold it.
- `new Database(path, 0, true, /* readOnly */ true)` opens read-only, and a write through it is rejected.
- Found during implementation: `show_tables` returns tables in no particular order. The reader sorts them by `id`, which gives back creation order.
- Found during implementation: a missing path opened read-only is refused, and a non-database file is rejected with "not a valid Lbug database file". Neither creates anything on disk.

Design sections this depends on:
- `lat.md/importers#Reading LadybugDB DDL`
- `lat.md/importers#Combining Sources`
- `lat.md/importers#Importers`
- `lat.md/architecture#Package Boundary`
- `lat.md/architecture#Distribution`
- `lat.md/emitters#Ladybug Target`

## Goals / Non-Goals

**Goals:**
- The DDL and the database share one catalog → IR builder, so they cannot drift apart.
- `core` stays free of native and `vscode` imports. The catalog reader is still testable in `core` tests against a real engine.
- CLI users who never import a database pay nothing: no install weight, and no load-time `require`.

**Non-Goals:**
- A VS Code command. The `.vsix` cannot carry per-platform native bindings without a separate packaging change.
- Reading the multiplicity or the hierarchy some other way, for example from data or naming conventions.

## Decisions

### 1. An intermediate `LadybugCatalog` shape, with two front-ends

Add a plain-data type in `core/src/import/ladybug.ts`:

```ts
interface LadybugCatalog {
  tables: Array<
    | { kind: 'node'; name: string; columns: { name: string; type: string }[]; primaryKey: string[]; comment?: string }
    | { kind: 'rel';  name: string; columns: { name: string; type: string }[]; pairs: [string, string][]; multiplicity?: string; comment?: string }
  >
}
```

The tables are kept in one ordered list rather than as separate node and rel lists. That preserves declaration order, so diagnostics come out in exactly the order the pre-refactor reader produced them.

- `parseLadybugDdl(text) → LadybugCatalog` replaces the regex loop that builds the IR today.
- `readLadybugCatalog(conn) → Promise<{ catalog, diagnostics }>` issues the three catalog queries. Like every reader it never throws.
- `catalogToModel(catalogs: { source, catalog }[], file, context) → ImportResult` holds all the existing IR rules and the loss diagnostics.
  - Each catalog carries its `source` (`'ddl' | 'database'`), so in a mixed import only rel tables that came from a database are reported under `import-multiplicity`. A script rel written without a keyword is unbounded, not unknown.
- `importLadybug(inputs, context)` keeps its signature, and routes text inputs through the parser and catalog inputs straight to the builder.

*Alternatives considered:*
- Render the catalog back into DDL text and feed the existing parser. It needs no refactor, but the text round trip would need identifier quoting, and every future catalog-only field (comments, multiplicity if the engine adds it) would need a DDL spelling first.
- A second, independent catalog → IR builder. That is exactly the divergent-implementation risk `importers#Reading LadybugDB DDL` already warns about for types.

### 2. `core` reads the catalog through a structural connection, not the package

`readLadybugCatalog` accepts `{ query(q: string): Promise<{ getAll(): Promise<Record<string, unknown>[]> }> }`. `core` never imports `@ladybugdb/core`, not even as a type. The CLI opens the database and passes in the connection. Tests in `core` pass a real connection from the root dev dependency.

- Table names go into `table_info('…')` / `show_connection('…')` with single quotes escaped.
- Rows are filtered to the default database. That excludes attached databases, whose names in `database name` are not `main(graph)`. The filter matches on the name starting with `main` rather than on the exact string.
- Result column names contain spaces (`primary key`, `source table name`). They are read by exact key and centralised in one place, so a rename in a future engine version fails one test rather than silently yielding an empty model.
- If a required column is missing from a row, the reader raises an `import-catalog` error diagnostic naming the query and the missing column. It does not return an empty table.

*Alternative:* make `core` depend on `@ladybugdb/core`. Rejected because it breaks the extension bundle, which inlines `core`, and it adds a native module to every consumer of the package boundary.

### 3. The importer input becomes a union, not a new registry signature

Change `ImportInput` to `{ path, text } | { path, ladybugCatalog }`. `importModel` groups a catalog input into the existing `ladybug` group, and `importLadybug` routes each input to the parser or straight to the builder. Merging with RDF is then unchanged: a database takes the DDL's position with no new code path.

- The registry gains an alias, `ladybug-db`, that resolves to `ladybug`. `--from ladybug-db` tells the CLI to open the path as a database instead of reading it as text. Inside `core` the two are one source.
- A DDL script and a database in the same import are both allowed. Their catalogs are concatenated. A table present in both is taken from the first and reported with `import-duplicate-table`.

*Alternative:* a separate `importers` registry for binary sources. Rejected: two registries for one concept, and the RDF merge would need to learn both.

### 4. The CLI opens the database; `main` goes async only on that path

- The database branch of `runImport` is `async`. The top-level wrapper awaits `main` and still assigns `process.exitCode`, never calling `process.exit`.
- Detection is done per positional path before any text read. The path is a database when `--from ladybug-db` is given, when it is a directory, or when it ends in `.lbdb`, `.lbug` or `.kuzu`. A non-directory path without one of those extensions still needs `--from`. Sniffing binary headers is deliberately left out, because the file format is not a documented contract.
- The database opens as `new Database(path, BUFFER_POOL, true, true, MAX_DB_SIZE)`: read-only, with the pool and `maxDBSize` bounded, using the same values and reasoning as `ladybug.live.test.ts`. The connection and database are closed in `finally`.
- An open failure is reported as `cannot open LadybugDB database <path>: <engine message>` with exit code 1, and nothing is written.

### 5. `@ladybugdb/core` is an optional peer, resolved lazily from two places

- `packages/cli/package.json` declares `peerDependencies: { "@ladybugdb/core": "0.19.1" }` with `peerDependenciesMeta.optional`. esbuild gets `external: ['@ladybugdb/core']`.
- The module is loaded only in the database branch. It is resolved first from the CLI's own location, then from `process.cwd()` via `createRequire`, so both a project-local install and a global CLI work.
- If it is missing, the CLI prints: `importing a LadybugDB database needs @ladybugdb/core: npm install @ladybugdb/core@0.19.1 (or npx -p lpg-modeler-cli -p @ladybugdb/core@0.19.1 lpg import …)`.

*Alternative:* a regular or `optionalDependencies` entry. Rejected because it adds about 38 MB of native binaries (the core package plus the platform package) to every CLI install, including CI runs that only `check` and `emit`.

The pin matches the version the catalog columns were measured on. A newer engine's catalog could rename a column, and decision 2's error path covers that.

### 6. Losses are reported once per import, specifically where possible

- `import-lossy` (info) keeps the DDL wording, adjusted per source.
- `import-multiplicity` (info) is raised once, listing the rel tables whose multiplicity is unknown. It is raised only for database sources.
- `import-comment` (info) is raised per table with a non-empty comment. The metamodel has no description field, and adding one is a metamodel change outside this proposal.
- `import-type`, `import-endpoints` and `import-collapsed` are reused unchanged.

### 7. The imported file's header names the right source

The existing header warns that RDF cannot express an abstract type, a mixin or uniqueness. For an import with no RDF input it instead says that LadybugDB keeps one table per concrete type. A database-only model would otherwise open with a comment about a source it never read.

## Risks / Trade-offs

- [A catalog column rename in a future LadybugDB] → The reader reads keys through one table and raises `import-catalog` on a missing key. A live test pins the measured shape, and the peer range is pinned exactly.
- [The database is locked by another writer process] → The engine's open error is surfaced verbatim. Read-only open is documented as the supported mode, and there is no retry.
- [The async `main` changes the exit path for all commands] → Only the import branch awaits. The existing CLI tests cover `check`, `emit` and `ids` exit codes and must stay green.
- [An on-disk format mismatch: a database written by a different engine version] → The engine's own error is surfaced. The message names the pinned runtime version so the user can see the mismatch.
- [Directory detection misfires on a directory the user meant as something else] → `lpg import` has never accepted directories, so there is no existing behaviour to break.

## Migration Plan

Additive. There is no model, IR or artifact format change, and existing `lpg import` invocations behave identically. Rollback is reverting the change. No data is touched, because databases are opened read-only.
