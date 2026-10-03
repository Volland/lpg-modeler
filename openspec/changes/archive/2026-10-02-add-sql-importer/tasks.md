## 1. Reader

- [x] 1.1 `import/sql.ts`: statement splitter (quotes, dollar quotes, parens), CREATE TABLE and column reader, ALTER TABLE ADD CONSTRAINT, CREATE TYPE AS ENUM, CREATE UNIQUE INDEX, skipped-statement accounting.
- [x] 1.2 Catalog→model: type map, keys, FK edges with cardinality, join-table rule, naming with reports.
- [x] 1.3 Registry entry, `detectFormat` content sniff, import-mixed-sources, CLI caveat block.

## 2. Tests

- [x] 2.1 Fixture DDLs: hand-written and pg_dump-shaped.
- [x] 2.2 Unit tests per requirement scenario; serialize-and-revalidate round trip.

## 3. Documentation

- [x] 3.1 `lat.md/importers.md`: Reading SQL DDL section.
- [x] 3.2 CLI usage text, CHANGELOG.

## 4. Verification

- [x] 4.1 `npm run build`, `npm test`, `npm run lint`.
- [x] 4.2 `lat check`.
