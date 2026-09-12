# Frames and slots, forty years later — and this time they compile

### Minsky's frames were the best authoring model knowledge representation ever had. LPG Modeler gives them eight compilation targets. Here's one, built for a problem that needs it: trust between autonomous agents in e-commerce.

---

In 1974 Marvin Minsky described a **frame**: a data structure for a stereotyped situation, with named **slots** for the things that vary, and **facets** on each slot saying what may legally fill it. A frame for a hotel room has slots for `rate` and `checkOut`; the `rate` slot has a facet saying it's a number, another saying it's required, another saying it can't be negative.

That idea ran the field for two decades. KRL, FRL, KEE, CLIPS COOL, OKBC, Protégé-Frames. Ontologists loved it because **it's how people actually describe a domain**: you name a kind of thing, you list what it carries, you say what's allowed in each position, and you say what it's a kind of.

Then frames lost. Description logics won, OWL got standardized, Protégé-Frames became Protégé-OWL, and the profession traded an authoring model everyone understood for a reasoning model most people got wrong. (Fifteen years later, `rdfs:domain` is still the single most misunderstood construct in applied semantics — it does not constrain anything; it tells a reasoner to *reclassify* anything it finds.)

Frames didn't lose because they were wrong. They lost because **a frame system compiled to nothing**. You described your domain beautifully, and then the schema you actually shipped — the DDL, the constraints, the validation — got written a second time, by hand, by someone else, in a different vocabulary.

**LPG Modeler is a frame system that compiles.**

```
frame              →  node type
slot               →  property
facet              →  type, required, enum, min/max, pattern, length
is-a               →  extends
slot bundle        →  mixin
relational slot    →  edge — first-class, typed, and it carries data
```

You author frames and slots as reviewable YAML, edit them on a canvas beside the file, and generate **eight** artifacts: LadybugDB DDL, Neo4j constraints, FalkorDB schema, SHACL shapes, an OWL ontology, GQL graph types (ISO/IEC 39075), PG-Schema, and LinkML.

Five of those sit on the property-graph side of the fence — LadybugDB, Neo4j, FalkorDB, GQL, PG-Schema. Three sit on the RDF and linked-data side — SHACL, OWL, LinkML. **They come from the same file.**

![One model, four artifacts — the compilation pipeline from YAML through parse, resolve, validate, emit](../docs/assets/diagrams/pipeline.png)

---

## The slot facets, mapped

This is the part that makes the frames framing more than a nice analogy. The facet vocabulary lines up almost item for item:

**`:VALUE-TYPE`** becomes `type:` — 21 scalars, plus `STRUCT`, `MAP`, `UNION` and `ARRAY`. LadybugDB stores all of it natively, composites included; `uuid` and `json` are reported downgrades on GQL and the RDF targets.

**`:CARDINALITY`**, in its single-or-multiple sense, becomes `list: true` — also spelled `LIST<STRING>` or `STRING[]`. Every target carries it.

**`:CARDINALITY`**, in its min-and-max-on-a-relation sense, becomes an endpoint bound: `cardinality: { to: "3..*" }`. SHACL expresses it exactly; LadybugDB enforces the upper bound on write.

**`:ALLOWED-VALUES`** becomes `enum:` — `sh:in` in SHACL, `owl:oneOf` in OWL, `permissible_values` in LinkML.

**`:NUMERIC-MIN` and `:NUMERIC-MAX`** become `min:` and `max:`, carried by SHACL and LinkML.

**`:REQUIRED`** becomes `required: true` — genuinely enforced by FalkorDB's `MANDATORY`, by Neo4j on Enterprise, and by SHACL.

**Slot inheritance** becomes `extends:`. PG-Schema and GQL keep the hierarchy; LadybugDB flattens it to one table per concrete frame.

Two things on that list are additions rather than translations. **`pattern:`, `minLength:` and `maxLength:`** constrain the shape of a string, which no classical frame system offered, and SHACL is the only place they land. And **`key:`** — single or composite — declares identity, which frames left to the host system entirely. Here it pays off three times over: a LadybugDB `PRIMARY KEY`, a Neo4j `NODE KEY`, and `owl:hasKey` in the ontology export.

