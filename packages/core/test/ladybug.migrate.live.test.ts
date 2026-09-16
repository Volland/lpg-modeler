import { describe, it, expect } from 'vitest'
import * as lbug from '@ladybugdb/core'
import { emit } from '../src/emit/index'
import { planMigration } from '../src/migrate/index'
import { PAIRS, pairModels } from './migrate-pairs'

/**
 * Executes Ladybug migrations against a real in-process LadybugDB. What `ALTER` accepts
 * was measured rather than documented, and the planner leans on every one of these
 * findings, so they are pinned here. See lat.md/emitters#Migrations#Target Planners.
 */

/** Bounded for the reason ladybug.live.test.ts gives: many databases open at once. */
const BUFFER_POOL = 256 * 1024 * 1024
const MAX_DB_SIZE = 1024 * 1024 * 1024

async function connect(ddl?: string) {
  const db = new lbug.Database(':memory:', BUFFER_POOL, true, false, MAX_DB_SIZE)
  const conn = new lbug.Connection(db)
  if (ddl) await conn.query(ddl)
  return conn
}

const all = async (conn: lbug.Connection, q: string) => {
  const r = await conn.query(q)
  return (Array.isArray(r) ? r[r.length - 1]! : r).getAll()
}

/** Tables, columns, types, keys and endpoint pairs, order-independent. */
async function catalogue(conn: lbug.Connection) {
  const tables = (await all(conn, 'CALL show_tables() RETURN name, type'))
    .map((t) => ({ name: String(t.name), type: String(t.type) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const out: Record<string, unknown> = {}
  for (const t of tables) {
    const columns = (await all(conn, `CALL table_info('${t.name}') RETURN *`))
      .map((c) => `${c.name} ${c.type}${c['primary key'] === true ? ' PK' : ''}`).sort()
    const pairs = t.type === 'REL'
      ? (await all(conn, `CALL show_connection('${t.name}') RETURN *`))
        .map((p) => `${p['source table name']}->${p['destination table name']}`).sort()
      : []
    out[`${t.type} ${t.name}`] = { columns, pairs }
  }
  return out
}

const migration = (name: string) => {
  const { before, after } = pairModels(name)
  const plan = planMigration({
    lockfile: { lockfileVersion: 1, lpg: '1.0', revision: 1, model: before },
    model: after, targets: ['ladybug'], allowDestructive: true,
  })
  return { before, after, script: plan.scripts[0]?.content ?? '', statements: plan.scripts[0]?.statements ?? 0 }
}

// @lat: [[emitters#Ladybug Target#Measured ALTER Support]]
describe('LadybugDB 0.19.1 ALTER support, measured', () => {
  const base = 'CREATE NODE TABLE P(id STRING, name STRING, n INT64, PRIMARY KEY(id)); CREATE NODE TABLE C(id STRING, PRIMARY KEY(id)); CREATE REL TABLE K(FROM P TO P, since DATE);'

  it('accepts adding, dropping and renaming a column, and renaming a table', async () => {
    const conn = await connect(base)
    await conn.query('ALTER TABLE P ADD phone STRING')
    await conn.query('ALTER TABLE P ADD score INT64 DEFAULT 0')
    await conn.query('ALTER TABLE P DROP name')
    await conn.query('ALTER TABLE P RENAME n TO seats')
    await conn.query('ALTER TABLE K RENAME since TO started')
    await conn.query('ALTER TABLE P RENAME TO Q')
    expect(await catalogue(conn)).toMatchObject({
      'NODE Q': { columns: ['id STRING PK', 'phone STRING', 'score INT64', 'seats INT64'] },
      'REL K': { pairs: ['Q->Q'] },
    })
  })

  it('accepts adding and dropping an endpoint pair while another remains', async () => {
    const conn = await connect(base)
    await conn.query('ALTER TABLE K ADD FROM P TO C')
    await conn.query('ALTER TABLE K DROP FROM P TO P')
    expect((await catalogue(conn))['REL K']).toMatchObject({ pairs: ['P->C'] })
  })

  it('has no statement that changes a column type', async () => {
    const conn = await connect(base)
    await expect(conn.query('ALTER TABLE P ALTER n TYPE STRING')).rejects.toThrow(/Parser exception/)
  })

  it('refuses to drop a node table a rel table still references, or a primary key column', async () => {
    const conn = await connect(base)
    await expect(conn.query('DROP TABLE P')).rejects.toThrow(/referenced by relationship table K/)
    await expect(conn.query('ALTER TABLE P DROP id')).rejects.toThrow(/used as primary key/)
  })
})

// @lat: [[emitters#Migrations#Target Planners]]
describe('a migrated ladybug schema matches a fresh one', () => {
  for (const pair of PAIRS) {
    it(pair.name, async () => {
      const { before, after, script, statements } = migration(pair.name)
      const migrated = await connect(emit(before, 'ladybug').content)
      if (statements > 0) await migrated.query(script)
      const fresh = await connect(emit(after, 'ladybug').content)
      expect(await catalogue(migrated)).toEqual(await catalogue(fresh))
    })
  }
})

// @lat: [[emitters#Migrations#Target Planners]]
describe('a ladybug migration keeps the data it does not remove', () => {
  const seed = [
    "CREATE (:Person {id: 'p1', email: 'a@x', nickname: 'al'})",
    "CREATE (:Person {id: 'p2', email: 'b@x'})",
    "CREATE (:Car {vin: 'v1', seats: 4})",
    "MATCH (p:Person {id: 'p1'}), (c:Car {vin: 'v1'}) CREATE (p)-[:OWNS {since: date('2020-01-01')}]->(c)",
    "MATCH (a:Person {id: 'p1'}), (b:Person {id: 'p2'}) CREATE (a)-[:KNOWS]->(b)",
  ]

  async function seeded(name: string) {
    const { before, script } = migration(name)
    const conn = await connect(emit(before, 'ladybug').content)
    for (const q of seed) await conn.query(q)
    await conn.query(script)
    return conn
  }

  it('keeps rows and relationships through a node type rename, and the key still rejects a duplicate', async () => {
    const conn = await seeded('rename-node-type')
    expect(await all(conn, 'MATCH (p:Individual) RETURN p.id AS id, p.email AS email ORDER BY id'))
      .toEqual([{ id: 'p1', email: 'a@x' }, { id: 'p2', email: 'b@x' }])
    expect(await all(conn, 'MATCH (:Individual)-[r:OWNS]->(:Car) RETURN count(r) AS n')).toEqual([{ n: 1 }])
    expect(await all(conn, 'MATCH (:Individual)-[r:KNOWS]->(:Individual) RETURN count(r) AS n')).toEqual([{ n: 1 }])
    await expect(conn.query("CREATE (:Individual {id: 'p1'})")).rejects.toThrow()
  })

  it('keeps values through a property rename', async () => {
    const conn = await seeded('rename-property')
    expect(await all(conn, "MATCH (p:Person {id: 'p1'}) RETURN p.mail AS mail")).toEqual([{ mail: 'a@x' }])
  })

  it('applies a multiplicity change, which the catalogue cannot show', async () => {
    // one-to-many becomes many-to-many, so a second owner of the same car is now allowed.
    const conn = await seeded('change-cardinality')
    await conn.query("CREATE (:Person {id: 'p3', email: 'c@x'})")
    await conn.query("MATCH (p:Person {id: 'p1'}), (c:Car {vin: 'v1'}) CREATE (p)-[:OWNS]->(c)")
    await conn.query("MATCH (p:Person {id: 'p3'}), (c:Car {vin: 'v1'}) CREATE (p)-[:OWNS]->(c)")
    expect(await all(conn, 'MATCH ()-[r:OWNS]->(:Car {vin: \'v1\'}) RETURN count(r) AS n')).toEqual([{ n: 2 }])
  })

  it('keeps a multiplicity constraint enforced after a migration that alters the rel table', async () => {
    // one-to-many OWNS is ONE_MANY: a car has at most one owner.
    const conn = await seeded('add-subtype')
    await conn.query("CREATE (:Person {id: 'p3', email: 'c@x'})")
    await expect(conn.query("MATCH (p:Person {id: 'p3'}), (c:Car {vin: 'v1'}) CREATE (p)-[:OWNS]->(c)"))
      .rejects.toThrow(/multiplicity/)
  })
})
