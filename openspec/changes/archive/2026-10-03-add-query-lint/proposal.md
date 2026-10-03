# Add schema-aware query linting

## Why

Once a model exists, the queries in an application are claims about it — labels, relationship types, property names, value types — and nothing checks those claims. A renamed property breaks production queries silently. Linting Cypher/GQL text against the model makes the schema load-bearing on every commit, which is what makes a schema tool sticky.

## What Changes

- `lpg lint-queries <model> <files…>`: parse each query, resolve every label, relationship type and property access against the IR, and report: unknown label, unknown relationship type, unknown property on a matched type, an edge traversed against its declared endpoints or direction, and a comparison against an impossible type (string literal against an int property).
- Editor integration later: the same checks as diagnostics on `.cypher` files in VS Code.

## Gate (resolved)

The blocker was the parser, and the answer was to need none. A real lexer reads strings, comments, quoted names and numbers, and pattern chains are extracted from the token stream; everything else is passed over, so dialect differences between engines do not matter, and whatever cannot be resolved (unlabelled or rebound variables, label expressions, calls) is skipped rather than guessed. The false-positive classes this proposal listed are the test suite. Only query files are linted: finding a query inside a host-language source file stays a per-language parser's job.

## Non-goals

- No query rewriting, no formatting, no performance advice.
- No runtime interception; text files and editor buffers only.

## Locked decisions

None amended. Decision 2 (no hand-written parser) is about the model's surface syntax; a query parser is a different artifact, but the same caution applies and is the reason this is deferred rather than hacked.

## Targets affected

None; queries are read, not generated.

## Capabilities

### New Capabilities
- `query-linting` (deferred).

## Impact

- `core`: a query reader and the resolution checks; parser dependency decision required first.
- Tests must include every false-positive class the regex approach would have hit: labels in strings, in comments, map keys, variable-length paths, multi-label patterns.
