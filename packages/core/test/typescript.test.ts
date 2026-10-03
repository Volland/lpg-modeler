import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import ts from 'typescript'
import { emit } from '../src/emit/index'
import { resolveModel } from '../src/resolve'
import { loadFixture } from './helpers'

const social = () => emit(loadFixture('social.lpg.yaml'), 'typescript')
const codes = (ds: { code: string }[]) => ds.map((d) => d.code)

const inline = (body: string) =>
  resolveModel('/m.lpg.yaml', () =>
    `namespace: { prefix: p, iri: "https://e.org/p#" }\n${body}`).model

// @lat: [[emitters#TypeScript Target]]
describe('typescript target', () => {
  it('matches the golden file', async () => {
    await expect(social().content).toMatchFileSnapshot('./golden/social.typescript.ts')
  })

  it('declares a parent and a mixin as extends, with own properties only', () => {
    const out = social().content
    expect(out).toContain('export interface Person extends Party, Timestamped {')
    // `id` is inherited from Party and `createdAt` comes from the mixin: neither is
    // re-declared on Person, or a mixin change would edit every type that applies it.
    const person = out.slice(out.indexOf('interface Person'), out.indexOf('}', out.indexOf('interface Person')))
    expect(person).not.toContain('id:')
    expect(person).not.toContain('createdAt')
  })

  it('marks an optional property with ? and a unique one in JSDoc plus a diagnostic', () => {
    const { content, diagnostics } = social()
    expect(content).toContain('born?: LpgDate')
    expect(content).toContain('/** unique */')
    expect(codes(diagnostics)).toContain('downgrade-unique')
  })

  it('turns an enum into a string-literal union the property references', () => {
    const out = emit(loadFixture('features.lpg.yaml'), 'typescript').content
    expect(out).toContain("export type Status = 'active' | 'retired'")
    expect(out).toContain('status?: Status')
  })

  it('gives an open type an index signature', () => {
    const out = emit(loadFixture('features.lpg.yaml'), 'typescript').content
    const driver = out.slice(out.indexOf('interface Driver'), out.indexOf('}', out.indexOf('interface Driver')))
    expect(driver).toContain('[key: string]: unknown')
  })

  it('carries a composite type natively, with no composite downgrade', () => {
    const { content, diagnostics } = emit(loadFixture('composites.lpg.yaml'), 'typescript')
    expect(content).toMatch(/: \{ .*: /)
    expect(codes(diagnostics)).not.toContain('downgrade-composite')
  })

  it('records labels, keys, endpoints and cardinality in the SCHEMA const', () => {
    const out = social().content
    expect(out).toContain("Person: { labels: ['Person', 'Party'], key: ['id'], abstract: false }")
    expect(out).toContain("OWNS: { from: 'Party', to: 'Car', cardinality: 'many-to-many' }")
  })

  it('suffixes an edge interface that collides with a node type, and says so', () => {
    const model = inline(
      'nodes:\n  X:\n    key: [a]\n    props:\n      a: { type: string, required: true }\n'
      + 'edges:\n  X: { from: X, to: X }\n')
    const { content, diagnostics } = emit(model, 'typescript')
    expect(content).toContain('export interface XEdge {')
    expect(content).toContain("X: { from: 'X', to: 'X'")
    expect(codes(diagnostics)).toContain('edge-interface-renamed')
  })
})

// @lat: [[emitters#TypeScript Target#The compiler is the engine]]
describe('typescript artifacts compile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lpg-ts-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const FIXTURES = ['social', 'features', 'composites', 'types', 'standards']

  it.each(FIXTURES)('%s.lpg.yaml type-checks under strict mode', (name) => {
    const { content } = emit(loadFixture(`${name}.lpg.yaml`), 'typescript')
    const file = join(dir, `${name}.ts`)
    writeFileSync(file, content)
    const program = ts.createProgram([file], {
      strict: true, noEmit: true, target: ts.ScriptTarget.ES2020, skipLibCheck: true,
    })
    const problems = ts.getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    expect(problems).toEqual([])
  })
})
