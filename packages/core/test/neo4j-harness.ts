import neo4j from 'neo4j-driver'
import type { Row } from './memgraph-harness'

/**
 * Access to a running Neo4j for the tests that need one. Neo4j has no embedded mode, so
 * these suites run only when `LPG_NEO4J_URI` names an instance -- locally a Podman or
 * Docker container, in CI a service container. See lat.md/emitters#Verification.
 *
 *   podman run -d -p 7688:7687 -e NEO4J_AUTH=neo4j/lpgtest123 neo4j:5-community
 *   LPG_NEO4J_URI=bolt://localhost:7688 npm test
 *
 * The password is read from `LPG_NEO4J_PASSWORD`, defaulting to the one above, because a
 * Neo4j refuses the default credentials until they are changed and so cannot be run
 * without any.
 */
export const NEO4J_URI = process.env.LPG_NEO4J_URI
export const NEO4J_USER = process.env.LPG_NEO4J_USER ?? 'neo4j'
export const NEO4J_PASSWORD = process.env.LPG_NEO4J_PASSWORD ?? 'lpgtest123'

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
  driver ??= neo4j.driver(NEO4J_URI!, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD))
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
 * Each test starts from an empty database: data, then constraints, then indexes. A
 * LOOKUP index is never dropped -- every database has one per entity and it cannot be
 * recreated by anything this tool emits.
 */
export async function reset(): Promise<void> {
  await run('MATCH (n) DETACH DELETE n')
  for (const c of await run('SHOW CONSTRAINTS YIELD name')) {
    await run(`DROP CONSTRAINT \`${String(c.name)}\` IF EXISTS`)
  }
  for (const i of await run('SHOW INDEXES YIELD name, type')) {
    if (String(i.type) !== 'LOOKUP') await run(`DROP INDEX \`${String(i.name)}\` IF EXISTS`)
  }
}

/** The schema as a comparable value: constraints and standalone indexes, sorted. */
export async function schemaState(): Promise<{ constraints: string[]; indexes: string[] }> {
  const constraints = (await run('SHOW CONSTRAINTS YIELD type, entityType, labelsOrTypes, properties'))
    .map((c) => `${String(c.type)} ${String(c.entityType)} ${JSON.stringify(c.labelsOrTypes)} ${JSON.stringify(c.properties)}`)
    .sort()
  const indexes = (await run('SHOW INDEXES YIELD type, entityType, labelsOrTypes, properties, owningConstraint'))
    .filter((i) => String(i.type) !== 'LOOKUP' && !i.owningConstraint)
    .map((i) => `${String(i.entityType)} ${JSON.stringify(i.labelsOrTypes)} ${JSON.stringify(i.properties)}`)
    .sort()
  return { constraints, indexes }
}

export async function closeDriver(): Promise<void> {
  await driver?.close()
  driver = undefined
}
