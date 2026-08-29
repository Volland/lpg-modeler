# Add visual LPG modeler

## Why

The locked v1 (`lat.md/architecture#Roadmap`) ships a compiler pipeline with a
**read-only** canvas, deferring interactive modeling to v2. The requested product is
the opposite: a VS Code extension where a user draws node types, edge types, and
properties on a canvas and generates schemas without ever opening a text file.

Building the compiler first and the canvas second means nobody can use the tool for
its stated purpose until v2. Pulling visual authoring forward makes the extension
usable end to end in one release, and the IR is still exercised on every canvas
action, so the metamodel is validated by real use rather than only by tests.

## What changes

Amends **`lat.md/architecture#Roadmap`** only. Locked decisions #1 through #14 are
**unchanged** - in particular the YAML model remains canonical (#1) and the canvas
remains a companion webview (Editing Surface), not a custom text editor.

Pulled forward from the v1 OUT list:

- bidirectional canvas editing (canvas writes back through the `yaml` Document API)
- the layout sidecar and editable named views
- the SHACL and OWL targets

Deliberately still out: migrations and the lockfile diff, the Memgraph target, and
user-supplied template targets.

## Capabilities

- `model-format` - the YAML model file, resolution into an IR, and validation.
- `visual-modeling` - the canvas as the authoring surface, plus views and layout.
- `schema-generation` - generating Ladybug DDL, Neo4j constraints, SHACL, and OWL.

## Targets affected

`ladybug`, `neo4j`, `shacl`, `owl`.

Ladybug and Neo4j were already in v1. SHACL and OWL are pulled forward because the
request names ontology output explicitly; doing so commits now to the SHACL-primary
split and to gradual reification (decisions #10 and #11) rather than deferring them.

## Non-goals

- **The canvas does not become canonical.** YAML stays the source of truth. A user
  need never open it, but it stays reviewable and diffable in version control.
- **No migrations.** No lockfile, no diffing, no ALTER generation. Stable element ids
  (#5) still ship, because layout keying depends on them.
- **No Memgraph and no template targets.** Only targets testable against a real
  engine, plus the two RDF targets, ship here.
- **No metagraph edges-on-edges.** Still out of the core per #3.
- **No live database connection.** Generation writes files; applying them is the
  user's job.
- **No custom DSL or language server.** YAML plus the bundled JSON Schema only.

## Risks

Bidirectional editing is the hardest deferred item being pulled in: canvas mutations
must preserve comments and key order in a file the user may also edit by hand. It is
isolated behind a single mutation module in `core` so the risk does not spread.
