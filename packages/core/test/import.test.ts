import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { emit } from '../src/emit/index'
import { importModel, detectFormat, importerNames } from '../src/import/index'
import { importRdf } from '../src/import/rdf'
import { importLadybug } from '../src/import/ladybug'
import { serializeModel } from '../src/serialize'
import { resolveModel } from '../src/resolve'
import { loadFixture, readFile } from './helpers'
import type { ModelIR } from '../src/ir'

/** Generate the artifacts a model produces, then read them back. */
function reimport(model: ModelIR, targets: string[]) {
  return importModel(targets.map((t) => ({
    path: `/tmp/x.${t}.${t === 'ladybug' ? 'cypher' : 'ttl'}`,
    text: emit(model, t).content,
  })))
}

const node = (m: ModelIR, name: string) => m.nodes.find((n) => n.name === name)
const edge = (m: ModelIR, name: string) => m.edges.find((e) => e.name === name)
const codes = (ds: Array<{ code: string }>) => ds.map((d) => d.code)

// @lat: [[importers#Why SHACL and OWL Are Read Together]]
describe('reading SHACL and OWL together', () => {
  const social = () => loadFixture('social.lpg.yaml')

  it('takes the hierarchy from OWL, which SHACL flattens away', () => {
    const { model } = reimport(social(), ['shacl', 'owl'])
    expect(node(model, 'Person')?.extends).toBe('Party')
    expect(node(model, 'Company')?.extends).toBe('Party')
  })

  it('hoists a property every subtype carries back onto the parent', () => {
    const { model, diagnostics } = reimport(social(), ['shacl', 'owl'])
    expect(node(model, 'Party')?.props.map((p) => p.name)).toContain('id')
    expect(node(model, 'Person')?.props.map((p) => p.name)).not.toContain('id')
    expect(codes(diagnostics)).toContain('import-hoisted')
  })

  it('keeps a key on the type that owl:hasKey declares it for', () => {
    const { model } = reimport(social(), ['shacl', 'owl'])
    expect(node(model, 'Party')?.key).toEqual(['id'])
    // Person repeats it only because it inherits it, so it declares none of its own.
    expect(node(model, 'Person')?.key).toEqual([])
  })

  it('recovers an edge endpoint from sh:class, including an abstract one', () => {
    const { model } = reimport(social(), ['shacl', 'owl'])
    expect(edge(model, 'OWNS')).toMatchObject({ from: 'Party', to: 'Car' })
    expect(edge(model, 'LIKES')).toMatchObject({ from: 'Person', to: 'Company' })
  })

  it('reads a reified edge as an edge rather than as a node type', () => {
    const { model } = reimport(social(), ['shacl', 'owl'])
    expect(node(model, 'Knows')).toBeUndefined()
    expect(edge(model, 'KNOWS')?.props.map((p) => p.name)).toEqual(['since'])
  })

  it('says plainly what RDF cannot carry', () => {
    const { model, diagnostics } = reimport(social(), ['shacl', 'owl'])
    expect(codes(diagnostics)).toContain('import-lossy')
    // Every loss the diagnostic names is a real one, not a hedge.
    expect(node(model, 'Party')?.abstract).toBe(false)
    expect(model.mixins).toEqual([])
    expect(node(model, 'Person')?.props.find((p) => p.name === 'email')?.unique).toBe(false)
  })

  it('produces a model that resolves and validates', () => {
    const { model } = reimport(social(), ['shacl', 'owl'])
    const path = join(__dirname, '../../../.import-check.lpg.yaml')
    const text = serializeModel(model)
    const { diagnostics } = resolveModel(path, (p) => (p === path ? text : readFile(p)))
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })
})

