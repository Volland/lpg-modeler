# Playground

A page on the documentation site where a visitor edits model YAML and sees it validate and generate for every target, in the browser, with nothing installed. Built from [[packages/core/src/browser.ts#run]].

It is the same parser, validator and generators the extension and command line run, bundled from `core`. The page has no diagram and no live-database commands: React Flow would weigh the bundle past the point of a quick look, and a browser cannot reach a database, so those stay with the extension and the command line, and the page says so. Examples are the published `docs/examples/` files, inlined into the bundle rather than fetched, so the model a visitor is shown is byte for byte the one offered for download.

They are inlined because the site is served through a CDN that answers a request for any `.yaml` file with a 403, and a page that needs a request to show its first example can fail to. The same bundle test that compares the generators compares the examples.

The site's rule was no build step at all, so that a broken toolchain can never take the documentation down. This keeps the rule's reason and gives up its letter, the same way the blog does: `npm run build:playground` is a tool for the author, its output `docs/playground/lpg-core.js` is committed, and Pages still serves a folder of static files. The staleness test rebuilds the bundle and compares, so a change to `core` that forgot the bundle fails the build instead of publishing an old generator indefinitely.

## Parity with the command line

The bundle is run in an empty context with no Node globals, as in a page, and what it generates for every published example and every target is compared with what `core` generates.

Anything native stays out by construction: the entry imports no importer and no connection, so the optional runtimes cannot leak in. The one Node import `core` carries, `node:path`, is replaced by a shim of the single call it uses, since a pasted model has no neighbouring files — an import resolves to nothing and is reported the way the command line reports a missing file, and a model with errors generates nothing, as at the command line.

## The page

The page loads the bundle beside it and nothing else, and every example it offers is a file the site publishes.

It is held to the site's other rules like any page: no cross-origin subresource, no cookie or client-side storage, legal links in the footer, and a link from the front page and from getting started, because a page nothing links to is a page nobody reads.