The gaps, stated up front rather than discovered later. There is **no `:DEFAULT` facet** and **no `:DOCUMENTATION` facet** — documentation lives in YAML comments, which survive in the file and not into the artifacts. And there are **no daemons**: no `if-added`, no `if-needed`, no procedural attachment. That's deliberate. A schema is a contract, not a runtime, and a frame system that could run code was a frame system nobody could compile.

---

## A domain that needs the whole vocabulary

Let's build something hard enough to be worth the tooling: **trust between autonomous agents in e-commerce.**

A shopping agent negotiates with a merchant agent. A carrier agent commits to a delivery window. A payment agent holds funds. Nobody owns anybody. Every one of them can lie, be wrong, or go offline mid-transaction.

The naive model — the one that gets built — puts a `trustScore FLOAT` column on the agent table and moves on. That model is wrong in a specific, expensive way, and the vocabulary that explains why is **Mark Burgess's Promise Theory**:

> An agent can only make promises about **its own** behaviour. Nobody promises on anyone else's behalf. You cannot impose a promise on an autonomous agent — you can only request one, and assess whether it was kept.

Four consequences, each of which is a modelling decision:

1. **A promise has exactly one issuer**, and it is the agent that will execute it. A marketplace cannot promise delivery. It can only promise to *convey* a merchant's promise.
2. **Cooperation requires two promises**, not one. A `+` promise to give, and a `−` promise to accept. An offer nobody accepted is not an agreement.
3. **Trust is first-person and directional.** It is *this* agent's belief about *that* agent, in *this* scope. There is no global trust score, and modelling one is the bug.
4. **You assess; you don't enforce.** And self-assessment disagreeing with a witness is the most useful signal in the entire system.

The complete model is [`agent-trust.lpg.yaml`](agent-trust.lpg.yaml) — 20 frames, 21 relations, 3 mixins and 7 enums. It validates clean, and every excerpt below is taken verbatim from real generated output.

---

## Frames: what a thing *is*

The agent hierarchy is a frame taxonomy, and the abstract frames earn their place by carrying identity and relations down.

```yaml
nodes:
  Agent:
    id: n_agent
    abstract: true
    key: [agentId]
    props:
      agentId:     { id: p_aid, type: STRING, required: true }
      did:         { id: p_did, type: STRING, pattern: "^did:[a-z0-9]+:.+$" }
      displayName: { id: p_aname, type: STRING }

  PrincipalAgent:
    id: n_principal
    abstract: true
    extends: Agent
    props:
      principalDid: { id: p_pdid, type: STRING, required: true }
      jurisdiction: { id: p_juris, type: STRING, pattern: "^[A-Z]{2}$" }

  ServiceAgent:
    id: n_service
    abstract: true
    extends: Agent
    props:
      endpoint:          { id: p_ep, type: STRING, required: true }
      declaredUptimePct: { id: p_up, type: float, min: 0, max: 100 }
```

`PrincipalAgent` acts for a legal person; `ServiceAgent` is infrastructure. The distinction is not decorative — **only a principal agent can be sued**, and that is exactly the kind of fact a taxonomy is for.

`ShopperAgent` and `MerchantAgent` descend from the first; `LogisticsAgent`, `PaymentAgent` and `MarketplaceAgent` from the second. `agentId` is declared once, on the root, and every one of the five inherits it as a key.

---

## Mixins: what a thing *carries*

Here is where frame systems went wrong, and where the distinction is worth enforcing.

Classical frame systems had multiple inheritance, so "these twenty frames all have a `createdAt`" got expressed by inventing a `Timestamped` superclass and putting twenty frames under it. Do that a few times and your taxonomy is no longer shaped by *what things are*. It's shaped by *which slots happen to travel together*.

A **mixin** is a named bag of slots with no supertype, no identity, and no place in any ancestor chain:

```yaml
mixins:
  # Bitemporal: when the world did it, and when we heard about it. Every
  # assessment of a distributed system needs both, and neither makes a subtype.
  Temporal:
    id: m_time
    props:
      observedAt: { id: p_obs, type: ZONED_DATETIME, required: true }
      recordedAt: { id: p_rec, type: ZONED_DATETIME }

  # Where a claim came from and how sure its author was.
  Provenanced:
    id: m_prov
    props:
      assertedBy: { id: p_asrt, type: STRING, required: true }
      sourceUri:  { id: p_src, type: STRING }
      confidence: { id: p_conf, type: float, min: 0, max: 1 }

  # Promise Theory scope: the set of agents in whose view the promise exists.
  # A promise nobody can see is not a promise.
  Scoped:
    id: m_scope
    props:
      scopeAgents: { id: p_scope, type: LIST<STRING> }
      public:      { id: p_pub, type: boolean }
```

