import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { parse } from 'yaml'
import { emit, capabilitiesOf } from '../src/emit/index'
import { resolveModel } from '../src/resolve'
import { validateModel } from '../src/validate'

const EXAMPLES = resolvePath(__dirname, '..', '..', '..', 'docs', 'examples')
const read = (p: string): string | undefined => {
  try { return readFileSync(p, 'utf8') } catch { return undefined }
}
const example = (name: string) => {
  const { model, diagnostics } = resolveModel(join(EXAMPLES, name), read)
  const errors = diagnostics.filter((d) => d.severity === 'error')
  if (errors.length > 0) throw new Error(`${name}: ${errors.map((e) => e.message).join('; ')}`)
  return model
}
const codes = (ds: { code: string }[]) => ds.map((d) => d.code)
const inline = (body: string) =>
  resolveModel('/m.lpg.yaml', () => `namespace: { prefix: p, iri: "https://e.org/p#" }\n${body}`)

// @lat: [[architecture#Examples]]
describe('published examples', () => {
  it('every example on the website resolves and validates cleanly', () => {
    const files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.lpg.yaml'))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const { model, diagnostics } = resolveModel(join(EXAMPLES, f), read)
      const problems = [...diagnostics, ...validateModel(model)]
        .filter((d) => d.severity === 'error')
      expect(problems.map((d) => `${f}: ${d.code}`)).toEqual([])
    }
  })

  it('every example generates every target without an error diagnostic', () => {
    for (const f of readdirSync(EXAMPLES).filter((n) => n.endsWith('.lpg.yaml'))) {
      const model = example(f)
      for (const target of ['ladybug', 'neo4j', 'shacl', 'owl', 'gql', 'pgschema', 'linkml']) {
        const out = emit(model, target)
        expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
        expect(out.content.length).toBeGreaterThan(0)
      }
    }
  })
})

// @lat: [[metamodel#Value Constraints]]
describe('value constraints', () => {
  it('resolves bounds and shape onto the property', () => {
    const guest = example('booking.lpg.yaml').nodes.find((n) => n.name === 'Guest')!
    expect(guest.props.find((p) => p.name === 'age')).toMatchObject({ min: 0, max: 130 })
    expect(guest.props.find((p) => p.name === 'phone')).toMatchObject({ minLength: 7, maxLength: 20 })
    expect(guest.props.find((p) => p.name === 'email')!.pattern).toBe('^[^@]+@[^@]+$')
  })

  it('refuses a bound on a type with no ordering, and a pattern on a non-string', () => {
    const bad = inline('nodes:\n  A:\n    key: [x]\n    props:\n'
      + '      x: { type: string }\n      b: { type: boolean, min: 0 }\n')
    expect(codes(validateModel(bad.model))).toContain('constraint-type-mismatch')
    const pat = inline('nodes:\n  A:\n    key: [x]\n    props:\n'
      + '      x: { type: string }\n      n: { type: int, pattern: "^a$" }\n')
    expect(codes(validateModel(pat.model))).toContain('constraint-type-mismatch')
  })

  it('refuses a bound nothing can satisfy, and a pattern that is not a regex', () => {
    const impossible = inline('nodes:\n  A:\n    key: [x]\n    props:\n'
      + '      x: { type: string }\n      n: { type: int, min: 10, max: 1 }\n')
    expect(codes(validateModel(impossible.model))).toContain('impossible-constraint')
    const broken = inline('nodes:\n  A:\n    key: [x]\n    props:\n'
      + '      x: { type: string, pattern: "([" }\n')
    expect(codes(validateModel(broken.model))).toContain('malformed-pattern')
  })

  it('shacl carries every bound, and linkml carries all but length', () => {
    const model = example('booking.lpg.yaml')
    const ttl = emit(model, 'shacl').content
    expect(ttl).toContain('sh:minInclusive 0 ;')
    expect(ttl).toContain('sh:maxInclusive 130 ;')
    expect(ttl).toContain('sh:minLength 7 ;')
    expect(ttl).toContain('sh:pattern "^BK-[0-9]{6}$" ;')

    const doc = parse(emit(model, 'linkml').content)
    expect(doc.classes.Guest.attributes.age).toMatchObject({ minimum_value: 0, maximum_value: 130 })
    expect(codes(emit(model, 'linkml').diagnostics)).toContain('downgrade-value-constraint')
  })
})

