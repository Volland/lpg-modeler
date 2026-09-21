import { describe, it, expect } from 'vitest'
import { importModel } from '../src/import/index'
import {
  identifyBoltEngine, neo4jCatalogToModel, readNeo4jSchema, type Neo4jCatalog,
} from '../src/import/neo4j'
import type { ModelIR } from '../src/ir'

const node = (m: ModelIR, name: string) => m.nodes.find((n) => n.name === name)
const edge = (m: ModelIR, name: string) => m.edges.find((e) => e.name === name)
const codes = (ds: Array<{ code: string }>) => ds.map((d) => d.code)

const empty: Neo4jCatalog = { constraints: [], indexes: [], nodes: [], relationships: [], endpoints: [] }
const unique = (label: string, properties: string[], name = `${label.toLowerCase()}_unique`): Neo4jCatalog['constraints'][number] =>
  ({ kind: 'unique', entity: 'node', label, properties, name })

// @lat: [[importers#Reading a Neo4j Instance]]
describe('reading a Neo4j catalog', () => {
  it('takes a declared node key over anything else', () => {
    const { model } = neo4jCatalogToModel({
      ...empty,
      constraints: [
        { kind: 'key', entity: 'node', label: 'Person', properties: ['id'], name: 'person_key' },
        unique('Person', ['email'], 'person_email_unique'),
        { kind: 'exists', entity: 'node', label: 'Person', properties: ['name'], name: 'person_name_exists' },
      ],
    }, '/n4j')
    const person = node(model, 'Person')!
    expect(person.key).toEqual(['id'])
    const props = new Map(person.props.map((p) => [p.name, p]))
    expect(props.get('id')).toMatchObject({ required: true })
    expect(props.get('email')).toMatchObject({ unique: true })
    expect(props.get('name')).toMatchObject({ required: true })
  })

  it('recovers the key from a uniqueness constraint where Community cannot declare one', () => {
    const { model, diagnostics } = neo4jCatalogToModel({
      ...empty, edition: 'community',
      constraints: [unique('Car', ['vin'], 'car_key_unique')],
    }, '/n4j')
    expect(node(model, 'Car')?.key).toEqual(['vin'])
    expect(codes(diagnostics)).toContain('import-key-recovered')
    expect(codes(diagnostics)).toContain('import-edition')
  })

  it('prefers a uniqueness constraint whose properties are all required', () => {
    const { model } = neo4jCatalogToModel({
      ...empty,
      constraints: [
        unique('P', ['email'], 'p_email_unique'),
        unique('P', ['id'], 'zzz_not_the_generated_name'),
        { kind: 'exists', entity: 'node', label: 'P', properties: ['id'], name: 'p_id_exists' },
      ],
    }, '/n4j')
    expect(node(model, 'P')?.key).toEqual(['id'])
    expect(node(model, 'P')?.props.find((p) => p.name === 'email')).toMatchObject({ unique: true })
  })

  it("takes the generator's own name for the key before falling back to the smallest", () => {
    const { model, diagnostics } = neo4jCatalogToModel({
      ...empty,
      constraints: [unique('Person', ['email'], 'person_email_unique'), unique('Person', ['id'], 'person_key_unique')],
    }, '/n4j')
    expect(node(model, 'Person')?.key).toEqual(['id'])
    expect(diagnostics.find((d) => d.code === 'import-key-recovered')?.message).toContain('2 uniqueness constraints')
  })

  it('reports a composite uniqueness that is not the key, and a label with no key at all', () => {
    const { model, diagnostics } = neo4jCatalogToModel({
      ...empty,
      constraints: [unique('P', ['id'], 'p_key_unique'), unique('P', ['a', 'b'], 'p_ab_unique')],
      nodes: [{ labels: ['Q'], properties: [{ key: 'x', types: ['String'] }] }],
    }, '/n4j')
    expect(node(model, 'P')?.key).toEqual(['id'])
    expect(codes(diagnostics)).toContain('import-composite-unique')
    expect(codes(diagnostics)).toContain('import-no-key')
  })

  it('reads properties and their observed types from the schema procedures', () => {
    const { model, diagnostics } = neo4jCatalogToModel({
      ...empty,
      constraints: [unique('T', ['id'], 't_key_unique')],
      nodes: [{
        labels: ['T'],
        properties: [
          { key: 'id', types: ['String'] },
          { key: 'n', types: ['Long'] },
          { key: 'when', types: ['DateTime'] },
          { key: 'local', types: ['LocalDateTime'] },
          { key: 'tags', types: ['StringArray'] },
          { key: 'mixed', types: ['Long', 'String'] },
          { key: 'weird', types: ['Point'] },
        ],
      }],
    }, '/n4j')
    const props = new Map(node(model, 'T')!.props.map((p) => [p.name, p]))
    expect(props.get('n')?.type).toBe('int')
    expect(props.get('when')?.type).toBe('zoneddatetime')
    expect(props.get('local')?.type).toBe('datetime')
    expect(props.get('tags')).toMatchObject({ type: 'string', list: true })
    expect(props.get('mixed')?.type).toBe('int')
    expect(props.get('weird')?.type).toBe('string')
    expect(codes(diagnostics)).toContain('import-ambiguous-type')
    expect(codes(diagnostics)).toContain('import-type')
  })

  it('reads a hierarchy from label sets and does not redeclare an inherited property', () => {
    const { model, diagnostics } = neo4jCatalogToModel({
      ...empty,
      constraints: [unique('Party', ['id'], 'party_key_unique')],
      nodes: [
        { labels: ['Person', 'Party'], properties: [{ key: 'id', types: ['String'] }, { key: 'email', types: ['String'] }] },
        { labels: ['Company', 'Party'], properties: [{ key: 'id', types: ['String'] }, { key: 'vat', types: ['String'] }] },
        { labels: ['Party'], properties: [{ key: 'id', types: ['String'] }] },
      ],
    }, '/n4j')
    expect(node(model, 'Person')?.extends).toBe('Party')
    expect(node(model, 'Company')?.extends).toBe('Party')
    expect(node(model, 'Person')?.props.map((p) => p.name)).toEqual(['email'])
    expect(codes(diagnostics)).toContain('import-hierarchy')
  })

  it('narrows an endpoint to the most specific label before collapsing it', () => {
    // `db.schema.visualization()` names one pair per label, so a :Person:Party node at
    // one end of one relationship is reported as both Person and Party.
    const { model, diagnostics } = neo4jCatalogToModel({
      ...empty,
      constraints: [unique('Party', ['id'], 'party_key_unique'), unique('Car', ['vin'], 'car_key_unique')],
      nodes: [
        { labels: ['Person', 'Party'], properties: [{ key: 'id', types: ['String'] }] },
        { labels: ['Party'], properties: [{ key: 'id', types: ['String'] }] },
        { labels: ['Car'], properties: [{ key: 'vin', types: ['String'] }] },
      ],
      relationships: [{ type: 'OWNS', properties: [{ key: 'since', types: ['Date'] }] }],
      endpoints: [
        { type: 'OWNS', from: 'Person', to: 'Car' },
        { type: 'OWNS', from: 'Party', to: 'Car' },
      ],
    }, '/n4j')
    expect(edge(model, 'OWNS')).toMatchObject({ from: 'Person', to: 'Car' })
    expect(edge(model, 'OWNS')?.props.find((p) => p.name === 'since')?.type).toBe('date')
    expect(codes(diagnostics)).not.toContain('import-collapsed')
  })

  it('collapses an edge seen between genuinely different types to their common ancestor', () => {
    const { model, diagnostics } = neo4jCatalogToModel({
      ...empty,
      constraints: [unique('Party', ['id'], 'party_key_unique'), unique('Car', ['vin'], 'car_key_unique')],
      nodes: [
        { labels: ['Person', 'Party'], properties: [{ key: 'id', types: ['String'] }] },
        { labels: ['Company', 'Party'], properties: [{ key: 'id', types: ['String'] }] },
        { labels: ['Party'], properties: [{ key: 'id', types: ['String'] }] },
        { labels: ['Car'], properties: [{ key: 'vin', types: ['String'] }] },
      ],
      endpoints: [
        { type: 'OWNS', from: 'Person', to: 'Car' },
        { type: 'OWNS', from: 'Company', to: 'Car' },
      ],
    }, '/n4j')
    expect(edge(model, 'OWNS')).toMatchObject({ from: 'Party', to: 'Car' })
    expect(codes(diagnostics)).toContain('import-collapsed')
  })

  it('reports an edge type whose endpoints were never observed', () => {
    const { model, diagnostics } = neo4jCatalogToModel({
      ...empty,
      constraints: [unique('P', ['id'], 'p_key_unique')],
      relationships: [{ type: 'RATED', properties: [{ key: 'stars', types: ['Long'] }] }],
    }, '/n4j')
    expect(model.edges).toHaveLength(0)
    expect(codes(diagnostics)).toContain('import-endpoints')
  })

  it('reads a relationship constraint onto the edge it belongs to', () => {
    const { model } = neo4jCatalogToModel({
      ...empty,
      constraints: [
        unique('P', ['id'], 'p_key_unique'),
        { kind: 'exists', entity: 'relationship', label: 'RATED', properties: ['stars'], name: 'rated_stars_exists' },
        { kind: 'unique', entity: 'relationship', label: 'RATED', properties: ['ref'], name: 'rated_ref_unique' },
      ],
      endpoints: [{ type: 'RATED', from: 'P', to: 'P' }],
    }, '/n4j')
    const props = new Map(edge(model, 'RATED')!.props.map((p) => [p.name, p]))
    expect(props.get('stars')).toMatchObject({ required: true })
    expect(props.get('ref')).toMatchObject({ unique: true })
  })

  it('always says what a Neo4j schema cannot carry', () => {
    const { diagnostics } = neo4jCatalogToModel(empty, '/n4j')
    expect(diagnostics.find((d) => d.code === 'import-lossy')?.message).toMatch(/cardinality/)
  })
})

