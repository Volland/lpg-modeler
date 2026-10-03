# Add a browser playground

## Why

Every entry point today requires an install. A page on the documentation site where a visitor pastes or edits model YAML and sees the diagram plus every generated artifact live would convert a reader into a trial in one click — the funnel the announcement posts currently hand to the Marketplace button.

## What Changes

- A playground page under `docs/`: a text editor, a target picker, and the generated artifact with its diagnostics (no diagram: the canvas stays in the extension), all computed in the browser from a bundled `core`. Examples loadable from the published example models.

## Gate (resolved)

The no-build-step rule keeps its reason and gives up its letter, as the blog already did: the bundle is built by a script the author runs, committed, and kept honest by a test that rebuilds it and compares, so Pages still serves static files and a broken toolchain cannot take the site down. The page carries no diagram (React Flow would weigh the bundle past a quick look) and no database commands (a browser cannot reach one).

## Non-goals

- No saving, no sharing links, no server side; paste in, read out.
- No live database connections from the browser.

## Locked decisions

None amended; the no-build-step stance of `lat.md/architecture#Distribution#Documentation site` is the open question, and changing it must be argued there.

## Targets affected

None in core; emit-only targets run as they are.

## Capabilities

### New Capabilities
- `web-playground` (deferred).

## Impact

- `docs/` page plus a committed or built bundle of `core`; a staleness test in the manner of the blog's regenerate-and-compare.
- `lat.md` distribution section; site navigation.
