import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'
import { capabilitiesOf, emit } from '../src/emit/index'
import { resolveModel } from '../src/resolve'
import { validateModel } from '../src/validate'
import {
  canonicalCardinality, describeCardinality, formatBound, parseBound, parsePropertyType,
} from '../src/ir'
import { fixture, readFile, loadFixture } from './helpers'

const features = () => loadFixture('features.lpg.yaml')
const codes = (ds: { code: string }[]) => ds.map((d) => d.code)

/** Resolve a model written inline, for the cases no fixture should carry. */
const inline = (body: string) =>
  resolveModel('/m.lpg.yaml', () =>
    `namespace: { prefix: p, iri: "https://e.org/p#" }\n${body}`)

// @lat: [[metamodel#Lists]]
describe('list properties', () => {
  it('accepts every spelling of a list type', () => {
    expect(parsePropertyType('LIST<STRING>')).toEqual({ type: 'string', list: true })
    expect(parsePropertyType('STRING[]')).toEqual({ type: 'string', list: true })
    // GQL spells a list of non-null elements this way; element nullability is not
    // something this metamodel carries, so it is read as a plain list.
    expect(parsePropertyType('LIST<STRING NOT NULL>')).toEqual({ type: 'string', list: true })
    expect(parsePropertyType('string')).toEqual({ type: 'string', list: false })
    expect(parsePropertyType('LIST<nonsense>')).toBeUndefined()
  })

  it('reads LIST<…> and list: true as the same thing', () => {
    const driver = features().nodes.find((n) => n.name === 'Driver')!
    const vehicle = features().nodes.find((n) => n.name === 'Vehicle')!
    expect(driver.props.find((p) => p.name === 'nicknames')!.list).toBe(true)
    expect(vehicle.props.find((p) => p.name === 'tags')!.list).toBe(true)
    expect(driver.props.find((p) => p.name === 'licence')!.list).toBe(false)
  })

  it('refuses a list as part of a key, which cannot identify one node', () => {
    const { model } = inline(
      'nodes:\n  A:\n    key: [xs]\n    props:\n      xs: { type: LIST<STRING> }\n')
    expect(codes(validateModel(model))).toContain('list-key')
  })
})

// @lat: [[metamodel#Enums]]
describe('enums', () => {
  it('resolves an enum and the property that references it', () => {
    const model = features()
    expect(model.enums.map((e) => e.name)).toEqual(['Status'])
    expect(model.enums[0]!.values).toEqual(['active', 'retired'])
    expect(model.enums[0]!.iri).toBe('https://example.org/vocab/fleet#Status')
    const status = model.nodes.find((n) => n.name === 'Driver')!
      .props.find((p) => p.name === 'status')!
    expect(status.enum).toBe('Status')
    expect(validateModel(model)).toEqual([])
  })

  it('reports a reference to an enum that is not declared', () => {
    const { model } = inline(
      'nodes:\n  A:\n    key: [x]\n    props:\n      x: { type: string, enum: Nope }\n')
    expect(codes(validateModel(model))).toContain('unresolved-enum')
  })

  it('reports an enum on a property that is not a string', () => {
    const { model } = inline(
      'enums:\n  S: { values: [a] }\nnodes:\n  A:\n    key: [x]\n'
      + '    props:\n      x: { type: string }\n      n: { type: int, enum: S }\n')
    expect(codes(validateModel(model))).toContain('enum-type-mismatch')
  })

  it('reports an enum with no values and one with a repeated value', () => {
    const empty = inline('enums:\n  S: { values: [] }\n')
    expect(codes(empty.diagnostics)).toContain('empty-enum')
    const dup = inline('enums:\n  S: { values: [a, a] }\n')
    expect(codes(validateModel(dup.model))).toContain('duplicate-enum-value')
  })
})

// @lat: [[metamodel#Open and Closed Types]]
describe('open and closed types', () => {
  it('is closed unless the type says otherwise, and never inherits openness', () => {
    const model = features()
    expect(model.nodes.find((n) => n.name === 'Driver')!.open).toBe(true)
    expect(model.nodes.find((n) => n.name === 'Vehicle')!.open).toBe(false)
    const { model: sub } = inline(
      'nodes:\n  P:\n    abstract: true\n    open: true\n    key: [id]\n'
      + '    props:\n      id: { type: string }\n  C:\n    extends: P\n')
    expect(sub.nodes.find((n) => n.name === 'C')!.open).toBe(false)
  })
})

