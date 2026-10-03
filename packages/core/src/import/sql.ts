import type {
  Cardinality, Diagnostic, EdgeTypeIR, EnumIR, ModelIR, NodeTypeIR, PropertyIR, ScalarType,
} from '../ir'
import { DEFAULT_CARDINALITY, err, info, warn } from '../ir'
import { deriveId } from '../ids'
import type { ImportResult, TextImportInput } from './rdf'

/**
 * Reads a SQL DDL dump — what `pg_dump --schema-only` writes, or hand-written CREATE
 * TABLEs — into the IR. A foreign key becomes an edge, a join table becomes an edge
 * type, and everything inferred or skipped is reported, in the importers' standing
 * voice. See lat.md/importers#Reading SQL DDL.
 */

interface SqlColumn {
  name: string
  /** The type text as written, e.g. `character varying(255)` or `text[]`. */
  sqlType: string
  notNull: boolean
  unique: boolean
}

interface SqlForeignKey {
  /** The constraint name, when one was written. */
  name?: string
  columns: string[]
  refTable: string
}

interface SqlTable {
  name: string
  columns: SqlColumn[]
  pk: string[]
  /** Column sets declared unique by table constraints or unique indexes. */
  uniques: string[][]
  fks: SqlForeignKey[]
}

interface SqlCatalog {
  tables: SqlTable[]
  /** CREATE TYPE … AS ENUM, by the type's written name. */
  enums: Map<string, string[]>
  /** Statements that were not read, counted by their leading keywords. */
  skipped: Map<string, number>
}

/**
 * Split on `;` outside quotes. Line and block comments are dropped here too, so the
 * per-statement readers never meet one. Dollar-quoted bodies (`$$…$$`, `$tag$…$tag$`)
 * are respected, because a function body may contain semicolons.
 */
export function splitSqlStatements(text: string): string[] {
  const out: string[] = []
  let current = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    const two = text.slice(i, i + 2)
    if (two === '--') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
      continue
    }
    if (c === "'" || c === '"') {
      const quote = c
      current += c
      i += 1
      while (i < text.length) {
        current += text[i]
        // A doubled quote is an escaped quote, not the end.
        if (text[i] === quote) {
          if (text[i + 1] === quote) { current += quote; i += 2; continue }
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i))?.[0]
      if (tag) {
        const end = text.indexOf(tag, i + tag.length)
        const stop = end < 0 ? text.length : end + tag.length
        current += text.slice(i, stop)
        i = stop
        continue
      }
    }
    if (c === ';') {
      if (current.trim()) out.push(current.trim())
      current = ''
      i += 1
      continue
    }
    current += c
    i += 1
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/** An identifier as written: quotes removed, a schema qualifier dropped. */
const ident = (raw: string): string => {
  const parts = raw.trim().split('.')
  const last = parts[parts.length - 1]!.trim()
  return last.startsWith('"') ? last.slice(1, -1).replace(/""/g, '"') : last
}

/** Split a parenthesised body on top-level commas, honouring nested parens and quotes. */
function topLevelSplit(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!
    if (c === "'" || c === '"') {
      const quote = c
      current += c
      i += 1
      while (i < body.length) {
        current += body[i]
        if (body[i] === quote && body[i + 1] !== quote) break
        if (body[i] === quote) { current += quote; i += 1 }
        i += 1
      }
      continue
    }
    if (c === '(') depth += 1
    if (c === ')') depth -= 1
    if (c === ',' && depth === 0) { out.push(current.trim()); current = ''; continue }
    current += c
  }
  if (current.trim()) out.push(current.trim())
  return out
}

const columnList = (parens: string): string[] => topLevelSplit(parens).map(ident)

/** The parenthesised group starting at `from`, with the matching close found by depth. */
function parenGroup(text: string, from: number): { body: string; end: number } | undefined {
  const open = text.indexOf('(', from)
  if (open < 0) return undefined
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth += 1
    if (text[i] === ')') {
      depth -= 1
      if (depth === 0) return { body: text.slice(open + 1, i), end: i + 1 }
    }
  }
  return undefined
}

/** Keywords that end a column's type text and start its modifiers. */
const MODIFIERS = /^(NOT|NULL|PRIMARY|UNIQUE|DEFAULT|REFERENCES|CHECK|CONSTRAINT|GENERATED|COLLATE)$/i

