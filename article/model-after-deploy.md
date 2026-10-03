# One model, used every day. Typed code, audited data, drift checks and linted queries from a graph schema.

### A model that is read only when the schema changes is documentation. LPG Modeler 0.18 makes it something your code, your CI, your queries and your agents consult on every run — worked through one fleet model, with every output pasted from a real run.

---

For most of its life the model had one job at one moment. You changed the YAML, generated a schema, and ran it. After that the model went quiet. Your application code kept its own idea of what a `Truck` is, the database kept whatever it happened to enforce, and the queries in your repository kept naming properties that may or may not still exist. Nothing told you when those drifted from the model, because nothing was asking.

**This article is about asking.** The model already knows which properties are required, which are unique, which edge runs which way, and what each database cannot enforce. Release 0.18 adds the commands and targets that put those facts to work after the schema is deployed:

- a **TypeScript** target, so a renamed property breaks your build instead of a query;
- a **schema card** and a read-only **MCP server**, so an agent writes queries against the schema as it is;
- **`lpg audit`**, which counts the rows a database could not refuse;
- **`lpg drift`**, which says whether the database is still what the model says;
- **`lpg lint-queries`**, which checks the names inside your query files;
- **SQL import**, so a relational schema can be the starting point;
- a **SQL/PGQ** target for DuckDB, a relational engine that enforces nearly everything.

*(Everything below was run with LPG Modeler 0.18.1 against LadybugDB 0.19.1 and DuckDB 1.4.4 with its `duckpgq` extension. Every output block is pasted from those runs, with the absolute path trimmed from the front of file names. `lpg targets` lists thirteen targets.)*

---

## The model

One model carries the whole article: a fleet of trucks, vans and trailers, stationed at depots and driven by drivers. Download [`fleet.lpg.yaml`](../docs/examples/fleet.lpg.yaml), which is also one of the site's examples, or read the part that matters here (ids and comments left out):

```yaml
enums:
  Fuel:
    values: [diesel, electric, hydrogen]

mixins:
  Timestamped:
    props:
      createdAt: { type: zoneddatetime, required: true }
  Located:
    props:
      latitude:  { type: float, min: -90,  max: 90 }
      longitude: { type: float, min: -180, max: 180 }

nodes:
  Asset:
    abstract: true
    key: [assetTag]
  Vehicle:
    abstract: true
    extends: Asset
    props:
      vin:  { type: string, required: true, unique: true }
      fuel: { type: string, enum: Fuel }
  Truck:
    extends: Vehicle
    mixins: [Timestamped, Located]
    props:
      axles: { type: int, min: 2, max: 6 }

edges:
  STATIONED_AT:
    from: Asset
    to: Depot
    cardinality: { to: "0..1" }
```

A truck is a vehicle is an asset. It carries a timestamp and a position because it applies two mixins, not because those are kinds of thing it is. Every asset is stationed at no more than one depot, and the edge is declared once, on `Asset`.

---

## 1. Your application code, typed from the model

Your service has a `Truck` type somewhere. It was written by hand, and nothing keeps it honest. The `typescript` target generates it:

```
$ lpg emit fleet.lpg.yaml --target typescript > fleet.ts
```

```ts
export interface Asset {
  /** key */
  assetTag: string
}

export interface Vehicle extends Asset {
  /** unique */
  vin: string
  fuel?: Fuel
}

export interface Truck extends Vehicle, Timestamped, Located {
  /** min 2; max 6 */
  axles?: number
  /** min 0 */
  maxLoadKg?: number
}
```

A parent and a mixin are both `extends`, and an interface declares only its own properties, so the file reads like the model and a change to `Timestamped` edits one interface. A required property is a plain member and an optional one is `?`, which makes requiredness the one constraint this target genuinely enforces: leave out `vin` and the build fails. Enums are enforced the same way, as a union.

What a type system cannot say does not vanish. Uniqueness is the `/** unique */` comment, the bounds on `axles` are in the JSDoc, and everything else a query builder needs sits in a `SCHEMA` constant derived from the same model:

```ts
Truck: { labels: ['Truck', 'Vehicle', 'Asset'], key: ['assetTag'], abstract: false },
STATIONED_AT: STATIONED_AT
```

The labels are the ones a multi-label engine gives a `Truck`, the key is the inherited one, and the cardinality is `many-to-one`, the name for a bound of `0..1` on the target end. Each thing the types cannot hold is also reported, at `info`, so the omission is visible rather than silent. The test suite type-checks this file for every fixture under `strict`, because a golden file alone would freeze a syntax error as faithfully as a working declaration.

