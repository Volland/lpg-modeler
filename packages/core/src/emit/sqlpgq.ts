import type {
  Assertion, Diagnostic, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR, ScalarType, ValueType,
} from '../ir'
import { concreteNodes, describeCardinality, isUnconstrained, typeParams } from '../ir'
import {
  constraintDowngrade, downgrade, reportUnsupportedConstraints,
  type Capabilities, type EmitOptions, type EmitResult,
} from '../capabilities'
import { endpointNodePairs } from './ladybug'

/**
 * SQL/PGQ over DuckDB: ordinary SQL tables carrying the constraints, and a `CREATE
 * PROPERTY GRAPH` that maps them. Everything here is measured against DuckDB 1.4.4 with
 * its `duckpgq` extension, by executing the artifact — see lat.md/emitters#SQL/PGQ Target.
 *
 * Unlike the graph engines this one enforces nearly everything, because it is a
 * relational engine underneath: NOT NULL, UNIQUE, CHECK, foreign keys and enum types are
 * all refused on write. What it lacks is labels that overlap (measured: every label must
 * be unique across tables), so a hierarchy is flattened to leaf tables as on LadybugDB
 * and an edge type reaching an abstract endpoint becomes one table and label per pair.
 */
export const SQLPGQ_CAPABILITIES: Capabilities = {
  target: 'sqlpgq',
  multiLabel: false,
  inheritance: 'leaf-tables',
  requiredConstraint: 'enforced',
  uniqueConstraint: 'enforced',
  compositeKey: 'native',
  edgeProps: 'native',
  nestedEdges: false,
  listProps: 'native',
  // STRUCT, MAP, UNION and fixed-size arrays are DuckDB column types, spelled the way the
  // metamodel borrowed them.
  compositeTypes: 'native',
  enums: 'enforced',
  // A table is closed: a column it does not declare cannot be written.
  openTypes: 'unsupported',
  valueConstraints: 'enforced',
  // Comparisons and presence rules are CHECK constraints; an edge count would need a
  // subquery, which a CHECK cannot hold.
  namedConstraints: 'partial',
  rawPassthrough: false,
  // An end bounded at one is UNIQUE on the other end's key columns. A minimum or a
  // maximum above one has no SQL spelling.
  cardinality: 'upper-bound-only',
}

const TYPES: Record<ScalarType, string> = {
  string: 'VARCHAR',
  int8: 'TINYINT', int16: 'SMALLINT', int32: 'INTEGER', int: 'BIGINT', int128: 'HUGEINT',
  uint8: 'UTINYINT', uint16: 'USMALLINT', uint32: 'UINTEGER', uint64: 'UBIGINT',
  float32: 'FLOAT', float: 'DOUBLE', decimal: 'DECIMAL',
  boolean: 'BOOLEAN',
  date: 'DATE', datetime: 'TIMESTAMP', zoneddatetime: 'TIMESTAMPTZ', duration: 'INTERVAL',
  uuid: 'UUID', blob: 'BLOB', json: 'JSON',
}

const NUMERIC = new Set<ScalarType>([
  'int8', 'int16', 'int32', 'int', 'int128', 'uint8', 'uint16', 'uint32', 'uint64',
  'float32', 'float', 'decimal',
])

/**
 * The words DuckDB's parser will not take as a bare name, from `duckdb_keywords()` on
 * 1.4.4: every keyword that is not `unreserved`. Measured, not recalled: `AT` is a
 * `type_function` keyword and fails as a table name although it is not reserved, while
 * all 330 `unreserved` words — `key`, `name`, `value`, `date`, `user` among them — parse
 * bare as both a table and a column. The live test compares this list to the engine's own,
 * so a release that moves a word fails there first.
 */
