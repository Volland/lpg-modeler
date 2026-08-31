<h1 align="center">LPG Modeler</h1>

<p align="center">
  <strong>Design a property graph once. Generate every schema from it.</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=pavlyshyn.lpg-modeler"><img src="https://img.shields.io/visual-studio-marketplace/v/pavlyshyn.lpg-modeler?color=2f5fe0&label=marketplace" alt="Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=pavlyshyn.lpg-modeler"><img src="https://img.shields.io/visual-studio-marketplace/i/pavlyshyn.lpg-modeler?color=2f5fe0" alt="Installs"></a>
  <a href="https://github.com/Volland/lpg-modeler/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2f5fe0" alt="MIT licensed"></a>
</p>

LPG Modeler turns one hand-editable model file into **LadybugDB DDL, Neo4j constraints,
SHACL shapes, an OWL ontology, GQL graph types, PG-Schema and LinkML** — and tells you,
before you ship, exactly what each
database is unable to enforce.

You author the model as YAML, or on a canvas beside it. Everything downstream is generated.

![One model, four artifacts](https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/pipeline.png)

---

## The problem it removes

A graph schema usually lives in four places at once: the DDL that creates the tables, the
constraint script someone ran last quarter, a diagram in a wiki that stopped being true, and
an ontology maintained by a different team. They drift.

The diagram says a property is required. The database never enforced it. Nobody finds out
until a null reaches production.

LPG Modeler makes three of those four artifacts **generated**, and makes the fourth one
**reviewable text**.

---

## What it does

### A canvas that writes the file

Create node types, draw edges, add properties and rename things directly on the diagram.
Every action becomes a targeted edit to the YAML, applied as a workspace edit — so undo,
dirty state and version control all behave the way you expect.

The canvas opens *beside* the file, in the manner of Markdown preview. It never replaces the
editor, so you keep schema-driven completion and hover in the YAML itself.

![The canvas holds no state of its own](https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/intent-loop.png)

**Why it matters:** the webview holds no model state. It posts an intent, the extension host
computes the edits, and a fresh diagram comes back from the file. Nothing on screen can
diverge from what your teammates will review.

### Diffs you can actually review

Edits are computed as text splices from the YAML syntax tree, never as a re-serialization.
Renaming a type changes exactly the lines that name it — not the whole file.

Diagram coordinates live in a separate sidecar keyed by a stable element id, so rearranging a
diagram produces **no semantic diff at all**, and renaming a type moves nothing on screen.

![Moving a box does not dirty your diff](https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/files.png)

**Why it matters:** a schema change that shows up as a 400-line reformat does not get
reviewed. It gets approved.

### Seven generators, one model

| Target | Produces | Notes |
| --- | --- | --- |
| `ladybug` | `CREATE NODE TABLE` / `CREATE REL TABLE` | Abstract hierarchy flattened to one table per concrete type |
| `neo4j` | Constraints and indexes | Hierarchy expressed as labels; Community/Enterprise aware |
| `shacl` | `sh:NodeShape` per type | The primary constraint artifact — closed-world, so it means what the model means |
| `owl` | Classes, `subClassOf`, `hasKey` | The safe assertional subset only |
| `gql` | `CREATE GRAPH TYPE` element types | ISO/IEC 39075; hierarchy carried as implied labels |
| `pgschema` | PG-Schema graph type | The most faithful target — `ABSTRACT`, inheritance and PG-Keys all survive |
| `linkml` | LinkML classes and slots | Opens the LinkML generator ecosystem; edges with properties are reified |

One type hierarchy, one set of keys, one set of properties — with no second definition to
keep in sync.

The last three are standards rather than database dialects. They are what makes a model
readable by tools this project does not own — and they are emitted rather than adopted as the
model format, because no published standard has anywhere to put stable element ids, import
aliases, or a rename's previous IRI.

### Loss is reported, never silent

Each generator publishes what it can express. Everything it cannot becomes a warning in the
Problems panel **and** a comment at the exact line of the generated file, so the operator
reading the DDL learns what the author already knew.

![Every target says what it cannot do](https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/capabilities.png)

```cypher
CREATE NODE TABLE IF NOT EXISTS Person (
  // UNENFORCED: 'email' is required in the model; LadybugDB has no NOT NULL.
  // UNENFORCED: 'email' is unique in the model; only the primary key is unique.
  email STRING,
  id STRING,
  PRIMARY KEY(id)
);
```

**Why it matters:** a `required` constraint that quietly vanishes is a data-integrity bug
that surfaces in production, long after the model stopped being read.

### Schema-driven YAML editing

The model format ships as a JSON Schema the extension contributes, so completion, hover
documentation and structural errors come from the YAML tooling you already have. There is no
new language server to install and no proprietary file format to get locked into.

### Views, so diagrams stay readable

A view names a subset of types plus an optional neighbourhood expansion. One model can carry
an overview beside several focused diagrams, and validation tells you which types have fallen
out of every view — so diagrams do not quietly stop covering the model as it grows.

