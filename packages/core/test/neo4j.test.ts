import { describe, it, expect } from 'vitest'
import { emit } from '../src/emit/index'
import { loadFixture } from './helpers'

// @lat: [[emitters#Neo4j Target]]
describe('neo4j emitter', () => {
  const model = () => loadFixture('social.lpg.yaml')

  it('expresses the hierarchy as labels rather than separate structures', () => {
    const out = emit(model(), 'neo4j', { neo4jEdition: 'enterprise' })
    expect(out.content).toContain('// Person carries labels :Person :Party')
    expect(out.content).toContain('// Company carries labels :Company :Party')
  })

  it('emits a node key constraint on Enterprise', () => {
    const out = emit(model(), 'neo4j', { neo4jEdition: 'enterprise' })
    expect(out.content).toContain('FOR (n:Person) REQUIRE (n.id) IS NODE KEY;')
    expect(out.diagnostics.filter((d) => d.code === 'downgrade-node-key')).toEqual([])
  })

  it('downgrades the node key on Community, in both channels', () => {
    const out = emit(model(), 'neo4j', { neo4jEdition: 'community' })
    const d = out.diagnostics.find((x) => x.code === 'downgrade-node-key')
    expect(d?.target).toBe('neo4j')
    expect(out.content).toContain('// DOWNGRADE: NODE KEY requires Enterprise')
    expect(out.content).toContain('FOR (n:Person) REQUIRE (n.id) IS UNIQUE;')
  })

  it('downgrades required properties on Community and enforces them on Enterprise', () => {
    const community = emit(model(), 'neo4j', { neo4jEdition: 'community' })
    expect(community.diagnostics.some((d) =>
      d.code === 'downgrade-required' && d.message.includes('Person.email'))).toBe(true)
    expect(community.content).toContain("// UNENFORCED: 'email' is required")

    const enterprise = emit(model(), 'neo4j', { neo4jEdition: 'enterprise' })
    expect(enterprise.content).toContain('FOR (n:Person) REQUIRE n.email IS NOT NULL;')
    expect(enterprise.diagnostics.some((d) =>
      d.code === 'downgrade-required' && d.message.includes('Person.email'))).toBe(false)
  })

  it('emits uniqueness for a non-key unique property in either edition', () => {
    for (const edition of ['community', 'enterprise'] as const) {
      const out = emit(model(), 'neo4j', { neo4jEdition: edition })
      expect(out.content).toContain('FOR (n:Person) REQUIRE n.email IS UNIQUE;')
    }
  })

  it('matches the golden files for both editions', async () => {
    await expect(emit(model(), 'neo4j', { neo4jEdition: 'community' }).content)
      .toMatchFileSnapshot('./golden/social.neo4j.community.cypher')
    await expect(emit(model(), 'neo4j', { neo4jEdition: 'enterprise' }).content)
      .toMatchFileSnapshot('./golden/social.neo4j.enterprise.cypher')
  })
})
