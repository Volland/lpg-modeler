# Add an MCP server over the model

## Why

Agents writing graph queries need the schema at tool-call time, not pasted into a prompt once. An MCP server over a model file gives any MCP client structured lookups — list types, describe one, resolve an edge's endpoints, fetch the schema card — grounded in the same IR every artifact comes from. The `context` target supplies the payload; this change supplies the wire.

## What Changes

- `lpg mcp <model>`: a stdio MCP server exposing tools — `schema_card` (the `context` artifact), `list_types`, `describe_type` (properties, key, constraints, edges in/out), `describe_edge`. Read-only over the model file, and re-resolved on every call so an edit is visible to the next question. A `validate_value_shape` tool (does this property exist, what scalar, what bounds) is not part of this change: `describe_type` already answers it, and a second answer to the same question could disagree.

## Gate (resolved)

The protocol is a hand-written newline-delimited JSON-RPC loop over `initialize`, `ping`, `tools/list` and `tools/call`, with no SDK, because the command line ships as one self-contained bundle. The surface is files only; a canvas-attached server remains a possible later change.

## Non-goals

- No write tools: an agent edits a model through a human and a diff, not through a socket.
- No query execution against databases.

## Locked decisions

None amended.

## Targets affected

None; the server reads the IR and reuses the `context` target.

## Capabilities

### New Capabilities
- `agent-interface` (deferred).

## Impact

- `cli`: the `mcp` command and the protocol loop; dependency decision first.
- Tests: a scripted client over stdio; tool results pinned against fixtures.
- `lat.md` section; CLI usage; CHANGELOG.
