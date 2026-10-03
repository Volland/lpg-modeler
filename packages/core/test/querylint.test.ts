import { describe, expect, it } from 'vitest'
import { lintQuery } from '../src/querylint'
import { loadFixture } from './helpers'

const social = loadFixture('social.lpg.yaml')
const features = loadFixture('features.lpg.yaml')
const codes = (q: string, model = social) => lintQuery(model, q, '/q.cypher').map((d) => d.code)
const messages = (q: string, model = social) => lintQuery(model, q, '/q.cypher').map((d) => d.message)

// @lat: [[lint#Query Lint]]
describe('query lint findings', () => {
  it('names a property the model renamed', () => {
    const found = lintQuery(social, "MATCH (p:Person) WHERE p.mail = 'x' RETURN p", '/q.cypher')
    expect(found.map((d) => d.code)).toEqual(['lint-unknown-property'])
    expect(found[0]!.message).toContain("Person has no property 'mail'")
    // Positioned at the property, so the editor can underline it.
    const [start, end] = found[0]!.loc!.range
    expect("MATCH (p:Person) WHERE p.mail = 'x' RETURN p".slice(start, end)).toBe('mail')
  })

  it('reports an unknown label and an unknown relationship type', () => {
    expect(codes('MATCH (p:Persn) RETURN p')).toEqual(['lint-unknown-label'])
    expect(codes('MATCH (p:Person)-[:KNOW]->(q:Person) RETURN q')).toEqual(['lint-unknown-edge'])
  })

  it('reports an edge traversed against its direction, and one between impossible ends', () => {
    // OWNS: Party → Car, and Person descends from Party, so the reverse would fit.
    const backwards = lintQuery(social, 'MATCH (c:Car)-[:OWNS]->(p:Person) RETURN c', '/q.cypher')
    expect(backwards.map((d) => d.code)).toEqual(['lint-edge-direction'])
    expect(codes('MATCH (c:Car)<-[:OWNS]-(p:Person) RETURN c')).toEqual([])
    expect(codes('MATCH (a:Car)-[:KNOWS]->(b:Car) RETURN a')).toEqual(['lint-edge-endpoint'])
  })

  it('checks property maps in a pattern, nodes and relationships alike', () => {
    expect(codes("MATCH (p:Person {mail: 'x'}) RETURN p")).toEqual(['lint-unknown-property'])
    expect(codes('MATCH (:Person)-[k:KNOWS {when: 1}]->(:Person) RETURN k')).toEqual(['lint-unknown-property'])
    expect(codes("MATCH (p:Person {email: 'x'})-[:KNOWS {since: 1}]->() RETURN p")).toEqual([])
  })

  it('checks a relationship variable’s properties', () => {
    expect(codes('MATCH ()-[k:KNOWS]->() RETURN k.when')).toEqual(['lint-unknown-property'])
    expect(codes('MATCH ()-[k:KNOWS]->() RETURN k.since')).toEqual([])
  })

  it('reports a literal that cannot be compared with the property', () => {
    expect(codes("MATCH (c:Car) WHERE c.seats = 'four' RETURN c")).toEqual(['lint-type-mismatch'])
    expect(codes('MATCH (c:Car) WHERE c.vin = 5 RETURN c')).toEqual(['lint-type-mismatch'])
    expect(codes('MATCH (c:Car) WHERE c.seats > -2 AND c.vin = $v RETURN c')).toEqual([])
  })

  it('reports an enum value the model does not have', () => {
    expect(codes("MATCH (d:Driver) WHERE d.status = 'gone' RETURN d", features)).toEqual(['lint-enum-value'])
    expect(codes("MATCH (d:Driver) WHERE d.status = 'active' RETURN d", features)).toEqual([])
  })
})

// @lat: [[lint#Query Lint#What it will not guess]]
describe('query lint stays quiet where it cannot know', () => {
  it('says nothing about an unlabelled variable', () => {
    expect(codes('MATCH (n) WHERE n.whatever = 1 RETURN n')).toEqual([])
    expect(codes('MATCH (n)-[r]->(m) RETURN n.x, r.y')).toEqual([])
  })

  it('does not read a label, property or comment out of a string or a comment', () => {
    expect(codes("RETURN 'MATCH (p:Nope) WHERE p.zzz = 1' AS q // (a:Nope)")).toEqual([])
    expect(codes('/* MATCH (a:Nope)-[:NOPE]->() */ MATCH (p:Person) RETURN p')).toEqual([])
    expect(codes('MATCH (p:Person) WHERE p.email = "a:b (c:Nope)" RETURN p')).toEqual([])
  })

  it('does not take a function call for a pattern', () => {
    expect(codes('MATCH (p:Person) RETURN count(p), toString(p.born), coalesce(p.email, "x")')).toEqual([])
    expect(codes('MATCH (p:Person) RETURN size((p)-[:KNOWS]->())')).toEqual([])
  })

  it('reads variable-length paths and multi-label nodes', () => {
    expect(codes('MATCH (p:Person)-[:KNOWS*1..3]->(q:Person) RETURN q')).toEqual([])
    expect(codes('MATCH (n:Person:Party) WHERE n.email = "x" RETURN n')).toEqual([])
    expect(codes('MATCH (p:Person)-[:KNOWS|LIKES]->(x) RETURN x')).toEqual([])
  })

  it('does not resolve a rebound or comprehension variable', () => {
    expect(codes('MATCH (p:Person) WITH p.born AS p RETURN p.zzz')).toEqual([])
    expect(codes('MATCH (p:Person) RETURN [p IN [1, 2] WHERE p.zzz > 1]')).toEqual([])
    expect(codes('MATCH (p:Person) UNWIND [1] AS p RETURN p.zzz')).toEqual([])
  })

  it('does not resolve a label expression', () => {
    expect(codes('MATCH (n:Person|Company) RETURN n.zzz')).toEqual([])
    expect(codes('MATCH (n:!Person) RETURN n.zzz')).toEqual([])
  })

  it('leaves a subtype property read off a supertype, and an open type’s anything, alone', () => {
    expect(codes("MATCH (p:Party) WHERE p.email = 'x' RETURN p")).toEqual([])
    expect(codes('MATCH (d:Driver) RETURN d.anything', features)).toEqual([])
  })

  it('scopes variables to a statement', () => {
    expect(codes("MATCH (p:Person) RETURN p; MATCH (p:Car) WHERE p.vin = 'x' RETURN p")).toEqual([])
  })

  it('reports a break in the text and checks nothing after the last complete statement', () => {
    const found = lintQuery(social, "MATCH (p:Person) RETURN p; MATCH (q:Nope) WHERE q.a = 'oops", '/q.cypher')
    expect(found.map((d) => d.code)).toEqual(['lint-unreadable'])
    expect(found[0]!.severity).toBe('warning')
  })

  it('does not take a pattern for an expression in parentheses', () => {
    expect(codes('RETURN (1 + 2) * 3, (1)')).toEqual([])
    expect(messages('RETURN 1')).toEqual([])
  })
})
