import {
  canonicalCardinality, info, warn, parsePropertyType,
  type Cardinality, type Diagnostic, type EdgeTypeIR, type ModelIR,
  type NodeTypeIR, type PropertyIR,
} from '../ir'
import { deriveId } from '../ids'
import type { ImportInput, ImportResult } from './rdf'

/**
 * Reads LadybugDB DDL back into a model. The DDL is the one artifact that carries an
 * edge's endpoints and the exact width of every column, because the metamodel's scalars
 * were drawn from what this engine stores. What it cannot carry is the abstract
 * hierarchy: a table is emitted per concrete type with inherited columns copied down.
 * See lat.md/importers#Reading LadybugDB DDL.
 */

/** Splits on commas that are not inside a nested type like `STRUCT(a INT64, b INT64)`. */
function topLevelSplit(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      out.push(body.slice(start, i))
      start = i + 1
    }
  }
  out.push(body.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}

const STATEMENT =
  /CREATE\s+(NODE|REL)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)/i

/** `vin STRING` or `location STRUCT(lat DOUBLE, lon DOUBLE)`. */
const COLUMN = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/

/**
 * LadybugDB spells the 32-bit float `FLOAT`, where the metamodel reads a bare `FLOAT`
 * as the 64-bit one -- the only place the engine's spellings and the model's disagree.
 * Reading the DDL with the generic table would widen every `FLOAT32` to a `DOUBLE`,
 * which is the opposite of why the DDL is consulted. Applied to the whole spelling so
 * it reaches inside a nested composite too.
 */
function ladybugDialect(written: string): string {
  return written.replace(/\bFLOAT\b(?![0-9])/g, 'FLOAT32')
}

function column(entry: string, owner: string, diagnostics: Diagnostic[]): PropertyIR | undefined {
  const m = COLUMN.exec(entry)
  if (!m) return undefined
  const [, name, written] = m as unknown as [string, string, string]
  const parsed = parsePropertyType(ladybugDialect(written))
  if (!parsed) {
    diagnostics.push(warn('import-type',
      `Column '${owner}.${name}' has type '${written}', which is not a type this metamodel knows. The column was skipped.`))
    return undefined
  }
  return {
    id: deriveId('prop', name, owner),
    name,
    type: parsed.type,
    list: parsed.list,
    required: false,
    unique: false,
    ...(parsed.composite ? { composite: parsed.composite } : {}),
    ...(parsed.precision !== undefined ? { precision: parsed.precision } : {}),
    ...(parsed.scale !== undefined ? { scale: parsed.scale } : {}),
  }
}

export interface LadybugContext {
  /** Child type name to parent, from a hierarchy another artifact carried. */
  parents?: Map<string, string>
}

export function importLadybug(
  inputs: ImportInput[], context: LadybugContext = {},
): ImportResult {
  const diagnostics: Diagnostic[] = []
  const nodes: NodeTypeIR[] = []
  const edges: EdgeTypeIR[] = []

  const text = inputs.map((i) => i.text).join('\n')
  // Comments carry the downgrade notes and the abstract types that emitted no table.
  // They are prose for an operator, not a machine-readable record, so they are dropped.
  const stripped = text.replace(/\/\/[^\n]*/g, '')

  for (const raw of stripped.split(';')) {
    const m = STATEMENT.exec(raw)
    if (!m) continue
    const [, kind, name, body] = m as unknown as [string, string, string, string]
    const entries = topLevelSplit(body)

    if (kind.toUpperCase() === 'NODE') {
      const key: string[] = []
      const props: PropertyIR[] = []
      for (const entry of entries) {
        const pk = /^PRIMARY\s+KEY\s*\(([^)]*)\)$/i.exec(entry)
        if (pk) {
          key.push(...(pk[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean))
          continue
        }
        const p = column(entry, name, diagnostics)
        if (p) props.push(p)
      }
      // A key column is never null, which is the one required-ness the DDL records.
      for (const p of props) if (key.includes(p.name)) p.required = true
      nodes.push({
        id: deriveId('node', name),
        name,
        qname: name,
        iri: name,
        prefix: '',
        abstract: false,
        open: false,
        ancestors: [],
        mixins: [],
        key,
        props,
        constraints: [],
      })
      continue
    }

    const pairs: Array<[string, string]> = []
    const props: PropertyIR[] = []
    let cardinality: Cardinality | undefined
    for (const entry of entries) {
      const fromTo = /^FROM\s+([A-Za-z_][A-Za-z0-9_]*)\s+TO\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(entry)
      if (fromTo) {
        pairs.push([fromTo[1] as string, fromTo[2] as string])
        continue
      }
      const named = canonicalCardinality(entry)
      if (named) { cardinality = named; continue }
      const p = column(entry, name, diagnostics)
      if (p) props.push(p)
    }
    if (pairs.length === 0) continue

    const [from, to] = collapse(name, pairs, context.parents, diagnostics)
    edges.push({
      id: deriveId('edge', name),
      name,
      qname: name,
      iri: name,
      prefix: '',
      from,
      to,
      props,
      cardinality: cardinality ?? { from: { min: 0, max: null }, to: { min: 0, max: null } },
    })
  }

  diagnostics.push(info('import-lossy',
    'LadybugDB DDL is emitted one table per concrete type, so an abstract hierarchy, mixins, enums and value constraints are not in it. Only a primary key records that a property is required.'))

  return {
    model: {
      file: inputs[0]?.path ?? '',
      namespace: { prefix: 'model', iri: 'https://example.org/imported#' },
      prefixes: {},
      nodes,
      edges,
      mixins: [],
      enums: [],
    },
    diagnostics,
  }
}

/**
 * An edge on an abstract endpoint was expanded to one pair per concrete subtype. Given
 * a hierarchy from another artifact in the same import, a set of pairs that is exactly
 * the concrete descendants of one type collapses back to that type. Without a hierarchy
 * there is nothing to collapse to, so the first pair stands and the rest are reported.
 */
function collapse(
  edge: string, pairs: Array<[string, string]>,
  parents: Map<string, string> | undefined, diagnostics: Diagnostic[],
): [string, string] {
  const first = pairs[0] as [string, string]
  if (pairs.length === 1) return first

  if (parents) {
    const generalise = (names: string[]): string => {
      const chain = (n: string): string[] => {
        const out = [n]
        let cur = n
        while (parents.get(cur)) { cur = parents.get(cur) as string; out.push(cur) }
        return out
      }
      for (const candidate of chain(names[0] as string)) {
        if (names.every((n) => chain(n).includes(candidate))) return candidate
      }
      return names[0] as string
    }
    const from = generalise(pairs.map(([f]) => f))
    const to = generalise(pairs.map(([, t]) => t))
    if (pairs.every(([f, t]) => chainHas(parents, f, from) && chainHas(parents, t, to))) {
      diagnostics.push(info('import-collapsed',
        `Edge '${edge}' was expanded to ${pairs.length} endpoint pairs by the generator; the hierarchy in this import collapses them back to (${from})->(${to}).`))
      return [from, to]
    }
  }

  diagnostics.push(warn('import-endpoints',
    `Edge '${edge}' declares ${pairs.length} endpoint pairs, which happens when the model had an abstract endpoint. Without a hierarchy there is nothing to collapse them to, so (${first[0]})->(${first[1]}) was kept and the rest dropped. Import the OWL ontology alongside the DDL to recover the abstract endpoint.`))
  return first
}

function chainHas(parents: Map<string, string>, from: string, target: string): boolean {
  let cur: string | undefined = from
  while (cur) {
    if (cur === target) return true
    cur = parents.get(cur)
  }
  return false
}
