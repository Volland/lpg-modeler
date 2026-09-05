import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SCALAR_SPELLING_NAMES, SCALAR_TYPES, canonicalScalar, formatValueType, parsePropertyType,
} from '../src/ir'
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

const composites = () => loadFixture('composites.lpg.yaml')

/** The composite model emitted to a target. */
const comp = (target: string) => emit(composites(), target)

/** Resolve a one-property model, so a bad type can be checked without a fixture. */
const withType = (written: string) => resolveModel('/m.lpg.yaml', () =>
  `namespace: { prefix: p, iri: "https://e.org/p#" }\nnodes:\n  A:\n    key: [k]\n    props:\n      k: { type: string }\n      x: { type: "${written}" }\n`)

// @lat: [[metamodel#Composite Types]]
describe('composite types', () => {
  it('reads a struct, a map, a union and a fixed-size array, in either spelling', () => {
    const props = composites().nodes[0]!.props
    const written = (name: string) => formatValueType(props.find((p) => p.name === name)!.composite!)
    expect(written('embedding')).toBe('float[128]')
    // ARRAY<UINT8, 3> and UINT8[3] are one type, so both read back as the bracket form.
    expect(written('rgb')).toBe('uint8[3]')
    expect(written('location')).toBe('STRUCT(lat float, lon float, label string)')
    expect(written('tags')).toBe('MAP(string, string)')
    expect(written('reading')).toBe('UNION(num float, text string)')
  })

  it('nests composites in both directions', () => {
    const props = composites().nodes[0]!.props
    const written = (name: string) => formatValueType(props.find((p) => p.name === name)!.composite!)
    // A list of structs, one of whose fields is itself a list.
    expect(written('history')).toBe('STRUCT(at datetime, values float[])[]')
    // A list of lists is composite too: it is not a list of scalars.
    expect(written('grid')).toBe('int[][]')
  })

  it('leaves a scalar and a list of scalars alone, which carry no composite', () => {
    expect(parsePropertyType('STRING')).toEqual({ type: 'string', list: false })
    expect(parsePropertyType('STRING[]')).toEqual({ type: 'string', list: true })
    expect(parsePropertyType('LIST<STRING>')).toEqual({ type: 'string', list: true })
  })

  // @lat: [[emitters#Composite Types]]
  it('spells every composite out whole in LadybugDB, downgrading nothing', () => {
    const ddl = comp('ladybug')
    expect(ddl.diagnostics.filter((d) => d.code === 'downgrade-composite')).toEqual([])
    for (const column of [
      'embedding DOUBLE[128]',
      'rgb UINT8[3]',
      'location STRUCT(lat DOUBLE, lon DOUBLE, label STRING)',
      'tags MAP(STRING, STRING)',
      'reading UNION(num DOUBLE, text STRING)',
      'history STRUCT(at TIMESTAMP, values DOUBLE[])[]',
      'grid INT64[][]',
      'offsets MAP(STRING, DECIMAL(10,2))',
    ]) {
      expect(ddl.content).toContain(column)
    }
  })

  // @lat: [[emitters#Composite Types]]
  it('reports a downgrade on every other target, once per composite property', () => {
    // Seven on the node plus one on the edge: no target but ladybug has any of them.
    for (const target of ['gql', 'pgschema', 'linkml', 'neo4j', 'shacl', 'owl']) {
      const downgraded = comp(target).diagnostics.filter((d) => d.code === 'downgrade-composite')
      // OWL declares one datatype property per name across the model, and the edge is
      // reified rather than given a column, so only the node's seven reach it.
      expect(downgraded.length, target).toBeGreaterThanOrEqual(7)
      expect(downgraded.every((d) => d.severity === 'warning'), target).toBe(true)
    }
  })

  it('keeps the element scalar and the list marker where a target has one', () => {
    // A fixed-size array degrades to a plain list of the same scalar; the size is what
    // is lost, and it is the downgrade that says so.
    expect(comp('gql').content).toContain('rgb :: LIST<UINT8>')
    expect(comp('linkml').content).toContain('multivalued: true')
    // A struct has no element scalar at all, so it keeps `json` — a string in GQL.
    expect(comp('gql').content).toContain('location :: STRING')
  })

  it('names the type as written rather than the scalar it degrades to', () => {
    const message = comp('shacl').diagnostics
      .find((d) => d.code === 'downgrade-composite' && d.message.includes("'Sensor.location'"))!.message
    expect(message).toContain('STRUCT(lat float, lon float, label string)')
  })

  it('rejects a composite key, which identifies no more than a list does', () => {
    const { model } = resolveModel('/m.lpg.yaml', () =>
      'namespace: { prefix: p, iri: "https://e.org/p#" }\nnodes:\n  A:\n    key: [x]\n    props:\n      x: { type: "STRUCT(a INT64)" }\n')
    expect(validateModel(model).map((d) => d.code)).toContain('composite-key-property')
  })

  it('rejects a struct with two fields of one name, and a map keyed by a struct', () => {
    const dup = withType('STRUCT(a INT64, a STRING)')
    expect(validateModel(dup.model).map((d) => d.code)).toContain('duplicate-type-field')
    const badKey = withType('MAP(STRUCT(a INT64), STRING)')
    expect(validateModel(badKey.model).map((d) => d.code)).toContain('composite-map-key')
  })

  it('rejects a composite whose syntax does not close', () => {
    for (const written of ['STRUCT(a INT64', 'MAP(STRING)', 'UNION()', 'ARRAY<INT64>']) {
      const { diagnostics } = withType(written)
      expect(diagnostics.find((d) => d.code === 'unknown-type'), written).toBeDefined()
    }
  })

  it('offers the composite forms in the contributed JSON Schema', () => {
    const schema = JSON.parse(readFileSync(join(__dirname, '..', 'schemas', 'lpg.schema.json'), 'utf8'))
    const patterns = schema.$defs.scalarType.anyOf
      .filter((b: { pattern?: string }) => b.pattern !== undefined)
      .map((b: { pattern: string }) => new RegExp(b.pattern))
    const accepted = (written: string) => patterns.some((r: RegExp) => r.test(written))
    for (const written of [
      'STRUCT(lat DOUBLE, lon DOUBLE)', 'MAP(STRING, INT64)', 'UNION(a INT64, b STRING)',
      'ARRAY<FLOAT, 128>', 'FLOAT[128]', 'STRUCT(at TIMESTAMP)[]',
    ]) {
      expect(accepted(written), written).toBe(true)
    }
  })
})
