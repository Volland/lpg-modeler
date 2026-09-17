# A rename is not a delete. Migrating a graph schema you have already deployed.

### A property renamed in the model should keep its data in the database. LPG Modeler compares a model with a committed lockfile by element id, so `name` becoming `fullName` is migrated as a rename — and anything that would discard data waits for you to say so.

---

The first release of a graph schema is the easy one. You write the model, generate the constraints, run them against an empty database, and load data. Everything after that is harder, because the database is no longer empty.

A week later the model changes. `Customer.name` should be `fullName`. `Product.legacyCode` was a mistake. Purchases need a `channel`. And the status enum needs a `cancelled` value. Regenerating the schema from scratch gives you the constraints the database *should* have. It does not give you the steps from the schema it *has*, and those steps are where data gets lost.

The usual tool for those steps is a diff. Compare the old schema with the new one and emit the difference. That works until the first rename. A diff sees `name` disappear and `fullName` appear, and has two honest readings: a property was renamed, or one was removed and an unrelated one added. Guessing "rename" because the types match is wrong often enough to matter. Guessing "remove and add" drops every customer's name.

**This article takes a different route.** Every element in the model carries an id. A lockfile records what was deployed. Changes are matched by id, never by resemblance, so a rename is a rename because the id says so. Then each change is classed by how dangerous it is, and the dangerous ones wait for you.

*(Everything below was run against Memgraph 3.13.1 Community with LPG Modeler 0.14.0. Every output block is pasted from that run, with the absolute path trimmed from the front of file names.)*

---

## Why names cannot carry identity

Here is the change from the introduction, as a diff of the model file:

```diff
   Customer:
     props:
       id: { type: string, required: true }
       email: { type: string, required: true, unique: true }
-      name: { type: string }
+      fullName: { type: string }
```

Nothing in those two lines says whether `fullName` is `name` under a new name. Two people can read it two ways, and so can a tool. A structural guess — same owner, same type, one removed and one added in the same change — would be right here and wrong the day someone really does replace one string property with another.

So the model does not rely on names. Each node type, edge type, enum and property carries a short generated id, written once into the file:

```diff
-      name: { id: p_dehbt, type: string }
+      fullName: { id: p_dehbt, type: string }
```

Now the diff is not ambiguous. `p_dehbt` was called `name` and is now called `fullName`. It is the same property, and its values should come with it.

---

## The model

A small shop: customers, products and purchases, with a status enum and two edges.

```yaml
namespace:
  prefix: shop
  iri: https://example.org/shop#

enums:
  PurchaseStatus:
    values: [placed, shipped]

nodes:
  Customer:
    key: [id]
    props:
      id: { type: string, required: true }
      email: { type: string, required: true, unique: true }
      name: { type: string }

  Product:
    key: [sku]
    props:
      sku: { type: string, required: true }
      title: { type: string, required: true }
      legacyCode: { type: string }
      price: { type: float }

  Purchase:
    key: [ref]
    props:
      ref: { type: string, required: true }
      status: { type: string, enum: PurchaseStatus }
      placedAt: { type: datetime, required: true }

edges:
  PLACED:
    from: Customer
    to: Purchase
    cardinality: one-to-many

  CONTAINS:
    from: Purchase
    to: Product
    props:
      quantity: { type: int, required: true }
```

It is written the way a person writes a model: no ids yet. That is the first thing the tool will object to.

---

## Install the tools

The CLI, and the Bolt driver it uses to talk to Memgraph:

```bash
npm install -g lpg-modeler-cli@0.14.0 neo4j-driver@6.2.0
```

The driver is an optional dependency of the CLI. Only reading a running Memgraph and `lpg apply` need it, so nothing else downloads it.

Memgraph, with schema information enabled so it can also be read back later:

```bash
docker run -d --name memgraph -p 7687:7687 memgraph/memgraph:3.13.1 --schema-info-enabled=true
```

Podman works the same way — the run for this article used `podman run` and `podman exec` with identical arguments.

Save the model above as `shop.lpg.yaml`, or download [`renames-shop.lpg.yaml`](renames-shop.lpg.yaml) under that name.

---

## Step 1 — give every element an id

The model is valid:

```
$ lpg check shop.lpg.yaml
0 error(s), 0 warning(s)
```

