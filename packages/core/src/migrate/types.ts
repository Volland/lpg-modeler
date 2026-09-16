import type { Diagnostic, Loc, ModelIR } from '../ir'
import type { EmitOptions } from '../capabilities'

/**
 * How dangerous a change is, in increasing order. See lat.md/emitters#Migrations.
 *
 * - `additive`: nothing existing becomes invalid.
 * - `breaking`: existing data may become invalid, or existing queries may stop matching.
 * - `destructive`: something existing data may hold is removed.
 */
export type ChangeClass = 'additive' | 'breaking' | 'destructive'

export const CHANGE_CLASSES: readonly ChangeClass[] = ['additive', 'breaking', 'destructive']

export type ChangeKind =
  | 'added' | 'removed' | 'renamed' | 'moved'
  | 'retyped' | 'rekeyed' | 'required-changed' | 'unique-changed' | 'value-constraint-changed'
  | 'cardinality-changed' | 'endpoints-changed'
  | 'hierarchy-changed' | 'mixins-changed' | 'abstract-changed' | 'openness-changed'
  | 'enum-values-changed' | 'constraint-changed'
  | 'iri-changed' | 'namespace-changed' | 'other-changed'

/**
 * Which way a change moves what the model admits. The diff decides the direction, and
 * the classification is a table over kind and direction, so the two stay separable.
 */
export type Direction = 'loosens' | 'tightens' | 'loses-data' | 'unknown'

export type ChangeElement = 'model' | 'node' | 'edge' | 'prop' | 'mixin' | 'enum' | 'constraint'

/** One difference between a lockfile and the current model, matched by element id. */
export interface Change {
  kind: ChangeKind
  element: ChangeElement
  /** The element id; empty for a change to the model as a whole. */
  id: string
  /** What a reader recognises the element by, e.g. `property Person.email`. */
  label: string
  /** What happened to it, e.g. `renamed from 'mail'`. */
  detail: string
  class: ChangeClass
  loc?: Loc
}

/** Everything a planner is told besides the two models. */
export interface MigrationContext extends EmitOptions {
  fromRevision: number
  toRevision: number
}

/**
 * A statement that discards stored data only because the target cannot apply a change
 * in place, such as recreating a table to change its primary key. The change itself
 * may be merely breaking, so the destructive gate has to hear about these separately.
 */
export interface Realization {
  label: string
  message: string
  loc?: Loc
}

export interface MigrationScript {
  target: string
  /** Suggested file extension, without a leading dot. */
  extension: string
  content: string
  /** How many statements the script runs; zero means the change has no schema effect here. */
  statements: number
  realizations: Realization[]
  diagnostics: Diagnostic[]
}

/** Plans the statements that carry one target from `before` to `after`. */
export type Migrator = (
  before: ModelIR, after: ModelIR, changes: Change[], context: MigrationContext,
) => MigrationScript
