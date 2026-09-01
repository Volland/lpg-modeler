import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCALAR_SPELLING_NAMES, SCALAR_TYPES, canonicalScalar, parsePropertyType } from '../src/ir'
import { emit } from '../src/emit/index'
import { resolveModel } from '../src/resolve'
import { validateModel } from '../src/validate'
import { loadFixture, readFile } from './helpers'

const types = () => loadFixture('types.lpg.yaml')

/** One model with every scalar in it, emitted to a target. */
const out = (target: string) => emit(types(), target)

// @lat: [[metamodel#Scalar Types]]
describe('scalar types', () => {
  it('resolves every spelling in the set to a canonical name', () => {
    for (const name of SCALAR_TYPES) expect(canonicalScalar(name)).toBe(name)
    for (const spelling of SCALAR_SPELLING_NAMES) expect(canonicalScalar(spelling)).toBeDefined()
  })

  it('stores every scalar natively in LadybugDB', () => {
    const ddl = out('ladybug')
    expect(ddl.diagnostics.filter((d) => d.code === 'downgrade-type')).toEqual([])
    for (const column of [
      'tiny INT8', 'small INT16', 'medium INT32', 'big INT64', 'huge INT128',
      'utiny UINT8', 'usmall UINT16', 'umedium UINT32', 'ubig UINT64',
      'ratio FLOAT', 'precise DOUBLE', 'amount DECIMAL(18,3)',
      'day DATE', 'at TIMESTAMP', 'atZoned TIMESTAMP_TZ', 'took INTERVAL',
      'ref UUID', 'raw BLOB', 'payload JSON', 'samples DECIMAL(10,2)[]',
    ]) {
      expect(ddl.content).toContain(column)
    }
  })

  // @lat: [[metamodel#Scalar Types#Parameters]]
  it('carries a decimal\'s precision and scale into every target that spells one', () => {
    expect(parsePropertyType('DECIMAL(18, 3)')).toEqual({ type: 'decimal', precision: 18, scale: 3, list: false })
    expect(out('gql').content).toContain('amount :: DECIMAL(18,3)')
    expect(out('pgschema').content).toContain('amount DECIMAL(18,3)')
    // The element type of a list keeps them too.
    expect(out('gql').content).toContain('samples :: LIST<DECIMAL(10,2)>')
  })

  it('rejects parameters on a type that does not take them', () => {
    const { diagnostics } = resolveModel('/m.lpg.yaml', () =>
      'namespace: { prefix: p, iri: "https://e.org/p#" }\nnodes:\n  A:\n    props:\n      x: { type: STRING(3,1) }\n')
    expect(diagnostics.find((d) => d.code === 'unknown-type')).toBeDefined()
  })

  it('gives every scalar an XSD datatype, reporting only the ones RDF cannot name', () => {
    const shacl = out('shacl')
    for (const datatype of [
      'xsd:byte', 'xsd:short', 'xsd:int', 'xsd:unsignedByte', 'xsd:unsignedLong',
      'xsd:float', 'xsd:double', 'xsd:decimal', 'xsd:duration', 'xsd:base64Binary',
    ]) {
      expect(shacl.content).toContain(datatype)
    }
    // uuid and json remain the only RDF downgrades; a width is not one.
    const downgraded = shacl.diagnostics
      .filter((d) => d.code === 'downgrade-type')
      .map((d) => d.message)
    expect(downgraded).toHaveLength(2)
    expect(downgraded.join(' ')).toMatch(/uuid|json/)
  })

  it('collapses the widths onto one LinkML range and reports what it cannot carry', () => {
    const linkml = out('linkml')
    expect(linkml.content).toContain('range: integer')
    expect(linkml.content).toContain('range: decimal')
    const downgraded = linkml.diagnostics.filter((d) => d.code === 'downgrade-type').map((d) => d.message)
    // duration and blob join uuid and json: LinkML has no range for any of them.
    expect(downgraded).toHaveLength(4)
  })

  it('bounds a decimal and a duration, which are ordered, but not a blob', () => {
    const model = types()
    const reading = model.nodes.find((n) => n.name === 'Reading')!
    const amount = reading.props.find((p) => p.name === 'amount')!
    const raw = reading.props.find((p) => p.name === 'raw')!
    amount.min = 0
    expect(validateModel(model).filter((d) => d.code === 'constraint-type-mismatch')).toEqual([])
    raw.min = 0
    expect(validateModel(model).filter((d) => d.code === 'constraint-type-mismatch')).toHaveLength(1)
  })

  it('offers the same spellings in the contributed JSON Schema as the parser accepts', () => {
    // The schema is what the editor completes from; a spelling missing there reads as
    // an invalid model in an editor that the CLI accepts without complaint.
    const schema = JSON.parse(readFileSync(join(__dirname, '..', 'schemas', 'lpg.schema.json'), 'utf8'))
    const expected = new Set<string>()
    for (const name of SCALAR_SPELLING_NAMES) {
      expected.add(name)
      if (name.includes(' ')) expected.add(name.replace(/ /g, '_'))
    }
    expect(schema.$defs.scalarType.anyOf[0].enum.slice().sort()).toEqual([...expected].sort())
  })

  it('reads every scalar back out of a file written with mixed spellings', () => {
    const { model, diagnostics } = resolveModel(
      join(__dirname, 'fixtures', 'types.lpg.yaml'), readFile)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const declared = new Set(model.nodes[0]!.props.map((p) => p.type))
    for (const scalar of SCALAR_TYPES) expect(declared).toContain(scalar)
  })
})
