import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importModel } from '../src/import/index'
import {
  falkorCatalogToModel, parseList, readFalkorSchema, SAMPLE_LIMIT, type FalkorCatalog,
} from '../src/import/falkordb'
import { readFalkorScript } from '../src/emit/falkordb.script'
import type { ModelIR } from '../src/ir'

const node = (m: ModelIR, name: string) => m.nodes.find((n) => n.name === name)
const edge = (m: ModelIR, name: string) => m.edges.find((e) => e.name === name)
const codes = (ds: Array<{ code: string }>) => ds.map((d) => d.code)

const empty: FalkorCatalog = {
  graphKey: 'g', constraints: [], indexes: [], nodes: [], edges: [], edgeProperties: [],
}
const keyed = (label: string, prop = 'id'): FalkorCatalog['constraints'] => [
  { kind: 'unique', entity: 'node', label, properties: [prop], status: 'OPERATIONAL' },
  { kind: 'mandatory', entity: 'node', label, properties: [prop], status: 'OPERATIONAL' },
]

// @lat: [[importers#Reading a FalkorDB Instance]]
describe('reading a FalkorDB catalog', () => {
  it('takes the key from a unique constraint whose properties are all mandatory', () => {
    const { model } = falkorCatalogToModel({
      ...empty,
      constraints: [
        ...keyed('Car', 'vin'),
        { kind: 'unique', entity: 'node', label: 'Car', properties: ['plate'], status: 'OPERATIONAL' },
        { kind: 'mandatory', entity: 'node', label: 'Car', properties: ['owner'], status: 'OPERATIONAL' },
      ],
    }, '/fk')
    const car = node(model, 'Car')!
    expect(car.key).toEqual(['vin'])
    const props = new Map(car.props.map((p) => [p.name, p]))
    expect(props.get('plate')).toMatchObject({ unique: true })
    expect(props.get('owner')).toMatchObject({ required: true })
  })

  it('takes the earliest-indexed candidate as the key, because the generator indexes it first', () => {
    const { model, diagnostics } = falkorCatalogToModel({
      ...empty,
      constraints: [...keyed('Person', 'id'), ...keyed('Person', 'email')],
      // FalkorDB keeps a label's indexed properties in the order they were indexed.
      indexes: [{ entity: 'node', label: 'Person', properties: ['id', 'email'] }],
    }, '/fk')
    expect(node(model, 'Person')?.key).toEqual(['id'])
    expect(node(model, 'Person')?.props.find((p) => p.name === 'email')).toMatchObject({ unique: true })
    expect(codes(diagnostics)).toContain('import-key-chosen')
  })

  it('does not read a FAILED or PENDING constraint as part of the schema', () => {
    const { model, diagnostics } = falkorCatalogToModel({
      ...empty,
      constraints: [
        { kind: 'unique', entity: 'node', label: 'P', properties: ['id'], status: 'FAILED' },
        { kind: 'mandatory', entity: 'node', label: 'P', properties: ['id'], status: 'OPERATIONAL' },
        { kind: 'unique', entity: 'node', label: 'P', properties: ['code'], status: 'PENDING' },
      ],
    }, '/fk')
    const p = node(model, 'P')!
    expect(p.key).toEqual([])
    // Nothing it declared reaches the model at all, not even the property.
    expect(p.props.find((x) => x.name === 'code')).toBeUndefined()
    expect(codes(diagnostics)).toContain('import-constraint-failed')
    expect(codes(diagnostics)).toContain('import-no-key')
    expect(diagnostics.find((d) => d.code === 'import-constraint-failed')?.message).toContain('FAILED')
  })

  it('reads a hierarchy and endpoints from the sample, narrowing to the most specific label', () => {
    const { model } = falkorCatalogToModel({
      ...empty,
      constraints: [...keyed('Party'), ...keyed('Car', 'vin')],
      nodes: [
        { labels: ['Person', 'Party'], properties: [{ key: 'id', type: 'String' }] },
        { labels: ['Company', 'Party'], properties: [{ key: 'id', type: 'String' }] },
        { labels: ['Car'], properties: [{ key: 'vin', type: 'String' }] },
      ],
      edges: [
        { type: 'OWNS', from: ['Person', 'Party'], to: ['Car'] },
      ],
      edgeProperties: [{ type: 'OWNS', key: 'since', valueType: 'Integer' }],
    }, '/fk')
    expect(node(model, 'Person')?.extends).toBe('Party')
    expect(node(model, 'Party')?.abstract).toBe(true)
    expect(edge(model, 'OWNS')).toMatchObject({ from: 'Person', to: 'Car' })
    expect(edge(model, 'OWNS')?.props.find((p) => p.name === 'since')?.type).toBe('int')
  })

  it('maps observed value types, and says a list has no element type', () => {
    const { model, diagnostics } = falkorCatalogToModel({
      ...empty,
      constraints: keyed('T'),
      nodes: [{
        labels: ['T'],
        properties: [
          { key: 'id', type: 'String' },
          { key: 'n', type: 'Integer' },
          { key: 'f', type: 'Double' },
          { key: 'ok', type: 'Boolean' },
          { key: 'tags', type: 'List' },
          { key: 'odd', type: 'Vectorf32' },
        ],
      }],
    }, '/fk')
    const props = new Map(node(model, 'T')!.props.map((p) => [p.name, p]))
    expect(props.get('n')?.type).toBe('int')
    expect(props.get('f')?.type).toBe('float')
    expect(props.get('ok')?.type).toBe('boolean')
    expect(props.get('tags')).toMatchObject({ type: 'string', list: true })
    expect(codes(diagnostics)).toContain('import-type')
    expect(codes(diagnostics)).toContain('import-type-partial')
  })

  it('reports a sample that was cut short, naming what it could not reach', () => {
    const { diagnostics } = falkorCatalogToModel({
      ...empty, constraints: keyed('P'), truncated: { nodes: 5000, edges: 9000 },
    }, '/fk')
    const message = diagnostics.find((d) => d.code === 'import-sampled')?.message
    expect(message).toContain(String(SAMPLE_LIMIT))
    expect(message).toContain('5000 nodes')
    expect(message).toContain('9000 relationships')
  })

  it('always says what a FalkorDB schema cannot carry', () => {
    const { diagnostics } = falkorCatalogToModel(empty, '/fk')
    expect(diagnostics.find((d) => d.code === 'import-lossy')?.message).toMatch(/enums/)
  })

  it('is imported on its own, not merged with files', () => {
    const { diagnostics } = importModel([
      { path: 'redis://x', falkorCatalog: { ...empty, constraints: keyed('P') } },
      { path: '/schema.ttl', text: '@prefix sh: <http://www.w3.org/ns/shacl#> .' },
    ])
    expect(codes(diagnostics)).toContain('import-mixed-sources')
  })
})

