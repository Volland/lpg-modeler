import { describe, it, expect } from 'vitest'
import * as lbug from '@ladybugdb/core'
import { emit } from '../src/emit/index'
import { loadFixture } from './helpers'

/**
 * Executes generated DDL against a real in-process LadybugDB. A golden file only proves
 * output has not changed; this proves it is valid and that the constraints it claims to
 * create are actually enforced. See lat.md/emitters#Verification.
 */
// @lat: [[emitters#Verification]]
describe('ladybug emitter, executed', () => {
  const connect = async () => {
    const db = new lbug.Database(':memory:')
    return new lbug.Connection(db)
  }

  it('generated DDL executes against LadybugDB', async () => {
    const conn = await connect()
    const out = emit(loadFixture('social.lpg.yaml'), 'ladybug')
    await conn.query(out.content)
    const r = await conn.query('CALL show_tables() RETURN name ORDER BY name')
    const names = (await r.getAll()).map((row: Record<string, unknown>) => row.name)
    expect(names).toEqual(['Car', 'Company', 'KNOWS', 'LIKES', 'OWNS', 'Person'])
  })

  it('enforces the key: a null key is rejected', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('social.lpg.yaml'), 'ladybug').content)
    await expect(conn.query("CREATE (:Person {email: 'a@b.c'})")).rejects.toThrow()
  })

  it('enforces the key: a duplicate key value is rejected', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('social.lpg.yaml'), 'ladybug').content)
    await conn.query("CREATE (:Person {id: '1', email: 'a@b.c'})")
    await expect(conn.query("CREATE (:Person {id: '1', email: 'd@e.f'})")).rejects.toThrow()
  })

  it('confirms the downgrade is real: a null non-key required value is accepted', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('social.lpg.yaml'), 'ladybug').content)
    // 'email' is required in the model. LadybugDB cannot enforce that, which is exactly
    // why the emitter reports a downgrade rather than claiming the constraint holds.
    await conn.query("CREATE (:Person {id: '2'})")
    const r = await conn.query("MATCH (p:Person) WHERE p.email IS NULL RETURN count(p) AS n")
    expect((await r.getAll())[0]?.n).toBe(1)
  })

  it('accepts an expanded abstract endpoint on both concrete sides', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('social.lpg.yaml'), 'ladybug').content)
    await conn.query("CREATE (:Person {id: 'p1'}), (:Company {id: 'c1'}), (:Car {vin: 'v1'})")
    await conn.query("MATCH (p:Person {id:'p1'}), (c:Car {vin:'v1'}) CREATE (p)-[:OWNS {since: date('2020-01-01')}]->(c)")
    await conn.query("MATCH (o:Company {id:'c1'}), (c:Car {vin:'v1'}) CREATE (o)-[:OWNS]->(c)")
    const r = await conn.query('MATCH ()-[o:OWNS]->() RETURN count(o) AS n')
    expect((await r.getAll())[0]?.n).toBe(2)
  })
})
