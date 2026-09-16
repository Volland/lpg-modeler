## Why

`lpg import` reads LadybugDB DDL, but only as a script. A team whose schema grew through ad-hoc `CREATE`/`ALTER` statements, notebooks or another tool has a database and no script. For them the tool is unreachable: nothing gets them from what is deployed to a `.lpg.yaml` they can model on. The engine's own catalog already holds the schema. Reading it is the shortest way to adopt the tool for anyone starting from a live LadybugDB.

## What Changes

- **New import source `ladybug-db`.** `lpg import <database> --from ladybug-db [--out model.lpg.yaml]` opens an existing LadybugDB database **read-only**, reads its catalog and writes a model. It uses the same serialize-then-validate pipeline and the same diagnostics as every other import.
- The catalog read covers node tables, rel tables, column names, exact column types, primary keys, and every FROM/TO pair of a rel table. Table comments are reported as not carried, because the metamodel has no description field.
- A database path is recognised by a LadybugDB file extension (`.lbdb`, `.lbug`, `.kuzu`) or by being a directory. Anything else still needs `--from ladybug-db`.
- **One reader, two front-ends.** The DDL reader and the catalog reader produce the same intermediate catalog. The existing rules then build the IR from it: the `FLOAT` spelling, composite type parsing, required-ness of the key, and endpoint collapsing. A database and a script with the same schema import to the same model.
- A database can be imported together with SHACL/OWL files. It then plays the part the DDL plays today: exact widths and endpoints, with RDF supplying the hierarchy.
- Rel multiplicity (`ONE_ONE`, `MANY_ONE`, …) is not in LadybugDB 0.19.1's catalog (measured). It is reported as lost, never guessed.
- If the Ladybug runtime is not installed, or the database cannot be opened, the command fails with a message saying what to do. Nothing is written in either case.

## Non-goals

- Writing to, migrating or connecting to a remote/server database. The file is opened read-only, in-process.
- Sampling data to infer anything: required-ness, enums, value ranges, hierarchy or cardinality.
- Recovering an abstract hierarchy or mixins from table names or shared columns.
- Recognising a synthesized composite-key column as a composite key.
- Canvas or command-palette entry points; the VS Code extension does not bundle the native runtime.
- Importing from neo4j, falkordb or memgraph instances.

## Locked decisions

Touches none. Decision 9 (flattening) is why the hierarchy stays unrecoverable. Decision 8's "never silently drop" is applied inbound, as the existing importers already do. Decision 13 is satisfied: the reader is tested against a real in-process engine. This amends a documented design choice in `lat.md/importers#Reading LadybugDB DDL` ("parse text, do not open a database"), not a locked decision. That choice stays true for DDL, and a database is added as a second source.

## Targets affected

**ladybug** only, as an import source. No emitter output changes. **neo4j**, **memgraph**, **shacl**, **owl** and **template** are unaffected. shacl/owl inputs can still be combined with a database import.

## Capabilities

### New Capabilities
- `schema-import`: reading foreign schemas into a model. Covers the new LadybugDB database source, its shared behaviour with the DDL source, and the losses it reports.

### Modified Capabilities
_None._ `schema-generation` requirements are unchanged.

## Impact

- `packages/core/src/import/`: a source-neutral Ladybug catalog shape. The DDL reader is refactored to produce it, and a catalog-to-IR builder is added. No runtime dependency is added to core, and no `vscode` import.
- `packages/cli/src/cli.ts`: the `ladybug-db` source, database detection, read-only catalog queries and error paths.
- `packages/cli/package.json` and the esbuild bundle: `@ladybugdb/core` becomes an optional dependency, kept external and loaded lazily. Emit/check never load it.
- Tests: in-process catalog tests against real databases, plus a DDL/database equivalence test.
- `lat.md/importers.md`, `lat.md/architecture.md#Distribution`, README CLI usage.
