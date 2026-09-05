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

  // @lat: [[metamodel#Scalar Types]]
  it('creates a table with every scalar the metamodel has, and reads each value back', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('types.lpg.yaml'), 'ladybug').content)
    await conn.query(`CREATE (:Reading {
      id: 'r1', tiny: 7, small: 300, medium: 70000, big: 5000000000,
      huge: 170141183460469231731687303715884105, utiny: 200, usmall: 60000,
      umedium: 4000000000, ubig: 9000000000000000000,
      ratio: 1.5, precise: 2.25, amount: 3.142,
      ok: true, day: DATE('2024-01-02'), at: TIMESTAMP('2024-01-02 03:04:05'),
      atZoned: TIMESTAMP('2024-01-02 03:04:05+02'), took: INTERVAL('1 day'),
      ref: UUID('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'), raw: BLOB('\\xAA'),
      payload: '{"k": 1}', samples: [1.25, 2.50]
    })`)
    const r = await conn.query(`MATCH (x:Reading) RETURN
      x.tiny AS tiny, x.amount AS amount, x.took AS took, x.payload AS payload,
      x.raw AS raw, x.samples AS samples, x.atZoned AS atZoned`)
    const row = (await r.getAll())[0]!
    expect(row.tiny).toBe(7)
    expect(Number(row.amount)).toBeCloseTo(3.142)
    expect(row.payload).toEqual({ k: 1 })
    expect(row.samples.map(Number)).toEqual([1.25, 2.5])
    expect(row.took).toBeDefined()
    expect(row.raw).toBeDefined()
    expect(row.atZoned).toBeDefined()
  })

  // @lat: [[metamodel#Lists]]
  it('round-trips a list-valued property', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('features.lpg.yaml'), 'ladybug').content)
    await conn.query("CREATE (:Driver {licence: 'L1', nicknames: ['Ace', 'Red']})")
    const r = await conn.query('MATCH (d:Driver) RETURN d.nicknames AS n')
    expect((await r.getAll())[0]?.n).toEqual(['Ace', 'Red'])
  })

  // @lat: [[metamodel#Cardinality]]
  it('enforces many-to-one: a second target for one source is rejected', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('features.lpg.yaml'), 'ladybug').content)
    await conn.query("CREATE (:Driver {licence: 'L1'}), (:Vehicle {vin: 'V1'}), (:Vehicle {vin: 'V2'})")
    await conn.query("MATCH (d:Driver), (v:Vehicle {vin:'V1'}) CREATE (d)-[:DRIVES]->(v)")
    // Unlike a required property, this constraint is genuinely enforced on write, which
    // is why cardinality is declared 'enforced' rather than reported as a downgrade.
    await expect(conn.query("MATCH (d:Driver), (v:Vehicle {vin:'V2'}) CREATE (d)-[:DRIVES]->(v)"))
      .rejects.toThrow()
  })

  // @lat: [[metamodel#Enums]]
  it('confirms the enum downgrade is real: an undeclared value is accepted', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('features.lpg.yaml'), 'ladybug').content)
    // 'nonsense' is not in the Status enum. LadybugDB has no enum column type, which is
    // exactly why the emitter reports a downgrade rather than claiming the set holds.
    await conn.query("CREATE (:Driver {licence: 'L9', status: 'nonsense'})")
    const r = await conn.query("MATCH (d:Driver {licence:'L9'}) RETURN d.status AS s")
    expect((await r.getAll())[0]?.s).toBe('nonsense')
  })

  // @lat: [[metamodel#Cardinality]]
  it('executes DDL carrying a bound no keyword can express', async () => {
    const conn = await connect()
    // The exact count of two produces a comment where an entry would be; the DDL has to
    // stay parseable, which a golden file alone would not prove.
    await conn.query(emit(loadFixture('kinship.lpg.yaml'), 'ladybug').content)
    const r = await conn.query('CALL show_tables() RETURN name ORDER BY name')
    expect((await r.getAll()).map((row: Record<string, unknown>) => row.name))
      .toEqual(['HAS_PARENT', 'HELD_BY', 'Passport', 'Person'])
  })

  it('enforces the one end of a bound it could express', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('kinship.lpg.yaml'), 'ladybug').content)
    await conn.query("CREATE (:Person {ssn:'a'}), (:Passport {number:'p1'}), (:Passport {number:'p2'})")
    await conn.query("MATCH (p:Passport {number:'p1'}), (q:Person) CREATE (p)-[:HELD_BY]->(q)")
    // 'from' is bounded at one, which ONE_MANY does carry.
    await expect(
      conn.query("MATCH (p:Passport {number:'p2'}), (q:Person) CREATE (p)-[:HELD_BY]->(q)"))
      .rejects.toThrow()
  })

  it('confirms the exact-count downgrade is real: a third parent is accepted', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('kinship.lpg.yaml'), 'ladybug').content)
    await conn.query("CREATE (:Person {ssn:'c'}), (:Person {ssn:'m'}), (:Person {ssn:'f'}), (:Person {ssn:'x'})")
    for (const p of ['m', 'f', 'x']) {
      await conn.query(`MATCH (c:Person {ssn:'c'}), (p:Person {ssn:'${p}'}) CREATE (c)-[:HAS_PARENT]->(p)`)
    }
    // Exactly two is unenforceable here, which is why it is reported rather than claimed.
    const r = await conn.query("MATCH (:Person {ssn:'c'})-[h:HAS_PARENT]->() RETURN count(h) AS n")
    expect((await r.getAll())[0]?.n).toBe(3)
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

  // @lat: [[emitters#Composite Types]]
  it('creates every composite column with the type it was written as', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('composites.lpg.yaml'), 'ladybug').content)
    const r = await conn.query('CALL TABLE_INFO("Sensor") RETURN name, type')
    const columns = new Map((await r.getAll()).map((row: Record<string, unknown>) =>
      [row.name as string, row.type as string]))
    // LadybugDB reports the column type back, so this proves the composite reached the
    // catalogue intact rather than merely that the DDL parsed.
    expect(columns.get('embedding')).toBe('DOUBLE[128]')
    expect(columns.get('rgb')).toBe('UINT8[3]')
    expect(columns.get('location')).toBe('STRUCT(lat DOUBLE, lon DOUBLE, label STRING)')
    expect(columns.get('tags')).toBe('MAP(STRING, STRING)')
    expect(columns.get('reading')).toBe('UNION(num DOUBLE, text STRING)')
    expect(columns.get('history')).toBe('STRUCT(at TIMESTAMP, values DOUBLE[])[]')
    expect(columns.get('grid')).toBe('INT64[][]')
  })

  // @lat: [[emitters#Composite Types]]
  it('stores and reads back a struct and a map value', async () => {
    const conn = await connect()
    await conn.query(emit(loadFixture('composites.lpg.yaml'), 'ladybug').content)
    await conn.query(`CREATE (:Sensor {
      id: 's1',
      location: {lat: 1.5, lon: 2.5, label: 'dock'},
      tags: map(['unit'], ['celsius'])
    })`)
    const r = await conn.query(
      "MATCH (s:Sensor) RETURN s.location.label AS label, map_extract(s.tags, 'unit')[1] AS unit")
    const row = (await r.getAll())[0] as Record<string, unknown>
    expect(row.label).toBe('dock')
    expect(row.unit).toBe('celsius')
  })

})
