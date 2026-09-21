import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { readFalkorSchema } from '../src/import/falkordb'
import {
  FALKORDB_URI, GRAPH_KEY, closeClient, query, reset, send,
} from './falkordb-harness'

/**
 * What FalkorDB 4.20.4 actually does, measured rather than taken from documentation.
 * Everything the importer and `apply` rely on is pinned here, so a change in the engine
 * fails a test rather than a user's deployment.
 * See lat.md/importers#Reading a FalkorDB Instance.
 */

/** The error a command raises, or '' when it succeeds. */
const message = async (args: string[]): Promise<string> => {
  try {
    await send(args)
    return ''
  } catch (e) {
    return (e as Error).message
  }
}

const rows = (reply: unknown): unknown[][] =>
  (Array.isArray(reply) && Array.isArray(reply[1]) ? reply[1] as unknown[][] : [])

afterAll(closeClient)

// @lat: [[importers#Reading a FalkorDB Instance]]
describe.runIf(FALKORDB_URI).sequential('what FalkorDB does with a schema', () => {
  beforeEach(reset)

  it('creates a constraint asynchronously, and one the data violates ends FAILED', async () => {
    await query("CREATE (:P {id: 'x'}), (:P {id: 'x'})")
    await query('CREATE INDEX FOR (n:P) ON (n.id)')
    const reply = await send(['GRAPH.CONSTRAINT', 'CREATE', GRAPH_KEY, 'UNIQUE', 'NODE', 'P', 'PROPERTIES', '1', 'id'])
    expect(String(reply)).toBe('PENDING')

    // It settles, and what it settles to is the whole point: FAILED enforces nothing.
    let status = ''
    for (let i = 0; i < 20 && status !== 'FAILED'; i++) {
      status = String(rows(await query('CALL db.constraints()'))[0]?.[4] ?? '')
      if (status !== 'FAILED') await new Promise((r) => setTimeout(r, 100))
    }
    expect(status).toBe('FAILED')

    // A third duplicate is accepted, because the constraint never came into force.
    expect(await message(['GRAPH.QUERY', GRAPH_KEY, "CREATE (:P {id: 'x'})"])).toBe('')
  })

  it('enforces a unique and a mandatory constraint once they are operational', async () => {
    await query('CREATE INDEX FOR (n:Person) ON (n.id)')
    await send(['GRAPH.CONSTRAINT', 'CREATE', GRAPH_KEY, 'UNIQUE', 'NODE', 'Person', 'PROPERTIES', '1', 'id'])
    await send(['GRAPH.CONSTRAINT', 'CREATE', GRAPH_KEY, 'MANDATORY', 'NODE', 'Person', 'PROPERTIES', '1', 'email'])
    await new Promise((r) => setTimeout(r, 300))

    expect(await message(['GRAPH.QUERY', GRAPH_KEY, "CREATE (:Person {id: 'a', email: 'e'})"])).toBe('')
    expect(await message(['GRAPH.QUERY', GRAPH_KEY, "CREATE (:Person {id: 'a', email: 'e2'})"]))
      .toMatch(/unique constraint violation/)
    expect(await message(['GRAPH.QUERY', GRAPH_KEY, "CREATE (:Person {id: 'b'})"]))
      .toMatch(/mandatory constraint violation/)
  })

  it('refuses a unique constraint with no index behind it, and a repeated create', async () => {
    expect(await message(['GRAPH.CONSTRAINT', 'CREATE', GRAPH_KEY, 'UNIQUE', 'NODE', 'Q', 'PROPERTIES', '1', 'id']))
      .toMatch(/missing supporting exact-match index/)
    await send(['GRAPH.CONSTRAINT', 'CREATE', GRAPH_KEY, 'MANDATORY', 'NODE', 'Q', 'PROPERTIES', '1', 'id'])
    expect(await message(['GRAPH.CONSTRAINT', 'CREATE', GRAPH_KEY, 'MANDATORY', 'NODE', 'Q', 'PROPERTIES', '1', 'id']))
      .toMatch(/already exists/i)
  })

  it('keeps a label\'s indexed properties in the order they were indexed', async () => {
    await query('CREATE INDEX FOR (n:R) ON (n.id)')
    await query('CREATE INDEX FOR (n:R) ON (n.email)')
    const properties = String(rows(await query('CALL db.indexes()'))[0]?.[1] ?? '')
    // This is what tells the key from another unique property on import.
    expect(properties).toBe('[id, email]')
  })

  it('creates a graph on a writable query against an unknown key, and refuses a read-only one', async () => {
    const key = 'lpg_test_missing_graph'
    await send(['DEL', key])
    expect(await message(['GRAPH.RO_QUERY', key, 'CALL db.constraints()']))
      .toMatch(/Invalid graph operation on empty key/)
    expect(((await send(['GRAPH.LIST'])) as string[]).map(String)).not.toContain(key)

    // The hazard the importer exists to avoid: a plain query answers as if the graph
    // were empty, and leaves it behind.
    expect(await message(['GRAPH.QUERY', key, 'CALL db.constraints()'])).toBe('')
    expect(((await send(['GRAPH.LIST'])) as string[]).map(String)).toContain(key)
    await send(['DEL', key])
  })

  it('refuses a write through a read-only query', async () => {
    // The graph has to exist first, or the empty-key refusal comes first instead.
    await query("CREATE (:Seed {x: 1})")
    expect(await message(['GRAPH.RO_QUERY', GRAPH_KEY, "CREATE (:Nope {x: 1})"]))
      .toMatch(/read-only queries/)
    expect(await message(['GRAPH.RO_QUERY', GRAPH_KEY, 'MATCH (n) RETURN count(n)'])).toBe('')
  })

  it('reads a schema through the importer without writing to the graph', async () => {
    await query('CREATE INDEX FOR (n:Person) ON (n.id)')
    await send(['GRAPH.CONSTRAINT', 'CREATE', GRAPH_KEY, 'UNIQUE', 'NODE', 'Person', 'PROPERTIES', '1', 'id'])
    await send(['GRAPH.CONSTRAINT', 'CREATE', GRAPH_KEY, 'MANDATORY', 'NODE', 'Person', 'PROPERTIES', '1', 'id'])
    await new Promise((r) => setTimeout(r, 300))
    await query("CREATE (:Person:Party {id: 'p', email: 'e'})-[:OWNS {since: 2020}]->(:Car {vin: 'v'})")

    const { catalog, diagnostics } = await readFalkorSchema({ sendCommand: (args) => send(args) }, GRAPH_KEY)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(catalog?.constraints).toContainEqual(
      { kind: 'unique', entity: 'node', label: 'Person', properties: ['id'], status: 'OPERATIONAL' })
    expect(catalog?.indexes).toContainEqual({ entity: 'node', label: 'Person', properties: ['id'] })
    expect(catalog?.nodes.map((n) => n.labels.sort().join(','))).toContain('Party,Person')
    expect(catalog?.edges).toContainEqual({ type: 'OWNS', from: ['Person', 'Party'], to: ['Car'] })
    expect(catalog?.edgeProperties).toContainEqual({ type: 'OWNS', key: 'since', valueType: 'Integer' })
  })
})