// @lat: [[metamodel#Cardinality]]
describe('cardinality', () => {
  it('defaults to unbounded at both ends', () => {
    const { model } = inline(
      'nodes:\n  A: { key: [x], props: { x: { type: string } } }\n'
      + 'edges:\n  R: { from: A, to: A }\n')
    expect(model.edges[0]!.cardinality).toEqual({
      from: { min: 0, max: null }, to: { min: 0, max: null },
    })
  })

  it('reads the named forms, including the LadybugDB spellings', () => {
    expect(canonicalCardinality('MANY_ONE')).toEqual({
      from: { min: 0, max: null }, to: { min: 0, max: 1 },
    })
    expect(canonicalCardinality('One_To_Many')).toEqual({
      from: { min: 0, max: 1 }, to: { min: 0, max: null },
    })
    expect(canonicalCardinality('some')).toBeUndefined()
    expect(features().edges[0]!.cardinality).toEqual(
      { from: { min: 0, max: null }, to: { min: 0, max: 1 } })
  })

  it('reads an endpoint bound in every spelling', () => {
    expect(parseBound('*')).toEqual({ min: 0, max: null })
    expect(parseBound('2')).toEqual({ min: 2, max: 2 })
    expect(parseBound('1..2')).toEqual({ min: 1, max: 2 })
    expect(parseBound('1..*')).toEqual({ min: 1, max: null })
    expect(parseBound('two')).toBeUndefined()
  })

  it('round-trips a bound through its display form', () => {
    for (const w of ['*', '2', '1..2', '1..*']) {
      expect(formatBound(parseBound(w)!)).toBe(w)
    }
  })

  it('names a multiplicity by its named form when one fits, else by its bounds', () => {
    expect(describeCardinality(canonicalCardinality('many-to-one')!)).toBe('many-to-one')
    expect(describeCardinality({ from: { min: 0, max: null }, to: { min: 2, max: 2 } }))
      .toBe('*-to-2')
  })

  it('reads an exact bound the named forms cannot express', () => {
    const parent = loadFixture('kinship.lpg.yaml').edges.find((e) => e.name === 'HAS_PARENT')!
    expect(parent.cardinality.to).toEqual({ min: 2, max: 2 })
    expect(parent.cardinality.from).toEqual({ min: 0, max: null })
  })

  it('reports a multiplicity it does not know', () => {
    const { diagnostics } = inline(
      'nodes:\n  A: { key: [x], props: { x: { type: string } } }\n'
      + 'edges:\n  R: { from: A, to: A, cardinality: several }\n')
    expect(codes(diagnostics)).toContain('unknown-cardinality')
  })

  it('reports a bound that is not a multiplicity, and one nothing can satisfy', () => {
    const bad = inline(
      'nodes:\n  A: { key: [x], props: { x: { type: string } } }\n'
      + 'edges:\n  R: { from: A, to: A, cardinality: { to: "lots" } }\n')
    expect(codes(bad.diagnostics)).toContain('unknown-cardinality')
    const impossible = inline(
      'nodes:\n  A: { key: [x], props: { x: { type: string } } }\n'
      + 'edges:\n  R: { from: A, to: A, cardinality: { to: "3..1" } }\n')
    expect(codes(impossible.diagnostics)).toContain('impossible-cardinality')
  })
})

