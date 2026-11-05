# One ontology, two homes. Typed Graph notes and an LPG schema, kept in step.

### Your team describes its domain twice: once in the notes people write, once in the schema the database enforces. LPG Modeler 0.19 reads and writes Typed Graph's `Types/` folder, so the two descriptions become one — worked through one fleet model, with every output pasted from a real run.

---

Every team that builds on a graph ends up with **two descriptions of the same domain**.

One lives in the notes. A vault of Markdown — decisions, requirements, the depot that closes in winter, the driver who only does night shifts — where people write in prose and link things with their names. [Typed Graph](https://github.com/Volland/typedgraph) gives those notes types: a `Types/` folder of schema notes says what a `Truck` note carries and which links it may have, and the Obsidian plugin, the `tg` CLI and the VS Code commands check every note against it.

The other lives in the database. A model that says a `Truck` is a `Vehicle` is an `Asset`, that every asset has exactly one tag, that a VIN is unique — and that compiles into the constraints LadybugDB, Neo4j, Memgraph or FalkorDB actually enforce.

Both descriptions are correct, and both are about trucks. Nothing keeps them the same. The notes grow a property the schema never heard of; the schema renames one the notes still use. Each side is right about itself and wrong about the other, and nobody finds out until someone asks a question that crosses the line.

**This article is about crossing it.** Release 0.19 adds two commands:

- **`lpg export --to tgs`** writes a model as TGS schema notes into a `Types/` folder — a folder of notes, one per type, or a single note holding the whole ontology;
- **`lpg import Types/`** reads a schema folder — any number of ontology notes — back into a model.

*(Everything below was run with LPG Modeler 0.19.0, `tg` 0.22.0 and LadybugDB 0.19.1. Every output block is pasted from those runs, with the absolute path trimmed from the front of file names.)*

---

## Two languages for one domain

Typed Graph Schema and an LPG model are not two spellings of one thing. They were built for different readers, and each says something the other cannot.

| | TGS (notes) | LPG model (database) |
|---|---|---|
| Who it serves | people writing notes | code and engines |
| Properties | open: a note may carry anything | closed by default |
| Validation | advisory, never removes a note | enforced on write, per engine |
| Identity | the note's title | a declared key |
| Hierarchy | none — a note may carry several types | abstract types, single inheritance, mixins |
| Edges | typed links in prose, with properties | typed, directed, with endpoint multiplicity |

That table is the whole design problem. A naive export would either drop everything in the right-hand column, or invent TGS syntax that no TGS reader understands. Neither keeps the two in step.

---

## The model

The model is [`fleet.lpg.yaml`](../docs/examples/fleet.lpg.yaml), one of the site's examples: seven node types under a three-level hierarchy, three mixins, one enum and three edge types.

```yaml
nodes:
  Asset:   { abstract: true, key: [assetTag] }                  # every asset has a tag
  Vehicle: { abstract: true, extends: Asset }                   # vin (unique), fuel (enum Fuel)
  Truck:   { extends: Vehicle, mixins: [Timestamped, Located] } # axles 2..6, maxLoadKg
  Van:     { extends: Vehicle, mixins: [Timestamped] }
  Trailer: { extends: Asset, mixins: [Timestamped, Auditable] }
  Depot:   { key: [code], mixins: [Located] }
  Driver:  { key: [licence], mixins: [Timestamped, Auditable] }

edges:
  STATIONED_AT: { from: Asset,  to: Depot, cardinality: { to: "0..1" } }
  DRIVES:       { from: Driver, to: Vehicle }                   # since: date
  TOWS:         { from: Truck,  to: Trailer, cardinality: { to: "0..1" } }
```

*(Condensed; the file has the ids, the property types and the comments.)*

---

## Export: a folder of notes, or one

```bash
lpg export fleet.lpg.yaml --to tgs --out Types
```

Without `--layout`, the command asks:

```text
Write the ontology as
  1) a folder of notes, one per node type
  2) a single note holding the joint ontology
Layout [1]:
```

Both are valid TGS, and both import back identically. **`folder`** suits a vault, where each type is a note you can open, link to and write about. **`single`** suits a project with several ontologies side by side — Typed Graph's own convention, `Types/code-types.md` beside `Types/spec-types.md`. In VS Code the same choice is a pick in **LPG: Export Typed Graph Schema…**.

The folder layout writes seven notes:

```text
Types/Asset.md
Types/Depot.md
Types/Driver.md
Types/Trailer.md
Types/Truck.md
Types/Van.md
Types/Vehicle.md
```

And this is `Types/Truck.md`, whole:

```yaml
---
tgs: "0.1"
prefixes:
  fleet: "https://example.org/vocab/fleet#"
schema:
  uri: fleet:Truck
  properties:
    axles: number
    maxLoadKg: number
    createdAt: {kind: datetime, required: true}
    updatedAt: datetime
    latitude: number
    longitude: number
    vin: {required: true}
    fuel: {values: [diesel, electric, hydrogen]}
    assetTag: {required: true}
  edges:
    STATIONED_AT: {target: Depot, many: false}
    TOWS: {target: Trailer, many: false}
edgeTypes:
  TOWS:
    uri: fleet:TOWS
    from: Truck
    to: Trailer
lpg:
  format: "1.0"
  namespace: {prefix: fleet, iri: "https://example.org/vocab/fleet#"}
  nodes:
    Truck: {id: n_truck, extends: Vehicle, mixins: [Timestamped, Located], props: {axles: {id: p_axl, type: INT64, min: 2, max: 6}, maxLoadKg: {id: p_load, type: INT64, min: 0}}}
  edges:
    TOWS: {id: e_tows, from: Truck, to: Trailer, cardinality: {from: "*", to: "0..1"}}
  mixins:
    Timestamped: {id: m_ts, props: {createdAt: {id: p_cts, type: ZONED_DATETIME}, updatedAt: {id: p_uts, type: ZONED_DATETIME}}}
    Located: {id: m_loc, props: {latitude: {id: p_lat, min: -90, max: 90}, longitude: {id: p_lon, min: -180, max: 180}}}
  enums:
    Fuel: {id: x_fuel, values: [diesel, electric, hydrogen]}
---
```

Read it top to bottom and three decisions show.

**Everything a truck has is on the truck.** `vin` and `fuel` come from `Vehicle`, `assetTag` from `Asset`, the timestamps and coordinates from two mixins. TGS has no inheritance, so a note typed `Truck` must find all nine properties in `Truck`'s declaration — exactly as LadybugDB gets one table per concrete type with the inherited columns copied down.

**Edges are closed.** `Truck` declares `edges` even though TGS would let it leave them out, because TGS reads a missing `edges` as "any link at all". In the model, a truck has the edges the model gives it and no others; leaving the key out would not lose that rule, it would invert it. The bound `to: "0..1"` becomes `many: false` — the one part of a cardinality TGS can say.

**What TGS cannot say goes in `lpg`.** The hierarchy, the key, the exact integer type, the value bounds, the element ids. TGS §3 says every key in a schema note other than its own "belongs to the note itself and readers MUST ignore them" — so the note above stays valid TGS, and the `lpg` key rides along for the trip home.

The export also says out loud what TGS readers will *not* enforce:

```text
fleet.lpg.yaml:37:3 warning [tgs] downgrade-abstract: Node type 'Asset' is abstract, which TGS cannot say: notes of it can be created. It is recorded in the note's lpg key.
fleet.lpg.yaml:37:3 warning [tgs] downgrade-key: Node type 'Asset' is keyed by (assetTag), which TGS has no identity for: a note is identified by its title. The key is recorded in the note's lpg key.
fleet.lpg.yaml:57:3 warning [tgs] downgrade-inheritance: Node type 'Truck' extends 'Vehicle', which TGS has no hierarchy for. Its inherited properties are written on it, and its edges' endpoints list concrete types.
fleet.lpg.yaml:51:7 warning [tgs] downgrade-unique: Property 'Vehicle.vin' is unique, which a TGS validator does not check. It is recorded in the note's lpg key.
info [tgs] downgrade-open: TGS frontmatter is always open, so the 5 closed node type(s) will accept properties they do not declare.
```

*(Five of the eleven lines; the other six repeat three of those codes for the other types. The eight value bounds are reported at info, as every target without bounds reports them.)*

That is the rule this tool has kept since its first target: **a constraint that quietly vanishes is a bug.** Writing `unique` into the `lpg` key is how it survives the trip; the warning is how you know Obsidian will not stop two trucks sharing a VIN.

---

## The reference reader agrees

A format is only as real as the reader that accepts it, so the exported folder goes to `tg`, Typed Graph's own validator:

```text
$ tg validate --schema-only
No findings in 13 notes.
```

*(Thirteen, because the vault also holds the six data notes of the next section.)*

The test suite does the same for every fixture in both layouts whenever `tg` is installed — and first feeds it a broken schema note, to prove the check reports something when there is something to report.

---

## Notes typed by the schema

Now the notes. Six of them, written as anyone would write them in Obsidian: two depots, a trailer, a driver, and two trucks.

```markdown
---
type: Truck
assetTag: T-104
vin: WDB9634031L123456
fuel: diesel
createdAt: 2024-01-15T09:30:00+01:00
---
STATIONED_AT:: [[Depot North]]
TOWS:: [[Trailer 7]]
```

The second truck, `T-105`, has four mistakes in it: no VIN, a fuel the enum does not list, two depots, and a depot where a trailer should be.

```markdown
---
type: Truck
assetTag: T-105
fuel: petrol
createdAt: 2024-05-02T10:00:00+01:00
---
STATIONED_AT:: [[Depot North]]
STATIONED_AT:: [[Depot South]]
TOWS:: [[Depot South]]
```

```text
$ tg validate
Fleet/T-105.md: warning missing-property: Missing required property 'vin' for type Truck
Fleet/T-105.md: warning value-not-allowed: Property 'fuel' value 'petrol' is not one of: diesel, electric, hydrogen
Fleet/T-105.md:8: warning too-many-edges: Edge type 'STATIONED_AT' allows one edge for Truck, found 2
Fleet/T-105.md:9: warning wrong-target-type: Edge 'TOWS' expects target type Trailer, found Depot

0 errors and 4 warnings in 13 notes.
```

All four found, and every one of them is a rule that came from the model: `required` on `vin`, the `Fuel` enum, the `0..1` on `STATIONED_AT`, the endpoint of `TOWS`. **The rules the database enforces are now the rules the notes are checked against** — and nobody wrote them twice.

They are warnings, not errors, and that is right. TGS validation is advisory by design: it never removes a note, because a note half-written is still worth keeping. The database is where `petrol` gets refused.

---

## Coming back: an edit in the notes, a diff in the model

Ownership does not have to sit on one side. Say the fleet manager, working in the notes, decides trucks need an insurance date and adds one line to `Types/Truck.md`:

```yaml
    insuranceExpires: date
```

The model had been locked at its deployed state with `lpg lock`. Import the folder over it, and ask what changed:

```text
$ lpg import Types --out fleet.lpg.yaml
fleet.lpg.yaml
$ lpg diff fleet.lpg.yaml
additive    property Truck.insuranceExpires: added as date
1 additive since revision 1
```

One line, and the right one. The hierarchy, the key, the mixins and every element id came back from the `lpg` key, so the diff compares the model **by id**, as `lpg diff` always does — not by guessing from names. From here `lpg migrate` writes the `ALTER TABLE` for whichever engines you deploy to.

Renames are where the ids earn their keep, and where this round trip asks one thing of you. Rename `maxLoadKg` to `maxPayloadKg` in the TGS properties only:

```text
destructive property Truck.maxLoadKg: removed
additive    property Truck.insuranceExpires: added as date
additive    property Truck.maxPayloadKg: added as float
1 destructive, 2 additive since revision 1
```

A drop and an add — and `float`, because the exact `INT64` was recorded under the old name. Rename it in the `lpg` key as well, and the id follows the property:

```text
additive    property Truck.insuranceExpires: added as date
breaking    property Truck.maxPayloadKg: renamed from 'maxLoadKg'
1 breaking, 1 additive since revision 1
```

That is the same rule the model file has always followed — [renames are not deletes](renames-are-not-deletes.md) because the id says so, never because two names look alike. The `destructive` label in the first run is the gate doing its job: `lpg migrate` will not generate that drop until you pass `--allow-destructive`.

---

## The other direction: an ontology that started as notes

Not every ontology starts as a schema. Typed Graph's own projects keep theirs in `Types/code-types.md` and `Types/spec-types.md`: decisions, requirements, constraints and the edges between them — `implements`, `contradicts`, `motivated_by`. Those two notes were never near this tool, and carry no `lpg` key.

```text
$ lpg import Types --out work.lpg.yaml
work.lpg.yaml
info import-tgs-undeclared-type: CodeFile, CodeSymbol are named as an endpoint or a target but declared by no note, so they are read as empty node types.
warning import-tgs-open-endpoint: defines allows any type at one end, and an edge type here runs between two named types, so it is not imported.
warning import-tgs-endpoint-union: An edge type here has one type at each end. With no common ancestor to stand for the several TGS names, the first is kept: implements from CodeSymbol (dropped CodeFile); implements to Requirement (dropped Decision); …
info import-tgs-title-key: Decision, Requirement, Scenario, Constraint, Concept, Change, Capability, ADR, … name no identity, and every concrete node type needs a key, so each is keyed by a required 'title': a note is identified by its title.
info import-tgs-not-carried: The model has nowhere to keep templates of Decision, Requirement, Scenario, Constraint, Concept, Change; defaults of Decision.status, …
```

*(The union line names twelve narrowed endpoints; three are shown.)*

Every one of those lines is a real difference between the two languages, said rather than smoothed over:

- **Identity.** A type with no key cannot become a table, and TGS declares none — but a note *has* an identity: its title. So that is the key, and the import says so. A type with an `id` rule (`id: uuid7`) is keyed by that property instead.
- **Value lists become enums**, shared where the values are the same: `Requirement`, `Scenario`, `Concept` and `Capability` all get `RequirementStatus`.
- **Polymorphic edges narrow.** `contradicts` in TGS may run from four types to three. An edge type here runs between one type and one type, and with no common parent to stand for all of them, the first is kept and the rest are named. This is the honest cost of the direction. TGS has no way to say that `CodeSymbol` and `CodeFile` are both artifacts; the model does — an abstract `Artifact` above them, with `implements` running from it — and once it is said there, an export writes it back to the notes as `from: [CodeFile, CodeSymbol]`, with the hierarchy kept in the `lpg` key.

What comes out validates, and generates. The LadybugDB script for it:

```cypher
CREATE NODE TABLE IF NOT EXISTS Decision (
  title STRING,
  // UNENFORCED: 'status' is limited to enum 'DecisionStatus' in the model.
  status STRING,
```

```cypher
CREATE REL TABLE IF NOT EXISTS implements (
  FROM CodeSymbol TO Requirement,
  since STRING,
  // UNENFORCED: 'confidence' is limited to enum 'Confidence' in the model.
  confidence STRING,
  note STRING
);
```

```text
$ lpg apply work.ladybug.cypher --target ladybug --database work.lbdb
…
[22/22] CREATE REL TABLE IF NOT EXISTS verifies (
applied 22 statement(s) to work.lbdb
```

Ten node tables and twelve relationship tables, from two notes someone wrote for a different tool. The design notes of a project, queryable with Cypher.

---

## Which side owns it?

Either, and the commands are built so you do not have to decide forever.

**Model first.** The schema is designed in `.lpg.yaml`, on the canvas, with the database in mind. Export after each change; the notes follow. An export **merges** into notes that exist: it replaces only `tgs`, `schema`, `schemas`, `edgeTypes`, `prefixes` and `lpg`, and keeps every other frontmatter key and the body you wrote, byte for byte. It never deletes a note — a type you removed from the model leaves its note behind, reported as stale, because importing the folder would bring it back. And it refuses to rewrite a note that declares types the model does not have, unless you pass `--force`.

**Notes first.** The ontology grows where the people are, in the vault. Import when the database needs to catch up, and `lpg diff` tells you what that costs before `lpg migrate` does anything.

**Both.** The `lpg` key is what lets a model go out as notes and come back as the same model — same hierarchy, same keys, same ids. One thing does not come back: the comments in the `.lpg.yaml`, because an import writes a model rather than editing one. If the model file carries prose you care about, import beside it and diff, rather than over it.

---

## Try it

```bash
# the model as a schema folder; asks for the layout
npx lpg-modeler-cli export fleet.lpg.yaml --to tgs --out Types

# check notes against it with Typed Graph
tg validate

# a schema folder — or one note of it — back into a model
npx lpg-modeler-cli import Types --out fleet.lpg.yaml
npx lpg-modeler-cli import Types/code-types.md
```

In VS Code: **LPG: Export Typed Graph Schema…** and **LPG: Import Typed Graph Schema…**, each asking whether you mean a folder of notes or a single one.

Two descriptions of one domain will always drift. The fix is not to pick one and abandon the other — the notes are where people think, and the schema is where the data is kept honest. The fix is to make crossing between them one command, and to have that command say exactly what did not survive the crossing.