An `Assessment` applies `Temporal` and `Provenanced`. A `Promise` applies `Temporal` and `Scoped`. Neither becomes a subtype of anything, because neither *is* a kind of timestamp.

Mixins cost the generators nothing — they're flattened into every frame that applies them before any target sees the model — so a target with rich subtyping and a target with none get identical columns. In the canvas, a slot from a parent shows `↑` and a slot from a mixin shows `◇`, because **they are not the same claim about a type**.

![The inspector, showing an ancestor chain, mixin checkboxes, and inherited edges](../docs/assets/screenshots/inspector.png)

---

## The autonomy axiom, as a cardinality bound

`Promise` is the abstract frame at the centre of the model:

```yaml
  Promise:
    id: n_promise
    abstract: true
    key: [promiseId]
    mixins: [Temporal, Scoped]
    props:
      promiseId: { id: p_prid, type: STRING, required: true }
      body:      { id: p_body, type: STRING, required: true, maxLength: 2000 }
      kind:      { id: p_pk, type: STRING, enum: PromiseKind }
      state:     { id: p_ps, type: STRING, enum: PromiseState }
      issuedAt:  { id: p_iss, type: ZONED_DATETIME, required: true }
      expiresAt: { id: p_exp, type: ZONED_DATETIME }
```

`PromiseKind` is `[give, accept]` — Burgess's `+` and `−`. `PromiseState` is `[offered, accepted, rejected, in_force, kept, broken, withdrawn, expired]`, and **`rejected` is in that list on purpose**. A rejection is data. When a chain of commitments collapses, the refusal that saved you from a worse outcome needs to be on the record, not absent from it.

Five concrete promises descend from it: `DeliveryPromise`, `PricePromise`, `SettlementPromise`, `DataUsePromise`, and `AcceptancePromise` — the `−` promise, without which there's an offer and no cooperation.

And then the axiom itself:

```yaml
edges:
  # The autonomy axiom, written as a bound. Exactly one agent issues a promise,
  # and it is the agent that will execute it. No "on behalf of" is expressible.
  ISSUES:
    id: e_issues
    from: Agent
    to: Promise
    cardinality: { from: "1" }
```

That `from: "1"` is the whole of Promise Theory's first principle, written as a schema constraint. **It is not a comment. It is enforced.** More on that in a moment.

---

## Facets that bite

The seven-assertion constraint vocabulary is where slot facets stop describing one value and start describing a frame. It's closed on purpose — `lessThan`, `lessThanOrEquals`, `equals`, `disjoint`, `atLeastOne`, `exactlyOne`, `count` — because a closed vocabulary can be translated per target or honestly downgraded, where a raw expression could only ever be passed through to one.

**A price is one thing or the other, never both:**

```yaml
  PricePromise:
    extends: Promise
    props:
      currency:     { type: STRING, required: true, pattern: "^[A-Z]{3}$" }
      fixedAmount:  { type: "DECIMAL(18,4)", min: 0 }
      indexFormula: { type: STRING, maxLength: 500 }
    constraints:
      - name: oneBasisOnly
        assert: { exactlyOne: [fixedAmount, indexFormula] }
        message: a price is either a fixed amount or an index formula, never both
```

**A capture may not exceed its authorisation:**

```yaml
      - name: captureWithinAuthorisation
        assert: { lessThanOrEquals: [capturedAmount, authorizedAmount] }
        message: a capture may not exceed the amount that was authorised
```

**An assessment with no evidence is an opinion:**

```yaml
  Assessment:
    key: [assessmentId]
    mixins: [Temporal, Provenanced]
    props:
      verdict:         { type: STRING, enum: Verdict }      # kept | broken | partial | unobservable
      role:            { type: STRING, enum: AssessorRole } # self | promisee | witness
      dimensionScores: { type: "MAP(STRING, DOUBLE)" }
    constraints:
      - name: evidenceBacked
        assert: { count: { edge: CITES, of: Evidence, min: 1 } }
        message: an assessment with no evidence behind it is an opinion
```

