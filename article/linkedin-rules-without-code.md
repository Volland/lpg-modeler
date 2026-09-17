# LinkedIn: two-tool post

Short-form companion to [`rules-without-code.md`](rules-without-code.md), sized for the LinkedIn
feed. It introduces both tools — LPG Modeler and shacl2cypher — in one post. The body between the
rules is the post: copy it verbatim; LinkedIn renders no markdown, so it carries no `**`, no
headings, and no links inside the text.

- **Length:** ~2,980 characters against a 3,000 limit. The feed truncates at roughly 210 with a
  *…see more*, so the first two lines carry the whole click.
- **Image:** attach `rules-without-code-images/01-two-layers.png`. It is the one diagram that reads
  at feed size and it states the two-tool idea on its own; the model and coverage diagrams need a
  zoom the feed will not give them.
- **Links:** kept out of the body and put in the first comment, posted immediately. A post with an
  outbound link in it is distributed worse than the same post without one.

---

An AI agent placed an order, approved it itself, and stored the price as the string "4500".

FalkorDB accepted all of it. So would your graph — schema-optional is the right default for exploring a domain, and the wrong one for software that spends a customer's money.

The usual fix is validation code: a service layer that checks every write, a nightly job hunting orphans, a test suite that encodes the business rules for the third time. That code drifts from the data model the day after it is written, and nobody can read it as a statement of what the business requires.

So I took the other route. Two tools, one source file, no validation code.

LPG Modeler — a VS Code extension and a CLI. You author one YAML model of the domain, edit it on a canvas beside the file, and compile it. Here: a FalkorDB constraint script and W3C SHACL shapes from the same 244 lines.

shacl2cypher — a Rust CLI. It compiles those SHACL shapes into named Cypher queries, runs them through read-only GRAPH.RO_QUERY, and reports every violation with the rule that failed and the node that failed it.

Two layers, because a database constraint and a business rule are not the same thing:

→ At the door. FalkorDB enforces what its engine knows — MANDATORY and UNIQUE. A bad write is refused, so bad data never lands. That is the entire scope.
→ In the graph. Everything else — datatypes, ranges, enums, patterns, cardinality, closed types, and rules like "an agent-placed order needs a customer's approval" — is checked after the fact, read-only.

Nothing is dropped quietly. When LPG Modeler emits the FalkorDB script it reports every rule FalkorDB cannot hold and points at the SHACL artifact that carries it: 44 diagnostics on this model, plus a comment at the exact line of the script.

The run, end to end, on FalkorDB 4.20.4:

Written by hand — 244 lines of YAML.
Generated — 10 indexes and 45 constraints for the database, and 196 validation rules as 392 Cypher queries. 3,743 lines nobody wrote.

Then I seeded a graph with 14 mistakes an agent could plausibly make. Every one passed the strict schema. shacl2cypher found all 14, as 15 failed rules, in 612 ms. Nothing else was flagged.

Three limits, stated plainly:

1. Validation is detection, not prevention. Only presence and uniqueness are refused at write time.
2. The constraint vocabulary is closed on purpose. "An order's total does not exceed its mandate's cap" compares two nodes and is still outside it.
3. A count over an edge needs a schema snapshot of the live graph. One command, but it is setup.

Read-only means it runs in CI, or on a schedule against production: JUnit or SARIF output, --fail-on violation, and an exit code that separates violations from setup failures.

LPG Modeler 0.11.0 and shacl2cypher 0.3.0. Both MIT. Model, seed and the long read in the first comment.

An agent will write anything your graph accepts. Make the rules the schema.

#KnowledgeGraphs #AIAgents #GraphDatabases #SHACL #DataEngineering

---

## First comment

Posted immediately after the post, so the links are live before the post is distributed.

```
Full walkthrough, with the model, the diagrams and every output block pasted from the run: <substack url>

LPG Modeler (MIT): https://github.com/Volland/lpg-modeler
shacl2cypher (MIT): https://github.com/Volland/shacl2cypher
Docs: https://volland.github.io/lpg-modeler/
Marketplace: https://marketplace.visualstudio.com/items?itemName=pavlyshyn.lpg-modeler

npx lpg-modeler-cli emit agent-commerce.lpg.yaml --target falkordb --target shacl --out schema
shacl2cypher validate schema/agent-commerce.shacl.ttl --falkordb redis://localhost:6379 --graph commerce
```

## Hashtags

Five in the post, which is where LinkedIn's reach stops improving. `#AIAgents` sits second because
the hook is an agent problem, not a modelling problem — it is what brings a reader who has never
heard of SHACL.

`#KnowledgeGraphs` `#AIAgents` `#GraphDatabases` `#SHACL` `#DataEngineering`

Swap in from this pool to match an audience: `#FalkorDB`, `#Cypher`, `#DataModeling`,
`#SemanticWeb`, `#Ontology`, `#DataQuality`, `#DataArchitecture`, `#RustLang`, `#OpenSource`,
`#AgenticCommerce`, `#MCP`.

Worth an @-mention where the account exists and the claim is accurate — a mention notifies them and
puts the post in front of their followers: FalkorDB, and the W3C SHACL community for the standard.
Do not mention an account the post is critical of.

## Accuracy

Every number here is pasted from the run in `rules-without-code.md`: 244 model lines, 44 downgrade
diagnostics, 10 indexes, 45 constraints, 196 rules, 392 queries, 3,743 lines of Cypher, 14 planted
problems, 15 failed rules, 612 ms. The version-pinned claims — FalkorDB 4.20.4, LPG Modeler 0.11.0,
shacl2cypher 0.3.0 — go stale the same way. Re-run the walkthrough before reposting.
