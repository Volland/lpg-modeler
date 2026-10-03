import { describe, expect, it } from 'vitest'
import { emit } from '../src/emit/index'
import { resolveModel } from '../src/resolve'
import { loadFixture } from './helpers'

const social = () => loadFixture('social.lpg.yaml')
const features = () => loadFixture('features.lpg.yaml')

// @lat: [[emitters#Context Target]]
describe('context target', () => {
  it('matches the golden file', async () => {
    await expect(emit(social(), 'context').content)
      .toMatchFileSnapshot('./golden/social.context.md')
  })

  it('is deterministic', () => {
    expect(emit(social(), 'context').content).toBe(emit(social(), 'context').content)
  })

  it('reports nothing: a card carries everything', () => {
    expect(emit(features(), 'context').diagnostics).toEqual([])
  })

  it('puts every element on the card', () => {
    const out = emit(features(), 'context').content
    for (const needle of [
      '**Driver**', '(open)', 'key: licence', 'nicknames: string[]', 'status: string =Status',
      '**Vehicle**', '**DRIVES**', 'Driver → Vehicle', 'many-to-one',
      '**Status**: active | retired',
    ]) expect(out).toContain(needle)
  })

  it('writes hierarchy, mixins and marks in one line per type', () => {
    const out = emit(social(), 'context').content
    expect(out).toContain('- **Person** < Party +Timestamped key: id (from Party) — email!^: string, born: date')
  })

  it('carries a raw SHACL fragment verbatim, with no downgrade', () => {
    const { model } = resolveModel('/m.lpg.yaml', () =>
      'namespace: { prefix: p, iri: "https://e.org/p#" }\n'
      + 'nodes:\n  A:\n    key: [x]\n    props:\n      x: { type: string, required: true }\n'
      + '    shacl: |\n      sh:closed true ;\n')
    const { content, diagnostics } = emit(model, 'context')
    expect(content).toContain('sh:closed true ;')
    expect(diagnostics).toEqual([])
  })
})
