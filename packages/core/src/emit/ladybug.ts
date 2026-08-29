import type { Diagnostic, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR, ScalarType } from '../ir'
import { concreteDescendants, concreteNodes } from '../ir'
import { downgrade, type Capabilities, type EmitOptions, type EmitResult } from '../capabilities'

/**
 * Verified against LadybugDB 0.19.1: NOT NULL is not accepted by the parser, composite
 * PRIMARY KEY does not parse, and a null non-key value inserts successfully. Only
 * primary key uniqueness and primary key non-null are enforced.
 */
export const LADYBUG_CAPABILITIES: Capabilities = {
  target: 'ladybug',
  multiLabel: false,
  inheritance: 'leaf-tables',
  requiredConstraint: 'key-only',
  uniqueConstraint: 'key-only',
  compositeKey: 'synthesized',
  edgeProps: 'native',
  nestedEdges: false,
}

const TYPES: Record<ScalarType, string> = {
  string: 'STRING', int: 'INT64', float: 'DOUBLE', boolean: 'BOOL',
  date: 'DATE', datetime: 'TIMESTAMP', uuid: 'UUID', json: 'STRING',
}

/** Column name for a synthesized composite key. */
export function syntheticKeyColumn(node: NodeTypeIR): string {
  return `${node.name.toLowerCase()}_key`
}

function columnLines(node: NodeTypeIR, diags: Diagnostic[]): string[] {
  const lines: string[] = []
  const isKey = (p: PropertyIR) => node.key.length === 1 && node.key[0] === p.name

  for (const p of node.props) {
    if (p.type === 'json') {
      downgrade(diags, 'ladybug', 'downgrade-type',
        `Property '${node.name}.${p.name}' has type json, which LadybugDB has no native column type for. Emitted as STRING.`,
        p.loc)
      lines.push(`  // DOWNGRADE: '${p.name}' is json in the model; stored as STRING.`)
    }
    if (p.required && !isKey(p)) {
      downgrade(diags, 'ladybug', 'downgrade-required',
        `Property '${node.name}.${p.name}' is required, which LadybugDB cannot enforce: it has no NOT NULL and only the primary key is non-null.`,
        p.loc)
      lines.push(`  // UNENFORCED: '${p.name}' is required in the model; LadybugDB has no NOT NULL.`)
    }
    if (p.unique && !isKey(p)) {
      downgrade(diags, 'ladybug', 'downgrade-unique',
        `Property '${node.name}.${p.name}' is unique, which LadybugDB enforces only for the primary key.`,
        p.loc)
      lines.push(`  // UNENFORCED: '${p.name}' is unique in the model; only the primary key is unique.`)
    }
    lines.push(`  ${p.name} ${TYPES[p.type]},`)
  }
  return lines
}

function nodeTable(node: NodeTypeIR, diags: Diagnostic[]): string {
  const lines = [`CREATE NODE TABLE IF NOT EXISTS ${node.name} (`]
  lines.push(...columnLines(node, diags))

  if (node.key.length === 1) {
    lines.push(`  PRIMARY KEY(${node.key[0]})`)
  } else if (node.key.length > 1) {
    const col = syntheticKeyColumn(node)
    downgrade(diags, 'ladybug', 'downgrade-composite-key',
      `Node type '${node.name}' declares a composite key (${node.key.join(', ')}). LadybugDB does not accept a composite PRIMARY KEY, so column '${col}' is synthesized from those properties and must be populated on write.`,
      node.loc)
    lines.push(`  // SYNTHESIZED: composite key (${node.key.join(', ')}) is not expressible;`)
    lines.push(`  // '${col}' must be written as the concatenation of those properties.`)
    lines.push(`  ${col} STRING,`)
    lines.push(`  PRIMARY KEY(${col})`)
  }
  lines.push(');')
  return lines.join('\n')
}

function endpointPairs(model: ModelIR, edge: EdgeTypeIR, diags: Diagnostic[]): string[] {
  const from = concreteDescendants(model, edge.from)
  const to = concreteDescendants(model, edge.to)
  if (from.length === 0 || to.length === 0) {
    downgrade(diags, 'ladybug', 'no-concrete-endpoint',
      `Edge type '${edge.name}' connects '${edge.from}' to '${edge.to}', but one side has no concrete node type, so no relationship table can be created.`,
      edge.loc)
    return []
  }
  const pairs: string[] = []
  for (const f of from) for (const t of to) pairs.push(`FROM ${f.name} TO ${t.name}`)
  return pairs
}

function relTable(model: ModelIR, edge: EdgeTypeIR, diags: Diagnostic[]): string | undefined {
  const pairs = endpointPairs(model, edge, diags)
  if (pairs.length === 0) return undefined

  const lines = [`CREATE REL TABLE IF NOT EXISTS ${edge.name} (`]
  if (pairs.length > 1) {
    lines.push(`  // '${edge.from}' and/or '${edge.to}' are abstract; expanded to ${pairs.length} endpoint pairs.`)
  }
  lines.push(...pairs.map((p) => `  ${p},`))
  for (const p of edge.props) {
    if (p.required) {
      downgrade(diags, 'ladybug', 'downgrade-required',
        `Edge property '${edge.name}.${p.name}' is required, which LadybugDB cannot enforce on a relationship table.`,
        p.loc)
      lines.push(`  // UNENFORCED: '${p.name}' is required in the model.`)
    }
    lines.push(`  ${p.name} ${TYPES[p.type]},`)
  }
  const last = lines.length - 1
  lines[last] = (lines[last] ?? '').replace(/,$/, '')
  lines.push(');')
  return lines.join('\n')
}

export function emitLadybug(model: ModelIR, _options: EmitOptions = {}): EmitResult {
  const diagnostics: Diagnostic[] = []
  const parts: string[] = [
    '// Generated by lpg-modeler. Target: ladybug (LadybugDB).',
    `// Model: ${model.namespace.prefix} <${model.namespace.iri}>`,
    '//',
    '// Abstract node types are flattened to one table per concrete type, with',
    '// inherited properties copied down. See lat.md/emitters#Ladybug Target.',
    '',
  ]

  const abstracts = model.nodes.filter((n) => n.abstract)
  if (abstracts.length > 0) {
    parts.push(`// Abstract, no table emitted: ${abstracts.map((a) => a.name).join(', ')}`, '')
  }

  for (const node of concreteNodes(model)) {
    parts.push(nodeTable(node, diagnostics), '')
  }
  for (const edge of model.edges) {
    const t = relTable(model, edge, diagnostics)
    if (t) parts.push(t, '')
  }

  return { target: 'ladybug', extension: 'cypher', content: parts.join('\n'), diagnostics }
}
