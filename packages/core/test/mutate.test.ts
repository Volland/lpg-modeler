import { describe, it, expect } from 'vitest'
import {
  addEdgeType, addMixin, addNodeType, addProperty, applyEdits, deleteProperty, deleteType,
  edgesReferencing, renameProperty, renameType, setAbstractParent, setEndpoint, setKey,
  setMixins, setPreviousIri,
} from '../src/mutate'
import { resolveModel } from '../src/resolve'
import { fixture, readFile } from './helpers'

const SRC = () => readFile(fixture('social.lpg.yaml'))!

/**
 * Lines that changed, compared positionally. Only meaningful for edits that do not
 * change the line count; use `insertedLines` for insertions.
 */
function changedLines(before: string, after: string): string[] {
  const a = before.split('\n'), b = after.split('\n')
  const out: string[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) out.push(`${a[i] ?? '<none>'} => ${b[i] ?? '<none>'}`)
  }
  return out
}

/** Re-resolve mutated text so a mutation is judged by the model it produces. */
/** The lines `after` adds, asserting everything else is byte-identical. */
function insertedLines(before: string, after: string): string[] {
  const b = before.split('\n')
  const a = after.split('\n')
  const added: string[] = []
  let i = 0
  for (const line of a) {
    if (i < b.length && line === b[i]) { i++; continue }
    added.push(line)
  }
  if (i !== b.length) throw new Error('after is not a pure insertion over before')
  return added
}

function reresolve(text: string) {
  return resolveModel(fixture('social.lpg.yaml'), (p) =>
    p === fixture('social.lpg.yaml') ? text : readFile(p))
}

