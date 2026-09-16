import { describe, it, expect, afterAll } from 'vitest'
import * as lbug from '@ladybugdb/core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emit } from '../src/emit/index'
import { importModel } from '../src/import/index'
import { importLadybug, readLadybugCatalog, type LadybugConnection } from '../src/import/ladybug'
import { resolveModel } from '../src/resolve'
import { serializeModel } from '../src/serialize'
import { loadFixture, readFile } from './helpers'
import type { ModelIR } from '../src/ir'

/**
 * Reads the catalog of a real in-process LadybugDB. The column names these queries
 * return were measured rather than documented, so only a live engine can say they still
 * hold. See lat.md/importers#Reading a LadybugDB Database.
 */

/** Bounded for the reason ladybug.live.test.ts gives: many databases open at once. */
const BUFFER_POOL = 256 * 1024 * 1024
const MAX_DB_SIZE = 1024 * 1024 * 1024

const connect = (path = ':memory:', readOnly = false) => {
  const db = new lbug.Database(path, BUFFER_POOL, true, readOnly, MAX_DB_SIZE)
  return { db, conn: new lbug.Connection(db) }
}

async function catalogOf(ddl: string) {
  const { conn } = connect()
  await conn.query(ddl)
  return readLadybugCatalog(conn as unknown as LadybugConnection)
}

async function importDatabase(ddl: string) {
  const { catalog, diagnostics } = await catalogOf(ddl)
  expect(diagnostics).toEqual([])
  return importLadybug([{ path: '/db.lbdb', ladybugCatalog: catalog }])
}

const node = (m: ModelIR, name: string) => m.nodes.find((n) => n.name === name)
const edge = (m: ModelIR, name: string) => m.edges.find((e) => e.name === name)
const codes = (ds: Array<{ code: string }>) => ds.map((d) => d.code)

// @lat: [[importers#Reading a LadybugDB Database]]
describe('reading a LadybugDB database', () => {
  it('keeps exact widths, the key and its required flag', async () => {
    const { model } = await importDatabase(
      'CREATE NODE TABLE T(id STRING, huge INT128, ratio FLOAT, price DECIMAL(10,2), ' +
      'loc STRUCT(lat DOUBLE, lon DOUBLE), tags STRING[], PRIMARY KEY(id));')
    const t = node(model, 'T')
    expect(t?.key).toEqual(['id'])
    const props = new Map(t?.props.map((p) => [p.name, p]))
    expect(props.get('huge')?.type).toBe('int128')
    expect(props.get('ratio')?.type).toBe('float32')
    expect(props.get('price')).toMatchObject({ type: 'decimal', precision: 10, scale: 2 })
    expect(props.get('loc')?.composite?.kind).toBe('struct')
    expect(props.get('tags')).toMatchObject({ type: 'string', list: true })
    expect(t?.props.filter((p) => p.required).map((p) => p.name)).toEqual(['id'])
  })

  it('reads a rel table with its columns and endpoints', async () => {
    const { model } = await importDatabase(
      'CREATE NODE TABLE P(id STRING, PRIMARY KEY(id)); CREATE NODE TABLE O(name STRING, PRIMARY KEY(name)); ' +
      'CREATE REL TABLE WORKS_AT(FROM P TO O, since DATE);')
    expect(edge(model, 'WORKS_AT')).toMatchObject({ from: 'P', to: 'O' })
    expect(edge(model, 'WORKS_AT')?.props.map((p) => [p.name, p.type])).toEqual([['since', 'date']])
  })

  it('reads a table name that needs quoting in the catalog call', async () => {
    const { model } = await importDatabase("CREATE NODE TABLE `it's`(id STRING, PRIMARY KEY(id));")
    expect(node(model, "it's")?.key).toEqual(['id'])
  })
})