That `role` enum is the Promise Theory payoff. Self-assessment and witness assessment are **the same frame with a different filler in one slot**, which means "find every promise the issuer called kept and a witness called broken" is one query, not an architecture.

---

## There is no global trust score

This is the modelling decision the whole ontology exists to make, and it falls out of a composite key:

```yaml
  # First-person and directional: *this* agent's belief about *that* agent,
  # within *this* scope. The composite key is the point — there is no single
  # global trust score to key on, and modelling one would be the bug.
  TrustBelief:
    key: [holderId, subjectId, scopeTag]
    mixins: [Temporal]
    props:
      holderId:     { type: STRING, required: true }
      subjectId:    { type: STRING, required: true }
      scopeTag:     { type: STRING, required: true }
      valence:      { type: float, min: -1, max: 1 }
      sampleSize:   { type: int, min: 0 }
      halfLifeDays: { type: int, min: 1 }
    constraints:
      - name: noSelfTrust
        assert: { disjoint: [holderId, subjectId] }
        message: an agent's view of itself is self-assessment, not trust
```

Three things this says that a `trustScore` column cannot:

- **Trust is scoped.** You can trust a carrier's delivery windows and distrust its damage claims. Those are different beliefs about the same agent, and the key admits both.
- **Trust decays.** `halfLifeDays` is a slot because a two-year-old assessment is not evidence about today.
- **Trust has a denominator.** `sampleSize` separates "kept forty of forty promises" from "kept one".

`Reputation` is a **separate frame** — third-party hearsay, with a `population` and a `method` — and keeping it separate is not fastidiousness. Collapsing first-person trust into propagated reputation is precisely how a reputation system becomes gameable.

---

## The relationship that isn't a pair

Most multi-agent modelling quietly decomposes everything into pairs. But a shopper, a merchant and a carrier settling a delivery window **is not three bilateral negotiations** — no pair of them can reach it alone. The three-way configuration is the thing.

So `Deliberation` is reified into a frame of its own, and the bound says what no named multiplicity can:

```yaml
  HAS_PARTICIPANT:
    from: Deliberation
    to: Agent
    cardinality: { to: "3..*" }
```

`many-to-one`, `one-to-many` and their siblings cannot express "three or more". Endpoint bounds can — and this is the bound that stops a genuinely collective decision from being logged as a pair of chats.

---

## Edges carry data, and reify only when they must

`LOCKS_WITH` is the bilateral lock: a `give` promise and the `accept` promise that answers it.

```yaml
  LOCKS_WITH:
    from: Promise
    to: Promise
    cardinality: { to: "0..1" }
    props:
      lockedAt: { type: ZONED_DATETIME, required: true }
      channel:  { type: STRING }
```

Declared once on the abstract parent, so it holds between any two promise kinds. And it **carries properties**, which in a classical frame system meant inventing a `Lock` frame by hand, and in RDF means reification.

LPG Modeler reifies **gradually**: an edge with no properties stays a plain object property; an edge with properties becomes an n-ary class plus a shortcut. From the generated OWL, verbatim:

```turtle
# (:Promise)-[:LOCKS_WITH]->(:Promise) carries properties, so it is
# reified into a class. 'locksWith' is the shortcut for querying.
trust:LocksWith a owl:Class ; rdfs:label "LOCKS_WITH" .
trust:locksWithSubject a owl:ObjectProperty .
trust:locksWithObject a owl:ObjectProperty .
trust:locksWith a owl:ObjectProperty .
trust:lockedAt a owl:DatatypeProperty ; rdfs:range xsd:dateTime .

# (:Assessment)-[:MADE_BY]->(:Agent) carries no properties,
# so it stays a plain object property. No domain or range is asserted.
trust:madeBy a owl:ObjectProperty ; rdfs:label "MADE_BY" .
```

Note what the OWL does *not* say: no `rdfs:domain`, no `rdfs:range`, no cardinality restrictions. The export is restricted to the safe assertional subset — classes, `subClassOf`, `hasKey`, disjointness, inverses — because mapping a closed-world schema constraint naively into an open-world ontology doesn't lose information, **it inverts the meaning**. The constraints go to SHACL, where closed-world is what they mean.

---

## The escape hatch

A closed assertion vocabulary that can't be escaped is a reason not to adopt the tool. So one frame in this model carries raw SHACL:

