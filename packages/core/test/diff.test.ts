import { describe, it, expect } from 'vitest'
import { diffModels } from '../src/migrate/diff'
import { atLeast, classify, strongest } from '../src/migrate/classify'
import type { Change } from '../src/migrate/types'
import { BASE, PAIRS, pairModels, resolveText } from './migrate-pairs'

const changesOf = (name: string): Change[] => {
  const { before, after } = pairModels(name)
  return diffModels(before, after)
}

/** Kind, element, label and class: what a reader and a gate each look at. */
const brief = (cs: Change[]) => cs.map((c) => `${c.class} ${c.kind} ${c.label}`)

// @lat: [[emitters#Migrations#Change Classification]]
describe('diff by element id', () => {
  it('finds nothing between a model and itself', () => {
    expect(diffModels(resolveText(BASE), resolveText(BASE))).toEqual([])
  })

  it('finds at least one change for every migration pair', () => {
    for (const p of PAIRS) expect(changesOf(p.name).length, p.name).toBeGreaterThan(0)
  })

  it('reports a renamed node type as one rename, not a removal and an addition', () => {
    expect(brief(changesOf('rename-node-type'))).toEqual(['breaking renamed node Individual'])
  })

  it('reports a renamed property and a renamed edge type as renames', () => {
    expect(brief(changesOf('rename-property'))).toEqual(['breaking renamed property Person.mail'])
    expect(brief(changesOf('rename-edge'))).toEqual(['breaking renamed edge ACQUAINTED'])
  })

  it('reports a hand-replaced id as the old property removed and a new one added', () => {
    expect(brief(changesOf('replace-id'))).toEqual([
      'destructive removed property Person.nickname',
      'additive added property Person.nickname',
    ])
  })

  it('reports a property moved to an ancestor as a move, with no change to the concrete type', () => {
    expect(brief(changesOf('move-to-ancestor'))).toEqual(['additive moved property Asset.seats'])
  })

  it('reports a mixin moved to a parent by what each type gains or keeps', () => {
    expect(brief(changesOf('mixin-on-parent'))).toEqual([
      'additive mixins-changed node Party',
      'additive mixins-changed node Person',
    ])
  })

  it('names the before and after of what changed', () => {
    const [c] = changesOf('change-cardinality')
    expect(c?.detail).toBe('cardinality changed from one-to-many to many-to-many')
    expect(changesOf('rename-property')[0]?.detail).toBe("renamed from 'email'")
  })
})

// @lat: [[emitters#Migrations#Change Classification]]
describe('change classification', () => {
  const classes = (name: string) => [...new Set(changesOf(name).map((c) => c.class))].sort()

  it('classifies an added optional property, an added type and a relaxed bound as additive', () => {
    expect(classes('add-optional-property')).toEqual(['additive'])
    expect(classes('add-node-type')).toEqual(['additive'])
    expect(classes('add-subtype')).toEqual(['additive'])
    expect(classes('change-cardinality')).toEqual(['additive'])
    expect(classes('drop-uniqueness')).toEqual(['additive'])
  })

  it('classifies what may invalidate existing data or queries as breaking', () => {
    for (const name of ['add-required-property', 'make-required', 'add-unique', 'change-key',
      'retype-property', 'change-endpoints', 'value-pattern']) {
      expect(classes(name), name).toEqual(['breaking'])
    }
  })

  it('classifies a removed property, type or enum value as destructive', () => {
    expect(classes('remove-property')).toEqual(['destructive'])
    expect(classes('remove-node-type')).toEqual(['destructive'])
    expect(classes('remove-enum-value')).toEqual(['destructive'])
  })

  it('lets losing data win, fixes a rename as breaking, and treats an unknown direction as breaking', () => {
    expect(classify('renamed', 'loosens')).toBe('breaking')
    expect(classify('renamed', 'loses-data')).toBe('destructive')
    expect(classify('moved', 'unknown')).toBe('additive')
    expect(classify('retyped', 'unknown')).toBe('breaking')
    expect(classify('required-changed', 'loosens')).toBe('additive')
  })

  it('orders classes and directions by severity', () => {
    expect(atLeast('destructive', 'breaking')).toBe(true)
    expect(atLeast('additive', 'breaking')).toBe(false)
    expect(strongest(['loosens', 'tightens'])).toBe('tightens')
    expect(strongest(['tightens', 'loses-data', 'unknown'])).toBe('loses-data')
    expect(strongest([])).toBe('loosens')
  })
})