export const DUCKDB_QUOTED: ReadonlySet<string> = new Set((
  'all analyse analyze and anti any array as asc asof asymmetric at authorization between '
  + 'bigint binary bit boolean both by case cast char character check coalesce collate '
  + 'collation column columns concurrently constraint create cross dec decimal default '
  + 'deferrable desc describe distinct do else end except exists extract false fetch float '
  + 'for foreign freeze from full generated glob group grouping grouping_id having ilike in '
  + 'initially inner inout int integer intersect interval into is isnull join lambda lateral '
  + 'leading left like limit map national natural nchar none not notnull null nullif numeric '
  + 'offset on only or order out outer overlaps overlay pivot pivot_longer pivot_wider '
  + 'placing position positional precision primary qualify real references returning right '
  + 'row select semi setof show similar smallint some struct substring summarize symmetric '
  + 'table tablesample then time timestamp to trailing treat trim true try_cast union unique '
  + 'unpack unpivot using values varchar variadic verbose when where window with '
  + 'xmlattributes xmlconcat xmlelement xmlexists xmlforest xmlnamespaces xmlparse xmlpi '
  + 'xmlroot xmlserialize xmltable').split(' '))

/** A name as DuckDB parses it: bare when it is a plain identifier, quoted otherwise. */
export const ident = (name: string): string =>
  (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !DUCKDB_QUOTED.has(name.toLowerCase())
    ? name : `"${name.replace(/"/g, '""')}"`)

const str = (s: string): string => `'${s.replace(/'/g, "''")}'`

/**
 * A value type as DuckDB spells it. Field names are quoted like any other name: measured,
 * `STRUCT(at TIMESTAMP, values DOUBLE[])` does not parse, because `at` and `values` are
 * keywords. The shared formatter spells the other engines' types and does not do this.
 */
function duckType(t: ValueType): string {
  const field = (f: { name: string; type: ValueType }) => `${ident(f.name)} ${duckType(f.type)}`
  switch (t.kind) {
    case 'scalar': return `${TYPES[t.scalar]}${typeParams(t)}`
    case 'list': return `${duckType(t.of)}[]`
    case 'array': return `${duckType(t.of)}[${t.size}]`
    case 'map': return `MAP(${duckType(t.key)}, ${duckType(t.value)})`
    case 'struct': return `STRUCT(${t.fields.map(field).join(', ')})`
    case 'union': return `UNION(${t.members.map(field).join(', ')})`
  }
}

function columnType(p: PropertyIR): string {
  if (p.enum) return `${ident(p.enum)}${p.list ? '[]' : ''}`
  if (p.composite) return duckType(p.composite)
  return `${TYPES[p.type]}${typeParams(p)}${p.list ? '[]' : ''}`
}

/** A table entry and the comment lines that precede it. */
interface Entry { sql: string; comments: string[] }

/**
 * The CHECK a column's value constraints make. NULL passes a CHECK (measured), which is
 * the SHACL reading too: a bound applies to a value that is present.
 */
function valueChecks(owner: string, p: PropertyIR, diags: Diagnostic[], comments: string[]): string[] {
  const col = ident(p.name)
  const checks: string[] = []
  const unspelled = (what: string, why: string) => {
    constraintDowngrade(diags, 'sqlpgq', 'downgrade-value-constraint',
      `Property '${owner}.${p.name}' declares ${what}, which ${why}. The SHACL artifact carries it.`, p.loc)
    comments.push(`-- UNENFORCED: ${what} on '${p.name}'; ${why}.`)
  }
  if (p.list) {
    if (p.min !== undefined || p.max !== undefined || p.minLength !== undefined
      || p.maxLength !== undefined || p.pattern !== undefined) {
      unspelled('value constraints', 'apply per element of a list, and a per-element CHECK is not generated')
    }
    return checks
  }
  if (p.min !== undefined || p.max !== undefined) {
    if (NUMERIC.has(p.type)) {
      if (p.min !== undefined) checks.push(`${col} >= ${p.min}`)
      if (p.max !== undefined) checks.push(`${col} <= ${p.max}`)
    } else {
      unspelled('bounds', `are numeric here, and ${p.type} is not a numeric type`)
    }
  }
  if (p.minLength !== undefined) checks.push(`length(${col}) >= ${p.minLength}`)
  if (p.maxLength !== undefined) checks.push(`length(${col}) <= ${p.maxLength}`)
  // regexp_matches finds a match anywhere in the string, which is how a SHACL pattern reads.
  if (p.pattern !== undefined) checks.push(`regexp_matches(${col}, ${str(p.pattern)})`)
  return checks
}

