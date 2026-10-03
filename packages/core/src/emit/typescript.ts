import type {
  Diagnostic, EdgeTypeIR, MixinIR, ModelIR, NodeTypeIR, PropertyIR, ScalarType, ValueType,
} from '../ir'
import { concreteNodes, describeCardinality, formatValueType, isUnconstrained } from '../ir'
import {
  constraintDowngrade, reportUnsupportedConstraints,
  type Capabilities, type EmitOptions, type EmitResult,
} from '../capabilities'

/**
 * TypeScript declarations: the model as the application code sees it. The compiler is
 * the engine this target is measured against — the test type-checks every fixture's
 * artifact under strict mode. What a type system cannot say (keys, uniqueness, bounds,
 * cardinality) lives in JSDoc at the site and in the SCHEMA const, so a query builder
 * reads the same facts the interfaces were derived from.
 * See lat.md/emitters#TypeScript Target.
 */
export const TYPESCRIPT_CAPABILITIES: Capabilities = {
  target: 'typescript',
  multiLabel: true,
  inheritance: 'subclass',
  // A non-optional member cannot be omitted under strict TypeScript.
  requiredConstraint: 'enforced',
  uniqueConstraint: 'unsupported',
  // The key is carried in the SCHEMA const, composite or not; nothing is synthesized.
  compositeKey: 'native',
  edgeProps: 'native',
  nestedEdges: false,
  listProps: 'native',
  // A struct is an object type, a map a Record, a union a union: all native here.
  compositeTypes: 'native',
  // A value outside the string-literal union fails to compile.
  enums: 'enforced',
  // An open type gains an index signature; a closed one is TypeScript's default.
  openTypes: 'native',
  valueConstraints: 'unsupported',
  namedConstraints: 'unsupported',
  rawPassthrough: false,
  cardinality: 'unsupported',
}

/**
 * The scalars drivers agree on map directly; the contested ones (temporal values,
 * decimals) go through the named aliases below, so a consumer remaps one line rather
 * than every field.
 */
const TYPES: Record<ScalarType, string> = {
  string: 'string',
  int8: 'number', int16: 'number', int32: 'number', int: 'number',
  int128: 'bigint',
  uint8: 'number', uint16: 'number', uint32: 'number', uint64: 'bigint',
  float32: 'number', float: 'number',
  decimal: 'LpgDecimal',
  boolean: 'boolean',
  date: 'LpgDate', datetime: 'LpgDateTime', zoneddatetime: 'LpgZonedDateTime',
  duration: 'LpgDuration',
  uuid: 'string', blob: 'Uint8Array', json: 'unknown',
}

/** The aliases, in the order they are emitted, with the one-line reason each exists. */
const ALIASES: Array<[name: string, doc: string]> = [
  ['LpgDate', 'A calendar date. Drivers disagree on the runtime shape; remap once here.'],
  ['LpgDateTime', 'A timestamp without an offset.'],
  ['LpgZonedDateTime', 'A timestamp with a time zone offset.'],
  ['LpgDecimal', 'An exact decimal, kept as text so no precision is silently lost.'],
  ['LpgDuration', 'An ISO 8601 duration.'],
]

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** A name as a TypeScript identifier; a validated model's names already are one. */
const tsIdent = (name: string): string => {
  const safe = name.replace(/[^A-Za-z0-9_$]/g, '_')
  return /^[0-9]/.test(safe) ? `_${safe}` : safe
}

/** A member key, quoted only when it has to be. */
const memberKey = (name: string): string => (IDENT.test(name) ? name : JSON.stringify(name))

const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** Enum names double as type names, so the property type can reference them. */
const enumTypeName = (name: string) => tsIdent(name)