// @lat: [[architecture#Editing Surface]]
describe('mutations preserve the file', () => {
  it('renames a node type and nothing else on unrelated lines', () => {
    const before = SRC()
    const after = applyEdits(before, renameType(before, 'nodes', 'Company', 'Organisation'))
    expect(after).toContain('  Organisation:')
    expect(after).not.toContain('  Company:')
    // Comments and every other construct untouched.
    expect(after).toContain('# A small social domain, used across the emitter tests.')
    expect(after).toContain('    key: [id]')          // no flow-padding drift
    expect(after).toContain('      born: { id: p_born, type: date }')
    expect(changedLines(before, after)).toEqual([
      '  Company: =>   Organisation:',
      '    to: Company =>     to: Organisation',
    ])
  })

  it('carries references along when a node type is renamed', () => {
    const before = SRC()
    const after = applyEdits(before, renameType(before, 'nodes', 'Party', 'Actor'))
    const { model, diagnostics } = reresolve(after)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(model.nodes.find((n) => n.name === 'Person')!.ancestors).toEqual(['Actor'])
    expect(model.edges.find((e) => e.name === 'OWNS')!.from).toBe('Actor')
  })

  it('adds a property into an existing props block at the right indentation', () => {
    const before = SRC()
    const after = applyEdits(before, addProperty(before, 'nodes', 'Company', {
      name: 'founded', type: 'date', id: 'p_found',
    }))
    expect(insertedLines(before, after))
      .toEqual(['      founded: { id: p_found, type: date }'])
    expect(reresolve(after).model.nodes.find((n) => n.name === 'Company')!.props
      .map((p) => p.name)).toContain('founded')
  })

  it('renames a property and follows it into the key', () => {
    const before = SRC()
    const after = applyEdits(before, renameProperty(before, 'nodes', 'Car', 'vin', 'serial'))
    expect(after).toContain('    key: [serial]')
    expect(after).toContain('      serial: { id: p_vin, type: string, required: true }')
    const car = reresolve(after).model.nodes.find((n) => n.name === 'Car')!
    expect(car.key).toEqual(['serial'])
  })

  it('deletes a property without disturbing its neighbours', () => {
    const before = SRC()
    const after = applyEdits(before, deleteProperty(before, 'nodes', 'Car', 'seats'))
    expect(after).not.toContain('seats')
    expect(after).toContain('      vin: { id: p_vin, type: string, required: true }')
    expect(reresolve(after).model.nodes.find((n) => n.name === 'Car')!.props
      .map((p) => p.name)).toEqual(['vin'])
  })

  it('adds a node type and an edge type, producing a resolvable model', () => {
    let text = SRC()
    text = applyEdits(text, addNodeType(text, 'Address', { key: ['id'], id: 'n_addr' }))
    text = applyEdits(text, addProperty(text, 'nodes', 'Address', {
      name: 'id', type: 'string', required: true, id: 'p_aid',
    }))
    text = applyEdits(text, addEdgeType(text, 'LIVES_AT', 'Person', 'Address', 'e_lives'))
    const { model, diagnostics } = reresolve(text)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(model.nodes.map((n) => n.name)).toContain('Address')
    const edge = model.edges.find((e) => e.name === 'LIVES_AT')!
    expect([edge.from, edge.to]).toEqual(['Person', 'Address'])
  })

  it('sets a key, an abstract parent, and an endpoint', () => {
    let text = SRC()
    text = applyEdits(text, setKey(text, 'Car', ['vin', 'seats']))
    expect(text).toContain('    key: [vin, seats]')
    text = applyEdits(text, setAbstractParent(text, 'Car', 'Party'))
    expect(text).toContain('    extends: Party')
    text = applyEdits(text, setEndpoint(text, 'KNOWS', 'to', 'Company'))
    expect(reresolve(text).model.edges.find((e) => e.name === 'KNOWS')!.to).toBe('Company')
  })

  it('deletes a node type and the edges that referenced it', () => {
    const before = SRC()
    expect(edgesReferencing(before, 'Company')).toEqual(['LIKES'])
    const after = applyEdits(before, deleteType(before, 'nodes', 'Company'))
    expect(after).not.toContain('Company')
    expect(after).not.toContain('LIKES')   // would otherwise dangle
    expect(after).toContain('  Person:')
    expect(after).toContain('  Car:')
    // The result must still be a resolvable model, not one full of broken references.
    expect(reresolve(after).diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('records the previous IRI when a type is renamed', () => {
    let text = SRC()
    const iri = 'https://example.org/vocab/social#Company'
    text = applyEdits(text, setPreviousIri(text, 'nodes', 'Company', iri))
    text = applyEdits(text, renameType(text, 'nodes', 'Company', 'Organisation'))
    const org = reresolve(text).model.nodes.find((n) => n.name === 'Organisation')!
    expect(org.previousIri).toBe(iri)
    expect(org.iri).toBe('https://example.org/vocab/social#Organisation')
  })
})

// @lat: [[metamodel#Type Hierarchy#Mixins]]
describe('authoring a mixin', () => {
  it('appends to the mixins block a model already has', () => {
    const before = SRC()
    const after = applyEdits(before, addMixin(before, 'Audited', 'm_aud'))
    expect(insertedLines(before, after)).toEqual([
      '  Audited:', '    id: m_aud', '    props: {}',
    ])
    expect(reresolve(after).model.mixins.map((m) => m.name)).toEqual(['Timestamped', 'Audited'])
  })

  it('opens a mixins block before the types that will apply it', () => {
    // A bag of properties reads as a preamble to the types applying it, not as an
    // afterthought at the end of the file.
    const before = [
      'namespace:', '  prefix: social', '  iri: https://example.org/vocab/social#', '',
      'nodes:', '  Car:', '    key: [vin]', '    props:',
      '      vin: { type: string, required: true }', '',
    ].join('\n')
    const after = applyEdits(before, addMixin(before, 'Audited'))
    expect(after.indexOf('mixins:')).toBeLessThan(after.indexOf('nodes:'))
    expect(after).toContain('nodes:')
  })

  it('applies and unapplies a mixin as a whole list', () => {
    let text = applyEdits(SRC(), setMixins(SRC(), 'Company', ['Timestamped']))
    const company = () => reresolve(text).model.nodes.find((n) => n.name === 'Company')!
    expect(company().props.find((p) => p.name === 'createdAt')?.inheritedFrom).toBe('Timestamped')

    text = applyEdits(text, setMixins(text, 'Company', []))
    // The empty list removes the field rather than writing `mixins: []`.
    expect(text).not.toContain('mixins: []')
    expect(company().mixins).toEqual([])
    expect(company().props.map((p) => p.name)).not.toContain('createdAt')
  })

  it('carries a rename into every type that applies it', () => {
    const before = SRC()
    const after = applyEdits(before, renameType(before, 'mixins', 'Timestamped', 'Stamped'))
    expect(changedLines(before, after)).toEqual([
      '  Timestamped: =>   Stamped:',
      '    mixins: [Timestamped] =>     mixins: [Stamped]',
    ])
    const person = reresolve(after).model.nodes.find((n) => n.name === 'Person')!
    expect(person.mixins).toEqual(['Stamped'])
    expect(person.props.find((p) => p.name === 'createdAt')?.inheritedFrom).toBe('Stamped')
  })

  it('deleting one takes its applications with it', () => {
    // A type left applying a mixin the model no longer has would not resolve.
    const before = SRC()
    const after = applyEdits(before, deleteType(before, 'mixins', 'Timestamped'))
    expect(after).not.toContain('Timestamped')
    const { model, diagnostics } = reresolve(after)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(model.nodes.find((n) => n.name === 'Person')!.mixins).toEqual([])
  })

  it('edits a mixin property the same way a type property is edited', () => {
    let text = SRC()
    text = applyEdits(text, addProperty(text, 'mixins', 'Timestamped', {
      name: 'updatedAt', type: 'datetime',
    }))
    text = applyEdits(text, renameProperty(text, 'mixins', 'Timestamped', 'createdAt', 'bornAt'))
    const props = () => reresolve(text).model.mixins[0]!.props.map((p) => p.name)
    expect(props()).toEqual(['bornAt', 'updatedAt'])

    text = applyEdits(text, deleteProperty(text, 'mixins', 'Timestamped', 'updatedAt'))
    expect(props()).toEqual(['bornAt'])
    // The change reaches every type applying it, which is the point of a mixin.
    expect(reresolve(text).model.nodes.find((n) => n.name === 'Person')!.props
      .map((p) => p.name)).toContain('bornAt')
  })
})
