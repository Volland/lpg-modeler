import { describe, expect, it } from 'vitest'
import { emit } from '../src/emit/index'
import { loadFixture } from './helpers'

const social = () => emit(loadFixture('social.lpg.yaml'), 'docs')
const features = () => emit(loadFixture('features.lpg.yaml'), 'docs')

// @lat: [[emitters#Docs Target]]
describe('docs target', () => {
  it('matches the golden file', async () => {
    await expect(social().content).toMatchFileSnapshot('./golden/social.docs.html')
  })

  it('fetches nothing from anywhere', () => {
    // The page gets committed and served from places the author does not control, so
    // it adopts the documentation site's rule: no cross-origin subresource, ever.
    expect(social().content).not.toMatch(/(src|href)=["']https?:/i)
    expect(features().content).not.toMatch(/(src|href)=["']https?:/i)
  })

  it('anchors every element and links each from the table of contents', () => {
    const out = social().content
    for (const id of ['t-Party', 't-Person', 't-Company', 't-Car', 'e-OWNS', 'e-KNOWS', 'e-LIKES', 'm-Timestamped']) {
      expect(out).toContain(`id="${id}"`)
      expect(out).toContain(`href="#${id}"`)
    }
  })

  it('marks inherited and mixin properties with their source', () => {
    const out = social().content
    expect(out).toContain('↑ <a href="#t-Party">Party</a>')
    expect(out).toContain('◇ Timestamped')
  })

  it('lists an inherited edge on the descendant, naming the declaring type', () => {
    const out = social().content
    // OWNS is declared on Party; Person's section lists it as declared elsewhere.
    const start = out.indexOf('id="t-Person"')
    const person = out.slice(start, out.indexOf('</section>', start))
    expect(person).toContain('OWNS')
    expect(person).toContain('declared on Party')
  })

  // @lat: [[emitters#Docs Target#Enforcement matrix]]
  it('shows one matrix row per feature the model uses, and none it does not', () => {
    const out = features().content
    for (const row of ['Enums', 'List properties', 'Open types', 'Cardinality', 'Edge properties']) {
      expect(out).toContain(`<td>${row}</td>`)
    }
    expect(out).not.toContain('<td>Named constraints</td>')
    expect(out).not.toContain('<td>Composite key</td>')
    // The cells come from the targets' own capability sets.
    expect(out).toContain('ladybug')
    expect(out).toContain('reported, not carried')
  })

  it('reports nothing: the page carries everything', () => {
    expect(features().diagnostics).toEqual([])
  })
})
