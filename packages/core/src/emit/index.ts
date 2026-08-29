import type { ModelIR } from '../ir'
import type { Capabilities, EmitOptions, EmitResult } from '../capabilities'
import { emitLadybug, LADYBUG_CAPABILITIES } from './ladybug'
import { emitNeo4j, NEO4J_CAPABILITIES } from './neo4j'
import { emitShacl, SHACL_CAPABILITIES } from './shacl'
import { emitOwl, OWL_CAPABILITIES } from './owl'

export type Emitter = (model: ModelIR, options: EmitOptions) => EmitResult

interface Registration {
  capabilities: Capabilities
  emit: Emitter
}

/**
 * Internal registry. Adding a target is a file plus one entry here. This is the seam a
 * public plugin API would later expose. See lat.md/architecture#Modularity.
 */
const REGISTRY = new Map<string, Registration>([
  ['ladybug', { capabilities: LADYBUG_CAPABILITIES, emit: emitLadybug }],
  ['neo4j', { capabilities: NEO4J_CAPABILITIES, emit: emitNeo4j }],
  ['shacl', { capabilities: SHACL_CAPABILITIES, emit: emitShacl }],
  ['owl', { capabilities: OWL_CAPABILITIES, emit: emitOwl }],
])

export function registerTarget(name: string, reg: Registration): void {
  REGISTRY.set(name, reg)
}

export function targetNames(): string[] {
  return [...REGISTRY.keys()].sort()
}

export function capabilitiesOf(target: string): Capabilities | undefined {
  return REGISTRY.get(target)?.capabilities
}

export function emit(model: ModelIR, target: string, options: EmitOptions = {}): EmitResult {
  const reg = REGISTRY.get(target)
  if (!reg) {
    return {
      target, extension: 'txt', content: '',
      diagnostics: [{
        severity: 'error', code: 'unknown-target',
        message: `Unknown target '${target}'. Known targets: ${targetNames().join(', ')}.`,
      }],
    }
  }
  return reg.emit(model, options)
}
