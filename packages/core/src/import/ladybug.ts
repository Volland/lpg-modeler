import {
  canonicalCardinality, err, info, warn, parsePropertyType,
  type Diagnostic, type EdgeTypeIR, type ModelIR,
  type NodeTypeIR, type PropertyIR,
} from '../ir'
import { deriveId } from '../ids'
import type { ImportResult, TextImportInput } from './rdf'

/**
 * Reads a LadybugDB schema back into a model, from either of the two places it lives: a
 * DDL script or a database's own catalog. Both are first read into one plain catalog,
 * and a single builder turns that into the IR, so the two sources cannot drift apart.
 * The schema carries an edge's endpoints and the exact width of every column, because
 * the metamodel's scalars were drawn from what this engine stores. What it cannot carry
 * is the abstract hierarchy: a table is emitted per concrete type with inherited columns
 * copied down. See lat.md/importers#Reading LadybugDB DDL.
 */

export interface LadybugColumn {
  name: string
  /** The engine's own spelling, e.g. `DECIMAL(10, 2)` or `STRUCT(lat DOUBLE, lon DOUBLE)`. */
  type: string
}

export interface LadybugNodeTable {
  kind: 'node'
  name: string
  columns: LadybugColumn[]
  primaryKey: string[]
  comment?: string
}

export interface LadybugRelTable {
  kind: 'rel'
  name: string
  columns: LadybugColumn[]
  pairs: Array<[string, string]>
  /** `MANY_ONE` and the like. A DDL script says it; the database catalog does not. */
  multiplicity?: string
  comment?: string
}

/**
 * The schema of a LadybugDB database as plain data, whichever source it was read from.
 * Tables keep the order they were declared in, so diagnostics come out in that order.
 */
export interface LadybugCatalog {
  tables: Array<LadybugNodeTable | LadybugRelTable>
}

/** A database that has already been read, standing in for a file in an import. */
export interface CatalogImportInput {
  path: string
  ladybugCatalog: LadybugCatalog
}

export type LadybugSource = 'ddl' | 'database'

/** Splits on commas that are not inside a nested type like `STRUCT(a INT64, b INT64)`. */
function topLevelSplit(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      out.push(body.slice(start, i))
      start = i + 1
    }
  }
  out.push(body.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}

const STATEMENT =
  /CREATE\s+(NODE|REL)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)/i

/** `vin STRING` or `location STRUCT(lat DOUBLE, lon DOUBLE)`. */
const COLUMN = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/

/**
 * A DDL script as a catalog. Comments carry the downgrade notes and the abstract types
 * that emitted no table; they are prose for an operator, not a machine-readable record,
 * so they are dropped.
 */
export function parseLadybugDdl(text: string): LadybugCatalog {
  const tables: LadybugCatalog['tables'] = []
  const stripped = text.replace(/\/\/[^\n]*/g, '')

  for (const raw of stripped.split(';')) {
    const m = STATEMENT.exec(raw)
    if (!m) continue
    const [, kind, name, body] = m as unknown as [string, string, string, string]
    const entries = topLevelSplit(body)

    if (kind.toUpperCase() === 'NODE') {
      const primaryKey: string[] = []
      const columns: LadybugColumn[] = []
      for (const entry of entries) {
        const pk = /^PRIMARY\s+KEY\s*\(([^)]*)\)$/i.exec(entry)
        if (pk) {
          primaryKey.push(...(pk[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean))
          continue
        }
        const c = COLUMN.exec(entry)
        if (c) columns.push({ name: c[1] as string, type: c[2] as string })
      }
      tables.push({ kind: 'node', name, columns, primaryKey })
      continue
    }

    const pairs: Array<[string, string]> = []
    const columns: LadybugColumn[] = []
    let multiplicity: string | undefined
    for (const entry of entries) {
      const fromTo = /^FROM\s+([A-Za-z_][A-Za-z0-9_]*)\s+TO\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(entry)
      if (fromTo) {
        pairs.push([fromTo[1] as string, fromTo[2] as string])
        continue
      }
      if (canonicalCardinality(entry)) { multiplicity = entry; continue }
      const c = COLUMN.exec(entry)
      if (c) columns.push({ name: c[1] as string, type: c[2] as string })
    }
    tables.push({ kind: 'rel', name, columns, pairs, ...(multiplicity ? { multiplicity } : {}) })
  }
  return { tables }
}