// @lat: [[importers#Constraints and Enums]]
describe('constraints carried by SHACL', () => {
  it('recovers an enum from sh:in, naming it after the property', () => {
    const { model } = reimport(loadFixture('features.lpg.yaml'), ['shacl', 'owl'])
    expect(model.enums.length).toBeGreaterThan(0)
    const declared = model.nodes.flatMap((n) => n.props).filter((p) => p.enum)
    expect(declared.length).toBeGreaterThan(0)
    for (const p of declared) {
      expect(model.enums.some((e) => e.name === p.enum)).toBe(true)
    }
  })

  it('recovers value bounds and a pattern', () => {
    const original = loadFixture('features.lpg.yaml')
    const { model } = reimport(original, ['shacl', 'owl'])
    const withBound = original.nodes.flatMap((n) => n.props).find((p) => p.min !== undefined)
    if (withBound) {
      const back = model.nodes.flatMap((n) => n.props).find((p) => p.name === withBound.name)
      expect(back?.min).toBe(withBound.min)
    }
  })

  it('reads a closed shape as a closed type and an absent one as open', () => {
    const { model } = reimport(loadFixture('features.lpg.yaml'), ['shacl', 'owl'])
    // Every type in the fixture has a shape, so none should be guessed open.
    expect(model.nodes.every((n) => typeof n.open === 'boolean')).toBe(true)
  })
})

// @lat: [[importers#Reading LadybugDB DDL]]
describe('reading LadybugDB DDL', () => {
  const ddl = (model: ModelIR) =>
    [{ path: '/tmp/x.ladybug.cypher', text: emit(model, 'ladybug').content }]

  it('reads a node table, its columns and its primary key', () => {
    const { model } = importLadybug(ddl(loadFixture('social.lpg.yaml')))
    expect(node(model, 'Car')?.key).toEqual(['vin'])
    expect(node(model, 'Car')?.props.map((p) => p.name)).toEqual(['vin', 'seats'])
  })

  it('reads a rel table with its endpoints', () => {
    const { model } = importLadybug(ddl(loadFixture('social.lpg.yaml')))
    expect(edge(model, 'KNOWS')).toMatchObject({ from: 'Person', to: 'Person' })
  })

  it('keeps a composite type whole, nesting included', () => {
    const { model } = importLadybug(ddl(loadFixture('composites.lpg.yaml')))
    const location = node(model, 'Sensor')?.props.find((p) => p.name === 'location')
    expect(location?.composite?.kind).toBe('struct')
  })

  it('reads LadybugDB FLOAT as the 32-bit float the engine means by it', () => {
    const { model } = importLadybug([{
      path: '/tmp/f.cypher',
      text: 'CREATE NODE TABLE T (a FLOAT, b DOUBLE, PRIMARY KEY(a));',
    }])
    expect(node(model, 'T')?.props.map((p) => p.type)).toEqual(['float32', 'float'])
  })

  it('warns when an expanded endpoint set has no hierarchy to collapse to', () => {
    const { model, diagnostics } = importLadybug(ddl(loadFixture('social.lpg.yaml')))
    expect(codes(diagnostics)).toContain('import-endpoints')
    // The first pair stands rather than the edge being dropped.
    expect(edge(model, 'OWNS')?.to).toBe('Car')
  })
})

// @lat: [[importers#Combining Sources]]
describe('combining RDF with DDL', () => {
  it('collapses an expanded endpoint set using the hierarchy from OWL', () => {
    const { model, diagnostics } = reimport(loadFixture('social.lpg.yaml'),
      ['shacl', 'owl', 'ladybug'])
    expect(edge(model, 'OWNS')).toMatchObject({ from: 'Party', to: 'Car' })
    expect(codes(diagnostics)).toContain('import-collapsed')
  })

  it('takes a datatype from the DDL where RDF collapsed several onto one', () => {
    const { model, diagnostics } = reimport(loadFixture('types.lpg.yaml'),
      ['shacl', 'owl', 'ladybug'])
    const props = new Map(model.nodes.flatMap((n) => n.props).map((p) => [p.name, p.type]))
    expect(props.get('huge')).toBe('int128')
    expect(props.get('ref')).toBe('uuid')
    expect(props.get('payload')).toBe('json')
    expect(props.get('atZoned')).toBe('zoneddatetime')
    expect(codes(diagnostics)).toContain('import-refined')
  })

  it('does not widen a narrower float when refining from the DDL', () => {
    const { model } = reimport(loadFixture('types.lpg.yaml'), ['shacl', 'owl', 'ladybug'])
    const props = new Map(model.nodes.flatMap((n) => n.props).map((p) => [p.name, p.type]))
    expect(props.get('ratio')).toBe('float32')
    expect(props.get('precise')).toBe('float')
  })

  it('applies a refined width to the ancestor that declares the property', () => {
    const path = join(__dirname, '../../../docs/examples/fleet.lpg.yaml')
    const { model: fleet } = resolveModel(path, readFile)
    const { model } = reimport(fleet, ['shacl', 'owl', 'ladybug'])
    // createdAt arrives from a mixin applied at Asset; the DDL copies it onto every
    // table, and the refinement must land once, on the type that keeps it.
    expect(node(model, 'Asset')?.props.find((p) => p.name === 'createdAt')?.type)
      .toBe('zoneddatetime')
    expect(node(model, 'Truck')?.props.map((p) => p.name)).not.toContain('createdAt')
  })
})