---

## 2. The same model, for agents

An agent that writes Cypher needs the schema in front of it. Pasting the YAML works, and it carries element ids and layout concerns a model of language has no use for. The `context` target emits the schema as a card, one line per element, the same bytes every time:

```
- **Asset** (abstract) key: assetTag — assetTag!: string
- **Truck** < Vehicle +Timestamped +Located key: assetTag (from Asset) — axles: int [2..6], maxLoadKg: int [0..]
- **Vehicle** (abstract) < Asset key: assetTag (from Asset) — vin!^: string, fuel: string =Fuel
- **STATIONED_AT**: Asset → Depot, many-to-one
```

A card pasted into a prompt is a snapshot. `lpg mcp` serves the same facts as lookups an agent asks for at call time, over the Model Context Protocol on stdio, read-only:

```
$ lpg mcp fleet.lpg.yaml
```

I drove it with a scripted client: initialize, list the tools, then ask about a truck. The tools are `schema_card`, `list_types`, `describe_type` and `describe_edge`, and asking about `Truck` returns this, summarised:

```
tools: schema_card, list_types, describe_type, describe_edge
Truck extends Vehicle; ancestors Vehicle, Asset; mixins Timestamped, Located; key assetTag
properties: axles, maxLoadKg, createdAt (Timestamped), updatedAt (Timestamped),
            latitude (Located), longitude (Located), vin (Vehicle), fuel (Vehicle), assetTag (Asset)
outgoing:   STATIONED_AT -> Depot  (declared on Asset),  TOWS -> Trailer  (declared on Truck)
incoming:   DRIVES from Driver     (declared on Vehicle)
```

The edges are the part an agent needs before writing a pattern. `STATIONED_AT` is declared on `Asset` and reaches `Truck` by inheritance, so the answer says where it is declared. The server holds no write tool, because an agent changes a model through a person and a diff, never through a socket. It re-reads the model on every call, so an edit on disk reaches the next question in the same session, and the test suite edits a model while a session is running to prove it.

---

## 3. What each engine will not enforce

The part of the model that matters most after deployment is the part the engine ignores. The `docs` target writes one self-contained HTML page for the model, one section per type, and an enforcement matrix computed from the capability sets the generators already report their downgrades from. For the features this fleet uses, these are its cells:

| Feature | ladybug | neo4j | memgraph | falkordb | sqlpgq |
| --- | --- | --- | --- | --- | --- |
| Required property (not the key) | key only | Enterprise only | enforced | enforced | enforced |
| Unique property (not the key) | key only | enforced | enforced | enforced | enforced |
| Value constraints | reported, not carried | reported, not carried | reported, not carried | reported, not carried | enforced |
| Cardinality | upper bound of one | reported, not carried | reported, not carried | reported, not carried | upper bound of one |

"Reported, not carried" means generation raises a diagnostic and writes a comment at the site. Nothing is dropped silently, and here is what that looks like for the one table this article uses next:

```
CREATE NODE TABLE IF NOT EXISTS Truck (
  axles INT64,
  maxLoadKg INT64,
  // UNENFORCED: 'createdAt' is required in the model; LadybugDB has no NOT NULL.
  createdAt TIMESTAMP_TZ,
  updatedAt TIMESTAMP_TZ,
  latitude DOUBLE,
  longitude DOUBLE,
  // UNENFORCED: 'vin' is required in the model; LadybugDB has no NOT NULL.
  // UNENFORCED: 'vin' is unique in the model; only the primary key is unique.
  vin STRING,
  // UNENFORCED: 'fuel' is limited to enum 'Fuel' in the model.
  fuel STRING,
  assetTag STRING,
  PRIMARY KEY(assetTag)
);
```

LadybugDB takes `createdAt` and `vin` as written and enforces neither. The model says they are required, and the comment says the database will not. That is a fair trade, and it leaves a question: **are those comments true of your data?**

---

## 4. Counting what the engine could not refuse

`lpg audit` turns each of those comments into a question. For every constraint the target leaves unenforced it generates a read-only query that counts violations, and it can run them. I applied the generated schema to a fresh LadybugDB, then wrote three trucks the way an application with a bug would:

