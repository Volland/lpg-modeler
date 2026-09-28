# LinkedIn: the semantic layer

Short-form companion to [`semantic-layer.md`](semantic-layer.md), sized for the LinkedIn feed. The
body between the rules is the post: copy it verbatim; LinkedIn renders no markdown, so it carries
no `**`, no headings, and no links inside the text.

- **Length:** kept under the 3,000-character limit. The feed truncates at roughly 210 characters
  with a *…see more*, so the first two lines carry the whole click.
- **Image:** attach `semantic-layer-images/01-three-layers.png`. It states the post's claim on its
  own at feed size. `02-correspondence-computation.png` is the second choice, for a carousel or a
  repost; the model diagram needs a zoom the feed will not give it.
- **Links:** kept out of the body and put in the first comment, posted immediately. A post with an
  outbound link in it is distributed worse than the same post without one.

---

Ask three teams what "Revenue" means and you get three numbers. All correct. All different.

The fix everyone reaches for is "a semantic layer". The trouble is that the phrase now names three unrelated things.

→ A domain model: what one application needs. Closed world, one bounded context.
→ An ontology: what a term means to anyone. Open world, OWL and SHACL, built to survive systems it never met.
→ A semantic layer in the BI sense (dbt, Cube, LookML): what number we report. Joins, grains, filters, metrics.

Build one when you needed another and you get an OWL ontology nobody queries, or a metrics layer that quietly disagrees with it.

The distinction that matters most hides behind the word "mapping".

Customer.email in one system is Person.emailAddress in another. That is correspondence: a relation between two things that already exist. SSSOM and SKOS cover it, and a graph edge is exactly the right shape.

Revenue = SUM(orders.amount), paid orders only, by month. That is computation: a value nothing in the source contains. No edge can carry it. It has to be a node, because LTV = Revenue / CustomerCount needs something to point at.

Get that wrong and your semantic layer can say two fields mean the same thing, but never what Revenue is.

Where a property graph model earns its keep:

LPG Modeler compiles one YAML model into DDL and constraints for Neo4j, FalkorDB, Memgraph and LadybugDB, plus SHACL shapes, an OWL ontology, GQL, PG-Schema and LinkML. The schema, the constraints and the ontology stop drifting, because they are one file projected many ways. What a target cannot enforce is reported, never dropped.

That gives you the first two layers. It will never give you the third, and it should not try.

So the long read ends with a small metrics ontology: Dataset, Field, Mapping, Metric, Filter. It is itself a model you can download. The mapping is an edge carrying its SKOS match type and confidence; the metric is a node that other metrics compose.

And the separation I would defend hardest: the vocabulary lives in a schema file, reviewed by engineers, changing rarely. The metric definitions live in their own file, owned by analysts, changing weekly. Fold them together and every metric tweak becomes a schema review.

A structural model can give you a domain model and an ontology for free. What Revenue means this quarter was never a structural fact. It is a decision someone has to own.

Long read, five diagrams and the model in the first comment.

#SemanticLayer #KnowledgeGraphs #DataEngineering #Ontology #GraphDatabases

---

## First comment

Posted immediately after the post, so the links are live before the post is distributed.

```
The long read, with the diagrams and the metrics ontology as a model: https://www.lpg-modeler.com/blog/semantic-layer.html

Model: https://www.lpg-modeler.com/blog/models/semantic-layer.lpg.yaml
LPG Modeler (MIT): https://github.com/Volland/lpg-modeler
Marketplace: https://marketplace.visualstudio.com/items?itemName=pavlyshyn.lpg-modeler

npx lpg-modeler-cli emit semantic-layer.lpg.yaml --target owl --target shacl --target neo4j --out schema
```

## Hashtags

Five in the post, which is where LinkedIn's reach stops improving. `#SemanticLayer` leads because
the hook is the metrics argument every analytics team has had, and that audience rarely follows
`#KnowledgeGraphs`; the next two bring the graph and data-engineering readers the tool is for.

`#SemanticLayer` `#KnowledgeGraphs` `#DataEngineering` `#Ontology` `#GraphDatabases`

Swap in from this pool to match an audience: `#AnalyticsEngineering`, `#dbt`, `#DataModeling`,
`#SemanticWeb`, `#SHACL`, `#OWL`, `#MetricsLayer`, `#DataArchitecture`, `#BusinessIntelligence`,
`#Neo4j`, `#OpenSource`.

Worth an @-mention where the account exists and the claim is accurate: dbt Labs and Cube are named
as examples of the BI sense of the term, not criticised, so a mention is fair. Leave Apache Ossie
unmentioned until its name and the details the long read gives for it have been verified.

## Accuracy

Every claim here is one `semantic-layer.md` makes, so a correction lands there first. The target
list is the nine emitters as of LPG Modeler 0.14.0; re-check it against `lpg targets` before
reposting.