```yaml
  DataUsePromise:
    extends: Promise
    props:
      purposes:       { type: LIST<STRING> }
      retentionDays:  { type: int, min: 0, max: 3650 }
      onwardTransfer: { type: boolean }
    shacl: |
      sh:property [
        sh:path trust:retentionDays ;
        sh:severity sh:Warning ;
        sh:description "retention beyond a year is reviewed by the data protection officer" ;
        sh:maxInclusive 365 ;
      ] ;
```

`sh:Warning` — flag for human review, don't reject — has no place in a seven-assertion vocabulary, and shouldn't. It's deliberately unportable, and that's **stated rather than hidden**: every other target reports that it ignored it.

---

## Now compile it

```bash
npx lpg-modeler-cli check article/agent-trust.lpg.yaml
# 0 error(s), 0 warning(s)

npx lpg-modeler-cli emit article/agent-trust.lpg.yaml \
  --target ladybug --target neo4j --target falkordb --target shacl \
  --target owl --target gql --target pgschema --target linkml \
  --out ./schema
```

Eight artifacts. Here's what each one did with the same frames.

### LadybugDB: the axiom, enforced on write

The hierarchy flattens to one table per concrete frame, so `ISSUES` — declared between two abstract frames — expands:

```cypher
CREATE REL TABLE IF NOT EXISTS ISSUES (
  // 'Agent' and/or 'Promise' are abstract; expanded to 25 endpoint pairs.
  FROM LogisticsAgent TO AcceptancePromise,
  FROM LogisticsAgent TO DataUsePromise,
  ...
  FROM ShopperAgent TO SettlementPromise,
  // 1-to-*: enforced on write.
  ONE_MANY
  // UNENFORCED: a minimum of 1 on 'from'.
);
```

Five agent frames × five promise frames = 25 pairs, written for you. And `ONE_MANY` is **enforced by the engine on write** — a second agent claiming to have issued the same promise is rejected by the database. The autonomy axiom is not documentation here.

The composite key gets handled and *reported*:

```cypher
CREATE NODE TABLE IF NOT EXISTS TrustBelief (
  holderId STRING,
  ...
  // SYNTHESIZED: composite key (holderId, subjectId, scopeTag) is not expressible;
  // 'trustbelief_key' must be written as the concatenation of those properties.
  trustbelief_key STRING,
  PRIMARY KEY(trustbelief_key)
);
```

And the composite slot type survives intact — `destination STRUCT(lat DOUBLE, lon DOUBLE)` is a real column here, on the one target that has them.

### SHACL: the constraints that no database can hold

```turtle
trust:TrustBelief_noSelfTrustShape a sh:NodeShape ;
  sh:targetClass trust:TrustBelief ;
  sh:property [
    sh:path trust:holderId ;
    sh:disjoint trust:subjectId ;
    sh:message "an agent's view of itself is self-assessment, not trust" ;
  ] .

trust:Assessment_evidenceBackedShape a sh:NodeShape ;
  sh:targetClass trust:Assessment ;
  sh:property [
    sh:path trust:cites ;
    sh:qualifiedValueShape [ sh:class trust:Evidence ] ;
    sh:qualifiedMinCount 1 ;
    sh:message "an assessment with no evidence behind it is an opinion" ;
  ] .
```

Each named constraint gets **its own shape**, so each keeps its own `sh:message` — folded together, one message would appear to explain every rule on the frame.

Cardinality comes out in **both directions**. The `3..*` bound:

```turtle
  sh:property [
    sh:path trust:hasParticipant ;
    # *-to-3..*: each Deliberation has 3..* Agent.
    sh:minCount 3 ;
  ] .
```

And the autonomy axiom again, this time as an inverse path on every promise frame:

```turtle
  sh:property [
    sh:path [ sh:inversePath trust:issues ] ;
    # 1-to-*: each AcceptancePromise has 1 incoming ISSUES.
    sh:minCount 1 ;
    sh:maxCount 1 ;
  ] .
```

One `cardinality: { from: "1" }` in the model. Enforced by LadybugDB on write, enforced by SHACL on validation, in opposite directions, from one line.

### PG-Schema: nothing flattened

The most faithful target — abstract frames stay abstract, mixins stay mixins:

