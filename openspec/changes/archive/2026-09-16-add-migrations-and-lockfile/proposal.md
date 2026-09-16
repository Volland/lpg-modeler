## Why

Every target is generated from scratch, so a deployed model has no path forward: the tool produces the schema a database *should* have, never the steps from the schema it *has*. Teams hand-write those steps, which is exactly where a rename becomes a drop-plus-add and destroys data. Migrations were deferred from v1 (`architecture#Roadmap#Still deferred`); they are pulled forward because their prerequisites have landed — element ids, a stable serializer, three database targets — and "deployed once, then stuck" is the first wall a real user hits.

## What Changes

- **Lockfile.** `lpg lock <model>` writes `<stem>.lpg.lock.json` beside the model: a canonical, stable-ordered snapshot of the resolved IR (hierarchy and mixins flattened, imported types included, source locations stripped) with a `revision` counter. It is committed with the model.
- **Semantic diff.** The lockfile diffed against the current model yields a change set matched by element id, never by structural similarity. Each change is classified `additive`, `breaking` or `destructive`.
- **`lpg diff <model> [--fail-on <class>]`** prints the change set and gates a pull request. `lpg lock --check` fails when the model has changed since the lock.
- **`lpg migrate <model> [--target …] [--allow-destructive]`** writes one script per database target, numbered by the lockfile revision, then advances the lockfile:
  - **ladybug**: `CREATE`/`ALTER`/`DROP` over node and rel tables, executed in-process in tests.
  - **neo4j**: constraint and index drops and creates, plus relabel statements for renames; edition-aware.
  - **falkordb**: the same over `redis-cli`, in the order the engine requires.
- A destructive change without `--allow-destructive` is an error: nothing is written and the lockfile does not move. A change a target cannot apply in place is a downgrade — a diagnostic plus a comment at the site in the script.
- Locking a model whose element ids are derived rather than written is an error, since a rename could not be told from a drop-plus-add.

## Non-goals

- Applying a migration to a running database; the operator reviews and runs scripts.
- Data migration beyond what a rename needs (no backfills, no value conversion).
- Migrating **shacl**, **owl**, **gql**, **pgschema**, **linkml** — these are regenerated.
- **memgraph** and **template** targets.
- Canvas or command-palette entry points.
- `owl:equivalentClass` for renamed IRIs.

## Locked decisions

Touches none. It implements decision 12 and relies on decision 5 without amending either. The lockfile holds semantics only, consistent with decision 1.

## Capabilities

### New Capabilities
- `schema-migration`: the lockfile, the semantic diff and its classification, and migration scripts for the ladybug, neo4j and falkordb targets.

### Modified Capabilities

None — full-artifact generation is unchanged.

## Impact

- `packages/core`: lockfile writer/reader, IR diff, per-target migration planners; the IR records whether an element id was written or derived. No `vscode` import.
- `packages/cli`: `lock`, `diff`, `migrate`.
- `lat.md/`: `emitters#Migrations`, `architecture#Roadmap#Still deferred`, `metamodel#Stable Element IDs`.
- Docs site: CLI page and a migrations walkthrough. No new dependencies.
