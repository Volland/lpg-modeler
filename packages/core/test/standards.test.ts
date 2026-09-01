import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'
import { emit } from '../src/emit/index'
import { resolveModel } from '../src/resolve'
import { validateModel } from '../src/validate'
import { canonicalScalar } from '../src/ir'
import { fixture, readFile, loadFixture } from './helpers'

const social = () => loadFixture('social.lpg.yaml')
const standards = () => loadFixture('standards.lpg.yaml')

// @lat: [[metamodel#Format Version]]
describe('format version', () => {
  it('carries a declared version through to the resolved model', () => {
    expect(standards().formatVersion).toBe('1.0')
  })

  it('reads a file that declares no version, which every model written before it is', () => {
    const model = social()
    expect(model.formatVersion).toBeUndefined()
    expect(validateModel(model).map((d) => d.code)).not.toContain('unsupported-format-version')
  })

  it('warns rather than fails on a version this build does not know', () => {
    const { model } = resolveModel('/m.lpg.yaml', () =>
      'lpg: "9.0"\nnamespace: { prefix: p, iri: "https://e.org/p#" }\n')
    const d = validateModel(model).find((x) => x.code === 'unsupported-format-version')
    expect(d?.severity).toBe('warning')
    expect(d?.message).toContain('9.0')
  })
})

// @lat: [[metamodel#Type Spellings]]
describe('type spellings', () => {
  it('accepts the GQL spelling of every scalar alongside the original', () => {
    const release = standards().nodes.find((n) => n.name === 'Release')!
    const typeOf = (name: string) => release.props.find((p) => p.name === name)!.type
    expect(typeOf('label')).toBe('string')
    expect(typeOf('copies')).toBe('int')
    expect(typeOf('shipped')).toBe('boolean')
    expect(typeOf('pressed')).toBe('zoneddatetime')
  })

  it('ignores case and reads an underscore as a space', () => {
    expect(canonicalScalar('zoned_datetime')).toBe('zoneddatetime')
    expect(canonicalScalar('ZONED DATETIME')).toBe('zoneddatetime')
    expect(canonicalScalar('Int64')).toBe('int')
    expect(canonicalScalar('nonsense')).toBeUndefined()
  })

  // @lat: [[metamodel#Scalar Types]]
  it('separates a zoned timestamp from a naive one', () => {
    // The two are different types in LadybugDB and in GQL, and a model that says
    // 'timestamp' should not silently claim an offset it does not carry.
    expect(canonicalScalar('timestamp')).toBe('datetime')
    expect(canonicalScalar('LOCAL_DATETIME')).toBe('datetime')
    expect(canonicalScalar('TIMESTAMP_TZ')).toBe('zoneddatetime')
  })

  it('names both spellings when a type is unknown', () => {
    const { diagnostics } = resolveModel('/m.lpg.yaml', () =>
      'namespace: { prefix: p, iri: "https://e.org/p#" }\nnodes:\n  A:\n    props:\n      x: { type: money }\n')
    const d = diagnostics.find((x) => x.code === 'unknown-type')!
    expect(d.message).toContain('STRING')
    expect(d.message).toContain('string')
  })
})

// @lat: [[metamodel#Prefixes]]
describe('prefix bindings', () => {
  it('binds a declared prefix in generated RDF, so a CURIE does not dangle', () => {
    expect(standards().prefixes).toEqual({ dct: 'http://purl.org/dc/terms/' })
    expect(emit(standards(), 'shacl').content).toContain('@prefix dct: <http://purl.org/dc/terms/> .')
  })
})

// @lat: [[emitters#GQL Target]]
describe('gql emitter', () => {
  it('carries the hierarchy as implied labels rather than expanding endpoints', () => {
    const out = emit(social(), 'gql').content
    expect(out).toContain('(personType: Person => :Party {')
    // An abstract endpoint stays one edge, unlike the table-per-leaf targets.
    expect(out).toContain('(:Party)-[ownsType: OWNS =>')
    expect(out).not.toContain('(partyType: Party')
  })

  it('marks required, key, and unique properties', () => {
    const out = emit(social(), 'gql').content
    expect(out).toContain('id :: STRING NOT NULL IS NODE KEY')
    expect(out).toContain('email :: STRING NOT NULL IS NODE UNIQUE')
    expect(out).toContain('born :: DATE')
  })

  it('omits the property block of an edge that carries none', () => {
    expect(emit(social(), 'gql').content).toContain('[likesType: LIKES =>]->(:Company)')
  })

  it('separates element types without leaving a trailing comma', () => {
    // Downgrade comments are not list entries, so they must not attract a separator.
    for (const out of [emit(social(), 'gql').content, emit(standards(), 'gql').content]) {
      expect(out).not.toMatch(/,\s*\n\s*\}/)
      expect(out).not.toMatch(/,\s*\n\s*\)/)
      expect(out).not.toMatch(/\/\/[^\n]*,\n/)
    }
  })

  it('reports a composite key, which an element type cannot express', () => {
    const out = emit(standards(), 'gql')
    const d = out.diagnostics.find((x) => x.code === 'downgrade-composite-key')!
    expect(d.severity).toBe('warning')
    expect(d.target).toBe('gql')
    expect(out.content).toContain('// DOWNGRADE: composite key (label, catalogNumber)')
    expect(out.content).not.toContain('IS NODE KEY')
  })

  it('matches the golden file', async () => {
    await expect(emit(social(), 'gql').content).toMatchFileSnapshot('./golden/social.gql.gql')
  })
})

