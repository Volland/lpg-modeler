import { describe, it, expect } from 'vitest'
import {
  isValidPrefix, newModelSource, normalizeBaseIri, toTypeName,
} from '../src/scaffold'
import { resolveModel } from '../src/resolve'
import { validateModel } from '../src/validate'
import { emit } from '../src/emit/index'
import { backfillIdEdits } from '../src/ids'

const load = (source: string) => {
  const { model, diagnostics } = resolveModel('/new.lpg.yaml', () => source)
  return { model, diagnostics: [...diagnostics, ...validateModel(model)] }
}

// @lat: [[architecture#Editing Surface#Creating a Model]]
describe('new model scaffold', () => {
  it('produces a model that resolves and validates with nothing to fix', () => {
    const { model, diagnostics } = load(newModelSource({
      prefix: 'social', iri: 'https://example.org/vocab/social#',
    }))
    expect(diagnostics).toEqual([])
    expect(model.namespace).toEqual({
      prefix: 'social', iri: 'https://example.org/vocab/social#',
    })
    expect(model.nodes).toHaveLength(1)
    expect(model.nodes[0]!.key).toEqual(['id'])
  })

  it('generates every target, so the first run produces something', () => {
    const { model } = load(newModelSource({ prefix: 'demo', iri: 'https://e.org/demo#' }))
    for (const target of ['ladybug', 'neo4j', 'shacl', 'owl', 'gql', 'pgschema', 'linkml']) {
      const out = emit(model, target)
      expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      expect(out.content.length).toBeGreaterThan(0)
    }
  })

  it('writes stable ids, so the file needs no `lpg ids` pass', () => {
    const source = newModelSource({ prefix: 'demo', iri: 'https://e.org/demo#' })
    expect(backfillIdEdits(source)).toEqual([])
    const { model } = load(source)
    expect(model.nodes[0]!.id).toMatch(/^n_[a-z0-9]+$/)
    for (const p of model.nodes[0]!.props) expect(p.id).toMatch(/^p_[a-z0-9]+$/)
  })

  it('adds the separator a base IRI needs, and leaves one that has it', () => {
    // Without it, every type name would run into the last character of the namespace.
    expect(normalizeBaseIri('https://e.org/vocab/demo')).toBe('https://e.org/vocab/demo#')
    expect(normalizeBaseIri('https://e.org/vocab/demo#')).toBe('https://e.org/vocab/demo#')
    expect(normalizeBaseIri('https://e.org/vocab/demo/')).toBe('https://e.org/vocab/demo/')
    const { model } = load(newModelSource({ prefix: 'demo', iri: 'https://e.org/demo' }))
    expect(model.nodes[0]!.iri).toBe('https://e.org/demo#Thing')
  })

  it('seeds a node type named after the model, however the name was written', () => {
    expect(toTypeName('social')).toBe('Social')
    expect(toTypeName('my-domain')).toBe('MyDomain')
    expect(toTypeName('  ')).toBe('Thing')
    const { model } = load(newModelSource({
      prefix: 'kb', iri: 'https://e.org/kb#', seedType: 'knowledge base',
    }))
    expect(model.nodes[0]!.name).toBe('KnowledgeBase')
  })

  it('accepts only a prefix the schema would accept', () => {
    expect(isValidPrefix('social')).toBe(true)
    expect(isValidPrefix('my-domain_2')).toBe(true)
    expect(isValidPrefix('2fast')).toBe(false)
    expect(isValidPrefix('has space')).toBe(false)
    expect(isValidPrefix('')).toBe(false)
  })
})
