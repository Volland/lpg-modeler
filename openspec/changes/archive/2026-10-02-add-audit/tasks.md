## 1. Core

- [x] 1.1 `src/audit.ts`: check selector over capability sets and per-target exceptions; query builders (required, unique, key tuple, enum, bounds, lengths, patterns where spelled, closed types, cardinality, named constraints); per-target spelling tables; script assembly (cypher / falkordb shell).
- [x] 1.2 Measure LadybugDB spellings in-process (string length, regex, OPTIONAL MATCH, rel match without bound tables) and pin them in a test.

## 2. CLI

- [x] 2.1 `lpg audit` command: script to stdout/`--out`; run over `--uri`/`--database`/`--graph-key` via the existing read-only plumbing; per-check counts; exit code.

## 3. Tests

- [x] 3.1 In-process LadybugDB: planted violations counted; clean database counts zero.
- [x] 3.2 Golden audit scripts for the social fixture, all four targets.
- [ ] 3.3 Live suites behind LPG_*_URI run the scripts on planted data.

## 4. Documentation

- [x] 4.1 `lat.md/audit.md`; CLI usage; CHANGELOG.

## 5. Verification

- [x] 5.1 `npm run build`, `npm test`, `npm run lint`.
- [x] 5.2 `lat check`.
