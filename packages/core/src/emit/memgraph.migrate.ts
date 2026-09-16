import type { Diagnostic, ModelIR } from '../ir'
import { warn } from '../ir'
import { dataSteps, isDestructiveStep, stepCypher } from '../migrate/relabel'
import { destructiveNote, migrationHeader, noSchemaEffect } from '../migrate/script'
import type { Change, MigrationContext, MigrationScript } from '../migrate/types'
import { ident, memgraphSchema, type MemgraphSchemaObject } from './memgraph'
import { newDiagnostics } from './neo4j.migrate'

/**
 * Plans a Memgraph migration as a set difference over the objects the emitter builds for
 * each revision, with data steps between the drops and the creates, like the Neo4j
 * planner. Two Memgraph facts shape it (measured against 3.13.1):
 *
 * - an enum can be created and extended, but neither dropped nor shrunk, so a removed
 *   enum or value is a downgrade with a comment, not a statement;
 * - a type constraint is refused while existing data violates it, so a retyped property
 *   gets a warning at the create that will fail until the old values are converted.
 *
 * See lat.md/emitters#Migrations#Target Planners.
 */

const C = '//'
/** Measured: Memgraph refuses DELETE inside CALL ... IN TRANSACTIONS, but not this. */
const BATCH = { periodicCommit: 1000 }

export function migrateMemgraph(
  before: ModelIR, after: ModelIR, changes: Change[], context: MigrationContext,
): MigrationScript {
  const old = memgraphSchema(before)
  const now = memgraphSchema(after)
  const had = new Set(old.objects.map((o) => o.identity))
  const has = new Set(now.objects.map((o) => o.identity))
  const diagnostics: Diagnostic[] = newDiagnostics(old.diagnostics, now.diagnostics)
  const downgrade = (message: string) => diagnostics.push({ ...warn('migration-downgrade', message), target: 'memgraph' })

  const ownerIds = new Map([...before.nodes, ...before.edges].map((x) => [x.name, x.id]))
  const surviving = new Set([...after.nodes, ...after.edges].map((x) => x.id))
  const removedOwner = (name: string) => !surviving.has(ownerIds.get(name) ?? '')

  const body: string[] = []
  let statements = 0
  const statement = (text: string, notes: string[] = []) => { body.push(...notes, text); statements++ }
  const section = () => { if (body.length > 0 && body[body.length - 1] !== '') body.push('') }

  // 1. Drops: constraints, then indexes.
  const drops = (kind: MemgraphSchemaObject['kind']) => {
    for (const o of old.objects) {
      if (o.kind !== kind || has.has(o.identity) || !o.drop) continue
      statement(o.drop, removedOwner(o.owner) ? [destructiveNote(C, o.owner, `${o.kind} dropped with the type`)] : [])
    }
  }
  drops('constraint')
  drops('index')
  section()

  // 2. Data: deletions, relabels, renames.
  for (const step of dataSteps(before, after)) {
    statement(`${stepCypher(step, BATCH)};`,
      isDestructiveStep(step) ? [destructiveNote(C, step.element, 'deleted with its type')] : [])
  }
  section()

  // 3. Enums, matched by element id so a renamed enum is not a new one.
  const enumsBefore = new Map(before.enums.map((e) => [e.id, e]))
  const enumsAfter = new Map(after.enums.map((e) => [e.id, e]))
  for (const [id, b] of enumsBefore) {
    if (enumsAfter.has(id)) continue
    downgrade(`Enum '${b.name}' was removed, but Memgraph cannot drop an enum. It stays declared, and existing values still name it.`)
    body.push(`${C} DOWNGRADE: enum '${b.name}' was removed; Memgraph cannot drop an enum, so it stays declared.`)
  }
  for (const [id, a] of enumsAfter) {
    const b = enumsBefore.get(id)
    const create = now.objects.find((o) => o.kind === 'enum' && o.enum?.name === a.name)!.create
    if (!b) { statement(create); continue }
    if (b.name !== a.name) {
      downgrade(`Enum '${b.name}' was renamed to '${a.name}', but Memgraph cannot rename or drop an enum. '${a.name}' is created; '${b.name}' stays declared, and existing values still name it.`)
      statement(create, [`${C} DOWNGRADE: enum '${b.name}' is now '${a.name}'; the old enum stays, and existing values still name it.`])
      continue
    }
    for (const v of a.values) {
      if (!b.values.includes(v)) statement(`ALTER ENUM ${ident(a.name)} ADD VALUE ${ident(v)};`)
    }
    const lost = b.values.filter((v) => !a.values.includes(v))
    if (lost.length > 0) {
      downgrade(`Enum '${a.name}' no longer has ${lost.join(', ')}, but Memgraph cannot remove an enum value. Those values stay valid.`)
      body.push(`${C} DOWNGRADE: ${lost.map((v) => `'${v}'`).join(', ')} removed from enum '${a.name}'; Memgraph cannot remove an enum value, so ${lost.length === 1 ? 'it stays' : 'they stay'} valid.`)
    }
  }
  section()

  // 4. Creates, in emitter order. A type constraint replacing another on the same
  // property is refused while values of the old type remain, which is worth saying.
  const typedBefore = new Set(old.objects.filter((o) => o.identity.startsWith('typed ')).map(typedSlot))
  for (const o of now.objects) {
    if (o.kind === 'enum' || had.has(o.identity)) continue
    if (o.kind === 'note') { body.push(o.create); continue }
    const retyped = o.identity.startsWith('typed ') && typedBefore.has(typedSlot(o))
    statement(o.create, retyped
      ? [`${C} BREAKING: this type constraint is refused while existing values of the previous type remain.`]
      : [])
  }

  const header = migrationHeader(C, 'memgraph', after, changes, context, [
    'Apply once, to an instance at the previous revision, e.g. with `lpg apply`.',
    'Data steps use USING PERIODIC COMMIT, which runs only in an implicit (auto-commit)',
    'transaction. Measured against Memgraph 3.13.1 Community.',
  ])
  // A downgrade with no statement still belongs in the script, beside the no-effect line.
  const notes = body.filter((l) => l.startsWith(`${C} DOWNGRADE:`))
  const content = [...header, ...(statements === 0 ? [...notes, noSchemaEffect(C, 'memgraph'), ''] : [...body, ''])]
    .join('\n').replace(/\n{3,}/g, '\n\n')
  return { target: 'memgraph', extension: 'cypher', content, statements, realizations: [], diagnostics }
}

/** `typed <property> <TYPE> <owner>` without the type: which property on which type. */
function typedSlot(o: MemgraphSchemaObject): string {
  const [, prop, , owner] = o.identity.split(' ')
  return `${owner} ${prop}`
}
