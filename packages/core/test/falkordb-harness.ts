import { createClient } from 'redis'

/**
 * Access to a running FalkorDB for the tests that need one. It has no embedded mode, so
 * these suites run only when `LPG_FALKORDB_URI` names an instance -- locally a Podman or
 * Docker container, in CI a service container. See lat.md/emitters#Verification.
 *
 *   podman run -d -p 6380:6379 falkordb/falkordb:v4.20.4
 *   LPG_FALKORDB_URI=redis://localhost:6380 npm test
 */
export const FALKORDB_URI = process.env.LPG_FALKORDB_URI

/** The graph key the suites use, so nothing else on the instance is touched. */
export const GRAPH_KEY = process.env.LPG_FALKORDB_GRAPH ?? 'lpg_test_graph'

let client: ReturnType<typeof createClient> | undefined

async function connected() {
  if (!client) {
    client = createClient({ url: FALKORDB_URI! })
    client.on('error', () => undefined)
    await client.connect()
  }
  return client
}

/** Sends one command and returns the raw reply. */
export async function send(args: string[]): Promise<unknown> {
  return (await connected()).sendCommand(args) as Promise<unknown>
}

/** Runs one Cypher query against the test graph, through a writable connection. */
export const query = (cypher: string): Promise<unknown> =>
  send(['GRAPH.QUERY', GRAPH_KEY, cypher])

/** Deletes the test graph, which is the only way to drop its constraints wholesale. */
export async function reset(): Promise<void> {
  await send(['DEL', GRAPH_KEY])
}

/** The constraints and indexes the graph holds, sorted, as comparable strings. */
export async function schemaState(): Promise<{ constraints: string[]; indexes: string[] }> {
  const rows = (reply: unknown): unknown[][] =>
    (Array.isArray(reply) && Array.isArray(reply[1]) ? reply[1] as unknown[][] : [])
  const constraints = rows(await query('CALL db.constraints()'))
    .map((r) => `${String(r[0])} ${String(r[3])} ${String(r[1])} ${String(r[2])} ${String(r[4])}`)
    .sort()
  const indexes = rows(await query('CALL db.indexes()'))
    .map((r) => `${String(r[6])} ${String(r[0])} ${String(r[1])}`)
    .sort()
  return { constraints, indexes }
}

export async function closeClient(): Promise<void> {
  await client?.quit().catch(() => undefined)
  client = undefined
}
