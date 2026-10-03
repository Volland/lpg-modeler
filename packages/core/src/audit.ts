import type {
  Assertion, Bound, Diagnostic, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR,
} from './ir'
import { concreteDescendants, concreteNodes, findEnum, info } from './ir'
import type { EmitOptions } from './capabilities'
import { falkorShellHeader } from './emit/falkordb'

/**
 * Audit: one read-only query per constraint the target leaves unenforced, each
 * returning a single `violations` count. The check set is the capability matrix turned
 * into questions — what the schema artifact could not say, the audit script asks the
 * data. See lat.md/audit#Audit.
 */

export interface AuditCheck {
  /** What family of constraint this checks, e.g. 'required' or 'cardinality'. */
  code: string
  /** What a reader recognises the check by, e.g. `Person.email required`. */
  label: string
  /** The read-only query, without a statement terminator. */
  query: string
}

export interface AuditPlan {
  target: string
  /** Suggested file extension, without a leading dot. */
  extension: string
  content: string
  checks: AuditCheck[]
  diagnostics: Diagnostic[]
}

/**
 * What one target leaves unenforced, and how it spells the two functions engines
 * disagree on. A missing spelling means the check cannot be generated there, which is
 * reported rather than guessed — the capability rule pointed at the audit itself.
 * The LadybugDB spellings are measured against 0.19.1 (size() and =~ both work); the
 * FalkorDB length and regex spellings are unmeasured, so those checks are unsupported
 * there until they are.
 */
interface AuditProfile {
  nodeRequired: boolean
  nodeUnique: boolean
  edgeRequired: boolean
  edgeUnique: boolean
  /** Parts of a key may be absent although the key as a whole is "enforced". */
  keyPresence: (node: NodeTypeIR) => boolean
  /** The key tuple itself may hold duplicates. */
  keyUnique: (node: NodeTypeIR) => boolean
  enums: boolean
  bounds: boolean
  strlen?: (expr: string) => string
  regex?: (expr: string, pattern: string) => string
  /** Closed types are checkable only where a node can say what keys it carries. */
  closed: boolean
  /** Whether an upper bound of exactly one is already enforced by the schema. */
  maxOneEnforced: boolean
  comment: string
  extension: string
  wrap: (query: string) => string
}

const cypherString = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** SHACL patterns match anywhere; `=~` matches the whole string, so an unanchored one is wrapped. */
const patternFor = (pattern: string): string =>
  (pattern.startsWith('^') && pattern.endsWith('$') ? pattern : `.*(?:${pattern}).*`)

const regexOp = (expr: string, pattern: string) => `${expr} =~ ${cypherString(patternFor(pattern))}`

function profileFor(target: string, options: EmitOptions): AuditProfile | undefined {
  const cypher: Pick<AuditProfile, 'comment' | 'extension' | 'wrap'> = {
    comment: '//', extension: 'cypher', wrap: (q) => `${q};`,
  }
  switch (target) {
    case 'ladybug':
      return {
        ...cypher,
        nodeRequired: true, nodeUnique: true, edgeRequired: true, edgeUnique: true,
        // A single-property key is the primary key and wholly enforced. A composite key
        // is a synthesized column: the real tuple's presence and uniqueness are not.
        keyPresence: (n) => n.key.length > 1,
        keyUnique: (n) => n.key.length > 1,
        enums: true, bounds: true,
        strlen: (e) => `size(${e})`, regex: regexOp,
        closed: false, // the schema is mandatory and closed; nothing undeclared can be written
        maxOneEnforced: true, // the multiplicity keyword rejects a second row on write
      }
    case 'neo4j': {
      const enterprise = options.neo4jEdition === 'enterprise'
      return {
        ...cypher,
        nodeRequired: !enterprise, nodeUnique: false,
        edgeRequired: !enterprise, edgeUnique: true,
        // Uniqueness ignores a node lacking the property, so on Community the key's
        // presence is unenforced; Enterprise's NODE KEY enforces both.
        keyPresence: () => !enterprise,
        keyUnique: () => false,
        enums: true, bounds: true,
        strlen: (e) => `size(${e})`, regex: regexOp,
        closed: true,
        maxOneEnforced: false,
      }
    }
    case 'memgraph':
      return {
        ...cypher,
        nodeRequired: false, nodeUnique: false,
        // Memgraph has no constraint on relationships at all.
        edgeRequired: true, edgeUnique: true,
        keyPresence: () => false, keyUnique: () => false,
        // IS TYPED ENUM holds that the value is an enum, not that it is this one.
        enums: true, bounds: true,
        strlen: (e) => `size(${e})`, regex: regexOp,
        closed: true,
        maxOneEnforced: false,
      }
    case 'falkordb':
      return {
        comment: '#', extension: 'sh',
        wrap: (q) => `$REDIS_CLI GRAPH.RO_QUERY "$GRAPH_KEY" "${q.replace(/"/g, '\\"')}"`,
        nodeRequired: false, nodeUnique: false, edgeRequired: false, edgeUnique: false,
        keyPresence: () => false, keyUnique: () => false,
        enums: true, bounds: true,
        // size() on a string and a regex operator are unmeasured on FalkorDB, so the
        // checks that need them are reported as unsupported rather than guessed.
        closed: true,
        maxOneEnforced: false,
      }
    default:
      return undefined
  }
}

