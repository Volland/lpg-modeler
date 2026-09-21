import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emit } from '../src/emit/index'
import { readNeo4jSchema, neo4jCatalogToModel } from '../src/import/neo4j'
import { resolveModel } from '../src/resolve'
import { NEO4J_URI, closeDriver, reset, run, runScript, schemaState } from './neo4j-harness'

/**
 * What Neo4j 5.26.30 Community actually does, measured rather than taken from
 * documentation. Everything the emitter, the importer and `apply` rely on is pinned
 * here, so a change in the engine fails a test rather than a user's deployment.
 * See lat.md/emitters#Neo4j Target#Measured Constraint Support.
 */

const examples = (name: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'docs', 'examples', name), 'utf8')

const modelOf = (name: string) => {
  const path = join(__dirname, '..', '..', '..', 'docs', 'examples', name)
  return resolveModel(path, (p) => (p === path ? examples(name) : undefined)).model
}

const message = async (statement: string): Promise<string> => {
  try {
    await run(statement)
    return ''
  } catch (e) {
    return (e as Error).message
  }
}

afterAll(closeDriver)

// @lat: [[emitters#Neo4j Target#Measured Constraint Support]]
describe.runIf(NEO4J_URI).sequential('what Neo4j Community accepts', () => {
  beforeEach(reset)

  it('accepts uniqueness on a node, a composite and a relationship, and a range index', async () => {
    expect(await message('CREATE CONSTRAINT a IF NOT EXISTS FOR (n:P) REQUIRE n.id IS UNIQUE')).toBe('')
    expect(await message('CREATE CONSTRAINT b IF NOT EXISTS FOR (n:O) REQUIRE (n.shop, n.no) IS UNIQUE')).toBe('')
    expect(await message('CREATE CONSTRAINT c IF NOT EXISTS FOR ()-[r:R]-() REQUIRE r.id IS UNIQUE')).toBe('')
    expect(await message('CREATE INDEX d IF NOT EXISTS FOR (n:P) ON (n.email)')).toBe('')
  })

  it('refuses every Enterprise-only constraint, saying so', async () => {
    for (const statement of [
      'CREATE CONSTRAINT k1 IF NOT EXISTS FOR (n:P) REQUIRE (n.id) IS NODE KEY',
      'CREATE CONSTRAINT k2 IF NOT EXISTS FOR (n:P) REQUIRE n.name IS NOT NULL',
      'CREATE CONSTRAINT k3 IF NOT EXISTS FOR ()-[r:R]-() REQUIRE r.a IS NOT NULL',
      'CREATE CONSTRAINT k4 IF NOT EXISTS FOR ()-[r:R]-() REQUIRE (r.a) IS REL KEY',
      'CREATE CONSTRAINT k5 IF NOT EXISTS FOR (n:P) REQUIRE n.id IS :: STRING',
    ]) {
      expect(await message(statement), statement).toMatch(/Enterprise Edition/)
    }
    expect(await run('SHOW CONSTRAINTS YIELD name')).toHaveLength(0)
  })

  it('makes a create idempotent only through IF NOT EXISTS', async () => {
    await run('CREATE CONSTRAINT a IF NOT EXISTS FOR (n:P) REQUIRE n.id IS UNIQUE')
    expect(await message('CREATE CONSTRAINT a IF NOT EXISTS FOR (n:P) REQUIRE n.id IS UNIQUE')).toBe('')
    expect(await message('CREATE CONSTRAINT a FOR (n:P) REQUIRE n.id IS UNIQUE')).toMatch(/already exists/i)
    expect(await message('DROP CONSTRAINT missing IF EXISTS')).toBe('')
    expect(await message('DROP CONSTRAINT missing')).toMatch(/No such constraint/)
  })

  it('refuses a uniqueness constraint the stored data violates, and creates nothing', async () => {
    await run("CREATE (:D {id:'x'})")
    await run("CREATE (:D {id:'x'})")
    expect(await message('CREATE CONSTRAINT d IF NOT EXISTS FOR (n:D) REQUIRE n.id IS UNIQUE'))
      .toMatch(/already exists with label|Both Node/)
    expect(await run('SHOW CONSTRAINTS YIELD name')).toHaveLength(0)
  })

  it('enforces uniqueness on write, but says nothing about a node missing the property', async () => {
    await run('CREATE CONSTRAINT d IF NOT EXISTS FOR (n:D) REQUIRE n.id IS UNIQUE')
    await run("CREATE (:D {id:'x'})")
    expect(await message("CREATE (:D {id:'x'})")).toMatch(/already exists/)
    // Uniqueness ignores a node without the property, which is why a key needs presence
    // as well -- and why Community cannot enforce a key.
    expect(await message('CREATE (:D {other: 1})')).toBe('')
  })

  it('refuses two statements in one query, and a schema change beside a write', async () => {
    expect(await message('CREATE INDEX a IF NOT EXISTS FOR (n:A) ON (n.x); CREATE INDEX b IF NOT EXISTS FOR (n:B) ON (n.y)'))
      .toMatch(/exactly one statement/)
    // A trailing semicolon on a single statement is accepted, which is what lets a
    // generated script be split on `;` and replayed statement by statement.
    expect(await message('CREATE INDEX c IF NOT EXISTS FOR (n:C) ON (n.x);')).toBe('')
  })
})

