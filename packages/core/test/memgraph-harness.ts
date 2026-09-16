import neo4j from 'neo4j-driver'
import { mkdirSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import type { ModelIR, NodeTypeIR, PropertyIR } from '../src/ir'
import { concreteDescendants, concreteNodes } from '../src/ir'

/**
 * Access to a running Memgraph for the tests that need one. Memgraph has no embedded
 * mode, so these suites run only when `LPG_MEMGRAPH_URI` names an instance -- locally a
 * Podman or Docker container, in CI a service container. See lat.md/emitters#Verification.
 *
 *   podman run -d -p 7697:7687 memgraph/memgraph:3.13.1 --schema-info-enabled=true
 *   LPG_MEMGRAPH_URI=bolt://localhost:7697 npm test
 */
export const MEMGRAPH_URI = process.env.LPG_MEMGRAPH_URI

/** A row with the driver's 64-bit integers turned into numbers. */
export type Row = Record<string, unknown>

function plain(value: unknown): unknown {
  if (neo4j.isInt(value)) return (value as { toNumber(): number }).toNumber()
  if (Array.isArray(value)) return value.map(plain)
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
  }
  return value
}

let driver: ReturnType<typeof neo4j.driver> | undefined

/** Runs one statement in its own auto-commit transaction and returns plain rows. */
export async function run(statement: string): Promise<Row[]> {
  driver ??= neo4j.driver(MEMGRAPH_URI!, neo4j.auth.basic('', ''))
  const session = driver.session()
  try {
    const result = await session.run(statement)
    return result.records.map((r) => plain(r.toObject()) as Row)
  } finally {
    await session.close()
  }
}

/** Runs each `;`-terminated statement of a script, skipping `//` comment lines. */
export async function runScript(script: string): Promise<void> {
  const body = script.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  for (const statement of body.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
    await run(statement)
  }
}

/**
 * Memgraph holds one database per instance, so each test starts from an empty one:
 * data, constraints and indexes. Enums cannot be dropped (measured: "Not yet
 * implemented"), so tests that declare enums use names no other test reuses.
 */
export async function reset(): Promise<void> {
  await run('MATCH (n) DETACH DELETE n')
  for (const c of await run('SHOW CONSTRAINT INFO')) await run(dropConstraint(c))
  for (const i of await run('SHOW INDEX INFO')) {
    const statement = dropIndex(i)
    if (statement) await run(statement)
  }
}

/**
 * `SHOW CONSTRAINT INFO` spells some types differently from the syntax that creates and
 * drops them (measured): `BOOL`, `LOCAL DATE TIME`, `LOCAL TIME`, `ZONED DATE TIME`.
 */
export const typeKeyword = (reported: string): string =>
  (reported === 'BOOL' ? 'BOOLEAN' : reported.replace(/ /g, ''))

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [String(v)])

function dropConstraint(c: Row): string {
  const label = String(c.label)
  const props = list(c.properties)
  switch (c['constraint type']) {
    case 'unique': return `DROP CONSTRAINT ON (n:${label}) ASSERT ${props.map((p) => `n.${p}`).join(', ')} IS UNIQUE`
    case 'exists': return `DROP CONSTRAINT ON (n:${label}) ASSERT EXISTS (n.${props[0]})`
    default: return `DROP CONSTRAINT ON (n:${label}) ASSERT n.${props[0]} IS TYPED ${typeKeyword(String(c.data_type))}`
  }
}

function dropIndex(i: Row): string | undefined {
  const label = String(i.label)
  const props = i.property === null ? [] : list(i.property)
  switch (i['index type']) {
    case 'label': return `DROP INDEX ON :${label}`
    case 'label+property': return `DROP INDEX ON :${label}(${props.join(', ')})`
    case 'edge-type+property': return `DROP EDGE INDEX ON :${label}(${props.join(', ')})`
    default: return undefined
  }
}

/**
 * A copy of a model whose enums carry a suffix unique to this call. An enum outlives
 * every reset and even a restart (measured), so two runs declaring `Status` against one
 * instance would collide. Strip the suffix with `enumSuffix` before comparing.
 */
