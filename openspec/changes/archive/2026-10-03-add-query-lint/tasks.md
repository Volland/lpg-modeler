## 0. Gate

- [x] 0.1 Decide the parser (vendored openCypher grammar vs tree-sitter WASM vs dependency); record bundle-size and licence consequences in the design.

## 1. Core

- [x] 1.1 Query reader producing (labels, rel types, property accesses with resolved variables, comparisons).
- [x] 1.2 Resolution checks against the IR. No per-engine dialect switches were needed: only patterns and `variable.property` are read.

## 2. CLI and editor

- [x] 2.1 `lpg lint-queries`; exit codes; positioned findings.
- [ ] 2.3 `--json` output (not built; the human format is `file:line:col`, which CI annotators already parse).
- [ ] 2.2 VS Code diagnostics on `.cypher` files (a follow-up change: the findings already carry the ranges it needs).

## 3. Tests and docs

- [x] 3.1 False-positive suite (labels in strings/comments, map keys, var-length paths).
- [x] 3.2 `lat.md` section; CLI usage; CHANGELOG.
- [x] 3.3 `lat check`.