// @lat: [[importers#Verification]]
describe('a database and its DDL import to the same model', () => {
  const models: Array<[string, () => ModelIR]> = [
    ['fixture social', () => loadFixture('social.lpg.yaml')],
    ['fixture types', () => loadFixture('types.lpg.yaml')],
    ['fixture composites', () => loadFixture('composites.lpg.yaml')],
    ...['social', 'fleet', 'catalog', 'booking', 'kinship'].map((name): [string, () => ModelIR] =>
      [`example ${name}`, () => resolveModel(join(__dirname, `../../../docs/examples/${name}.lpg.yaml`), readFile).model]),
  ]

  for (const [label, load] of models) {
    it(label, async () => {
      const ddl = emit(load(), 'ladybug').content
      const fromDdl = importLadybug([{ path: '/x', text: ddl }]).model
      const fromDb = (await importDatabase(ddl)).model
      // Multiplicity is the one thing only the script records.
      for (const e of fromDdl.edges) e.cardinality = { from: { min: 0, max: null }, to: { min: 0, max: null } }
      expect(serializeModel(fromDb)).toBe(serializeModel(fromDdl))
    })
  }
})

// @lat: [[importers#Reading a LadybugDB Database]]
describe('what a LadybugDB database cannot carry', () => {
  it('leaves multiplicity unconstrained and says so', async () => {
    const { model, diagnostics } = await importDatabase(
      'CREATE NODE TABLE P(id STRING, PRIMARY KEY(id)); CREATE REL TABLE BOSS(FROM P TO P, MANY_ONE);')
    expect(edge(model, 'BOSS')?.cardinality).toEqual({ from: { min: 0, max: null }, to: { min: 0, max: null } })
    expect(codes(diagnostics)).toContain('import-multiplicity')
    expect(diagnostics.find((d) => d.code === 'import-multiplicity')?.message).toContain('BOSS')
  })

  it('does not report multiplicity for a script that stated it', () => {
    const { diagnostics } = importLadybug([{ path: '/x.cypher',
      text: 'CREATE NODE TABLE P(id STRING, PRIMARY KEY(id)); CREATE REL TABLE BOSS(FROM P TO P);' }])
    expect(codes(diagnostics)).not.toContain('import-multiplicity')
  })

  it('reports a table comment it could not keep', async () => {
    const { diagnostics } = await importDatabase(
      "CREATE NODE TABLE P(id STRING, PRIMARY KEY(id)); COMMENT ON TABLE P IS 'people';")
    expect(diagnostics.find((d) => d.code === 'import-comment')?.message).toContain("'P'")
  })

  it('keeps the first of several endpoint pairs when nothing says what they expand from', async () => {
    const { model, diagnostics } = await importDatabase(emit(loadFixture('social.lpg.yaml'), 'ladybug').content)
    expect(codes(diagnostics)).toContain('import-endpoints')
    expect(edge(model, 'OWNS')?.to).toBe('Car')
  })

  it('skips a column whose type the metamodel does not know, and says which', async () => {
    // SERIAL is an engine-generated counter; the metamodel has no scalar for it.
    const { model, diagnostics } = await importDatabase(
      'CREATE NODE TABLE P(id STRING, seq SERIAL, PRIMARY KEY(id));')
    expect(diagnostics.find((d) => d.code === 'import-type')?.message).toContain("'P.seq'")
    expect(node(model, 'P')?.props.map((p) => p.name)).toEqual(['id'])
  })

  it('reports a catalog query the engine refuses, rather than returning an empty model', async () => {
    const refusing: LadybugConnection = { query: async () => { throw new Error('boom') } }
    const { catalog, diagnostics } = await readLadybugCatalog(refusing)
    expect(catalog.tables).toEqual([])
    expect(diagnostics).toMatchObject([{ severity: 'error', code: 'import-catalog' }])
  })

  it('reports a catalog column this reader does not know the name of', async () => {
    const renamed: LadybugConnection = {
      query: async () => ({ getAll: async () => [{ name: 'P', kind: 'NODE' }] }),
    }
    const { diagnostics } = await readLadybugCatalog(renamed)
    expect(diagnostics[0]?.message).toContain("'type'")
  })
})

