import { describe, expect, it } from 'vitest'
import * as lbug from '@ladybugdb/core'
import {
  driftFalkor, driftLadybug, driftMemgraph, driftNeo4j,
} from '../src/drift'
import { emit } from '../src/emit/index'
import { parseLadybugDdl, readLadybugCatalog } from '../src/import/ladybug'
import type { Neo4jCatalog } from '../src/import/neo4j'
import type { MemgraphCatalog } from '../src/import/memgraph'
import type { FalkorCatalog } from '../src/import/falkordb'
import { resolveModel } from '../src/resolve'
import { loadFixture } from './helpers'

const social = () => loadFixture('social.lpg.yaml')

const inline = (body: string) =>
  resolveModel('/m.lpg.yaml', () =>
    `namespace: { prefix: p, iri: "https://e.org/p#" }\n${body}`).model

const kinds = (r: { findings: Array<{ kind: string }> }) => r.findings.map((f) => f.kind)

// @lat: [[drift#Drift]]
describe('drift against LadybugDB', () => {
  it('a schema generated from the model is clean, as a script and as a database', async () => {
    const ddl = emit(social(), 'ladybug').content
    expect(driftLadybug(social(), parseLadybugDdl(ddl), 'ddl').findings).toEqual([])

    const db = new lbug.Database(':memory:', 256 * 1024 * 1024, true, false, 1024 * 1024 * 1024)
    const conn = new lbug.Connection(db)
    await conn.query(ddl)
    const { catalog } = await readLadybugCatalog(conn as never)
    expect(driftLadybug(social(), catalog, 'database').findings).toEqual([])
  })

  it('a property the database has never seen is missing; one the model dropped is unexpected', () => {
    const ddl = emit(social(), 'ladybug').content
    const catalog = parseLadybugDdl(ddl)
    const grown = social()
    grown.nodes.find((n) => n.name === 'Car')!.props.push({
      id: 'p_new', name: 'color', type: 'string', list: false, required: false, unique: false,
    })
    const report = driftLadybug(grown, catalog, 'ddl')
    expect(report.findings).toEqual([{
      kind: 'missing', object: 'column Car.color',
      detail: 'the model declares it as STRING; the database has no such column',
    }])

    const shrunk = social()
    const car = shrunk.nodes.find((n) => n.name === 'Car')!
    car.props = car.props.filter((p) => p.name !== 'seats')
    expect(driftLadybug(shrunk, catalog, 'ddl').findings).toEqual([{
      kind: 'unexpected', object: 'column Car.seats',
      detail: 'the database holds it as INT64; the model does not declare it',
    }])
  })

  it('a retyped column, a changed key and a changed endpoint set are different or paired', () => {
    const ddl = emit(social(), 'ladybug').content
    const catalog = parseLadybugDdl(ddl)
    const model = social()
    const car = model.nodes.find((n) => n.name === 'Car')!
    car.props.find((p) => p.name === 'seats')!.type = 'int16'
    const report = driftLadybug(model, catalog, 'ddl')
    expect(report.findings).toEqual([{
      kind: 'different', object: 'column Car.seats',
      detail: 'the model says INT16; the database says INT64',
    }])

    // Making Company abstract removes it from every OWNS endpoint pair.
    const abstracted = social()
    abstracted.nodes.find((n) => n.name === 'Company')!.abstract = true
    const pairs = driftLadybug(abstracted, catalog, 'ddl')
    expect(pairs.findings.some((f) => f.kind === 'unexpected' && f.object.includes('Company→Car'))).toBe(true)
    expect(pairs.findings.some((f) => f.kind === 'unexpected' && f.object === 'node table Company')).toBe(true)
  })

  it('multiplicity is compared against a script and left alone for a database', () => {
    const model = inline(
      'nodes:\n  A:\n    key: [x]\n    props:\n      x: { type: string, required: true }\n'
      + 'edges:\n  E: { from: A, to: A, cardinality: many-to-one }\n')
    const ddl = emit(model, 'ladybug').content
    const loosened = parseLadybugDdl(ddl)
    const rel = loosened.tables.find((t) => t.kind === 'rel')!
    if (rel.kind === 'rel') delete rel.multiplicity
    expect(kinds(driftLadybug(model, loosened, 'ddl'))).toContain('different')
    expect(driftLadybug(model, loosened, 'database').findings).toEqual([])
  })
})