// @lat: [[emitters#PG-Schema Target]]
describe('pg-schema emitter', () => {
  it('keeps abstract types and inheritance rather than flattening them', () => {
    const out = emit(social(), 'pgschema').content
    expect(out).toContain('ABSTRACT (partyType: Party {id STRING})')
    expect(out).toContain('(companyType: partyType & Company')
    expect(out).toContain('(:partyType)-[ownsType: OWNS')
  })

  it('declares a mixin as an abstract type with no label', () => {
    const out = emit(social(), 'pgschema').content
    expect(out).toContain('ABSTRACT (timestampedType {createdAt LOCAL DATETIME})')
    expect(out).toContain('personType: partyType & timestampedType & Person')
  })

  it('marks an optional property and leaves a required one bare', () => {
    expect(emit(social(), 'pgschema').content).toContain('{email STRING, OPTIONAL born DATE}')
  })

  it('states a key once, on the type that owns it', () => {
    const out = emit(social(), 'pgschema').content
    expect(out).toContain('FOR (x: partyType) EXCLUSIVE MANDATORY SINGLETON x.id')
    expect(out).not.toContain('FOR (x: personType) EXCLUSIVE MANDATORY')
    expect(out).toContain('FOR (x: personType) EXCLUSIVE SINGLETON x.email')
  })

  it('expresses a composite key natively', () => {
    const out = emit(standards(), 'pgschema')
    expect(out.content).toContain(
      'FOR (x: releaseType) EXCLUSIVE MANDATORY SINGLETON (x.label, x.catalogNumber)')
    expect(out.diagnostics).toEqual([])
  })

  it('matches the golden file', async () => {
    await expect(emit(social(), 'pgschema').content)
      .toMatchFileSnapshot('./golden/social.pgschema.pgs')
  })
})

// @lat: [[emitters#LinkML Target]]
describe('linkml emitter', () => {
  const doc = () => parse(emit(social(), 'linkml').content)

  it('emits a schema a LinkML tool can read', () => {
    const d = doc()
    expect(d.id).toBe('https://example.org/vocab/social')
    expect(d.imports).toContain('linkml:types')
    expect(d.prefixes.social).toBe('https://example.org/vocab/social#')
  })

  it('maps the hierarchy onto is_a and mixins', () => {
    const d = doc()
    expect(d.classes.Party.abstract).toBe(true)
    expect(d.classes.Person.is_a).toBe('Party')
    expect(d.classes.Person.mixins).toEqual(['Timestamped'])
    expect(d.classes.Timestamped.mixin).toBe(true)
  })

  it('keeps the IRI of every class and slot, so identity survives the round trip', () => {
    const d = doc()
    expect(d.classes.Person.class_uri).toBe('social:Person')
    expect(d.classes.Person.attributes.email.slot_uri).toBe('social:email')
  })

  it('declares a single key as an identifier and inherits it rather than restating it', () => {
    const d = doc()
    expect(d.classes.Party.attributes.id.identifier).toBe(true)
    expect(d.classes.Person.attributes.id).toBeUndefined()
  })

  it('expresses uniqueness and a composite key through unique_keys', () => {
    expect(doc().classes.Person.unique_keys.email_key.unique_key_slots).toEqual(['email'])
    const release = parse(emit(standards(), 'linkml').content).classes.Release
    expect(release.unique_keys.primary_key.unique_key_slots).toEqual(['label', 'catalogNumber'])
  })

  it('leaves a property-free edge a plain slot and reifies one that carries properties', () => {
    const d = doc()
    expect(d.classes.Person.attributes.likes).toMatchObject({
      range: 'Company', multivalued: true,
    })
    expect(d.classes.Owns.attributes).toMatchObject({
      ownsSubject: { range: 'Party' }, ownsObject: { range: 'Car' },
    })
    const codes = emit(social(), 'linkml').diagnostics.map((x) => x.code)
    expect(codes).toContain('downgrade-edge-props')
  })

  it('matches the golden file', async () => {
    await expect(emit(social(), 'linkml').content)
      .toMatchFileSnapshot('./golden/social.linkml.yaml')
  })
})
