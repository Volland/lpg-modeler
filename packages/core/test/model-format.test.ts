import { describe, it, expect } from 'vitest'
import { resolveModel } from '../src/resolve'
import { parseModel } from '../src/parse'
import { applyEdits } from '../src/mutate'
import { backfillIdEdits, duplicateIdDiagnostics } from '../src/ids'
import { validateModel } from '../src/validate'
import { fixture, readFile, loadFixture } from './helpers'

const codes = (ds: { code: string }[]) => ds.map((d) => d.code)

// @lat: [[metamodel#Type Hierarchy]]
describe('inheritance and mixins', () => {
  it('resolves inherited properties onto a subtype and marks their origin', () => {
    const model = loadFixture('social.lpg.yaml')
    const person = model.nodes.find((n) => n.name === 'Person')!
    const id = person.props.find((p) => p.name === 'id')!
    expect(id.inheritedFrom).toBe('Party')
    const createdAt = person.props.find((p) => p.name === 'createdAt')!
    expect(createdAt.inheritedFrom).toBe('Timestamped')
    expect(person.props.find((p) => p.name === 'email')!.inheritedFrom).toBeUndefined()
  })

  it('reports cyclic inheritance without losing the remaining types', () => {
    const { model, diagnostics } = resolveModel(fixture('cyclic.lpg.yaml'), readFile)
    expect(codes(diagnostics)).toContain('cyclic-inheritance')
    expect(model.nodes.map((n) => n.name).sort()).toEqual(['A', 'B'])
  })
})

// @lat: [[metamodel#Identity]]
describe('identity', () => {
  it('inherits a key from an abstract parent', () => {
    const person = loadFixture('social.lpg.yaml').nodes.find((n) => n.name === 'Person')!
    expect(person.key).toEqual(['id'])
    expect(person.keyInheritedFrom).toBe('Party')
  })

  it('reports a concrete type with no key', () => {
    const { model } = resolveModel(fixture('broken.lpg.yaml'), readFile)
    const d = validateModel(model).find((x) => x.code === 'missing-key')
    expect(d?.message).toContain('NoKey')
  })

  it('reports a key naming a property the type does not have', () => {
    const { model } = resolveModel(fixture('broken.lpg.yaml'), readFile)
    const d = validateModel(model).find((x) => x.code === 'key-unknown-property')
    expect(d?.message).toContain('missing')
  })
})

