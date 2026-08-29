import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveModel } from '../src/resolve'
import type { ModelIR } from '../src/ir'

export const fixture = (name: string) => join(__dirname, 'fixtures', name)

export const readFile = (p: string): string | undefined => {
  try { return readFileSync(p, 'utf8') } catch { return undefined }
}

export function loadFixture(name: string): ModelIR {
  const { model, diagnostics } = resolveModel(fixture(name), readFile)
  const errors = diagnostics.filter((d) => d.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`fixture ${name} has errors: ${errors.map((e) => e.message).join('; ')}`)
  }
  return model
}
