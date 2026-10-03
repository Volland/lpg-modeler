## 0. Gate

- [x] 0.1 Decide SDK vs hand-written JSON-RPC stdio loop; record the bundle consequence.

## 1. Implementation

- [x] 1.1 `lpg mcp` command; tools over the resolved IR; re-resolved on every call, which is simpler than an mtime cache and cannot go stale across imports.
- [x] 1.2 Scripted-client tests over fixtures.

## 2. Docs

- [x] 2.1 `lat.md` section; CLI usage; CHANGELOG.
- [ ] 2.3 A docs-site recipe for wiring `lpg mcp` into an MCP client (not written; client configuration formats vary and none was verified here).
- [x] 2.2 `lat check`.