/** A value type spelled as TypeScript. The enum case is handled by the caller. */
function tsType(t: ValueType): string {
  switch (t.kind) {
    case 'scalar': return TYPES[t.scalar]
    case 'list': case 'array': {
      const inner = tsType(t.of)
      // A union element needs the generic form; `A | B[]` would bind the wrong way.
      return /[|{]/.test(inner) ? `Array<${inner}>` : `${inner}[]`
    }
    case 'struct':
      return `{ ${t.fields.map((f) => `${memberKey(f.name)}: ${tsType(f.type)}`).join('; ')} }`
    case 'map': {
      const key = tsType(t.key)
      // Record accepts only string and number keys; anything else is a Map.
      return key === 'string' || key === 'number'
        ? `Record<${key}, ${tsType(t.value)}>`
        : `Map<${key}, ${tsType(t.value)}>`
    }
    case 'union': return t.members.map((m) => tsType(m.type)).join(' | ')
  }
}

/** What the type system cannot hold of this property, as one JSDoc line. */
function propertyNotes(owner: NodeTypeIR | undefined, p: PropertyIR): string[] {
  const notes: string[] = []
  if (owner && owner.key.includes(p.name)) {
    notes.push(owner.key.length > 1 ? 'part of the key' : 'key')
  }
  if (p.unique && !(owner && owner.key.includes(p.name))) notes.push('unique')
  if (p.min !== undefined) notes.push(`min ${p.min}`)
  if (p.max !== undefined) notes.push(`max ${p.max}`)
  if (p.minLength !== undefined) notes.push(`minLength ${p.minLength}`)
  if (p.maxLength !== undefined) notes.push(`maxLength ${p.maxLength}`)
  // `*/` inside a pattern would end the JSDoc block early.
  if (p.pattern !== undefined) notes.push(`pattern ${p.pattern.replace(/\*\//g, '*\\/')}`)
  if (p.composite?.kind === 'array') notes.push(`fixed length ${p.composite.size}`)
  return notes.length > 0 ? [`  /** ${notes.join('; ')} */`] : []
}

/** One interface member. The enum reference replaces the scalar, as on every target. */
function member(owner: NodeTypeIR | undefined, ownerName: string, p: PropertyIR, diags: Diagnostic[]): string[] {
  const lines = propertyNotes(owner, p)
  if (p.unique && !(owner && owner.key.includes(p.name))) {
    constraintDowngrade(diags, 'typescript', 'downgrade-unique',
      `Property '${ownerName}.${p.name}' is unique, which a type system cannot enforce. The JSDoc and the SCHEMA notes carry it.`,
      p.loc)
  }
  const type = p.enum ? `${enumTypeName(p.enum)}${p.list ? '[]' : ''}`
    : p.composite ? tsType(p.composite)
      : `${TYPES[p.type]}${p.list ? '[]' : ''}`
  lines.push(`  ${memberKey(p.name)}${p.required ? '' : '?'}: ${type}`)
  return lines
}

/** Properties this interface declares itself; `extends` brings in the rest. */
const ownProps = (props: PropertyIR[]) => props.filter((p) => !p.inheritedFrom)

function nodeInterface(node: NodeTypeIR, diags: Diagnostic[]): string[] {
  const lines: string[] = []
  if (node.abstract) lines.push('/** Abstract: no instance carries exactly this type. */')
  const parents = [
    ...(node.extends ? [tsIdent(node.extends)] : []),
    ...node.mixins.map(tsIdent),
  ]
  const heading = `export interface ${tsIdent(node.name)}${parents.length > 0 ? ` extends ${parents.join(', ')}` : ''} {`
  lines.push(heading)
  if (node.open) lines.push('  /** Open type: instances may carry undeclared properties. */',
    '  [key: string]: unknown')
  for (const p of ownProps(node.props)) lines.push(...member(node, node.name, p, diags))
  for (const k of node.constraints) {
    constraintDowngrade(diags, 'typescript', 'downgrade-named-constraint',
      `Constraint '${node.name}.${k.name}' asserts '${k.assert.kind}', which typescript cannot express. The SHACL artifact carries it.`,
      k.loc)
    lines.splice(lines.indexOf(heading), 0,
      `/** Constraint ${k.name} (${k.assert.kind}) is not expressible here; see the SHACL artifact. */`)
  }
  lines.push('}')
  return lines
}

/**
 * An edge interface that would collide with another declaration takes the `Edge`
 * suffix; the SCHEMA const keeps the model's own name either way.
 */
function edgeInterfaceName(edge: EdgeTypeIR, taken: Set<string>): string {
  const base = tsIdent(edge.name)
  return taken.has(base) ? `${base}Edge` : base
}

function edgeInterface(
  edge: EdgeTypeIR, name: string, diags: Diagnostic[],
): string[] {
  const lines = [`/** Edge ${edge.name}: ${edge.from} → ${edge.to} (${describeCardinality(edge.cardinality)}). */`]
  if (!isUnconstrained(edge.cardinality)) {
    constraintDowngrade(diags, 'typescript', 'downgrade-cardinality',
      `Edge type '${edge.name}' declares ${describeCardinality(edge.cardinality)} cardinality, which typescript cannot enforce. The SCHEMA const records it.`,
      edge.loc)
  }
  lines.push(`export interface ${name} {`)
  for (const p of edge.props) lines.push(...member(undefined, edge.name, p, diags))
  lines.push('}')
  return lines
}

function mixinInterface(mixin: MixinIR, diags: Diagnostic[]): string[] {
  const lines = [`export interface ${tsIdent(mixin.name)} {`]
  for (const p of mixin.props) lines.push(...member(undefined, mixin.name, p, diags))
  lines.push('}')
  return lines
}

export function emitTypescript(model: ModelIR, _options: EmitOptions = {}): EmitResult {
  const diagnostics: Diagnostic[] = []
  const parts: string[] = [
    '// Generated by lpg-modeler. Target: typescript.',
    `// Model: ${model.namespace.prefix} <${model.namespace.iri}>`,
    '//',
    '// Interfaces mirror the model: a parent and a mixin are both `extends`, and a type',
    '// declares only its own properties. What a type system cannot enforce — keys,',
    '// uniqueness, value bounds, cardinality — is JSDoc at the site and data in the',
    '// SCHEMA const below. See lat.md/emitters#TypeScript Target.',
    '',
  ]

  for (const [name, doc] of ALIASES) {
    parts.push(`/** ${doc} */`, `export type ${name} = string`)
  }
  parts.push('')

  for (const e of model.enums) {
    parts.push(`export type ${enumTypeName(e.name)} = ${e.values.map(quote).join(' | ')}`)
  }
  if (model.enums.length > 0) parts.push('')

  for (const mixin of model.mixins) parts.push(...mixinInterface(mixin, diagnostics), '')
  for (const node of model.nodes) parts.push(...nodeInterface(node, diagnostics), '')

  const taken = new Set<string>([
    ...ALIASES.map(([n]) => n),
    ...model.enums.map((e) => enumTypeName(e.name)),
    ...model.mixins.map((m) => tsIdent(m.name)),
    ...model.nodes.map((n) => tsIdent(n.name)),
  ])
  const edgeNames = new Map<EdgeTypeIR, string>()
  for (const edge of model.edges) {
    const name = edgeInterfaceName(edge, taken)
    taken.add(name)
    edgeNames.set(edge, name)
    if (name !== tsIdent(edge.name)) {
      constraintDowngrade(diagnostics, 'typescript', 'edge-interface-renamed',
        `Edge type '${edge.name}' collides with another declaration; its interface is named '${name}'. The SCHEMA const keeps the model's name.`,
        edge.loc)
    }
    parts.push(...edgeInterface(edge, name, diagnostics), '')
  }

  const concrete = concreteNodes(model)
  parts.push('/** Concrete node types, for lookup by label. */')
  parts.push('export interface NodeTypes {')
  for (const n of concrete) parts.push(`  ${memberKey(n.name)}: ${tsIdent(n.name)}`)
  parts.push('}', '')
  parts.push('/** Edge property shapes, by edge type name. */')
  parts.push('export interface EdgeTypes {')
  for (const e of model.edges) parts.push(`  ${memberKey(e.name)}: ${edgeNames.get(e)}`)
  parts.push('}', '')

  parts.push('/** What the interfaces cannot carry: labels, keys, endpoints, cardinality. */')
  parts.push('export const SCHEMA = {')
  parts.push(`  prefix: ${quote(model.namespace.prefix)},`)
  parts.push(`  iri: ${quote(model.namespace.iri)},`)
  parts.push('  nodes: {')
  for (const n of model.nodes) {
    const labels = [n.name, ...n.ancestors].map(quote).join(', ')
    parts.push(`    ${memberKey(n.name)}: { labels: [${labels}], key: [${n.key.map(quote).join(', ')}], abstract: ${n.abstract} },`)
  }
  parts.push('  },')
  parts.push('  edges: {')
  for (const e of model.edges) {
    parts.push(`    ${memberKey(e.name)}: { from: ${quote(e.from)}, to: ${quote(e.to)}, cardinality: ${quote(describeCardinality(e.cardinality))} },`)
  }
  parts.push('  },')
  parts.push('} as const')

  reportUnsupportedConstraints(diagnostics, 'typescript', model, TYPESCRIPT_CAPABILITIES)

  return { target: 'typescript', extension: 'ts', content: parts.join('\n') + '\n', diagnostics }
}
