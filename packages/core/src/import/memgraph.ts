import {
  err, info, warn,
  type Diagnostic, type EdgeTypeIR, type EnumIR, type NodeTypeIR, type PropertyIR, type ScalarType,
} from '../ir'
import { deriveId } from '../ids'
import type { ImportResult } from './rdf'

/**
 * Reads a running Memgraph's schema back into a model. Constraints, indexes and enums are
 * always readable; the structure of the data -- which labels occur together, which
 * properties a label carries, which edge types join which labels -- only when the server
 * runs with `--schema-info-enabled`. Measured against Memgraph 3.13.1.
 * See lat.md/importers#Reading a Memgraph Instance.
 */

export interface MemgraphConstraint {
  kind: 'unique' | 'exists' | 'typed'
  label: string
  properties: string[]
  /** For `typed`: the keyword that creates it, e.g. `LOCALDATETIME`. */
  dataType?: string
}

export interface MemgraphObservedProperty {
  key: string
  /** Observed value types and how many values had each, e.g. `Integer`, `Enum::Status`. */
  types: Array<{ type: string; count: number }>
}

export interface MemgraphCatalog {
  constraints: MemgraphConstraint[]
  /** Label and property indexes, as `label` plus the indexed properties in order. */
  indexes: Array<{ label: string; properties: string[] }>
  enums: Array<{ name: string; values: string[] }>
  /** Absent when the server does not expose schema information. */
  structure?: {
    nodes: Array<{ labels: string[]; count: number; properties: MemgraphObservedProperty[] }>
    edges: Array<{ type: string; from: string[]; to: string[]; properties: MemgraphObservedProperty[] }>
  }
}

/** A running Memgraph, as far as reading its schema needs: one statement in, plain rows out. */
export interface MemgraphSession {
  run(statement: string): Promise<Array<Record<string, unknown>>>
}

/** A read instance standing in for a file in an import. */
export interface MemgraphImportInput {
  path: string
  memgraphCatalog: MemgraphCatalog
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === null || v === undefined ? [] : [String(v)])

/**
 * `SHOW CONSTRAINT INFO` spells four types differently from the syntax that creates them
 * (measured): `BOOL`, `LOCAL DATE TIME`, `LOCAL TIME`, `ZONED DATE TIME`.
 */
export const typeKeyword = (reported: string): string =>
  (reported === 'BOOL' ? 'BOOLEAN' : reported.replace(/ /g, ''))

const observed = (props: unknown): MemgraphObservedProperty[] => (Array.isArray(props) ? props : []).map((p) => ({
  key: String((p as Record<string, unknown>).key),
  types: (Array.isArray((p as Record<string, unknown>).types) ? (p as { types: unknown[] }).types : [])
    .map((t) => ({ type: String((t as Record<string, unknown>).type), count: Number((t as Record<string, unknown>).count ?? 0) })),
}))

/**
 * Reads an instance's schema through a session the caller opened; `core` never loads a
 * driver. Never throws: a query the engine refuses is an `import-catalog` error, except
 * schema information being switched off, which is expected and only narrows the import.
 */
export async function readMemgraphSchema(
  session: MemgraphSession,
): Promise<{ catalog: MemgraphCatalog; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = []
  const catalog: MemgraphCatalog = { constraints: [], indexes: [], enums: [] }
  const rows = async (statement: string, required: string[]) => {
    try {
      const all = await session.run(statement)
      const missing = all.length > 0 ? required.filter((k) => !(k in (all[0] as object))) : []
      if (missing.length > 0) {
        diagnostics.push(err('import-catalog',
          `'${statement}' returned no '${missing.join("', '")}' column. This Memgraph names its schema differently from the 3.13.1 this reader was measured against.`))
        return undefined
      }
      return all
    } catch (e) {
      const message = (e as Error).message
      if (statement === 'SHOW SCHEMA INFO' && /SchemaInfo query is disabled/i.test(message)) {
        diagnostics.push(info('import-schema-info-disabled',
          'The server does not expose schema information, so only constraints and enums were read: edge types, labels without a constraint, and unconstrained properties are missing. Start Memgraph with --schema-info-enabled=true to read them.'))
      } else {
        diagnostics.push(err('import-catalog', `Memgraph refused '${statement}': ${message}`))
      }
      return undefined
    }
  }

  for (const c of await rows('SHOW CONSTRAINT INFO', ['constraint type', 'label', 'properties', 'data_type']) ?? []) {
    const type = String(c['constraint type'])
    catalog.constraints.push({
      kind: type === 'unique' ? 'unique' : type === 'exists' ? 'exists' : 'typed',
      label: String(c.label),
      properties: asList(c.properties),
      ...(type === 'data_type' ? { dataType: typeKeyword(String(c.data_type)) } : {}),
    })
  }
  for (const i of await rows('SHOW INDEX INFO', ['index type', 'label', 'property']) ?? []) {
    if (i['index type'] === 'label+property') catalog.indexes.push({ label: String(i.label), properties: asList(i.property) })
  }
  for (const e of await rows('SHOW ENUMS', ['Enum Name', 'Enum Values']) ?? []) {
    catalog.enums.push({ name: String(e['Enum Name']), values: asList(e['Enum Values']) })
  }
  const schema = await rows('SHOW SCHEMA INFO', ['schema'])
  if (schema?.[0]) {
    try {
      const parsed = JSON.parse(String(schema[0].schema)) as { nodes?: unknown[]; edges?: unknown[] }
      catalog.structure = {
        nodes: (parsed.nodes ?? []).map((n) => {
          const r = n as Record<string, unknown>
          return { labels: asList(r.labels), count: Number(r.count ?? 0), properties: observed(r.properties) }
        }),
        edges: (parsed.edges ?? []).map((x) => {
          const r = x as Record<string, unknown>
          return { type: String(r.type), from: asList(r.start_node_labels), to: asList(r.end_node_labels), properties: observed(r.properties) }
        }),
      }
    } catch (e) {
      diagnostics.push(err('import-catalog', `SHOW SCHEMA INFO returned something other than JSON: ${(e as Error).message}`))
    }
  }
  return { catalog, diagnostics }
}

