# Design

The metamodel and the IR do not change; lockfile, diffing and rename detection are untouched. Work lands in `core` (`emit/docs.ts`); no `vscode` import. Depends on `lat.md/emitters#Emitters#Capability Matrix`, `lat.md/architecture#Distribution#Documentation site` (whose no-third-party rule the page adopts).

## Capability set

As with the `context` target, everything is declared carried: a data dictionary writes everything down and enforces nothing, and `rawPassthrough` is true.

## Decisions

### 1. One self-contained file

Inline `<style>`, no script required for reading, no external fetch of any kind — the same privacy stance the documentation site tests for, adopted because a generated page gets committed and served from places the author does not control. A test rejects `http(s)://` in `src`/`href` except anchors and the generator's own home link being relative text, which keeps the rule honest.

### 2. The enforcement matrix is computed, not asserted

A feature-detection pass lists the capabilities the model actually uses (required and unique non-key properties, composite keys, enums, lists, composites, value constraints, named constraints, open types, cardinality, edge properties). For each, the matrix shows every database and validation target's declared capability value, translated to one word. The capability constants are imported directly from the sibling emitter modules — the registry would be a cycle (`emit/index` imports `docs.ts`). The matrix therefore can never disagree with what `emit` reports, because both read the same constants.

### 3. Structure mirrors the inspector

Each node type section carries what the inspector shows — name, parent, mixins, key, properties with inherited/mixin provenance marks, constraints in words — plus the two lists the diagram cannot show at once: edges in and edges out, including inherited ones with the declaring type named. Anchors are element names, so a URL fragment survives reordering.

## Verification

A golden file pins the social fixture. Unit tests assert: no external subresource; every type has an anchor and appears in the table of contents; the matrix row set equals the features the fixture uses.
