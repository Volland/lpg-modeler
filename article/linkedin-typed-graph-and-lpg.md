# LinkedIn: notes and schema post

Short-form companion to [`typed-graph-and-lpg.md`](typed-graph-and-lpg.md), sized for the LinkedIn
feed. It introduces both tools — Typed Graph and LPG Modeler — through the one problem they now
solve together. The body between the rules is the post: copy it verbatim; LinkedIn renders no
markdown, so it carries no `**`, no headings, and no links inside the text.

- **Length:** ~2,550 characters against a 3,000 limit. The feed truncates at roughly 210 with a
  *…see more*, so the first two lines carry the whole click.
- **Image:** none of the site's diagrams shows this release. Attach a screenshot of
  `tg validate` reporting the four `T-105` findings beside `Types/Truck.md` — the one picture that
  shows a database rule catching a mistake in a note.
- **Links:** kept out of the body and put in the first comment, posted immediately. A post with an
  outbound link in it is distributed worse than the same post without one.

---

Your team describes its domain twice. Once in the notes people write, once in the schema the database enforces.

Both are about the same trucks. Nothing keeps them the same.

The notes grow a property the schema never heard of. The schema renames one the notes still use. Each side is right about itself and wrong about the other, and nobody notices until a question crosses the line.

So I connected the two tools I use for each side.

Typed Graph types Markdown notes: a Types/ folder of schema notes says what a Truck note carries and which links it may have, and the Obsidian plugin and the tg CLI check every note against it.

LPG Modeler compiles one model into the constraints LadybugDB, Neo4j, Memgraph and FalkorDB enforce.

Release 0.19 adds two commands:

→ lpg export --to tgs writes the model into Types/ — a folder of notes, one per type, or one note with the whole ontology. It asks which.
→ lpg import Types/ reads a schema folder, any number of ontology notes, back into a model.

What I tested, on a fleet model of seven types:

1. The exported notes pass tg validate with no findings.
2. A truck note with four planted mistakes — no VIN, fuel "petrol", two depots, a depot where a trailer belongs — gets all four reported. Every rule came from the model. Nobody wrote it twice.
3. A property added to the Truck type in the notes comes back as exactly one line of lpg diff: "added as date".
4. Typed Graph's own decision ontology, two notes never meant for this tool, became 22 LadybugDB statements that apply cleanly.

The hard part was not the syntax. TGS has no inheritance, no keys, no uniqueness. A naive export drops them; an inventive one writes keys no TGS reader understands.

The answer was in the TGS spec: a schema note's other keys belong to the note, and readers must ignore them. So what TGS cannot say rides in an lpg key — hierarchy, keys, exact types, element ids — and the notes stay valid TGS while the model comes back whole. Each of those is still reported as a downgrade, because Obsidian will not stop two trucks sharing a VIN.

The cost is stated, not hidden: renaming a property in the notes only reads as a drop plus an add, because the id follows the name in the lpg key, not the TGS one.

The notes are where people think. The schema is where data is kept honest. Crossing between them should be one command that says what did not survive the crossing.

LPG Modeler 0.19.0 and tg 0.22.0, both MIT. Long read in the first comment.

#KnowledgeGraphs #Obsidian #GraphDatabases #Ontology #DataEngineering

---

## First comment

Posted immediately after the post, so the links are live before the post is distributed.

```
Full walkthrough, with every output pasted from the run: https://www.lpg-modeler.com/blog/typed-graph-and-lpg.html

LPG Modeler (MIT): https://github.com/Volland/lpg-modeler
Typed Graph (MIT): https://github.com/Volland/typedgraph
Marketplace: https://marketplace.visualstudio.com/items?itemName=pavlyshyn.lpg-modeler

npx lpg-modeler-cli export fleet.lpg.yaml --to tgs --out Types
npx lpg-modeler-cli import Types --out fleet.lpg.yaml
```

## Hashtags

Five in the post, which is where LinkedIn's reach stops improving. `#Obsidian` sits second because
the hook is a notes problem before it is a database problem — it is what brings a reader who keeps
a vault and has never written a schema.

`#KnowledgeGraphs` `#Obsidian` `#GraphDatabases` `#Ontology` `#DataEngineering`

Swap in from this pool to match an audience: `#PKM`, `#DataModeling`, `#LadybugDB`, `#Neo4j`,
`#Cypher`, `#SemanticWeb`, `#OpenSource`, `#VSCode`.

## Accuracy

Every number here is pasted from the run in `typed-graph-and-lpg.md`: seven types, no findings on
the exported schema, four planted mistakes and four findings, one diff line, 22 statements. The
version-pinned claims — LPG Modeler 0.19.0, tg 0.22.0 — go stale the same way. Re-run the walkthrough
before reposting.
