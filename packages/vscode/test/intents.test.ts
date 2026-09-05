import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { applyEdits, resolveModel, emit } from '@lpg/core'
import { intentToEdits } from '../src/intents'
import type { Intent } from '../src/protocol'

const MODEL = resolve(__dirname, '..', '..', 'core', 'test', 'fixtures', 'social.lpg.yaml')
const read = (p: string): string | undefined => {
  try { return readFileSync(p, 'utf8') } catch { return undefined }
}
const SRC = () => read(MODEL)!

/** Apply an intent, then re-resolve as though the file had been written. */
function apply(text: string, intent: Intent) {
  const next = applyEdits(text, intentToEdits(text, intent, MODEL, read))
  const { model, diagnostics } = resolveModel(MODEL, (p) => (p === MODEL ? next : read(p)))
  return { text: next, model, diagnostics }
}

// @lat: [[architecture#Editing Surface]]
describe('canvas intents', () => {
  it('creates a node type from the canvas', () => {
    const r = apply(SRC(), { kind: 'addNode', name: 'Address' })
    expect(r.model.nodes.map((n) => n.name)).toContain('Address')
    expect(r.text).toContain('# A small social domain')  // comments intact
  })

  it('adds a property with the chosen scalar type', () => {
    const r = apply(SRC(), {
      kind: 'addProperty', owner: 'Company', ownerKind: 'nodes', name: 'founded', propType: 'date',
    })
    const company = r.model.nodes.find((n) => n.name === 'Company')!
    expect(company.props.find((p) => p.name === 'founded')?.type).toBe('date')
  })

  it('sets the key from the canvas', () => {
    const r = apply(SRC(), { kind: 'setKey', name: 'Car', key: ['seats'] })
    expect(r.model.nodes.find((n) => n.name === 'Car')!.key).toEqual(['seats'])
  })

  it('creates an edge by connecting two node types', () => {
    let text = SRC()
    text = apply(text, { kind: 'addNode', name: 'Address' }).text
    text = apply(text, {
      kind: 'addProperty', owner: 'Address', ownerKind: 'nodes', name: 'id', propType: 'string',
    }).text
    text = apply(text, { kind: 'setKey', name: 'Address', key: ['id'] }).text
    const r = apply(text, { kind: 'addEdge', name: 'LIVES_AT', from: 'Person', to: 'Address' })
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const edge = r.model.edges.find((e) => e.name === 'LIVES_AT')!
    expect([edge.from, edge.to]).toEqual(['Person', 'Address'])
  })

  it('redirects an endpoint', () => {
    const r = apply(SRC(), { kind: 'setEndpoint', name: 'KNOWS', which: 'to', target: 'Company' })
    expect(r.model.edges.find((e) => e.name === 'KNOWS')!.to).toBe('Company')
  })

  it('deletes a node type together with the edges that referenced it', () => {
    const r = apply(SRC(), { kind: 'deleteNode', name: 'Company' })
    expect(r.model.nodes.map((n) => n.name)).not.toContain('Company')
    expect(r.model.edges.map((e) => e.name)).not.toContain('LIKES')
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('renaming records the previous IRI so the ontology stays resolvable', () => {
    const r = apply(SRC(), { kind: 'renameNode', from: 'Company', to: 'Organisation' })
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const org = r.model.nodes.find((n) => n.name === 'Organisation')!
    expect(org.previousIri).toBe('https://example.org/vocab/social#Company')
    expect(emit(r.model, 'owl').content)
      .toContain('owl:equivalentClass <https://example.org/vocab/social#Company>')
  })

  it('renaming carries edge endpoints with it', () => {
    const r = apply(SRC(), { kind: 'renameNode', from: 'Person', to: 'Individual' })
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(r.model.edges.find((e) => e.name === 'KNOWS')!.from).toBe('Individual')
  })

  it('a model authored purely through intents generates every target', () => {
    let text = 'namespace:\n  prefix: demo\n  iri: https://example.org/demo#\n'
    const steps: Intent[] = [
      { kind: 'addNode', name: 'Person' },
      { kind: 'addProperty', owner: 'Person', ownerKind: 'nodes', name: 'id', propType: 'string' },
      { kind: 'addProperty', owner: 'Person', ownerKind: 'nodes', name: 'email', propType: 'string' },
      { kind: 'setKey', name: 'Person', key: ['id'] },
      { kind: 'addNode', name: 'Company' },
      { kind: 'addProperty', owner: 'Company', ownerKind: 'nodes', name: 'id', propType: 'string' },
      { kind: 'setKey', name: 'Company', key: ['id'] },
      { kind: 'addEdge', name: 'WORKS_AT', from: 'Person', to: 'Company' },
    ]
    for (const step of steps) {
      text = applyEdits(text, intentToEdits(text, step, MODEL, () => text))
    }
    const { model, diagnostics } = resolveModel(MODEL, () => text)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(emit(model, 'ladybug').content).toContain('CREATE NODE TABLE IF NOT EXISTS Person (')
    expect(emit(model, 'owl').content).toContain('demo:Person a owl:Class')
    expect(emit(model, 'shacl').content).toContain('sh:targetClass demo:Person ;')
  })
  it('makes a type abstract and gives it a parent from the inspector', () => {
    let text = apply(SRC(), { kind: 'setAbstract', name: 'Company', abstract: true }).text
    expect(apply(text, { kind: 'addNode', name: 'x' }).model.nodes
      .find((n) => n.name === 'Company')!.abstract).toBe(true)

    text = apply(text, { kind: 'setAbstract', name: 'Company', abstract: false }).text
    const r = apply(text, { kind: 'setAbstractParent', name: 'Company', parent: 'Party' })
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(r.model.nodes.find((n) => n.name === 'Company')!.extends).toBe('Party')
  })

  it('renaming an edge type records its previous IRI too', () => {
    // An ontology consumer holds an edge type's identity the same way it holds a node
    // type's, so the equivalence has to be asserted either way.
    const r = apply(SRC(), { kind: 'renameEdge', from: 'KNOWS', to: 'IS_ACQUAINTED_WITH' })
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const edge = r.model.edges.find((e) => e.name === 'IS_ACQUAINTED_WITH')!
    expect(edge.previousIri).toBe('https://example.org/vocab/social#KNOWS')
    expect([edge.from, edge.to]).toEqual(['Person', 'Person'])
  })
})

// @lat: [[metamodel#Cardinality]]
describe('cardinality intent', () => {
  it('writes endpoint bounds onto the edge', () => {
    const edits = intentToEdits(SRC(), {
      kind: 'setCardinality', name: 'OWNS', from: '*', to: '2',
    } as Intent, MODEL, read)
    const out = applyEdits(SRC(), edits)
    expect(out).toContain('cardinality: { from: "*", to: "2" }')
    const { model } = resolveModel(MODEL, (p) => (p === MODEL ? out : read(p)))
    expect(model.edges.find((e) => e.name === 'OWNS')!.cardinality.to).toEqual({ min: 2, max: 2 })
  })

  it('removes the field when both ends go back to unbounded', () => {
    const withBound = applyEdits(SRC(), intentToEdits(SRC(), {
      kind: 'setCardinality', name: 'OWNS', from: '*', to: '2',
    } as Intent, MODEL, read))
    const cleared = applyEdits(withBound, intentToEdits(withBound, {
      kind: 'setCardinality', name: 'OWNS', from: '*', to: '*',
    } as Intent, MODEL, read))
    // Unbounded at both ends is the default, so it is written by absence.
    expect(cleared).not.toContain('cardinality')
  })
})

// @lat: [[architecture#Editing Surface#Inspector]]
describe('constraint intents', () => {
  const apply = (src: string, intent: Intent) =>
    applyEdits(src, intentToEdits(src, intent, MODEL, read))
  const reload = (text: string) =>
    resolveModel(MODEL, (p) => (p === MODEL ? text : read(p))).model

  it('sets a value facet inside the property it belongs to', () => {
    const out = apply(SRC(), {
      kind: 'setPropertyFacet', owner: 'Car', ownerKind: 'nodes', prop: 'seats',
      facet: 'max', value: '7',
    } as Intent)
    const seats = reload(out).nodes.find((n) => n.name === 'Car')!
      .props.find((p) => p.name === 'seats')!
    expect(seats.max).toBe(7)
    // The rest of the property is untouched.
    expect(seats.type).toBe('int')
  })

  it('quotes a pattern and clears a facet when the value is empty', () => {
    const withPattern = apply(SRC(), {
      kind: 'setPropertyFacet', owner: 'Person', ownerKind: 'nodes', prop: 'email',
      facet: 'pattern', value: '^[^@]+@[^@]+$',
    } as Intent)
    expect(reload(withPattern).nodes.find((n) => n.name === 'Person')!
      .props.find((p) => p.name === 'email')!.pattern).toBe('^[^@]+@[^@]+$')

    const cleared = apply(withPattern, {
      kind: 'setPropertyFacet', owner: 'Person', ownerKind: 'nodes', prop: 'email',
      facet: 'pattern',
    } as Intent)
    expect(reload(cleared).nodes.find((n) => n.name === 'Person')!
      .props.find((p) => p.name === 'email')!.pattern).toBeUndefined()
  })

  it('adds a named constraint, creating the block when there is none', () => {
    const out = apply(SRC(), {
      kind: 'addConstraint', owner: 'Person', name: 'bornBeforeCreated',
      assertion: '{ lessThan: [born, createdAt] }', message: 'born first',
    } as Intent)
    const person = reload(out).nodes.find((n) => n.name === 'Person')!
    expect(person.constraints).toHaveLength(1)
    expect(person.constraints[0]).toMatchObject({
      name: 'bornBeforeCreated', message: 'born first',
      assert: { kind: 'lessThan', left: 'born', right: 'createdAt' },
    })
  })

  it('appends a second constraint to the existing block, then deletes one', () => {
    let text = apply(SRC(), {
      kind: 'addConstraint', owner: 'Person', name: 'first',
      assertion: '{ lessThan: [born, createdAt] }',
    } as Intent)
    text = apply(text, {
      kind: 'addConstraint', owner: 'Person', name: 'second',
      assertion: '{ equals: [born, createdAt] }',
    } as Intent)
    expect(reload(text).nodes.find((n) => n.name === 'Person')!.constraints
      .map((k) => k.name)).toEqual(['first', 'second'])

    const pruned = apply(text, {
      kind: 'deleteConstraint', owner: 'Person', name: 'first',
    } as Intent)
    expect(reload(pruned).nodes.find((n) => n.name === 'Person')!.constraints
      .map((k) => k.name)).toEqual(['second'])
  })

  it('removes the block when the last constraint goes', () => {
    const added = apply(SRC(), {
      kind: 'addConstraint', owner: 'Person', name: 'only',
      assertion: '{ lessThan: [born, createdAt] }',
    } as Intent)
    const empty = apply(added, {
      kind: 'deleteConstraint', owner: 'Person', name: 'only',
    } as Intent)
    expect(empty).not.toContain('constraints')
    expect(reload(empty).nodes.find((n) => n.name === 'Person')!.constraints).toEqual([])
  })
})
