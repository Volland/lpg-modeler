import type { Diagnostic, EdgeTypeIR, ModelIR, MixinIR, NodeTypeIR, PropertyIR } from '../ir'
import {
  GQL_TYPES, describeCardinality, formatValueType, isUnconstrained, typeParams,
} from '../ir'
import {
  compositeDowngrade, downgrade, reportUnsupportedConstraints,
  type Capabilities, type EmitOptions, type EmitResult,
} from '../capabilities'
import { lowerCamel } from './reify'

/**
 * PG-Schema, the LDBC Property Graph Schema Working Group formalism that GQL's graph
 * types grew out of. It is the most faithful rendering of this metamodel: ABSTRACT
 * types, inheritance, mixins, and keys all have direct counterparts, so nothing about
 * the hierarchy has to be flattened. See lat.md/emitters#PG-Schema Target.
 */
export const PGSCHEMA_CAPABILITIES: Capabilities = {
  target: 'pgschema',
  multiLabel: true,
  inheritance: 'subclass',
  requiredConstraint: 'enforced',
  uniqueConstraint: 'enforced',
  compositeKey: 'native',
  edgeProps: 'native',
  nestedEdges: false,
  valueConstraints: 'unsupported',
  namedConstraints: 'unsupported',
  rawPassthrough: false,
  listProps: 'native',
  // PG-Schema borrows GQL's value types, which stop at scalars and lists of them.
  compositeTypes: 'unsupported',
  enums: 'unsupported',
  openTypes: 'native',
  cardinality: 'unsupported',
}

const typeName = (name: string) => `${lowerCamel(name)}Type`

const LOSSY_TYPES = new Set(['uuid', 'json'])

/** A value type with its parameters, wrapped in LIST<…> when the property holds many. */
const scalarType = (p: PropertyIR) => `${GQL_TYPES[p.type]}${typeParams(p)}`
const valueType = (p: PropertyIR) => (p.list ? `LIST<${scalarType(p)}>` : scalarType(p))

/** Properties this type declares itself. Inherited ones arrive through the type ref. */
const ownProps = (props: PropertyIR[]) => props.filter((p) => !p.inheritedFrom)

function propertyList(
  owner: string, props: PropertyIR[], diags: Diagnostic[],
): string {
  return props.map((p) => {
    if (p.composite) {
      compositeDowngrade(diags, 'pgschema', owner, p, valueType(p))
    } else if (LOSSY_TYPES.has(p.type)) {
      downgrade(diags, 'pgschema', 'downgrade-type',
        `Property '${owner}.${p.name}' has type ${p.type}, which PG-Schema has no dedicated type for. Declared as ${GQL_TYPES[p.type]}.`,
        p.loc)
    }
    if (p.enum) {
      downgrade(diags, 'pgschema', 'downgrade-enum',
        `Property '${owner}.${p.name}' is constrained to enum '${p.enum}', which PG-Schema has no way to express.`,
        p.loc)
    }
    // PG-Schema property records are mandatory unless marked OPTIONAL.
    return `${p.required ? '' : 'OPTIONAL '}${p.name} ${valueType(p)}`
  }).join(', ')
}

function mixinType(mixin: MixinIR, diags: Diagnostic[]): string {
  // A mixin contributes properties but no label, which is exactly an abstract
  // PG-Schema type declared without one.
  return `  ABSTRACT (${typeName(mixin.name)} {${propertyList(mixin.name, mixin.props, diags)}}),`
}

function nodeType(node: NodeTypeIR, diags: Diagnostic[]): string {
  const inherited = [
    ...(node.extends ? [typeName(node.extends)] : []),
    ...node.mixins.map(typeName),
  ]
  const spec = [...inherited, node.name].join(' & ')
  const props = propertyList(node.name, ownProps(node.props), diags)
  // A trailing OPEN inside the property block is how PG-Schema says that properties
  // beyond the declared ones are admitted.
  const parts = [props, node.open ? 'OPEN' : ''].filter(Boolean)
  const body = parts.length > 0 ? ` {${parts.join(', ')}}` : ''
  return `  ${node.abstract ? 'ABSTRACT ' : ''}(${typeName(node.name)}: ${spec}${body}),`
}

