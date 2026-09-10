import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveModel } from '../src/resolve'
import { serializeModel } from '../src/serialize'
import { loadFixture, readFile } from './helpers'
import type { ModelIR } from '../src/ir'

const OUT = join(tmpdir(), 'lpg-serialize-test')
mkdirSync(OUT, { recursive: true })

const FIXTURES = ['social.lpg.yaml', 'features.lpg.yaml', 'composites.lpg.yaml',
  'kinship.lpg.yaml', 'standards.lpg.yaml', 'types.lpg.yaml']
const EXAMPLES = ['social.lpg.yaml', 'fleet.lpg.yaml', 'catalog.lpg.yaml',
  'kinship.lpg.yaml', 'booking.lpg.yaml']

/** Everything but where it came from: paths and offsets differ by construction. */
const semantic = (m: ModelIR): unknown =>
  JSON.parse(JSON.stringify(m, (k, v) => (k === 'loc' || k === 'file' ? undefined : v)))

function roundTrip(label: string, original: ModelIR) {
  const text = serializeModel(original)
  const path = join(OUT, label)
  writeFileSync(path, text)
  const { model: again, diagnostics } = resolveModel(path, readFile)
  const errors = diagnostics.filter((d) => d.severity === 'error')
  expect(errors, `${label}: ${errors.map((e) => e.message).join('; ')}`).toEqual([])
  expect(semantic(again), `${label} semantics`).toEqual(semantic(original))
  expect(serializeModel(again), `${label} idempotence`).toBe(text)
}

// @lat: [[importers#Serializing a Model]]
describe('model serializer', () => {
  for (const name of FIXTURES) {
    it(`round-trips the fixture ${name}`, () => roundTrip(name, loadFixture(name)))
  }

  for (const name of EXAMPLES) {
    it(`round-trips the published example ${name}`, () => {
      const path = join(__dirname, '../../../docs/examples', name)
      const { model, diagnostics } = resolveModel(path, readFile)
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      roundTrip(`example-${name}`, model)
    })
  }

  it('writes a decimal precision into the type, where the parser reads it from', () => {
    const text = serializeModel(loadFixture('types.lpg.yaml'))
    expect(text).toContain('"DECIMAL(18,3)"')
  })

  it('quotes a composite, whose brackets would otherwise end the flow map', () => {
    const text = serializeModel(loadFixture('composites.lpg.yaml'))
    expect(text).toContain('type: "MAP(STRING, STRING)"')
  })

  it('omits an inherited property, which its owner writes', () => {
    const text = serializeModel(loadFixture('social.lpg.yaml'))
    // `id` is declared on Party and reaches Person through it.
    const person = text.slice(text.indexOf('  Person:'))
    expect(person).not.toContain('id: { ')
  })

  it('declares no format version when the model declared none', () => {
    expect(serializeModel(loadFixture('social.lpg.yaml'))).not.toContain('lpg:')
  })
})