/** One entry of a CREATE TABLE body, into the table being built. */
function readTableEntry(entry: string, table: SqlTable, diagnostics: Diagnostic[]): void {
  let rest = entry
  let constraintName: string | undefined
  const named = /^CONSTRAINT\s+("(?:[^"]|"")+"|\S+)\s+/i.exec(rest)
  if (named) {
    constraintName = ident(named[1]!)
    rest = rest.slice(named[0].length)
  }

  const tablePk = /^PRIMARY\s+KEY\s*\(/i.exec(rest)
  if (tablePk) {
    const group = parenGroup(rest, 0)
    if (group) table.pk = columnList(group.body)
    return
  }
  const tableUnique = /^UNIQUE\s*\(/i.exec(rest)
  if (tableUnique) {
    const group = parenGroup(rest, 0)
    if (group) table.uniques.push(columnList(group.body))
    return
  }
  const tableFk = /^FOREIGN\s+KEY\s*\(/i.exec(rest)
  if (tableFk) {
    const cols = parenGroup(rest, 0)
    const refMatch = cols && /REFERENCES\s+("(?:[^"]|"")+"|[\w.]+)/i.exec(rest.slice(cols.end))
    if (cols && refMatch) {
      table.fks.push({
        ...(constraintName ? { name: constraintName } : {}),
        columns: columnList(cols.body),
        refTable: ident(refMatch[1]!),
      })
    }
    return
  }
  if (constraintName && /^(CHECK|EXCLUDE)\b/i.test(rest)) return
  if (/^(LIKE|CHECK|EXCLUDE)\b/i.test(rest)) return

  // A column: name, then the type up to the first modifier keyword, then modifiers.
  const nameMatch = /^("(?:[^"]|"")+"|[\w$]+)\s+/.exec(rest)
  if (!nameMatch) {
    diagnostics.push(warn('import-sql-entry',
      `Could not read a CREATE TABLE entry of '${table.name}': ${entry.slice(0, 60)}`))
    return
  }
  const name = ident(nameMatch[1]!)
  rest = rest.slice(nameMatch[0].length)

  // Scan word by word; parenthesised parameters and `[]` belong to the type.
  let type = ''
  let m: RegExpExecArray | null
  const word = /^\s*(\(|\[\s*\d*\s*\]|"(?:[^"]|"")+"|[^\s([\]]+)/
  while ((m = word.exec(rest))) {
    const token = m[1]!
    if (token === '(') {
      const group = parenGroup(rest, 0)
      if (!group) break
      type += `(${group.body})`
      rest = rest.slice(group.end)
      continue
    }
    if (MODIFIERS.test(token)) break
    type += (type && !token.startsWith('[') ? ' ' : '') + token
    rest = rest.slice(m[0].length)
  }

  const column: SqlColumn = {
    name, sqlType: type.trim(),
    notNull: /\bNOT\s+NULL\b/i.test(rest),
    unique: /\bUNIQUE\b/i.test(rest),
  }
  if (/\bPRIMARY\s+KEY\b/i.test(rest)) table.pk = [name]
  const refs = /\bREFERENCES\s+("(?:[^"]|"")+"|[\w.]+)/i.exec(rest)
  if (refs) table.fks.push({ columns: [name], refTable: ident(refs[1]!) })
  table.columns.push(column)
}

/** Read the statements into a flat catalog; nothing is interpreted yet. */
export function readSqlCatalog(text: string, diagnostics: Diagnostic[]): SqlCatalog {
  const catalog: SqlCatalog = { tables: [], enums: new Map(), skipped: new Map() }
  const tableByName = new Map<string, SqlTable>()

  for (const statement of splitSqlStatements(text)) {
    const createTable = /^CREATE\s+(?:UNLOGGED\s+|TEMPORARY\s+|TEMP\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("(?:[^"]|"")+"|[\w.]+)/i.exec(statement)
    if (createTable) {
      const name = ident(createTable[1]!)
      const group = parenGroup(statement, createTable[0].length - createTable[1]!.length)
      const table: SqlTable = { name, columns: [], pk: [], uniques: [], fks: [] }
      if (group) {
        for (const entry of topLevelSplit(group.body)) readTableEntry(entry, table, diagnostics)
      }
      catalog.tables.push(table)
      tableByName.set(name, table)
      continue
    }

    const createEnum = /^CREATE\s+TYPE\s+("(?:[^"]|"")+"|[\w.]+)\s+AS\s+ENUM\s*\(/i.exec(statement)
    if (createEnum) {
      const group = parenGroup(statement, createEnum[0].length - 1)
      const values = group ? topLevelSplit(group.body)
        .map((v) => v.trim().replace(/^'|'$/g, '').replace(/''/g, "'")) : []
      catalog.enums.set(ident(createEnum[1]!), values)
      continue
    }

    const alter = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?("(?:[^"]|"")+"|[\w.]+)\s+ADD\s+(CONSTRAINT\s+("(?:[^"]|"")+"|\S+)\s+)?(.*)$/is.exec(statement)
    if (alter) {
      const table = tableByName.get(ident(alter[1]!))
      if (table) {
        const body = `${alter[2] ?? ''}${alter[4] ?? ''}`
        readTableEntry(body, table, diagnostics)
        continue
      }
    }

    const uniqueIndex = /^CREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:"(?:[^"]|"")+"|\S+)\s+ON\s+(?:ONLY\s+)?("(?:[^"]|"")+"|[\w.]+)/i.exec(statement)
    if (uniqueIndex) {
      const table = tableByName.get(ident(uniqueIndex[1]!))
      const group = parenGroup(statement, uniqueIndex[0].length)
      if (table && group) {
        table.uniques.push(columnList(group.body))
        continue
      }
    }

    const kind = (statement.match(/^\w+(\s+\w+)?/)?.[0] ?? 'unknown').toUpperCase().replace(/\s+/g, ' ')
    catalog.skipped.set(kind, (catalog.skipped.get(kind) ?? 0) + 1)
  }
  return catalog
}