// @lat: [[metamodel#Stable Element IDs]]
describe('stable element ids', () => {
  it('assigns an id where one is absent and leaves the rest of the file alone', () => {
    const text = [
      'namespace:',
      '  prefix: t',
      '  iri: https://example.org/t#',
      'nodes:',
      '  # a comment that must survive',
      '  Thing:',
      '    key: [id]',
      '    props:',
      '      id: { type: string } # trailing comment',
      '',
    ].join('\n')
    const out = applyEdits(text, backfillIdEdits(text))
    expect(out).toMatch(/id: n_[a-z0-9]+/)   // block-style body
    expect(out).toMatch(/\{ id: p_[a-z0-9]+, type: string \}/) // flow-style body
    expect(out).toContain('# a comment that must survive')
    expect(out).toContain('# trailing comment')
    expect(out).toContain('    key: [id]')  // untouched, no flow-padding drift
  })

  it('gives a file with no ids the same ids on every read', () => {
    // Layout is keyed by id. An id drawn afresh on each read would make the canvas lay a
    // diagram out, persist those positions and then never recognise them again, so a
    // hand-written model could never keep an arrangement.
    const text = [
      'namespace: { prefix: t, iri: "https://example.org/t#" }',
      'nodes:',
      '  A: { key: [x], props: { x: { type: string }, y: { type: string } } }',
      '  B: { key: [x], props: { x: { type: string } } }',
      'edges:',
      '  R: { from: A, to: B }',
      '',
    ].join('\n')
    const read = () => resolveModel('/m.lpg.yaml', (p) => (p === '/m.lpg.yaml' ? text : undefined)).model
    const shape = (m: ReturnType<typeof read>) => [
      ...m.nodes.map((n) => [n.name, n.id, ...n.props.map((p) => `${p.name}=${p.id}`)]),
      ...m.edges.map((e) => [e.name, e.id]),
    ]

    expect(shape(read())).toEqual(shape(read()))
    // And each element still gets its own: two types sharing a property name is the case
    // a name-blind derivation would collapse.
    const ids = read().nodes.flatMap((n) => n.props.map((p) => p.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('backfills exactly the ids the resolver had already synthesised', () => {
    // Otherwise writing ids into a file would renumber every element and throw away the
    // positions the canvas had just drawn against.
    const text = [
      'namespace: { prefix: t, iri: "https://example.org/t#" }',
      'nodes:',
      '  A: { key: [x], props: { x: { type: string } } }',
      'edges:',
      '  R: { from: A, to: A }',
      '',
    ].join('\n')
    const read = (source: string) => resolveModel('/m.lpg.yaml',
      (p) => (p === '/m.lpg.yaml' ? source : undefined)).model
    const before = read(text)
    const after = read(applyEdits(text, backfillIdEdits(text)))

    expect(after.nodes.map((n) => n.id)).toEqual(before.nodes.map((n) => n.id))
    expect(after.edges.map((e) => e.id)).toEqual(before.edges.map((e) => e.id))
    expect(after.nodes[0]!.props.map((p) => p.id)).toEqual(before.nodes[0]!.props.map((p) => p.id))
  })

  it('is a no-op when every element already has an id', () => {
    const text = readFile(fixture('social.lpg.yaml'))!
    expect(backfillIdEdits(text)).toEqual([])
    expect(applyEdits(text, backfillIdEdits(text))).toBe(text)
  })

  it('reports an id used by two elements', () => {
    const text = [
      'namespace: { prefix: t, iri: "https://example.org/t#" }',
      'nodes:',
      '  A: { id: n_same, key: [x], props: { x: { type: string } } }',
      '  B: { id: n_same, key: [x], props: { x: { type: string } } }',
    ].join('\n')
    const { raw } = parseModel('t.lpg.yaml', text)
    const d = duplicateIdDiagnostics(raw)
    expect(codes(d)).toContain('duplicate-id')
    expect(d[0]?.message).toContain('n_same')
  })
})

// @lat: [[metamodel#Composition]]
describe('composition and namespaces', () => {
  it('subtypes an imported type, inheriting its properties and key', () => {
    const { model, diagnostics } = resolveModel(fixture('app.lpg.yaml'), readFile)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const emp = model.nodes.find((n) => n.name === 'Employee')!
    expect(emp.key).toEqual(['id'])
    expect(emp.props.map((p) => p.name).sort()).toEqual(['badge', 'id'])
  })

  it('gives each model its own IRI namespace', () => {
    const { model } = resolveModel(fixture('app.lpg.yaml'), readFile)
    expect(model.nodes.find((n) => n.name === 'Employee')!.iri)
      .toBe('https://example.org/vocab/app#Employee')
    expect(model.nodes.find((n) => n.name === 'Party')!.iri)
      .toBe('https://example.org/vocab/party#Party')
  })

  it('resolves the same vocabulary imported by two paths to one type', () => {
    const { model, diagnostics } = resolveModel(fixture('diamond.lpg.yaml'), readFile)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(model.nodes.filter((n) => n.name === 'Party')).toHaveLength(1)
    expect(model.nodes.find((n) => n.name === 'Customer')!.key).toEqual(['id'])
  })
})

// @lat: [[metamodel#Metamodel]]
describe('resolution is total', () => {
  it('returns the valid types alongside diagnostics for the broken one', () => {
    const { model, diagnostics } = resolveModel(fixture('broken.lpg.yaml'), readFile)
    expect(codes(diagnostics)).toContain('unresolved-parent')
    expect(model.nodes.map((n) => n.name)).toContain('Good')
    expect(model.nodes.map((n) => n.name)).toContain('AlsoGood')
  })

  it('does not throw on an unparseable file', () => {
    const { raw, diagnostics } = parseModel('bad.lpg.yaml', 'nodes: [oops\n  : :')
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(raw.nodes).toEqual([])
  })

  it('does not throw when a model file is missing entirely', () => {
    const { model, diagnostics } = resolveModel('/nope/missing.lpg.yaml', () => undefined)
    expect(codes(diagnostics)).toContain('missing-import')
    expect(model.nodes).toEqual([])
  })
})
