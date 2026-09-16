import type {
  Bound, Cardinality, ConstraintIR, ConstraintSeverity, Loc, ModelIR, NodeTypeIR, PropertyIR,
} from '../ir'
import { describeCardinality, formatValueType, typeParams } from '../ir'
import { classify, strongest } from './classify'
import { canonicalJson } from './lockfile'
import type { Change, ChangeElement, ChangeKind, Direction } from './types'

/**
 * What identifies a property across two models. A mixin's property takes an id per type
 * it reaches, so the declaration's own id is the one that survives a change to the mixin.
 */
export const propIdentity = (p: PropertyIR): string => p.sourceId ?? p.id

const spell = (p: PropertyIR): string => (p.composite
  ? formatValueType(p.composite)
  : `${p.type}${typeParams(p)}${p.list ? '[]' : ''}`)

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Fields a comparison below already accounts for, per kind. Anything else that differs
 * is reported as `other-changed`, so a field added to the IR later cannot slip past the
 * diff unnoticed while still changing the lockfile.
 */
const COVERED = {
  node: ['id', 'name', 'qname', 'iri', 'prefix', 'abstract', 'open', 'extends', 'ancestors',
    'mixins', 'key', 'keyInheritedFrom', 'props', 'constraints', 'rawShacl', 'previousIri'],
  edge: ['id', 'name', 'qname', 'iri', 'prefix', 'from', 'to', 'cardinality', 'props', 'previousIri'],
  prop: ['id', 'sourceId', 'name', 'type', 'precision', 'scale', 'list', 'composite', 'enum',
    'required', 'unique', 'inheritedFrom', 'min', 'max', 'pattern', 'minLength', 'maxLength'],
  enum: ['id', 'name', 'qname', 'iri', 'prefix', 'values'],
  mixin: ['id', 'name', 'props'],
  constraint: ['id', 'name', 'assert', 'message', 'severity'],
} as const

const IGNORED = new Set(['loc', 'idDerived'])

function otherFields(b: object, a: object, covered: readonly string[]): string[] {
  const rb = b as Record<string, unknown>
  const ra = a as Record<string, unknown>
  return [...new Set([...Object.keys(rb), ...Object.keys(ra)])]
    .filter((k) => !covered.includes(k) && !IGNORED.has(k))
    .filter((k) => canonicalJson(rb[k]) !== canonicalJson(ra[k]))
    .sort(byCodeUnit)
}

/** Pair two lists by id: removed first, then everything present now, each in name order. */
function pairById<T extends { id: string; name: string }>(
  before: T[], after: T[],
  on: { removed: (b: T) => void; added: (a: T) => void; both: (b: T, a: T) => void },
): void {
  const byName = (x: T, y: T) => byCodeUnit(x.name, y.name)
  const afterIds = new Map(after.map((a) => [a.id, a]))
  const beforeIds = new Map(before.map((b) => [b.id, b]))
  for (const b of [...before].sort(byName)) if (!afterIds.has(b.id)) on.removed(b)
  for (const a of [...after].sort(byName)) {
    const b = beforeIds.get(a.id)
    if (b) on.both(b, a)
    else on.added(a)
  }
}

/** Whether bound `a` admits fewer counts than `b` does, more, or both at different ends. */
function boundDirections(b: Bound, a: Bound): Direction[] {
  const out: Direction[] = []
  if (a.min > b.min || (a.max !== null && (b.max === null || a.max < b.max))) out.push('tightens')
  if (a.min < b.min || (b.max !== null && (a.max === null || a.max > b.max))) out.push('loosens')
  return out
}

function cardinalityDirection(b: Cardinality, a: Cardinality): Direction {
  return strongest([...boundDirections(b.from, a.from), ...boundDirections(b.to, a.to)])
}

