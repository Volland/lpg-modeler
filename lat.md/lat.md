This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

- [[architecture]] — source of truth, package boundary, editing surface, views, and the v1 cut line.
- [[metamodel]] — what a model may say: type hierarchy, identity, stable ids, composition, namespaces.
- [[emitters]] — capability matrix, Ladybug/Neo4j/template targets, RDF mapping, migrations, verification.
- [[importers]] — reading SHACL, OWL, SQL DDL, LadybugDB and live instances back into a model, and what each source cannot carry.
- [[audit]] — read-only checks of stored data against the constraints a target could not enforce.
- [[drift]] — comparing what a database holds against what the model requires of that target.
- [[agent]] — serving the model to an MCP client, read-only.
- [[lint]] — checking query files against the model, and what the linter refuses to guess.
- [[playground]] — the in-browser model editor on the documentation site.
