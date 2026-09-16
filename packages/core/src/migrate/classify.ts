import type { ChangeClass, ChangeKind, Direction } from './types'

/**
 * Kinds whose class does not depend on direction. A rename is breaking whichever way it
 * goes, because every query naming the old name stops matching; a move between owners
 * changes nothing a flattened target sees, which is the whole reason it is its own kind.
 */
const FIXED: Partial<Record<ChangeKind, ChangeClass>> = {
  renamed: 'breaking',
  rekeyed: 'breaking',
  'endpoints-changed': 'breaking',
  'namespace-changed': 'breaking',
  moved: 'additive',
}

/**
 * The class of a change. Losing data always wins; an unknown direction is treated as
 * tightening, because a false alarm costs a look and a false `additive` costs data.
 * See lat.md/emitters#Migrations.
 */
export function classify(kind: ChangeKind, direction: Direction): ChangeClass {
  if (direction === 'loses-data') return 'destructive'
  const fixed = FIXED[kind]
  if (fixed) return fixed
  return direction === 'loosens' ? 'additive' : 'breaking'
}

const RANK: Record<ChangeClass, number> = { additive: 0, breaking: 1, destructive: 2 }

/** Whether `c` is `threshold` or more severe. */
export function atLeast(c: ChangeClass, threshold: ChangeClass): boolean {
  return RANK[c] >= RANK[threshold]
}

const DIRECTION_RANK: Record<Direction, number> = {
  loosens: 0, tightens: 1, unknown: 2, 'loses-data': 3,
}

/** The most severe of several directions, for a change that is the sum of smaller ones. */
export function strongest(directions: Direction[]): Direction {
  return directions.reduce<Direction>(
    (a, b) => (DIRECTION_RANK[b] > DIRECTION_RANK[a] ? b : a), 'loosens')
}