function columnEntry(
  owner: string, p: PropertyIR, notNull: boolean, unique: boolean, diags: Diagnostic[],
): Entry {
  const comments: string[] = []
  const checks = valueChecks(owner, p, diags, comments)
  const sql = [
    ident(p.name), columnType(p),
    ...(notNull ? ['NOT NULL'] : []),
    ...(unique ? ['UNIQUE'] : []),
    ...(checks.length > 0 ? [`CHECK (${checks.join(' AND ')})`] : []),
  ].join(' ')
  return { sql, comments }
}

/** A named assertion as a CHECK, or undefined when a CHECK cannot hold it. */
function assertionCheck(a: Assertion): string | undefined {
  const present = (n: string) => `${ident(n)} IS NOT NULL`
  switch (a.kind) {
    case 'lessThan': return `${ident(a.left)} < ${ident(a.right)}`
    case 'lessThanOrEquals': return `${ident(a.left)} <= ${ident(a.right)}`
    case 'disjoint': return `${ident(a.left)} <> ${ident(a.right)}`
    // SHACL equals fails when only one side is present; a bare `=` would pass on NULL.
    case 'equals':
      return `COALESCE(${ident(a.left)} = ${ident(a.right)}, FALSE) OR (${ident(a.left)} IS NULL AND ${ident(a.right)} IS NULL)`
    case 'atLeastOne': return a.props.map(present).join(' OR ')
    case 'exactlyOne': return `${a.props.map((n) => `(${present(n)})::INTEGER`).join(' + ')} = 1`
    case 'count': return undefined
  }
}

function render(head: string, entries: Entry[]): string {
  const lines = [`${head} (`]
  entries.forEach((e, i) => {
    for (const c of e.comments) lines.push(`  ${c}`)
    lines.push(`  ${e.sql}${i < entries.length - 1 ? ',' : ''}`)
  })
  lines.push(');')
  return lines.join('\n')
}

function nodeTable(node: NodeTypeIR, diags: Diagnostic[]): string {
  const entries: Entry[] = []
  const lead: string[] = []
  if (node.open) {
    downgrade(diags, 'sqlpgq', 'downgrade-open',
      `Node type '${node.name}' is open, but a SQL table is closed: a column it does not declare cannot be written.`,
      node.loc)
    lead.push(`-- DOWNGRADE: '${node.name}' is open in the model; this table is closed.`)
  }
  for (const p of node.props) {
    const isKey = node.key.includes(p.name)
    const entry = columnEntry(node.name, p, p.required || isKey, p.unique && !isKey, diags)
    entries.push(entry)
  }
  if (node.key.length > 0) entries.push({ sql: `PRIMARY KEY (${node.key.map(ident).join(', ')})`, comments: [] })
  for (const k of node.constraints) {
    const check = assertionCheck(k.assert)
    if (check) {
      entries.push({ sql: `CONSTRAINT ${ident(`${node.name}_${k.name}`)} CHECK (${check})`, comments: [] })
    } else {
      constraintDowngrade(diags, 'sqlpgq', 'downgrade-named-constraint',
        `Constraint '${node.name}.${k.name}' asserts '${k.assert.kind}', which a CHECK cannot express: it counts rows in another table. The SHACL artifact carries it.`,
        k.loc)
      entries.push({ sql: '', comments: [`-- UNENFORCED: constraint '${k.name}' (${k.assert.kind}) counts rows in another table.`] })
    }
  }
  // A comment-only entry has no SQL, and the last real entry must not carry a comma
  // that has nothing after it.
  const real = entries.filter((e) => e.sql !== '')
  const trailing = entries.filter((e) => e.sql === '').flatMap((e) => e.comments)
  const body = render(`CREATE TABLE IF NOT EXISTS ${ident(node.name)}`, real)
  const out = [...lead, body]
  if (trailing.length > 0) out.splice(out.length - 1, 1, body.replace(/\n\);$/, `\n  ${trailing.join('\n  ')}\n);`))
  return out.join('\n')
}