/** A type constraint's keyword as a scalar, and what the keyword does not say. */
const FROM_KEYWORD: Record<string, { type?: ScalarType; list?: boolean; lost?: string }> = {
  STRING: { type: 'string' },
  INTEGER: { type: 'int', lost: 'Memgraph records no integer width, so it is read as a 64-bit int' },
  FLOAT: { type: 'float', lost: 'Memgraph records no float precision, so it is read as a 64-bit float' },
  BOOLEAN: { type: 'boolean' },
  DATE: { type: 'date' },
  LOCALDATETIME: { type: 'datetime' },
  ZONEDDATETIME: { type: 'zoneddatetime' },
  DURATION: { type: 'duration' },
  LIST: { type: 'string', list: true, lost: 'Memgraph records no element type for a list, so it is read as a list of strings' },
  MAP: { type: 'json', lost: 'a map has no fields recorded, so it is read as json' },
  ENUM: { type: 'string', lost: 'the constraint names no specific enum' },
}

/** An observed value type (`Integer`, `Enum::Status`) in the same terms. */
function fromObserved(type: string): { type?: ScalarType; list?: boolean; enum?: string } {
  if (type.startsWith('Enum::')) return { type: 'string', enum: type.slice('Enum::'.length) }
  const keyword = { String: 'STRING', Integer: 'INTEGER', Float: 'FLOAT', Boolean: 'BOOLEAN', Date: 'DATE',
    LocalDateTime: 'LOCALDATETIME', ZonedDateTime: 'ZONEDDATETIME', Duration: 'DURATION', List: 'LIST', Map: 'MAP' }[type]
  const mapped = keyword ? FROM_KEYWORD[keyword] : undefined
  return mapped ? { type: mapped.type, list: mapped.list } : {}
}

/**
 * Label X is an ancestor of Y when every observed label set holding Y also holds X, and
 * some set holds X without Y. A label is abstract when no set is exactly it plus its
 * ancestors. Every inference is reported, because co-occurrence is evidence, not a
 * declaration. See lat.md/importers#Reading a Memgraph Instance.
 */
function inferHierarchy(sets: string[][], labels: string[], diagnostics: Diagnostic[]) {
  const ancestors = new Map<string, string[]>()
  for (const y of labels) {
    const withY = sets.filter((s) => s.includes(y))
    if (withY.length === 0) { ancestors.set(y, []); continue }
    ancestors.set(y, labels.filter((x) => x !== y
      && withY.every((s) => s.includes(x))
      && sets.some((s) => s.includes(x) && !s.includes(y))))
  }
  const parent = new Map<string, string>()
  for (const [y, xs] of ancestors) {
    // The nearest ancestor is the one with the most ancestors of its own.
    const nearest = [...xs].sort((a, b) => (ancestors.get(b)!.length - ancestors.get(a)!.length) || a.localeCompare(b))[0]
    if (nearest) parent.set(y, nearest)
  }
  const abstract = new Set(labels.filter((x) => {
    const own = new Set([x, ...ancestors.get(x)!])
    return sets.some((s) => s.includes(x)) && !sets.some((s) => s.length === own.size && s.every((l) => own.has(l)))
  }))
  for (const [child, p] of [...parent].sort()) {
    diagnostics.push(info('import-hierarchy',
      `'${child}' is read as extending '${p}': every node labelled ${child} is also labelled ${p}, and some ${p} nodes are not ${child}.`))
  }
  for (const x of [...abstract].sort()) {
    diagnostics.push(info('import-abstract',
      `'${x}' is read as abstract: no node carries it without a more specific label.`))
  }
  return { parent, abstract, ancestors }
}