// @lat: [[importers#Reading a Neo4j Instance]]
describe('reading a Neo4j schema over a session', () => {
  const rows = (answers: Record<string, Array<Record<string, unknown>>>) => ({
    run: async (q: string) => {
      const key = Object.keys(answers).find((k) => q.startsWith(k))
      if (key) return answers[key]!
      throw new Error(`Unsupported query: ${q}`)
    },
  })

  it('skips a token lookup index and an index a constraint owns', async () => {
    const { catalog } = await readNeo4jSchema(rows({
      'SHOW CONSTRAINTS': [],
      'SHOW INDEXES': [
        { name: 'index_1', type: 'LOOKUP', entityType: 'NODE', labelsOrTypes: null, properties: null, owningConstraint: null },
        { name: 'person_key_unique', type: 'RANGE', entityType: 'NODE', labelsOrTypes: ['Person'], properties: ['id'], owningConstraint: 'person_key_unique' },
        { name: 'person_created_at', type: 'RANGE', entityType: 'NODE', labelsOrTypes: ['Person'], properties: ['createdAt'], owningConstraint: null },
      ],
      'CALL db.schema.nodeTypeProperties': [],
      'CALL db.schema.relTypeProperties': [],
      'CALL db.schema.visualization': [],
      'CALL dbms.components': [],
    }))
    expect(catalog.indexes).toEqual([{ entity: 'node', label: 'Person', properties: ['createdAt'] }])
  })

  it('reads a label set from the back-quoted node type when the labels column is empty', async () => {
    const { catalog } = await readNeo4jSchema(rows({
      'SHOW CONSTRAINTS': [],
      'SHOW INDEXES': [],
      'CALL db.schema.nodeTypeProperties': [
        { nodeType: ':`Party`:`Person`', nodeLabels: [], propertyName: 'id', propertyTypes: ['String'] },
      ],
      'CALL db.schema.relTypeProperties': [],
      'CALL db.schema.visualization': [],
      'CALL dbms.components': [],
    }))
    expect(catalog.nodes).toEqual([{ labels: ['Party', 'Person'], properties: [{ key: 'id', types: ['String'] }] }])
  })

  it('carries on without a schema procedure, and says what is missing', async () => {
    const { catalog, diagnostics } = await readNeo4jSchema({
      run: async (q: string) => {
        if (q.startsWith('SHOW CONSTRAINTS')) {
          return [{ name: 'person_key_unique', type: 'UNIQUENESS', entityType: 'NODE', labelsOrTypes: ['Person'], properties: ['id'] }]
        }
        if (q.startsWith('SHOW INDEXES')) return []
        throw new Error('There is no procedure with the name')
      },
    })
    expect(catalog.constraints).toHaveLength(1)
    expect(codes(diagnostics)).toContain('import-procedure-absent')
    expect(diagnostics.every((d) => d.severity !== 'error')).toBe(true)
  })

  it('reports a schema query the engine refuses as an error', async () => {
    const { diagnostics } = await readNeo4jSchema({
      run: async () => { throw new Error('Permission denied') },
    })
    expect(diagnostics.some((d) => d.severity === 'error' && d.code === 'import-catalog')).toBe(true)
  })

  it('reports a constraint kind it does not know rather than dropping it silently', async () => {
    const { catalog, diagnostics } = await readNeo4jSchema(rows({
      'SHOW CONSTRAINTS': [{ name: 'x', type: 'SOMETHING_NEW', entityType: 'NODE', labelsOrTypes: ['P'], properties: ['a'] }],
      'SHOW INDEXES': [],
      'CALL db.schema.nodeTypeProperties': [],
      'CALL db.schema.relTypeProperties': [],
      'CALL db.schema.visualization': [],
      'CALL dbms.components': [],
    }))
    expect(catalog.constraints).toHaveLength(0)
    expect(codes(diagnostics)).toContain('import-constraint-kind')
  })

  it('reads the edition and the endpoints a visualization reports', async () => {
    const { catalog } = await readNeo4jSchema(rows({
      'SHOW CONSTRAINTS': [],
      'SHOW INDEXES': [],
      'CALL db.schema.nodeTypeProperties': [],
      'CALL db.schema.relTypeProperties': [
        { relType: ':`PLACED`', propertyName: 'at', propertyTypes: ['DateTime'] },
      ],
      'CALL db.schema.visualization': [{
        nodes: [
          { elementId: '-1', labels: ['Person'] },
          { elementId: '-2', labels: ['Order'] },
        ],
        relationships: [{ type: 'PLACED', startNodeElementId: '-1', endNodeElementId: '-2' }],
      }],
      'CALL dbms.components': [{ name: 'Neo4j Kernel', versions: ['5.26.30'], edition: 'community' }],
    }))
    expect(catalog.edition).toBe('community')
    expect(catalog.version).toBe('5.26.30')
    expect(catalog.endpoints).toEqual([{ type: 'PLACED', from: 'Person', to: 'Order' }])
    expect(catalog.relationships).toEqual([{ type: 'PLACED', properties: [{ key: 'at', types: ['DateTime'] }] }])
  })
})