// @lat: [[importers#Importers]]
describe('the importer registry', () => {
  it('lists the sources it knows', () => {
    expect(importerNames()).toEqual(['ladybug', 'rdf'])
  })

  it('tells Turtle from DDL by extension, then by content', () => {
    expect(detectFormat({ path: 'a.ttl', text: '' })).toBe('rdf')
    expect(detectFormat({ path: 'a.cypher', text: '' })).toBe('ladybug')
    expect(detectFormat({ path: 'a.txt', text: '@prefix sh: <x> .' })).toBe('rdf')
    expect(detectFormat({ path: 'a.txt', text: 'CREATE NODE TABLE T (a STRING);' }))
      .toBe('ladybug')
    expect(detectFormat({ path: 'a.txt', text: 'hello' })).toBeUndefined()
  })

  it('reports a file it cannot place rather than silently skipping it', () => {
    const { diagnostics } = importModel([{ path: 'a.txt', text: 'hello' }])
    expect(codes(diagnostics)).toContain('import-unknown-format')
  })

  it('reads a foreign ontology that names no lpg vocabulary', () => {
    const { model } = importRdf([{
      path: '/tmp/foreign.ttl',
      text: `@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <https://example.com/onto#> .
ex:Animal a owl:Class .
ex:Dog a owl:Class ; rdfs:subClassOf ex:Animal .
ex:DogShape a sh:NodeShape ; sh:targetClass ex:Dog ;
  sh:property [ sh:path ex:name ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .`,
    }])
    expect(model.namespace).toEqual({ prefix: 'ex', iri: 'https://example.com/onto#' })
    expect(node(model, 'Dog')?.extends).toBe('Animal')
    // One subtype is no evidence that the parent declared the property, so it stays.
    expect(node(model, 'Dog')?.props[0]).toMatchObject({ name: 'name', required: true })
    expect(node(model, 'Animal')?.props).toEqual([])
  })
})

// @lat: [[importers#Verification]]
describe('every published example survives the round trip', () => {
  const EXAMPLES = ['social.lpg.yaml', 'fleet.lpg.yaml', 'catalog.lpg.yaml',
    'kinship.lpg.yaml', 'booking.lpg.yaml']

  for (const name of EXAMPLES) {
    it(`re-imports ${name} into a model that resolves without error`, () => {
      const path = join(__dirname, '../../../docs/examples', name)
      const { model: original } = resolveModel(path, readFile)
      const { model: back } = reimport(original, ['shacl', 'owl', 'ladybug'])

      // Every concrete type comes back. An abstract one does too, when a subtype
      // names it through rdfs:subClassOf.
      const concrete = original.nodes.filter((n) => !n.abstract).map((n) => n.name).sort()
      expect(back.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(concrete))
      expect(back.edges.map((e) => e.name).sort())
        .toEqual(original.edges.map((e) => e.name).sort())

      const text = serializeModel(back)
      const out = join(__dirname, `../../../.rt-${name}`)
      const { diagnostics } = resolveModel(out, (p) => (p === out ? text : readFile(p)))
      expect(diagnostics.filter((d) => d.severity === 'error'),
        diagnostics.map((d) => d.message).join('; ')).toEqual([])
    })
  }

  it('keeps a three-level hierarchy and its abstract endpoints', () => {
    const path = join(__dirname, '../../../docs/examples/fleet.lpg.yaml')
    const { model: fleet } = resolveModel(path, readFile)
    const { model } = reimport(fleet, ['shacl', 'owl', 'ladybug'])
    expect(node(model, 'Truck')?.extends).toBe('Vehicle')
    expect(node(model, 'Vehicle')?.extends).toBe('Asset')
    // Declared once on the root in the model, and once on the root after the trip.
    expect(edge(model, 'STATIONED_AT')).toMatchObject({ from: 'Asset', to: 'Depot' })
  })
})

