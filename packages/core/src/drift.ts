import type { Diagnostic, ModelIR } from './ir'
import { concreteNodes, warn } from './ir'
import type { EmitOptions } from './capabilities'
import {
  columnType, endpointNodePairs, multiplicity, syntheticKeyColumn,
} from './emit/ladybug'
import { neo4jSchema } from './emit/neo4j'
import { memgraphSchema } from './emit/memgraph'
import { falkorSchema } from './emit/falkordb'
import type { LadybugCatalog, LadybugRelTable, LadybugSource } from './import/ladybug'
import type { Neo4jCatalog } from './import/neo4j'
import type { MemgraphCatalog } from './import/memgraph'
import type { FalkorCatalog } from './import/falkordb'

/**
 * Drift: the schema a database actually holds, compared against what the model
 * requires of that target. The expected side is built by the emitters' own functions
 * (the planners' rule, applied to comparison), and matching is structural — a live
 * schema carries no element ids and its constraint names are cosmetic. What a target
 * cannot store is out of scope by construction, so a lossy read never shows as drift.
 * See lat.md/drift#Drift.
 */

export interface DriftFinding {
  kind: 'missing' | 'unexpected' | 'different'
  /** The object, as a reader names it: `node table Person`, `unique Person(email)`. */
  object: string
  detail: string
}

export interface DriftReport {
  target: string
  findings: DriftFinding[]
  diagnostics: Diagnostic[]
}

const finding = (kind: DriftFinding['kind'], object: string, detail: string): DriftFinding =>
  ({ kind, object, detail })

/** Two sets of canonical keys, compared both ways. */
function diffSets(
  expected: Map<string, string>, actual: Map<string, string>, findings: DriftFinding[],
  missingDetail: string, unexpectedDetail: string,
): void {
  for (const [key, label] of expected) {
    if (!actual.has(key)) findings.push(finding('missing', label, missingDetail))
  }
  for (const [key, label] of actual) {
    if (!expected.has(key)) findings.push(finding('unexpected', label, unexpectedDetail))
  }
}

// ---------------------------------------------------------------------------- ladybug

/** The catalog the model's DDL would create, spelled by the emitter's own functions. */
export function expectedLadybugCatalog(model: ModelIR): LadybugCatalog {
  const tables: LadybugCatalog['tables'] = []
  for (const node of concreteNodes(model)) {
    const columns = node.props.map((p) => ({ name: p.name, type: columnType(p) }))
    let primaryKey = node.key
    if (node.key.length > 1) {
      columns.push({ name: syntheticKeyColumn(node), type: 'STRING' })
      primaryKey = [syntheticKeyColumn(node)]
    }
    tables.push({ kind: 'node', name: node.name, columns, primaryKey })
  }
  for (const edge of model.edges) {
    const pairs = endpointNodePairs(model, edge).map(([f, t]) => [f.name, t.name] as [string, string])
    if (pairs.length === 0) continue
    tables.push({
      kind: 'rel', name: edge.name,
      columns: edge.props.map((p) => ({ name: p.name, type: columnType(p) })),
      pairs,
      ...(multiplicity(edge.cardinality) ? { multiplicity: multiplicity(edge.cardinality)! } : {}),
    })
  }
  return { tables }
}

/** `DECIMAL(10, 2)` and `DECIMAL(10,2)` are one spelling; case never distinguishes two. */
const normalType = (t: string): string => t.replace(/\s+/g, '').toUpperCase()

function diffColumns(
  owner: string, expected: Array<{ name: string; type: string }>,
  actual: Array<{ name: string; type: string }>, findings: DriftFinding[],
): void {
  const have = new Map(actual.map((c) => [c.name, c.type]))
  for (const col of expected) {
    const got = have.get(col.name)
    if (got === undefined) {
      findings.push(finding('missing', `column ${owner}.${col.name}`,
        `the model declares it as ${col.type}; the database has no such column`))
    } else if (normalType(got) !== normalType(col.type)) {
      findings.push(finding('different', `column ${owner}.${col.name}`,
        `the model says ${col.type}; the database says ${got}`))
    }
    have.delete(col.name)
  }
  for (const [name, type] of have) {
    findings.push(finding('unexpected', `column ${owner}.${name}`,
      `the database holds it as ${type}; the model does not declare it`))
  }
}

