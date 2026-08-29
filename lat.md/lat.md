This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

- [[architecture]] — source of truth, package boundary, editing surface, views, and the v1 cut line.
- [[metamodel]] — what a model may say: type hierarchy, identity, stable ids, composition, namespaces.
- [[emitters]] — capability matrix, Ladybug/Neo4j/template targets, RDF mapping, migrations, verification.
