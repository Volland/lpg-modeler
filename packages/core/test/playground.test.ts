import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { emit, targetNames } from '../src/emit/index'
import { resolveModel } from '../src/resolve'
import { validateModel } from '../src/validate'

const ROOT = resolve(__dirname, '..', '..', '..')
const BUNDLE = join(ROOT, 'docs', 'playground', 'lpg-core.js')
const read = (p: string) => readFileSync(p, 'utf8')

interface Playground {
  targets(): string[]
  run(text: string, target?: string): {
    diagnostics: Array<{ severity: string; code: string; line?: number; column?: number }>
    artifact?: { content: string; extension: string }
  }
}

/** The committed bundle, run in an empty context: no Node globals, as in a page. */
const load = (): Playground =>
  runInNewContext(`${read(BUNDLE)}\n;LpgCore`, {}) as Playground

// @lat: [[playground#Playground]]
describe('the playground bundle', () => {
  it('is committed in the state core currently builds to', async () => {
    // @ts-expect-error a plain script with no declaration file
    const { buildPlayground } = await import('../../../scripts/build-playground.mjs')
    expect(read(BUNDLE) === await buildPlayground()).toBe(true)
  })

  it('offers every target, since none of them needs a runtime', () => {
    expect(load().targets()).toEqual(targetNames())
  })

  // @lat: [[playground#Playground#Parity with the command line]]
  it.each(['fleet', 'social', 'kinship', 'catalog', 'booking'])(
    'generates for %s exactly what the command line generates, for every target', (name) => {
      const path = join(ROOT, 'docs', 'examples', `${name}.lpg.yaml`)
      const text = read(path)
      const { model, diagnostics } = resolveModel(path, (p) => (existsSync(p) ? read(p) : undefined))
      expect([...diagnostics, ...validateModel(model)].filter((d) => d.severity === 'error')).toEqual([])
      const page = load()
      for (const target of targetNames()) {
        const got = page.run(text, target).artifact
        expect(got?.content, `${name} → ${target}`).toBe(emit(model, target, {}).content)
      }
    })

  it('shows the diagnostics a broken model has, positioned, and generates nothing', () => {
    const r = load().run('namespace: { prefix: p, iri: "https://e.org/p#" }\nnodes:\n  A:\n    props:\n      x: { type: string }\n', 'shacl')
    expect(r.artifact).toBeUndefined()
    const missing = r.diagnostics.find((d) => d.code === 'missing-key')
    expect(missing?.severity).toBe('error')
    expect(missing?.line).toBeGreaterThan(0)
  })

  it('reads an import as a file that is not there, because a pasted model has no neighbours', () => {
    const r = load().run('namespace: { prefix: p, iri: "https://e.org/p#" }\nimports:\n  - { path: ./other.lpg.yaml, as: other }\n', 'shacl')
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })
})

// @lat: [[playground#Playground#The page]]
describe('the playground page', () => {
  const page = read(join(ROOT, 'docs', 'playground.html'))

  it('loads only the bundle beside it, and offers only examples the site publishes', () => {
    expect(page).toContain('<script src="playground/lpg-core.js"></script>')
    for (const m of page.matchAll(/<option value="([a-z]+)">/g)) {
      expect(existsSync(join(ROOT, 'docs', 'examples', `${m[1]}.lpg.yaml`)), m[1]).toBe(true)
    }
  })

  it('is linked from the front page', () => {
    expect(read(join(ROOT, 'docs', 'index.html'))).toContain('href="playground.html"')
  })
})