function edgeType(edge: EdgeTypeIR, diags: Diagnostic[]): string[] {
  const lines: string[] = []
  if (!isUnconstrained(edge.cardinality)) {
    // PG-Keys can state participation constraints, but this emitter does not generate
    // them: the syntax is not settled enough to emit something a reader could rely on.
    downgrade(diags, 'pgschema', 'downgrade-cardinality',
      `Edge type '${edge.name}' declares ${describeCardinality(edge.cardinality)} cardinality. It is written as a comment rather than a PG-Keys participation constraint.`,
      edge.loc)
    lines.push(`  // UNENFORCED: ${edge.name} is ${describeCardinality(edge.cardinality)} in the model.`)
  }
  const props = propertyList(edge.name, edge.props, diags)
  const body = props.length > 0 ? ` {${props}}` : ''
  lines.push(`  (:${typeName(edge.from)})-[${typeName(edge.name)}: ${edge.name}${body}]->(:${typeName(edge.to)}),`)
  return lines
}

/**
 * PG-Keys constraints. A key is declared once on the type that owns it; subtypes
 * inherit it, so re-stating it on every descendant would be redundant.
 */
function keyConstraints(model: ModelIR): string[] {
  const out: string[] = []
  for (const node of model.nodes) {
    if (node.key.length === 0 || node.keyInheritedFrom) continue
    const refs = node.key.map((k) => `x.${k}`)
    const target = node.key.length > 1 ? `(${refs.join(', ')})` : refs[0]
    out.push(`  FOR (x: ${typeName(node.name)}) EXCLUSIVE MANDATORY SINGLETON ${target},`)
  }
  for (const node of model.nodes) {
    for (const p of ownProps(node.props)) {
      if (!p.unique || node.key.includes(p.name)) continue
      out.push(`  FOR (x: ${typeName(node.name)}) EXCLUSIVE SINGLETON x.${p.name},`)
    }
  }
  return out
}

export function emitPgSchema(model: ModelIR, _options: EmitOptions = {}): EmitResult {
  const diagnostics: Diagnostic[] = []
  const graphType = `${lowerCamel(model.namespace.prefix || 'model')}Type`

  const parts: string[] = [
    '// Generated by lpg-modeler. Target: pgschema.',
    `// Model: ${model.namespace.prefix} <${model.namespace.iri}>`,
    '//',
    '// PG-Schema (LDBC Property Graph Schema Working Group). STRICT means every node and',
    '// edge must conform to a declared type: the same closed-world reading this metamodel',
    '// already has. Abstract types and mixins survive as ABSTRACT types, so nothing is',
    '// flattened. See lat.md/emitters#PG-Schema Target.',
    '',
    `CREATE GRAPH TYPE ${graphType} STRICT {`,
  ]

  const body: string[] = []
  for (const mixin of [...model.mixins].sort((a, b) => a.name.localeCompare(b.name))) {
    body.push(mixinType(mixin, diagnostics))
  }
  // Parents before children, so a type reference is always already declared.
  const ordered = [...model.nodes].sort((a, b) =>
    a.ancestors.length - b.ancestors.length || a.name.localeCompare(b.name))
  for (const node of ordered) body.push(nodeType(node, diagnostics))
  for (const edge of model.edges) body.push(...edgeType(edge, diagnostics))
  body.push(...keyConstraints(model))

  const last = body.length - 1
  if (last >= 0) body[last] = body[last]!.replace(/,$/, '')
  parts.push(...body, '}')

  reportUnsupportedConstraints(diagnostics, 'pgschema', model, PGSCHEMA_CAPABILITIES)

  return { target: 'pgschema', extension: 'pgs', content: parts.join('\n') + '\n', diagnostics }
}