/** The scalar each SQL type maps onto; `serial` additionally notes the lost sequence. */
const SQL_TYPES: Record<string, { type: ScalarType; serial?: true }> = {
  'smallint': { type: 'int16' }, 'int2': { type: 'int16' },
  'integer': { type: 'int32' }, 'int': { type: 'int32' }, 'int4': { type: 'int32' },
  'bigint': { type: 'int' }, 'int8': { type: 'int' },
  'smallserial': { type: 'int16', serial: true }, 'serial2': { type: 'int16', serial: true },
  'serial': { type: 'int32', serial: true }, 'serial4': { type: 'int32', serial: true },
  'bigserial': { type: 'int', serial: true }, 'serial8': { type: 'int', serial: true },
  'real': { type: 'float32' }, 'float4': { type: 'float32' },
  'double precision': { type: 'float' }, 'float8': { type: 'float' },
  'numeric': { type: 'decimal' }, 'decimal': { type: 'decimal' },
  'boolean': { type: 'boolean' }, 'bool': { type: 'boolean' },
  'text': { type: 'string' }, 'character varying': { type: 'string' }, 'varchar': { type: 'string' },
  'character': { type: 'string' }, 'char': { type: 'string' }, 'bpchar': { type: 'string' },
  'citext': { type: 'string' },
  'uuid': { type: 'uuid' },
  'bytea': { type: 'blob' },
  'json': { type: 'json' }, 'jsonb': { type: 'json' },
  'date': { type: 'date' },
  'timestamp': { type: 'datetime' }, 'timestamp without time zone': { type: 'datetime' },
  'timestamptz': { type: 'zoneddatetime' }, 'timestamp with time zone': { type: 'zoneddatetime' },
  'interval': { type: 'duration' },
}

/** `varchar(255)` keeps its length; `numeric(10,2)` its precision. */
interface ReadColumnType {
  type: ScalarType
  list: boolean
  maxLength?: number
  precision?: number
  scale?: number
  enumName?: string
  serial?: boolean
  foreign?: string
}

function readColumnType(sqlType: string, enums: Map<string, string[]>): ReadColumnType {
  let t = sqlType.trim()
  let list = false
  const array = /\[\s*\d*\s*\]\s*$/.exec(t)
  if (array) { list = true; t = t.slice(0, array.index).trim() }

  const params = /^(.*?)\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/.exec(t)
  const base = (params ? params[1]! : t).trim().toLowerCase().replace(/\s+/g, ' ')

  if (enums.has(t) || enums.has(base)) return { type: 'string', list, enumName: enums.has(t) ? t : base }

  const mapped = SQL_TYPES[base]
  if (!mapped) return { type: 'string', list, foreign: sqlType }
  const out: ReadColumnType = { type: mapped.type, list, ...(mapped.serial ? { serial: true } : {}) }
  if (params && (base === 'numeric' || base === 'decimal')) {
    out.precision = Number(params[2])
    out.scale = Number(params[3] ?? 0)
  } else if (params && ['character varying', 'varchar', 'character', 'char', 'bpchar'].includes(base)) {
    out.maxLength = Number(params[2])
  }
  return out
}

const pascal = (s: string): string => s.split(/[^A-Za-z0-9]+/).filter(Boolean)
  .map((w) => w[0]!.toUpperCase() + w.slice(1)).join('') || s

const upperSnake = (s: string): string =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()