/** The unexpressible part of a bound: any minimum, any maximum above one. */
function unexpressible(edge: EdgeTypeIR): string[] {
  const out: string[] = []
  for (const end of ['from', 'to'] as const) {
    const b = edge.cardinality[end]
    if (b.min > 0) out.push(`a minimum of ${b.min} on '${end}'`)
    if (b.max !== null && b.max > 1) out.push(`a maximum of ${b.max} on '${end}'`)
  }
  return out
}

interface EdgeTable {
  name: string
  label: string
  from: NodeTypeIR
  to: NodeTypeIR
  srcCols: string[]
  dstCols: string[]
  props: PropertyIR[]
  sql: string
}

function edgeTables(
  model: ModelIR, edge: EdgeTypeIR, taken: Set<string>, diags: Diagnostic[],
): EdgeTable[] {
  const pairs = endpointNodePairs(model, edge)
  if (pairs.length === 0) {
    downgrade(diags, 'sqlpgq', 'no-concrete-endpoint',
      `Edge type '${edge.name}' connects '${edge.from}' to '${edge.to}', but one side has no concrete node type, so no edge table can be created.`,
      edge.loc)
    return []
  }
  const expanded = pairs.length > 1
  if (expanded) {
    downgrade(diags, 'sqlpgq', 'downgrade-edge-expansion',
      `Edge type '${edge.name}' reaches an abstract endpoint, so it is ${pairs.length} edge tables, each with its own label. A DuckDB property graph requires every label to be unique, so no single label '${edge.name}' covers them.`,
      edge.loc)
  }

  const maxOne = { to: edge.cardinality.to.max === 1, from: edge.cardinality.from.max === 1 }
  const lost = unexpressible(edge)
  if (lost.length > 0) {
    downgrade(diags, 'sqlpgq', 'downgrade-cardinality',
      `Edge type '${edge.name}' declares ${describeCardinality(edge.cardinality)} cardinality. SQL constraints express only an upper bound of one per end, so ${lost.join(' and ')} ${lost.length > 1 ? 'are' : 'is'} unenforced.`,
      edge.loc)
  }
  if (expanded && (maxOne.to || maxOne.from)) {
    downgrade(diags, 'sqlpgq', 'downgrade-cardinality-expanded',
      `Edge type '${edge.name}' bounds an end at one, but its ${pairs.length} edge tables are separate, so the bound holds within each table and not across them.`,
      edge.loc)
  }

  return pairs.map(([from, to]) => {
    let name = expanded ? `${edge.name}_${from.name}_${to.name}` : edge.name
    if (taken.has(name.toLowerCase())) {
      const renamed = `${name}_edge`
      constraintDowngrade(diags, 'sqlpgq', 'sqlpgq-name-collision',
        `Edge table '${name}' collides with another table, since DuckDB names are case-insensitive. It is named '${renamed}'.`,
        edge.loc)
      name = renamed
    }
    taken.add(name.toLowerCase())

    const used = new Set(edge.props.map((p) => p.name.toLowerCase()))
    const generated = (prefix: string, key: string): string => {
      let col = `${prefix}_${key}`
      while (used.has(col.toLowerCase())) col += '_'
      used.add(col.toLowerCase())
      return col
    }
    const srcCols = from.key.map((k) => generated('src', k))
    const dstCols = to.key.map((k) => generated('dst', k))
    const keyType = (node: NodeTypeIR, k: string) => columnType(node.props.find((p) => p.name === k)!)

    const entries: Entry[] = []
    from.key.forEach((k, i) => entries.push({ sql: `${ident(srcCols[i]!)} ${keyType(from, k)} NOT NULL`, comments: [] }))
    to.key.forEach((k, i) => entries.push({ sql: `${ident(dstCols[i]!)} ${keyType(to, k)} NOT NULL`, comments: [] }))
    for (const p of edge.props) entries.push(columnEntry(edge.name, p, p.required, p.unique, diags))
    entries.push({
      sql: `FOREIGN KEY (${srcCols.map(ident).join(', ')}) REFERENCES ${ident(from.name)} (${from.key.map(ident).join(', ')})`,
      comments: [],
    })
    entries.push({
      sql: `FOREIGN KEY (${dstCols.map(ident).join(', ')}) REFERENCES ${ident(to.name)} (${to.key.map(ident).join(', ')})`,
      comments: [],
    })
    // `to` bounds how many targets one source has, so at most one is a source-side unique.
    if (!expanded && maxOne.to) {
      entries.push({ sql: `UNIQUE (${srcCols.map(ident).join(', ')})`, comments: ['-- at most one target per source: enforced on write.'] })
    }
    if (!expanded && maxOne.from) {
      entries.push({ sql: `UNIQUE (${dstCols.map(ident).join(', ')})`, comments: ['-- at most one source per target: enforced on write.'] })
    }
    const head: string[] = []
    if (expanded) head.push(`-- '${edge.from}' and/or '${edge.to}' are abstract; this is the ${from.name} → ${to.name} pair.`)
    if (!isUnconstrained(edge.cardinality) && lost.length > 0) {
      head.push(`-- UNENFORCED: ${lost.join(' and ')}.`)
    }
    const sql = [...head, render(`CREATE TABLE IF NOT EXISTS ${ident(name)}`, entries)].join('\n')
    return { name, label: name, from, to, srcCols, dstCols, props: edge.props, sql }
  })
}