/**
 * The result columns each catalog query is read by. LadybugDB names several of them
 * with spaces, and a future release could rename one, so they live in one place and a
 * missing one is reported rather than read as an empty value.
 */
const CATALOG_COLUMNS = {
  show_tables: ['id', 'name', 'type', 'database name', 'comment'],
  table_info_node: ['name', 'type', 'primary key'],
  table_info_rel: ['name', 'type'],
  show_connection: ['source table name', 'destination table name'],
} as const

/** The part of a LadybugDB connection the catalog reader uses. */
export interface LadybugConnection {
  query(statement: string): Promise<LadybugQueryResult | LadybugQueryResult[]>
}

export interface LadybugQueryResult {
  getAll(): Promise<Array<Record<string, unknown>>>
}

/** A table name inside a single-quoted Cypher string. */
const quote = (name: string) => `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/**
 * Reads a database's catalog through a connection the caller opened. `core` never loads
 * the engine itself -- it carries native bindings, and the extension inlines `core` --
 * so the command line opens the database and hands the connection in. Like every reader
 * it never throws: a query the engine refuses yields an `import-catalog` error and what
 * was read before it. See lat.md/importers#Reading a LadybugDB Database.
 */
export async function readLadybugCatalog(
  conn: LadybugConnection,
): Promise<{ catalog: LadybugCatalog; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = []
  const tables: LadybugCatalog['tables'] = []

  const rows = async (
    statement: string, columns: readonly string[],
  ): Promise<Array<Record<string, unknown>> | undefined> => {
    let all: Array<Record<string, unknown>>
    try {
      const result = await conn.query(statement)
      const last = Array.isArray(result) ? result[result.length - 1] : result
      all = last ? await last.getAll() : []
    } catch (e) {
      diagnostics.push(err('import-catalog',
        `LadybugDB refused the catalog query '${statement}': ${(e as Error).message}`))
      return undefined
    }
    const missing = all.length > 0 ? columns.filter((c) => !(c in (all[0] as object))) : []
    if (missing.length > 0) {
      diagnostics.push(err('import-catalog',
        `The catalog query '${statement}' returned no '${missing.join("', '")}' column. This LadybugDB version names its catalog differently from the 0.19.1 this reader was measured against.`))
      return undefined
    }
    return all
  }

  const listed = await rows('CALL show_tables() RETURN *', CATALOG_COLUMNS.show_tables)
  // The catalog lists tables in no particular order. A table id is assigned on creation,
  // so ordering by it gives back declaration order -- the order a script would have had.
  listed?.sort((a, b) => Number(a.id) - Number(b.id))
  for (const t of listed ?? []) {
    // An attached database lists its tables here too, under its own name.
    if (!String(t['database name']).startsWith('main')) continue
    const name = String(t.name)
    const kind = String(t.type).toUpperCase()
    const comment = t.comment ? String(t.comment) : undefined

    if (kind === 'NODE') {
      const cols = await rows(`CALL table_info(${quote(name)}) RETURN *`, CATALOG_COLUMNS.table_info_node)
      if (!cols) continue
      tables.push({
        kind: 'node',
        name,
        columns: cols.map((c) => ({ name: String(c.name), type: String(c.type) })),
        primaryKey: cols.filter((c) => c['primary key'] === true).map((c) => String(c.name)),
        ...(comment ? { comment } : {}),
      })
    } else if (kind === 'REL') {
      const cols = await rows(`CALL table_info(${quote(name)}) RETURN *`, CATALOG_COLUMNS.table_info_rel)
      const ends = await rows(`CALL show_connection(${quote(name)}) RETURN *`, CATALOG_COLUMNS.show_connection)
      if (!cols || !ends) continue
      tables.push({
        kind: 'rel',
        name,
        columns: cols.map((c) => ({ name: String(c.name), type: String(c.type) })),
        pairs: ends.map((e) => [String(e['source table name']), String(e['destination table name'])]),
        ...(comment ? { comment } : {}),
      })
    }
  }
  return { catalog: { tables }, diagnostics }
}

/**
 * LadybugDB spells the 32-bit float `FLOAT`, where the metamodel reads a bare `FLOAT`
 * as the 64-bit one -- the only place the engine's spellings and the model's disagree.
 * Reading the DDL with the generic table would widen every `FLOAT32` to a `DOUBLE`,
 * which is the opposite of why the DDL is consulted. Applied to the whole spelling so
 * it reaches inside a nested composite too.
 */
function ladybugDialect(written: string): string {
  return written.replace(/\bFLOAT\b(?![0-9])/g, 'FLOAT32')
}

function column(col: LadybugColumn, owner: string, diagnostics: Diagnostic[]): PropertyIR | undefined {
  const { name, type: written } = col
  const parsed = parsePropertyType(ladybugDialect(written))
  if (!parsed) {
    diagnostics.push(warn('import-type',
      `Column '${owner}.${name}' has type '${written}', which is not a type this metamodel knows. The column was skipped.`))
    return undefined
  }
  return {
    id: deriveId('prop', name, owner),
    name,
    type: parsed.type,
    list: parsed.list,
    required: false,
    unique: false,
    ...(parsed.composite ? { composite: parsed.composite } : {}),
    ...(parsed.precision !== undefined ? { precision: parsed.precision } : {}),
    ...(parsed.scale !== undefined ? { scale: parsed.scale } : {}),
  }
}

export interface LadybugContext {
  /** Child type name to parent, from a hierarchy another artifact carried. */
  parents?: Map<string, string>
}

const LOSSY: Record<LadybugSource, string> = {
  ddl: 'LadybugDB DDL is emitted one table per concrete type, so an abstract hierarchy, mixins, enums and value constraints are not in it. Only a primary key records that a property is required.',
  database: 'A LadybugDB catalog holds one table per concrete type, so an abstract hierarchy, mixins, enums and value constraints are not in it. Only a primary key records that a property is required.',
}

/**
 * Builds the IR from one or more catalogs. Every rule the two sources share lives here:
 * the float spelling, the type reader, a key being required, and collapsing an expanded
 * endpoint set. Each catalog says which kind of source it came from, because what a
 * script and a database fail to carry is not quite the same.
 */
export function catalogToModel(
  catalogs: Array<{ source: LadybugSource; catalog: LadybugCatalog }>,
  file: string, context: LadybugContext = {},
): ImportResult {
  const diagnostics: Diagnostic[] = []
  const nodes: NodeTypeIR[] = []
  const edges: EdgeTypeIR[] = []
  const unknownMultiplicity: string[] = []
  const seen = new Set<string>()

  const tables = catalogs.flatMap(({ source, catalog }) => catalog.tables.map((table) => ({ source, table })))
  for (const { source, table } of tables) {
    if (seen.has(table.name)) {
      diagnostics.push(warn('import-duplicate-table',
        `Table '${table.name}' appears in more than one LadybugDB source in this import. The first was kept.`))
      continue
    }
    seen.add(table.name)
    if (table.comment) {
      diagnostics.push(info('import-comment',
        `Table '${table.name}' has a comment, which was not imported: the model has no place to hold a description.`))
    }

    if (table.kind === 'node') {
      const props: PropertyIR[] = []
      for (const col of table.columns) {
        const p = column(col, table.name, diagnostics)
        if (p) props.push(p)
      }
      // A key column is never null, which is the one required-ness the schema records.
      for (const p of props) if (table.primaryKey.includes(p.name)) p.required = true
      nodes.push({
        id: deriveId('node', table.name),
        name: table.name,
        qname: table.name,
        iri: table.name,
        prefix: '',
        abstract: false,
        open: false,
        ancestors: [],
        mixins: [],
        key: [...table.primaryKey],
        props,
        constraints: [],
      })
      continue
    }

    const props: PropertyIR[] = []
    for (const col of table.columns) {
      const p = column(col, table.name, diagnostics)
      if (p) props.push(p)
    }
    if (table.pairs.length === 0) continue

    const cardinality = table.multiplicity ? canonicalCardinality(table.multiplicity) : undefined
    if (!table.multiplicity && source === 'database') unknownMultiplicity.push(table.name)
    const [from, to] = collapse(table.name, table.pairs, context.parents, diagnostics)
    edges.push({
      id: deriveId('edge', table.name),
      name: table.name,
      qname: table.name,
      iri: table.name,
      prefix: '',
      from,
      to,
      props,
      cardinality: cardinality ?? { from: { min: 0, max: null }, to: { min: 0, max: null } },
    })
  }

  for (const source of new Set(catalogs.map((c) => c.source))) {
    diagnostics.push(info('import-lossy', LOSSY[source]))
  }
  if (unknownMultiplicity.length > 0) {
    diagnostics.push(info('import-multiplicity',
      `LadybugDB's catalog does not record rel multiplicity (ONE_ONE, MANY_ONE, …), so ${unknownMultiplicity.length === 1 ? 'edge' : 'edges'} ${unknownMultiplicity.sort().join(', ')} ${unknownMultiplicity.length === 1 ? 'was' : 'were'} imported with unconstrained cardinality. Import the DDL alongside the database to recover it.`))
  }

  return {
    model: {
      file,
      namespace: { prefix: 'model', iri: 'https://example.org/imported#' },
      prefixes: {},
      nodes,
      edges,
      mixins: [],
      enums: [],
    },
    diagnostics,
  }
}

