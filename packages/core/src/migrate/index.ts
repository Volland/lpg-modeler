import type { Diagnostic, ModelIR } from '../ir'
import { err, info, warn } from '../ir'
import type { EmitOptions } from '../capabilities'
import { migratorOf, migratableTargets } from '../emit/index'
import { diffModels } from './diff'
import { idsNotWritten, writeLockfile, type Lockfile } from './lockfile'
import type { Change, ChangeClass, MigrationScript } from './types'

/**
 * The targets a migration is generated for when none are named: the three that hold a
 * schema. Everything else is regenerated from the model rather than migrated.
 */
export const DATABASE_TARGETS: readonly string[] = ['ladybug', 'neo4j', 'falkordb']

export interface MigrationRequest {
  /** The snapshot the database was last built or migrated to. */
  lockfile: Lockfile
  /** The model as it is now. */
  model: ModelIR
  targets?: string[]
  allowDestructive?: boolean
  options?: EmitOptions
}

export interface MigrationPlan {
  changes: Change[]
  /** Empty when the plan was refused, or when the model is unchanged. */
  scripts: MigrationScript[]
  /** The lockfile to write once the scripts are on disk. Absent when refused. */
  lockfileText?: string
  /** The revision the scripts carry the schema to. */
  revision: number
  /** True when a destructive change was found without permission to apply it. */
  refused: boolean
  diagnostics: Diagnostic[]
}

/** `shop.0004.ladybug.cypher`: the revision it produces, so the order is the file order. */
export function migrationFileName(
  stem: string, revision: number, target: string, extension: string,
): string {
  return `${stem}.${String(revision).padStart(4, '0')}.${target}.${extension}`
}

export const describeChange = (c: Change): string =>
  `${c.class.padEnd(11)} ${c.label}: ${c.detail}`

/** How many changes of each class, most severe first, for a one-line summary. */
export function summarizeChanges(changes: Change[]): string {
  const counts = (['destructive', 'breaking', 'additive'] as ChangeClass[])
    .map((c) => [c, changes.filter((x) => x.class === c).length] as const)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${n} ${c}`)
  return counts.length === 0 ? 'no changes' : counts.join(', ')
}

/**
 * Plan the migration from a lockfile to the current model, for every requested target.
 *
 * Every target is planned before anything is written, because the destructive gate is a
 * question about the whole migration: refusing after writing two of three scripts would
 * leave a half-migrated set on disk and a lockfile that agrees with neither.
 * See lat.md/emitters#Migrations.
 */
export function planMigration(request: MigrationRequest): MigrationPlan {
  const { lockfile, model } = request
  const diagnostics: Diagnostic[] = []
  const fromRevision = lockfile.revision
  const toRevision = fromRevision + 1
  const refuse = (): MigrationPlan =>
    ({ changes: [], scripts: [], revision: fromRevision, refused: true, diagnostics })

  // A derived id follows the name, so a rename would read as a drop-plus-add here.
  const derived = idsNotWritten(model)
  if (derived.length > 0) {
    diagnostics.push(...derived)
    return refuse()
  }

  const changes = diffModels(lockfile.model, model)
  if (changes.length === 0) {
    diagnostics.push(info('model-unchanged',
      `The model has not changed since revision ${fromRevision}, so there is nothing to migrate.`))
    return { changes, scripts: [], revision: fromRevision, refused: false, diagnostics }
  }

  const targets = request.targets ?? [...DATABASE_TARGETS]
  const unknown = targets.filter((t) => !migratorOf(t))
  if (unknown.length > 0) {
    for (const t of unknown) {
      diagnostics.push(err('not-migratable',
        `Target '${t}' is regenerated from the model rather than migrated, so it has no migration. Migratable targets: ${migratableTargets().join(', ')}.`))
    }
    return refuse()
  }
  const skipped = DATABASE_TARGETS.filter((t) => !targets.includes(t))
  if (skipped.length > 0) {
    diagnostics.push(warn('partial-migration',
      `The lockfile is per model, not per target, so advancing it here leaves ${skipped.join(' and ')} without a migration for revision ${toRevision}. Generate every target from one run unless those are not deployed.`))
  }

  const scripts = targets.map((target) => migratorOf(target)!(lockfile.model, model, changes, {
    ...request.options, fromRevision, toRevision,
  }))
  for (const s of scripts) diagnostics.push(...s.diagnostics)

  // The gate asks two questions: does the model remove something, and does any target
  // have to discard data to apply a change that is merely breaking in the model?
  const destructive = changes.filter((c) => c.class === 'destructive')
  const realizations = scripts.flatMap((s) => s.realizations.map((r) => ({ target: s.target, ...r })))
  if (!request.allowDestructive && (destructive.length > 0 || realizations.length > 0)) {
    for (const c of destructive) {
      diagnostics.push(err('destructive-change',
        `${c.label} ${c.detail}, which discards data. Nothing was written. Pass --allow-destructive to generate it anyway.`,
        c.loc))
    }
    for (const r of realizations) {
      diagnostics.push({
        severity: 'error', code: 'destructive-change', target: r.target,
        message: `${r.message} Nothing was written. Pass --allow-destructive to generate it anyway.`,
        ...(r.loc ? { loc: r.loc } : {}),
      })
    }
    return { changes, scripts: [], revision: fromRevision, refused: true, diagnostics }
  }

  return {
    changes,
    scripts,
    lockfileText: writeLockfile(model, toRevision),
    revision: toRevision,
    refused: false,
    diagnostics,
  }
}