// @lat: [[metamodel#Named Constraints]]
describe('named constraints', () => {
  it('resolves each assertion kind', () => {
    const booking = example('booking.lpg.yaml').nodes.find((n) => n.name === 'Booking')!
    expect(booking.constraints.map((k) => k.name)).toEqual(['endAfterStart', 'oneLeadGuest'])
    expect(booking.constraints[0]!.assert).toEqual({
      kind: 'lessThan', left: 'startDate', right: 'endDate',
    })
    expect(booking.constraints[1]!.assert).toEqual({
      kind: 'count', edge: 'BOOKED_BY', of: 'Guest', min: 1, max: 1,
    })
  })

  it('is not inherited, because it would widen a parent contract unseen', () => {
    const { model } = inline(
      'nodes:\n  P:\n    abstract: true\n    key: [id]\n'
      + '    props:\n      id: { type: string }\n      a: { type: int }\n      b: { type: int }\n'
      + '    constraints:\n      - name: ordered\n        assert: { lessThan: [a, b] }\n'
      + '  C:\n    extends: P\n')
    expect(model.nodes.find((n) => n.name === 'C')!.constraints).toEqual([])
  })

  it('refuses an unknown kind and a malformed assertion', () => {
    const unknown = inline('nodes:\n  A:\n    key: [x]\n    props: { x: { type: string } }\n'
      + '    constraints:\n      - name: k\n        assert: { alwaysTrue: [x] }\n')
    expect(codes(unknown.diagnostics)).toContain('unknown-assertion')
    const oneOperand = inline('nodes:\n  A:\n    key: [x]\n    props: { x: { type: string } }\n'
      + '    constraints:\n      - name: k\n        assert: { lessThan: [x] }\n')
    expect(codes(oneOperand.diagnostics)).toContain('malformed-constraint')
  })

  it('refuses an operand the type does not have, and an edge that does not leave it', () => {
    const ghost = inline('nodes:\n  A:\n    key: [x]\n    props: { x: { type: string } }\n'
      + '    constraints:\n      - name: k\n        assert: { lessThan: [x, nope] }\n')
    expect(codes(validateModel(ghost.model))).toContain('unresolved-operand')
    const elsewhere = inline(
      'nodes:\n  A: { key: [x], props: { x: { type: string } } }\n'
      + '  B:\n    key: [y]\n    props: { y: { type: string } }\n'
      + '    constraints:\n      - name: k\n        assert: { count: { edge: R, min: 1 } }\n'
      + 'edges:\n  R: { from: A, to: A }\n')
    expect(codes(validateModel(elsewhere.model))).toContain('unreachable-edge')
  })

  it('gives each constraint its own shape so each carries its own message', () => {
    const ttl = emit(example('booking.lpg.yaml'), 'shacl').content
    const cmp = ttl.slice(ttl.indexOf('bk:Booking_endAfterStartShape'))
    expect(cmp).toContain('sh:lessThan bk:endDate ;')
    expect(cmp).toContain('sh:message "a booking must end after it starts" ;')

    const choice = ttl.slice(ttl.indexOf('bk:Guest_reachableShape'))
    expect(choice).toContain('sh:or (')
    expect(choice).toContain('[ sh:path bk:email ; sh:minCount 1 ]')

    const qualified = ttl.slice(ttl.indexOf('bk:Booking_oneLeadGuestShape'))
    expect(qualified).toContain('sh:qualifiedValueShape [ sh:class bk:Guest ] ;')
    expect(qualified).toContain('sh:qualifiedMinCount 1 ;')
  })
})

// @lat: [[metamodel#Escape Hatch]]
describe('raw SHACL escape hatch', () => {
  it('splices the fragment into the type shape', () => {
    const ttl = emit(example('booking.lpg.yaml'), 'shacl').content
    expect(ttl).toContain('# Raw SHACL from the model, passed through unchanged.')
    expect(ttl).toContain('sh:description "long stays are reviewed by hand" ;')
  })

  it('every other target says it ignored it', () => {
    for (const target of ['ladybug', 'neo4j', 'owl', 'gql', 'pgschema', 'linkml']) {
      const out = emit(example('booking.lpg.yaml'), target)
      expect(codes(out.diagnostics)).toContain('downgrade-raw-shacl')
      expect(capabilitiesOf(target)!.rawPassthrough).toBe(false)
    }
    expect(capabilitiesOf('shacl')!.rawPassthrough).toBe(true)
  })
})

describe('constraint downgrades stay quiet', () => {
  it('reports a constraint the target cannot hold at info, not warning', () => {
    // Five of seven targets carry no constraints at all. A warning apiece would bury
    // the downgrades that are genuinely surprising.
    const out = emit(example('booking.lpg.yaml'), 'ladybug')
    const constraintCodes = new Set([
      'downgrade-value-constraint', 'downgrade-named-constraint', 'downgrade-raw-shacl',
    ])
    const reported = out.diagnostics.filter((d) => constraintCodes.has(d.code))
    expect(reported.length).toBeGreaterThan(0)
    expect(reported.every((d) => d.severity === 'info')).toBe(true)
    // A property that cannot be enforced at all is still a warning.
    expect(out.diagnostics.some((d) => d.severity === 'warning')).toBe(true)
  })
})
