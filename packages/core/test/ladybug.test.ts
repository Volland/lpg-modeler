import { describe, it, expect } from 'vitest'
import { emit } from '../src/emit/index'
import { loadFixture } from './helpers'

// @lat: [[emitters#Ladybug Target]]
describe('ladybug emitter', () => {
  it('flattens the abstract hierarchy to one table per concrete type', () => {
    const out = emit(loadFixture('social.lpg.yaml'), 'ladybug')
    expect(out.content).toContain('CREATE NODE TABLE IF NOT EXISTS Person (')
    expect(out.content).toContain('CREATE NODE TABLE IF NOT EXISTS Company (')
    // Party is abstract: no table of its own.
    expect(out.content).not.toContain('CREATE NODE TABLE IF NOT EXISTS Party (')
    expect(out.content).toContain('Abstract, no table emitted: Party')
  })

  it('copies inherited and mixin properties down into each concrete table', () => {
    const out = emit(loadFixture('social.lpg.yaml'), 'ladybug')
    const person = out.content.slice(out.content.indexOf('TABLE IF NOT EXISTS Person ('))
    expect(person).toContain('email STRING')
    expect(person).toContain('id STRING')          // inherited from Party
    expect(person).toContain('createdAt TIMESTAMP') // from the Timestamped mixin
    expect(person).toContain('PRIMARY KEY(id)')     // key inherited from Party
  })

  it('expands an abstract endpoint into one pair per concrete descendant', () => {
    const out = emit(loadFixture('social.lpg.yaml'), 'ladybug')
    const owns = out.content.slice(out.content.indexOf('REL TABLE IF NOT EXISTS OWNS'))
    expect(owns).toContain('FROM Company TO Car')
    expect(owns).toContain('FROM Person TO Car')
    expect(owns).toContain('since DATE')
  })

  it('reports required on a non-key property as a downgrade, in both channels', () => {
    const out = emit(loadFixture('social.lpg.yaml'), 'ladybug')
    const d = out.diagnostics.find((x) => x.code === 'downgrade-required' && x.message.includes('Person.email'))
    expect(d).toBeDefined()
    expect(d?.target).toBe('ladybug')
    expect(d?.severity).toBe('warning')
    // The same fact must also appear at the lossy site in the artifact.
    expect(out.content).toContain("// UNENFORCED: 'email' is required in the model")
  })

  it('never silently drops a unique constraint', () => {
    const out = emit(loadFixture('social.lpg.yaml'), 'ladybug')
    expect(out.diagnostics.some((x) => x.code === 'downgrade-unique')).toBe(true)
    expect(out.content).toContain("// UNENFORCED: 'email' is unique in the model")
  })

  it('matches the golden file', async () => {
    const out = emit(loadFixture('social.lpg.yaml'), 'ladybug')
    await expect(out.content).toMatchFileSnapshot('./golden/social.ladybug.cypher')
  })
})
