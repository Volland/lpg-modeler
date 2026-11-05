# Add Typed Graph Schema (TGS) import and export

## Why

Typed Graph keeps a project's ontology as TGS schema notes in a `Types/` folder: YAML frontmatter that the Obsidian plugin, the `tg` CLI and the VS Code typed-note commands all read. A team that has drawn its graph here wants the same types in its notes, and a team whose ontology already lives in `Types/` wants to start a model from it rather than retype it. Today the two never meet.

## What Changes

- A new `tgs` source: `lpg import Types/` reads every schema note directly in the folder (TGS §3), and `lpg import Types/code-types.md` reads one note. Both modes read the same joint ontology into one model.
- A new `tgs` target and a new `lpg export` command that writes schema notes into a `Types/` folder in one of two **layouts**:
  - `folder` — one schema note per node type (`schema:` form), each edge type declared in the note of its source type;
  - `single` — one note holding the joint ontology (`schemas:` and `edgeTypes:`).
- The layout is asked for: the VS Code command shows a pick, and the command line prompts on a terminal when `--layout` is not given, defaulting to `folder` when it cannot ask.
- What TGS cannot say — abstract types, inheritance, keys, uniqueness, mixins, integer widths, enum names, exact cardinality, endpoints before expansion — travels in a note-level `lpg:` key, which TGS readers must ignore (§3). Every such item is also reported as a downgrade, because a TGS validator will not enforce it.
- Writing into an existing note replaces only the TGS keys and `lpg`, keeps every other key and the body, and never deletes a note (TGS §13.5).
- VS Code: **LPG: Import Typed Graph Schema…** (asks folder or file) and **LPG: Export Typed Graph Schema…** (asks layout and folder).

## Non-goals

- No validation of data notes against a schema; that is `tg validate`'s job.
- No SHACL path through TGS: the SHACL importer and target already exist.
- No AsciiDoc schema notes (TGS §2.1 keeps schema notes Markdown).
- TGS templates, defaults, id rules other than the key's, and visualization are not carried into the model; their loss is reported on import.

## Locked decisions

None amended. Decision 4 is upheld on import by deriving a key (from a type's `id` rule, else a synthesized `title`, a note's identity) and reporting it. Decision 8 governs every downgrade. Decision 13: the output is checked against the reference implementation (`tg validate --schema-only`) whenever `tg` is installed, and by this tool's own reader always.

## Targets affected

New target `tgs`. No existing target changes.

## Capabilities

### Modified Capabilities
- `schema-import`: a TGS source, from a folder or one note.
- `schema-generation`: a `tgs` target, the `export` command, the two layouts, and the VS Code commands.

## Impact

- `core`: `import/tgs.ts`, `emit/tgs.ts`, registry entries, format detection. Uses the existing `yaml` dependency; no `vscode` import.
- `cli`: directory and `.md` import, `lpg export`, the layout prompt.
- `vscode`: two commands.
- Tests, `lat.md/importers.md` and `lat.md/emitters.md`, CLI usage, README, CHANGELOG.