```
CREATE GRAPH TYPE trustType STRICT {
  ABSTRACT (temporalType {observedAt ZONED DATETIME, OPTIONAL recordedAt ZONED DATETIME}),
  ABSTRACT (agentType: Agent {agentId STRING, OPTIONAL did STRING, ...}),
  ABSTRACT (promiseType: temporalType & scopedType & Promise {promiseId STRING, ...}),
  (deliverypromiseType: promiseType & DeliveryPromise {OPTIONAL earliestDeliveryAt ZONED DATETIME, ...}),
  ABSTRACT (principalagentType: agentType & PrincipalAgent {principalDid STRING, ...}),
  (shopperagentType: principalagentType & temporalType & ShopperAgent {...}),
  ...
```

A mixin becomes an abstract type declared without a label — which is precisely what a mixin *is*.

### The rest, briefly

**FalkorDB** is the only database target that enforces `required` — it emits `MANDATORY` for every one of them. It also takes the composite key as a `UNIQUE` over all three slots, with no synthesized column needed.

**Neo4j** turns the hierarchy into labels rather than tables. On Community edition you get uniqueness only, and every existence constraint is reported as an Enterprise-gated downgrade rather than silently dropped.

**GQL** carries the hierarchy by label implication, so `ISSUES` stays **one** element type instead of expanding to 25 endpoint pairs.

**LinkML** lines `is_a` and `mixins` up almost directly with the metamodel, which opens the whole LinkML generator ecosystem to a model authored here.

---

## Nothing disappears quietly

That emit printed **625 diagnostics and zero errors** — 364 `info`, 261 `warning`. Not failures: **downgrades**, each naming a frame, a slot, a target, and where the constraint went instead:

```
info  [pgschema] downgrade-named-constraint: Constraint 'TrustBelief.noSelfTrust'
      asserts 'disjoint', which pgschema cannot express. The SHACL artifact carries it.

warning [linkml] downgrade-cardinality: Edge type 'HAS_PARTICIPANT' declares
      *-to-3..* cardinality. A LinkML slot expresses only 'multivalued' and
      'required', so the exact bound is unenforced.

warning [linkml] downgrade-composite: Property 'Assessment.dimensionScores' has
      composite type MAP(string, float), which linkml has no equivalent for.
      Declared as string; the structure inside it is not carried.
```

Every one is an editor diagnostic **and** a comment at the lossy line of the generated artifact, so the operator reading the DDL learns what the author reading the model already knows. The severities are calibrated: a constraint that moved to SHACL is `info`; a composite that silently flattened is `warning`, because that's the surprising kind of loss.

This is the part frame systems never had and OWL exports usually get wrong. **A schema tool's most important output is an honest account of what it couldn't carry.**

---

## What it deliberately won't do

One more honest line, since this is a model about promises.

Edges that are themselves endpoints of other edges — the metagraph case — are **outside the core on purpose**. Neo4j can't represent them natively, so admitting them would force every emitter to grow a silent reification path, and silent reification is how a schema stops meaning what it says. If your promise graph needs promises *about* promises, you reify deliberately — the way `Deliberation` is reified here — and you can see that you did.

Likewise, named constraints don't inherit. A constraint written against a subtype's slot would be meaningless on the parent, and a subtype that silently widened its parent's contract would leave the reader of the parent no way to see it. It means `captureWithinAuthorisation` sits on `SettlementPromise` rather than on `Promise`, and that's the right place for it.

---

## Try it

```bash
code --install-extension pavlyshyn.lpg-modeler
```

The model in this article is [`article/agent-trust.lpg.yaml`](agent-trust.lpg.yaml) — save it as `agent-trust.lpg.yaml` in a workspace, open the canvas beside it, and generate whichever of the eight targets your stack actually runs.

Five more worked models ship with the project: a starter, an inheritance-and-mixins tour, enums and open types, endpoint bounds, and the full constraint vocabulary. Each is checked in CI — a test resolves every one and generates all eight targets, so the file you download is the file the test checked.

- **Docs** — https://volland.github.io/lpg-modeler/
- **Marketplace** — https://marketplace.visualstudio.com/items?itemName=pavlyshyn.lpg-modeler
- **Source** — https://github.com/Volland/lpg-modeler

---

Minsky gave us the right way to describe a domain. Burgess gave us the right way to describe agents who don't take orders. Neither of them had a compiler.

Now you do.