```
$ lpg emit fleet.lpg.yaml --target ladybug --out .
$ lpg apply fleet.ladybug.cypher --target ladybug --database fleet.lbdb
applied 8 statement(s) to fresh.lbdb
```

```cypher
CREATE (:Truck {assetTag: 'T-1', vin: 'V1', fuel: 'diesel', axles: 4,
                createdAt: '2026-01-01 00:00:00+00', latitude: 50.1});
CREATE (:Truck {assetTag: 'T-2', vin: 'V1', fuel: 'coal', axles: 9, latitude: 95.0});
CREATE (:Truck {assetTag: 'T-3', vin: 'V3', fuel: 'electric', axles: 3,
                createdAt: '2026-01-02 00:00:00+00'});
```

The database accepted all three. `T-2` has nine axles, a latitude of 95, a fuel that is not in the enum, no `createdAt`, and the same `vin` as `T-1`. Now ask the model:

```
$ lpg audit fleet.lpg.yaml --target ladybug --database fleet.lbdb
[1/21] Depot.latitude in -90..90: 0
[2/21] Depot.longitude in -180..180: 0
[3/21] Driver.name required: 0
[4/21] Driver.createdAt required: 0
[5/21] Driver.createdBy required: 0
[6/21] Trailer.lengthM in 0..: 0
[7/21] Trailer.createdAt required: 0
[8/21] Trailer.createdBy required: 0
[9/21] Truck.axles in 2..6: 1
[10/21] Truck.maxLoadKg in 0..: 0
[11/21] Truck.createdAt required: 1
[12/21] Truck.latitude in -90..90: 1
[13/21] Truck.longitude in -180..180: 0
[14/21] Truck.vin required: 0
[15/21] Truck.vin unique: 1
[16/21] Truck.fuel in enum Fuel: 1
[17/21] Van.cargoVolumeM3 in 0..: 0
[18/21] Van.createdAt required: 0
[19/21] Van.vin required: 0
[20/21] Van.vin unique: 0
[21/21] Van.fuel in enum Fuel: 0
5 violation(s) found
```

Five checks found something, and the exit code is 1, so a pipeline can stop on it. The checks that read zero are as much the point: the audit says what it looked at. A constraint the database genuinely enforces is not audited, because the engine already refused those writes. The key is the example: a second `T-2` was rejected outright by LadybugDB with a duplicate primary key error, while a duplicate `vin` went through.

Without a connection the same command writes the script for review, so it can be read, committed and scheduled like any other artifact. The database is opened read-only, and on the server engines every check runs through a read session or `GRAPH.RO_QUERY`. Audit cannot write anywhere, by construction.

---

## 5. Is the database still what the model says?

A schema changed by hand on the server, or a deploy that never ran, shows up only when a query fails. `lpg drift` compares what a database holds with what the model requires of that target. First the clean case, against the database from the last section:

```
$ lpg drift fleet.lpg.yaml --database fleet.lbdb
unexpected: column Truck.notes — the database holds it as STRING; the model does not declare it
1 drift finding(s) against ladybug
```

Then two things that happen to real systems. Someone adds a column to `Truck` in a console, and the model gains a `capacity` on `Depot` that was never deployed:

```
$ lpg drift fleet-next.lpg.yaml --database fleet.lbdb
missing: column Depot.capacity — the model declares it as INT64; the database has no such column
unexpected: column Truck.notes — the database holds it as STRING; the model does not declare it
2 drift finding(s) against ladybug
```

Both directions are named: `missing` is declared by the model and absent from the database, `unexpected` is the reverse. The exit code is 1, and `--json` prints the same findings for a machine:

```json
{
  "target": "ladybug",
  "findings": [
    {
      "kind": "missing",
      "object": "column Depot.capacity",
      "detail": "the model declares it as INT64; the database has no such column"
    },
    {
      "kind": "unexpected",
      "object": "column Truck.notes",
      "detail": "the database holds it as STRING; the model does not declare it"
    }
  ]
}
```

There is no database to reach when the question is about a committed script. `--script` compares the model with a generated DDL file, which is how a pull request can ask whether the checked-in schema is stale:

```
$ lpg drift fleet-next.lpg.yaml --script fleet.ladybug.cypher
missing: column Depot.capacity — the model declares it as INT64; the database has no such column
1 drift finding(s) against ladybug
```

Matching is structural. A live schema carries no element ids, and a Neo4j constraint's name is cosmetic, so objects are matched by what they are, never by what they are called: a constraint deployed by another tool under a name this one would not choose is not drift. What a target cannot store is out of scope by construction, so the value bounds on `axles` never show up as findings against an engine that has nowhere to keep them.

