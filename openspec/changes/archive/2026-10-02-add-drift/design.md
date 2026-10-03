# Design

The metamodel does not change. The IR does not change, so the lockfile and diffing are untouched; drift adds a second, structural comparison beside the id-based one, and the two are never mixed. Work lands in `core` (`src/drift.ts`) and the CLI. No `vscode` import; `core` never opens a connection or a database. Depends on `lat.md/emitters#Emitters#Migrations#Target Planners` (the schema-object sets), `lat.md/importers#Reading a LadybugDB Database`, `lat.md/importers#Telling Two Bolt Engines Apart`, `lat.md/importers#Reading a FalkorDB Instance`.

## Decisions

### 1. Compare schema objects, not models

An imported model cannot be diffed against the authored one: it has fresh element ids, and a lossy read (no cardinality from a LadybugDB catalog, no bounds from anywhere) would report the loss as drift. So drift compares per target, over what the target stores:

- **ladybug**: an expected `LadybugCatalog` is built from the model with the emitter's own functions (`columnType`, `syntheticKeyColumn`, `endpointNodePairs`, `multiplicity`) and compared to the actual catalog — `parseLadybugDdl` for a script, `readLadybugCatalog` for a database. Tables, columns (type spelling normalised the way the importer already normalises the dialect), primary keys, endpoint pairs; multiplicity only against a script, because the catalog of a database does not record it (measured; see config).
- **neo4j / memgraph / falkordb**: the expected set is `neo4jSchema` / `memgraphSchema` / `falkorSchema` constraints and indexes; the actual set is the catalog the live importer already reads, with the same exclusions it already applies (LOOKUP indexes, constraint-owned indexes, non-operational FalkorDB constraints — reported, not compared).

### 2. Structural identity, stated once per engine

An object's identity is (kind, entity, label, sorted properties — plus the typed keyword on Memgraph). Names do not participate: Neo4j constraint names are cosmetic to the schema's meaning, and Memgraph constraints have none. The expected keys are read back from the schema objects' own statement texts — this tool's spellings, so the readings are exact and pinned by the migrate goldens — rather than widening the object shapes; FalkorDB's objects are structured already. The actual side is the catalog the live importers produce, whose kinds are already normalised to the same vocabulary.

### 3. Three verdicts, engine-aware

`missing`, `unexpected`, `different` (same identity path, different shape — a retyped column, a changed primary key, a changed endpoint pair set). On the constraint engines there is no `different`: a constraint's shape *is* its identity, so a change reads as one missing plus one unexpected, and the report says so next to each other. Exit code: non-zero on any finding; `--json` prints the findings with their verdicts.

### 4. The CLI reuses what exists

`--uri` goes through the same probe-then-read path as `lpg import` (Memgraph first, `--from` override honoured); `--database` is the same read-only open; `--script` is `parseLadybugDdl`. A FalkorDB `FAILED`/`PENDING` constraint is reported with its status and is not treated as present, because it enforces nothing.

## Risks / Trade-offs

- [Foreign deployments may hold extra objects by policy, e.g. ops-added indexes] → every `unexpected` is still worth one look; a `--json` consumer can filter. An ignore-list flag is deliberately deferred until someone asks.
- [Structured fields on schema objects could drift from the statement text] → they are filled at the same call sites that write the text, and the migrate golden files pin both.

## Migration Plan

None: a new command, no stored format changes.