/** A lower bound rising, or an upper bound falling, narrows what a value may be. */
function valueConstraintChanges(b: PropertyIR, a: PropertyIR): { details: string[]; direction: Direction } {
  const details: string[] = []
  const dirs: Direction[] = []
  const lower = (key: 'min' | 'minLength') => {
    if (b[key] === a[key]) return
    details.push(`${key} ${b[key] ?? 'unset'} -> ${a[key] ?? 'unset'}`)
    dirs.push(a[key] !== undefined && (b[key] === undefined || a[key]! > b[key]!) ? 'tightens' : 'loosens')
  }
  const upper = (key: 'max' | 'maxLength') => {
    if (b[key] === a[key]) return
    details.push(`${key} ${b[key] ?? 'unset'} -> ${a[key] ?? 'unset'}`)
    dirs.push(a[key] !== undefined && (b[key] === undefined || a[key]! < b[key]!) ? 'tightens' : 'loosens')
  }
  lower('min'); upper('max'); lower('minLength'); upper('maxLength')
  if (b.pattern !== a.pattern) {
    details.push(a.pattern === undefined ? 'pattern removed' : `pattern ${b.pattern === undefined ? 'added' : 'changed'}: ${a.pattern}`)
    dirs.push(a.pattern === undefined ? 'loosens' : 'tightens')
  }
  if (b.enum !== a.enum) {
    details.push(a.enum === undefined ? `no longer limited to enum '${b.enum}'` : `limited to enum '${a.enum}'${b.enum ? ` instead of '${b.enum}'` : ''}`)
    dirs.push(a.enum === undefined ? 'loosens' : b.enum === undefined ? 'tightens' : 'unknown')
  }
  return { details, direction: strongest(dirs) }
}

const SEVERITY_RANK: Record<ConstraintSeverity, number> = { info: 0, warning: 1, violation: 2 }

interface Declared {
  prop: PropertyIR
  ownerId: string
  ownerLabel: string
}

interface OwnedConstraint {
  constraint: ConstraintIR
  ownerId: string
  ownerLabel: string
}

/**
 * The change set between a lockfile's model and the current one. Elements are matched by
 * element id only: an element whose id is absent on one side is added or removed however
 * similar it looks to something on the other. See lat.md/emitters#Migrations.
 *
 * A property is compared where it is declared, not once per type it reaches, so moving
 * one to an ancestor is a move rather than a removal and an addition. What a type gains
 * or loses through its hierarchy or its mixins is reported on the type.
 */