But it cannot be locked. Every element's id is still derived from its name, so a rename could not be told from a removal. The first two of seventeen errors:

```
$ lpg lock shop.lpg.yaml
shop.lpg.yaml:6:3 error ids-not-written: Enum 'PurchaseStatus' has no element id written in its file, so renaming it could not be told apart from removing it and adding another. Run `lpg ids` on the file that declares it.
shop.lpg.yaml:10:3 error ids-not-written: Node type 'Customer' has no element id written in its file, so renaming it could not be told apart from removing it and adding another. Run `lpg ids` on the file that declares it.
```

This refusal is deliberate, and there is no flag to bypass it. A migration generated from a model without ids would look correct until the first rename, and then drop a column. `lpg ids` writes them:

```
$ lpg ids shop.lpg.yaml
assigned 17 id(s) in shop.lpg.yaml
```

The file now reads:

```yaml
nodes:
  Customer:
    id: n_3dmir
    key: [id]
    props:
      id: { id: p_3yqbr, type: string, required: true }
      email: { id: p_ejauq, type: string, required: true, unique: true }
      name: { id: p_dehbt, type: string }
```

The ids are derived from what the file already said, so running `lpg ids` on your own copy writes the same ones. From here on they belong to the file. Commit them, and never edit one by hand: a changed id reads as a removal and an addition, on purpose.

---

## Step 2 — deploy revision 1

Generate the Memgraph schema and apply it:

```
$ lpg emit shop.lpg.yaml --target memgraph --out schema
schema/shop.memgraph.cypher
shop.lpg.yaml:33:7 warning [memgraph] downgrade-enum-identity: Property 'Purchase.status' is limited to enum 'PurchaseStatus'. Memgraph can require that the value is an enum, but not that it is this one.
shop.lpg.yaml:48:7 warning [memgraph] downgrade-edge-required: Edge property 'CONTAINS.quantity' is required, but Memgraph has no constraint on relationships.
shop.lpg.yaml:37:3 warning [memgraph] downgrade-cardinality: Edge type 'PLACED' declares one-to-many cardinality, which Memgraph has no constraint for.
```

The three warnings are what Memgraph cannot hold, said before anything is deployed. Everything else — keys, required properties, uniqueness, value types, and that `status` holds an enum value — becomes a constraint Memgraph enforces on write.

`lpg apply` runs the script one statement at a time and stops at the first one Memgraph refuses. The last lines:

```
$ lpg apply schema/shop.memgraph.cypher --target memgraph --uri bolt://localhost:7687
...
[25/26] CREATE CONSTRAINT ON (n:Purchase) ASSERT n.placedAt IS TYPED LOCALDATETIME
[26/26] CREATE INDEX ON :Purchase(placedAt)
applied 26 statement(s) to bolt://localhost:7687
```