// @lat: [[importers#Telling Two Bolt Engines Apart]]
describe('telling two Bolt engines apart', () => {
  it('reads a Memgraph as Memgraph although it reports a Neo4j kernel too', () => {
    // Measured: Memgraph 3.13.1 answers dbms.components() with both rows.
    expect(identifyBoltEngine(['Memgraph', 'Neo4j Kernel'])).toBe('memgraph')
  })

  it('reads a Neo4j as Neo4j only when no Memgraph row accompanies the kernel', () => {
    expect(identifyBoltEngine(['Neo4j Kernel'])).toBe('neo4j')
  })

  it('names no engine at all rather than guessing at one', () => {
    expect(identifyBoltEngine([])).toBeUndefined()
    expect(identifyBoltEngine(['Something Else'])).toBeUndefined()
  })
})

// @lat: [[importers#Reading a Neo4j Instance]]
describe('a live Neo4j as an import source', () => {
  it('is imported on its own, not merged with files', () => {
    const { diagnostics } = importModel([
      { path: 'bolt://x', neo4jCatalog: { ...empty, constraints: [unique('P', ['id'], 'p_key_unique')] } },
      { path: '/schema.ttl', text: '@prefix sh: <http://www.w3.org/ns/shacl#> .' },
    ])
    expect(codes(diagnostics)).toContain('import-mixed-sources')
  })

  it('is routed by its catalog rather than by a named format', () => {
    const { model } = importModel([
      { path: 'bolt://x', neo4jCatalog: { ...empty, constraints: [unique('P', ['id'], 'p_key_unique')] } },
    ])
    expect(node(model, 'P')?.key).toEqual(['id'])
  })
})
