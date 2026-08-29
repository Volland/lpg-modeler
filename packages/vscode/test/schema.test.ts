import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CORE = resolve(__dirname, '..', '..', 'core', 'schemas', 'lpg.schema.json')
const CONTRIBUTED = resolve(__dirname, '..', 'schemas', 'lpg.schema.json')

// @lat: [[architecture#Surface Syntax]]
describe('contributed json schema', () => {
  it('is the same file core validates against', () => {
    // The extension contributes its own copy through contributes.jsonValidation, so the
    // editor and the CLI would otherwise be free to disagree about what a model may say.
    expect(readFileSync(CONTRIBUTED, 'utf8')).toBe(readFileSync(CORE, 'utf8'))
  })

  it('is declared against a current JSON Schema dialect', () => {
    const schema = JSON.parse(readFileSync(CONTRIBUTED, 'utf8'))
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    // $defs rather than definitions, but plain JSON Pointer refs, so a validator that
    // predates 2020-12 still resolves them.
    expect(schema.$defs).toBeDefined()
    expect(JSON.stringify(schema)).not.toContain('#/definitions/')
  })
})