/**
 * An ontology this project did not generate is the case `rdfs:domain` exists for. Our own
 * OWL asserts none, so these are the only tests that exercise the fallback at all.
 */
const FOREIGN_OWL = `@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix ex:   <https://example.org/hr#> .

ex:Agent    a owl:Class .
ex:Employee a owl:Class ; rdfs:subClassOf ex:Agent .
ex:Team     a owl:Class .

ex:name    a owl:DatatypeProperty ; rdfs:domain ex:Agent    ; rdfs:range xsd:string .
ex:badge   a owl:DatatypeProperty ; rdfs:domain ex:Employee ; rdfs:range xsd:string .
ex:hired   a owl:DatatypeProperty ; rdfs:domain ex:Employee ; rdfs:range xsd:date .
ex:teamOf  a owl:ObjectProperty   ; rdfs:domain ex:Employee ; rdfs:range ex:Team .
ex:orphan  a owl:DatatypeProperty ; rdfs:range xsd:string .
ex:shared  a owl:DatatypeProperty ; rdfs:range xsd:string ;
  rdfs:domain [ owl:unionOf ( ex:Employee ex:Team ) ] .
`

const foreign = () => importRdf([{ path: '/tmp/hr.owl.ttl', text: FOREIGN_OWL }])

// @lat: [[importers#What Only OWL Says]]
describe('reading a foreign ontology through rdfs:domain', () => {
  it('places a property on the class its domain names', () => {
    const { model } = foreign()
    expect(node(model, 'Agent')?.props.map((p) => p.name)).toEqual(['name'])
    expect(node(model, 'Employee')?.props.map((p) => p.name).sort())
      .toEqual(['badge', 'hired', 'shared'])
  })

  it('takes the datatype from the range', () => {
    const { model } = foreign()
    expect(node(model, 'Employee')?.props.find((p) => p.name === 'hired')?.type).toBe('date')
  })

  it('reads an object property with a domain and a range as an edge', () => {
    const { model } = foreign()
    expect(edge(model, 'TEAM_OF')).toMatchObject({ from: 'Employee', to: 'Team' })
  })

  it('reports a property no type could claim rather than dropping it', () => {
    const { diagnostics } = foreign()
    const d = diagnostics.find((x) => x.code === 'import-unplaced')
    expect(d?.message).toContain('orphan')
    expect(d?.severity).toBe('warning')
  })

  it('says that an ontology with no shapes carries no constraints', () => {
    expect(codes(foreign().diagnostics)).toContain('import-no-shapes')
  })

  it('never overrides a shape: our own round trip gains nothing from the fallback', () => {
    // This project's OWL asserts no domain, so the property set has to come out the same
    // whether or not the ontology is read alongside the shapes.
    const social = loadFixture('social.lpg.yaml')
    const withOwl = reimport(social, ['shacl', 'owl'])
    const shaclOnly = importRdf([{ path: '/tmp/x.shacl.ttl', text: emit(social, 'shacl').content }])
    // Compare distinct property names, not owners: the hierarchy only OWL carries moves
    // `id` off Person and Company and onto the Party they share, which changes who
    // declares it without introducing or losing a property.
    const names = (m: ModelIR) =>
      [...new Set(m.nodes.flatMap((n) => n.props.map((p) => p.name)))].sort()
    expect(names(withOwl.model)).toEqual(names(shaclOnly.model))
  })
})