/** The most specific labels of a set: those that are no other label's ancestor in it. */
const specific = (set: string[], ancestors: Map<string, string[]>): string[] =>
  set.filter((l) => !set.some((o) => o !== l && (ancestors.get(o) ?? []).includes(l)))

export function memgraphCatalogToModel(catalog: MemgraphCatalog, file: string): ImportResult {
  const diagnostics: Diagnostic[] = []
  const sets = catalog.structure?.nodes.map((n) => n.labels) ?? []
  const labels = [...new Set([...catalog.constraints.map((c) => c.label), ...sets.flat()])].sort()
  const { parent, abstract, ancestors } = inferHierarchy(sets, labels, diagnostics)
  const enumNames = new Set(catalog.enums.map((e) => e.name))

  const nodes: NodeTypeIR[] = labels.map((label) => ({
    id: deriveId('node', label), name: label, qname: label, iri: label, prefix: '',
    abstract: abstract.has(label), open: false, ancestors: [], mixins: [], key: [], props: [], constraints: [],
    ...(parent.get(label) ? { extends: parent.get(label)! } : {}),
  }))
  const byLabel = new Map(nodes.map((n) => [n.name, n]))
  const propOf = (node: { name: string; props: PropertyIR[] }, key: string): PropertyIR => {
    let p = node.props.find((x) => x.name === key)
    if (!p) {
      p = { id: deriveId('prop', key, node.name), name: key, type: 'string', list: false, required: false, unique: false }
      node.props.push(p)
    }
    return p
  }
  const typed = new Set<string>()

  // Constraints first: they are declarations, and outrank anything observed in the data.
  const exists = new Set(catalog.constraints.filter((c) => c.kind === 'exists').map((c) => `${c.label}.${c.properties[0]}`))
  const widthLost: string[] = []
  for (const c of catalog.constraints) {
    const node = byLabel.get(c.label)!
    if (c.kind === 'exists') propOf(node, c.properties[0]!).required = true
    if (c.kind === 'typed') {
      const p = propOf(node, c.properties[0]!)
      const mapped = FROM_KEYWORD[c.dataType ?? '']
      typed.add(`${c.label}.${p.name}`)
      if (!mapped?.type) {
        diagnostics.push(warn('import-type',
          `'${c.label}.${p.name}' is constrained to ${c.dataType}, which this metamodel has no type for. It is read as string.`))
        continue
      }
      p.type = mapped.type
      if (mapped.list) p.list = true
      if (c.dataType === 'INTEGER' || c.dataType === 'FLOAT') widthLost.push(`${c.label}.${p.name}`)
      else if (mapped.lost && c.dataType !== 'ENUM') diagnostics.push(info('import-type-partial', `'${c.label}.${p.name}': ${mapped.lost}.`))
    }
  }
  for (const node of nodes) {
    // The generator indexes exactly the key's properties, which is what tells the key
    // apart from another unique, present property. Without that, the smallest wins.
    const indexed = (c: MemgraphConstraint) =>
      catalog.indexes.some((i) => i.label === node.name && i.properties.join() === c.properties.join())
    const candidates = catalog.constraints
      .filter((c) => c.kind === 'unique' && c.label === node.name && c.properties.every((p) => exists.has(`${node.name}.${p}`)))
      .sort((a, b) => Number(indexed(b)) - Number(indexed(a))
        || a.properties.length - b.properties.length || a.properties.join().localeCompare(b.properties.join()))
    const key = candidates[0]
    if (key) {
      node.key = [...key.properties]
      for (const k of key.properties) propOf(node, k).required = true
      if (candidates.length > 1 && !(indexed(key) && candidates.filter(indexed).length === 1)) {
        diagnostics.push(info('import-key-chosen',
          `'${node.name}' has ${candidates.length} uniqueness constraints whose properties all exist; (${key.properties.join(', ')}) is taken as the key.`))
      }
    }
    for (const c of catalog.constraints.filter((x) => x.kind === 'unique' && x.label === node.name && x !== key)) {
      if (c.properties.length === 1) { propOf(node, c.properties[0]!).unique = true; continue }
      diagnostics.push(warn('import-composite-unique',
        `'${node.name}' asserts (${c.properties.join(', ')}) unique together, which the model can say only of a key. It was not imported.`))
    }
  }

  // Observed structure: properties go to the most specific label of the set they occur in.
  const observedType = (owner: string, p: PropertyIR, prop: MemgraphObservedProperty) => {
    const ranked = [...prop.types].sort((a, b) => b.count - a.count)
    const top = ranked[0]
    if (!top) return
    const mapped = fromObserved(top.type)
    if (typed.has(`${owner}.${p.name}`)) {
      // A declaration outranks an observation, except that only data says which enum.
      if (mapped.enum && ranked.length === 1 && enumNames.has(mapped.enum)) p.enum = mapped.enum
      return
    }
    if (ranked.length > 1) {
      diagnostics.push(warn('import-ambiguous-type',
        `'${owner}.${p.name}' holds values of ${ranked.map((t) => `${t.type} (${t.count})`).join(', ')}; the commonest, ${top.type}, was taken.`))
    }
    if (!mapped.type) {
      diagnostics.push(warn('import-type', `'${owner}.${p.name}' holds ${top.type} values, which this metamodel has no type for. It is read as string.`))
      return
    }
    p.type = mapped.type
    p.list = mapped.list ?? false
    if (mapped.enum && enumNames.has(mapped.enum)) p.enum = mapped.enum
  }
  for (const n of catalog.structure?.nodes ?? []) {
    for (const label of specific(n.labels, ancestors)) {
      const node = byLabel.get(label)!
      for (const prop of n.properties) {
        // A property already declared on an ancestor is inherited, not redeclared.
        if (n.labels.some((a) => (ancestors.get(label) ?? []).includes(a) && byLabel.get(a)!.props.some((x) => x.name === prop.key))) continue
        observedType(label, propOf(node, prop.key), prop)
      }
    }
  }

  const edges: EdgeTypeIR[] = []
  const nearestCommon = (names: string[]): string | undefined => {
    const chain = (l: string) => [l, ...[...(ancestors.get(l) ?? [])].sort((a, b) => ancestors.get(b)!.length - ancestors.get(a)!.length)]
    return chain(names[0]!).find((c) => names.every((n) => chain(n).includes(c)))
  }
  const edgeTypes = [...new Set((catalog.structure?.edges ?? []).map((e) => e.type))].sort()
  for (const type of edgeTypes) {
    const seen = catalog.structure!.edges.filter((e) => e.type === type)
    const froms = [...new Set(seen.flatMap((e) => specific(e.from, ancestors)))]
    const tos = [...new Set(seen.flatMap((e) => specific(e.to, ancestors)))]
    const from = froms.length > 0 ? nearestCommon(froms) : undefined
    const to = tos.length > 0 ? nearestCommon(tos) : undefined
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
    for (const e of seen) for (const prop of e.properties) observedType(type, propOf(edge, prop.key), prop)
    edges.push(edge)
  }

  const keyed = (label: string): boolean => {
    const n = byLabel.get(label)
    return !!n && (n.key.length > 0 || (!!n.extends && keyed(n.extends)))
  }
  for (const node of nodes) {
    if (!node.abstract && node.key.length === 0 && !(node.extends && keyed(node.extends))) {
      diagnostics.push(warn('import-no-key',
        `'${node.name}' has no uniqueness constraint whose properties all exist, so it has no key. Declare one before the model validates.`))
    }
  }

  if (widthLost.length > 0) {
    diagnostics.push(info('import-width',
      `Memgraph records no integer width or float precision, so ${widthLost.sort().join(', ')} ${widthLost.length === 1 ? 'is' : 'are'} read as 64-bit.`))
  }
  for (const c of catalog.constraints.filter((x) => x.kind === 'typed' && x.dataType === 'ENUM')) {
    const p = byLabel.get(c.label)!.props.find((x) => x.name === c.properties[0])!
    if (!p.enum) {
      diagnostics.push(info('import-enum-unknown',
        `'${c.label}.${p.name}' must hold an enum value, but the constraint names no enum and no value was observed, so which enum is unknown.`))
    }
  }
  const enums: EnumIR[] = catalog.enums.map((e) => ({
    id: deriveId('enum', e.name), name: e.name, qname: e.name, iri: e.name, prefix: '', values: [...e.values],
  }))
  diagnostics.push(info('import-lossy',
    'A Memgraph schema holds no edge constraints, cardinality, value bounds, mixins or open/closed types, so none of them is in this model.'))

  return {
    model: {
      file,
      namespace: { prefix: 'model', iri: 'https://example.org/imported#' },
      prefixes: {}, nodes, edges, mixins: [], enums,
    },
    diagnostics,
  }
}

export function importMemgraph(inputs: MemgraphImportInput[]): ImportResult {
  if (inputs.length > 1) {
    return {
      model: { file: inputs[0]!.path, namespace: { prefix: 'model', iri: 'https://example.org/imported#' }, prefixes: {}, nodes: [], edges: [], mixins: [], enums: [] },
      diagnostics: [err('import-memgraph-multiple', 'Only one Memgraph instance can be imported at a time.')],
    }
  }
  return memgraphCatalogToModel(inputs[0]!.memgraphCatalog, inputs[0]!.path)
}
