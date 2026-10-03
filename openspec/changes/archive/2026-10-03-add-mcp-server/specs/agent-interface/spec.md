## Purpose

Serves the model to MCP clients so agents ground their queries in the schema as it is, not as the prompt remembered it.

## ADDED Requirements

### Requirement: The model is served over MCP, read-only

`lpg mcp <model>` SHALL serve a stdio MCP server exposing at least `schema_card`, `list_types`, `describe_type`, and `describe_edge`, each answering from the resolved IR of the model file at call time. The server SHALL expose no tool that writes.

#### Scenario: Describing a type

- **WHEN** an MCP client calls `describe_type` with `Person`
- **THEN** the result carries the type's properties with scalars and markers, its key, its ancestors and mixins, its constraints, and its incoming and outgoing edge types

#### Scenario: The model changed on disk

- **WHEN** the model file is edited while the server runs and a tool is called afterwards
- **THEN** the answer reflects the edited model
