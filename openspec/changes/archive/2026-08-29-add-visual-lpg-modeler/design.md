# Design

## Metamodel impact

**The metamodel does not change.** Every construct this change needs already exists in
`lat.md/metamodel#Metamodel`: the type hierarchy, `key` (`lat.md/metamodel#Identity`),
stable element ids (`lat.md/metamodel#Stable Element IDs`), sealed composition
(`lat.md/metamodel#Composition`), and namespaces (`lat.md/metamodel#Namespaces`).

This is deliberate. The metamodel is the least reversible decision in the project, so
pulling UI forward must not perturb it. The canvas is simply a second producer of the
same IR the CLI already produces.

## Package placement

| Concern | Package |
|---|---|
| JSON Schema, parse, IR, resolve, validate, emit, YAML mutation | `core` |
| `lpg emit`, `lpg check` | `cli` |
| Webview host, diagnostics, commands, canvas React app | `vscode` |

`core` introduces no `vscode` import. The YAML mutation module is the only new part of
`core` that is editor-shaped, and it deals in file text, not editor APIs. An ESLint
`no-restricted-imports` rule enforces the boundary, per
`lat.md/architecture#Package Boundary`.

## Pipeline

```
*.lpg.yaml --parse--> raw doc --resolve--> IR --+--> validate --> diagnostics
                                                +--> emit(target) --> artifact
                                                +--> project(view) --> canvas
```

Resolution applies imports, mixins, and inheritance, assigns absolute IRIs from the
declaring model's namespace, and backfills any missing element id. Resolution is pure
and total: it always returns an IR plus a diagnostic list and never throws, so the
canvas can render a partially broken model instead of going blank.

## Canvas write-back

Canvas actions do not serialize the IR. Each action is a named mutation applied to the
`yaml` `Document` for the file, preserving comments, key order, and formatting per
`lat.md/architecture#Editing Surface`. The extension applies the result as a
`WorkspaceEdit`, so VS Code owns undo and dirty state.

Mutations are the full authoring surface: add, rename, and delete a node type; add,
rename, and delete a property; set a key; add and delete an edge type; set an edge
endpoint; set an abstract parent. Anything not expressible as a mutation is not
offered in the UI.

The webview is a rendering and intent surface only. It posts an intent; the extension
host resolves it against `core` and pushes a fresh projection back. No model state
lives in the webview, so nothing there can diverge from the file.

## Layout and views

Layout lives in a sidecar keyed by element id, nested per view, per
`lat.md/architecture#Views` and `lat.md/architecture#Source of Truth`. Because ids are
stable, renaming a type does not move its box. A type belonging to no view is reported
by validation.

## Capability sets

| Target | multiLabel | inheritance | required | edge props | key |
|---|---|---|---|---|---|
| `ladybug` | no | flatten to leaf tables | key only | yes | PRIMARY KEY, single column |
| `neo4j` | yes | flatten to labels | Enterprise only | yes | NODE KEY |
| `shacl` | yes | subClassOf | yes, sh:minCount | via reification | n/a |
| `owl` | yes | subClassOf | no | via reification | owl:hasKey |

Downgrades this change introduces, each surfacing as a diagnostic **and** a comment at
the lossy site per `lat.md/emitters#Capability Matrix`:

- `neo4j` under a Community configuration cannot enforce `required`.
- `owl` cannot express `required`; that is precisely what the SHACL artifact is for.
- `ladybug` cannot hold a multi-label node.
- `ladybug` cannot enforce `required` on any property other than the key. Verified
  against LadybugDB 0.19.1: `NOT NULL` is not accepted by the parser, and inserting a
  null non-key value succeeds. Only primary key uniqueness and primary key non-null
  are enforced.
- `ladybug` cannot express a composite primary key. Verified: `PRIMARY KEY(a, b)` does
  not parse. A composite key is therefore emitted as a synthesized concatenated column,
  which is mandatory rather than a fallback.

## RDF mapping

SHACL is the constraint artifact and OWL the safe assertional subset, per
`lat.md/emitters#SHACL Shapes` and `lat.md/emitters#OWL Subset`. The OWL emitter must
never emit `rdfs:domain`, `rdfs:range`, or cardinality restrictions, because doing so
inverts the meaning of an LPG constraint rather than merely losing it.

Edge properties follow gradual reification (`lat.md/emitters#Gradual Reification`): a
bare edge becomes an object property, while an edge carrying properties becomes an
n-ary class plus a shortcut property, and its SHACL shape targets that class.

## IRI stability

IRIs derive from the declaring model's namespace plus the type name, so a rename
changes a type's IRI. Renaming is a canvas mutation here, so the rename path emits an
`owl:equivalentClass` assertion to the previous IRI, as anticipated in
`lat.md/metamodel#Namespaces`. Element ids are unaffected, so layout survives.

## Lockfile and diffing

Out of scope. Nothing in this change may assume a lockfile exists. The IR serializer
is written with stable key ordering regardless, so adding a lockfile later is a
serialization call rather than a rework.
