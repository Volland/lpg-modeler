## 1. Reader

- [x] 1.1 `import/tgs.ts`: frontmatter reader, schema notes per TGS §3–6, versions and duplicates.
- [x] 1.2 Notes → model: kinds, enums, edges and endpoint collapse, undeclared types, keys, renames, not-carried report.
- [x] 1.3 The `lpg` key: hierarchy, mixins, keys, exact types, cardinality; stale entries reported.
- [x] 1.4 Registry entry and format detection; CLI reads a directory of notes and a `.md` note.

## 2. Target

- [x] 2.1 `emit/tgs.ts`: capability set, type and edge type declarations, endpoint expansion, the `lpg` key, downgrades.
- [x] 2.2 Layouts `folder` and `single`; merging into an existing note; refusal of a note declaring types the export lacks.
- [x] 2.3 Golden file for `social` in the single layout.

## 3. Surfaces

- [x] 3.1 CLI `lpg export --to tgs [--out] [--layout] [--force]` with the terminal prompt.
- [x] 3.2 VS Code: Import Typed Graph Schema… and Export Typed Graph Schema… commands.

## 4. Tests

- [x] 4.1 Round trip of every fixture in both layouts.
- [x] 4.2 TGS conformance examples and the code ontology import.
- [x] 4.3 `tg validate --schema-only` accepts every exported vault when `tg` is installed.
- [x] 4.4 CLI and VS Code command tests.

## 5. Documentation

- [x] 5.1 `lat.md/importers.md` (Reading TGS Notes) and `lat.md/emitters.md` (TGS Target).
- [x] 5.2 CLI usage text, README, CHANGELOG.

## 6. Verification

- [x] 6.1 `npm run build`, `npm test`, `npm run lint`.
- [x] 6.2 `lat check`.