/**
 * Reads DDL scripts and already-read database catalogs together. A table read from a
 * script comes before one read from a database, so a script's multiplicity wins.
 */
export function importLadybug(
  inputs: Array<TextImportInput | CatalogImportInput>, context: LadybugContext = {},
): ImportResult {
  const catalogs: Array<{ source: LadybugSource; catalog: LadybugCatalog }> = []
  const texts = inputs.filter((i): i is TextImportInput => 'text' in i)
  if (texts.length > 0) {
    catalogs.push({ source: 'ddl', catalog: parseLadybugDdl(texts.map((i) => i.text).join('\n')) })
  }
  for (const input of inputs) {
    if ('ladybugCatalog' in input) catalogs.push({ source: 'database', catalog: input.ladybugCatalog })
  }
  return catalogToModel(catalogs, inputs[0]?.path ?? '', context)
}

/**
 * An edge on an abstract endpoint was expanded to one pair per concrete subtype. Given
 * a hierarchy from another artifact in the same import, a set of pairs that is exactly
 * the concrete descendants of one type collapses back to that type. Without a hierarchy
 * there is nothing to collapse to, so the first pair stands and the rest are reported.
 */
function collapse(
  edge: string, pairs: Array<[string, string]>,
  parents: Map<string, string> | undefined, diagnostics: Diagnostic[],
): [string, string] {
  const first = pairs[0] as [string, string]
  if (pairs.length === 1) return first

  if (parents) {
    const generalise = (names: string[]): string => {
      const chain = (n: string): string[] => {
        const out = [n]
        let cur = n
        while (parents.get(cur)) { cur = parents.get(cur) as string; out.push(cur) }
        return out
      }
      for (const candidate of chain(names[0] as string)) {
        if (names.every((n) => chain(n).includes(candidate))) return candidate
      }
      return names[0] as string
    }
    const from = generalise(pairs.map(([f]) => f))
    const to = generalise(pairs.map(([, t]) => t))
    if (pairs.every(([f, t]) => chainHas(parents, f, from) && chainHas(parents, t, to))) {
      diagnostics.push(info('import-collapsed',
        `Edge '${edge}' was expanded to ${pairs.length} endpoint pairs by the generator; the hierarchy in this import collapses them back to (${from})->(${to}).`))
      return [from, to]
    }
  }

  diagnostics.push(warn('import-endpoints',
    `Edge '${edge}' declares ${pairs.length} endpoint pairs, which happens when the model had an abstract endpoint. Without a hierarchy there is nothing to collapse them to, so (${first[0]})->(${first[1]}) was kept and the rest dropped. Import the OWL ontology alongside the DDL to recover the abstract endpoint.`))
  return first
}

function chainHas(parents: Map<string, string>, from: string, target: string): boolean {
  let cur: string | undefined = from
  while (cur) {
    if (cur === target) return true
    cur = parents.get(cur)
  }
  return false
}
