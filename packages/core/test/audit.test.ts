import { describe, expect, it } from 'vitest'
import * as lbug from '@ladybugdb/core'
import { planAudit } from '../src/audit'
import { emit } from '../src/emit/index'
import { resolveModel } from '../src/resolve'
import { loadFixture } from './helpers'

const social = () => loadFixture('social.lpg.yaml')
const features = () => loadFixture('features.lpg.yaml')
const codes = (ds: { code: string }[]) => ds.map((d) => d.code)

const inline = (body: string) =>
  resolveModel('/m.lpg.yaml', () =>
    `namespace: { prefix: p, iri: "https://e.org/p#" }\n${body}`).model

/** Required, unique, enum, bounds and a pattern, all on one type ladybug cannot enforce them for. */
const AUDITED = `enums:
  Status: { values: [a, b] }
nodes:
  Person:
    key: [id]
    props:
      id: { type: string, required: true }
      email: { type: string, required: true, unique: true }
      age: { type: int, min: 0, max: 150 }
      code: { type: string, pattern: "^[A-Z]+$", minLength: 2 }
      status: { type: string, enum: Status }
`

// @lat: [[audit#Audit]]
describe('audit planning', () => {
  it('matches the golden scripts', async () => {
    for (const target of ['ladybug', 'neo4j', 'memgraph', 'falkordb'] as const) {
      const plan = planAudit(social(), target)
      const ext = plan.extension
      await expect(plan.content).toMatchFileSnapshot(`./golden/social.audit.${target}.${ext}`)
    }
  })

  it('checks on ladybug exactly what ladybug leaves unenforced', () => {
    const plan = planAudit(inline(AUDITED), 'ladybug')
    const kinds = plan.checks.map((c) => c.code)
    expect(kinds).toContain('required')
    expect(kinds).toContain('unique')
    expect(kinds).toContain('enum')
    expect(kinds).toContain('range')
    expect(kinds).toContain('length')
    expect(kinds).toContain('pattern')
    // The single-property key is the primary key, which ladybug genuinely enforces.
    expect(kinds).not.toContain('key-present')
    expect(kinds).not.toContain('closed')
  })

  it('does not audit what the target enforces', () => {
    // Memgraph enforces node existence and uniqueness; its relationships have nothing.
    const memgraph = planAudit(inline(AUDITED), 'memgraph')
    expect(memgraph.checks.map((c) => c.code)).not.toContain('required')
    expect(memgraph.checks.map((c) => c.code)).not.toContain('unique')
    expect(memgraph.checks.map((c) => c.code)).toContain('enum')
  })

  it('consults the edition for neo4j', () => {
    const community = planAudit(inline(AUDITED), 'neo4j')
    const enterprise = planAudit(inline(AUDITED), 'neo4j', { neo4jEdition: 'enterprise' })
    expect(community.checks.map((c) => c.code)).toContain('required')
    expect(enterprise.checks.map((c) => c.code)).not.toContain('required')
  })

  it('audits the parts and the tuple of a composite key where only a synthesized column is enforced', () => {
    const model = inline(
      'nodes:\n  Pos:\n    key: [x, y]\n    props:\n      x: { type: int, required: true }\n      y: { type: int, required: true }\n')
    const plan = planAudit(model, 'ladybug')
    const kinds = plan.checks.map((c) => c.code)
    expect(kinds.filter((k) => k === 'key-present')).toHaveLength(2)
    expect(kinds).toContain('key-unique')
  })

  it('reports a check it cannot spell rather than guessing', () => {
    const plan = planAudit(inline(AUDITED), 'falkordb')
    expect(codes(plan.diagnostics)).toContain('audit-unsupported')
    expect(plan.content).toContain('UNCHECKED')
    expect(plan.checks.map((c) => c.code)).not.toContain('pattern')
    expect(plan.checks.map((c) => c.code)).not.toContain('length')
  })

  it('audits named constraints and cardinality bounds', () => {
    const model = features()
    // many-to-one: the to end is bounded at one, which only ladybug enforces on write.
    const neo4j = planAudit(model, 'neo4j')
    expect(neo4j.checks.some((c) => c.code === 'cardinality')).toBe(true)
    const ladybug = planAudit(model, 'ladybug')
    expect(ladybug.checks.some((c) => c.code === 'cardinality')).toBe(false)
  })

  it('checks closed types through keys() on the label engines', () => {
    const plan = planAudit(social(), 'neo4j')
    const closed = plan.checks.filter((c) => c.code === 'closed')
    // Every concrete social type is closed; Driver-style open types get no check.
    expect(closed.length).toBeGreaterThan(0)
    expect(closed[0]!.query).toContain('keys(n)')
    const open = planAudit(features(), 'neo4j').checks.filter((c) => c.code === 'closed')
    expect(open.map((c) => c.label)).not.toContain('Driver closed')
  })

  it('refuses a target it has no audit for', () => {
    expect(codes(planAudit(social(), 'shacl').diagnostics)).toContain('audit-unsupported-target')
  })
})

