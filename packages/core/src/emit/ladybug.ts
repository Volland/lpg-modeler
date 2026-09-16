import type {
  Cardinality, Diagnostic, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR, ScalarType,
} from '../ir'
import {
  describeCardinality, endpointIsSingular, formatValueType, isUnconstrained, typeParams,
} from '../ir'
import { concreteDescendants, concreteNodes } from '../ir'
import {
  downgrade, reportUnsupportedConstraints,
  type Capabilities, type EmitOptions, type EmitResult,
} from '../capabilities'

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
  valueConstraints: 'unsupported',
  namedConstraints: 'unsupported',
  rawPassthrough: false,
  listProps: 'native',
  // STRUCT, MAP, UNION and the fixed-size ARRAY are LadybugDB's own composites, so the
  // whole nested type reaches a column unchanged. No other target has any of them.
  compositeTypes: 'native',
  // Measured against LadybugDB 0.19.1: rel multiplicity is rejected on write, unlike
  // NOT NULL. The schema is mandatory and closed, and there is no enum type.
  enums: 'unsupported',
  openTypes: 'unsupported',
  // The multiplicity keyword says only that an end holds at most one. A minimum or an
  // exact count has no spelling, so claiming 'enforced' here would overstate it.
  cardinality: 'upper-bound-only',
}

/**
 * Every scalar this metamodel has is a LadybugDB type: the widths, the unsigned
 * variants, DECIMAL, INTERVAL, BLOB and JSON are all stored natively, so nothing here
 * is a downgrade. Verified against 0.19.1. See lat.md/metamodel#Scalar Types.
 */
const TYPES: Record<ScalarType, string> = {
  string: 'STRING',
  int8: 'INT8', int16: 'INT16', int32: 'INT32', int: 'INT64', int128: 'INT128',
  uint8: 'UINT8', uint16: 'UINT16', uint32: 'UINT32', uint64: 'UINT64',
  float32: 'FLOAT', float: 'DOUBLE', decimal: 'DECIMAL',
  boolean: 'BOOL',
  date: 'DATE', datetime: 'TIMESTAMP', zoneddatetime: 'TIMESTAMP_TZ', duration: 'INTERVAL',
  uuid: 'UUID', blob: 'BLOB', json: 'JSON',
}

/**
 * LadybugDB spells multiplicity as a trailing keyword, and it encodes only the upper
 * bound of each end: there is no way to say a minimum or an exact count. The keyword
 * is emitted whenever an end is bounded at one, and whatever it cannot carry is
 * reported rather than dropped.
 */
export function multiplicity(c: Cardinality): string | undefined {
  const { from, to } = endpointIsSingular(c)
  if (from && to) return 'ONE_ONE'
  if (from) return 'ONE_MANY'
  if (to) return 'MANY_ONE'
  return undefined
}

/** The part of a bound the keyword cannot express: any minimum, any maximum above one. */
function unexpressible(c: Cardinality): string[] {
  const out: string[] = []
  for (const end of ['from', 'to'] as const) {
    const b = c[end]
    if (b.min > 0) out.push(`a minimum of ${b.min} on '${end}'`)
    if (b.max !== null && b.max > 1) out.push(`a maximum of ${b.max} on '${end}'`)
  }
  return out
}

/**
 * A column type, with the `[]` suffix LadybugDB uses for a list. A composite is spelled
 * out whole — the target's own syntax is what the metamodel borrowed.
 */
export const columnType = (p: PropertyIR) => (p.composite
  ? formatValueType(p.composite, (s) => TYPES[s])
  : `${TYPES[p.type]}${typeParams(p)}${p.list ? '[]' : ''}`)

/** Column name for a synthesized composite key. */
export function syntheticKeyColumn(node: NodeTypeIR): string {
  return `${node.name.toLowerCase()}_key`
}

/**
 * What a column cannot carry, as comment lines and diagnostics. Shared with the
 * migration planner, so a column added later says exactly what it would have said had
 * it been there from the start. `indent` differs because a migration's ALTER is not
 * inside a parenthesised table body.
 */
export function columnNotes(
  owner: string, p: PropertyIR, isKey: boolean, diags: Diagnostic[], indent: string,
): string[] {
  const lines: string[] = []
  if (p.required && !isKey) {
    downgrade(diags, 'ladybug', 'downgrade-required',
      `Property '${owner}.${p.name}' is required, which LadybugDB cannot enforce: it has no NOT NULL and only the primary key is non-null.`,
      p.loc)
    lines.push(`${indent}// UNENFORCED: '${p.name}' is required in the model; LadybugDB has no NOT NULL.`)
  }
  if (p.unique && !isKey) {
    downgrade(diags, 'ladybug', 'downgrade-unique',
      `Property '${owner}.${p.name}' is unique, which LadybugDB enforces only for the primary key.`,
      p.loc)
    lines.push(`${indent}// UNENFORCED: '${p.name}' is unique in the model; only the primary key is unique.`)
  }
  if (p.enum) {
    downgrade(diags, 'ladybug', 'downgrade-enum',
      `Property '${owner}.${p.name}' is constrained to enum '${p.enum}', which LadybugDB has no column type for. Stored as ${columnType(p)} with the value set unenforced.`,
      p.loc)
    lines.push(`${indent}// UNENFORCED: '${p.name}' is limited to enum '${p.enum}' in the model.`)
  }
  return lines
}