/**
 * A database's multiplicity is not in its catalog (measured against 0.19.1), so it is
 * compared only when the actual side came from a DDL script.
 */
export function driftLadybug(
  model: ModelIR, catalog: LadybugCatalog, source: LadybugSource,
): DriftReport {
  const findings: DriftFinding[] = []
  const expected = expectedLadybugCatalog(model)
  const actualByName = new Map(catalog.tables.map((t) => [`${t.kind} ${t.name}`, t]))

  for (const table of expected.tables) {
    const actual = actualByName.get(`${table.kind} ${table.name}`)
    actualByName.delete(`${table.kind} ${table.name}`)
    const label = `${table.kind} table ${table.name}`
    if (!actual) {
      findings.push(finding('missing', label, 'the model declares it; the database has no such table'))
      continue
    }
    diffColumns(table.name, table.columns, actual.columns, findings)
    if (table.kind === 'node' && actual.kind === 'node') {
      const want = table.primaryKey.join(', ')
      const got = actual.primaryKey.join(', ')
      if (want !== got) {
        findings.push(finding('different', `primary key of ${table.name}`,
          `the model says (${want}); the database says (${got || 'none'})`))
      }
    }
    if (table.kind === 'rel' && actual.kind === 'rel') {
      diffRelPairs(table, actual, findings)
      if (source === 'ddl' && table.multiplicity !== actual.multiplicity) {
        findings.push(finding('different', `multiplicity of ${table.name}`,
          `the model says ${table.multiplicity ?? 'none'}; the script says ${actual.multiplicity ?? 'none'}`))
      }
    }
  }
  for (const table of actualByName.values()) {
    findings.push(finding('unexpected', `${table.kind} table ${table.name}`,
      'the database holds it; the model declares no such type'))
  }
  return { target: 'ladybug', findings, diagnostics: [] }
}

function diffRelPairs(
  expected: LadybugRelTable, actual: LadybugRelTable, findings: DriftFinding[],
): void {
  const key = (p: [string, string]) => `${p[0]}→${p[1]}`
  const want = new Map(expected.pairs.map((p) => [key(p), p]))
  const got = new Map(actual.pairs.map((p) => [key(p), p]))
  for (const k of want.keys()) {
    if (!got.has(k)) {
      findings.push(finding('missing', `endpoint pair ${expected.name} ${k}`,
        'the model expands to it; the database does not hold it'))
    }
  }
  for (const k of got.keys()) {
    if (!want.has(k)) {
      findings.push(finding('unexpected', `endpoint pair ${actual.name} ${k}`,
        'the database holds it; the model does not expand to it'))
    }
  }
}

// ------------------------------------------------------------------ constraint engines

interface SchemaObjectKey {
  kind: string
  entity: 'node' | 'relationship'
  label: string
  properties: string[]
  /** A typed constraint's data type, where the engine has one. */
  dataType?: string
}

const keyOf = (o: SchemaObjectKey): string =>
  `${o.kind} ${o.entity} ${o.label} (${[...o.properties].sort().join(', ')})${o.dataType ? ` ${o.dataType}` : ''}`

const labelOf = (o: SchemaObjectKey): string =>
  `${o.kind} on ${o.entity} ${o.label}(${o.properties.join(', ')})${o.dataType ? ` IS TYPED ${o.dataType}` : ''}`

const toMap = (objects: SchemaObjectKey[]): Map<string, string> =>
  new Map(objects.map((o) => [keyOf(o), labelOf(o)]))

/**
 * The emitter's statements read back into structured keys. The texts are this tool's
 * own spellings, so the readings are exact; a shape that does not match is a bug the
 * tests would catch, not a guess about foreign syntax.
 */