export function diffModels(before: ModelIR, after: ModelIR): Change[] {
  const out: Change[] = []
  const add = (
    kind: ChangeKind, element: ChangeElement, id: string, label: string, detail: string,
    direction: Direction, loc?: Loc,
  ) => {
    out.push({ kind, element, id, label, detail, class: classify(kind, direction), ...(loc ? { loc } : {}) })
  }

  /** A type from an imported model is named with its prefix, so its origin is visible. */
  const named = (x: { name: string; qname?: string; prefix?: string }) =>
    (x.prefix && x.qname && x.prefix !== after.namespace.prefix ? x.qname : x.name)

  const other = (element: ChangeElement, id: string, label: string, b: object, a: object, covered: readonly string[], loc?: Loc) => {
    const fields = otherFields(b, a, covered)
    if (fields.length > 0) add('other-changed', element, id, label, `changed: ${fields.join(', ')}`, 'unknown', loc)
  }

  // --- The model as a whole.
  if (before.namespace.prefix !== after.namespace.prefix || before.namespace.iri !== after.namespace.iri) {
    add('namespace-changed', 'model', '', 'namespace',
      `changed from ${before.namespace.prefix} <${before.namespace.iri}> to ${after.namespace.prefix} <${after.namespace.iri}>, which changes the IRI of every type it declares`,
      'unknown')
  }
  if (canonicalJson(before.prefixes) !== canonicalJson(after.prefixes)) {
    add('other-changed', 'model', '', 'prefixes', 'prefix bindings changed', 'loosens')
  }
  if ((before.formatVersion ?? '') !== (after.formatVersion ?? '')) {
    add('other-changed', 'model', '', 'format version',
      `changed from ${before.formatVersion ?? 'undeclared'} to ${after.formatVersion ?? 'undeclared'}`, 'loosens')
  }

  const renamed = (element: ChangeElement, id: string, label: string, b: { name: string }, a: { name: string }, loc?: Loc) => {
    if (b.name !== a.name) add('renamed', element, id, label, `renamed from '${b.name}'`, 'unknown', loc)
  }

  const iris = (element: ChangeElement, id: string, label: string,
    b: { name: string; iri: string; previousIri?: string }, a: { name: string; iri: string; previousIri?: string }, loc?: Loc) => {
    // A rename changes the IRI too, and saying so twice would read as two changes.
    if (b.iri !== a.iri && b.name === a.name) {
      add('iri-changed', element, id, label, `IRI changed from <${b.iri}> to <${a.iri}>`, 'unknown', loc)
    }
    if (b.previousIri !== a.previousIri) {
      add('iri-changed', element, id, label,
        `previous IRI ${a.previousIri ? `recorded as <${a.previousIri}>` : 'no longer recorded'}`, 'loosens', loc)
    }
  }

  // --- Enums.
  pairById(before.enums, after.enums, {
    removed: (b) => add('removed', 'enum', b.id, `enum ${named(b)}`, 'removed', 'loosens'),
    added: (a) => add('added', 'enum', a.id, `enum ${named(a)}`, `added with values ${a.values.join(', ')}`, 'loosens', a.loc),
    both: (b, a) => {
      const label = `enum ${named(a)}`
      renamed('enum', a.id, label, b, a, a.loc)
      iris('enum', a.id, label, b, a, a.loc)
      const lost = b.values.filter((v) => !a.values.includes(v))
      const gained = a.values.filter((v) => !b.values.includes(v))
      if (lost.length > 0) {
        add('enum-values-changed', 'enum', a.id, label,
          `values removed: ${lost.join(', ')}${gained.length > 0 ? `; added: ${gained.join(', ')}` : ''}`, 'loses-data', a.loc)
      } else if (gained.length > 0) {
        add('enum-values-changed', 'enum', a.id, label, `values added: ${gained.join(', ')}`, 'loosens', a.loc)
      } else if (b.values.join(' ') !== a.values.join(' ')) {
        add('enum-values-changed', 'enum', a.id, label, 'values reordered', 'loosens', a.loc)
      }
      other('enum', a.id, label, b, a, COVERED.enum, a.loc)
    },
  })

  // --- Mixins. What a type loses by a mixin disappearing is reported on the type.
  pairById(before.mixins, after.mixins, {
    removed: (b) => add('removed', 'mixin', b.id, `mixin ${b.name}`, 'removed', 'loosens'),
    added: (a) => add('added', 'mixin', a.id, `mixin ${a.name}`, 'added', 'loosens', a.loc),
    both: (b, a) => {
      renamed('mixin', a.id, `mixin ${a.name}`, b, a, a.loc)
      other('mixin', a.id, `mixin ${a.name}`, b, a, COVERED.mixin, a.loc)
    },
  })

  // --- Node types.
  const nodeIds = (m: ModelIR, names: string[]) =>
    names.map((n) => m.nodes.find((x) => x.name === n)?.id ?? `?${n}`)
  const mixinIds = (m: ModelIR, names: string[]) =>
    names.map((n) => m.mixins.find((x) => x.name === n)?.id ?? `?${n}`)
  const keyIds = (n: NodeTypeIR) =>
    n.key.map((k) => { const p = n.props.find((x) => x.name === k); return p ? propIdentity(p) : `?${k}` })

  /** Losing a property it had loses data; gaining a required one invalidates what exists. */
  const flattenedDirection = (b: NodeTypeIR, a: NodeTypeIR): Direction => {
    const had = new Set(b.props.map(propIdentity))
    const has = new Set(a.props.map(propIdentity))
    if (b.props.some((p) => !has.has(propIdentity(p)))) return 'loses-data'
    return a.props.some((p) => !had.has(propIdentity(p)) && p.required) ? 'tightens' : 'loosens'
  }

  pairById(before.nodes, after.nodes, {
    removed: (b) => add('removed', 'node', b.id, `node ${named(b)}`, 'removed',
      // An abstract type holds no data of its own; its subtypes report what they lose.
      b.abstract ? 'loosens' : 'loses-data'),
    added: (a) => add('added', 'node', a.id, `node ${named(a)}`, a.abstract ? 'added (abstract)' : 'added', 'loosens', a.loc),
    both: (b, a) => {
      const label = `node ${named(a)}`
      renamed('node', a.id, label, b, a, a.loc)
      iris('node', a.id, label, b, a, a.loc)
      if (b.abstract !== a.abstract) {
        add('abstract-changed', 'node', a.id, label, a.abstract ? 'became abstract' : 'became concrete',
          a.abstract ? 'loses-data' : 'loosens', a.loc)
      }
      if (b.open !== a.open) {
        add('openness-changed', 'node', a.id, label, a.open ? 'became open' : 'became closed',
          a.open ? 'loosens' : 'tightens', a.loc)
      }
      if (nodeIds(before, b.ancestors).join() !== nodeIds(after, a.ancestors).join()) {
        add('hierarchy-changed', 'node', a.id, label,
          `extends changed from ${b.extends ?? 'nothing'} to ${a.extends ?? 'nothing'}`, flattenedDirection(b, a), a.loc)
      }
      if (mixinIds(before, b.mixins).join() !== mixinIds(after, a.mixins).join()) {
        add('mixins-changed', 'node', a.id, label,
          `mixins changed from [${b.mixins.join(', ')}] to [${a.mixins.join(', ')}]`, flattenedDirection(b, a), a.loc)
      }
      if (keyIds(b).join() !== keyIds(a).join()) {
        add('rekeyed', 'node', a.id, label, `key changed from (${b.key.join(', ')}) to (${a.key.join(', ')})`, 'unknown', a.loc)
      }
      if ((b.rawShacl ?? '') !== (a.rawShacl ?? '')) {
        add('constraint-changed', 'node', a.id, label, 'raw SHACL fragment changed', 'unknown', a.loc)
      }
      other('node', a.id, label, b, a, COVERED.node, a.loc)
    },
  })

  // --- Properties, where they are declared.
  const declared = (m: ModelIR): Map<string, Declared> => {
    const map = new Map<string, Declared>()
    for (const n of m.nodes) {
      for (const p of n.props) if (!p.inheritedFrom) map.set(p.id, { prop: p, ownerId: n.id, ownerLabel: named(n) })
    }
    for (const e of m.edges) for (const p of e.props) map.set(p.id, { prop: p, ownerId: e.id, ownerLabel: named(e) })
    for (const x of m.mixins) for (const p of x.props) map.set(p.id, { prop: p, ownerId: x.id, ownerLabel: x.name })
    return map
  }
  const beforeProps = declared(before)
  const afterProps = declared(after)
  // Nothing can hold data for an owner that did not exist, so what arrives with it
  // cannot invalidate anything, however required it is.
  const existedBefore = new Set([...before.nodes, ...before.edges, ...before.mixins].map((x) => x.id))
  const propLabel = (d: Declared) => `property ${d.ownerLabel}.${d.prop.name}`
  const byLabel = (x: Declared, y: Declared) => byCodeUnit(propLabel(x), propLabel(y))

  for (const b of [...beforeProps.values()].sort(byLabel)) {
    if (!afterProps.has(b.prop.id)) add('removed', 'prop', b.prop.id, propLabel(b), 'removed', 'loses-data')
  }
  for (const a of [...afterProps.values()].sort(byLabel)) {
    const b = beforeProps.get(a.prop.id)
    const label = propLabel(a)
    const loc = a.prop.loc
    if (!b) {
      add('added', 'prop', a.prop.id, label, `added as ${spell(a.prop)}${a.prop.required ? ', required' : ''}`,
        a.prop.required && existedBefore.has(a.ownerId) ? 'tightens' : 'loosens', loc)
      continue
    }
    const [pb, pa] = [b.prop, a.prop]
    if (b.ownerId !== a.ownerId) add('moved', 'prop', pa.id, label, `moved from ${b.ownerLabel}`, 'loosens', loc)
    renamed('prop', pa.id, label, pb, pa, loc)
    if (spell(pb) !== spell(pa)) add('retyped', 'prop', pa.id, label, `type changed from ${spell(pb)} to ${spell(pa)}`, 'unknown', loc)
    if (pb.required !== pa.required) {
      add('required-changed', 'prop', pa.id, label, pa.required ? 'became required' : 'no longer required',
        pa.required ? 'tightens' : 'loosens', loc)
    }
    if (pb.unique !== pa.unique) {
      add('unique-changed', 'prop', pa.id, label, pa.unique ? 'became unique' : 'no longer unique',
        pa.unique ? 'tightens' : 'loosens', loc)
    }
    const values = valueConstraintChanges(pb, pa)
    if (values.details.length > 0) {
      add('value-constraint-changed', 'prop', pa.id, label, values.details.join('; '), values.direction, loc)
    }
    other('prop', pa.id, label, pb, pa, COVERED.prop, loc)
  }

  // --- Edge types.
  pairById(before.edges, after.edges, {
    removed: (b) => add('removed', 'edge', b.id, `edge ${named(b)}`, 'removed', 'loses-data'),
    added: (a) => add('added', 'edge', a.id, `edge ${named(a)}`, `added from ${a.from} to ${a.to}`, 'loosens', a.loc),
    both: (b, a) => {
      const label = `edge ${named(a)}`
      renamed('edge', a.id, label, b, a, a.loc)
      iris('edge', a.id, label, b, a, a.loc)
      if (nodeIds(before, [b.from, b.to]).join() !== nodeIds(after, [a.from, a.to]).join()) {
        add('endpoints-changed', 'edge', a.id, label,
          `endpoints changed from (${b.from})->(${b.to}) to (${a.from})->(${a.to})`, 'unknown', a.loc)
      }
      if (canonicalJson(b.cardinality) !== canonicalJson(a.cardinality)) {
        add('cardinality-changed', 'edge', a.id, label,
          `cardinality changed from ${describeCardinality(b.cardinality)} to ${describeCardinality(a.cardinality)}`,
          cardinalityDirection(b.cardinality, a.cardinality), a.loc)
      }
      other('edge', a.id, label, b, a, COVERED.edge, a.loc)
    },
  })

  // --- Named constraints, matched across every type so a move is still one constraint.
  const owned = (m: ModelIR): OwnedConstraint[] => m.nodes.flatMap((n) =>
    n.constraints.map((k) => ({ constraint: k, ownerId: n.id, ownerLabel: named(n) })))
  const withName = (o: OwnedConstraint) => ({ id: o.constraint.id, name: `${o.ownerLabel}.${o.constraint.name}`, o })
  pairById(owned(before).map(withName), owned(after).map(withName), {
    removed: (b) => add('removed', 'constraint', b.id, `constraint ${b.name}`, 'removed', 'loosens'),
    added: (a) => add('added', 'constraint', a.id, `constraint ${a.name}`, `added, asserting ${a.o.constraint.assert.kind}`,
      existedBefore.has(a.o.ownerId) ? 'tightens' : 'loosens', a.o.constraint.loc),
    both: (bw, aw) => {
      const [b, a] = [bw.o.constraint, aw.o.constraint]
      const label = `constraint ${aw.name}`
      renamed('constraint', a.id, label, b, a, a.loc)
      if (bw.o.ownerId !== aw.o.ownerId) {
        add('constraint-changed', 'constraint', a.id, label, `moved from ${bw.o.ownerLabel}`, 'unknown', a.loc)
      }
      if (canonicalJson(b.assert) !== canonicalJson(a.assert)) {
        add('constraint-changed', 'constraint', a.id, label, 'assertion changed', 'unknown', a.loc)
      }
      if (b.message !== a.message) add('constraint-changed', 'constraint', a.id, label, 'message changed', 'loosens', a.loc)
      const sb = SEVERITY_RANK[b.severity ?? 'violation']
      const sa = SEVERITY_RANK[a.severity ?? 'violation']
      if (sb !== sa) {
        add('constraint-changed', 'constraint', a.id, label,
          `severity changed from ${b.severity ?? 'violation'} to ${a.severity ?? 'violation'}`, sa > sb ? 'tightens' : 'loosens', a.loc)
      }
      other('constraint', a.id, label, b, a, COVERED.constraint, a.loc)
    },
  })

  return out
}
