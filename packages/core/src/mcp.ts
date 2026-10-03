import type { EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR } from './ir'
import { describeCardinality, formatValueType, typeParams } from './ir'
import { emitContext } from './emit/context'

/**
 * The model served to an agent: structured lookups over the resolved IR, and the schema
 * card. The server is read-only by construction — no tool writes, and the model is
 * re-resolved on every call, so an edit on disk is visible to the next question.
 * Tools and protocol are plain functions here; only the stdio loop lives in the CLI.
 * See lat.md/agent#Agent.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** What the host hands in: the model as it is now, or why it cannot be read. */
export type ModelSource = () => { model: ModelIR } | { error: string }

const propertyJson = (p: PropertyIR): Json => ({
  name: p.name,
  type: p.composite ? formatValueType(p.composite) : `${p.type}${typeParams(p)}${p.list ? '[]' : ''}`,
  required: p.required,
  unique: p.unique,
  ...(p.enum ? { enum: p.enum } : {}),
  ...(p.min !== undefined ? { min: p.min } : {}),
  ...(p.max !== undefined ? { max: p.max } : {}),
  ...(p.minLength !== undefined ? { minLength: p.minLength } : {}),
  ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
  ...(p.pattern !== undefined ? { pattern: p.pattern } : {}),
  ...(p.inheritedFrom ? { inheritedFrom: p.inheritedFrom } : {}),
})

const edgeJson = (e: EdgeTypeIR, declaredOn?: string): Json => ({
  name: e.name, from: e.from, to: e.to,
  cardinality: describeCardinality(e.cardinality),
  ...(declaredOn ? { declaredOn } : {}),
})

export function listTypes(model: ModelIR): Json {
  return {
    namespace: model.namespace.iri,
    nodeTypes: model.nodes.map((n) => ({
      name: n.name, abstract: n.abstract, ...(n.extends ? { extends: n.extends } : {}),
    })),
    edgeTypes: model.edges.map((e) => ({ name: e.name, from: e.from, to: e.to })),
    mixins: model.mixins.map((m) => m.name),
    enums: model.enums.map((e) => ({ name: e.name, values: e.values })),
  }
}

export function describeType(model: ModelIR, name: string): Json | undefined {
  const node: NodeTypeIR | undefined = model.nodes.find((n) => n.name === name)
  if (!node) return undefined
  // An edge declared on an ancestor travels to every descendant: what can this type
  // relate to is the question, so inherited edges are listed with where they are declared.
  const reaches = (type: string) => type === node.name || node.ancestors.includes(type)
  return {
    kind: 'node',
    name: node.name,
    iri: node.iri,
    abstract: node.abstract,
    open: node.open,
    ...(node.extends ? { extends: node.extends } : {}),
    ancestors: node.ancestors,
    mixins: node.mixins,
    key: node.key,
    properties: node.props.map(propertyJson),
    constraints: node.constraints.map((k) => ({ name: k.name, assert: k.assert as unknown as Json })),
    outgoing: model.edges.filter((e) => reaches(e.from)).map((e) => edgeJson(e, e.from)),
    incoming: model.edges.filter((e) => reaches(e.to)).map((e) => edgeJson(e, e.to)),
  }
}

export function describeEdge(model: ModelIR, name: string): Json | undefined {
  const edge = model.edges.find((e) => e.name === name)
  if (!edge) return undefined
  return {
    kind: 'edge', ...(edgeJson(edge) as { [k: string]: Json }), iri: edge.iri,
    properties: edge.props.map(propertyJson),
  }
}

interface Tool {
  name: string
  description: string
  inputSchema: Json
  run: (model: ModelIR, args: Record<string, unknown>) => Json | string | undefined
}

const nameArg = (what: string): Json => ({
  type: 'object',
  properties: { name: { type: 'string', description: `The ${what}'s name, as in list_types.` } },
  required: ['name'],
  additionalProperties: false,
})

const TOOLS: Tool[] = [
  {
    name: 'schema_card',
    description: 'The whole schema as one compact Markdown card: types, hierarchy, keys, properties, edges, enums and constraints. Start here.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (model) => emitContext(model, {}).content,
  },
  {
    name: 'list_types',
    description: 'Every node type, edge type, mixin and enum by name, with each edge type\'s endpoints.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (model) => listTypes(model),
  },
  {
    name: 'describe_type',
    description: 'One node type in full: properties with types and marks, key, ancestors, mixins, constraints, and the edge types leaving and entering it, inherited ones included.',
    inputSchema: nameArg('node type'),
    run: (model, args) => describeType(model, String(args.name ?? '')),
  },
  {
    name: 'describe_edge',
    description: 'One edge type: direction, endpoints, cardinality and properties.',
    inputSchema: nameArg('edge type'),
    run: (model, args) => describeEdge(model, String(args.name ?? '')),
  },
]

export const MCP_TOOL_NAMES = TOOLS.map((t) => t.name)

const PROTOCOL_VERSION = '2025-06-18'

interface RpcRequest { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> }

const result = (id: RpcRequest['id'], value: Json) => ({ jsonrpc: '2.0', id: id ?? null, result: value })
const failure = (id: RpcRequest['id'], code: number, message: string) =>
  ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/**
 * Answer one JSON-RPC message, or return undefined for a notification, which takes no
 * reply. A tool that fails is a result with `isError`, not a protocol error: the client
 * sees a failed call and can say why, rather than a broken session.
 */
export function handleMcpMessage(raw: string, source: ModelSource): Json | undefined {
  let msg: RpcRequest
  try {
    msg = JSON.parse(raw) as RpcRequest
  } catch {
    return failure(null, -32700, 'Parse error')
  }
  if (typeof msg !== 'object' || msg === null || typeof msg.method !== 'string') {
    return failure(msg?.id, -32600, 'Invalid Request')
  }
  const isNotification = msg.id === undefined
  switch (msg.method) {
    case 'initialize':
      return result(msg.id, {
        protocolVersion: typeof msg.params?.protocolVersion === 'string'
          ? msg.params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'lpg-modeler', version: '1' },
        instructions: 'Read-only access to a labeled property graph schema. Call schema_card first, then describe_type or describe_edge for detail.',
      })
    case 'ping':
      return result(msg.id, {})
    case 'tools/list':
      return result(msg.id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name)
      if (!tool) return failure(msg.id, -32602, `Unknown tool '${String(msg.params?.name)}'`)
      const text = (value: string, isError = false): Json =>
        result(msg.id, { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) })
      const loaded = source()
      if ('error' in loaded) return text(loaded.error, true)
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      const out = tool.run(loaded.model, args)
      if (out === undefined) {
        const names = (tool.name === 'describe_edge' ? loaded.model.edges : loaded.model.nodes).map((x) => x.name)
        return text(`No such ${tool.name === 'describe_edge' ? 'edge' : 'node'} type '${String(args.name)}'. Known: ${names.join(', ')}.`, true)
      }
      return text(typeof out === 'string' ? out : JSON.stringify(out, null, 2))
    }
    default:
      // Notifications such as notifications/initialized need no answer; an unknown
      // request does.
      return isNotification ? undefined : failure(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}
