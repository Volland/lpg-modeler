import {
  err, info, warn,
  type Diagnostic, type EdgeTypeIR, type NodeTypeIR, type PropertyIR, type ScalarType,
} from '../ir'
import { deriveId } from '../ids'
import { inferHierarchy, nearestCommon, specific } from './labels'
import type { ImportResult } from './rdf'

/**
 * Reads a running FalkorDB's schema back into a model. Constraints and indexes have a
 * catalogue; labels, properties and endpoints do not, so those come from bounded
 * sampling queries. Measured against FalkorDB 4.20.4.
 * See lat.md/importers#Reading a FalkorDB Instance.
 */

export interface FalkorConstraint {
  kind: 'unique' | 'mandatory'
  entity: 'node' | 'relationship'
  label: string
  properties: string[]
  /** `OPERATIONAL`, `PENDING` or `FAILED`: only the first is enforcing anything. */
  status: string
}

export interface FalkorIndex {
  entity: 'node' | 'relationship'
  label: string
  properties: string[]
}

export interface FalkorObservedProperty {
  key: string
  /** A value type as `typeOf()` spells it: `String`, `Integer`, `List`. */
  type: string
}

export interface FalkorCatalog {
  graphKey: string
  constraints: FalkorConstraint[]
  indexes: FalkorIndex[]
  nodes: Array<{ labels: string[]; properties: FalkorObservedProperty[] }>
  edges: Array<{ type: string; from: string[]; to: string[] }>
  edgeProperties: Array<{ type: string; key: string; valueType: string }>
  /** What the sample could not reach: a count beyond the bound, per entity kind. */
  truncated?: { nodes?: number; edges?: number }
}

/** A connected Redis client, as far as reading a graph needs: argv in, reply out. */
export interface FalkorClient {
  sendCommand(args: string[]): Promise<unknown>
}

export interface FalkorImportInput {
  path: string
  falkorCatalog: FalkorCatalog
}

/**
 * How many nodes and relationships a sampling query may read. A schema read should not
 * scan a production graph, and what the bound cuts off is reported rather than hidden.
 */
export const SAMPLE_LIMIT = 1000

/**
 * FalkorDB returns a list inside a scalar column as text: `[Person, Party]`, `[email]`,
 * `[]`. Nothing else spells a value that way, and the members are simple identifiers
 * here -- a label and a property name -- so this is exact for what it is used on.
 */
export function parseList(value: unknown): string[] {
  const text = String(value ?? '').trim()
  if (!text.startsWith('[') || !text.endsWith(']')) return text ? [text] : []
  const inner = text.slice(1, -1).trim()
  return inner === '' ? [] : inner.split(',').map((s) => s.trim()).filter(Boolean)
}

/** A `typeOf()` answer as a scalar. FalkorDB stores one integer width and one float. */
const FROM_OBSERVED: Record<string, { type: ScalarType; list?: boolean }> = {
  String: { type: 'string' },
  Integer: { type: 'int' },
  Double: { type: 'float' },
  Float: { type: 'float' },
  Boolean: { type: 'boolean' },
  Map: { type: 'json' },
  Point: { type: 'string' },
  List: { type: 'string', list: true },
}

/** A GRAPH.QUERY reply: a header row, the data rows, then the statistics. */
type QueryReply = [unknown[], unknown[][], unknown[]]

const rowsOf = (reply: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(reply) || reply.length < 2) return []
  const [header, data] = reply as QueryReply
  const names = (header ?? []).map(String)
  return (data ?? []).map((row) =>
    Object.fromEntries(names.map((n, i) => [n, (row as unknown[])[i]])))
}

/**
 * Reads a graph's schema through a client the caller connected; `core` never loads one.
 * Every read is a `GRAPH.RO_QUERY`, which the server refuses to run a write through and
 * which refuses a graph key that does not exist -- where a plain `GRAPH.QUERY` would
 * create that key, so a mistyped name would leave an empty graph behind and report a
 * schema with nothing in it. Never throws.
 */
