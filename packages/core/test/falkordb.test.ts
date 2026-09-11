import { describe, it, expect } from 'vitest'
import { emit } from '../src/emit/index'
import { capabilitiesOf } from '../src/emit/index'
import { loadFixture } from './helpers'

// @lat: [[emitters#FalkorDB Target]]
describe('falkordb emitter', () => {
  const model = () => loadFixture('social.lpg.yaml')
  const out = () => emit(model(), 'falkordb')

  it('expresses the hierarchy as labels rather than separate structures', () => {
    expect(out().content).toContain('# Person carries labels :Person :Party')
    expect(out().content).toContain('# Company carries labels :Company :Party')
  })

  it('enforces a required property without an edition, which Neo4j cannot', () => {
    // 'createdAt' is required and is not the key. On Neo4j Community this is a reported
    // downgrade; here MANDATORY carries it on any instance.
    expect(out().content)
      .toContain('GRAPH.CONSTRAINT CREATE "$GRAPH_KEY" MANDATORY NODE Person PROPERTIES 1 createdAt')
    expect(out().diagnostics.filter((d) => d.code === 'downgrade-required')).toEqual([])
    expect(capabilitiesOf('falkordb')?.requiredConstraint).toBe('enforced')
  })

  it('creates the supporting index before the unique constraint that requires it', () => {
    const lines = out().content.split('\n')
    const index = lines.findIndex((l) => l.includes('CREATE INDEX FOR (n:Person) ON (n.email)'))
    const unique = lines.findIndex((l) => l.includes('UNIQUE NODE Person PROPERTIES 1 email'))
    expect(index).toBeGreaterThan(-1)
    // A unique constraint requires an exact-match index to already exist.
    expect(index).toBeLessThan(unique)
  })

  it('adds MANDATORY to a key, because UNIQUE alone ignores a null', () => {
    const content = out().content
    expect(content).toContain('UNIQUE NODE Car PROPERTIES 1 vin')
    expect(content).toContain('MANDATORY NODE Car PROPERTIES 1 vin')
  })

  it('names the graph after the namespace, and takes an override', () => {
    expect(out().content).toContain('GRAPH_KEY="${GRAPH_KEY:-social}"')
    expect(emit(model(), 'falkordb', { falkorGraphKey: 'prod' }).content)
      .toContain('GRAPH_KEY="${GRAPH_KEY:-prod}"')
  })

  it('warns in the artifact that enforcement is asynchronous and may end FAILED', () => {
    expect(out().content).toContain('FAILED')
  })

  it('reports a composite value as unstorable: a map is not a property value', () => {
    const composites = emit(loadFixture('composites.lpg.yaml'), 'falkordb')
    expect(composites.content).toContain('# UNSTORABLE:')
    expect(composites.diagnostics.some((d) => d.code === 'downgrade-composite')).toBe(true)
  })

  it('reports cardinality, which is not part of its schema facility', () => {
    const kinship = emit(loadFixture('kinship.lpg.yaml'), 'falkordb')
    expect(kinship.diagnostics.some((d) => d.code === 'downgrade-cardinality')).toBe(true)
  })

  it('matches the golden file', async () => {
    await expect(out().content).toMatchFileSnapshot('./golden/social.falkordb.sh')
  })
})
