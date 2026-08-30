import type { Diagnostic, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR } from '../ir'
import { GQL_TYPES, concreteNodes, describeCardinality, isUnconstrained } from '../ir'
import {
  downgrade, reportUnsupportedConstraints,
  type Capabilities, type EmitOptions, type EmitResult,
} from '../capabilities'
import { lowerCamel } from './reify'

/**
 * GQL graph types, per ISO/IEC 39075. A graph type is a list of element types, each
 * naming an identifying label, the labels it implies, and its typed properties.
 *
 * Label implication is what carries the hierarchy: a concrete type is identified by
 * its own label and implies every ancestor's, so an edge declared on an abstract
 * endpoint needs no cross-product expansion the way the Ladybug target does.
 * See lat.md/emitters#GQL Target.
 */
export const GQL_CAPABILITIES: Capabilities = {
  target: 'gql',
  multiLabel: true,
  inheritance: 'labels',
  requiredConstraint: 'enforced',
  uniqueConstraint: 'enforced',
  compositeKey: 'unsupported',
  edgeProps: 'native',
  nestedEdges: false,
  valueConstraints: 'unsupported',
  namedConstraints: 'unsupported',
  rawPassthrough: false,
  listProps: 'native',
  enums: 'unsupported',
  openTypes: 'unsupported',
  cardinality: 'unsupported',
}

/** Person -> personType, OWNS -> ownsType. Element type names are lower camel. */
const typeName = (name: string) => `${lowerCamel(name)}Type`

/** Scalar types GQL has no dedicated value type for; each is a reported downgrade. */
const LOSSY_TYPES = new Set(['uuid', 'json'])

/** A value type, wrapped in LIST<…> when the property holds many. */
const valueType = (p: PropertyIR) =>
  p.list ? `LIST<${GQL_TYPES[p.type]}>` : GQL_TYPES[p.type]

/** One property record, with its downgrade comment above it and no separator. */
function propertyEntry(
  owner: string, p: PropertyIR, marker: string, diags: Diagnostic[],
): string {
  const lines: string[] = []
  if (LOSSY_TYPES.has(p.type)) {
    downgrade(diags, 'gql', 'downgrade-type',
      `Property '${owner}.${p.name}' has type ${p.type}, which GQL has no dedicated value type for. Declared as ${GQL_TYPES[p.type]}.`,
      p.loc)
    lines.push(`    // DOWNGRADE: model type '${p.type}' has no GQL value type; using ${GQL_TYPES[p.type]}.`)
  }
  if (p.enum) {
    downgrade(diags, 'gql', 'downgrade-enum',
      `Property '${owner}.${p.name}' is constrained to enum '${p.enum}', which a GQL element type has no way to express.`,
      p.loc)
    lines.push(`    // UNENFORCED: '${p.name}' is limited to enum '${p.enum}' in the model.`)
  }
  lines.push(`    ${p.name} :: ${valueType(p)}${p.required ? ' NOT NULL' : ''}${marker}`)
  return lines.join('\n')
}

/**
 * A property block, or the empty string when the type declares no properties. Leading
 * comments are not list entries, so they must sit outside the comma-separated join.
 */
function propertyBlock(entries: string[], comments: string[] = []): string {
  if (entries.length === 0 && comments.length === 0) return ''
  const body = [...comments, ...(entries.length > 0 ? [entries.join(',\n')] : [])]
  return ` {\n${body.join('\n')}\n  }`
}

function nodeElementType(node: NodeTypeIR, diags: Diagnostic[]): string {
  // Ancestors become implied labels, so a Person node is also a :Party. Mixins are
  // property bundles rather than labels, so they contribute properties only — the
  // same reading the Neo4j target takes.
  const implied = node.ancestors.length > 0 ? ` :${node.ancestors.join('&')}` : ''

  const comments: string[] = []
  if (node.open) {
    downgrade(diags, 'gql', 'downgrade-open',
      `Node type '${node.name}' is open, but a GQL element type declares a fixed property set.`,
      node.loc)
    comments.push(`    // DOWNGRADE: '${node.name}' is open in the model; this element type is not.`)
  }
  const composite = node.key.length > 1
  if (composite) {
    downgrade(diags, 'gql', 'downgrade-composite-key',
      `Node type '${node.name}' declares a composite key (${node.key.join(', ')}). A GQL element type marks a key on a single property, so the composite key is not expressed.`,
      node.loc)
    comments.push(`    // DOWNGRADE: composite key (${node.key.join(', ')}) is not expressible; unenforced.`)
  }

  const entries = node.props.map((p) => {
    const isKey = !composite && node.key.includes(p.name)
    const marker = isKey ? ' IS NODE KEY' : p.unique ? ' IS NODE UNIQUE' : ''
    return propertyEntry(node.name, p, marker, diags)
  })
  return `  (${typeName(node.name)}: ${node.name} =>${implied}${propertyBlock(entries, comments)})`
}

function edgeElementType(edge: EdgeTypeIR, diags: Diagnostic[]): string {
  const comments: string[] = []
  if (!isUnconstrained(edge.cardinality)) {
    downgrade(diags, 'gql', 'downgrade-cardinality',
      `Edge type '${edge.name}' declares ${describeCardinality(edge.cardinality)} cardinality, which a GQL element type has no way to express.`,
      edge.loc)
    comments.push(`    // UNENFORCED: ${describeCardinality(edge.cardinality)} in the model.`)
  }
  const entries = edge.props.map((p) => propertyEntry(edge.name, p, '', diags))
  const block = propertyBlock(entries, comments)
  return `  (:${edge.from})-[${typeName(edge.name)}: ${edge.name} =>${block}]->(:${edge.to})`
}

export function emitGql(model: ModelIR, _options: EmitOptions = {}): EmitResult {
  const diagnostics: Diagnostic[] = []
  const graphType = `${lowerCamel(model.namespace.prefix || 'model')}GraphType`
  const abstract = model.nodes.filter((n) => n.abstract)

  const parts: string[] = [
    '// Generated by lpg-modeler. Target: gql.',
    `// Model: ${model.namespace.prefix} <${model.namespace.iri}>`,
    '//',
    '// Element types follow the GQL graph type grammar of ISO/IEC 39075. Engines differ',
    '// on the statement that installs a graph type: Neo4j writes the same body after',
    '// ALTER CURRENT GRAPH TYPE SET. Adjust the wrapper, not the element types.',
  ]
  if (abstract.length > 0) {
    parts.push(
      '//',
      `// Abstract types (${abstract.map((n) => n.name).join(', ')}) get no element type.`,
      '// They exist only as implied labels, which is how the hierarchy is carried.')
  }
  parts.push('', `CREATE GRAPH TYPE ${graphType} AS {`)

  const elements = [
    ...concreteNodes(model).map((n) => nodeElementType(n, diagnostics)),
    ...model.edges.map((e) => edgeElementType(e, diagnostics)),
  ]
  parts.push(elements.join(',\n'), '}')

  reportUnsupportedConstraints(diagnostics, 'gql', model, GQL_CAPABILITIES)

  return { target: 'gql', extension: 'gql', content: parts.join('\n') + '\n', diagnostics }
}