// @lat: [[importers#Combining Sources]]
describe('combining a LadybugDB database with RDF', () => {
  it('takes the hierarchy from RDF and the widths and endpoints from the database', async () => {
    const types = loadFixture('types.lpg.yaml')
    const typed = await catalogOf(emit(types, 'ladybug').content)
    const { model } = importModel([
      { path: '/t.shacl.ttl', text: emit(types, 'shacl').content },
      { path: '/t.owl.ttl', text: emit(types, 'owl').content },
      { path: '/t.lbdb', ladybugCatalog: typed.catalog },
    ])
    const props = new Map(model.nodes.flatMap((n) => n.props).map((p) => [p.name, p.type]))
    expect(props.get('huge')).toBe('int128')
    expect(props.get('ref')).toBe('uuid')

    const social = loadFixture('social.lpg.yaml')
    const db = await catalogOf(emit(social, 'ladybug').content)
    const combined = importModel([
      { path: '/s.shacl.ttl', text: emit(social, 'shacl').content },
      { path: '/s.owl.ttl', text: emit(social, 'owl').content },
      { path: '/s.lbdb', ladybugCatalog: db.catalog },
    ])
    expect(node(combined.model, 'Person')?.extends).toBe('Party')
    expect(edge(combined.model, 'OWNS')).toMatchObject({ from: 'Party', to: 'Car' })
    expect(codes(combined.diagnostics)).toContain('import-collapsed')
  })

  it('applies a width to the ancestor that declares the property', async () => {
    const { model: fleet } = resolveModel(join(__dirname, '../../../docs/examples/fleet.lpg.yaml'), readFile)
    const db = await catalogOf(emit(fleet, 'ladybug').content)
    const { model } = importModel([
      { path: '/f.shacl.ttl', text: emit(fleet, 'shacl').content },
      { path: '/f.owl.ttl', text: emit(fleet, 'owl').content },
      { path: '/f.lbdb', ladybugCatalog: db.catalog },
    ])
    expect(node(model, 'Asset')?.props.find((p) => p.name === 'createdAt')?.type).toBe('zoneddatetime')
    expect(node(model, 'Truck')?.props.map((p) => p.name)).not.toContain('createdAt')
  })
})

// @lat: [[importers#Reading a LadybugDB Database]]
describe('importing does not change the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lpg-lbdb-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('opens read-only and leaves catalog and data as they were', async () => {
    const path = join(dir, 'social.lbdb')
    {
      const { db, conn } = connect(path)
      await conn.query(emit(loadFixture('social.lpg.yaml'), 'ladybug').content)
      await conn.query("CREATE (:Person {id: '1', email: 'a@b.c'})")
      await conn.close(); await db.close()
    }
    const snapshot = async (conn: lbug.Connection) => {
      const all = async (q: string) => (await (await conn.query(q) as lbug.QueryResult).getAll())
      const tables = await all('CALL show_tables() RETURN name, type ORDER BY name')
      const person = await all("CALL table_info('Person') RETURN *")
      const rows = await all('MATCH (n) RETURN count(n) AS n')
      return JSON.stringify({ tables, person, rows })
    }

    const before = await (async () => {
      const { db, conn } = connect(path, true)
      const s = await snapshot(conn)
      await conn.close(); await db.close()
      return s
    })()

    const { db, conn } = connect(path, true)
    const { diagnostics } = await readLadybugCatalog(conn as unknown as LadybugConnection)
    expect(diagnostics).toEqual([])
    await expect(conn.query("CREATE (:Person {id: '2', email: 'x@y.z'})")).rejects.toThrow()
    await conn.close(); await db.close()

    const { db: db2, conn: conn2 } = connect(path, true)
    expect(await snapshot(conn2)).toBe(before)
    await conn2.close(); await db2.close()
  })
})
