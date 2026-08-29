# Tasks

## 1. Workspace

- [x] 1.1 Create the npm workspace with `core`, `cli`, and `vscode` packages, shared TypeScript config, and vitest.
- [x] 1.2 Add the ESLint `no-restricted-imports` rule barring `vscode` from `core`, and a test that fails if it is imported.

## 2. Model format

- [x] 2.1 Write the JSON Schema for `*.lpg.yaml` and wire `contributes.jsonValidation` in the extension manifest.
- [x] 2.2 Define the IR types and parse a model file into a raw document with source positions retained.
- [x] 2.3 Assign and backfill stable element identifiers; detect duplicates.
- [x] 2.4 Resolve namespaces into absolute IRIs for every declared type.
- [x] 2.5 Resolve imports with sealed semantics; resolve the diamond case by IRI identity.
- [x] 2.6 Resolve inheritance, mixins, and inherited keys into concrete types.
- [x] 2.7 Implement validation rules: missing key, key naming an undeclared property, cyclic inheritance, duplicate identifier, sealed-import violation, type in no view.
- [x] 2.8 Make resolution total: always return an IR plus diagnostics, never throw.

## 3. Generation

- [x] 3.1 Implement the capability matrix and the downgrade reporting path (diagnostic plus comment at the lossy site).
- [x] 3.2 Implement the Ladybug emitter: leaf-table flattening, endpoint-pair expansion, primary keys, composite-key synthesis.
- [x] 3.3 Golden-file tests for the Ladybug emitter.
- [x] 3.4 In-process LadybugDB execution test: run generated DDL, then assert a required-property violation is rejected.
- [x] 3.5 Implement the Neo4j emitter: constraints, indexes, label flattening, edition awareness.
- [x] 3.6 Golden-file tests for the Neo4j emitter.
- [x] 3.7 Implement the shared gradual-reification mapping used by both RDF emitters.
- [x] 3.8 Implement the SHACL emitter: node shapes with required, unique, cardinality, and datatype constraints.
- [x] 3.9 Golden-file tests for the SHACL emitter.
- [x] 3.10 Implement the OWL emitter restricted to the safe subset, with a test asserting no domain, range, or cardinality restriction is ever emitted.
- [x] 3.11 Golden-file tests for the OWL emitter.
- [x] 3.12 Emit an equivalence assertion to a type's previous IRI when it has been renamed.

## 4. Visual authoring

- [x] 4.1 Implement the YAML mutation module: add, rename, and delete a node type.
- [x] 4.2 Extend mutations to properties, keys, and abstract parents.
- [x] 4.3 Extend mutations to edge types, their endpoints, and their properties.
- [x] 4.4 Tests asserting comments, key order, and unrelated formatting survive every mutation.
- [x] 4.5 Implement views and the layout sidecar, keyed by element id and nested per view.

## 5. Extension and canvas

- [x] 5.1 Extension activation, the open-canvas command, and the webview host with message passing.
- [x] 5.2 Publish validation and downgrade diagnostics to the Problems panel at model-file positions.
- [x] 5.3 Render the canvas from a view projection with React Flow and ELK auto-layout, showing a property row per field.
- [x] 5.4 Canvas authoring: create node types, add and edit properties, set a key, set an abstract parent.
- [x] 5.5 Canvas authoring: create edge types by dragging, set endpoints, edit edge properties.
- [x] 5.6 Persist layout on drag; keep the model file unchanged when only position changes.
- [x] 5.7 View management in the canvas: create a view, add and remove types.
- [x] 5.8 Re-render the canvas on external file edits; retain the last valid diagram when the file is unparseable.
- [x] 5.9 Generate-target action in the canvas that writes the artifact and opens it.

## 6. CLI

- [x] 6.1 Implement `lpg emit --target <t>` and `lpg check`, exiting non-zero on validation errors.

## 7. Documentation

- [x] 7.1 Update `lat.md/architecture#Roadmap` for the amended v1 scope, and add sections covering canvas authoring and the mutation module.
- [x] 7.2 Run `lat check`.