---

## 6. Queries are claims about the schema

The queries in a repository are claims about the model: these labels exist, this edge runs this way, this property is a number. Nothing checks them, and a rename breaks them silently. Here is a query file with one correct query and six faulty ones:

```cypher
// Who drives a heavy truck, and what it tows.
MATCH (d:Driver)-[:DRIVES]->(t:Truck)-[:TOWS]->(r:Trailer)
WHERE t.axles >= 3
RETURN d.name, r.lengthM;

MATCH (d:Driver)-[:DRIVE]->(t:Truck) RETURN d.name, t.vin;

MATCH (t:Truck) WHERE t.axels > 4 RETURN t.assetTag;

MATCH (d:Depot) WHERE d.code = 7 RETURN d.name;

MATCH (v:Vehicle) WHERE v.fuel = 'petrol' RETURN v.vin;

MATCH (d:Depot)-[:STATIONED_AT]->(t:Truck) RETURN t.assetTag;

MATCH (a:Trailer)-[:TOWS]->(b:Truck) RETURN a.assetTag;
```

```
$ lpg lint-queries fleet.lpg.yaml fleet.cypher
fleet.cypher:6:20 error lint-unknown-edge: No edge type is called 'DRIVE'. Known: DRIVES, STATIONED_AT, TOWS.
fleet.cypher:8:25 error lint-unknown-property: Truck has no property 'axels'.
fleet.cypher:10:32 error lint-type-mismatch: Depot.code is string, and is compared with a number literal.
fleet.cypher:12:34 error lint-enum-value: 'petrol' is not a value of enum Fuel (diesel, electric, hydrogen).
fleet.cypher:14:16 error lint-edge-direction: STATIONED_AT is traversed against its direction: the model declares STATIONED_AT: Asset → Depot, and the other way round would fit (Depot) and (Truck).
fleet.cypher:16:18 error lint-edge-direction: TOWS is traversed against its direction: the model declares TOWS: Truck → Trailer, and the other way round would fit (Trailer) and (Truck).
6 finding(s) in 1 file(s)
```

The first query is silent. The other six are a misspelt relationship type, a misspelt property, a number compared with a string, a value the enum does not have, and two edges walked backwards. Each finding carries the line and column of the offending token, in the format editors and CI annotators already read.

There is no Cypher grammar behind this. A lexer reads strings, comments, quoted names and numbers correctly, and pattern chains like `(d:Driver)-[:DRIVES]->(t:Truck)` are lifted out of the token stream. Everything else is passed over, and that is the design. A linter that cries wolf is worse than none, so what it cannot resolve it does not report: an unlabelled variable, a name rebound with `WITH ... AS`, a label expression like `:A|B`, a function call that looks like a pattern. A subtype's property read off a supertype-labelled node is a question of which instances are meant, so it is not a finding either. It lints query files only. Finding a query inside a TypeScript or Python source file is a parser's job for each language, and a wrong guess is worse than none.

---

## 7. Starting from a relational schema

Not everyone starts from an empty file. Many teams already model graphs the way the introduction described: as foreign keys and join tables. `lpg import` now reads a `pg_dump --schema-only` dump. The two shapes that matter in the fixture I used are a join table and a unique foreign key:

```sql
-- Primary key is exactly the two foreign keys: an edge type, not a node type.
CREATE TABLE order_line (
    order_id bigint NOT NULL REFERENCES orders(id),
    product_sku text NOT NULL REFERENCES product(sku),
    quantity integer NOT NULL,
    PRIMARY KEY (order_id, product_sku)
);

-- A unique foreign key: each person has at most one profile.
CREATE TABLE profile (
    id uuid PRIMARY KEY,
    person_id uuid NOT NULL UNIQUE REFERENCES person(id),
    bio text
);
```

```
$ lpg import shop.sql --out shop.lpg.yaml
shop.lpg.yaml
info import-fk-edge: Foreign key 'orders.buyer_id' is read as edge type 'BUYER: Orders → Person', and the column is dropped: the edge is where that fact now lives.
info import-join-table: Table 'order_line' is read as edge type 'ORDER_LINE: Orders → Product': its primary key is exactly its two foreign keys. Its other columns are the edge's properties.
info import-fk-edge: Foreign key 'profile.person_id' is read as edge type 'PERSON: Profile → Person', and the column is dropped: the edge is where that fact now lives.
info import-skipped-statements: Statements outside the schema subset were not read: CREATE INDEX ×1, GRANT ALL ×1, SET STATEMENT_TIMEOUT ×1.
```

