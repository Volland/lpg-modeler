import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { emit, targetNames } from '../src/emit/index'
import { memgraphSchema } from '../src/emit/memgraph'
import { concreteNodes, type ModelIR } from '../src/ir'
import { resolveModel } from '../src/resolve'
import { loadFixture, readFile } from './helpers'

const FIXTURES = ['social.lpg.yaml', 'features.lpg.yaml', 'composites.lpg.yaml', 'types.lpg.yaml']
const EXAMPLES = ['social', 'fleet', 'catalog', 'kinship', 'booking']
const example = (name: string): ModelIR =>
  resolveModel(join(__dirname, `../../../docs/examples/${name}.lpg.yaml`), readFile).model

const codes = (m: ModelIR) => emit(m, 'memgraph').diagnostics.map((d) => d.code)

// @lat: [[emitters#Memgraph Target]]
describe('memgraph target, golden', () => {
  it('is a registered target', () => {
    expect(targetNames()).toContain('memgraph')
  })

  for (const f of FIXTURES) {
    it(`fixture ${f}`, async () => {
      await expect(emit(loadFixture(f), 'memgraph').content)
        .toMatchFileSnapshot(`./golden/${f.replace(/\.lpg\.yaml$/, '')}.memgraph.cypher`)
    })
  }
  for (const e of EXAMPLES) {
    it(`example ${e}`, async () => {
      await expect(emit(example(e), 'memgraph').content).toMatchFileSnapshot(`./golden/examples/${e}.memgraph.cypher`)
    })
  }
})

// @lat: [[emitters#Memgraph Target]]
describe('memgraph target', () => {
  it('carries every key, required and unique property of every concrete type as a constraint', () => {
    for (const model of [...FIXTURES.map(loadFixture), ...EXAMPLES.map(example)]) {
      const created = memgraphSchema(model).objects.map((o) => o.create)
      for (const node of concreteNodes(model)) {
        const L = node.name
        if (node.key.length > 0) {
          expect(created).toContain(`CREATE CONSTRAINT ON (n:${L}) ASSERT ${node.key.map((k) => `n.${k}`).join(', ')} IS UNIQUE;`)
          for (const k of node.key) expect(created).toContain(`CREATE CONSTRAINT ON (n:${L}) ASSERT EXISTS (n.${k});`)
        }
        for (const p of node.props) {
          if (p.required) expect(created, `${L}.${p.name}`).toContain(`CREATE CONSTRAINT ON (n:${L}) ASSERT EXISTS (n.${p.name});`)
          if (p.unique && !node.key.includes(p.name)) {
            expect(created, `${L}.${p.name}`).toContain(`CREATE CONSTRAINT ON (n:${L}) ASSERT n.${p.name} IS UNIQUE;`)
          }
        }
      }
    }
  })

  it('asserts a value type for every scalar Memgraph can check', () => {
    const out = emit(loadFixture('types.lpg.yaml'), 'memgraph').content
    for (const t of ['STRING', 'INTEGER', 'FLOAT', 'BOOLEAN', 'DATE', 'LOCALDATETIME', 'ZONEDDATETIME', 'DURATION']) {
      expect(out, t).toContain(`IS TYPED ${t};`)
    }
  })

  it('reports what it cannot hold of a type, rather than claiming the constraint does', () => {
    const found = codes(loadFixture('types.lpg.yaml'))
    expect(found).toContain('downgrade-type-width')
    expect(found).toContain('downgrade-type')
  })

  it('declares enums as Memgraph enums and reports that a specific one cannot be required', () => {
    const out = emit(loadFixture('features.lpg.yaml'), 'memgraph')
    expect(out.content).toContain('CREATE ENUM Status VALUES { active, retired };')
    expect(out.content).toContain('IS TYPED ENUM;')
    expect(out.diagnostics.map((d) => d.code)).toContain('downgrade-enum-identity')
    expect(out.content.indexOf('CREATE ENUM')).toBeLessThan(out.content.indexOf('CREATE CONSTRAINT'))
  })

  it('reports lists, composites, cardinality and edge constraints, each with a comment', () => {
    expect(codes(loadFixture('features.lpg.yaml'))).toEqual(expect.arrayContaining(['downgrade-list-element', 'downgrade-cardinality']))
    expect(codes(loadFixture('composites.lpg.yaml'))).toContain('downgrade-composite')
    expect(codes(example('booking'))).toContain('downgrade-value-constraint')

    const model = loadFixture('social.lpg.yaml')
    const since = model.edges.flatMap((e) => e.props)[0]!
    since.required = true
    since.unique = true
    const owner = model.edges.find((e) => e.props.includes(since))!
    const out = emit(model, 'memgraph')
    expect(out.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['downgrade-edge-required', 'downgrade-edge-unique']))
    expect(out.content).toContain(`// UNENFORCED: '${since.name}' is required; Memgraph has no relationship constraints.`)
    expect(out.content).toContain(`// UNENFORCED: '${since.name}' is unique; Memgraph has no relationship constraints.`)
    expect(out.content).not.toMatch(new RegExp(`CONSTRAINT[^\\n]*${owner.name}`))
  })

  it('quotes a name that is not a bare identifier', () => {
    const model = loadFixture('features.lpg.yaml')
    model.enums[0]!.values = ['in-progress', 'done']
    expect(emit(model, 'memgraph').content).toContain('CREATE ENUM Status VALUES { `in-progress`, done };')
  })
})