// @lat: [[drift#Drift#Structural identity]]
describe('drift against the constraint engines', () => {
  it('a Neo4j Community schema with this tool’s objects under foreign names is clean', () => {
    const catalog: Neo4jCatalog = {
      edition: 'community',
      constraints: [
        { kind: 'unique', entity: 'node', label: 'Person', properties: ['id'], name: 'ops_1' },
        { kind: 'unique', entity: 'node', label: 'Company', properties: ['id'], name: 'ops_2' },
        { kind: 'unique', entity: 'node', label: 'Car', properties: ['vin'], name: 'ops_3' },
        { kind: 'unique', entity: 'node', label: 'Person', properties: ['email'], name: 'ops_4' },
      ],
      indexes: [{ entity: 'node', label: 'Person', properties: ['createdAt'] }],
      nodes: [], relationships: [], endpoints: [],
    }
    expect(driftNeo4j(social(), catalog).findings).toEqual([])

    const missing = { ...catalog, constraints: catalog.constraints.slice(0, 3) }
    const report = driftNeo4j(social(), missing)
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]).toMatchObject({ kind: 'missing' })
    expect(report.findings[0]!.object).toContain('Person(email)')

    const extra = {
      ...catalog,
      indexes: [...catalog.indexes, { entity: 'node' as const, label: 'Car', properties: ['seats'] }],
    }
    expect(kinds(driftNeo4j(social(), extra))).toContain('unexpected')
  })

  it('the instance’s edition decides what the model expects of it', () => {
    const empty: Neo4jCatalog = {
      edition: 'enterprise', constraints: [], indexes: [],
      nodes: [], relationships: [], endpoints: [],
    }
    const model = inline(
      'nodes:\n  A:\n    key: [x]\n    props:\n      x: { type: string, required: true }\n      y: { type: string, required: true }\n')
    const report = driftNeo4j(model, empty)
    // Enterprise expects a NODE KEY and an existence constraint, both missing here.
    expect(report.findings.some((f) => f.object.startsWith('key '))).toBe(true)
    expect(report.findings.some((f) => f.object.startsWith('exists '))).toBe(true)
  })

  it('a Memgraph schema is compared constraint by constraint, enum by enum', () => {
    const model = inline(
      'enums:\n  S: { values: [a, b] }\n'
      + 'nodes:\n  A:\n    key: [x]\n    props:\n      x: { type: string, required: true }\n')
    const catalog: MemgraphCatalog = {
      constraints: [
        { kind: 'unique', label: 'A', properties: ['x'] },
        { kind: 'exists', label: 'A', properties: ['x'] },
        { kind: 'typed', label: 'A', properties: ['x'], dataType: 'STRING' },
      ],
      indexes: [{ label: 'A', properties: ['x'] }],
      enums: [{ name: 'S', values: ['a', 'b'] }],
    }
    expect(driftMemgraph(model, catalog).findings).toEqual([])

    const drifted = {
      ...catalog,
      constraints: catalog.constraints.filter((c) => c.kind !== 'typed'),
      enums: [{ name: 'S', values: ['a'] }],
    }
    const report = driftMemgraph(model, drifted)
    expect(kinds(report)).toContain('missing')
    expect(report.findings.some((f) => f.kind === 'different' && f.object === 'enum S')).toBe(true)
  })

  it('a FalkorDB constraint that is not operational does not count as present', () => {
    const model = inline(
      'nodes:\n  A:\n    key: [x]\n    props:\n      x: { type: string, required: true }\n      y: { type: string, required: true }\n')
    const catalog: FalkorCatalog = {
      graphKey: 'p',
      constraints: [
        { kind: 'unique', entity: 'node', label: 'A', properties: ['x'], status: 'OPERATIONAL' },
        { kind: 'mandatory', entity: 'node', label: 'A', properties: ['x'], status: 'OPERATIONAL' },
        { kind: 'mandatory', entity: 'node', label: 'A', properties: ['y'], status: 'FAILED' },
      ],
      indexes: [{ entity: 'node', label: 'A', properties: ['x'] }],
      nodes: [], edges: [], edgeProperties: [],
    }
    const report = driftFalkor(model, catalog)
    expect(report.findings.some((f) => f.kind === 'missing' && f.object.includes('A(y)'))).toBe(true)
    expect(report.diagnostics.map((d) => d.code)).toContain('drift-constraint-failed')
  })
})
