# Add lpg audit: check data against what the target could not enforce

## Why

The capability matrix already names everything a target cannot enforce — LadybugDB's non-key required properties, Community Neo4j's existence constraints, everyone's enums, bounds and cardinality. Today that honesty ends at a diagnostic. The natural next sentence is a generated, read-only query per downgrade that finds the violating data. Audit turns the matrix from a disclaimer into a product feature: what the engine cannot enforce, the tool checks.

## What Changes

- `lpg audit <model> --target <ladybug|neo4j|memgraph|falkordb>` generates an audit script: one read-only query per constraint the target leaves unenforced, each preceded by a comment naming the constraint, each returning a `violations` count. The checks are selected from the target's capability set and the emitters' own downgrade rules, plus `--edition` for Neo4j.
- Checked where unenforced: required and unique (node and edge), key presence and tuple uniqueness, enum membership, min/max bounds, length bounds, patterns (where the engine has a spelling), closed types (via `keys()`, on the label-based engines), endpoint cardinality, and the named constraints (comparisons, atLeastOne, exactlyOne, count).
- With a connection (`--uri`, or `--database` for LadybugDB, opened read-only), the CLI runs each check and prints its count, exiting non-zero when any violation is found. Every read is a read session, a `GRAPH.RO_QUERY`, or a read-only embedded open — audit can never write.
- A check the engine has no spelling for (a pattern on FalkorDB) is reported as `audit-unsupported`, never silently dropped.

## Non-goals

- No property-type checking (Memgraph enforces types; elsewhere `valueType()` is engine-specific) in this change.
- No fixing, no sampling of offending rows beyond the count, no scheduling.
- No audit of constraints the target genuinely enforces: the engine already refuses those writes.

## Locked decisions

None amended. Decision 8 is extended in direction: a downgrade now has a check, and a check that cannot be generated is itself reported. Decision 13 applies to the queries: the LadybugDB checks are executed in-process in tests, and the three server engines' scripts are pinned and exercised by live suites behind the existing `LPG_*_URI` gates.

## Targets affected

**ladybug, neo4j, memgraph, falkordb** each gain an audit script. Emitted schema artifacts do not change.

## Capabilities

### New Capabilities
- `data-audit`: generating and running audit checks.

## Impact

- `core`: `audit.ts` (plan and per-target query spelling); no `vscode` import, no connection opened in core.
- `cli`: the `audit` command, reusing the existing connection plumbing and optional peers.
- Tests: in-process LadybugDB execution with planted violations; golden scripts per target; live suites extended.
- `lat.md`: new `audit.md`; CLI usage, CHANGELOG.
