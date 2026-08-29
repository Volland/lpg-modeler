import { describe, it, expect } from 'vitest'
import { emit } from '../src/emit/index'
import { mapEdge, lowerCamel, pascal } from '../src/emit/reify'
import { loadFixture } from './helpers'
import { applyEdits, setPreviousIri } from '../src/mutate'
import { resolveModel } from '../src/resolve'
import { fixture, readFile } from './helpers'

const model = () => loadFixture('social.lpg.yaml')

// @lat: [[emitters#Emitters#RDF Targets#Gradual Reification]]
describe('gradual reification', () => {
  it('names terms conventionally', () => {
    expect(lowerCamel('LIVES_AT')).toBe('livesAt')
    expect(pascal('LIVES_AT')).toBe('LivesAt')
  })

  it('leaves a property-free edge as a plain relation', () => {
    const bare = { ...model().edges[0]!, name: 'LIKES', props: [] }
    expect(mapEdge(bare)).toMatchObject({ kind: 'plain', property: 'likes' })
  })

  it('reifies an edge that carries properties, with a shortcut', () => {
    const knows = model().edges.find((e) => e.name === 'KNOWS')!
    expect(mapEdge(knows)).toMatchObject({
      kind: 'reified',
      className: 'Knows',
      subjectProperty: 'knowsSubject',
      objectProperty: 'knowsObject',
      shortcutProperty: 'knows',
    })
  })
})

// @lat: [[emitters#Emitters#RDF Targets#SHACL Shapes]]
describe('shacl emitter', () => {
  it('requires at least one value for a required property', () => {
    const out = emit(model(), 'shacl')
    const person = out.content.slice(out.content.indexOf('social:PersonShape'))
    expect(person).toContain('sh:path social:email ;')
    expect(person).toContain('sh:datatype xsd:string ;')
    expect(person).toContain('sh:minCount 1 ;')
  })

  it('constrains the reified edge class, not just the endpoints', () => {
    const out = emit(model(), 'shacl')
    expect(out.content).toContain('sh:targetClass social:Knows ;')
    expect(out.content).toContain('sh:path social:knowsSubject ;')
    expect(out.content).toContain('sh:path social:since ;')
  })

  it('reports uniqueness as a downgrade rather than pretending to enforce it', () => {
    const out = emit(model(), 'shacl')
    expect(out.diagnostics.some((d) => d.code === 'downgrade-unique')).toBe(true)
    expect(out.content).toContain("# UNENFORCED: 'email' is unique in the model")
  })

  it('matches the golden file', async () => {
    await expect(emit(model(), 'shacl').content)
      .toMatchFileSnapshot('./golden/social.shacl.ttl')
  })
})

// @lat: [[emitters#Emitters#RDF Targets#OWL Subset]]
describe('owl emitter', () => {
  it('asserts the subclass backbone and keys', () => {
    const out = emit(model(), 'owl')
    expect(out.content).toContain('social:Person a owl:Class ;')
    expect(out.content).toContain('rdfs:subClassOf social:Party ;')
    expect(out.content).toContain('owl:hasKey ( social:id )')
  })

  it('never asserts a domain, a range on an object property, or a cardinality restriction', () => {
    const out = emit(model(), 'owl')
    // Judge the assertions only: the header comment names these terms to explain
    // precisely why they are absent.
    const assertions = out.content.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n')
    expect(assertions).not.toContain('rdfs:domain')
    expect(assertions).not.toContain('owl:Restriction')
    expect(assertions).not.toContain('owl:cardinality')
    expect(assertions).not.toContain('owl:minCardinality')
    // A datatype property may state its range; an object property may not.
    const objectPropertyLines = assertions.split('\n').filter((l) => l.includes('owl:ObjectProperty'))
    expect(objectPropertyLines.every((l) => !l.includes('rdfs:range'))).toBe(true)
  })

  it('reports required and unique as downgrades carried by SHACL', () => {
    const out = emit(model(), 'owl')
    const required = out.diagnostics.find((d) => d.code === 'downgrade-required')
    expect(required?.message).toContain('SHACL artifact carries it')
    expect(out.diagnostics.some((d) => d.code === 'downgrade-unique')).toBe(true)
  })

  it('keeps a property-free edge plain, and reifies one that carries properties', () => {
    const out = emit(model(), 'owl')
    // LIKES has no properties: a plain object property, no class, no shortcut.
    expect(out.content).toContain('social:likes a owl:ObjectProperty ; rdfs:label "LIKES" .')
    expect(out.content).not.toContain('social:Likes a owl:Class')
    // KNOWS carries 'since': reified into a class alongside a shortcut property.
    expect(out.content).toContain('social:Knows a owl:Class')
    expect(out.content).toContain('social:knowsSubject a owl:ObjectProperty .')
  })

  it('matches the golden file', async () => {
    await expect(emit(model(), 'owl').content)
      .toMatchFileSnapshot('./golden/social.owl.ttl')
  })
})

// @lat: [[metamodel#Namespaces]]
describe('rename preserves ontology identity', () => {
  it('asserts equivalence to the previous IRI', () => {
    const src = readFile(fixture('social.lpg.yaml'))!
    const text = applyEdits(src, setPreviousIri(src, 'nodes', 'Company',
      'https://example.org/vocab/social#Company'))
    const { model: m } = resolveModel(fixture('social.lpg.yaml'), (p) =>
      p === fixture('social.lpg.yaml') ? text : readFile(p))
    const out = emit(m, 'owl')
    expect(out.content).toContain('owl:equivalentClass <https://example.org/vocab/social#Company>')
  })
})
