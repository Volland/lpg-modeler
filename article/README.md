# article/

Long-form launch and announcement writing about LPG Modeler, kept in the repository so a
published post and the tool it describes move together.

| File | For |
| --- | --- |
| [`you-dont-have-to-choose.md`](you-dont-have-to-choose.md) | Launch long-read: model naturally, then pick RDF or LPG. Covers inheritance, mixins, inherited relations, the seven targets, and the capability matrix. |
| [`linkedin-you-dont-have-to-choose.md`](linkedin-you-dont-have-to-choose.md) | Feed-sized companion to the launch long-read — the post body to paste, its first comment, hashtags, and which image to attach. |
| [`frames-and-slots.md`](frames-and-slots.md) | Long-read framing the metamodel as a frame system that compiles: Minsky's frames and slots mapped onto node types, properties and facets, worked through a Promise Theory ontology for multi-agent trust in e-commerce. |
| [`agent-trust.lpg.yaml`](agent-trust.lpg.yaml) | The model `frames-and-slots.md` is built around. Not one of the five checked-in examples — it lives here because the article is the only thing that reads it. |
| [`concept-graphs.md`](concept-graphs.md) | Long-read on Sowa's conceptual graphs: the bipartite rule read as a decision procedure rather than a storage format, the type lattice against the data-level poset, and gradual reification — worked through catalog identity and substitution. |
| [`assortment.lpg.yaml`](assortment.lpg.yaml) | The model `concept-graphs.md` is built around, on the same footing as `agent-trust.lpg.yaml`. |
| [`rules-without-code.md`](rules-without-code.md) | Hands-on long-read: one model compiled into FalkorDB's own constraints (rejected at write) and, through SHACL and shacl2cypher, into read-only Cypher rules for the business constraints no database holds — worked through agentic commerce, with install and setup for all four tools. |
| [`agent-commerce.lpg.yaml`](agent-commerce.lpg.yaml) | The model `rules-without-code.md` is built around, on the same footing as `agent-trust.lpg.yaml`. |
| [`agent-commerce.seed.cypher`](agent-commerce.seed.cypher) | A graph for that model with fourteen planted problems, loaded in the article's step 3. Linked by absolute GitHub URL, because the blog generator copies only `.lpg.yaml` files to the site. |
| [`renames-are-not-deletes.md`](renames-are-not-deletes.md) | Hands-on long-read on migrations: element ids instead of structural diffs, the lockfile, change classes and the destructive gate, worked end to end against Memgraph with `lpg lock`, `diff`, `migrate` and `apply`, and what LadybugDB, FalkorDB and Memgraph each taught the planners. |
| [`renames-shop.lpg.yaml`](renames-shop.lpg.yaml) | The model `renames-are-not-deletes.md` is built around, written without ids so the article's first step can add them. |
| [`renames-shop.seed.cypher`](renames-shop.seed.cypher) | The data that article loads before migrating. Linked by absolute GitHub URL, because the blog generator copies only `.lpg.yaml` files to the site. |
| [`semantic-layer.md`](semantic-layer.md) | Essay separating domain model, ontology and metrics layer: correspondence versus computation, what one structural model can generate for the first two, and a small metrics ontology — itself a model — kept apart from the metric definitions. |
| [`semantic-layer.lpg.yaml`](semantic-layer.lpg.yaml) | The metrics ontology `semantic-layer.md` presents as a model: `MAPS_TO` as an edge with properties, `Metric` as a node that other metrics point at. |
| [`posts.json`](posts.json) | Publication manifest for the site's blog: which files are published, under which slug, and on which date. A file reaches the site only by being named here. |

A short-form companion compresses the long read rather than restating it loosely: every claim in it
is one the long read makes, so a correction lands in one place and propagates outward.

## The site's blog

