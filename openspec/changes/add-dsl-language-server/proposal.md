# Add a concise DSL with a language server (proposal; deliberately deferred)

## Why

`lat.md/architecture#Surface Syntax` keeps a concise custom DSL with a real language server as "a later option rather than a prerequisite". This change records what that option would be, so the roadmap carries it explicitly instead of as folklore: a surface syntax with less punctuation than YAML, completion and hover from a language server rather than from `contributes.jsonValidation`, and the same IR underneath.

## What Changes (when it comes)

- A `.lpg` text syntax and a parser in `core`; the YAML form remains readable forever and convertible both ways, because models exist in the wild and decision 1 makes the file canonical.
- A language server offering completion, hover, go-to-definition across model imports, and the same diagnostics the compiler raises.

## Why not yet

Locked decision 2 — no hand-written parser — is a considered trade, and nothing has invalidated it: YAML plus the JSON Schema still buys completion, hover and structural errors at no parser cost, and every editing gap found so far was closed on the canvas instead. The features that make the model more valuable (checking data, checking queries, reaching more engines) all rank above re-spelling the same model. This proposal exists so the option stays reachable and its prerequisites are named: a settled metamodel (format version churn multiplies across two syntaxes) and demonstrated demand from users writing models too large for YAML comfort.

## Non-goals

- No deprecation of the YAML form, ever: decision 1 names the file canonical; two first-class syntaxes must round-trip.

## Locked decisions

Would rework decision 2; this proposal does not — it records the conditions under which that argument should be made.

## Targets affected

None.

## Capabilities

### Modified Capabilities
- `model-format` (deferred alternative surface).

## Impact

- When argued for real: parser in `core`, a language server package, canvas and CLI accepting both suffixes, converters both ways, and a migration story for the JSON Schema's users.