function parseNeo4jObject(text: string): SchemaObjectKey | undefined {
  const scope = /FOR \(n:([^)]+)\)|FOR \(\)-\[r:([^\]]+)\]-\(\)/.exec(text)
  if (!scope) return undefined
  const entity = scope[1] ? 'node' as const : 'relationship' as const
  const label = scope[1] ?? scope[2]!
  const props = [...text.matchAll(/[nr]\.([\w$]+)/g)].map((m) => m[1]!)
  const kind = /IS NODE KEY/.test(text) ? 'key'
    : /IS UNIQUE/.test(text) ? 'unique'
      : /IS NOT NULL/.test(text) ? 'exists'
        : /CREATE INDEX/.test(text) ? 'index' : undefined
  if (!kind || props.length === 0) return undefined
  return { kind, entity, label, properties: props }
}

export function driftNeo4j(
  model: ModelIR, catalog: Neo4jCatalog, options: EmitOptions = {},
): DriftReport {
  // The instance says what edition it is, which decides what the model expects of it.
  const edition = options.neo4jEdition
    ?? (catalog.edition === 'enterprise' ? 'enterprise' : 'community')
  const { objects } = neo4jSchema(model, { ...options, neo4jEdition: edition })
  const expected = objects
    .filter((o) => o.kind !== 'note')
    .map((o) => parseNeo4jObject(o.text))
    .filter((o): o is SchemaObjectKey => o !== undefined)
  const actual: SchemaObjectKey[] = [
    ...catalog.constraints.map((c) => ({
      kind: c.kind, entity: c.entity, label: c.label, properties: c.properties,
    })),
    ...catalog.indexes.map((i) => ({
      kind: 'index', entity: i.entity, label: i.label, properties: i.properties,
    })),
  ]
  const findings: DriftFinding[] = []
  diffSets(toMap(expected), toMap(actual), findings,
    'the model requires it; the instance does not hold it',
    'the instance holds it; the model does not require it')
  return { target: 'neo4j', findings, diagnostics: [] }
}

