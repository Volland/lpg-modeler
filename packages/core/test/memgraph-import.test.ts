import { describe, it, expect } from 'vitest'
import { importModel } from '../src/import/index'
import { memgraphCatalogToModel, readMemgraphSchema, type MemgraphCatalog } from '../src/import/memgraph'
import type { ModelIR } from '../src/ir'

const node = (m: ModelIR, name: string) => m.nodes.find((n) => n.name === name)
const codes = (ds: Array<{ code: string }>) => ds.map((d) => d.code)
const obs = (key: string, ...types: Array<[string, number]>) => ({ key, types: types.map(([type, count]) => ({ type, count })) })

const keyed = (label: string, prop = 'id'): MemgraphCatalog['constraints'] => [
  { kind: 'unique', label, properties: [prop] },
  { kind: 'exists', label, properties: [prop] },
]

// @lat: [[importers#Reading a Memgraph Instance]]
describe('reading a Memgraph catalog', () => {
  it('takes the key from a uniqueness constraint whose properties all exist', () => {
    const { model } = memgraphCatalogToModel({
      constraints: [
        ...keyed('Car', 'vin'),
        { kind: 'unique', label: 'Car', properties: ['plate'] },
        { kind: 'exists', label: 'Car', properties: ['owner'] },
        { kind: 'typed', label: 'Car', properties: ['seats'], dataType: 'INTEGER' },
        { kind: 'typed', label: 'Car', properties: ['at'], dataType: 'LOCALDATETIME' },
      ],
      indexes: [], enums: [],
    }, '/mg')
    const car = node(model, 'Car')!
    expect(car.key).toEqual(['vin'])
    const props = new Map(car.props.map((p) => [p.name, p]))
    expect(props.get('vin')).toMatchObject({ required: true })
    expect(props.get('plate')).toMatchObject({ unique: true, required: false })
    expect(props.get('owner')).toMatchObject({ required: true })
    expect(props.get('seats')?.type).toBe('int')
    expect(props.get('at')?.type).toBe('datetime')
  })

  it('takes the key the generator indexed over another unique, present property', () => {
    const { model, diagnostics } = memgraphCatalogToModel({
      constraints: [...keyed('Person', 'id'), ...keyed('Person', 'email')],
      indexes: [{ label: 'Person', properties: ['id'] }], enums: [],
    }, '/mg')
    expect(node(model, 'Person')?.key).toEqual(['id'])
    expect(node(model, 'Person')?.props.find((p) => p.name === 'email')).toMatchObject({ unique: true, required: true })
    expect(codes(diagnostics)).not.toContain('import-key-chosen')
  })

  it('prefers the smallest key and says which it chose', () => {
    const { model, diagnostics } = memgraphCatalogToModel({
      constraints: [
        { kind: 'unique', label: 'P', properties: ['a', 'b'] },
        ...keyed('P', 'a'), { kind: 'exists', label: 'P', properties: ['b'] },
      ],
      indexes: [], enums: [],
    }, '/mg')
    expect(node(model, 'P')?.key).toEqual(['a'])
    expect(codes(diagnostics)).toContain('import-key-chosen')
  })

  it('reports a label without a key, a composite uniqueness it cannot hold, and lost widths', () => {
    const { diagnostics } = memgraphCatalogToModel({
      constraints: [
        { kind: 'unique', label: 'Loose', properties: ['x', 'y'] },
        ...keyed('Tight'), { kind: 'unique', label: 'Tight', properties: ['a', 'b'] },
        { kind: 'typed', label: 'Tight', properties: ['n'], dataType: 'FLOAT' },
      ],
      indexes: [], enums: [],
    }, '/mg')
    expect(codes(diagnostics)).toEqual(expect.arrayContaining(['import-no-key', 'import-composite-unique', 'import-width']))
    expect(diagnostics.find((d) => d.code === 'import-no-key')?.message).toContain("'Loose'")
  })

  it('reads enums, and names a property\'s enum only from observed values', () => {
    const { model, diagnostics } = memgraphCatalogToModel({
      constraints: [
        ...keyed('B', 'ref'),
        { kind: 'typed', label: 'B', properties: ['status'], dataType: 'ENUM' },
        { kind: 'typed', label: 'B', properties: ['kind'], dataType: 'ENUM' },
      ],
      indexes: [], enums: [{ name: 'Status', values: ['held', 'confirmed'] }],
      structure: { nodes: [{ labels: ['B'], count: 1, properties: [obs('status', ['Enum::Status', 1])] }], edges: [] },
    }, '/mg')
    expect(model.enums).toMatchObject([{ name: 'Status', values: ['held', 'confirmed'] }])
    const props = new Map(node(model, 'B')!.props.map((p) => [p.name, p]))
    expect(props.get('status')).toMatchObject({ type: 'string', enum: 'Status' })
    expect(props.get('kind')?.enum).toBeUndefined()
    expect(diagnostics.filter((d) => d.code === 'import-enum-unknown').map((d) => d.message)).toEqual([expect.stringContaining("'B.kind'")])
  })

  it('reads a hierarchy from labels that always occur together, and an abstract parent', () => {
    const { model, diagnostics } = memgraphCatalogToModel({
      constraints: [...keyed('Person'), ...keyed('Company')],
      indexes: [], enums: [],
      structure: {
        nodes: [
          { labels: ['Party', 'Person'], count: 2, properties: [obs('id', ['String', 2]), obs('email', ['String', 2])] },
          { labels: ['Company', 'Party'], count: 1, properties: [obs('id', ['String', 1])] },
        ],
        edges: [],
      },
    }, '/mg')
    expect(node(model, 'Person')?.extends).toBe('Party')
    expect(node(model, 'Company')?.extends).toBe('Party')
    expect(node(model, 'Party')?.abstract).toBe(true)
    expect(node(model, 'Person')?.abstract).toBe(false)
    expect(node(model, 'Person')?.props.map((p) => p.name).sort()).toEqual(['email', 'id'])
    expect(codes(diagnostics)).toEqual(expect.arrayContaining(['import-hierarchy', 'import-abstract']))
  })

  it('does not read a hierarchy through a label that only ever occurs with one other', () => {
    const { model } = memgraphCatalogToModel({
      constraints: [...keyed('A')],
      indexes: [], enums: [],
      structure: { nodes: [{ labels: ['A', 'B'], count: 3, properties: [] }], edges: [] },
    }, '/mg')
    // Every A is a B and every B is an A: nothing says which is the parent.
    expect(node(model, 'A')?.extends).toBeUndefined()
    expect(node(model, 'B')?.extends).toBeUndefined()
  })

  it('keeps a concrete parent concrete when some nodes carry only its label', () => {
    const { model } = memgraphCatalogToModel({
      constraints: [...keyed('Vehicle', 'vin')],
      indexes: [], enums: [],
      structure: {
        nodes: [{ labels: ['Vehicle'], count: 1, properties: [] }, { labels: ['Truck', 'Vehicle'], count: 1, properties: [] }],
        edges: [],
      },
    }, '/mg')
    expect(node(model, 'Truck')?.extends).toBe('Vehicle')
    expect(node(model, 'Vehicle')?.abstract).toBe(false)
  })

  it('reads edges, collapsing endpoints to their nearest common type, and reports ambiguous values', () => {
    const { model, diagnostics } = memgraphCatalogToModel({
      constraints: [...keyed('Person'), ...keyed('Company'), ...keyed('Car', 'vin')],
      indexes: [], enums: [],
      structure: {
        nodes: [
          { labels: ['Party', 'Person'], count: 1, properties: [] },
          { labels: ['Company', 'Party'], count: 1, properties: [] },
          { labels: ['Car'], count: 1, properties: [obs('seats', ['Integer', 3], ['String', 1])] },
        ],
        edges: [
          { type: 'OWNS', from: ['Party', 'Person'], to: ['Car'], properties: [obs('since', ['Date', 1])] },
          { type: 'OWNS', from: ['Company', 'Party'], to: ['Car'], properties: [] },
        ],
      },
    }, '/mg')
    expect(model.edges).toMatchObject([{ name: 'OWNS', from: 'Party', to: 'Car', props: [{ name: 'since', type: 'date' }] }])
    expect(node(model, 'Car')?.props.find((p) => p.name === 'seats')?.type).toBe('int')
    expect(codes(diagnostics)).toEqual(expect.arrayContaining(['import-collapsed', 'import-ambiguous-type']))
  })

  it('reads through a session, and narrows the import when schema information is off', async () => {
    const session = {
      run: async (q: string) => {
        if (q === 'SHOW CONSTRAINT INFO') return [{ 'constraint type': 'unique', label: 'P', properties: ['id'], data_type: '' }, { 'constraint type': 'data_type', label: 'P', properties: 'on', data_type: 'BOOL' }]
        if (q === 'SHOW ENUMS' || q === 'SHOW INDEX INFO') return []
        throw new Error('SchemaInfo query is disabled. To enable it, start Memgraph with the --schema-info-enabled flag.')
      },
    }
    const { catalog, diagnostics } = await readMemgraphSchema(session)
    expect(catalog.constraints[1]).toEqual({ kind: 'typed', label: 'P', properties: ['on'], dataType: 'BOOLEAN' })
    expect(catalog.structure).toBeUndefined()
    expect(diagnostics).toMatchObject([{ severity: 'info', code: 'import-schema-info-disabled' }])
  })

  it('reports a query the engine refuses as an error rather than an empty schema', async () => {
    const { diagnostics } = await readMemgraphSchema({ run: async () => { throw new Error('connection reset') } })
    expect(diagnostics.filter((d) => d.severity === 'error').length).toBeGreaterThan(0)
  })

  it('imports a catalog through importModel, on its own', () => {
    const catalog: MemgraphCatalog = { constraints: keyed('P'), indexes: [], enums: [] }
    const alone = importModel([{ path: 'bolt://x', memgraphCatalog: catalog }])
    expect(alone.model.nodes.map((n) => n.name)).toEqual(['P'])
    const mixed = importModel([{ path: 'bolt://x', memgraphCatalog: catalog }, { path: '/a.cypher', text: 'CREATE NODE TABLE T(a STRING, PRIMARY KEY(a));' }])
    expect(codes(mixed.diagnostics)).toContain('import-mixed-sources')
  })
})
