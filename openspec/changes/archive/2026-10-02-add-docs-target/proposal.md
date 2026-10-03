# Add a docs target (data dictionary)

## Why

Teams adopt a schema tool when the schema becomes the shared reference document. Today the canvas shows a diagram and the artifacts show each engine's slice, but there is no single page a teammate can open that spells out every type, every constraint, and — the part only this tool knows — which of the nine targets enforces each of them. That enforcement matrix is the capability matrix made visible, and it exists nowhere else.

## What Changes

- A new `docs` target: one self-contained HTML artifact — inline CSS, zero external fetches, printable — with a table of contents, a section per node type (hierarchy, mixins, key, property table, constraints, incoming and outgoing edges), sections for edge types, mixins and enums.
- An enforcement matrix: for each capability the model actually uses, what each database and validation target does with it (enforced, partial, documented, reported), derived from the targets' own capability sets.
- Everything is carried, so nothing is a downgrade; the matrix is where the losses are *displayed* instead.

## Non-goals

- No diagrams: the canvas and its PNG/SVG export own pictures; this page owns words and tables.
- No multi-page site, no build step, no JavaScript requirement for reading (anchors and static content only).
- No hosting story; the file is written beside the other artifacts.

## Locked decisions

None amended. Decision 8 is what the enforcement matrix displays. Decision 13 does not apply: the artifact is for a reader. The site rule that no page fetches a cross-origin subresource is adopted for the generated page as well.

## Targets affected

New target **docs**. No existing target changes; the matrix reads the other targets' published capability sets.

## Capabilities

### Modified Capabilities
- `schema-generation`: a twelfth target.

## Impact

- `core`: `emit/docs.ts` plus one registry entry; imports the sibling capability constants, not the registry, so no cycle. No `vscode` import.
- Tests: golden file for the social fixture; a test that the page references no external URL; completeness checks.
- `lat.md/emitters.md` (new Docs Target section), CLI usage text, CHANGELOG.
