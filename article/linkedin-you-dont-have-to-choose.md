# LinkedIn: launch post

Short-form companion to [`you-dont-have-to-choose.md`](you-dont-have-to-choose.md), sized for the
LinkedIn feed. The body between the rules is the post — copy it verbatim; LinkedIn renders no
markdown, so it carries no `**`, no headings, and no links inside the text.

- **Length:** ~2,850 characters against a 3,000 limit, so there is room for a line but not a
  paragraph. The feed truncates at roughly 210 with a *…see more*, which is why the first two
  lines carry the whole click.
- **Image:** attach `you-dont-have-to-choose-images/02-canvas.png`. It is the one image that reads
  at feed size; the pipeline and capability diagrams need a zoom the feed will not give them.
- **Links:** kept out of the body and put in the first comment, posted immediately. A post with an
  outbound link in it is distributed worse than the same post without one.

---

"So — are we doing RDF or a property graph?"

Every graph project asks that in week one — so the architectural commitment gets made on the day you know the least about your own domain.

I think the question is backwards. The format is a compilation target, not a modelling decision.

When you describe a domain, the things you actually want to say are format-agnostic:

→ A truck is a vehicle, and a vehicle is an asset.
→ An asset is stationed at a depot — and that's true of every kind of asset.
→ Half my types carry createdAt and updatedAt, and that says nothing about what they are.
→ A child has exactly two parents.

Not one of those sentences mentions RDF or LPG. "How do I express 'exactly two' in Neo4j?" is a translation problem — and a machine should solve it, not you.

So I built LPG Modeler: a VS Code extension and a CLI. You author one reviewable YAML model, edit it on an ERD-like canvas beside the file, and compile it to seven artifacts:

LadybugDB DDL · Neo4j constraints · SHACL shapes · OWL ontology · GQL graph types (ISO/IEC 39075) · PG-Schema · LinkML

Four of those are on the property-graph side. Three are on the RDF side. They come from the same file. You are not picking a religion — you are picking an output directory.

Three ideas it is built on:

1. Inheritance and mixins are different claims.
createdAt on twenty types does not make twenty subtypes of a Timestamped. So Extends is a dropdown — one parent, or none. Mixins are checkboxes — set membership. That is not a UI preference, it is the metamodel made visible.

2. Relations are inherited too.
Declare STATIONED_AT once, on an abstract Asset with no instances. Every descendant has it. LadybugDB has no abstract types, so that one line expands into a cross-product of concrete FROM/TO pairs. Add a fifth asset subtype next month and you do not touch the edge at all.

3. Nothing disappears quietly.
Every target ships a typed capability set, and the compiler reports each gap as an editor diagnostic and as a comment at the exact lossy line. Measured against LadybugDB 0.19.1: NOT NULL is not accepted by the parser, so a required property that is not the key is unenforceable there. That gets reported rather than generated as a comforting lie — a constraint that quietly vanishes is a data-integrity bug that surfaces in production.

It runs in CI with no editor present, so a pull request can be gated on schema validity.

v0.7.0, MIT. Docs, Marketplace and source in the first comment.

Formats churn. Engines get replaced. GQL was only ratified in 2024. The durable asset is not the DDL and not the diagram — it is the statement of what your domain means.

Stop choosing your graph format on day one. Choose it on the day you actually know.

#KnowledgeGraphs #GraphDatabases #DataModeling #SemanticWeb #DataEngineering

---

## First comment

Posted immediately after the post, so the links are live before the post is distributed.

```
Long read, with the diagrams and the full capability matrix: <substack url>

Docs: https://volland.github.io/lpg-modeler/
Marketplace: https://marketplace.visualstudio.com/items?itemName=pavlyshyn.lpg-modeler
Source (MIT): https://github.com/Volland/lpg-modeler

npx lpg-modeler-cli check model/domain.lpg.yaml
```

## Hashtags

Five in the post, which is where LinkedIn's reach stops improving. The first two are the ones the
right readers follow; the rest widen the pool without diluting it.

`#KnowledgeGraphs` `#GraphDatabases` `#DataModeling` `#SemanticWeb` `#DataEngineering`

Swap in from this pool to match an audience: `#Neo4j`, `#RDF`, `#SHACL`, `#OWL`, `#Ontology`,
`#LinkedData`, `#GQL`, `#VSCode`, `#OpenSource`, `#DataArchitecture`, `#AIAgents`.

Worth an @-mention where the account exists and the claim is accurate — a mention notifies them and
puts the post in front of their followers: Neo4j, LinkML, LDBC. Do not mention an account the post
is critical of.

## Accuracy

Every claim here is a compression of one in the long read, which is in turn drawn from `lat.md/`.
The version-pinned ones — LadybugDB 0.19.1 rejecting `NOT NULL`, the seven targets, v0.7.0 — go
stale the same way. Re-check against `lat.md/emitters.md` before reposting.