export async function readFalkorSchema(
  client: FalkorClient, graphKey?: string,
): Promise<{ catalog?: FalkorCatalog; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = []

  let keys: string[]
  try {
    const listed = await client.sendCommand(['GRAPH.LIST'])
    keys = Array.isArray(listed) ? listed.map(String) : []
  } catch (e) {
    diagnostics.push(err('import-catalog', `FalkorDB refused 'GRAPH.LIST': ${(e as Error).message}`))
    return { diagnostics }
  }

  let key = graphKey
  if (!key) {
    if (keys.length === 1) {
      key = keys[0]!
      diagnostics.push(info('import-graph-key', `The server holds one graph, '${key}', so that is the one read.`))
    } else {
      diagnostics.push(err('import-no-graph', keys.length === 0
        ? 'The server holds no graph, so there is no schema to read.'
        : `The server holds ${keys.length} graphs (${keys.sort().join(', ')}). Name the one to read with --graph-key.`))
      return { diagnostics }
    }
  } else if (!keys.includes(key)) {
    diagnostics.push(err('import-no-graph',
      `The server holds no graph under the key '${key}'; it holds ${keys.length === 0 ? 'none' : keys.sort().join(', ')}. Nothing was read, and no graph was created.`))
    return { diagnostics }
  }

  const catalog: FalkorCatalog = {
    graphKey: key, constraints: [], indexes: [], nodes: [], edges: [], edgeProperties: [],
  }
  const query = async (cypher: string): Promise<Array<Record<string, unknown>> | undefined> => {
    try {
      return rowsOf(await client.sendCommand(['GRAPH.RO_QUERY', key!, cypher]))
    } catch (e) {
      diagnostics.push(err('import-catalog', `FalkorDB refused '${cypher}': ${(e as Error).message}`))
      return undefined
    }
  }

  for (const c of await query('CALL db.constraints()') ?? []) {
    const type = String(c.type).toUpperCase()
    catalog.constraints.push({
      kind: type === 'UNIQUE' ? 'unique' : 'mandatory',
      entity: String(c.entitytype).toUpperCase() === 'RELATIONSHIP' ? 'relationship' : 'node',
      label: String(c.label),
      properties: parseList(c.properties),
      status: String(c.status ?? '').toUpperCase(),
    })
  }
  for (const i of await query('CALL db.indexes()') ?? []) {
    catalog.indexes.push({
      entity: String(i.entitytype).toUpperCase() === 'RELATIONSHIP' ? 'relationship' : 'node',
      label: String(i.label),
      properties: parseList(i.properties),
    })
  }

  const counts = (await query('MATCH (n) RETURN count(n) AS nodes'))?.[0]
  const edgeCounts = (await query('MATCH ()-[r]->() RETURN count(r) AS edges'))?.[0]
  const nodeTotal = Number(counts?.nodes ?? 0)
  const edgeTotal = Number(edgeCounts?.edges ?? 0)
  if (nodeTotal > SAMPLE_LIMIT) catalog.truncated = { ...catalog.truncated, nodes: nodeTotal }
  if (edgeTotal > SAMPLE_LIMIT) catalog.truncated = { ...catalog.truncated, edges: edgeTotal }

  const sets = new Map<string, { labels: string[]; properties: FalkorObservedProperty[] }>()
  for (const row of await query(`MATCH (n) WITH n LIMIT ${SAMPLE_LIMIT} RETURN DISTINCT labels(n) AS labels`) ?? []) {
    const labels = parseList(row.labels)
    sets.set(labels.join('\u0000'), { labels, properties: [] })
  }
  for (const row of await query(
    `MATCH (n) WITH n LIMIT ${SAMPLE_LIMIT} UNWIND keys(n) AS k RETURN DISTINCT labels(n) AS labels, k, typeOf(n[k]) AS t`,
  ) ?? []) {
    const labels = parseList(row.labels)
    const entry = sets.get(labels.join('\u0000')) ?? { labels, properties: [] }
    entry.properties.push({ key: String(row.k), type: String(row.t) })
    sets.set(labels.join('\u0000'), entry)
  }
  catalog.nodes = [...sets.values()]

  for (const row of await query(
    `MATCH (a)-[r]->(b) WITH a, r, b LIMIT ${SAMPLE_LIMIT} RETURN DISTINCT type(r) AS t, labels(a) AS f, labels(b) AS o`,
  ) ?? []) {
    catalog.edges.push({ type: String(row.t), from: parseList(row.f), to: parseList(row.o) })
  }
  for (const row of await query(
    `MATCH ()-[r]->() WITH r LIMIT ${SAMPLE_LIMIT} UNWIND keys(r) AS k RETURN DISTINCT type(r) AS t, k, typeOf(r[k]) AS ty`,
  ) ?? []) {
    catalog.edgeProperties.push({ type: String(row.t), key: String(row.k), valueType: String(row.ty) })
  }

  return { catalog, diagnostics }
}