(Three more `info` lines, about a `point` column read as a string, a serial whose sequence is not carried, and table names read into model spelling, were left out here for space.) The result is a model that checks clean:

```yaml
edges:
  BUYER:
    from: Orders
    to: Person
    cardinality: { from: "*", to: "1" }
  ORDER_LINE:
    from: Orders
    to: Product
    props:
      quantity: { type: INT32, required: true }
  PERSON:
    from: Profile
    to: Person
    cardinality: { from: "0..1", to: "1" }
```

A `NOT NULL` foreign key became a target bound of exactly one, and a `UNIQUE` one bounded the other end at one. The join-table rule is exact on purpose: a table is an edge type only when its primary key is exactly its two foreign keys. A table with its own `id` and two foreign keys is a node type with two edges, because the failure modes are lopsided. A join table read as a node type is merely verbose; a node type read as an edge deletes a type a query may name. Every reading is reported as an inference, in the same voice as the hierarchy inferences the other importers make, and statements the reader does not understand are counted, never silently skipped.

---

## 8. A relational engine, as a graph target

SQL:2023 added property graph queries, and DuckDB implements them in its `duckpgq` extension. The `sqlpgq` target generates ordinary tables that carry the constraints, plus a `CREATE PROPERTY GRAPH` over them. It is the odd one in the matrix in section 3, because underneath it is a relational engine, and a relational engine enforces nearly everything.

```
$ lpg emit fleet.lpg.yaml --target sqlpgq > fleet.sql
```

```sql
CREATE TABLE IF NOT EXISTS Truck (
  axles BIGINT CHECK (axles >= 2 AND axles <= 6),
  maxLoadKg BIGINT CHECK (maxLoadKg >= 0),
  createdAt TIMESTAMPTZ NOT NULL,
  updatedAt TIMESTAMPTZ,
  latitude DOUBLE CHECK (latitude >= -90 AND latitude <= 90),
  longitude DOUBLE CHECK (longitude >= -180 AND longitude <= 180),
  vin VARCHAR NOT NULL UNIQUE,
  fuel Fuel,
  assetTag VARCHAR NOT NULL,
  PRIMARY KEY (assetTag)
);

CREATE TABLE IF NOT EXISTS STATIONED_AT_Truck_Depot (
  src_assetTag VARCHAR NOT NULL,
  dst_code VARCHAR NOT NULL,
  FOREIGN KEY (src_assetTag) REFERENCES Truck (assetTag),
  FOREIGN KEY (dst_code) REFERENCES Depot (code),
  -- at most one target per source: enforced on write.
  UNIQUE (src_assetTag)
);
```

A required property is `NOT NULL` whether or not it is the key. A unique one is `UNIQUE`, the bounds are `CHECK`, the enum is a real type, and a bound at one on an edge is a `UNIQUE` on the other end's key columns. I applied the file to DuckDB and tried to break it:

```
ok       a valid truck
refused  nine axles - Constraint Error: CHECK constraint failed on table Truck with expression CHECK(((axles >= 2) AND (axles <= 6)))
refused  a fuel not in the enum - Conversion Error: Could not convert string 'coal' to UINT8
refused  a duplicate vin - Constraint Error: Duplicate key "vin: V1" violates unique constraint.
refused  no createdAt - Constraint Error: NOT NULL constraint failed: Truck.createdAt
refused  latitude 95 - Constraint Error: CHECK constraint failed on table Truck with expression CHECK(((latitude >= -90) AND (latitude <= 90)))
refused  a second depot for the same truck - Constraint Error: Duplicate key "src_assetTag: T-1" violates unique constraint.
[ { assetTag: 'T-1', name: 'North' } ]
```

Every one of those is refused, including the second depot, which is the model's `0..1` doing exactly what it says. An enum violation surfaces as a conversion error rather than a constraint error, and that is the engine's wording, not mine.

Two things in this target came from measuring rather than recalling, and the first one is a limit worth knowing about. **DuckDB requires every label in a property graph to be unique.** Label alternation like `[:A|B]` does not parse either. So an edge type that reaches an abstract endpoint cannot be one label over several tables the way it is a single relationship type on Neo4j. This is what the generator says about the fleet model:

```
warning [sqlpgq] downgrade-edge-expansion: Edge type 'STATIONED_AT' reaches an abstract endpoint, so it is 3 edge tables, each with its own label. A DuckDB property graph requires every label to be unique, so no single label 'STATIONED_AT' covers them.
```

`STATIONED_AT` is three tables, one per concrete asset type, and a query names the one it means. The second finding is smaller and caught me out: a name is not safe bare because it is not reserved. `AT` is a keyword of a kind DuckDB calls `type_function`, and `CREATE TABLE AT` is a syntax error, while all 330 words it calls unreserved parse bare. So the generator quotes the 159 keywords that are not unreserved, and the test compares its list with the engine's own `duckdb_keywords()`, so a release that reserves another word fails there first.

I owe a correction here. The first version of this target skipped the `UNIQUE` on every edge that reached an abstract endpoint, to be safe, and so a truck could be stationed at two depots. I found it by running this very section: the log above used to say `ok` against that insert. Each source type has exactly one `STATIONED_AT` table, so the `UNIQUE` inside it is the whole bound. The leak is real only when the *other* end also has several concrete types, because then a node has rows in several tables and no single table sees them all. The generator now writes the constraint in every table and reports the leak only where it exists. The fix is in 0.18.1.

---

## 9. Plugins, and a page you can try first

Two smaller things. The first is the playground: a page on this site where you can edit a model and watch it validate and generate for every target, in the browser, with nothing installed. It is the same parser, validator and generators, bundled from the same code. The bundle is committed, a test rebuilds it and compares, and another runs it in an empty context and checks that it generates exactly what the command line generates for every published example and every target. It has no diagram and no database commands. Both of those stay with the extension and the command line.

[Open the playground.](../docs/playground.html)

The second is `--plugin`. Targets and sources sit behind a registry that the built-in ones use, and that registry is now open: `lpg --plugin ./my-target.js` loads a module that registers more. The contract is the capability set, the same typed declaration every built-in target publishes, and it is enforced at the door:

```js
module.exports = function (api) {
  api.registerTarget('mermaid', {
    capabilities: { target: 'mermaid', multiLabel: true, inheritance: 'subclass' },
    emit: () => ({ target: 'mermaid', extension: 'mmd', content: '', diagnostics: [] }),
  })
}
```

```
$ lpg targets --plugin bad.cjs
plugin bad.cjs could not be loaded: Target 'mermaid' declares an incomplete capability set; missing: requiredConstraint, uniqueConstraint, compositeKey, edgeProps, nestedEdges, valueConstraints, namedConstraints, rawPassthrough, listProps, compositeTypes, enums, openTypes, cardinality. The capability set is how a target says what it cannot express.
```

A target that does not say what it cannot express would break the rule the whole tool is built on, so it is refused. A plugin cannot replace a built-in, its diagnostics reach you in the same voice as a built-in's, and `lpg targets` marks it `(plugin)`. A plugin is code that runs with your privileges, so it is loaded only when you name it on the command line, never discovered, and there is no sandbox.

---

## What is not here

Honesty about limits is part of the design, so here is the list.

- **Data migrations.** Schema migrations are done. Migrations that move data, such as splitting a property in two, need the author to say what maps to what, and that is a change to what the model file holds. It is specified, with its gate written down, and not built.
- **A concise DSL.** The YAML stays the source of truth until enough people write models too large for it to be comfortable.
- **Audit and drift against the server engines, run live.** They are written and unit-tested against hand-made catalogs, and the LadybugDB paths in this article ran for real. The suites that run them against live Memgraph, Neo4j and FalkorDB containers exist, but I have not run them yet.
- **The diagram.** Query lint findings and drift findings are not drawn on the canvas yet.

---

## Try it

```
npx lpg-modeler-cli targets
npx lpg-modeler-cli check fleet.lpg.yaml
npx lpg-modeler-cli audit fleet.lpg.yaml --target ladybug
```

Download [`fleet.lpg.yaml`](../docs/examples/fleet.lpg.yaml), run the three commands above, then change something the way the article did. Rename `axles`, apply the old schema, and run `lpg drift`. Add a query that uses the old name and run `lpg lint-queries`. Plant a row the engine accepts and run `lpg audit`. The model is the same file in every step, and each of those commands asks it something it already knows.

Installing the extension, and everything else about getting started, is on the [getting started](../docs/getting-started.html) page.
