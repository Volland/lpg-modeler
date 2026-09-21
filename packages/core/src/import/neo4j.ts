import {
  err, info, warn,
  type Diagnostic, type EdgeTypeIR, type NodeTypeIR, type PropertyIR, type ScalarType,
} from '../ir'
import { deriveId } from '../ids'
import { inferHierarchy, nearestCommon, specific } from './labels'
import type { ImportResult } from './rdf'

/**
 * Reads a running Neo4j's schema back into a model. Constraints are declarations and
 * outrank anything observed; labels, properties and endpoints come from the schema
 * procedures, which report what the stored data holds. Measured against Neo4j 5.26.30
 * Community. See lat.md/importers#Reading a Neo4j Instance.
 */

export interface Neo4jConstraint {
  /** `key` and `exists` are Enterprise-only, so a Community instance carries neither. */
  kind: 'unique' | 'exists' | 'key' | 'typed'
  entity: 'node' | 'relationship'
  /** The label, or the relationship type. */
  label: string
  properties: string[]
  /** The constraint's own name, which this tool's generator makes meaningful. */
  name: string
  /** For `typed`: the property type the constraint requires. */
  propertyType?: string
}

export interface Neo4jIndex {
  entity: 'node' | 'relationship'
  label: string
  properties: string[]
}

export interface Neo4jObservedProperty {
  key: string
  /** Observed value types, as `db.schema` spells them: `String`, `Long`, `DateTime`. */
  types: string[]
}

export interface Neo4jCatalog {
  /** `community` or `enterprise`, as `dbms.components()` reports it. */
  edition?: string
  version?: string
  constraints: Neo4jConstraint[]
  /** Indexes that stand on their own: neither a token lookup nor a constraint's own. */
  indexes: Neo4jIndex[]
  /** Label sets and their properties, from `db.schema.nodeTypeProperties()`. */
  nodes: Array<{ labels: string[]; properties: Neo4jObservedProperty[] }>
  relationships: Array<{ type: string; properties: Neo4jObservedProperty[] }>
  /** One pair per label rather than per label set, from `db.schema.visualization()`. */
  endpoints: Array<{ type: string; from: string; to: string }>
}

/** A running Neo4j, as far as reading its schema needs: one statement in, plain rows out. */
export interface Neo4jSession {
  run(statement: string): Promise<Array<Record<string, unknown>>>
}

/**
 * Which Bolt engine answered, from the component names it reports. Memgraph is checked
 * for first because it reports a `Neo4j Kernel` row of its own alongside its `Memgraph`
 * one, so a kernel row means Neo4j only when no Memgraph row accompanies it.
 * See lat.md/importers#Telling Two Bolt Engines Apart.
 */
export function identifyBoltEngine(componentNames: string[]): 'memgraph' | 'neo4j' | undefined {
  if (componentNames.includes('Memgraph')) return 'memgraph'
  if (componentNames.includes('Neo4j Kernel')) return 'neo4j'
  return undefined
}

/** A read instance standing in for a file in an import. */
export interface Neo4jImportInput {
  path: string
  neo4jCatalog: Neo4jCatalog
}

const asList = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : v === null || v === undefined ? [] : [String(v)])

/** `SHOW CONSTRAINTS` reports its kinds with the entity in the name. */
const CONSTRAINT_KINDS: Record<string, { kind: Neo4jConstraint['kind']; entity: Neo4jConstraint['entity'] }> = {
  UNIQUENESS: { kind: 'unique', entity: 'node' },
  RELATIONSHIP_UNIQUENESS: { kind: 'unique', entity: 'relationship' },
  NODE_KEY: { kind: 'key', entity: 'node' },
  RELATIONSHIP_KEY: { kind: 'key', entity: 'relationship' },
  NODE_PROPERTY_EXISTENCE: { kind: 'exists', entity: 'node' },
  RELATIONSHIP_PROPERTY_EXISTENCE: { kind: 'exists', entity: 'relationship' },
  NODE_PROPERTY_TYPE: { kind: 'typed', entity: 'node' },
  RELATIONSHIP_PROPERTY_TYPE: { kind: 'typed', entity: 'relationship' },
}

/**
 * A `db.schema` value type as a scalar. Neo4j stores one integer width and one float
 * precision, so nothing here carries a width back. `Long` is its 64-bit integer.
 */