/** Node-type matches, expanded to concrete tables where the target has no labels. */
function ownersOf(model: ModelIR, target: string, typeName: string): string[] {
  if (target !== 'ladybug') return [typeName]
  return concreteDescendants(model, typeName).map((n) => n.name)
}

/**
 * The match clause for exactly this concrete type. On a label engine a concrete type
 * with concrete descendants would otherwise match their nodes too; the label count
 * pins the most specific set without needing per-engine label predicates.
 */
function exactTypeMatch(model: ModelIR, target: string, node: NodeTypeIR): string {
  const base = `MATCH (n:${node.name})`
  if (target === 'ladybug') return base
  const hasConcreteDescendants = concreteNodes(model)
    .some((d) => d !== node && d.ancestors.includes(node.name))
  if (!hasConcreteDescendants) return base
  return `${base} WHERE size(labels(n)) = ${1 + node.ancestors.length}`
}

const presentCase = (expr: string) => `(CASE WHEN ${expr} IS NULL THEN 0 ELSE 1 END)`

export function planAudit(model: ModelIR, target: string, options: EmitOptions = {}): AuditPlan {
  const diagnostics: Diagnostic[] = []
  const profile = profileFor(target, options)
  if (!profile) {
    return {
      target, extension: 'txt', content: '', checks: [],
      diagnostics: [{
        severity: 'error', code: 'audit-unsupported-target',
        message: `No audit is defined for target '${target}'. Audit runs against ladybug, neo4j, memgraph and falkordb.`,
      }],
    }
  }

  const checks: AuditCheck[] = []
  const unchecked: string[] = []
  const skip = (what: string, why: string, loc?: PropertyIR['loc']) => {
    unchecked.push(`${what}: ${why}`)
    diagnostics.push(info('audit-unsupported', `Not checked on ${target} — ${what}: ${why}`, loc))
  }
  const push = (code: string, label: string, query: string) => checks.push({ code, label, query })

  const valueChecks = (owner: string, entity: 'node' | 'edge', match: string, v: string, p: PropertyIR) => {
    const where = (cond: string) => `${match} WHERE ${cond} RETURN count(*) AS violations`
    const requiredUnchecked = entity === 'node' ? profile.nodeRequired : profile.edgeRequired
    const uniqueUnchecked = entity === 'node' ? profile.nodeUnique : profile.edgeUnique
    if (p.required && requiredUnchecked) {
      push('required', `${owner}.${p.name} required`, where(`${v}.${p.name} IS NULL`))
    }
    if (p.unique && uniqueUnchecked) {
      push('unique', `${owner}.${p.name} unique`,
        `${match} WHERE ${v}.${p.name} IS NOT NULL WITH ${v}.${p.name} AS value, count(*) AS c WHERE c > 1 RETURN count(*) AS violations`)
    }
    if (p.enum && profile.enums) {
      if (p.list) {
        skip(`${owner}.${p.name} enum`, 'the property holds a list, and per-element checks are not generated', p.loc)
      } else {
        const values = findEnum(model, p.enum)?.values ?? []
        push('enum', `${owner}.${p.name} in enum ${p.enum}`,
          where(`${v}.${p.name} IS NOT NULL AND NOT ${v}.${p.name} IN [${values.map(cypherString).join(', ')}]`))
      }
    }
    if (profile.bounds && !p.list) {
      if (p.min !== undefined || p.max !== undefined) {
        const conds = [
          ...(p.min !== undefined ? [`${v}.${p.name} < ${p.min}`] : []),
          ...(p.max !== undefined ? [`${v}.${p.name} > ${p.max}`] : []),
        ]
        push('range', `${owner}.${p.name} in ${p.min ?? ''}..${p.max ?? ''}`,
          where(`${v}.${p.name} IS NOT NULL AND (${conds.join(' OR ')})`))
      }
      if (p.minLength !== undefined || p.maxLength !== undefined) {
        if (!profile.strlen) {
          skip(`${owner}.${p.name} length`, 'no measured string-length function on this engine', p.loc)
        } else {
          const len = profile.strlen(`${v}.${p.name}`)
          const conds = [
            ...(p.minLength !== undefined ? [`${len} < ${p.minLength}`] : []),
            ...(p.maxLength !== undefined ? [`${len} > ${p.maxLength}`] : []),
          ]
          push('length', `${owner}.${p.name} length ${p.minLength ?? ''}..${p.maxLength ?? ''}`,
            where(`${v}.${p.name} IS NOT NULL AND (${conds.join(' OR ')})`))
        }
      }
      if (p.pattern !== undefined) {
        if (!profile.regex) {
          skip(`${owner}.${p.name} pattern`, 'no measured regex operator on this engine', p.loc)
        } else {
          push('pattern', `${owner}.${p.name} pattern`,
            where(`${v}.${p.name} IS NOT NULL AND NOT ${profile.regex(`${v}.${p.name}`, p.pattern)}`))
        }
      }
    } else if (p.list && (p.min !== undefined || p.max !== undefined
      || p.minLength !== undefined || p.maxLength !== undefined || p.pattern !== undefined)) {
      skip(`${owner}.${p.name} value constraints`, 'the property holds a list, and per-element checks are not generated', p.loc)
    }
  }

  const named = (node: NodeTypeIR, owners: string[], a: Assertion, name: string) => {
    for (const label of owners) {
      const match = `MATCH (n:${label})`
      const tag = owners.length > 1 ? ` [${label}]` : ''
      const comparison = (op: string) => {
        if (!('left' in a)) return
        push('constraint', `${node.name}.${name}${tag}`,
          `${match} WHERE n.${a.left} IS NOT NULL AND n.${a.right} IS NOT NULL AND NOT n.${a.left} ${op} n.${a.right} RETURN count(*) AS violations`)
      }
      switch (a.kind) {
        case 'lessThan': comparison('<'); break
        case 'lessThanOrEquals': comparison('<='); break
        case 'equals':
          push('constraint', `${node.name}.${name}${tag}`,
            `${match} WHERE (n.${a.left} IS NULL AND n.${a.right} IS NOT NULL) OR (n.${a.left} IS NOT NULL AND n.${a.right} IS NULL) OR n.${a.left} <> n.${a.right} RETURN count(*) AS violations`)
          break
        case 'disjoint':
          push('constraint', `${node.name}.${name}${tag}`,
            `${match} WHERE n.${a.left} = n.${a.right} RETURN count(*) AS violations`)
          break
        case 'atLeastOne':
          push('constraint', `${node.name}.${name}${tag}`,
            `${match} WHERE ${a.props.map((p) => `n.${p} IS NULL`).join(' AND ')} RETURN count(*) AS violations`)
          break
        case 'exactlyOne':
          push('constraint', `${node.name}.${name}${tag}`,
            `${match} WITH n, ${a.props.map((p) => presentCase(`n.${p}`)).join(' + ')} AS present WHERE present <> 1 RETURN count(*) AS violations`)
          break
        case 'count': {
          const of = a.of
          if (target === 'ladybug' && of && model.nodes.find((n) => n.name === of)?.abstract) {
            skip(`${node.name}.${name}`, `'${of}' is abstract, and a table target cannot match it as one pattern`, node.loc)
            break
          }
          const m = of ? `(m:${of})` : '()'
          const conds = [
            ...(a.min !== undefined ? [`c < ${a.min}`] : []),
            ...(a.max !== undefined ? [`c > ${a.max}`] : []),
          ]
          if (conds.length === 0) break
          push('constraint', `${node.name}.${name}${tag}`,
            `${match} OPTIONAL MATCH (n)-[r:${a.edge}]->${m} WITH n, count(r) AS c WHERE ${conds.join(' OR ')} RETURN count(*) AS violations`)
          break
        }
      }
    }
  }

  for (const node of concreteNodes(model)) {
    const owners = ownersOf(model, target, node.name)
    for (const label of owners) {
      const tag = owners.length > 1 ? ` [${label}]` : ''
      // Key presence and tuple uniqueness, where the key's own enforcement has holes.
      if (node.key.length > 0 && profile.keyPresence(node)) {
        for (const part of node.key) {
          push('key-present', `${node.name} key part ${part}${tag}`,
            `MATCH (n:${label}) WHERE n.${part} IS NULL RETURN count(*) AS violations`)
        }
      }
      if (node.key.length > 0 && profile.keyUnique(node)) {
        const present = node.key.map((k) => `n.${k} IS NOT NULL`).join(' AND ')
        const tuple = node.key.map((k, i) => `n.${k} AS k${i}`).join(', ')
        push('key-unique', `${node.name} key (${node.key.join(', ')})${tag}`,
          `MATCH (n:${label}) WHERE ${present} WITH ${tuple}, count(*) AS c WHERE c > 1 RETURN count(*) AS violations`)
      }
      for (const p of node.props) {
        if (node.key.includes(p.name)) continue
        valueChecks(`${node.name}${tag}`, 'node', `MATCH (n:${label})`, 'n', p)
      }
      if (!node.open && profile.closed) {
        // Properties the type's instances may carry; a more specific node is excluded
        // by its label count, because its own declarations are checked on its own type.
        const declared = node.props.map((p) => cypherString(p.name)).join(', ')
        const exact = exactTypeMatch(model, target, node)
        const guard = exact.includes('WHERE') ? `${exact} WITH n` : exact
        push('closed', `${node.name} closed${tag}`,
          `${guard} UNWIND keys(n) AS k WITH n, k WHERE NOT k IN [${declared}] RETURN count(DISTINCT n) AS violations`)
      }
    }
    for (const k of node.constraints) named(node, owners, k.assert, k.name)
  }

  for (const edge of model.edges) {
    const match = `MATCH ()-[r:${edge.name}]->()`
    if (target === 'ladybug' && (concreteDescendants(model, edge.from).length === 0
      || concreteDescendants(model, edge.to).length === 0)) {
      continue // no relationship table exists; the emitter already reported it
    }
    for (const p of edge.props) valueChecks(edge.name, 'edge', match, 'r', p)

    // Each end's bound counts the other end's partners per node at this end.
    const ends: Array<{ end: 'from' | 'to'; bound: Bound; of: string; pattern: (v: string) => string }> = [
      { end: 'to', bound: edge.cardinality.to, of: edge.from, pattern: (v) => `(${v})-[r:${edge.name}]->()` },
      { end: 'from', bound: edge.cardinality.from, of: edge.to, pattern: (v) => `(${v})<-[r:${edge.name}]-()` },
    ]
    for (const { end, bound, of, pattern } of ends) {
      const conds = [
        ...(bound.min > 0 ? [`c < ${bound.min}`] : []),
        ...(bound.max !== null && !(profile.maxOneEnforced && bound.max === 1) ? [`c > ${bound.max}`] : []),
      ]
      if (conds.length === 0) continue
      for (const label of ownersOf(model, target, of)) {
        const tag = `${edge.name} ${end}-cardinality at ${label}`
        push('cardinality', tag,
          `MATCH (a:${label}) OPTIONAL MATCH ${pattern('a')} WITH a, count(r) AS c WHERE ${conds.join(' OR ')} RETURN count(*) AS violations`)
      }
    }
  }

  const c = profile.comment
  const parts: string[] = [
    `${c} Generated by lpg-modeler. Target: ${target} audit.`,
    `${c} Model: ${model.namespace.prefix} <${model.namespace.iri}>`,
    `${c}`,
    `${c} One read-only query per constraint ${target} leaves unenforced; each returns a`,
    `${c} 'violations' count, and zero everywhere means the data honours the model.`,
  ]
  if (target === 'falkordb') {
    parts.push('', ...falkorShellHeader(options.falkorGraphKey ?? model.namespace.prefix))
  }
  if (unchecked.length > 0) {
    parts.push('', ...unchecked.map((u) => `${c} UNCHECKED: ${u}`))
  }
  if (checks.length === 0) {
    parts.push('', `${c} Nothing to audit: every constraint in this model is enforced by ${target}.`)
  }
  for (const check of checks) {
    parts.push('', `${c} [${check.code}] ${check.label}`, profile.wrap(check.query))
  }

  return {
    target, extension: profile.extension, content: parts.join('\n') + '\n', checks, diagnostics,
  }
}