Load some data with [`renames-shop.seed.cypher`](https://github.com/Volland/lpg-modeler/blob/main/article/renames-shop.seed.cypher): two customers, a product with a legacy code, and a purchase.

```bash
docker exec -i memgraph mgconsole < renames-shop.seed.cypher
```

The enum is a real Memgraph enum. A purchase with a plain-string status is refused:

```
$ echo "CREATE (:Purchase {ref: 'o-2', status: 'placed', placedAt: localDateTime('2026-09-02T09:00:00')});" | docker exec -i memgraph mgconsole
Failed query: CREATE (:Purchase {ref: 'o-2', status: 'placed', placedAt: localDateTime('2026-09-02T09:00:00')})
Client received query exception: IS TYPED ENUM violation on Purchase(status)
```

The seed writes `PurchaseStatus::placed`, which is how a value of a Memgraph enum is spelled.

---

## Step 3 — record what is deployed

```
$ lpg lock shop.lpg.yaml
shop.lpg.lock.json (revision 1)
```

`shop.lpg.lock.json` is a snapshot of the resolved model: every type, property, enum and id, with inheritance and mixins already flattened, in a stable order. Writing it twice gives the same bytes, and rearranging the diagram changes nothing in it. Commit it next to the model. It is the answer to "what does production have?" that the rest of the workflow compares against.

On a model that is already deployed, lock the commit the database was built from, not your working branch — the [migrations guide](../docs/migrations.html) walks through that.

---

## Step 4 — change the model

The four changes from the introduction:

```diff
@@ -5,7 +5,7 @@
 enums:
   PurchaseStatus:
     id: x_dtn5i
-    values: [placed, shipped]
+    values: [placed, shipped, cancelled]
 
 nodes:
   Customer:
@@ -14,7 +14,7 @@
     props:
       id: { id: p_3yqbr, type: string, required: true }
       email: { id: p_ejauq, type: string, required: true, unique: true }
-      name: { id: p_dehbt, type: string }
+      fullName: { id: p_dehbt, type: string }
 
   Product:
     id: n_yjkgl
@@ -22,7 +22,6 @@
     props:
       sku: { id: p_gsvp6, type: string, required: true }
       title: { id: p_f6cj9, type: string, required: true }
-      legacyCode: { id: p_l5rjz, type: string }
       price: { id: p_0bdn9, type: float }
 
   Purchase:
@@ -32,6 +31,7 @@
       ref: { id: p_8hy5c, type: string, required: true }
       status: { id: p_9k0d3, type: string, enum: PurchaseStatus }
       placedAt: { id: p_3r02r, type: datetime, required: true }
+      channel: { type: string }
```

The rename kept the id. The new `channel` has none yet, which is exactly what happens when a person adds a property by hand.

---

## Step 5 — see what changed, and how much it matters

```
$ lpg diff shop.lpg.yaml
shop.lpg.yaml:34:7 error ids-not-written: Property 'Purchase.channel' has no element id written in its file, so renaming it could not be told apart from removing it and adding another. Run `lpg ids` on the file that declares it.
```

The same refusal as in step 1, now for the one new property. Writing its id is one command, and it is worth making a habit before every diff:

```
$ lpg ids shop.lpg.yaml
assigned 1 id(s) in shop.lpg.yaml
```

```
$ lpg diff shop.lpg.yaml
additive    enum PurchaseStatus: values added: cancelled
destructive property Product.legacyCode: removed
breaking    property Customer.fullName: renamed from 'name'
additive    property Purchase.channel: added as string
1 destructive, 1 breaking, 2 additive since revision 1
```

Four changes, each with a class:

- **additive** — nothing that exists becomes invalid. A new optional property, a new enum value.
- **breaking** — existing data may no longer fit, or existing queries may stop matching. A rename is breaking even though it loses nothing: every query that says `c.name` returns null afterwards.
- **destructive** — something stored is removed. Dropping `legacyCode` throws away `NB-OLD-7`.

An ambiguous change is classed as breaking rather than additive. A false alarm costs a reviewer a minute; a false "additive" costs data.

The class is what continuous integration gates on. With `--fail-on breaking` the command exits non-zero on a breaking or destructive change:

```
$ lpg diff shop.lpg.yaml --fail-on breaking
additive    enum PurchaseStatus: values added: cancelled
destructive property Product.legacyCode: removed
breaking    property Customer.fullName: renamed from 'name'
additive    property Purchase.channel: added as string
1 destructive, 1 breaking, 2 additive since revision 1
2 change(s) are breaking or more severe
```

It exited `1`.

---

## Step 6 — the gate

```
$ lpg migrate shop.lpg.yaml
error destructive-change: property Product.legacyCode removed, which discards data. Nothing was written. Pass --allow-destructive to generate it anyway.
```

It exited `1`, and it means "nothing". There is no `migrations/` directory, and the lockfile is still at revision 1. A refusal after writing half the scripts would leave a set that agrees with neither revision, so every target is planned before anything touches the disk.

The gate also asks a second question the model alone cannot answer: can each *database* apply this change without losing data? A primary key change is only breaking in the model. On LadybugDB it means recreating the table, because a primary key cannot change in place, and that is refused the same way.

Removing `legacyCode` is what we meant, so:

```
$ lpg migrate shop.lpg.yaml --allow-destructive
migrations/shop.0002.ladybug.cypher
migrations/shop.0002.neo4j.cypher
migrations/shop.0002.falkordb.sh
migrations/shop.0002.memgraph.cypher
shop.lpg.lock.json (revision 2: 1 destructive, 1 breaking, 2 additive)
```

One script per database target, numbered by the revision it produces, and the lockfile advanced last.

---

## Step 7 — read the Memgraph script

```cypher
// Generated by lpg-modeler. Target: memgraph migration.
// Model: shop <https://example.org/shop#>
// Revision 1 -> 2.
//
// Apply once, to an instance at the previous revision, e.g. with `lpg apply`.
// Data steps use USING PERIODIC COMMIT, which runs only in an implicit (auto-commit)
// transaction. Measured against Memgraph 3.13.1 Community.
//
// Changes since revision 1:
//   additive     enum PurchaseStatus: values added: cancelled
//   destructive  property Product.legacyCode: removed
//   breaking     property Customer.fullName: renamed from 'name'
//   additive     property Purchase.channel: added as string

DROP CONSTRAINT ON (n:Customer) ASSERT n.name IS TYPED STRING;
DROP CONSTRAINT ON (n:Product) ASSERT n.legacyCode IS TYPED STRING;

USING PERIODIC COMMIT 1000 MATCH (n:Customer) WHERE n.name IS NOT NULL SET n.fullName = n.name REMOVE n.name;

ALTER ENUM PurchaseStatus ADD VALUE cancelled;

CREATE CONSTRAINT ON (n:Customer) ASSERT n.fullName IS TYPED STRING;
CREATE CONSTRAINT ON (n:Purchase) ASSERT n.channel IS TYPED STRING;
```

The order is the point. Constraints that only the old revision had go first, so the old type constraint on `name` cannot object while values move. Then the data moves, in batches. Then the enum grows. Then the new constraints arrive, and they see the data they will govern.

The rename is one statement that copies each value and removes the old key. There is no "drop `name`, add `fullName`" anywhere in it.

---

## Step 8 — apply it, and check the data

```
$ lpg apply migrations/shop.0002.memgraph.cypher --target memgraph --uri bolt://localhost:7687
[1/6] DROP CONSTRAINT ON (n:Customer) ASSERT n.name IS TYPED STRING
[2/6] DROP CONSTRAINT ON (n:Product) ASSERT n.legacyCode IS TYPED STRING
[3/6] USING PERIODIC COMMIT 1000 MATCH (n:Customer) WHERE n.name IS NOT NULL SET n.fullName = n.name REMOVE n.name
[4/6] ALTER ENUM PurchaseStatus ADD VALUE cancelled
[5/6] CREATE CONSTRAINT ON (n:Customer) ASSERT n.fullName IS TYPED STRING
[6/6] CREATE CONSTRAINT ON (n:Purchase) ASSERT n.channel IS TYPED STRING
applied 6 statement(s) to bolt://localhost:7687
```

Before connecting, `apply` checked that the script was generated for Memgraph and that no statement in it is marked destructive — a migration that deleted nodes would have needed `--allow-destructive` here too. It runs each statement in its own transaction. Had one failed, it would have stopped there and said how many had already run.

The names came through:

```
$ echo 'MATCH (c:Customer) RETURN c.id, c.fullName, c.name ORDER BY c.id;' | docker exec -i memgraph mgconsole
+----------------+----------------+----------------+
| c.id           | c.fullName     | c.name         |
+----------------+----------------+----------------+
| "c1"           | "Ada Lovelace" | Null           |
| "c2"           | "Alan Turing"  | Null           |
+----------------+----------------+----------------+
```

And the new enum value is accepted:

```bash
echo "CREATE (:Purchase {ref: 'o-2', status: PurchaseStatus::cancelled, placedAt: localDateTime('2026-09-02T09:00:00')});" | docker exec -i memgraph mgconsole
```

That returned nothing, which is mgconsole's way of saying it worked. The lockfile now matches the model:

```
$ lpg lock shop.lpg.yaml --check
shop.lpg.lock.json is up to date
```

One result is worth noticing:

```
$ echo 'MATCH (p:Product) RETURN p.sku, p.legacyCode;' | docker exec -i memgraph mgconsole
+--------------+--------------+
| p.sku        | p.legacyCode |
+--------------+--------------+
| "P-100"      | "NB-OLD-7"   |
+--------------+--------------+
```

The value is still there. Memgraph is schema-optional: removing a property from the model removes its constraint, not the values already stored under it. The change was still classed destructive, because on a database with a fixed schema it does discard them, and a model does not know which database it will be deployed to.

---

## The same change, on the other engines

All four scripts came from the same change set. What differs is how each engine can carry it.

**LadybugDB** has a mandatory schema, so the rename is a column rename and the removal really is a drop:

```
$ grep -v '^//' migrations/shop.0002.ladybug.cypher | grep -v '^$'
ALTER TABLE Customer RENAME name TO fullName;
ALTER TABLE Product DROP legacyCode;
ALTER TABLE Purchase ADD channel STRING;
```

The drop is marked in the script, where an operator reading it will see it:

```
$ grep -B1 'ALTER TABLE Product DROP' migrations/shop.0002.ladybug.cypher
// DESTRUCTIVE: property Product.legacyCode: column dropped, discarding its values
ALTER TABLE Product DROP legacyCode;
```

**Neo4j** had no constraint on any of these properties in this model, so only the data moves:

```cypher
MATCH (n:Customer) WHERE n.name IS NOT NULL CALL { WITH n SET n.fullName = n.name REMOVE n.name } IN TRANSACTIONS;
```

**FalkorDB** runs the same Cypher through `redis-cli`:

```bash
$REDIS_CLI GRAPH.QUERY "$GRAPH_KEY" "MATCH (n:Customer) WHERE n.name IS NOT NULL SET n.fullName = n.name REMOVE n.name"
```

---

## What the engines taught us

None of the ordering above was designed from documentation. Each planner was written against a running engine, and several things the engines do were not what we expected. They are pinned by tests, so an engine release that changes one fails the build first.

- **LadybugDB 0.19.1** has no statement that changes a column's type, so a type change drops and re-adds the column, behind the destructive gate. And dropping a relationship table's *last* endpoint pair is accepted — the next statement against that table crashes the process. The planner never empties a table's pairs; it recreates the table instead.
- **FalkorDB 4.20.4** refuses to drop an index while a unique constraint depends on it, so every constraint drop comes first. Its indexes exist per property: creating one over two properties makes two, and dropping it over two removes one. A migration drops and creates them one property at a time.
- **Memgraph 3.13.1** refuses `DELETE` inside `CALL { … } IN TRANSACTIONS`, which is why its data steps use `USING PERIODIC COMMIT`. It can add a value to an enum but cannot remove one or drop an enum, so a migration that removes a value says so in a comment and leaves it valid. And its constraints carry no name, so the generated schema indexes each key — otherwise nothing could tell `Customer.id` from `Customer.email` when the schema is read back.

Every Ladybug migration is also checked by an oracle: for each pair of model revisions in the test suite, a database built from the old revision and migrated must have the same tables, columns, keys and endpoint pairs as a database built fresh from the new one. The Memgraph planner answers to the same oracle against a running instance.

---

## Put it in CI

Two commands do different jobs, and belong in different places.

On pull requests, let additive changes through and stop a branch that renames or removes something until a person has looked:

```yaml
- run: npx lpg-modeler-cli diff model/shop.lpg.yaml --fail-on breaking
```

On `main`, fail whenever the model has moved past the lockfile. Every model change should arrive together with its migration scripts and the advanced lockfile, and this is what notices when one did not:

```yaml
- run: npx lpg-modeler-cli lock model/shop.lpg.yaml --check
```

Both exit `1` on the change set from this article.

---

## What it does not do

- **It does not convert data.** A property changing from `int` to `string` gets its constraint replaced, and on Memgraph the new constraint is refused while old integer values remain. Converting them is your call, and your statement.
- **It does not run migrations for you**, except on Memgraph with `lpg apply`, and only a script you generated and reviewed. For the other engines the script is the artifact.
- **It does not guess renames.** An element whose id changed is a removal and an addition, on purpose. If you want a rename, keep the id.
- **It does not remove Memgraph enum values**, because Memgraph cannot.

---

## Try it

Download [`renames-shop.lpg.yaml`](renames-shop.lpg.yaml) and [`renames-shop.seed.cypher`](https://github.com/Volland/lpg-modeler/blob/main/article/renames-shop.seed.cypher), start Memgraph, and follow the eight steps. Then try the change that should worry you: edit `p_dehbt` to a new id instead of renaming the property, and watch `lpg diff` call it what it would really be.

The [migrations guide](../docs/migrations.html) covers adopting this on a model that is already in production, and [the targets page](../docs/targets.html#migrations) lists what each database can and cannot change in place.
