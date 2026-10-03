# Open the plugin API for targets and sources

## Why

Locked decision 14 deferred a public plugin API "until three real emitters have shown where the seam actually falls". Nine emitters and six importers later, the seam has not moved: a registration is a capability set plus an emit function (plus an optional migrator), and a source is an importer plus its extensions. Opening that seam turns target coverage from this repository's backlog into the community's.

## What Changes

- `lpg --plugin <module>` (repeatable) loads a module whose default export receives `registerTarget` and `registerImporter`; the registries refuse a built-in's name and an incomplete capability set.
- Deferred within this change: a separately published type package and a project-file `plugins` key. Plugins are named on the command line until someone needs more.
- The capability set is the contract, exactly as decision 14 promised: a plugin that cannot express a feature must report the downgrade, and `lpg targets` marks plugin targets as such.

## Why now

The three questions below were the reason to wait; each has an answer small enough to ship. **Stability:** the IR types become public, and `plugin/hello.cjs` in-tree is the compatibility check, so a metamodel change that breaks plugin loading fails a test. **Trust:** a plugin is loaded only when named with `--plugin`, never discovered, and the docs say it runs with the user's privileges; no sandbox is promised. **Templates first:** decision 13's user-supplied-template path is the lighter route for output that is a text transform of the IR; the plugin API is for code, and shipping both is not exclusive — a template runner is itself a plugin. Decision 14's own criterion (three emitters) was met long ago.

## Original gate (resolved above)

This reworks locked decision 14 and therefore must be argued on its own, not as one of thirteen riders. The hard questions are stability (the IR types become public API, so every metamodel addition becomes semver-relevant), trust (a plugin is arbitrary code run by a CLI that people point at production databases), and the template alternative (decision 13 already promises user-supplied templates as the cheap path — the API should not ship before templates, or it will be used where a template would do).

## Non-goals

- No plugin marketplace, no sandboxing promise, no canvas extension points.

## Locked decisions

Reworks decision 14 (the deferral has expired by its own criterion) and touches decision 13 (templates should land first or together). Both must be re-argued in this change before implementation.

## Targets affected

None directly; the registries become public.

## Capabilities

### New Capabilities
- `plugin-api` (deferred).

## Impact

- `core`: public type surface and registry exports; semver policy for the IR.
- `cli`: plugin loading, provenance in `lpg targets` and in downgrade output.
- `lat.md/architecture#Modularity` rewrite; docs site authoring guide.
