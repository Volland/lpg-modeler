# Agent

`lpg mcp` serves the model to an MCP client over stdio, so an agent grounds its queries in the schema as it is rather than as a prompt remembered it. Handled by [[packages/core/src/mcp.ts#handleMcpMessage]].

The card from [[emitters#Context Target]] is the payload an agent can be handed once; this is the same schema as lookups it can ask for at call time. Four tools — `schema_card`, `list_types`, `describe_type`, `describe_edge` — each answered from the resolved IR. `describe_type` lists the edge types leaving and entering a type including inherited ones, naming where each is declared, because what can this type relate to is the question an agent asks before writing a pattern.

The server is read-only by construction: no tool writes, none takes content to store, and an agent changes a model through a person and a diff, never through a socket. The model is re-resolved on every call, so an edit on disk reaches the next question in the same session; a model that has errors is a failed tool call carrying the first errors, not a broken session. A tool that fails is a result with `isError`, and only a malformed request is a protocol error.

## Protocol

The transport is newline-delimited JSON-RPC on stdin and stdout, written by hand rather than through an SDK.

The surface used is `initialize`, `ping`, `tools/list` and `tools/call`, and the command line ships as one self-contained bundle whose size a dependency would change.

The handler is a pure function from one message to one reply, so the protocol is tested without a process, and the stdio loop in the CLI only splits lines and writes replies. Stdout carries protocol messages and nothing else; everything the command says about itself goes to stderr. A notification gets no reply. Tools and protocol are tested with a scripted client against the real command, including a model edited while the server runs.
