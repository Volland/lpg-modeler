## 1. Core

- [x] 1.1 Expected-side readers over the emitters' own schema-object spellings (no object shape widened; FalkorDB's are structured already).
- [x] 1.2 `src/drift.ts`: expected LadybugCatalog from the model via the emitter's functions; ladybug comparison (tables, columns, keys, pairs, multiplicity for scripts); constraint-engine comparison with structural identity and the importer's exclusions.

## 2. CLI

- [x] 2.1 `lpg drift` over the existing connection plumbing (`--database`, `--uri` with probe, `--script`, `--graph-key`, `--from`, `--json`); exit codes.

## 3. Tests

- [x] 3.1 In-process LadybugDB: apply then drift-clean; mutate model then drift-missing; mutate database then drift-unexpected.
- [x] 3.2 Unit tests over hand-written Neo4j/Memgraph/FalkorDB catalogs: clean, missing, unexpected, name-insensitive match, FAILED constraint.
- [ ] 3.3 Live suites extended behind LPG_*_URI.

## 4. Documentation

- [x] 4.1 `lat.md`: drift section; CLI usage; CHANGELOG.

## 5. Verification

- [x] 5.1 `npm run build`, `npm test`, `npm run lint`; migrate goldens unchanged.
- [x] 5.2 `lat check`.