function parseMemgraphObject(create: string): SchemaObjectKey | undefined {
  const index = /CREATE INDEX ON :(`(?:[^`]|``)+`|[\w$]+)\(([^)]*)\);/.exec(create)
  const unquote = (s: string) => (s.startsWith('`') ? s.slice(1, -1).replace(/``/g, '`') : s)
  if (index) {
    return {
      kind: 'index', entity: 'node', label: unquote(index[1]!),
      properties: index[2]!.split(',').map((s) => unquote(s.trim())).filter(Boolean),
    }
  }
  const constraint = /CREATE CONSTRAINT ON \(n:(`(?:[^`]|``)+`|[\w$]+)\) ASSERT (.*);/.exec(create)
  if (!constraint) return undefined
  const label = unquote(constraint[1]!)
  const body = constraint[2]!
  const props = [...body.matchAll(/n\.(`(?:[^`]|``)+`|[\w$]+)/g)].map((m) => unquote(m[1]!))
  if (/IS UNIQUE$/.test(body)) return { kind: 'unique', entity: 'node', label, properties: props }
  if (/^EXISTS /.test(body)) return { kind: 'exists', entity: 'node', label, properties: props }
  const typed = /IS TYPED (\w+)$/.exec(body)
  if (typed) return { kind: 'typed', entity: 'node', label, properties: props, dataType: typed[1]! }
  return undefined
}

export function driftMemgraph(model: ModelIR, catalog: MemgraphCatalog): DriftReport {
  const { objects } = memgraphSchema(model)
  const findings: DriftFinding[] = []
  const expected = objects
    .filter((o) => o.kind === 'constraint' || o.kind === 'index')
    .map((o) => parseMemgraphObject(o.create))
    .filter((o): o is SchemaObjectKey => o !== undefined)
  const actual: SchemaObjectKey[] = [
    ...catalog.constraints.map((c) => ({
      kind: c.kind, entity: 'node' as const, label: c.label, properties: c.properties,
      ...(c.dataType ? { dataType: c.dataType } : {}),
    })),
    ...catalog.indexes.map((i) => ({
      kind: 'index', entity: 'node' as const, label: i.label, properties: i.properties,
    })),
  ]
  diffSets(toMap(expected), toMap(actual), findings,
    'the model requires it; the instance does not hold it',
    'the instance holds it; the model does not require it')

  // Enums are schema objects of their own: compare by name, then value by value.
  const expectedEnums = new Map(model.enums.map((e) => [e.name, e.values]))
  const actualEnums = new Map(catalog.enums.map((e) => [e.name, e.values]))
  for (const [name, values] of expectedEnums) {
    const got = actualEnums.get(name)
    if (!got) {
      findings.push(finding('missing', `enum ${name}`, 'the model declares it; the instance has no such enum'))
    } else if (values.join('|') !== got.join('|')) {
      findings.push(finding('different', `enum ${name}`,
        `the model says ${values.join(', ')}; the instance says ${got.join(', ')}`))
    }
  }
  for (const name of actualEnums.keys()) {
    if (!expectedEnums.has(name)) {
      findings.push(finding('unexpected', `enum ${name}`,
        'the instance holds it; the model declares no such enum'))
    }
  }
  return { target: 'memgraph', findings, diagnostics: [] }
}

export function driftFalkor(model: ModelIR, catalog: FalkorCatalog): DriftReport {
  const diagnostics: Diagnostic[] = []
  const { objects } = falkorSchema(model)
  const findings: DriftFinding[] = []

  // A constraint that is not operational is not enforcing anything, so it is not
  // "present"; it is reported with its status instead, beside the missing finding.
  const operational = catalog.constraints.filter((c) => c.status === 'OPERATIONAL')
  for (const c of catalog.constraints.filter((c) => c.status !== 'OPERATIONAL')) {
    diagnostics.push(warn('drift-constraint-failed',
      `The ${c.kind} constraint on ${c.label}(${c.properties.join(', ')}) is ${c.status || 'not operational'}, so it is not enforcing anything and does not count as present.`))
  }

  const expectedConstraints: SchemaObjectKey[] = objects
    .filter((o) => o.kind === 'constraint')
    .map((o) => ({
      kind: o.constraint!.toLowerCase(), entity: o.entity === 'NODE' ? 'node' as const : 'relationship' as const,
      label: o.label, properties: o.props,
    }))
  const actualConstraints: SchemaObjectKey[] = operational.map((c) => ({
    kind: c.kind, entity: c.entity, label: c.label, properties: c.properties,
  }))

  // An index is per property on this engine (measured), however a CREATE spelled it,
  // and the catalog reports one row per label: both sides flatten to label+property.
  const flatten = (list: Array<{ entity: 'node' | 'relationship'; label: string; properties: string[] }>) =>
    list.flatMap((i) => i.properties.map((p) => ({
      kind: 'index', entity: i.entity, label: i.label, properties: [p],
    })))
  const expectedIndexes = flatten(objects
    .filter((o) => o.kind === 'index')
    .map((o) => ({
      entity: o.entity === 'NODE' ? 'node' as const : 'relationship' as const,
      label: o.label, properties: o.props,
    })))
  const actualIndexes = flatten(catalog.indexes)

  diffSets(toMap([...expectedConstraints, ...expectedIndexes]),
    toMap([...actualConstraints, ...actualIndexes]), findings,
    'the model requires it; the graph does not hold it',
    'the graph holds it; the model does not require it')
  return { target: 'falkordb', findings, diagnostics }
}

// ------------------------------------------------------------------------------ shared

export interface DriftInput {
  ladybug?: { catalog: LadybugCatalog; source: LadybugSource }
  neo4j?: Neo4jCatalog
  memgraph?: MemgraphCatalog
  falkordb?: FalkorCatalog
}

/** One entry point over the four engines, for the command line. */
export function drift(model: ModelIR, input: DriftInput, options: EmitOptions = {}): DriftReport {
  if (input.ladybug) return driftLadybug(model, input.ladybug.catalog, input.ladybug.source)
  if (input.neo4j) return driftNeo4j(model, input.neo4j, options)
  if (input.memgraph) return driftMemgraph(model, input.memgraph)
  if (input.falkordb) return driftFalkor(model, input.falkordb)
  return {
    target: 'none', findings: [],
    diagnostics: [{
      severity: 'error', code: 'drift-no-source',
      message: 'Nothing to compare against: name a database, a URI or a DDL script.',
    }],
  }
}

export function describeFinding(f: DriftFinding): string {
  return `${f.kind}: ${f.object} — ${f.detail}`
}