describe('targets carry the additions or report them', () => {
  it('never claims more cardinality than a target can hold', () => {
    // LadybugDB's multiplicity keyword carries only an upper bound of one, so rounding
    // this up to 'enforced' would be the overstatement the matrix exists to prevent.
    expect(capabilitiesOf('ladybug')!.cardinality).toBe('upper-bound-only')
    expect(capabilitiesOf('shacl')!.cardinality).toBe('enforced')
    expect(capabilitiesOf('neo4j')!.cardinality).toBe('unsupported')
  })

  it('shacl enforces an exact count that no database target can', () => {
    const out = emit(loadFixture('kinship.lpg.yaml'), 'shacl').content
    const person = out.slice(out.indexOf('kin:PersonShape'))
    expect(person).toContain('sh:path kin:hasParent ;')
    expect(person).toContain('sh:minCount 2 ;')
    expect(person).toContain('sh:maxCount 2 ;')
  })

  it('ladybug emits the strongest keyword available and reports the rest', () => {
    const out = emit(loadFixture('kinship.lpg.yaml'), 'ladybug')
    // An exact count of two has no keyword, so nothing is claimed for it.
    const parent = out.content.slice(out.content.indexOf('HAS_PARENT'))
    expect(parent.slice(0, parent.indexOf(');'))).not.toContain('MANY_ONE')
    expect(parent).toContain("UNENFORCED: a minimum of 2 on 'to'")
    // A bound of one on the 'from' end does have a keyword, so it is emitted.
    expect(out.content).toContain('ONE_MANY')
    expect(codes(out.diagnostics)).toContain('downgrade-cardinality')
  })

  it('never leaves a separator before a closing parenthesis', () => {
    // A comment is not an entry, so it must not be where the comma is stripped.
    const out = emit(loadFixture('kinship.lpg.yaml'), 'ladybug').content
    expect(out).not.toMatch(/,\s*\n(\s*\/\/[^\n]*\n)*\s*\)/)
  })

  // @lat: [[emitters#Ladybug Target]]
  it('ladybug emits a list column and the multiplicity keyword', () => {
    const out = emit(features(), 'ladybug')
    expect(out.content).toContain('nicknames STRING[]')
    expect(out.content).toContain('MANY_ONE')
    // Open types and enums have nowhere to go in a mandatory closed schema.
    expect(codes(out.diagnostics)).toEqual(
      expect.arrayContaining(['downgrade-open', 'downgrade-enum']))
  })

  // @lat: [[emitters#RDF Targets#SHACL Shapes]]
  it('shacl closes a closed type, opens an open one, and bounds cardinality', () => {
    const out = emit(features(), 'shacl').content
    const vehicle = out.slice(out.indexOf('fleet:VehicleShape'))
    expect(vehicle).toContain('sh:closed true ;')
    expect(vehicle).toContain('sh:ignoredProperties ( rdf:type ) ;')
    const driver = out.slice(out.indexOf('fleet:DriverShape'), out.indexOf('fleet:VehicleShape'))
    expect(driver).not.toContain('sh:closed')
    // many-to-one bounds the forward direction on the source shape.
    expect(driver).toContain('sh:path fleet:drives ;')
    expect(driver).toContain('sh:maxCount 1 ;')
    // A list property is exactly the one that may hold more than one value.
    expect(driver).toMatch(/sh:path fleet:nicknames ;\n\s+sh:datatype xsd:string ;\n\s+\] ;/)
    expect(driver).toContain('sh:in ( "active" "retired" ) ;')
  })

  it('shacl bounds the reverse direction with an inverse path', () => {
    const { model } = inline(
      'nodes:\n  A: { key: [x], props: { x: { type: string } } }\n'
      + '  B: { key: [y], props: { y: { type: string } } }\n'
      + 'edges:\n  R: { from: A, to: B, cardinality: one-to-many }\n')
    const out = emit(model, 'shacl').content
    const b = out.slice(out.indexOf('p:BShape'))
    expect(b).toContain('sh:path [ sh:inversePath p:r ] ;')
    expect(b).toContain('sh:maxCount 1 ;')
  })

  // @lat: [[emitters#RDF Targets#OWL Subset]]
  it('owl emits an enum as a datatype definition and uses it as the range', () => {
    const out = emit(features(), 'owl')
    expect(out.content).toContain('fleet:Status a rdfs:Datatype ;')
    expect(out.content).toContain('owl:oneOf ( "active" "retired" )')
    expect(out.content).toContain('rdfs:range fleet:Status .')
    // Cardinality stays out of the ontology on purpose, and says so.
    expect(codes(out.diagnostics)).toContain('downgrade-cardinality')
  })

  // @lat: [[emitters#PG-Schema Target]]
  it('pgschema carries OPEN and a list type natively', () => {
    const out = emit(features(), 'pgschema')
    expect(out.content).toContain('OPTIONAL nicknames LIST<STRING>')
    expect(out.content).toContain('OPEN}')
    expect(codes(out.diagnostics)).toEqual(
      expect.arrayContaining(['downgrade-enum', 'downgrade-cardinality']))
  })

  // @lat: [[emitters#GQL Target]]
  it('gql carries a list type and reports what an element type cannot say', () => {
    const out = emit(features(), 'gql')
    expect(out.content).toContain('nicknames :: LIST<STRING>')
    expect(codes(out.diagnostics)).toEqual(
      expect.arrayContaining(['downgrade-open', 'downgrade-enum', 'downgrade-cardinality']))
  })

  // @lat: [[emitters#LinkML Target]]
  it('linkml carries enums, lists and cardinality natively', () => {
    const out = emit(features(), 'linkml')
    const doc = parse(out.content)
    expect(doc.enums.Status.permissible_values).toHaveProperty('active')
    expect(doc.classes.Driver.attributes.status.range).toBe('Status')
    expect(doc.classes.Driver.attributes.nicknames.multivalued).toBe(true)
    // many-to-one means the target end holds at most one, which is a single-valued slot.
    const { model } = inline(
      'nodes:\n  A: { key: [x], props: { x: { type: string } } }\n'
      + '  B: { key: [y], props: { y: { type: string } } }\n'
      + 'edges:\n  R: { from: A, to: B, cardinality: many-to-one }\n')
    expect(parse(emit(model, 'linkml').content).classes.A.attributes.r.multivalued).toBe(false)
    expect(codes(out.diagnostics)).toContain('downgrade-open')
  })

  // @lat: [[emitters#Neo4j Target]]
  it('neo4j reports the enum and the cardinality it cannot enforce', () => {
    const out = emit(features(), 'neo4j')
    expect(codes(out.diagnostics)).toEqual(
      expect.arrayContaining(['downgrade-enum', 'downgrade-cardinality']))
  })
})

