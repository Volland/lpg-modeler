import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { planAudit } from '../src/audit'
import { driftFalkor, driftMemgraph, driftNeo4j } from '../src/drift'
import { emit } from '../src/emit/index'
import { readFalkorScript } from '../src/emit/falkordb.script'
import { readMemgraphSchema } from '../src/import/memgraph'
import { readNeo4jSchema } from '../src/import/neo4j'
import { readFalkorSchema, type FalkorClient } from '../src/import/falkordb'
import { loadFixture } from './helpers'
import {
  MEMGRAPH_URI, reset as resetMemgraph, run as runMemgraph, useMemgraph,
} from './memgraph-harness'
import {
  NEO4J_URI, closeDriver as closeNeo4j, reset as resetNeo4j, run as runNeo4j,
  runScript as runNeo4jScript,
} from './neo4j-harness'
import { FALKORDB_URI, closeClient as closeFalkor, send as falkorSend } from './falkordb-harness'

const social = () => loadFixture('social.lpg.yaml')

/** Runs each `;`-terminated statement of a generated script, skipping comments. */
async function runStatements(script: string, run: (q: string) => Promise<unknown>): Promise<void> {
  const body = script.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  for (const st of body.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) await run(st)
}

const violationsOf = async (
  checks: Array<{ label: string; query: string }>, run: (q: string) => Promise<unknown>,
): Promise<Record<string, number>> => {
  const out: Record<string, number> = {}
  for (const c of checks) {
    const rows = await run(c.query) as Array<Record<string, unknown>>
    out[c.label] = Number(rows[0]?.violations ?? NaN)
  }
  return out
}

useMemgraph()

// @lat: [[audit#Audit#Verification]]
describe.runIf(MEMGRAPH_URI).sequential('audit and drift against a running Memgraph', () => {
  beforeEach(resetMemgraph)

  it('a schema the generator applied does not drift, and dropping a constraint does', async () => {
    await runStatements(emit(social(), 'memgraph').content, runMemgraph)
    const { catalog } = await readMemgraphSchema({ run: runMemgraph })
    // Enums outlive every reset on this engine (measured), so leftovers from other
    // suites are not this test's drift; everything else must be exactly clean.
    const clean = driftMemgraph(social(), catalog).findings
      .filter((f) => !f.object.startsWith('enum '))
    expect(clean).toEqual([])

    await runMemgraph('DROP CONSTRAINT ON (n:Person) ASSERT EXISTS (n.email);')
    const { catalog: after } = await readMemgraphSchema({ run: runMemgraph })
    const report = driftMemgraph(social(), after).findings
      .filter((f) => !f.object.startsWith('enum '))
    expect(report).toHaveLength(1)
    expect(report[0]).toMatchObject({ kind: 'missing' })
    expect(report[0]!.object).toContain('Person(email)')
  })

  it('audit counts a closed-type violation Memgraph cannot refuse', async () => {
    await runStatements(emit(social(), 'memgraph').content, runMemgraph)
    await runMemgraph("CREATE (:Car {vin: 'v1', seats: 4, spoiler: true})")
    await runMemgraph("CREATE (:Car {vin: 'v2', seats: 2})")
    const plan = planAudit(social(), 'memgraph')
    const counts = await violationsOf(plan.checks, runMemgraph)
    expect(counts['Car closed']).toBe(1)
    expect(Object.values(counts).some(Number.isNaN)).toBe(false)
  })
})

// @lat: [[drift#Drift#Verification]]
describe.runIf(NEO4J_URI).sequential('audit and drift against a running Neo4j', () => {
  beforeEach(resetNeo4j)
  afterAll(closeNeo4j)

  it('a schema the generator applied does not drift, and dropping a constraint does', async () => {
    await runNeo4jScript(emit(social(), 'neo4j').content)
    const { catalog } = await readNeo4jSchema({ run: runNeo4j })
    expect(driftNeo4j(social(), catalog).findings).toEqual([])

    await runNeo4j('DROP CONSTRAINT person_email_unique IF EXISTS')
    const { catalog: after } = await readNeo4jSchema({ run: runNeo4j })
    const report = driftNeo4j(social(), after).findings
    expect(report).toHaveLength(1)
    expect(report[0]).toMatchObject({ kind: 'missing' })
    expect(report[0]!.object).toContain('Person(email)')
  })

  it('audit counts what Community cannot enforce: a required property left null', async () => {
    await runNeo4jScript(emit(social(), 'neo4j').content)
    await runNeo4j("CREATE (:Person:Party {id: '1', email: 'a@b.c', createdAt: localdatetime()})")
    await runNeo4j("CREATE (:Person:Party {id: '2'})")
    const plan = planAudit(social(), 'neo4j')
    const counts = await violationsOf(plan.checks, runNeo4j)
    expect(counts['Person.email required']).toBe(1)
    expect(counts['Person.createdAt required']).toBe(1)
    expect(counts['Person closed']).toBe(0)
    expect(Object.values(counts).some(Number.isNaN)).toBe(false)
  })
})

// A graph key of this file's own, so these suites never race the falkordb ones.
const DRIFT_KEY = 'lpg_audit_drift_graph'
const falkor: FalkorClient = { sendCommand: falkorSend }
const roRows = async (cypher: string): Promise<Array<Record<string, unknown>>> => {
  const reply = await falkorSend(['GRAPH.RO_QUERY', DRIFT_KEY, cypher]) as [unknown[], unknown[][]]
  const names = (reply[0] ?? []).map(String)
  return (reply[1] ?? []).map((row) => Object.fromEntries(names.map((n, i) => [n, row[i]])))
}

// @lat: [[drift#Drift#Structural identity]]
describe.runIf(FALKORDB_URI).sequential('audit and drift against a running FalkorDB', () => {
  beforeEach(async () => { await falkorSend(['DEL', DRIFT_KEY]) })
  afterAll(async () => { await falkorSend(['DEL', DRIFT_KEY]); await closeFalkor() })

  const apply = async () => {
    const script = readFalkorScript(emit(social(), 'falkordb').content, DRIFT_KEY)
    for (const c of script.commands) await falkorSend(c.args)
  }

  it('a schema the generator applied does not drift, and dropping a constraint does', async () => {
    await apply()
    const { catalog } = await readFalkorSchema(falkor, DRIFT_KEY)
    expect(driftFalkor(social(), catalog!).findings).toEqual([])

    await falkorSend(['GRAPH.CONSTRAINT', 'DROP', DRIFT_KEY, 'UNIQUE', 'NODE', 'Person',
      'PROPERTIES', '1', 'email'])
    const { catalog: after } = await readFalkorSchema(falkor, DRIFT_KEY)
    const report = driftFalkor(social(), after!).findings
    expect(report).toHaveLength(1)
    expect(report[0]).toMatchObject({ kind: 'missing' })
    expect(report[0]!.object).toContain('Person(email)')
  })

  it('audit counts a closed-type violation through GRAPH.RO_QUERY', async () => {
    await apply()
    await falkorSend(['GRAPH.QUERY', DRIFT_KEY,
      "CREATE (:Car {vin: 'v1', seats: 4, spoiler: true})"])
    const plan = planAudit(social(), 'falkordb')
    const counts: Record<string, number> = {}
    for (const c of plan.checks) {
      const rows = await roRows(c.query)
      counts[c.label] = Number(rows[0]?.violations ?? NaN)
    }
    expect(counts['Car closed']).toBe(1)
    expect(Object.values(counts).some(Number.isNaN)).toBe(false)
  })
})
