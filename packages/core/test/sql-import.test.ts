import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectFormat, importModel } from '../src/import/index'
import { importSql, splitSqlStatements } from '../src/import/sql'
import { serializeModel } from '../src/serialize'
import { resolveModel } from '../src/resolve'
import { validateModel } from '../src/validate'
import { fixture } from './helpers'

const shopText = () => readFileSync(fixture('shop.sql'), 'utf8')
const shop = () => importSql([{ path: fixture('shop.sql'), text: shopText() }])
const codes = (ds: { code: string }[]) => ds.map((d) => d.code)

// @lat: [[importers#Reading SQL DDL]]
describe('sql import', () => {
  it('is recognised by extension and by content', () => {
    expect(detectFormat({ path: '/x/schema.sql', text: '' })).toBe('sql')
    expect(detectFormat({ path: '/x/schema.txt', text: 'CREATE TABLE a (b int);' })).toBe('sql')
    // The LadybugDB spelling keeps its own reader.
    expect(detectFormat({ path: '/x/schema.txt', text: 'CREATE NODE TABLE A (b INT64, PRIMARY KEY(b));' })).toBe('ladybug')
  })

  it('splits statements outside quotes, comments and dollar bodies', () => {
    const parts = splitSqlStatements(
      "CREATE TABLE a (x text DEFAULT 'a;b'); -- c;\n/* d; */ CREATE FUNCTION f() AS $$ x; y; $$;")
    expect(parts).toHaveLength(2)
    expect(parts[1]).toContain('$$ x; y; $$')
  })

  it('reads tables, keys, types and limits', () => {
    const { model } = shop()
    const person = model.nodes.find((n) => n.name === 'Person')!
    expect(person.key).toEqual(['id'])
    const email = person.props.find((p) => p.name === 'email')!
    expect(email).toMatchObject({ type: 'string', required: true, unique: true, maxLength: 255 })
    expect(person.props.find((p) => p.name === 'balance')).toMatchObject({
      type: 'decimal', precision: 10, scale: 2,
    })
    expect(person.props.find((p) => p.name === 'tags')).toMatchObject({ type: 'string', list: true })
    // ALTER TABLE … ADD CONSTRAINT names the key after the table exists.
    expect(model.nodes.find((n) => n.name === 'Product')!.key).toEqual(['sku'])
  })

  it('reads an enum type and the column that uses it', () => {
    const { model } = shop()
    expect(model.enums.find((e) => e.name === 'OrderStatus')!.values)
      .toEqual(['placed', 'shipped', 'cancelled'])
    expect(model.nodes.find((n) => n.name === 'Orders')!
      .props.find((p) => p.name === 'status')!.enum).toBe('OrderStatus')
  })

  // @lat: [[importers#Reading SQL DDL#Foreign keys become edges]]
  it('turns a foreign key into an edge and drops the column', () => {
    const { model, diagnostics } = shop()
    const buyer = model.edges.find((e) => e.name === 'BUYER')!
    expect(buyer).toMatchObject({ from: 'Orders', to: 'Person' })
    expect(buyer.cardinality.to).toEqual({ min: 1, max: 1 })
    expect(model.nodes.find((n) => n.name === 'Orders')!
      .props.some((p) => p.name === 'buyer_id')).toBe(false)
    expect(codes(diagnostics)).toContain('import-fk-edge')
  })

  it('bounds the from end at one when the foreign key column is unique', () => {
    const { model } = shop()
    const edge = model.edges.find((e) => e.from === 'Profile' && e.to === 'Person')!
    expect(edge.cardinality.from.max).toBe(1)
  })

  // @lat: [[importers#Reading SQL DDL#The join-table rule]]
  it('reads a join table as an edge type with the leftover columns as properties', () => {
    const { model, diagnostics } = shop()
    const line = model.edges.find((e) => e.name === 'ORDER_LINE')!
    expect(line).toMatchObject({ from: 'Orders', to: 'Product' })
    expect(line.props.map((p) => p.name)).toEqual(['quantity'])
    expect(model.nodes.some((n) => n.name === 'OrderLine')).toBe(false)
    expect(codes(diagnostics)).toContain('import-join-table')
  })

  it('keeps a table with its own identity a node type, however many keys it holds', () => {
    const text = 'CREATE TABLE a (id int PRIMARY KEY);'
      + 'CREATE TABLE b (id int PRIMARY KEY);'
      + 'CREATE TABLE ab (id int PRIMARY KEY, a_id int REFERENCES a(id), b_id int REFERENCES b(id));'
    const { model } = importSql([{ path: '/x.sql', text }])
    expect(model.nodes.some((n) => n.name === 'Ab')).toBe(true)
    expect(model.edges).toHaveLength(2)
  })

  it('keeps a foreign key column that is part of the primary key, and says so', () => {
    const text = 'CREATE TABLE a (id int PRIMARY KEY);'
      + 'CREATE TABLE v (a_id int NOT NULL REFERENCES a(id), n int NOT NULL, x text, PRIMARY KEY (a_id, n));'
    const { model, diagnostics } = importSql([{ path: '/x.sql', text }])
    const v = model.nodes.find((n) => n.name === 'V')!
    expect(v.key).toEqual(['a_id', 'n'])
    expect(v.props.some((p) => p.name === 'a_id')).toBe(true)
    expect(model.edges).toHaveLength(1)
    expect(diagnostics.find((d) => d.code === 'import-fk-edge')!.message).toContain('kept')
  })

  it('reports what it could not carry, and what it skipped', () => {
    const { diagnostics } = shop()
    const all = codes(diagnostics)
    expect(all).toContain('import-foreign-datatype') // point
    expect(all).toContain('import-serial')           // bigserial
    expect(all).toContain('import-renamed')          // person → Person
    const skipped = diagnostics.find((d) => d.code === 'import-skipped-statements')!
    expect(skipped.message).toContain('CREATE INDEX')
    expect(skipped.message).toContain('GRANT')
  })

  it('is imported on its own, like a live instance', () => {
    const { diagnostics } = importModel([
      { path: '/a.sql', text: 'CREATE TABLE a (id int PRIMARY KEY);' },
      { path: '/b.ttl', text: '@prefix sh: <http://www.w3.org/ns/shacl#> .' },
    ])
    expect(codes(diagnostics)).toContain('import-mixed-sources')
  })

  // @lat: [[importers#Serializing a Model]]
  it('serializes to a model that resolves and validates cleanly', () => {
    const { model } = shop()
    const text = serializeModel(model)
    const resolved = resolveModel('/imported.lpg.yaml', () => text)
    const errors = [...resolved.diagnostics, ...validateModel(resolved.model)]
      .filter((d) => d.severity === 'error')
    expect(errors).toEqual([])
    expect(resolved.model.nodes.map((n) => n.name).sort())
      .toEqual(['Orders', 'Person', 'Product', 'Profile'])
  })
})