// @lat: [[metamodel#Type Hierarchy#Mixins]]
describe('inheritance and mixins', () => {
  const social = () => loadFixture('social.lpg.yaml')

  it('flattens a parent\'s properties and a mixin\'s onto the type, naming each source', () => {
    const person = social().nodes.find((n) => n.name === 'Person')!
    const by = (name: string) => person.props.find((p) => p.name === name)!
    expect(by('email').inheritedFrom).toBeUndefined()
    expect(by('id').inheritedFrom).toBe('Party')            // the abstract parent
    expect(by('createdAt').inheritedFrom).toBe('Timestamped')  // the mixin
    // A mixin is a bag of properties, not a supertype: it never becomes an ancestor.
    expect(person.ancestors).toEqual(['Party'])
    expect(person.mixins).toEqual(['Timestamped'])
    // The key comes down the inheritance chain; a mixin cannot carry one.
    expect(person.key).toEqual(['id'])
    expect(person.keyInheritedFrom).toBe('Party')
  })

  it('generates every inherited and mixed-in property into every target', () => {
    // The whole point of declaring a property once: it has to reach the schema of each
    // type that has it, whichever target is asked for.
    const model = social()
    for (const target of ['gql', 'ladybug', 'linkml', 'neo4j', 'owl', 'pgschema', 'shacl']) {
      const { content, diagnostics } = emit(model, target)
      expect(diagnostics.filter((d) => d.severity === 'error'), target).toEqual([])
      expect(content, `${target} carries the mixin property`).toMatch(/createdAt/)
      // Targets with no inheritance copy the parent's property down; the ones that have
      // it declare the parent instead. Either way the property is reachable.
      expect(content, `${target} carries the inherited key property`).toMatch(/\bid\b/)
    }
  })

  it('expands an edge on an abstract endpoint to every concrete descendant', () => {
    // OWNS is declared Party -> Car, and Party is abstract. A target with no
    // inheritance has to name the leaves. See lat.md/emitters#Ladybug Target.
    const ddl = emit(social(), 'ladybug').content
    expect(ddl).toMatch(/FROM Person TO Car/)
    expect(ddl).toMatch(/FROM Company TO Car/)
    expect(ddl).not.toMatch(/FROM Party TO Car/)
  })

  it('reports a mixin no type applies, and one a type overrides', () => {
    const { model } = inline([
      'mixins:',
      '  Stamped:',
      '    props: { createdAt: { type: datetime } }',
      '  Unused:',
      '    props: { spare: { type: string } }',
      'nodes:',
      '  Thing:',
      '    key: [id]',
      '    mixins: [Stamped]',
      '    props:',
      '      id: { type: string }',
      '      createdAt: { type: date }',
    ].join('\n'))
    const found = codes(validateModel(model))
    // A mixin nothing applies reaches no artifact, and the type's own declaration wins
    // over the mixin's -- both true silently, so both are said.
    expect(found).toContain('unused-mixin')
    expect(found).toContain('shadowed-mixin-property')
    const thing = model.nodes.find((n) => n.name === 'Thing')!
    expect(thing.props.find((p) => p.name === 'createdAt')!.type).toBe('date')
  })
})
