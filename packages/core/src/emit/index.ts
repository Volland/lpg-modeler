import type { ModelIR } from '../ir'
import type { Capabilities, EmitOptions, EmitResult } from '../capabilities'
import type { Migrator } from '../migrate/types'
import { emitLadybug, LADYBUG_CAPABILITIES } from './ladybug'
import { emitNeo4j, NEO4J_CAPABILITIES } from './neo4j'
import { emitFalkorDb, FALKORDB_CAPABILITIES } from './falkordb'
import { emitMemgraph, MEMGRAPH_CAPABILITIES } from './memgraph'
import { migrateLadybug } from './ladybug.migrate'
import { migrateNeo4j } from './neo4j.migrate'
import { migrateFalkorDb } from './falkordb.migrate'
import { migrateMemgraph } from './memgraph.migrate'
import { emitShacl, SHACL_CAPABILITIES } from './shacl'
import { emitOwl, OWL_CAPABILITIES } from './owl'
import { emitGql, GQL_CAPABILITIES } from './gql'
import { emitPgSchema, PGSCHEMA_CAPABILITIES } from './pgschema'
import { emitLinkml, LINKML_CAPABILITIES } from './linkml'

export type Emitter = (model: ModelIR, options: EmitOptions) => EmitResult

interface Registration {
  capabilities: Capabilities
  emit: Emitter
  /**
   * Plans the statements from one revision to the next. Absent on a target that is
   * regenerated rather than migrated, which is every target holding no schema of its
   * own. See lat.md/emitters#Migrations.
   */
  migrate?: Migrator
}

/**
 * Internal registry. Adding a target is a file plus one entry here. This is the seam a
 * public plugin API would later expose. See lat.md/architecture#Modularity.
 */
const REGISTRY = new Map<string, Registration>([
  ['ladybug', { capabilities: LADYBUG_CAPABILITIES, emit: emitLadybug, migrate: migrateLadybug }],
  ['neo4j', { capabilities: NEO4J_CAPABILITIES, emit: emitNeo4j, migrate: migrateNeo4j }],
  ['falkordb', { capabilities: FALKORDB_CAPABILITIES, emit: emitFalkorDb, migrate: migrateFalkorDb }],
  ['memgraph', { capabilities: MEMGRAPH_CAPABILITIES, emit: emitMemgraph, migrate: migrateMemgraph }],
  ['shacl', { capabilities: SHACL_CAPABILITIES, emit: emitShacl }],
  ['owl', { capabilities: OWL_CAPABILITIES, emit: emitOwl }],
  ['gql', { capabilities: GQL_CAPABILITIES, emit: emitGql }],
  ['pgschema', { capabilities: PGSCHEMA_CAPABILITIES, emit: emitPgSchema }],
  ['linkml', { capabilities: LINKML_CAPABILITIES, emit: emitLinkml }],
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

export function migratorOf(target: string): Migrator | undefined {
  return REGISTRY.get(target)?.migrate
}

/** Targets that can be migrated rather than only regenerated. */
export function migratableTargets(): string[] {
  return [...REGISTRY.entries()].filter(([, r]) => r.migrate).map(([name]) => name).sort()
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
