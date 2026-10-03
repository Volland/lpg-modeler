# Add data migrations (proposal; not yet implemented)

## Why

Schema migrations move structure; some model changes also demand that data move — a property split in two, an edge reified into an edge type with properties, an enum value renamed in stored rows. Today those arrive as a destructive drop-plus-add, and the user writes the data movement by hand.

## What Changes

- A migration step vocabulary beyond schema statements: copy a property, backfill a synthesized key column, rewrite an enum value, reify an edge's rows into the new shape — planned from the same change classification, emitted into the same per-target scripts, and gated exactly as destructive changes are today.

## Why not yet

The planners can only move data they can describe, and the change classification does not yet carry *intent*: a removed property plus an added one is indistinguishable from a split, so a data migration needs the model author to state the mapping (a migration annotation in the model file or a sidecar). That is a metamodel-adjacent format decision — the least reversible kind this repository has — and it must come first, alone. Implementation is deferred until the mapping format is designed and argued.

## Non-goals

- No automatic inference of data mappings from structural similarity (decision 12's reasoning, applied to data).
- No cross-engine data copying.

## Locked decisions

None amended yet; the mapping format proposal may touch decision 1 (what the model file holds) and must say so when it comes.

## Targets affected

**ladybug, neo4j, memgraph, falkordb** planners, eventually.

## Capabilities

### Modified Capabilities
- `schema-migration` (deferred extension).

## Impact

- Mapping format design first; then per-planner data steps; oracle tests in the manner of the Ladybug catalogue oracle, extended to row contents.