/** The same for an edge property, where uniqueness was never claimed on a rel table. */
export function edgeColumnNotes(
  edge: string, p: PropertyIR, diags: Diagnostic[], indent: string,
): string[] {
  const lines: string[] = []
  if (p.required) {
    downgrade(diags, 'ladybug', 'downgrade-required',
      `Edge property '${edge}.${p.name}' is required, which LadybugDB cannot enforce on a relationship table.`,
      p.loc)
    lines.push(`${indent}// UNENFORCED: '${p.name}' is required in the model.`)
  }
  if (p.enum) {
    downgrade(diags, 'ladybug', 'downgrade-enum',
      `Edge property '${edge}.${p.name}' is constrained to enum '${p.enum}', which LadybugDB has no column type for.`,
      p.loc)
    lines.push(`${indent}// UNENFORCED: '${p.name}' is limited to enum '${p.enum}' in the model.`)
  }
  return lines
}

function columnLines(node: NodeTypeIR, diags: Diagnostic[]): string[] {
  const lines: string[] = []
  for (const p of node.props) {
    lines.push(...columnNotes(node.name, p, isSingleKey(node, p), diags, '  '))
    lines.push(`  ${p.name} ${columnType(p)},`)
  }
  return lines
}

/** Whether this property is the whole key, which is the only column LadybugDB enforces. */
export const isSingleKey = (node: NodeTypeIR, p: PropertyIR): boolean =>
  node.key.length === 1 && node.key[0] === p.name

export function nodeTable(node: NodeTypeIR, diags: Diagnostic[]): string {
  const lines = [`CREATE NODE TABLE IF NOT EXISTS ${node.name} (`]
  if (node.open) {
    downgrade(diags, 'ladybug', 'downgrade-open',
      `Node type '${node.name}' is open, but LadybugDB has a mandatory closed schema: a property the table does not declare cannot be written at all.`,
      node.loc)
    lines.push(`  // DOWNGRADE: '${node.name}' is open in the model; this table is closed.`)
  }
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

/**
 * Every concrete endpoint pair an edge expands to, as node types. The migration planner
 * needs the pairs without the diagnostic the emitter raises for an edge that has none.
 */
export function endpointNodePairs(model: ModelIR, edge: EdgeTypeIR): Array<[NodeTypeIR, NodeTypeIR]> {
  const out: Array<[NodeTypeIR, NodeTypeIR]> = []
  for (const f of concreteDescendants(model, edge.from)) {
    for (const t of concreteDescendants(model, edge.to)) out.push([f, t])
  }
  return out
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
  return endpointNodePairs(model, edge).map(([f, t]) => `FROM ${f.name} TO ${t.name}`)
}

export function relTable(model: ModelIR, edge: EdgeTypeIR, diags: Diagnostic[]): string | undefined {
  const pairs = endpointPairs(model, edge, diags)
  if (pairs.length === 0) return undefined

  const lines = [`CREATE REL TABLE IF NOT EXISTS ${edge.name} (`]
  if (pairs.length > 1) {
    lines.push(`  // '${edge.from}' and/or '${edge.to}' are abstract; expanded to ${pairs.length} endpoint pairs.`)
  }
  lines.push(...pairs.map((p) => `  ${p},`))
  for (const p of edge.props) {
    lines.push(...edgeColumnNotes(edge.name, p, diags, '  '))
    lines.push(`  ${p.name} ${columnType(p)},`)
  }

  // Multiplicity is a trailing keyword inside the parentheses, and it is one of the
  // few things LadybugDB really does reject on write.
  const keyword = multiplicity(edge.cardinality)
  const described = describeCardinality(edge.cardinality)
  if (keyword) {
    lines.push(`  // ${described}: enforced on write.`)
    lines.push(`  ${keyword},`)
  }
  const lost = unexpressible(edge.cardinality)
  if (lost.length > 0) {
    downgrade(diags, 'ladybug', 'downgrade-cardinality',
      `Edge type '${edge.name}' declares ${described} cardinality. LadybugDB multiplicity encodes only an upper bound of one per end, so ${lost.join(' and ')} ${lost.length > 1 ? 'are' : 'is'} unenforced.`,
      edge.loc)
    lines.push(`  // UNENFORCED: ${lost.join(' and ')}.`)
  } else if (!keyword && !isUnconstrained(edge.cardinality)) {
    lines.push(`  // ${described}: nothing to enforce.`)
  }

  // The separator belongs to the last real entry, not to a trailing comment: a comma
  // before the closing parenthesis is a parse error.
  const last = lines.map((l) => l.trim().startsWith('//')).lastIndexOf(false)
  if (last >= 0) lines[last] = (lines[last] ?? '').replace(/,$/, '')
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

  reportUnsupportedConstraints(diagnostics, 'ladybug', model, LADYBUG_CAPABILITIES)

  return { target: 'ladybug', extension: 'cypher', content: parts.join('\n'), diagnostics }
}