/** An edge's name: the constraint's, else the column's minus its `_id`/`_fk` tail. */
const edgeNameFor = (fk: SqlForeignKey): string => {
  if (fk.name) return upperSnake(fk.name)
  const col = fk.columns[0] ?? fk.refTable
  return upperSnake(col.replace(/_(id|fk)$/i, ''))
}

/** Whether a table is exactly a join table: its primary key is its two single-column FKs. */
function isJoinTable(table: SqlTable): boolean {
  const single = table.fks.filter((f) => f.columns.length === 1)
  if (single.length !== 2 || table.fks.length !== 2 || table.pk.length !== 2) return false
  const fkCols = new Set(single.map((f) => f.columns[0]!))
  return fkCols.size === 2 && table.pk.every((c) => fkCols.has(c))
}

export function sqlCatalogToModel(catalog: SqlCatalog, file: string): ImportResult {
  const diagnostics: Diagnostic[] = []
  const renamed: string[] = []
  const typeName = (table: string): string => {
    const name = pascal(table)
    if (name !== table && !renamed.includes(`${table}→${name}`)) renamed.push(`${table}→${name}`)
    return name
  }

  const enums: EnumIR[] = [...catalog.enums.entries()].map(([name, values]) => ({
    id: deriveId('enum', pascal(name)), name: pascal(name), qname: pascal(name), iri: pascal(name),
    prefix: '', values,
  }))
  for (const [name] of catalog.enums) {
    if (pascal(name) !== name) renamed.push(`${name}→${pascal(name)}`)
  }
  const enumName = new Map([...catalog.enums.keys()].map((n) => [n, pascal(n)]))

  const joinTables = new Set(catalog.tables.filter(isJoinTable).map((t) => t.name))
  const nodeName = new Map(catalog.tables.filter((t) => !joinTables.has(t.name))
    .map((t) => [t.name, typeName(t.name)]))

  const nodes: NodeTypeIR[] = []
  const edges: EdgeTypeIR[] = []
  const edgeNames = new Set<string>()
  const uniqueEdgeName = (base: string): string => {
    let name = base
    for (let i = 2; edgeNames.has(name); i++) name = `${base}_${i}`
    edgeNames.add(name)
    return name
  }

  const toProp = (owner: string, table: SqlTable, c: SqlColumn): PropertyIR => {
    const read = readColumnType(c.sqlType, catalog.enums)
    if (read.foreign) {
      diagnostics.push(info('import-foreign-datatype',
        `Column '${table.name}.${c.name}' has SQL type '${read.foreign}', which has no scalar here. It is read as a string.`))
    }
    if (read.serial) {
      diagnostics.push(info('import-serial',
        `Column '${table.name}.${c.name}' is a serial: its integer type is kept, but the sequence that fills it is not part of the model.`))
    }
    const unique = c.unique || table.uniques.some((u) => u.length === 1 && u[0] === c.name)
    return {
      id: deriveId('prop', c.name, owner), name: c.name,
      type: read.type, list: read.list,
      required: c.notNull || table.pk.includes(c.name),
      unique,
      ...(read.maxLength !== undefined ? { maxLength: read.maxLength } : {}),
      ...(read.precision !== undefined ? { precision: read.precision, scale: read.scale } : {}),
      ...(read.enumName !== undefined ? { enum: enumName.get(read.enumName)! } : {}),
    }
  }

  /** The cardinality a single-column FK means: many rows, at most one target each. */
  const fkCardinality = (table: SqlTable, fk: SqlForeignKey): Cardinality => {
    const col = table.columns.find((c) => c.name === fk.columns[0])
    const notNull = col?.notNull ?? false
    const unique = (col?.unique ?? false)
      || table.uniques.some((u) => u.length === 1 && u[0] === fk.columns[0])
    return {
      from: { min: 0, max: unique ? 1 : null },
      to: { min: notNull ? 1 : 0, max: 1 },
    }
  }

  for (const table of catalog.tables) {
    if (joinTables.has(table.name)) {
      const [a, b] = table.fks
      const fromTable = a!.columns[0] === table.pk[0] ? a! : b!
      const toTable = fromTable === a ? b! : a!
      const from = nodeName.get(fromTable.refTable)
      const to = nodeName.get(toTable.refTable)
      if (!from || !to) {
        diagnostics.push(err('import-unresolved-reference',
          `Join table '${table.name}' references '${fromTable.refTable}' and '${toTable.refTable}', and at least one is not a table this file creates.`))
        continue
      }
      const name = uniqueEdgeName(upperSnake(table.name))
      const fkCols = new Set(table.fks.flatMap((f) => f.columns))
      const edge: EdgeTypeIR = {
        id: deriveId('edge', name), name, qname: name, iri: name, prefix: '',
        from, to, cardinality: DEFAULT_CARDINALITY(), props: [],
      }
      edge.props = table.columns.filter((c) => !fkCols.has(c.name)).map((c) => toProp(name, table, c))
      edges.push(edge)
      diagnostics.push(info('import-join-table',
        `Table '${table.name}' is read as edge type '${name}: ${from} → ${to}': its primary key is exactly its two foreign keys. Its other columns are the edge's properties.`))
      continue
    }

    const owner = nodeName.get(table.name)!
    const dropped = new Set<string>()
    for (const fk of table.fks) {
      const to = nodeName.get(fk.refTable)
      if (!to) {
        diagnostics.push(warn('import-unresolved-reference',
          `'${table.name}.${fk.columns.join(', ')}' references '${fk.refTable}', which this file does not create. The column is kept and no edge is declared.`))
        continue
      }
      if (fk.columns.length > 1) {
        const name = uniqueEdgeName(edgeNameFor(fk))
        edges.push({
          id: deriveId('edge', name), name, qname: name, iri: name, prefix: '',
          from: owner, to, cardinality: DEFAULT_CARDINALITY(), props: [],
        })
        diagnostics.push(info('import-fk-edge',
          `Foreign key (${fk.columns.join(', ')}) of '${table.name}' is read as edge type '${name}: ${owner} → ${to}'. Its columns are kept, because a multi-column key has no single property to become.`))
        continue
      }
      const name = uniqueEdgeName(edgeNameFor(fk))
      edges.push({
        id: deriveId('edge', name), name, qname: name, iri: name, prefix: '',
        from: owner, to, cardinality: fkCardinality(table, fk), props: [],
      })
      const inPk = table.pk.includes(fk.columns[0]!)
      if (inPk) {
        diagnostics.push(info('import-fk-edge',
          `Foreign key '${table.name}.${fk.columns[0]}' is read as edge type '${name}: ${owner} → ${to}'. The column is kept as well, because it is part of the primary key, so the same fact appears twice.`))
      } else {
        dropped.add(fk.columns[0]!)
        diagnostics.push(info('import-fk-edge',
          `Foreign key '${table.name}.${fk.columns[0]}' is read as edge type '${name}: ${owner} → ${to}', and the column is dropped: the edge is where that fact now lives.`))
      }
    }

    const node: NodeTypeIR = {
      id: deriveId('node', owner), name: owner, qname: owner, iri: owner, prefix: '',
      abstract: false, open: false, ancestors: [], mixins: [],
      key: table.pk, props: table.columns.filter((c) => !dropped.has(c.name))
        .map((c) => toProp(owner, table, c)),
      constraints: [],
    }
    for (const u of table.uniques.filter((x) => x.length > 1)) {
      // A composite uniqueness that is not the key has no place in the model.
      if (!(u.length === table.pk.length && u.every((c) => table.pk.includes(c)))) {
        diagnostics.push(warn('import-composite-unique',
          `'${table.name}' declares UNIQUE (${u.join(', ')}), which this model cannot express unless it is the key. It is not imported.`))
      }
    }
    nodes.push(node)
  }

  if (renamed.length > 0) {
    diagnostics.push(info('import-renamed',
      `${renamed.length} SQL name(s) were read into model spelling: ${renamed.slice(0, 8).join(', ')}${renamed.length > 8 ? ', …' : ''}. Column names are kept as written.`))
  }
  if (catalog.skipped.size > 0) {
    const kinds = [...catalog.skipped.entries()].sort()
      .map(([k, n]) => `${k} ×${n}`).join(', ')
    diagnostics.push(info('import-skipped-statements',
      `Statements outside the schema subset were not read: ${kinds}.`))
  }

  return {
    model: {
      file,
      namespace: { prefix: 'model', iri: 'https://example.org/imported#' },
      prefixes: {}, nodes, edges, mixins: [], enums,
    },
    diagnostics,
  }
}

export function importSql(inputs: TextImportInput[]): ImportResult {
  const diagnostics: Diagnostic[] = []
  const catalog: SqlCatalog = { tables: [], enums: new Map(), skipped: new Map() }
  for (const input of inputs) {
    const read = readSqlCatalog(input.text, diagnostics)
    catalog.tables.push(...read.tables)
    for (const [k, v] of read.enums) catalog.enums.set(k, v)
    for (const [k, v] of read.skipped) catalog.skipped.set(k, (catalog.skipped.get(k) ?? 0) + v)
  }
  const out = sqlCatalogToModel(catalog, inputs[0]?.path ?? '')
  return { model: out.model, diagnostics: [...diagnostics, ...out.diagnostics] }
}