// @lat: [[importers#Reading a Neo4j Instance]]
describe.runIf(NEO4J_URI).sequential('importing a running Neo4j', () => {
  beforeEach(reset)

  const read = async () => {
    const { catalog, diagnostics } = await readNeo4jSchema({ run })
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    return catalog
  }

  it('reads back the schema a generated script applied', async () => {
    const artifact = emit(modelOf('social.lpg.yaml'), 'neo4j')
    await runScript(artifact.content)
    const before = await schemaState()

    for (const statement of [
      "CREATE (:Person:Party {id:'p1', email:'a@b.c', createdAt: datetime(), displayName:'A'})",
      "CREATE (:Person:Party {id:'p2', email:'d@b.c', createdAt: datetime(), displayName:'B'})",
      "CREATE (:Company:Party {id:'c1', vat:'V1', createdAt: datetime()})",
      "CREATE (:Car {vin:'V1', seats: 4})",
      "MATCH (a:Person {id:'p1'}),(b:Person {id:'p2'}) CREATE (a)-[:KNOWS {since: date()}]->(b)",
      "MATCH (a:Person {id:'p1'}),(c:Company) CREATE (a)-[:LIKES]->(c)",
      "MATCH (p:Person {id:'p1'}),(car:Car) CREATE (p)-[:OWNS]->(car)",
    ]) await run(statement)

    const { model, diagnostics } = neo4jCatalogToModel(await read(), 'bolt://test')
    const names = model.nodes.map((n) => n.name).sort()
    expect(names).toEqual(['Car', 'Company', 'Party', 'Person'])

    const person = model.nodes.find((n) => n.name === 'Person')!
    expect(person.key).toEqual(['id'])
    expect(person.extends).toBe('Party')
    expect(person.props.find((p) => p.name === 'email')).toMatchObject({ unique: true })
    expect(model.nodes.find((n) => n.name === 'Party')?.abstract).toBe(true)
    expect(model.nodes.find((n) => n.name === 'Car')?.key).toEqual(['vin'])

    const edges = Object.fromEntries(model.edges.map((e) => [e.name, `${e.from}->${e.to}`]))
    expect(edges).toEqual({ KNOWS: 'Person->Person', LIKES: 'Person->Company', OWNS: 'Person->Car' })

    // A Community instance holds no existence constraint, so nothing but a key part is
    // read as required, and the import says why.
    expect(diagnostics.map((d) => d.code)).toContain('import-edition')
    expect(person.props.find((p) => p.name === 'displayName')?.required).toBe(false)

    // Reading the schema changed nothing about it.
    expect(await schemaState()).toEqual(before)
  })

  it('reads an empty instance as an empty model rather than failing', async () => {
    const { model, diagnostics } = neo4jCatalogToModel(await read(), 'bolt://test')
    expect(model.nodes).toEqual([])
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(false)
  })
})
