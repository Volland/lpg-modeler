# Design (sketch — implementation deferred)

The metamodel and the IR do not change. The open decision that gates everything is the parser: candidates are vendoring the openCypher reference grammar, `@neo4j/cypher-builder`'s parser surface, or a tree-sitter grammar compiled to WASM (which `core` could not inline for the extension without weighing the bundle). Each engine's dialect then needs a declared subset: start with openCypher common ground and report dialect-specific syntax as unparseable-but-not-an-error, so the linter never cries wolf on a query the engine accepts.

Checks, in order of value: unknown label; unknown relationship type; unknown property on a type-resolved variable (flattened IR gives inherited properties for free); endpoint and direction violations using `concreteDescendants` for abstract endpoints; literal-vs-scalar comparisons. Variables that cannot be type-resolved (unlabelled nodes, multi-hop paths) are skipped silently — an unresolved variable is not a finding.

Cites: `lat.md/architecture#Surface Syntax` (the caution about owning parsers), `lat.md/metamodel#Type Hierarchy`.