// @lat: [[importers#Reading a FalkorDB Instance]]
describe('reading a FalkorDB schema over a client', () => {
  /** A stub client: GRAPH.LIST plus a reply per query, in FalkorDB's own shape. */
  const client = (graphs: string[], replies: Record<string, [string[], unknown[][]]> = {}) => {
    const sent: string[][] = []
    return {
      sent,
      sendCommand: async (args: string[]) => {
        sent.push(args)
        if (args[0] === 'GRAPH.LIST') return graphs
        const cypher = args[2] ?? ''
        const key = Object.keys(replies).find((k) => cypher.includes(k))
        const [header, rows] = key ? replies[key]! : [[], []]
        return [header, rows, ['Cached execution: 0']]
      },
    }
  }

  it('refuses a graph key the server does not hold, without creating it', async () => {
    const c = client(['real'])
    const { catalog, diagnostics } = await readFalkorSchema(c, 'typo')
    expect(catalog).toBeUndefined()
    expect(codes(diagnostics)).toContain('import-no-graph')
    expect(diagnostics[0]?.message).toContain('real')
    // Nothing but the listing was sent: no query created the missing key.
    expect(c.sent).toEqual([['GRAPH.LIST']])
  })

  it('reads the only graph when none is named, and says which it read', async () => {
    const { catalog, diagnostics } = await readFalkorSchema(client(['only']))
    expect(catalog?.graphKey).toBe('only')
    expect(codes(diagnostics)).toContain('import-graph-key')
  })

  it('refuses to choose between several graphs', async () => {
    const { catalog, diagnostics } = await readFalkorSchema(client(['a', 'b']))
    expect(catalog).toBeUndefined()
    expect(diagnostics.find((d) => d.code === 'import-no-graph')?.message).toContain('a, b')
  })

  it('reads every schema query as GRAPH.RO_QUERY, which cannot write', async () => {
    const c = client(['g'])
    await readFalkorSchema(c, 'g')
    const queries = c.sent.filter((a) => a[0] !== 'GRAPH.LIST')
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.every((a) => a[0] === 'GRAPH.RO_QUERY')).toBe(true)
  })

  it('parses the catalogue rows FalkorDB returns', async () => {
    const { catalog } = await readFalkorSchema(client(['g'], {
      'db.constraints': [
        ['type', 'label', 'properties', 'entitytype', 'status'],
        [['UNIQUE', 'Person', '[id]', 'NODE', 'OPERATIONAL'],
          ['MANDATORY', 'RATED', '[stars]', 'RELATIONSHIP', 'OPERATIONAL']],
      ],
      'db.indexes': [
        ['label', 'properties', 'types', 'entitytype', 'status'],
        [['Person', '[id, email]', '{id: [RANGE]}', 'NODE', 'OPERATIONAL']],
      ],
      'count(n)': [['nodes'], [[3]]],
      'labels(n) AS labels, k': [
        ['labels', 'k', 't'],
        [['[Person, Party]', 'id', 'String'], ['[Person, Party]', 'email', 'String']],
      ],
      'RETURN DISTINCT labels(n) AS labels': [['labels'], [['[Person, Party]']]],
      'type(r) AS t, labels(a)': [['t', 'f', 'o'], [['KNOWS', '[Person, Party]', '[Person, Party]']]],
    }), 'g')
    expect(catalog?.constraints).toEqual([
      { kind: 'unique', entity: 'node', label: 'Person', properties: ['id'], status: 'OPERATIONAL' },
      { kind: 'mandatory', entity: 'relationship', label: 'RATED', properties: ['stars'], status: 'OPERATIONAL' },
    ])
    expect(catalog?.indexes).toEqual([{ entity: 'node', label: 'Person', properties: ['id', 'email'] }])
    expect(catalog?.nodes).toEqual([{
      labels: ['Person', 'Party'],
      properties: [{ key: 'id', type: 'String' }, { key: 'email', type: 'String' }],
    }])
    expect(catalog?.edges).toEqual([{ type: 'KNOWS', from: ['Person', 'Party'], to: ['Person', 'Party'] }])
    expect(catalog?.truncated).toBeUndefined()
  })

  it('reports a query the server refuses', async () => {
    const { diagnostics } = await readFalkorSchema({
      sendCommand: async (args: string[]) => {
        if (args[0] === 'GRAPH.LIST') return ['g']
        throw new Error('NOAUTH Authentication required')
      },
    }, 'g')
    expect(diagnostics.some((d) => d.severity === 'error' && d.code === 'import-catalog')).toBe(true)
  })
})