// @lat: [[audit#Audit#Verification]]
describe('audit checks, executed against LadybugDB', () => {
  const BUFFER_POOL = 256 * 1024 * 1024
  const MAX_DB_SIZE = 1024 * 1024 * 1024

  const connect = async () => {
    const db = new lbug.Database(':memory:', BUFFER_POOL, true, false, MAX_DB_SIZE)
    return new lbug.Connection(db)
  }

  const count = async (conn: InstanceType<typeof lbug.Connection>, query: string) => {
    const result = await conn.query(query)
    const one = Array.isArray(result) ? result[result.length - 1]! : result
    const rows = await one.getAll() as Array<Record<string, unknown>>
    return Number(rows[0]?.violations ?? NaN)
  }

  it('counts planted violations, and zero on clean data', async () => {
    const model = inline(AUDITED)
    const conn = await connect()
    await conn.query(emit(model, 'ladybug').content)
    // One row violating each unenforced constraint, one clean row.
    await conn.query("CREATE (:Person {id: '1', email: 'a@b.c', age: 30, code: 'AB', status: 'a'})")
    await conn.query("CREATE (:Person {id: '2', age: 200, code: 'x', status: 'z'})")
    await conn.query("CREATE (:Person {id: '3', email: 'a@b.c'})")

    const plan = planAudit(model, 'ladybug')
    const byCode = Object.fromEntries(await Promise.all(
      plan.checks.map(async (c) => [c.code, await count(conn, c.query)] as const)))
    expect(byCode.required).toBe(1)  // id 2 has no email
    expect(byCode.unique).toBe(1)    // a@b.c appears twice
    expect(byCode.range).toBe(1)     // age 200
    expect(byCode.enum).toBe(1)      // status z
    expect(byCode.length).toBe(1)    // code x is too short
    expect(byCode.pattern).toBe(1)   // code x is lowercase

    await conn.query("MATCH (p:Person) WHERE p.id IN ['2', '3'] DELETE p")
    for (const check of plan.checks) {
      expect(await count(conn, check.query), check.label).toBe(0)
    }
  })

  it('counts a composite key tuple stored twice', async () => {
    const model = inline(
      'nodes:\n  Pos:\n    key: [x, y]\n    props:\n      x: { type: int, required: true }\n      y: { type: int, required: true }\n')
    const conn = await connect()
    await conn.query(emit(model, 'ladybug').content)
    await conn.query("CREATE (:Pos {pos_key: '1|2', x: 1, y: 2})")
    await conn.query("CREATE (:Pos {pos_key: 'dup', x: 1, y: 2})")
    await conn.query("CREATE (:Pos {pos_key: 'partial', x: 7})")

    const plan = planAudit(model, 'ladybug')
    const tuple = plan.checks.find((c) => c.code === 'key-unique')!
    expect(await count(conn, tuple.query)).toBe(1)
    const present = plan.checks.filter((c) => c.code === 'key-present')
    const counts = await Promise.all(present.map((c) => count(conn, c.query)))
    expect(counts).toContain(1) // y is missing on the partial row
  })
})
