# lpg-modeler-cli

Command line interface for **[LPG Modeler](https://volland.github.io/lpg-modeler/)** —
design a property graph once, generate every schema from it.

```bash
npx lpg-modeler-cli check model/domain.lpg.yaml
npx lpg-modeler-cli emit  model/domain.lpg.yaml --target shacl --out ./schema
```

Seven targets from one model file: **LadybugDB** DDL, **Neo4j** constraints, **GQL** graph
types (ISO/IEC 39075), **PG-Schema**, **SHACL** shapes, an **OWL** ontology, and **LinkML**.

Anything a target cannot enforce is reported — as a diagnostic and as a comment at the
lossy line of the generated artifact. Nothing disappears quietly.

```
$ lpg emit social.lpg.yaml --target ladybug --out ./schema
schema/social.ladybug.cypher
social.lpg.yaml:26:7 warning [ladybug] downgrade-required: Property 'Person.email' is
  required, which LadybugDB cannot enforce: it has no NOT NULL and only the primary key
  is non-null.
```

Exit code is non-zero when a model has errors, so a pull request can be gated on schema
validity.

- **Documentation:** https://volland.github.io/lpg-modeler/
- **Model format:** https://volland.github.io/lpg-modeler/model-format.html
- **Examples to start from:** https://volland.github.io/lpg-modeler/examples.html
- **VS Code extension:** https://marketplace.visualstudio.com/items?itemName=pavlyshyn.lpg-modeler

Installing globally gives you the shorter `lpg` command:

```bash
npm install -g lpg-modeler-cli
lpg targets
```

MIT licensed.