export function emitSqlPgq(model: ModelIR, _options: EmitOptions = {}): EmitResult {
  const diagnostics: Diagnostic[] = []
  const parts: string[] = [
    '-- Generated by lpg-modeler. Target: sqlpgq (DuckDB with the duckpgq extension).',
    `-- Model: ${model.namespace.prefix} <${model.namespace.iri}>`,
    '--',
    '-- Tables carry the constraints; the property graph at the end maps them. Abstract node',
    '-- types are flattened to one table per concrete type, with inherited columns copied down.',
    '-- Run with: INSTALL duckpgq FROM community; LOAD duckpgq; then this script.',
    '-- See lat.md/emitters#SQL/PGQ Target.',
    '',
  ]

  for (const e of model.enums) {
    parts.push(`CREATE TYPE IF NOT EXISTS ${ident(e.name)} AS ENUM (${e.values.map(str).join(', ')});`, '')
  }

  const abstracts = model.nodes.filter((n) => n.abstract)
  if (abstracts.length > 0) {
    parts.push(`-- Abstract, no table emitted: ${abstracts.map((a) => a.name).join(', ')}`, '')
  }

  const concrete = concreteNodes(model)
  const taken = new Set<string>()
  for (const node of concrete) {
    parts.push(nodeTable(node, diagnostics), '')
    taken.add(node.name.toLowerCase())
  }
  const edges: EdgeTable[] = []
  for (const edge of model.edges) {
    for (const table of edgeTables(model, edge, taken, diagnostics)) {
      edges.push(table)
      parts.push(table.sql, '')
    }
  }

  if (concrete.length === 0) {
    parts.push('-- No concrete node type, so there is no property graph to create.')
  } else {
    const vertex = concrete.map((n) =>
      `    ${ident(n.name)} PROPERTIES (${n.props.map((p) => ident(p.name)).join(', ')}) LABEL ${ident(n.name)}`)
    const edgeLines = edges.map((t) => {
      const props = t.props.length > 0 ? `PROPERTIES (${t.props.map((p) => ident(p.name)).join(', ')})` : 'NO PROPERTIES'
      return `    ${ident(t.name)} SOURCE KEY (${t.srcCols.map(ident).join(', ')}) REFERENCES ${ident(t.from.name)} (${t.from.key.map(ident).join(', ')})`
        + ` DESTINATION KEY (${t.dstCols.map(ident).join(', ')}) REFERENCES ${ident(t.to.name)} (${t.to.key.map(ident).join(', ')})`
        + ` ${props} LABEL ${ident(t.label)}`
    })
    parts.push(
      `CREATE OR REPLACE PROPERTY GRAPH ${ident(model.namespace.prefix)}`,
      '  VERTEX TABLES (', vertex.join(',\n'), '  )')
    if (edgeLines.length > 0) parts.push('  EDGE TABLES (', edgeLines.join(',\n'), '  )')
    parts[parts.length - 1] += ';'
  }

  reportUnsupportedConstraints(diagnostics, 'sqlpgq', model, SQLPGQ_CAPABILITIES)

  return { target: 'sqlpgq', extension: 'sql', content: parts.join('\n') + '\n', diagnostics }
}
