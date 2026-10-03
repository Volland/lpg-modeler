# Drift

`lpg drift` compares the schema a database actually holds against what the model requires of that target, and exits non-zero on any difference: `missing`, `unexpected`, or `different`. Compared by [[packages/core/src/drift.ts#drift]].

`lpg diff` guards the model against its lockfile and `apply` writes reviewed scripts, but nothing else answers "is the database still what the model says?" — a schema changed by hand on the server, or a deploy that never ran, surfaces only when a query fails. Drift is the comparison the importers and emitters already imply, as a CI-ready command. It deliberately compares against the model, not the lockfile: model-versus-lockfile is `lpg diff`'s question, and combining the two reads is a shell pipeline rather than a mode.

An imported model cannot simply be diffed against the authored one: a live schema carries no element ids, so the id-matched [[emitters#Migrations#Change Classification|diff]] would read everything as removed-plus-added, and a lossy read (no cardinality from a database catalog, no value bounds from anywhere) would report the loss as drift. So the comparison runs per target, over the objects that target actually stores — tables, columns, keys and endpoint pairs on LadybugDB; constraints and indexes on the three server engines — and what an engine cannot store is out of scope by construction.

The expected side is built by the emitters' own functions — `columnType`, `syntheticKeyColumn` and the endpoint expansion for LadybugDB; the [[emitters#Migrations#Target Planners|planners']] schema-object sets for the rest, read back from the emitter's own spellings — so drift cannot spell an expectation differently from `emit`. The actual side is what the importers already read: `parseLadybugDdl` for a committed script (`--script`, which needs no database at all), the read-only catalog of a database, or a live instance over the same probe-first connection path `lpg import` uses. Multiplicity is compared only against a script, because a database's catalog does not record it (measured against 0.19.1).

## Structural identity

On the constraint engines an object's identity is its kind, entity, label and property set — never its name. A schema deployed by another tool under different names but the same shape is not drift.

Neo4j constraint names are cosmetic to the schema's meaning and Memgraph constraints carry none, so matching on them would report drift where nothing drifted. The catalog rows the importers already exclude — LOOKUP indexes, constraint-owned indexes — are excluded here too, and a FalkorDB constraint that is not `OPERATIONAL` is reported with its status rather than counted as present, because it enforces nothing. A FalkorDB index flattens to one entry per property on both sides, because that is what the engine makes of any composite CREATE (measured). On Neo4j the instance's own edition decides what the model expects of it, unless `--edition` overrides: expecting a NODE KEY of a Community server would manufacture drift the server cannot repair.

## Verification

The LadybugDB comparison is proved in both directions in-process: a schema generated from the model drifts against nothing, as a script and as a database built from it, and a model mutated afterwards names exactly the column, key or pair that moved.

The server engines are unit-tested over hand-written catalogs — clean, missing, unexpected, name-insensitive, a FAILED constraint — because their drift functions take the catalog the live importers produce, and those importers' own suites already prove the catalogs against real engines.