export const enumSuffix = (): string => `_t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function withUniqueEnums(model: ModelIR, suffix = enumSuffix()): { model: ModelIR; suffix: string } {
  const copy = structuredClone(model)
  const renamed = new Map(copy.enums.map((e) => [e.name, `${e.name}${suffix}`]))
  for (const e of copy.enums) e.name = renamed.get(e.name)!
  for (const owner of [...copy.nodes, ...copy.edges, ...copy.mixins]) {
    for (const p of owner.props) if (p.enum) p.enum = renamed.get(p.enum) ?? p.enum
  }
  return { model: copy, suffix }
}

/** Enum state restricted to the enums one `withUniqueEnums` call declared, suffix removed. */
export const enumsOf = (enums: string[], suffix: string): string[] =>
  enums.filter((e) => e.split(' ')[0]!.endsWith(suffix)).map((e) => e.replace(suffix, ''))

/** Constraints, indexes and enums, sorted, for comparing two instances' schemas. */
export async function schemaState(): Promise<{ constraints: string[]; indexes: string[]; enums: string[] }> {
  const constraints = (await run('SHOW CONSTRAINT INFO'))
    .map((c) => `${c['constraint type']} ${c.label} ${list(c.properties).join(',')} ${c.data_type ?? ''}`.trim()).sort()
  const indexes = (await run('SHOW INDEX INFO'))
    .map((i) => `${i['index type']} ${i.label} ${i.property === null ? '' : list(i.property).join(',')}`.trim()).sort()
  const enums = (await run('SHOW ENUMS'))
    .map((e) => `${e['Enum Name']} ${list(e['Enum Values']).join(',')}`).sort()
  return { constraints, indexes, enums }
}

/**
 * vitest runs test files in parallel, and every Memgraph suite shares one instance, so a
 * suite holds a cross-process lock for its whole run. A directory is the lock because
 * creating one is atomic; a lock older than the longest suite is taken to be abandoned.
 */
const LOCK = join(tmpdir(), 'lpg-memgraph-tests.lock')
const STALE_MS = 5 * 60 * 1000

async function acquire(): Promise<void> {
  for (;;) {
    try { mkdirSync(LOCK); return } catch { /* held */ }
    try {
      if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) rmdirSync(LOCK)
    } catch { /* released meanwhile */ }
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** Call once at the top of a file whose suites use the instance. */
export function useMemgraph(): void {
  if (!MEMGRAPH_URI) return
  beforeAll(async () => { await acquire(); await reset() }, STALE_MS)
  afterAll(async () => {
    try {
      await driver?.close()
      driver = undefined
    } finally {
      try { rmdirSync(LOCK) } catch { /* already gone */ }
    }
  })
}

/** A Cypher literal of the property's type, distinct per `n` so keys stay unique. */
function literal(model: ModelIR, p: PropertyIR, n: number): string | undefined {
  if (p.composite) return undefined
  if (p.enum) return `${p.enum}::${model.enums.find((e) => e.name === p.enum)!.values[0]}`
  const one = (): string => {
    switch (p.type) {
      case 'int': case 'int8': case 'int16': case 'int32': case 'int128':
      case 'uint8': case 'uint16': case 'uint32': case 'uint64': return String(n)
      case 'float': case 'float32': case 'decimal': return `${n}.5`
      case 'boolean': return 'true'
      case 'date': return `date('2020-01-${String(n % 28 + 1).padStart(2, '0')}')`
      case 'datetime': return `localDateTime('2020-01-01T00:00:${String(n % 60).padStart(2, '0')}')`
      case 'zoneddatetime': return `datetime('2020-01-01T00:00:${String(n % 60).padStart(2, '0')}+00:00')`
      case 'duration': return `duration('P${n}D')`
      default: return `'v${n}'`
    }
  }
  return p.list ? `[${one()}]` : one()
}

const props = (model: ModelIR, owner: { props: PropertyIR[] }, n: number) => owner.props
  .map((p) => [p.name, literal(model, p, n)] as const)
  .filter(([, v]) => v !== undefined)
  .map(([k, v]) => `\`${k}\`: ${v}`).join(', ')

const labels = (node: NodeTypeIR) => [node.name, ...node.ancestors].map((l) => `:\`${l}\``).join('')

/**
 * One valid node per concrete type, with every property its type declares, and one
 * relationship per edge type between the first concrete types at each end -- enough for
 * schema information to see every label set, property and edge type once.
 */
export async function seed(model: ModelIR): Promise<void> {
  let n = 0
  for (const node of concreteNodes(model)) {
    await run(`CREATE (${labels(node)} {${props(model, node, ++n)}})`)
  }
  for (const edge of model.edges) {
    const from = concreteDescendants(model, edge.from)[0]
    const to = concreteDescendants(model, edge.to)[0]
    if (!from || !to) continue
    await run(`MATCH (a:\`${from.name}\`), (b:\`${to.name}\`) WITH a, b LIMIT 1 CREATE (a)-[:\`${edge.name}\` {${props(model, edge, ++n)}}]->(b)`)
  }
}

/** A session over the shared driver, in the shape the importer reads through. */
export const session = { run: (statement: string) => run(statement) }