These posts are also published on the documentation site, at
[`www.lpg-modeler.com/blog/`](https://www.lpg-modeler.com/blog/). They are rendered from the
markdown here by `npm run build:blog`, and the generated pages under `docs/blog/` are committed —
the site has no build step, so what is committed is what is served.

Regenerate after editing any published article. A test compares `docs/blog/` against what the
articles currently render to, so an edit that was not regenerated fails the build rather than
leaving the previous version online.

Two things the generator does that the markdown does not have to care about:

- **Assets.** `../docs/assets/...` is rewritten to the site's single copy, so the same path keeps
  working on GitHub and on the site.
- **Models.** A `.lpg.yaml` an article links to is copied to `docs/blog/models/`, because GitHub
  Pages publishes `docs/` and nothing above it. That copy is generated, not a second source.

Add a post by naming it in [`posts.json`](posts.json) and regenerating. Leaving a file out is how
the LinkedIn companion and this README stay off the site.

## Images

The article references images by relative path, which resolves on GitHub. Platforms that
render markdown outside the repository (dev.to, Medium, LinkedIn, the VS Code Marketplace)
do not resolve relative paths — substitute the absolute forms below, or upload the files.

| Referenced as | Absolute URL |
| --- | --- |
| `../docs/assets/diagrams/pipeline.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/pipeline.png` |
| `../docs/assets/screenshots/canvas.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/screenshots/canvas.png` |
| `../docs/assets/screenshots/inspector.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/screenshots/inspector.png` |
| `../docs/assets/screenshots/mixin.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/screenshots/mixin.png` |
| `../docs/assets/diagrams/capabilities.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/capabilities.png` |
| `../docs/assets/diagrams/reification.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/reification.png` |
| `../docs/assets/diagrams/two-layers.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/two-layers.png` |
| `../docs/assets/diagrams/agent-commerce.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/agent-commerce.png` |
| `../docs/assets/diagrams/rule-coverage.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/rule-coverage.png` |
| `../docs/assets/diagrams/three-layers.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/three-layers.png` |
| `../docs/assets/diagrams/correspondence-computation.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/correspondence-computation.png` |
| `../docs/assets/diagrams/ltv-composition.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/ltv-composition.png` |
| `../docs/assets/diagrams/semantic-layer-model.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/semantic-layer-model.png` |
| `../docs/assets/diagrams/two-cadences.png` | `https://raw.githubusercontent.com/Volland/lpg-modeler/main/docs/assets/diagrams/two-cadences.png` |

`frames-and-slots.md` reuses `pipeline.png` and `inspector.png` from the same set and adds no
images of its own, so it needs no upload folder. `concept-graphs.md` reuses `pipeline.png`,
`canvas.png` and `reification.png` on the same terms.

`rules-without-code.md` adds three diagrams of its own — `two-layers`, `agent-commerce` and
`rule-coverage` — drawn in the same palette as the rest, SVG source beside a 1.5× PNG export, and
has an upload set: `rules-without-code-images/01-two-layers.png`, `02-agent-commerce.png` and
`03-rule-coverage.png`, in the order the post uses them.

Images are referenced rather than copied, so there is one copy of each and an article cannot
show a screenshot the site has already replaced. Every screenshot is a capture of the real
webview rendering `docs/examples/fleet.lpg.yaml`, which a test resolves and generates — so a
change that broke the model fails the examples test before an article goes stale.

### Upload sets

Platforms that take file uploads rather than URLs — Substack, in particular — need the files to
hand, in the order the post uses them. Each article gets a `<article-slug>-images/` folder whose
names are numbered in that order:

| # | File | Source |
| --- | --- | --- |
| 1 | `you-dont-have-to-choose-images/01-pipeline.png` | `docs/assets/diagrams/pipeline.png` |
| 2 | `you-dont-have-to-choose-images/02-canvas.png` | `docs/assets/screenshots/canvas.png` |
| 3 | `you-dont-have-to-choose-images/03-inspector.png` | `docs/assets/screenshots/inspector.png` |
| 4 | `you-dont-have-to-choose-images/04-mixin.png` | `docs/assets/screenshots/mixin.png` |
| 5 | `you-dont-have-to-choose-images/05-capabilities.png` | `docs/assets/diagrams/capabilities.png` |
| 6 | `you-dont-have-to-choose-images/06-reification.png` | `docs/assets/diagrams/reification.png` |

`semantic-layer.md` adds five diagrams of its own, on the same terms: `three-layers`,
`correspondence-computation`, `ltv-composition`, `semantic-layer-model` (a drawing of
`semantic-layer.lpg.yaml`, so an edit to that model means redrawing it) and `two-cadences`. Its
upload set is `semantic-layer-images/01-three-layers.png` through `05-two-cadences.png`, in the
order the post uses them.

These are copies for publishing, not sources. The markdown still points at `../docs/assets/`, so
regenerating a diagram or recapturing a screenshot updates the article — but leaves the upload
set stale until it is re-copied. Re-copy before republishing.

## Formatting for the target platform

Substack does not render markdown tables — a pasted table collapses into a run of pipes. Posts
meant for it therefore carry no tables at all: `frames-and-slots.md` states its facet mapping and
its per-target notes as bold-led paragraphs instead, which render identically on Substack, dev.to,
LinkedIn and GitHub. Keep it that way when editing, and prefer the same shape for anything new.

Code fences, block quotes, bold and headings survive everywhere and need no substitution.

## Accuracy

Claims in these posts are drawn from `lat.md/` and from the published README, and several are
version-pinned measurements (LadybugDB 0.19.1 rejecting `NOT NULL`, Neo4j existence constraints
being Enterprise-only, the current target count). Re-check them against `lat.md/emitters.md`
before republishing an older post.

`frames-and-slots.md` and `concept-graphs.md` go further: every generated excerpt in them is
pasted from a real run, and their counts are countable from the model beside each one — 20 frames,
21 relations and 625 diagnostics for the first; 12 node types, 13 edge types, 81 expanded
`SUPERSEDED_BY` endpoint pairs and 440 diagnostics for the second. Regenerate before republishing —
a change to any emitter moves those numbers:

```bash
lpg check article/agent-trust.lpg.yaml
lpg emit  article/agent-trust.lpg.yaml --target ladybug --target neo4j --target falkordb \
          --target shacl --target owl --target gql --target pgschema --target linkml --out /tmp/schema

lpg check article/assortment.lpg.yaml
lpg emit  article/assortment.lpg.yaml --target ladybug --target neo4j --target falkordb \
          --target shacl --target owl --target gql --target pgschema --target linkml --out /tmp/schema
```
