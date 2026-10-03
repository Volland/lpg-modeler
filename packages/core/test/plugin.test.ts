import { describe, expect, it } from 'vitest'
import { emit, isPluginTarget, registerTarget, targetNames } from '../src/emit/index'
import { importModel, isPluginImporter, registerImporter } from '../src/import/index'
import { LADYBUG_CAPABILITIES } from '../src/emit/ladybug'
import { loadFixture } from './helpers'

const okTarget = { capabilities: { ...LADYBUG_CAPABILITIES, target: 'plugin-ok' }, emit: () => ({ target: 'plugin-ok', extension: 'txt', content: 'x', diagnostics: [] }) }

// @lat: [[architecture#Modularity#Plugins]]
describe('plugin registration', () => {
  it('adds a target that emits through the same path as a built-in', () => {
    registerTarget('plugin-ok', okTarget, { plugin: true })
    expect(targetNames()).toContain('plugin-ok')
    expect(isPluginTarget('plugin-ok')).toBe(true)
    expect(isPluginTarget('ladybug')).toBe(false)
    expect(emit(loadFixture('social.lpg.yaml'), 'plugin-ok').content).toBe('x')
  })

  it('refuses a target without a complete capability set, naming what is missing', () => {
    const { requiredConstraint: _r, cardinality: _c, ...partial } = LADYBUG_CAPABILITIES
    expect(() => registerTarget('plugin-partial', { ...okTarget, capabilities: partial as never }))
      .toThrow(/missing: requiredConstraint, cardinality/)
    expect(targetNames()).not.toContain('plugin-partial')
  })

  it('refuses to replace a built-in target or importer, and a bad name', () => {
    expect(() => registerTarget('ladybug', okTarget)).toThrow(/built in/)
    expect(() => registerTarget('Not Valid', okTarget)).toThrow(/lower-case/)
    expect(() => registerImporter('rdf', { importer: () => importModel([]), extensions: [] })).toThrow(/built in/)
  })

  it('reads a plugin source on its own and marks it as a plugin', () => {
    registerImporter('names-test', {
      extensions: ['.nm'],
      importer: () => ({ model: loadFixture('social.lpg.yaml'), diagnostics: [] }),
    }, { plugin: true })
    expect(isPluginImporter('names-test')).toBe(true)
    const out = importModel([{ path: '/a.nm', text: '' }])
    expect(out.model.nodes.length).toBeGreaterThan(0)
  })
})
