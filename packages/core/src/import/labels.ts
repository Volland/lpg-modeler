import { info, type Diagnostic } from '../ir'

/**
 * What a set of labels says about a hierarchy, shared by every importer that reads an
 * engine storing a hierarchy as labels. Memgraph reports the sets in `SHOW SCHEMA INFO`
 * and Neo4j in `db.schema.nodeTypeProperties()`, but the reading is the same one and
 * must not drift apart. See lat.md/importers#Inferring a Hierarchy from Labels.
 */

export interface LabelHierarchy {
  /** Each label's ancestors, nearest last. */
  ancestors: Map<string, string[]>
  /** Each label's nearest ancestor, where it has one. */
  parent: Map<string, string>
  /** Labels no node carries on their own. */
  abstract: Set<string>
}

/**
 * Label X is an ancestor of Y when every observed label set holding Y also holds X, and
 * some set holds X without Y. A label is abstract when no set is exactly it plus its
 * ancestors. Every inference is reported, because co-occurrence is evidence, not a
 * declaration.
 */
export function inferHierarchy(
  sets: string[][], labels: string[], diagnostics: Diagnostic[],
): LabelHierarchy {
  const ancestors = new Map<string, string[]>()
  for (const y of labels) {
    const withY = sets.filter((s) => s.includes(y))
    if (withY.length === 0) { ancestors.set(y, []); continue }
    ancestors.set(y, labels.filter((x) => x !== y
      && withY.every((s) => s.includes(x))
      && sets.some((s) => s.includes(x) && !s.includes(y))))
  }
  const parent = new Map<string, string>()
  for (const [y, xs] of ancestors) {
    // The nearest ancestor is the one with the most ancestors of its own.
    const nearest = [...xs].sort((a, b) => (ancestors.get(b)!.length - ancestors.get(a)!.length) || a.localeCompare(b))[0]
    if (nearest) parent.set(y, nearest)
  }
  const abstract = new Set(labels.filter((x) => {
    const own = new Set([x, ...ancestors.get(x)!])
    return sets.some((s) => s.includes(x)) && !sets.some((s) => s.length === own.size && s.every((l) => own.has(l)))
  }))
  for (const [child, p] of [...parent].sort()) {
    diagnostics.push(info('import-hierarchy',
      `'${child}' is read as extending '${p}': every node labelled ${child} is also labelled ${p}, and some ${p} nodes are not ${child}.`))
  }
  for (const x of [...abstract].sort()) {
    diagnostics.push(info('import-abstract',
      `'${x}' is read as abstract: no node carries it without a more specific label.`))
  }
  return { parent, abstract, ancestors }
}

/** The most specific labels of a set: those that are no other label's ancestor in it. */
export const specific = (set: string[], ancestors: Map<string, string[]>): string[] =>
  set.filter((l) => !set.some((o) => o !== l && (ancestors.get(o) ?? []).includes(l)))

/**
 * The nearest type every one of these labels descends from, which is where an edge seen
 * between several of them is declared. See lat.md/importers#Reading Edges.
 */
export function nearestCommon(names: string[], ancestors: Map<string, string[]>): string | undefined {
  const chain = (l: string) => [l, ...[...(ancestors.get(l) ?? [])]
    .sort((a, b) => (ancestors.get(b)?.length ?? 0) - (ancestors.get(a)?.length ?? 0))]
  const first = names[0]
  if (!first) return undefined
  return chain(first).find((c) => names.every((n) => chain(n).includes(c)))
}