// @lat: [[emitters#FalkorDB Target#Reading the Script Back]]
describe('reading a generated FalkorDB script back into commands', () => {
  const golden = (name: string) =>
    readFileSync(join(__dirname, 'golden', name), 'utf8')

  it('reads every command of the committed schema script, in order', () => {
    const { commands, graphKey, error } = readFalkorScript(golden('social.falkordb.sh'))
    expect(error).toBeUndefined()
    expect(graphKey).toBe('social')
    expect(commands.length).toBeGreaterThan(0)
    expect(commands[0]?.args).toEqual(['GRAPH.QUERY', 'social', 'CREATE INDEX FOR (n:Car) ON (n.vin)'])
    expect(commands[1]?.args).toEqual(
      ['GRAPH.CONSTRAINT', 'CREATE', 'social', 'UNIQUE', 'NODE', 'Car', 'PROPERTIES', '1', 'vin'])
    // Every command is one of the two the generator writes, and none carries a variable.
    expect(commands.every((c) => ['GRAPH.QUERY', 'GRAPH.CONSTRAINT'].includes(c.args[0]!))).toBe(true)
    expect(commands.every((c) => c.args.every((a) => !a.includes('$')))).toBe(true)
  })

  it('substitutes an overriding graph key, as the shell variable would', () => {
    const { commands } = readFalkorScript(golden('social.falkordb.sh'), 'other')
    expect(commands.every((c) => !c.args.includes('social'))).toBe(true)
    expect(commands[0]?.args[1]).toBe('other')
  })

  it('reads a committed migration script too', () => {
    const { commands, error } = readFalkorScript(golden(join('migrate', 'rename-property.falkordb.sh')))
    expect(error).toBeUndefined()
    expect(commands.length).toBeGreaterThan(0)
  })

  it('refuses a line it did not generate rather than interpreting it', () => {
    const header = '#!/bin/sh\n# Generated by lpg-modeler. Target: falkordb (FalkorDB).\n'
    const preamble = 'REDIS_CLI="${REDIS_CLI:-redis-cli}"\nGRAPH_KEY="${GRAPH_KEY:-g}"\n'
    for (const line of [
      'for k in a b; do $REDIS_CLI GRAPH.QUERY "$GRAPH_KEY" "MATCH (n) RETURN n"; done',
      '$REDIS_CLI GRAPH.QUERY "$GRAPH_KEY" "MATCH (n) RETURN n" | tee out.txt',
      '$REDIS_CLI FLUSHALL',
      'rm -rf /',
      '$REDIS_CLI GRAPH.QUERY "$OTHER_KEY" "MATCH (n) RETURN n"',
    ]) {
      const { error, commands } = readFalkorScript(`${header}${preamble}${line}\n`)
      expect(error, line).toBeDefined()
      expect(commands, line).toEqual([])
    }
  })

  it('names the line and its number when it refuses', () => {
    const text = [
      '#!/bin/sh',
      '# Generated by lpg-modeler. Target: falkordb (FalkorDB).',
      'GRAPH_KEY="${GRAPH_KEY:-g}"',
      '$REDIS_CLI GRAPH.QUERY "$GRAPH_KEY" "CREATE INDEX FOR (n:A) ON (n.x)"',
      'echo done',
      '',
    ].join('\n')
    const { error, commands } = readFalkorScript(text)
    expect(error).toEqual({ line: 5, text: 'echo done' })
    expect(commands).toHaveLength(1)
  })
})

// @lat: [[importers#Reading a FalkorDB Instance]]
describe('the list encoding FalkorDB returns inside a column', () => {
  it('reads a bracketed list, a single value and an empty one', () => {
    expect(parseList('[Person, Party]')).toEqual(['Person', 'Party'])
    expect(parseList('[email]')).toEqual(['email'])
    expect(parseList('[]')).toEqual([])
    expect(parseList('')).toEqual([])
    expect(parseList(null)).toEqual([])
    expect(parseList('bare')).toEqual(['bare'])
  })
})
