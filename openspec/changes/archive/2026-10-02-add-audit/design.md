# Design

The metamodel and the IR do not change; lockfile and diffing are untouched. Core work lands in `src/audit.ts`; the CLI adds a command over the existing connection helpers. No `vscode` import; `core` never opens a connection — the CLI hands in the same session/client/connection shapes the importers already take. Depends on `lat.md/emitters#Emitters#Capability Matrix`, `lat.md/emitters#Ladybug Target`, `lat.md/importers#Reading a FalkorDB Instance` (the RO_QUERY safety property), `lat.md/architecture#Distribution`.

## Decisions

### 1. Checks are selected by the capability set, specialised by the emitters' own exceptions

The selector starts from `capabilitiesOf(target)` — `requiredConstraint: 'key-only'` means audit required non-key properties; `'edition-dependent'` consults `--edition` — and encodes the per-entity exceptions the emitters already encode (Memgraph enforces node constraints but none on relationships; FalkorDB enforces both; LadybugDB enforces nothing but the primary key). This keeps audit and emit telling one story: a constraint is either in the schema artifact or in the audit script, and the matrix says which.

### 2. One query shape per check, in each engine's measured spelling

Every check is a single read query ending in `RETURN count(…) AS violations`. Null tests (`IS NULL`), enum membership (`NOT x IN […]`), bounds, CASE-based presence counts for atLeastOne/exactlyOne, `OPTIONAL MATCH` plus `count()` for cardinality and edge-count constraints, and `UNWIND keys(n)` for closed types on the label engines. Engine differences live in one spelling table per target: string length and regex functions are emitted only where the engine is measured to have them, and a constraint with no spelling is an `audit-unsupported` info naming what to check by hand. LadybugDB spellings are measured in-process while this change is built, in the repository's standing style.

### 3. Label addressing follows each target's realisation

On the label engines a type is matched by its own label (every node carries it). Closed-type checks match concrete labels only, because an abstract label's extension legitimately carries subtype properties. On LadybugDB, where a type is a table, abstract endpoints expand to the concrete tables exactly as the emitter expands them.

### 4. The artifact is reviewable and the run is separate

`lpg audit` without a connection writes the script (extension `cypher`; a shell script over `GRAPH.RO_QUERY` for falkordb) so it can be reviewed and scheduled like any other artifact. With `--uri`/`--database` the same checks are run directly: per check, a label and a count; at the end a summary; exit non-zero when any count is positive. The LadybugDB database is opened read-only — the same open an import uses — so audit cannot write anywhere, by construction on all four targets.

## Verification

- In-process LadybugDB: generate the schema, plant rows violating a required, a unique, an enum, a bound and a cardinality; assert each check counts them and a clean database counts zero. This also measures the LadybugDB spellings.
- Golden audit scripts for the social fixture on all four targets.
- Live suites behind `LPG_MEMGRAPH_URI`, `LPG_FALKORDB_URI`, `LPG_NEO4J_URI` run the scripts and assert the counts on planted data.