export function falkorCatalogToModel(catalog: FalkorCatalog, file: string): ImportResult {
  const diagnostics: Diagnostic[] = []

  // A constraint that is not operational is not enforcing anything: one the stored data
  // violates settles FAILED and is never applied. Reading it would put a key in the
  // model the database is not keeping.
  const enforcing = catalog.constraints.filter((c) => c.status === 'OPERATIONAL')
  for (const c of catalog.constraints.filter((c) => c.status !== 'OPERATIONAL')) {
    diagnostics.push(warn('import-constraint-failed',
      `The ${c.kind} constraint on ${c.label}(${c.properties.join(', ')}) is ${c.status || 'not operational'}, so it is not enforcing anything and was not imported.`))
  }

  const sets = catalog.nodes.map((n) => n.labels).filter((s) => s.length > 0)
  const nodeConstraints = enforcing.filter((c) => c.entity === 'node')
  const labels = [...new Set([...nodeConstraints.map((c) => c.label), ...sets.flat()])].filter(Boolean).sort()
  const { parent, abstract, ancestors } = inferHierarchy(sets, labels, diagnostics)

  const nodes: NodeTypeIR[] = labels.map((label) => ({
    id: deriveId('node', label), name: label, qname: label, iri: label, prefix: '',
    abstract: abstract.has(label), open: false, ancestors: [], mixins: [], key: [], props: [], constraints: [],
    ...(parent.get(label) ? { extends: parent.get(label)! } : {}),
  }))
  const byLabel = new Map(nodes.map((n) => [n.name, n]))
  const propOf = (owner: { name: string; props: PropertyIR[] }, key: string): PropertyIR => {
    let p = owner.props.find((x) => x.name === key)
    if (!p) {
      p = { id: deriveId('prop', key, owner.name), name: key, type: 'string', list: false, required: false, unique: false }
      owner.props.push(p)
    }
    return p
  }

  const mandatory = new Set(nodeConstraints
    .filter((c) => c.kind === 'mandatory')
    .map((c) => `${c.label}.${c.properties[0]}`))
  for (const c of nodeConstraints) {
    const node = byLabel.get(c.label)
    if (!node) continue
    if (c.kind === 'mandatory') propOf(node, c.properties[0]!).required = true
  }

  for (const node of nodes) {
    // The generator writes a key as UNIQUE plus MANDATORY on each part, with the index
    // the unique constraint needs; that is what tells a key from another unique property.
    // FalkorDB keeps a label's indexed properties in the order they were indexed, and
    // the generator indexes the key first, so the earliest-indexed candidate is the key.
    // That is creation order, not a declaration, so the choice is reported.
    const indexOrder = catalog.indexes
      .filter((i) => i.entity === 'node' && i.label === node.name)
      .flatMap((i) => i.properties)
    const rank = (c: FalkorConstraint) => {
      const positions = c.properties.map((p) => indexOrder.indexOf(p))
      return positions.some((x) => x < 0) ? Number.MAX_SAFE_INTEGER : Math.min(...positions)
    }
    const candidates = nodeConstraints
      .filter((c) => c.kind === 'unique' && c.label === node.name
        && c.properties.every((p) => mandatory.has(`${node.name}.${p}`)))
      .sort((a, b) => rank(a) - rank(b)
        || a.properties.length - b.properties.length || a.properties.join().localeCompare(b.properties.join()))
    const key = candidates[0]
    if (key) {
      node.key = [...key.properties]
      for (const k of key.properties) propOf(node, k).required = true
      if (candidates.length > 1) {
        diagnostics.push(info('import-key-chosen',
          `'${node.name}' has ${candidates.length} unique, mandatory constraints; (${key.properties.join(', ')}) is taken as the key.`))
      }
    }
    for (const c of nodeConstraints.filter((x) => x.kind === 'unique' && x.label === node.name && x !== key)) {
      if (c.properties.length === 1) { propOf(node, c.properties[0]!).unique = true; continue }
      diagnostics.push(warn('import-composite-unique',
        `'${node.name}' asserts (${c.properties.join(', ')}) unique together, which the model can say only of a key. It was not imported.`))
    }
  }

  const observedType = (owner: string, p: PropertyIR, type: string) => {
    const mapped = FROM_OBSERVED[type]
    if (!mapped) {
      diagnostics.push(warn('import-type',
        `'${owner}.${p.name}' holds ${type} values, which this metamodel has no type for. It is read as string.`))
      return
    }
    p.type = mapped.type
    p.list = mapped.list ?? false
    if (mapped.list) {
      diagnostics.push(info('import-type-partial',
        `'${owner}.${p.name}' is a list, whose element type FalkorDB does not record, so it is read as a list of strings.`))
    }
  }
  for (const n of catalog.nodes) {
    for (const label of specific(n.labels, ancestors)) {
      const node = byLabel.get(label)
      if (!node) continue
      for (const prop of n.properties) {
        if (n.labels.some((a) => (ancestors.get(label) ?? []).includes(a) && byLabel.get(a)?.props.some((x) => x.name === prop.key))) continue
        const existing = node.props.find((x) => x.name === prop.key)
        observedType(label, propOf(node, prop.key), prop.type)
        if (existing) continue
      }
    }
  }

  const edges: EdgeTypeIR[] = []
  const relConstraints = enforcing.filter((c) => c.entity === 'relationship')
  const edgeTypes = [...new Set([
    ...catalog.edges.map((e) => e.type),
    ...relConstraints.map((c) => c.label),
  ])].sort()
  for (const type of edgeTypes) {
    const seen = catalog.edges.filter((e) => e.type === type)
    if (seen.length === 0) {
      diagnostics.push(warn('import-endpoints',
        `Edge type '${type}' has a constraint but no relationship was sampled, so there is nothing to say which types it joins; it was not imported.`))
      continue
    }
    const froms = specific([...new Set(seen.flatMap((e) => specific(e.from, ancestors)))], ancestors)
    const tos = specific([...new Set(seen.flatMap((e) => specific(e.to, ancestors)))], ancestors)
    const from = nearestCommon(froms, ancestors)
    const to = nearestCommon(tos, ancestors)
    if (!from || !to) {
      diagnostics.push(warn('import-endpoints',
        `Edge type '${type}' joins labels (${froms.join(', ')}) to (${tos.join(', ')}) with no common type on ${!from ? 'the start' : 'the end'}; it was not imported.`))
      continue
    }
    if (froms.length > 1 || tos.length > 1) {
      diagnostics.push(info('import-collapsed', `Edge type '${type}' is seen between several labels; it is read as (${from})->(${to}).`))
    }
    const edge: EdgeTypeIR = {
      id: deriveId('edge', type), name: type, qname: type, iri: type, prefix: '', from, to, props: [],
      cardinality: { from: { min: 0, max: null }, to: { min: 0, max: null } },
    }
    for (const prop of catalog.edgeProperties.filter((p) => p.type === type)) {
      observedType(type, propOf(edge, prop.key), prop.valueType)
    }
    for (const c of relConstraints.filter((x) => x.label === type)) {
      if (c.kind === 'mandatory') propOf(edge, c.properties[0]!).required = true
      if (c.kind === 'unique' && c.properties.length === 1) propOf(edge, c.properties[0]!).unique = true
    }
    edges.push(edge)
  }

  const keyed = (label: string): boolean => {
    const n = byLabel.get(label)
    return !!n && (n.key.length > 0 || (!!n.extends && keyed(n.extends)))
  }
  for (const node of nodes) {
    if (!node.abstract && node.key.length === 0 && !(node.extends && keyed(node.extends))) {
      diagnostics.push(warn('import-no-key',
        `'${node.name}' has no unique, mandatory constraint, so it has no key. Declare one before the model validates.`))
    }
  }

  if (catalog.truncated?.nodes || catalog.truncated?.edges) {
    const parts = [
      catalog.truncated.nodes ? `${catalog.truncated.nodes} nodes` : '',
      catalog.truncated.edges ? `${catalog.truncated.edges} relationships` : '',
    ].filter(Boolean)
    diagnostics.push(warn('import-sampled',
      `FalkorDB has no catalogue of labels, properties or endpoints, so they were read from the first ${SAMPLE_LIMIT} of ${parts.join(' and ')}. A type or an endpoint pair beyond that is missing from this model.`))
  }
  diagnostics.push(info('import-lossy',
    'A FalkorDB schema holds no enums, cardinality, value bounds, named constraints, mixins, integer widths or open/closed types, so none of them is in this model.'))

  return {
    model: {
      file,
      namespace: { prefix: 'model', iri: 'https://example.org/imported#' },
      prefixes: {}, nodes, edges, mixins: [], enums: [],
    },
    diagnostics,
  }
}

export function importFalkor(inputs: FalkorImportInput[]): ImportResult {
  const blank = (file: string) => ({
    file,
    namespace: { prefix: 'model', iri: 'https://example.org/imported#' },
    prefixes: {}, nodes: [], edges: [], mixins: [], enums: [],
  })
  if (inputs.length > 1) {
    return {
      model: blank(inputs[0]!.path),
      diagnostics: [err('import-mixed-sources', 'Only one FalkorDB graph can be imported at a time.')],
    }
  }
  const only = inputs[0]
  if (!only) return { model: blank(''), diagnostics: [] }
  return falkorCatalogToModel(only.falkorCatalog, only.path)
}
