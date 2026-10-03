# Add a context target (schema card)

## Why

Agents and prompt pipelines that write queries against a graph need the schema in the prompt, and today the only honest source is the model file itself — verbose YAML with element ids and layout concerns an LLM does not need. A compact, deterministic "schema card" gives text-to-Cypher grounding and agent tooling one small artifact that is always derived from the model, never hand-maintained.

## What Changes

- A new `context` target: one Markdown artifact, one line per element, token-lean by design. Node types with their hierarchy, mixins, key and properties inline; edge types with endpoints and cardinality; enums; mixins; named constraints spelled in words.
- Everything the model says is carried — this is a documentation target, so nothing is a downgrade. A raw SHACL fragment is included verbatim rather than dropped.
- Deterministic output: same model, same bytes, so the card can be committed and diffed.

## Non-goals

- No MCP server, no tool-call interface — that is `add-mcp-server`, which will serve exactly this card plus structured lookups.
- No prose generation, no LLM involvement: the card is a projection of the IR.
- No per-target enforcement notes (the `docs` target carries those).

## Locked decisions

None amended. Decision 13 does not apply: there is no engine to measure; the artifact is for a reader. Decision 8 is trivially upheld — the target can carry every feature, so it declares a full capability set and reports nothing.

## Targets affected

New target **context**. No existing target changes.

## Capabilities

### Modified Capabilities
- `schema-generation`: an eleventh target.

## Impact

- `core`: `emit/context.ts` plus one registry entry. No `vscode` import.
- Tests: golden file for the social fixture; determinism and completeness unit tests.
- `lat.md/emitters.md` (new Context Target section), CLI usage text, CHANGELOG.
