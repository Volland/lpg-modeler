## 1. Shared Ladybug catalog in core

- [x] 1.1 Add the `LadybugCatalog` type to `packages/core/src/import/ladybug.ts`. Extract `parseLadybugDdl(text)` from the current statement loop, recording columns, primary key, FROM/TO pairs and the multiplicity keyword.
- [x] 1.2 Extract `catalogToModel(catalog, source, context)` holding the existing IR rules: the `FLOAT` dialect fix, type parsing, key → required, `collapse`, and the lossy diagnostic. Make `importLadybug` parse + build.
- [x] 1.3 Confirm the refactor changes nothing. The existing `import.test.ts` DDL and RDF+DDL cases must pass unchanged, with identical diagnostics.

## 2. Catalog reader

- [x] 2.1 Add `readLadybugCatalog(conn)`, taking a structural connection type:
  - issue `show_tables`, `table_info` and `show_connection`, with single-quote escaping
  - keep only the default database
  - read result keys from one column map
- [x] 2.2 Raise `import-catalog` when an expected result column is missing. Add `import-multiplicity` for database sources and `import-comment` for non-empty table comments.
- [x] 2.3 Widen `ImportInput` to `{ path, text } | { path, ladybugCatalog }`. Route catalog inputs into the `ladybug` group in `importModel`, and add the `ladybug-db` alias. Concatenate catalogs and report `import-duplicate-table` for a table seen twice.
- [x] 2.4 Confirm `packages/core/src/import/` has no `@ladybugdb/core` or `vscode` import, including type-only imports. Extend the boundary test to assert the native package is absent from `core` sources.

## 3. In-process tests against a real engine (core)

- [x] 3.1 Create `packages/core/test/ladybug-catalog.live.test.ts`, using the bounded `Database` settings from `ladybug.live.test.ts`. Build a table with `INT128`, `FLOAT`, `DECIMAL(10,2)`, `STRUCT`, `STRING[]` and a primary key, and assert the model's types, key and required flags.
- [x] 3.2 Equivalence test: for the `social` fixture and every published example, execute the emitted ladybug DDL into a fresh database. Import both the DDL and the catalog, and assert the serialized models are identical except for edge cardinality.
- [x] 3.3 Loss tests:
  - a `MANY_ONE` rel yields unconstrained cardinality plus `import-multiplicity`
  - a commented table yields `import-comment`
  - an expanded rel without RDF yields `import-endpoints`
  - an unknown column type yields `import-type`
- [x] 3.4 Combination test: import a database together with the model's shacl and owl artifacts. Assert that the hierarchy is recovered, that widths override XSD datatypes on the declaring type, and that expanded endpoints collapse.
- [x] 3.5 Read-only test: an on-disk database written in the test (in the vitest temp dir) is imported. Then assert that `show_tables`, `table_info` and a row count are unchanged, and that a write through the importer's open mode is rejected.

## 4. CLI

- [x] 4.1 In `packages/cli/package.json`, declare `@ladybugdb/core@0.19.1` as an optional peer dependency. Mark it `external` in `scripts/bundle.mjs`, and check that the built `dist/cli.js` does not inline it.
- [x] 4.2 Add lazy runtime loading: resolve from the CLI location, then from `process.cwd()` via `createRequire`. If it is missing, print the install hint from the design and exit 1.
- [x] 4.3 Detect database paths per positional argument: `--from ladybug-db`, a directory, or `.lbdb`/`.lbug`/`.kuzu`. Open read-only with a bounded pool and size, read the catalog, and close in `finally`. Report open failures as `cannot open LadybugDB database <path>: <reason>`.
- [x] 4.4 Make the import branch async. Have the top level await `main` and keep assigning `process.exitCode`. Update `usage()` to list `ladybug-db` and database paths.
- [x] 4.5 CLI tests in `packages/cli/test/cli.test.ts`:
  - database → stdout model
  - `--out` writes and validates the file
  - auto-detection by extension
  - a nonexistent path exits 1 with nothing written
  - `check`, `emit` and DDL `import` exit codes unchanged
- [x] 4.6 Missing-runtime test: run the built CLI with module resolution isolated (copy `dist/cli.js` to a temp dir outside the workspace, with cwd there). Assert the install hint and exit 1, and that `check` still works from the same location.

## 5. Documentation

- [x] 5.1 Update `lat.md/importers.md`:
  - add a "Reading a LadybugDB Database" section covering the catalog queries, read-only open, measured multiplicity loss and comment loss
  - amend "Reading LadybugDB DDL" so its parse-text rationale is scoped to scripts, and link the shared catalog builder
  - extend "Combining Sources" to name the database
  - extend "Verification" with the DDL/database equivalence test
- [x] 5.2 Update `lat.md/architecture.md#Distribution` with the optional-peer native runtime and why it is not a dependency. Add `// @lat:` refs from the new tests to the new sections.
- [x] 5.3 Add a database import example to README's CLI usage, including the `npx -p` form. Add a CHANGELOG entry.
- [x] 5.4 Add the 0.19.1 catalog measurements to the "Measured target behaviour" block in `openspec/config.yaml`: column names, `DECIMAL(10, 2)` spelling, multiplicity absent, read-only open.

## 6. Verify

- [x] 6.1 Run `npm run build`, `npm test` and `npm run lint`. All must pass.
- [x] 6.2 Run `lat check`. It must pass.