const FROM_OBSERVED: Record<string, { type: ScalarType; list?: boolean }> = {
  String: { type: 'string' },
  Long: { type: 'int' },
  Integer: { type: 'int' },
  Double: { type: 'float' },
  Float: { type: 'float' },
  Boolean: { type: 'boolean' },
  Date: { type: 'date' },
  DateTime: { type: 'zoneddatetime' },
  LocalDateTime: { type: 'datetime' },
  Duration: { type: 'duration' },
  StringArray: { type: 'string', list: true },
  LongArray: { type: 'int', list: true },
  DoubleArray: { type: 'float', list: true },
  BooleanArray: { type: 'boolean', list: true },
}

/** `:`Person`:`Party`` as the labels it names. */
const parseNodeType = (nodeType: string): string[] =>
  [...String(nodeType).matchAll(/`([^`]+)`/g)].map((m) => m[1]!)

/**
 * Reads an instance's schema through a session the caller opened; `core` never loads a
 * driver. Never throws: a query the engine refuses is an `import-catalog` error, except
 * a schema procedure that is absent, which only narrows the import.
 */
export async function readNeo4jSchema(
  session: Neo4jSession,
): Promise<{ catalog: Neo4jCatalog; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = []
  const catalog: Neo4jCatalog = { constraints: [], indexes: [], nodes: [], relationships: [], endpoints: [] }
  const rows = async (statement: string, required: string[], optional = false) => {
    try {
      const all = await session.run(statement)
      const missing = all.length > 0 ? required.filter((k) => !(k in (all[0] as object))) : []
      if (missing.length > 0) {
        diagnostics.push(err('import-catalog',
          `'${statement}' returned no '${missing.join("', '")}' column. This Neo4j names its schema differently from the 5.26 this reader was measured against.`))
        return undefined
      }
      return all
    } catch (e) {
      const message = (e as Error).message
      if (optional) {
        diagnostics.push(info('import-procedure-absent',
          `'${statement}' is not available on this instance (${message.split('\n')[0]}), so what it reports is missing from this import.`))
      } else {
        diagnostics.push(err('import-catalog', `Neo4j refused '${statement}': ${message}`))
      }
      return undefined
    }
  }

  for (const c of await rows('SHOW CONSTRAINTS', ['name', 'type', 'labelsOrTypes', 'properties']) ?? []) {
    const mapped = CONSTRAINT_KINDS[String(c.type)]
    if (!mapped) {
      diagnostics.push(warn('import-constraint-kind',
        `Constraint '${String(c.name)}' is of type ${String(c.type)}, which this reader does not know; it was not imported.`))
      continue
    }
    catalog.constraints.push({
      ...mapped,
      name: String(c.name),
      label: asList(c.labelsOrTypes)[0] ?? '',
      properties: asList(c.properties),
      ...(c.propertyType ? { propertyType: String(c.propertyType) } : {}),
    })
  }

  // A token lookup index exists on every database and says nothing about a model, and a
  // constraint's own index is the constraint, not an index in its own right.
  for (const i of await rows('SHOW INDEXES', ['name', 'type', 'entityType', 'labelsOrTypes', 'properties']) ?? []) {
    if (String(i.type) === 'LOOKUP' || i.owningConstraint) continue
    catalog.indexes.push({
      entity: String(i.entityType) === 'RELATIONSHIP' ? 'relationship' : 'node',
      label: asList(i.labelsOrTypes)[0] ?? '',
      properties: asList(i.properties),
    })
  }

  const byLabels = new Map<string, { labels: string[]; properties: Neo4jObservedProperty[] }>()
  for (const p of await rows('CALL db.schema.nodeTypeProperties()', ['nodeType', 'propertyName'], true) ?? []) {
    const labels = Array.isArray(p.nodeLabels) && p.nodeLabels.length > 0
      ? asList(p.nodeLabels) : parseNodeType(String(p.nodeType))
    const key = [...labels].sort().join('\u0000')
    const entry = byLabels.get(key) ?? { labels, properties: [] }
    if (p.propertyName !== null && p.propertyName !== undefined) {
      entry.properties.push({ key: String(p.propertyName), types: asList(p.propertyTypes) })
    }
    byLabels.set(key, entry)
  }
  catalog.nodes = [...byLabels.values()]

  const byType = new Map<string, Neo4jObservedProperty[]>()
  for (const p of await rows('CALL db.schema.relTypeProperties()', ['relType'], true) ?? []) {
    const type = parseNodeType(String(p.relType))[0] ?? String(p.relType)
    const props = byType.get(type) ?? []
    if (p.propertyName !== null && p.propertyName !== undefined) {
      props.push({ key: String(p.propertyName), types: asList(p.propertyTypes) })
    }
    byType.set(type, props)
  }
  catalog.relationships = [...byType].map(([type, properties]) => ({ type, properties }))

  // Endpoints have no other source: relTypeProperties names a relationship's properties
  // but never which labels it joins.
  for (const v of await rows('CALL db.schema.visualization()', ['nodes', 'relationships'], true) ?? []) {
    const byId = new Map<string, string>()
    for (const n of Array.isArray(v.nodes) ? v.nodes : []) {
      const r = n as { elementId?: unknown; labels?: unknown }
      byId.set(String(r.elementId), asList(r.labels)[0] ?? '')
    }
    for (const rel of Array.isArray(v.relationships) ? v.relationships : []) {
      const r = rel as { type?: unknown; startNodeElementId?: unknown; endNodeElementId?: unknown }
      const from = byId.get(String(r.startNodeElementId))
      const to = byId.get(String(r.endNodeElementId))
      if (from && to) catalog.endpoints.push({ type: String(r.type), from, to })
    }
  }

  for (const c of await rows('CALL dbms.components() YIELD name, versions, edition', ['name', 'edition'], true) ?? []) {
    if (String(c.name) !== 'Neo4j Kernel') continue
    catalog.edition = String(c.edition)
    catalog.version = asList(c.versions)[0]
  }

  return { catalog, diagnostics }
}

export function neo4jCatalogToModel(catalog: Neo4jCatalog, file: string): ImportResult {
  const diagnostics: Diagnostic[] = []
  const sets = catalog.nodes.map((n) => n.labels).filter((s) => s.length > 0)
  const nodeConstraints = catalog.constraints.filter((c) => c.entity === 'node')
  const relConstraints = catalog.constraints.filter((c) => c.entity === 'relationship')
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

  // Constraints first: they are declarations, and outrank anything observed in the data.
  const exists = new Set(nodeConstraints.filter((c) => c.kind === 'exists').map((c) => `${c.label}.${c.properties[0]}`))
  for (const c of nodeConstraints) {
    const node = byLabel.get(c.label)
    if (!node) continue
    if (c.kind === 'exists') propOf(node, c.properties[0]!).required = true
    if (c.kind === 'typed') {
      diagnostics.push(info('import-type-partial',
        `'${c.label}.${c.properties[0]}' is constrained to ${c.propertyType}; a Neo4j property type carries no width, so it is read at full width.`))
    }
  }

  for (const node of nodes) {
    const declared = nodeConstraints.find((c) => c.kind === 'key' && c.label === node.name)
    if (declared) {
      node.key = [...declared.properties]
      for (const k of declared.properties) propOf(node, k).required = true
    } else {
      // On Community a key cannot be declared at all, so it is recovered from a
      // uniqueness constraint. Where several could be the key, one whose properties are
      // all required outranks the generator's own name for it, which outranks the
      // smallest. See lat.md/importers#Reading a Neo4j Instance.
      const generated = `${snake(node.name)}_key_unique`
      const rank = (c: Neo4jConstraint) =>
        (c.properties.every((p) => exists.has(`${node.name}.${p}`)) ? 4 : 0) + (c.name === generated ? 2 : 0)
      const candidates = nodeConstraints
        .filter((c) => c.kind === 'unique' && c.label === node.name)
        .sort((a, b) => rank(b) - rank(a)
          || a.properties.length - b.properties.length || a.properties.join().localeCompare(b.properties.join()))
      const key = candidates[0]
      if (key) {
        node.key = [...key.properties]
        for (const k of key.properties) propOf(node, k).required = true
        diagnostics.push(info('import-key-recovered',
          candidates.length > 1
            ? `'${node.name}' declares no node key, and has ${candidates.length} uniqueness constraints; (${key.properties.join(', ')}) is taken as the key.`
            : `'${node.name}' declares no node key — Neo4j Community cannot — so its uniqueness constraint on (${key.properties.join(', ')}) is read as the key.`))
      }
      for (const c of candidates.slice(1)) {
        if (c.properties.length === 1) { propOf(node, c.properties[0]!).unique = true; continue }
        diagnostics.push(warn('import-composite-unique',
          `'${node.name}' asserts (${c.properties.join(', ')}) unique together, which the model can say only of a key. It was not imported.`))
      }
    }
    if (declared) {
      for (const c of nodeConstraints.filter((x) => x.kind === 'unique' && x.label === node.name)) {
        if (c.properties.length === 1 && !node.key.includes(c.properties[0]!)) propOf(node, c.properties[0]!).unique = true
      }
    }
  }

  // Observed structure: a property belongs to the most specific label of the set it
  // occurs in, and an ancestor's property is inherited rather than redeclared.
  const observedType = (owner: string, p: PropertyIR, types: string[]) => {
    const top = types[0]
    if (!top) return
    if (types.length > 1) {
      diagnostics.push(warn('import-ambiguous-type',
        `'${owner}.${p.name}' holds values of ${types.join(', ')}; the first, ${top}, was taken.`))
    }
    const mapped = FROM_OBSERVED[top]
    if (!mapped) {
      diagnostics.push(warn('import-type',
        `'${owner}.${p.name}' holds ${top} values, which this metamodel has no type for. It is read as string.`))
      return
    }
    p.type = mapped.type
    p.list = mapped.list ?? false
  }
  for (const n of catalog.nodes) {
    for (const label of specific(n.labels, ancestors)) {
      const node = byLabel.get(label)
      if (!node) continue
      for (const prop of n.properties) {
        if (n.labels.some((a) => (ancestors.get(label) ?? []).includes(a) && byLabel.get(a)?.props.some((x) => x.name === prop.key))) continue
        observedType(label, propOf(node, prop.key), prop.types)
      }
    }
  }

  const edges: EdgeTypeIR[] = []
  const edgeTypes = [...new Set([
    ...catalog.endpoints.map((e) => e.type),
    ...catalog.relationships.map((r) => r.type),
  ])].sort()
  for (const type of edgeTypes) {
    const seen = catalog.endpoints.filter((e) => e.type === type)
    if (seen.length === 0) {
      diagnostics.push(warn('import-endpoints',
        `Edge type '${type}' has properties but no observed endpoints, so there is nothing to say which types it joins; it was not imported.`))
      continue
    }
    // `visualization` names one pair per label rather than per label set, so a
    // :Person:Party node at one end is reported as both. Narrowing to the most specific
    // labels first is what a Memgraph import does to a label set; collapsing without it
    // would read every edge as declared on the abstract parent.
    // See lat.md/importers#Reading Edges.
    const froms = specific([...new Set(seen.map((e) => e.from))], ancestors)
    const tos = specific([...new Set(seen.map((e) => e.to))], ancestors)
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
    for (const prop of catalog.relationships.find((r) => r.type === type)?.properties ?? []) {
      observedType(type, propOf(edge, prop.key), prop.types)
    }
    for (const c of relConstraints.filter((x) => x.label === type)) {
      if (c.kind === 'exists') propOf(edge, c.properties[0]!).required = true
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
        `'${node.name}' has no uniqueness or key constraint, so it has no key. Declare one before the model validates.`))
    }
  }

  // A property no constraint mentions is in the model because a node was seen carrying
  // it, which is a weaker claim than the rest of the file makes and is said once rather
  // than per property.
  const declaredProps = new Set(catalog.constraints.flatMap((c) => c.properties.map((p) => `${c.label}.${p}`)))
  const observedOnly = nodes.flatMap((n) => n.props
    .filter((p) => !declaredProps.has(`${n.name}.${p.name}`))
    .map((p) => `${n.name}.${p.name}`))
  if (observedOnly.length > 0) {
    diagnostics.push(info('import-observed',
      `${observedOnly.length} propert${observedOnly.length === 1 ? 'y was' : 'ies were'} read from stored data rather than from a constraint, with the type observed there (${observedOnly.sort().slice(0, 8).join(', ')}${observedOnly.length > 8 ? ', …' : ''}).`))
  }

  if (catalog.edition === 'community') {
    diagnostics.push(info('import-edition',
      'This is a Neo4j Community instance, which can hold no existence or node key constraint, so no property is read as required except the parts of a key.'))
  }
  diagnostics.push(info('import-lossy',
    'A Neo4j schema holds no cardinality, value bounds, named constraints, enums, mixins, integer widths or open/closed types, so none of them is in this model.'))

  return {
    model: {
      file,
      namespace: { prefix: 'model', iri: 'https://example.org/imported#' },
      prefixes: {}, nodes, edges, mixins: [], enums: [],
    },
    diagnostics,
  }
}

/** The generator's own naming, which is what makes its key recoverable on Community. */
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

export function importNeo4j(inputs: Neo4jImportInput[]): ImportResult {
  if (inputs.length > 1) {
    return {
      model: {
        file: inputs[0]!.path,
        namespace: { prefix: 'model', iri: 'https://example.org/imported#' },
        prefixes: {}, nodes: [], edges: [], mixins: [], enums: [],
      },
      diagnostics: [err('import-mixed-sources', 'Only one Neo4j instance can be imported at a time.')],
    }
  }
  const only = inputs[0]
  if (!only) {
    return {
      model: {
        file: '',
        namespace: { prefix: 'model', iri: 'https://example.org/imported#' },
        prefixes: {}, nodes: [], edges: [], mixins: [], enums: [],
      },
      diagnostics: [],
    }
  }
  return neo4jCatalogToModel(only.neo4jCatalog, only.path)
}