### Serious about RDF

The RDF export is split in two, because a property graph schema and an OWL ontology do not
mean the same thing. SHACL carries the constraints because it is closed-world validation. OWL
asserts only what is safe to assert — no `rdfs:domain`, no `rdfs:range`, no cardinality
restrictions, because those instruct a reasoner to reclassify individuals rather than reject
bad data.

Reification is applied only where it is needed: an edge with no properties stays a plain
object property, and an edge that carries properties becomes an n-ary relation class plus a
shortcut.

![Reify only what needs reifying](https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/reification.png)

---

## Quick start

**1.** Create a file ending in `.lpg.yaml`:

```yaml
namespace:
  prefix: catalog
  iri: https://example.org/vocab/catalog#

nodes:
  Product:
    key: [sku]
    props:
      sku:   { type: string, required: true }
      title: { type: string, required: true }
      price: { type: float }
```

**2.** Run **LPG: Open Canvas** from the command palette. The diagram opens beside the file.

*Starting from nothing?* Run **LPG: New Model** instead. It asks for a prefix and a base IRI,
writes the file, and opens the canvas on it — no need to know the shape of a model file first.

**3.** Run **LPG: Generate Schema** and pick a target. The artifact is written next to the
model and opened beside it.

That is the whole loop. Nothing here needs a running database.

---

## Commands

| Command | What it does |
| --- | --- |
| `LPG: New Model` | Creates a model file, opens it, and opens the canvas on it |
| `LPG: Open Canvas` | Opens the diagram beside the active model file |
| `LPG: Generate Schema` | Prompts for a target and writes the artifact next to the model |

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| `lpg.targets.neo4j.edition` | `community` | Community cannot enforce existence or node key constraints, so under it those are reported as downgrades and emitted as comments. Set to `enterprise` to emit them for real. |

## Files

| File | Holds | Reviewed? |
| --- | --- | --- |
| `model.lpg.yaml` | Semantics. The canonical artifact. | Yes |
| `model.views.yaml` | Which types each diagram shows | Usually |
| `model.layout.json` | Coordinates, keyed by stable element id | No — pure presentation |

---

## Also runs in CI

The same resolution and validation the editor runs is available as a command, so a pull
request can be gated on the model being valid:

```bash
npx lpg-modeler-cli check model/domain.lpg.yaml

# Regenerate and fail the build if the committed schema drifted.
npx lpg-modeler-cli emit model/domain.lpg.yaml --target ladybug --target shacl --out schema
git diff --exit-code schema
```

That second step is the one that pays off over time. It turns "someone forgot to regenerate
the DDL" from a thing you discover during an incident into a red build.

---

## Requirements

VS Code 1.90 or newer. No database connection, container, or external service is required —
generation is entirely offline.

## Known limitations

- **Migrations and the lockfile diff are not in this release.** The model produces a schema, not a diff against a previous one.
- **Nested edges** — edges that are themselves endpoints of other edges — are outside the core metamodel, because Neo4j cannot represent them natively.
- **Composite keys on LadybugDB** are emitted as a synthesized concatenated column, since a composite `PRIMARY KEY` does not parse there.
- **Uniqueness in SHACL** across all instances needs a SPARQL-based constraint, which core SHACL cannot express. It is reported as a downgrade.
- **Enums** have nowhere to go in LadybugDB, Neo4j, GQL or PG-Schema. SHACL, OWL and LinkML enforce them; the rest report a downgrade.
- **Open types** cannot exist in LadybugDB's mandatory closed schema, nor in a GQL element type or a LinkML class. Reported as a downgrade.
- **Cardinality** is enforced by LadybugDB and SHACL. Neo4j, GQL and OWL have no constraint for it and say so.
- **Composite keys in GQL graph types** cannot be expressed, because a key marker attaches to a single property. Reported as a downgrade.
- **Edges carrying properties in LinkML** are reified into a class, because LinkML has no binary relation that can hold them. Reported as a downgrade.
- The canvas is built on React Flow, which is DOM-based and degrades past a few hundred nodes on one diagram. Use views to keep any single diagram small.

## Documentation

Full documentation, including the model format reference and the design notes behind it:
**https://volland.github.io/lpg-modeler/**

- [Getting started](https://volland.github.io/lpg-modeler/getting-started.html)
- [Model format](https://volland.github.io/lpg-modeler/model-format.html)
- [Targets](https://volland.github.io/lpg-modeler/targets.html)
- [CLI](https://volland.github.io/lpg-modeler/cli.html)
- [Architecture](https://volland.github.io/lpg-modeler/architecture.html)

## Contributing and issues

Source and issue tracker: [github.com/Volland/lpg-modeler](https://github.com/Volland/lpg-modeler).
Adding a generation target is one file plus one registry entry — see
[Targets](https://volland.github.io/lpg-modeler/targets.html) for the capability set a new one
declares.

## License

MIT.
