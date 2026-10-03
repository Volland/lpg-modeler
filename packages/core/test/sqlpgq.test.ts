import { describe, expect, it } from 'vitest'
import * as duckdb from 'duckdb'
import { emit } from '../src/emit/index'
import { DUCKDB_QUOTED, ident } from '../src/emit/sqlpgq'
import { resolveModel } from '../src/resolve'
import { loadFixture } from './helpers'

const social = () => loadFixture('social.lpg.yaml')
const codes = (ds: { code: string }[]) => ds.map((d) => d.code)
const inline = (body: string) =>
  resolveModel('/m.lpg.yaml', () =>
    `namespace: { prefix: p, iri: "https://e.org/p#" }\n${body}`).model

// @lat: [[emitters#SQL/PGQ Target]]
describe('sqlpgq target', () => {
  it('matches the golden file', async () => {
    await expect(emit(social(), 'sqlpgq').content).toMatchFileSnapshot('./golden/social.sqlpgq.sql')
  })

  it('flattens the hierarchy to leaf tables and copies inherited columns down', () => {
    const { content } = emit(social(), 'sqlpgq')
    expect(content).toContain('-- Abstract, no table emitted: Party')
    expect(content).not.toContain('CREATE TABLE IF NOT EXISTS Party')
    expect(content).toMatch(/CREATE TABLE IF NOT EXISTS Person \(\n {2}email VARCHAR NOT NULL UNIQUE,[\s\S]*id VARCHAR NOT NULL,\n {2}PRIMARY KEY \(id\)/)
  })

  it('makes an edge reaching an abstract endpoint one table and label per pair, and says so', () => {
    const { content, diagnostics } = emit(social(), 'sqlpgq')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS OWNS_Person_Car (')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS OWNS_Company_Car (')
    expect(content).toContain('LABEL OWNS_Person_Car')
    expect(codes(diagnostics)).toContain('downgrade-edge-expansion')
  })

  it('quotes the words the parser refuses bare, and names with other characters', () => {
    expect(ident('order')).toBe('"order"')   // reserved
    expect(ident('ORDER')).toBe('"ORDER"')
    expect(ident('AT')).toBe('"AT"')         // type_function: fails as a table name
    expect(ident('key')).toBe('key')         // unreserved: measured to parse bare
    expect(ident('Person')).toBe('Person')
    expect(ident('has space')).toBe('"has space"')
    expect(DUCKDB_QUOTED.size).toBe(159)
  })

  it('reports an open type, an unexpressible bound, and a count it cannot check', () => {
    const model = inline(
      'nodes:\n  A:\n    key: [id]\n    open: true\n    props:\n      id: { type: string, required: true }\n'
      + '    constraints:\n      - name: few\n        assert: { count: { edge: E, max: 2 } }\n'
      + 'edges:\n  E: { from: A, to: A, cardinality: { from: "1..3", to: "*" } }\n')
    const { diagnostics, content } = emit(model, 'sqlpgq')
    expect(codes(diagnostics)).toEqual(expect.arrayContaining(['downgrade-open', 'downgrade-cardinality', 'downgrade-named-constraint']))
    expect(content).toContain('-- UNENFORCED: constraint')
  })

  it('writes the bound on an expanded edge into every table, and reports a leak only when both ends expand', () => {
    // Abstract source, one concrete target: each source type has one table, so the
    // UNIQUE inside it is the whole bound.
    const one = inline(
      'nodes:\n  Base:\n    abstract: true\n    key: [id]\n    props:\n      id: { type: string, required: true }\n'
      + '  A:\n    extends: Base\n  B:\n    extends: Base\n'
      + '  D:\n    key: [code]\n    props:\n      code: { type: string, required: true }\n'
      + 'edges:\n  AT: { from: Base, to: D, cardinality: many-to-one }\n')
    const a = emit(one, 'sqlpgq')
    expect(a.content.match(/UNIQUE \(src_id\)/g)).toHaveLength(2)
    expect(codes(a.diagnostics)).toContain('downgrade-edge-expansion')
    expect(codes(a.diagnostics)).not.toContain('downgrade-cardinality-expanded')
    // Abstract target: a source can have a row in each target's table.
    const many = inline(
      'nodes:\n  S:\n    key: [id]\n    props:\n      id: { type: string, required: true }\n'
      + '  Base:\n    abstract: true\n    key: [code]\n    props:\n      code: { type: string, required: true }\n'
      + '  X:\n    extends: Base\n  Y:\n    extends: Base\n'
      + 'edges:\n  AT: { from: S, to: Base, cardinality: many-to-one }\n')
    expect(codes(emit(many, 'sqlpgq').diagnostics)).toContain('downgrade-cardinality-expanded')
  })

  it('writes a unique key on the end that is bounded at one', () => {
    const model = inline(
      'nodes:\n  A:\n    key: [id]\n    props:\n      id: { type: string, required: true }\n'
      + 'edges:\n  E: { from: A, to: A, cardinality: many-to-one }\n')
    expect(emit(model, 'sqlpgq').content).toContain('UNIQUE (src_id)')
  })
})

/** Whether DuckDB and its property-graph extension can be had; offline, the suite skips. */
async function available(): Promise<boolean> {
  try {
    const db = new duckdb.Database(':memory:')
    await exec(db, 'INSTALL duckpgq FROM community; LOAD duckpgq;')
    return true
  } catch {
    console.warn('sqlpgq: the duckpgq extension is not available here, so the engine suite is skipped')
    return false
  }
}

const exec = (db: duckdb.Database, sql: string) =>
  new Promise<void>((resolve, reject) => db.exec(sql, (e) => (e ? reject(e) : resolve())))
const all = (db: duckdb.Database, sql: string) =>
  new Promise<Array<Record<string, unknown>>>((resolve, reject) =>
    db.all(sql, (e, rows) => (e ? reject(e) : resolve(rows as Array<Record<string, unknown>>))))

const engine = await available()

/** A database with the extension loaded and the model's artifact applied. */
async function applied(model: ReturnType<typeof social>) {
  const db = new duckdb.Database(':memory:')
  await exec(db, 'INSTALL duckpgq FROM community; LOAD duckpgq;')
  await exec(db, emit(model, 'sqlpgq').content)
  return db
}

// @lat: [[emitters#SQL/PGQ Target#Verification]]
describe.runIf(engine)('sqlpgq artifact, executed in DuckDB with duckpgq', () => {
  it.each(['social', 'features', 'composites', 'types', 'standards', 'kinship'])(
    '%s.lpg.yaml applies, property graph included', async (name) => {
      await applied(loadFixture(`${name}.lpg.yaml`))
    })

  it('applies twice: every statement is repeatable', async () => {
    const db = await applied(social())
    await exec(db, emit(social(), 'sqlpgq').content)
  })

  it('refuses what the model requires: a missing required value, a duplicate, a dangling edge', async () => {
    const db = await applied(social())
    await exec(db, "INSERT INTO Person (id, email, born, createdAt) VALUES ('1', 'a@b.c', DATE '2000-01-01', TIMESTAMP '2020-01-01')")
    // required (not the key) and unique (not the key) are enforced here, unlike on LadybugDB
    await expect(exec(db, "INSERT INTO Person (id, createdAt) VALUES ('2', TIMESTAMP '2020-01-01')")).rejects.toThrow(/NOT NULL/)
    await expect(exec(db, "INSERT INTO Person (id, email, createdAt) VALUES ('3', 'a@b.c', TIMESTAMP '2020-01-01')")).rejects.toThrow(/unique|Duplicate/i)
    await expect(exec(db, "INSERT INTO Person (id, email, createdAt) VALUES ('1', 'z@z.z', TIMESTAMP '2020-01-01')")).rejects.toThrow(/Duplicate|unique/i)
    await expect(exec(db, "INSERT INTO OWNS_Person_Car VALUES ('1', 'nope', NULL)")).rejects.toThrow(/foreign key/i)
  })

  it('queries the property graph it created, through the edge’s own label', async () => {
    const db = await applied(social())
    await exec(db, "INSERT INTO Person (id, email, createdAt) VALUES ('1', 'a@b.c', TIMESTAMP '2020-01-01')")
    await exec(db, "INSERT INTO Car VALUES ('v1', 4)")
    await exec(db, "INSERT INTO OWNS_Person_Car VALUES ('1', 'v1', DATE '2021-01-01')")
    const rows = await all(db, 'FROM GRAPH_TABLE (social MATCH (p:Person)-[o:OWNS_Person_Car]->(c:Car) COLUMNS (p.email, c.vin, o.since))')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ email: 'a@b.c', vin: 'v1' })
  })

  it('refuses a value outside its bounds, pattern, length or enum, and a failed named constraint', async () => {
    const model = inline(
      'enums:\n  S: { values: [a, b] }\n'
      + 'nodes:\n  T:\n    key: [id]\n    props:\n      id: { type: string, required: true }\n'
      + '      age: { type: int, min: 0, max: 150 }\n'
      + '      code: { type: string, pattern: "^[A-Z]+$", minLength: 2 }\n'
      + '      s: { type: string, enum: S }\n'
      + '      a: { type: int }\n      b: { type: int }\n'
      + '    constraints:\n      - name: ordered\n        assert: { lessThan: [a, b] }\n'
      + '      - name: one\n        assert: { exactlyOne: [a, b] }\n')
    const db = await applied(model)
    const ok = "INSERT INTO T VALUES ('1', 30, 'AB', 'a', 1, NULL)"
    await exec(db, ok)
    await expect(exec(db, "INSERT INTO T VALUES ('2', 200, 'AB', 'a', 1, NULL)")).rejects.toThrow(/CHECK/)
    await expect(exec(db, "INSERT INTO T VALUES ('3', 30, 'ab', 'a', 1, NULL)")).rejects.toThrow(/CHECK/)
    await expect(exec(db, "INSERT INTO T VALUES ('4', 30, 'A', 'a', 1, NULL)")).rejects.toThrow(/CHECK/)
    await expect(exec(db, "INSERT INTO T VALUES ('5', 30, 'AB', 'z', 1, NULL)")).rejects.toThrow()
    await expect(exec(db, "INSERT INTO T VALUES ('6', 30, 'AB', 'a', 5, 2)")).rejects.toThrow(/CHECK/) // a<b fails
    await expect(exec(db, "INSERT INTO T VALUES ('7', 30, 'AB', 'a', NULL, NULL)")).rejects.toThrow(/CHECK/) // exactlyOne
    await exec(db, "INSERT INTO T VALUES ('8', NULL, NULL, NULL, 1, NULL)")
  })

  it('enforces the bound at one on an edge, within a table', async () => {
    const model = inline(
      'nodes:\n  A:\n    key: [id]\n    props:\n      id: { type: string, required: true }\n'
      + 'edges:\n  E: { from: A, to: A, cardinality: many-to-one }\n')
    const db = await applied(model)
    await exec(db, "INSERT INTO A VALUES ('1'), ('2'), ('3')")
    await exec(db, "INSERT INTO E VALUES ('1', '2')")
    // `to` is bounded at one: a source has at most one target.
    await expect(exec(db, "INSERT INTO E VALUES ('1', '3')")).rejects.toThrow(/unique|Duplicate/i)
    await exec(db, "INSERT INTO E VALUES ('3', '2')") // many sources may share a target
  })

  it('enforces the bound at one on every table of an expanded edge', async () => {
    const model = inline(
      'nodes:\n  Base:\n    abstract: true\n    key: [id]\n    props:\n      id: { type: string, required: true }\n'
      + '  A:\n    extends: Base\n  B:\n    extends: Base\n'
      + '  D:\n    key: [code]\n    props:\n      code: { type: string, required: true }\n'
      + 'edges:\n  AT: { from: Base, to: D, cardinality: many-to-one }\n')
    const db = await applied(model)
    await exec(db, "INSERT INTO A VALUES ('a1'); INSERT INTO B VALUES ('b1'); INSERT INTO D VALUES ('d1'), ('d2')")
    await exec(db, "INSERT INTO AT_A_D VALUES ('a1', 'd1'); INSERT INTO AT_B_D VALUES ('b1', 'd1')")
    await expect(exec(db, "INSERT INTO AT_A_D VALUES ('a1', 'd2')")).rejects.toThrow(/unique|Duplicate/i)
    await expect(exec(db, "INSERT INTO AT_B_D VALUES ('b1', 'd2')")).rejects.toThrow(/unique|Duplicate/i)
  })

  it('carries a composite key natively, through to an edge’s composite foreign key', async () => {
    const model = inline(
      'nodes:\n  P:\n    key: [id]\n    props:\n      id: { type: string, required: true }\n'
      + '  Pos:\n    key: [x, y]\n    props:\n      x: { type: int, required: true }\n      y: { type: int, required: true }\n'
      + 'edges:\n  LOCATED: { from: P, to: Pos }\n')
    const db = await applied(model)
    await exec(db, "INSERT INTO P VALUES ('1'); INSERT INTO Pos VALUES (1, 2); INSERT INTO LOCATED VALUES ('1', 1, 2)")
    await expect(exec(db, "INSERT INTO Pos VALUES (1, 2)")).rejects.toThrow(/Duplicate|unique/i)
    await expect(exec(db, "INSERT INTO LOCATED VALUES ('1', 9, 9)")).rejects.toThrow(/foreign key/i)
    const rows = await all(db, 'FROM GRAPH_TABLE (p MATCH (a:P)-[e:LOCATED]->(b:Pos) COLUMNS (a.id, b.x, b.y))')
    expect(rows).toHaveLength(1)
  })

  it('applies names the parser refuses bare, quoted, and the list is the engine’s own', async () => {
    const model = inline(
      'nodes:\n  Order:\n    key: [id]\n    props:\n      id: { type: string, required: true }\n      order: { type: int }\n      group: { type: string }\n'
      + '  AT:\n    key: [id]\n    props:\n      id: { type: string, required: true }\n'
      + 'edges:\n  LEFT: { from: Order, to: AT }\n')
    const db = await applied(model)
    await exec(db, `INSERT INTO "Order" (id, "order", "group") VALUES ('1', 2, 'g')`)
    const engineList = (await all(db, "SELECT keyword_name AS k FROM duckdb_keywords() WHERE keyword_category <> 'unreserved' ORDER BY 1"))
      .map((r) => r.k as string)
    expect([...DUCKDB_QUOTED].sort()).toEqual(engineList)
  })
})
