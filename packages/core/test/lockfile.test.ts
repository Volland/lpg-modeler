import { describe, it, expect } from 'vitest'
import {
  idsNotWritten, lockfilePath, LOCKFILE_VERSION, readLockfile, writeLockfile,
} from '../src/migrate/lockfile'
import { loadFixture } from './helpers'
import { BASE, pairModels, resolveText } from './migrate-pairs'

// @lat: [[emitters#Migrations#Lockfile]]
describe('lockfile', () => {
  it('sits beside the model under the same stem', () => {
    expect(lockfilePath('/m/domain.lpg.yaml')).toBe('/m/domain.lpg.lock.json')
    expect(lockfilePath('/m/domain.lpg.yml')).toBe('/m/domain.lpg.lock.json')
  })

  it('carries the format versions and the revision ahead of the model', () => {
    const lock = JSON.parse(writeLockfile(resolveText(BASE), 3))
    expect(Object.keys(lock)).toEqual(['lockfileVersion', 'lpg', 'revision', 'model'])
    expect(lock).toMatchObject({ lockfileVersion: LOCKFILE_VERSION, lpg: '1.0', revision: 3 })
  })

  it('is byte-identical when written twice from the same model', () => {
    expect(writeLockfile(resolveText(BASE), 1)).toBe(writeLockfile(resolveText(BASE), 1))
  })

  it('does not change when declarations are reordered', () => {
    const company = BASE.slice(BASE.indexOf('  Company:\n'), BASE.indexOf('  Asset:\n'))
    const reordered = BASE.replace(company, '').replace('  Person:\n', `${company}  Person:\n`)
    expect(reordered).not.toBe(BASE)
    expect(writeLockfile(resolveText(reordered), 1)).toBe(writeLockfile(resolveText(BASE), 1))
  })

  it('does not change when only comments and spacing move, because locations are not recorded', () => {
    const moved = `# a comment that shifts every offset\n\n${BASE.replace('nodes:\n', 'nodes:\n\n')}`
    const text = writeLockfile(resolveText(moved), 1)
    expect(text).toBe(writeLockfile(resolveText(BASE), 1))
    expect(text).not.toMatch(/"(loc|file|idDerived)"/)
  })

  it('holds the resolved model: a mixin on a parent reaches both concrete subtypes', () => {
    const { after } = pairModels('mixin-on-parent')
    const lock = JSON.parse(writeLockfile(after, 1))
    for (const name of ['Person', 'Company']) {
      const node = lock.model.nodes.find((n: { name: string }) => n.name === name)
      expect(node.props.map((p: { name: string }) => p.name)).toContain('createdAt')
    }
  })

  it('includes the types an imported model declares', () => {
    const model = loadFixture('app.lpg.yaml')
    const imported = model.nodes.filter((n) => n.prefix !== model.namespace.prefix)
    expect(imported.length).toBeGreaterThan(0)
    const lock = JSON.parse(writeLockfile(model, 1))
    const names = lock.model.nodes.map((n: { qname: string }) => n.qname)
    for (const n of imported) expect(names).toContain(n.qname)
  })

  it('reads back into the same lockfile', () => {
    const text = writeLockfile(resolveText(BASE), 7)
    const { lockfile, diagnostics } = readLockfile(text, '/m/shop.lpg.lock.json')
    expect(diagnostics).toEqual([])
    expect(lockfile?.revision).toBe(7)
    expect(writeLockfile(lockfile!.model, 7)).toBe(text)
  })

  it('reports an unreadable lockfile instead of throwing', () => {
    expect(readLockfile('{ not json').diagnostics[0]?.code).toBe('lockfile-unreadable')
    expect(readLockfile('{"hello": 1}').diagnostics[0]?.code).toBe('lockfile-unreadable')
  })

  it('refuses a lockfile written by a newer format', () => {
    const text = writeLockfile(resolveText(BASE), 1).replace(
      `"lockfileVersion": ${LOCKFILE_VERSION}`, `"lockfileVersion": ${LOCKFILE_VERSION + 1}`)
    expect(readLockfile(text).diagnostics[0]?.code).toBe('lockfile-newer')
  })
})

// @lat: [[metamodel#Stable Element IDs]]
describe('written element ids', () => {
  it('finds nothing to report when every id is written, mixin-applied properties included', () => {
    expect(idsNotWritten(resolveText(BASE))).toEqual([])
  })

  it('names each element whose id was derived, once, where it is declared', () => {
    const model = resolveText([
      'namespace: { prefix: t, iri: "https://example.org/t#" }',
      'nodes:',
      '  Base:',
      '    id: n_base',
      '    abstract: true',
      '    key: [id]',
      '    props:',
      '      id: { type: string }',
      '  Thing:',
      '    extends: Base',
      '    props:',
      '      label: { id: p_label, type: string }',
      '  Other:',
      '    id: n_other',
      '    extends: Base',
      '',
    ].join('\n'))
    const diags = idsNotWritten(model)
    expect(diags.every((d) => d.code === 'ids-not-written' && d.severity === 'error')).toBe(true)
    expect(diags.map((d) => d.message.split(' has ')[0]).sort())
      .toEqual(["Node type 'Thing'", "Property 'Base.id'"])
    expect(diags.every((d) => d.loc !== undefined)).toBe(true)
  })

  it('marks a derived id in the IR and leaves a written one unmarked', () => {
    const model = resolveText('namespace: { prefix: t, iri: "https://example.org/t#" }\nnodes:\n  A:\n    key: [k]\n    props:\n      k: { id: p_k, type: string }\n')
    const a = model.nodes[0]!
    expect(a.idDerived).toBe(true)
    expect(a.props[0]?.idDerived).toBeUndefined()
  })
})
