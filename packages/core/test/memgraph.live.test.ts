import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { emit } from '../src/emit/index'
import { resolveModel } from '../src/resolve'
import { validateModel } from '../src/validate'
import { serializeModel } from '../src/serialize'
import { memgraphCatalogToModel, readMemgraphSchema } from '../src/import/memgraph'
import { concreteDescendants, concreteNodes, type ModelIR } from '../src/ir'
import { loadFixture, readFile } from './helpers'
import {
  MEMGRAPH_URI, enumsOf, reset, run, runScript, schemaState, seed, session, useMemgraph, withUniqueEnums,
} from './memgraph-harness'

const example = (name: string): ModelIR =>
  resolveModel(join(__dirname, `../../../docs/examples/${name}.lpg.yaml`), readFile).model

/**
 * What Memgraph 3.13.1 Community accepts, enforces and refuses, pinned against a running
 * instance. The target, its migration planner and its importer are built on exactly these
 * findings, so a Memgraph release that changes one fails here first.
 * See lat.md/emitters#Memgraph Target#Measured Schema Syntax.
 */
useMemgraph()

/** Enums outlive every reset, and even a restart, so each test names its own. */
const fresh = () => `E${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const rejects = (statement: string, message: RegExp) => expect(run(statement)).rejects.toThrow(message)

// @lat: [[emitters#Memgraph Target#Measured Schema Syntax]]
describe.runIf(MEMGRAPH_URI).sequential('Memgraph 3.13.1 schema syntax, measured', () => {
  beforeEach(reset)

  it('reports the version these findings were measured against', async () => {
    expect(await run('SHOW VERSION')).toEqual([{ version: '3.13.1' }])
  })

  it('accepts uniqueness, composite uniqueness, existence and every value type', async () => {
    await run('CREATE CONSTRAINT ON (n:P) ASSERT n.id IS UNIQUE')
    await run('CREATE CONSTRAINT ON (n:P) ASSERT n.a, n.b IS UNIQUE')
    await run('CREATE CONSTRAINT ON (n:P) ASSERT EXISTS (n.id)')
    const types = ['BOOLEAN', 'DATE', 'DURATION', 'ENUM', 'FLOAT', 'INTEGER', 'LIST',
      'LOCALDATETIME', 'LOCALTIME', 'MAP', 'POINT', 'STRING', 'ZONEDDATETIME']
    for (const t of types) await run(`CREATE CONSTRAINT ON (n:T) ASSERT n.x${t} IS TYPED ${t}`)
    expect((await run('SHOW CONSTRAINT INFO')).length).toBe(3 + types.length)
  })

  it('reports four value types under a different spelling than it accepts', async () => {
    for (const t of ['BOOLEAN', 'LOCALDATETIME', 'LOCALTIME', 'ZONEDDATETIME']) {
      await run(`CREATE CONSTRAINT ON (n:T) ASSERT n.x${t} IS TYPED ${t}`)
    }
    const reported = Object.fromEntries((await run('SHOW CONSTRAINT INFO')).map((c) => [c.properties, c.data_type]))
    expect(reported).toEqual({
      xBOOLEAN: 'BOOL', xLOCALDATETIME: 'LOCAL DATE TIME', xLOCALTIME: 'LOCAL TIME', xZONEDDATETIME: 'ZONED DATE TIME',
    })
    await rejects('DROP CONSTRAINT ON (n:T) ASSERT n.xBOOLEAN IS TYPED BOOL', /parsing error/)
  })

  it('enforces every constraint on write', async () => {
    await run('CREATE CONSTRAINT ON (n:P) ASSERT n.id IS UNIQUE')
    await run('CREATE CONSTRAINT ON (n:P) ASSERT EXISTS (n.id)')
    await run('CREATE CONSTRAINT ON (n:P) ASSERT n.age IS TYPED INTEGER')
    await run("CREATE (:P {id: '1', age: 3})")
    await rejects("CREATE (:P {id: '1'})", /unique constraint violation/)
    await rejects('CREATE (:P {age: 4})', /existence constraint violation/)
    await rejects("CREATE (:P {id: '2', age: 'old'})", /IS TYPED INTEGER violation/)
  })

  it('refuses a constraint that existing data already violates, at once', async () => {
    await run('CREATE (:Y {v: 1}), (:Y {v: 1}), (:Y {s: 2}), (:Z)')
    await rejects('CREATE CONSTRAINT ON (n:Y) ASSERT n.v IS UNIQUE', /existing node violates it/)
    await rejects('CREATE CONSTRAINT ON (n:Z) ASSERT EXISTS (n.v)', /existing node violates it/)
    await rejects('CREATE CONSTRAINT ON (n:Y) ASSERT n.s IS TYPED STRING', /existing node violates it/)
  })

  it('has no node key, no relationship constraint and no IF NOT EXISTS', async () => {
    await rejects('CREATE CONSTRAINT ON (n:P) ASSERT n.id IS NODE KEY', /parsing error/)
    await rejects('CREATE CONSTRAINT ON ()-[r:K]-() ASSERT EXISTS (r.w)', /parsing error/)
    await rejects('CREATE CONSTRAINT IF NOT EXISTS ON (n:P) ASSERT EXISTS (n.id)', /parsing error/)
    await rejects('CREATE INDEX IF NOT EXISTS ON :P(id)', /parsing error/)
  })

  it('repeats uniqueness, existence and an index silently, but not a type constraint', async () => {
    for (let i = 0; i < 2; i++) {
      await run('CREATE CONSTRAINT ON (n:P) ASSERT n.id IS UNIQUE')
      await run('CREATE CONSTRAINT ON (n:P) ASSERT EXISTS (n.id)')
      await run('CREATE INDEX ON :P(email)')
    }
    await run('CREATE CONSTRAINT ON (n:P) ASSERT n.age IS TYPED INTEGER')
    await rejects('CREATE CONSTRAINT ON (n:P) ASSERT n.age IS TYPED INTEGER', /already exists/)
  })

  it('drops constraints and indexes, and repeats a drop silently', async () => {
    await run('CREATE CONSTRAINT ON (n:P) ASSERT n.id IS UNIQUE')
    await run('CREATE INDEX ON :P(email)')
    await run('CREATE EDGE INDEX ON :K(w)')
    for (let i = 0; i < 2; i++) {
      await run('DROP CONSTRAINT ON (n:P) ASSERT n.id IS UNIQUE')
      await run('DROP INDEX ON :P(email)')
      await run('DROP EDGE INDEX ON :K(w)')
    }
    expect(await run('SHOW CONSTRAINT INFO')).toEqual([])
    expect(await run('SHOW INDEX INFO')).toEqual([])
  })

  it('creates and extends an enum, but can neither remove a value nor drop the enum', async () => {
    const e = fresh()
    await run(`CREATE ENUM ${e} VALUES { active, retired }`)
    await rejects(`CREATE ENUM ${e} VALUES { active, retired }`, /Enum already exists/)
    await run(`ALTER ENUM ${e} ADD VALUE sold`)
    await run(`ALTER ENUM ${e} UPDATE VALUE sold TO scrapped`)
    await rejects(`ALTER ENUM ${e} REMOVE VALUE retired`, /Not yet implemented/)
    await rejects(`DROP ENUM ${e}`, /Not yet implemented/)
    expect((await run('SHOW ENUMS')).find((r) => r['Enum Name'] === e))
      .toEqual({ 'Enum Name': e, 'Enum Values': ['active', 'retired', 'scrapped'] })
  })

  it('types a property as some enum, never a named one, and rejects a plain string', async () => {
    const e = fresh()
    await run(`CREATE ENUM ${e} VALUES { active }`)
    await rejects(`CREATE CONSTRAINT ON (n:C) ASSERT n.status IS TYPED ${e}`, /parsing error/)
    await run('CREATE CONSTRAINT ON (n:C) ASSERT n.status IS TYPED ENUM')
    await run(`CREATE (:C {status: ${e}::active})`)
    await rejects("CREATE (:C {status: 'active'})", /IS TYPED ENUM violation/)
  })

  it('batches every data step with USING PERIODIC COMMIT, and refuses DELETE in CALL IN TRANSACTIONS', async () => {
    await run('UNWIND range(1, 5) AS i CREATE (:Old {i: i})-[:K {w: i}]->(:B {i: i})')
    await run('MATCH (n:Old) CALL { WITH n SET n:New REMOVE n:Old } IN TRANSACTIONS OF 2 ROWS')
    await rejects('MATCH (n:B) CALL { WITH n DETACH DELETE n } IN TRANSACTIONS OF 2 ROWS', /Not yet implemented/)
    await run('USING PERIODIC COMMIT 2 MATCH (a)-[r:K]->(b) CREATE (a)-[r2:K2]->(b) SET r2 = properties(r) DELETE r')
    await run('USING PERIODIC COMMIT 2 MATCH (n:B) DETACH DELETE n')
    expect(await run('MATCH (n:New) RETURN count(n) AS n')).toEqual([{ n: 5 }])
    expect(await run('MATCH (n:B) RETURN count(n) AS n')).toEqual([{ n: 0 }])
  })

  it('reports schema information as JSON when the server enables it', async () => {
    await run('CREATE (:Person:Party {id: "1"})-[:OWNS {since: date("2020-01-01")}]->(:Car {vin: "v"})')
    const [row] = await run('SHOW SCHEMA INFO')
    const schema = JSON.parse(String(row?.schema))
    expect(schema.nodes.map((n: { labels: string[] }) => n.labels.sort().join(':')).sort())
      .toEqual(['Car', 'Party:Person'])
    expect(schema.edges[0]).toMatchObject({ type: 'OWNS', start_node_labels: ['Party', 'Person'], end_node_labels: ['Car'] })
  })
})

// @lat: [[emitters#Memgraph Target]]
describe.runIf(MEMGRAPH_URI).sequential('generated memgraph schema, executed', () => {
  beforeEach(reset)

  it('enforces the social model: key present, key unique, value typed', async () => {
    const { model } = withUniqueEnums(loadFixture('social.lpg.yaml'))
    await runScript(emit(model, 'memgraph').content)
    await run("CREATE (:Person:Party {id: 'p1', email: 'a@x', createdAt: localDateTime('2020-01-01T00:00:00')})")
    await expect(run("CREATE (:Person:Party {email: 'b@x', createdAt: localDateTime('2020-01-01T00:00:00')})")).rejects.toThrow(/existence constraint/)
    await expect(run("CREATE (:Person:Party {id: 'p1', email: 'c@x', createdAt: localDateTime('2020-01-01T00:00:00')})")).rejects.toThrow(/unique constraint/)
    await expect(run("CREATE (:Car {vin: 'v1', seats: 'four'})")).rejects.toThrow(/IS TYPED INTEGER/)
    await run("CREATE (:Car {vin: 'v1', seats: 4})")
  })

  it('enforces the booking model, enum included', async () => {
    const { model, suffix } = withUniqueEnums(example('booking'))
    await runScript(emit(model, 'memgraph').content)
    const status = `Status${suffix}`
    const valid = `ref: 'b1', startDate: date('2026-01-01'), endDate: date('2026-01-03')`
    await run(`CREATE (:Booking {${valid}, status: ${status}::held, nights: 2})`)
    await expect(run(`CREATE (:Booking {ref: 'b2', startDate: date('2026-01-01'), endDate: date('2026-01-03'), status: 'held'})`))
      .rejects.toThrow(/IS TYPED ENUM/)
    await expect(run(`CREATE (:Booking {${valid}})`)).rejects.toThrow(/unique constraint/)
    await expect(run("CREATE (:Booking {ref: 'b3', startDate: date('2026-01-01')})")).rejects.toThrow(/existence constraint/)
    expect(enumsOf((await schemaState()).enums, suffix)).toEqual(['Status held,confirmed,cancelled'])
  })
})

// @lat: [[importers#Reading a Memgraph Instance]]
describe.runIf(MEMGRAPH_URI).sequential('importing a running memgraph', () => {
  beforeEach(reset)

  for (const name of ['social', 'catalog']) {
    it(`round-trips the ${name} example through an instance`, async () => {
      const { model, suffix } = withUniqueEnums(example(name))
      await runScript(emit(model, 'memgraph').content)
      await seed(model)

      const { catalog, diagnostics } = await readMemgraphSchema(session)
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      const imported = memgraphCatalogToModel(catalog, 'bolt://test').model
      const back = new Map(imported.nodes.map((n) => [n.name, n]))

      for (const node of concreteNodes(model)) {
        const got = back.get(node.name)
        expect(got, node.name).toBeDefined()
        expect(got!.abstract, node.name).toBe(false)
        expect([...got!.key].sort(), `${node.name} key`).toEqual([...node.key].sort())
        const props = new Map(got!.props.map((p) => [p.name, p]))
        for (const p of node.props) {
          if (p.required) expect(props.get(p.name)?.required, `${node.name}.${p.name} required`).toBe(true)
          if (p.unique && !node.key.includes(p.name)) expect(props.get(p.name)?.unique, `${node.name}.${p.name} unique`).toBe(true)
          if (p.enum) expect(props.get(p.name)?.enum, `${node.name}.${p.name} enum`).toBe(p.enum)
        }
      }
      for (const e of model.enums) {
        expect(imported.enums.find((x) => x.name === e.name)?.values, e.name.replace(suffix, '')).toEqual(e.values)
      }
      for (const node of model.nodes.filter((n) => n.extends && !n.abstract)) {
        expect(back.get(node.name)?.extends, `${node.name} extends`).toBe(node.extends)
      }
      for (const edge of model.edges) {
        const from = concreteDescendants(model, edge.from)[0]!.name
        expect(imported.edges.find((x) => x.name === edge.name), edge.name).toMatchObject({ from, to: concreteDescendants(model, edge.to)[0]!.name })
      }

      // What comes back is a model: it serializes, resolves and checks without errors.
      const text = serializeModel(imported)
      const resolved = resolveModel('/virtual/imported.lpg.yaml', (p) => (p === '/virtual/imported.lpg.yaml' ? text : undefined))
      const errors = [...resolved.diagnostics, ...validateModel(resolved.model)].filter((d) => d.severity === 'error')
      expect(errors).toEqual([])
    })
  }

  it('reads constraints and enums alone when schema information is unavailable', async () => {
    const { model } = withUniqueEnums(example('social'))
    await runScript(emit(model, 'memgraph').content)
    await seed(model)
    const disabled = {
      run: (statement: string) => (statement === 'SHOW SCHEMA INFO'
        ? Promise.reject(new Error('SchemaInfo query is disabled. To enable it, start Memgraph with the --schema-info-enabled flag.'))
        : run(statement)),
    }
    const { catalog, diagnostics } = await readMemgraphSchema(disabled)
    expect(diagnostics.map((d) => d.code)).toEqual(['import-schema-info-disabled'])
    const imported = memgraphCatalogToModel(catalog, 'bolt://test').model
    expect(imported.edges).toEqual([])
    expect(imported.nodes.find((n) => n.name === 'Person')?.key).toEqual(['id'])
  })
})
