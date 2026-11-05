# Design: TGS import and export

## Metamodel

Unchanged. The IR, the lockfile and diffing are untouched: TGS is one more source and one more target over the same IR. Type naming and namespaces are unchanged, so IRI stability and rename detection are unaffected; an imported model gets derived element ids, as every import does.

Depends on: `lat.md/importers#Importers`, `lat.md/importers#Serializing a Model`, `lat.md/emitters#Capability Matrix`, `lat.md/metamodel#Type Hierarchy`, `lat.md/metamodel#Namespaces`, `lat.md/metamodel#Identity`.

The format is TGS 0.3 (`obsigtaph/spec/tgs/SPEC.md`). Notes are written as `tgs: "0.1"`, because they use only 0.1 keys and every reader accepts 0.1.

## Packages

`core` gains `import/tgs.ts` and `emit/tgs.ts`; frontmatter is read with the `yaml` package already in `core`. No `vscode` import. `cli` reads directories and prompts for the layout; `vscode` adds two commands.

## Mapping

| Model | TGS | Back |
|---|---|---|
| node type | type in `schemas` / note with `schema` | node type |
| `uri` | `uri: <prefix>:<Name>`, prefix declared in `prefixes` | namespace when all types share one prefix |
| string, uuid, json, duration, blob | `text` | string (others from `lpg`) |
| integers, floats, decimal | `number` | float (YAML numbers are doubles) |
| boolean, date | `boolean`, `date` | same |
| datetime, zoneddatetime | `datetime` | datetime |
| list of string | `list` | string list |
| list of another scalar | `{kind: …, many: true}` | list |
| composite | `text` | from `lpg`, else string |
| enum | `values: [...]` | an enum per distinct value list |
| required | `required: true` | required |
| inherited and mixin properties | flattened onto every type | factored back out using `lpg` |
| edge type | `edgeTypes` entry: `from`, `to`, `properties` | edge type |
| abstract endpoint | expanded to its concrete descendants | collapsed to the nearest common ancestor |
| outgoing edges of a type | `edges` map, `many: false` when the to end is at most one, `required` when at least one | to-end bound |

Every type carries `edges`, because an LPG type's outgoing edges are exactly those declared; TGS reads an absent `edges` as "any edge".

## The `lpg` key

A note-level frontmatter key, which TGS §3 requires readers to ignore. It holds only what TGS cannot say, keyed by element name: `namespace`, per node `abstract`, `extends`, `mixins`, `key`, `open`, per property the exact `type`, `unique`, `enum`, value bounds and pattern, per edge the declared `from`/`to` and `cardinality`, and each mixin's property names. TGS keys stay authoritative: an `lpg` entry for a name the TGS keys no longer declare is reported and ignored, so a note edited by hand in Obsidian still imports.

## Layouts

- `folder`: one note per node type, `Types/<Name>.md`, with `schema:`. Each edge type is declared under `edgeTypes:` in the note of its source type. `prefixes`, `tgs` and the `lpg` entries for that note's elements are written in every note, so each note stands alone. The namespace is in each note's `lpg` block.
- `single`: one note, `Types/<model stem>.md`, with `schemas` and `edgeTypes`.

A note that already exists keeps every frontmatter key but `schema`, `schemas`, `edgeTypes`, `prefixes`, `tgs` and `lpg`, and keeps its body. No note is deleted. A note that would be rewritten but declares types the export does not contain is refused unless `--force` (TGS §13.5).

## Import

1. Read the notes directly in the folder (or the one note), in code-point order of path. A note whose `tgs` major version is not 0 is reported (`import-tgs-version`) and skipped. A repeated type, edge type or prefix keeps the first and is reported (`import-tgs-duplicate`).
2. Types and edge types per TGS §4–6. An unknown kind is text (`import-tgs-unknown-kind`).
3. Apply the `lpg` key when present.
4. A type named in `from`, `to` or a target but declared nowhere becomes an empty node type (`import-tgs-undeclared-type`).
5. Each edge type collects its sources (its `from`, and every type whose `edges` names it) and its targets. A side with several types collapses to the nearest common ancestor; with none, the first type stands and the rest are reported (`import-tgs-endpoint-union`). An edge with an unrestricted end has no endpoint to declare and is reported (`import-tgs-open-endpoint`), not imported.
6. Keys (decision 4): the `lpg` key, else the property named by the type's first `id` rule, else a synthesized required `title` string, the note title being a note's identity (`import-tgs-title-key`).
7. Names that are not identifiers are rewritten (`import-renamed`).
8. Templates, defaults, other id rules and visualization are counted and reported once (`import-tgs-not-carried`).

## Target `tgs`

Capability set: `multiLabel: true`, `inheritance: 'leaf-tables'` (properties flattened), `requiredConstraint: 'enforced'`, `uniqueConstraint: 'unsupported'`, `compositeKey: 'unsupported'`, `edgeProps: 'native'`, `nestedEdges: false`, `listProps: 'native'`, `compositeTypes: 'unsupported'`, `enums: 'enforced'`, `openTypes: 'always-open'`, `valueConstraints: 'unsupported'`, `namedConstraints: 'unsupported'`, `rawPassthrough: false`, `cardinality: 'upper-bound-only'`.

Downgrades, each a diagnostic and recorded in `lpg`: `downgrade-abstract`, `downgrade-inheritance` (hierarchy flattened), `downgrade-key`, `downgrade-unique`, `downgrade-type` (a scalar written as a wider kind), `downgrade-composite`, `downgrade-cardinality` (a from-end bound or a count beyond one), `downgrade-open` (TGS properties are always open; reported once, info), and the shared value/named/raw constraint downgrades. `emit(model, 'tgs')` produces the `single` note so the target works everywhere a target does; `lpg export` and the VS Code command also offer `folder`.

## Verification

Round trip: every single-namespace fixture exported in both layouts and imported again resolves to the same node types, edge types, keys, hierarchy, mixins, enums, cardinality and element ids. The TGS conformance examples and the code ontology import into models that validate. When `tg` is on the path, `tg validate --schema-only` over every exported vault reports no finding, and a deliberately broken note proves it reports one. The TGS JSON Schema is not used: checking 2020-12 needs a validator this workspace does not have, and the reference reader is the stronger check.

A note of another TGS major version, or with frontmatter that is not YAML, is a warning rather than an error, so one bad note does not fail a folder.
