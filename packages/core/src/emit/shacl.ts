import type { Diagnostic, EdgeTypeIR, EnumIR, ModelIR, NodeTypeIR, PropertyIR } from '../ir'
import { concreteNodes, endpointIsSingular, findEnum } from '../ir'
import { downgrade, type Capabilities, type EmitOptions, type EmitResult } from '../capabilities'
import { LOSSY_TYPES, XSD, mapEdge, mapEdges, prefixHeader, term } from './reify'

/**
 * SHACL is closed-world validation, so it means what an LPG schema means: a shape
 * genuinely rejects data that violates the model. See lat.md/emitters#SHACL Shapes.
 */
export const SHACL_CAPABILITIES: Capabilities = {
  target: 'shacl',
  multiLabel: true,
  inheritance: 'subclass',
  requiredConstraint: 'enforced',
  uniqueConstraint: 'unsupported',
  compositeKey: 'native',
  edgeProps: 'reified',
  nestedEdges: false,
  listProps: 'native',
  enums: 'enforced',
  openTypes: 'native',
  cardinality: 'enforced',
}

/** A Turtle list of quoted literals, for `sh:in`. */
const valueList = (e: EnumIR) => `( ${e.values.map((v) => `"${v}"`).join(' ')} )`

function propertyShape(
  model: ModelIR, prefix: string, owner: string, p: PropertyIR, isKey: boolean,
  diags: Diagnostic[],
): string[] {
  const lines = [
    '  sh:property [',
    `    sh:path ${prefix}:${p.name} ;`,
    `    sh:datatype ${XSD[p.type]} ;`,
  ]
  // A list property is exactly one that may hold more than one value.
  if (!p.list) lines.push('    sh:maxCount 1 ;')
  if (p.required || isKey) lines.push('    sh:minCount 1 ;')

  if (p.enum) {
    const declared = findEnum(model, p.enum)
    // An unresolved enum is already an error from validation; emit nothing rather than
    // an `sh:in ()` that would reject every value.
    if (declared) lines.push(`    sh:in ${valueList(declared)} ;`)
  }
  if (LOSSY_TYPES.has(p.type)) {
    downgrade(diags, 'shacl', 'downgrade-type',
      `Property '${owner}.${p.name}' has type ${p.type}, which RDF has no dedicated datatype for. Constrained as ${XSD[p.type]}.`,
      p.loc)
    lines.push(`    # DOWNGRADE: model type '${p.type}' has no RDF datatype; using ${XSD[p.type]}.`)
  }
  if (p.unique && !isKey) {
    downgrade(diags, 'shacl', 'downgrade-unique',
      `Property '${owner}.${p.name}' is unique, which core SHACL cannot express: uniqueness across all instances needs a SPARQL-based constraint.`,
      p.loc)
    lines.push(`    # UNENFORCED: '${p.name}' is unique in the model; core SHACL cannot express`)
    lines.push(`    # uniqueness across instances without a SPARQL constraint.`)
  }
  lines.push('  ] ;')
  return lines
}

/** The property an edge is reached by: its own for a plain edge, the shortcut otherwise. */
function relationTerm(edge: EdgeTypeIR): string {
  const m = mapEdge(edge)
  return term(edge, m.kind === 'plain' ? m.property : m.shortcutProperty)
}

/** Edges leaving this type, including those declared on an ancestor. */
function outgoing(model: ModelIR, node: NodeTypeIR): EdgeTypeIR[] {
  const own = new Set([node.name, ...node.ancestors])
  return model.edges.filter((e) => own.has(e.from))
}

/**
 * A shape for the relation itself. It has to be emitted for every edge, not only the
 * constrained ones, because a closed shape rejects any property it does not name.
 */
function relationShape(model: ModelIR, node: NodeTypeIR, edge: EdgeTypeIR): string[] {
  const lines = [
    '  sh:property [',
    `    sh:path ${relationTerm(edge)} ;`,
    `    # (:${edge.from})-[:${edge.name}]->(:${edge.to})`,
  ]
  if (endpointIsSingular(edge.cardinality).to) {
    lines.push(`    # ${edge.cardinality}: each ${node.name} has at most one ${edge.to}.`)
    lines.push('    sh:maxCount 1 ;')
  }
  lines.push('  ] ;')
  return lines
}

/**
 * The other half of a cardinality constraint. `one-to-many` bounds how many sources a
 * single target may have, which is an inverse path from the target's shape.
 */
function inverseShapes(model: ModelIR, node: NodeTypeIR): string[] {
  const own = new Set([node.name, ...node.ancestors])
  const lines: string[] = []
  for (const edge of model.edges) {
    if (!own.has(edge.to) || !endpointIsSingular(edge.cardinality).from) continue
    lines.push(
      '  sh:property [',
      `    sh:path [ sh:inversePath ${relationTerm(edge)} ] ;`,
      `    # ${edge.cardinality}: each ${node.name} has at most one incoming ${edge.name}.`,
      '    sh:maxCount 1 ;',
      '  ] ;')
  }
  return lines
}

function nodeShape(model: ModelIR, node: NodeTypeIR, diags: Diagnostic[]): string[] {
  const shape = `${term(node)}Shape`
  const lines = [`${shape} a sh:NodeShape ;`, `  sh:targetClass ${term(node)} ;`]

  if (!node.open) {
    // Closure is only sound because every declared property, relations included, gets a
    // shape below; sh:closed rejects anything this shape does not name.
    lines.push('  sh:closed true ;', '  sh:ignoredProperties ( rdf:type ) ;')
  }
  for (const p of node.props) {
    lines.push(...propertyShape(model, node.prefix, node.name, p, node.key.includes(p.name), diags))
  }
  for (const edge of outgoing(model, node)) lines.push(...relationShape(model, node, edge))
  lines.push(...inverseShapes(model, node))

  const last = lines.length - 1
  lines[last] = (lines[last] ?? '').replace(/ ;$/, ' .')
  return lines
}

export function emitShacl(model: ModelIR, _options: EmitOptions = {}): EmitResult {
  const diagnostics: Diagnostic[] = []
  const parts: string[] = [
    '# Generated by lpg-modeler. Target: shacl.',
    '#',
    '# SHACL carries the constraints because it is closed-world, and so means what the',
    '# model means. The ontology alongside it asserts only what is safe to assert.',
    '# See lat.md/emitters#SHACL Shapes.',
    '',
    ...prefixHeader(model, [
      ['sh', 'http://www.w3.org/ns/shacl#'],
      ['xsd', 'http://www.w3.org/2001/XMLSchema#'],
      ['rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
    ]),
    '',
  ]

  for (const node of concreteNodes(model)) {
    parts.push(...nodeShape(model, node, diagnostics), '')
  }

  // An edge carrying properties is reified into a class, so its properties get a shape.
  for (const m of mapEdges(model)) {
    if (m.kind !== 'reified') continue
    const shape = `${term(m.edge, m.className)}Shape`
    const lines = [
      `# Reified from (:${m.edge.from})-[:${m.edge.name}]->(:${m.edge.to})`,
      `${shape} a sh:NodeShape ;`,
      `  sh:targetClass ${term(m.edge, m.className)} ;`,
      '  sh:property [',
      `    sh:path ${term(m.edge, m.subjectProperty)} ;`,
      '    sh:minCount 1 ; sh:maxCount 1 ;',
      '  ] ;',
      '  sh:property [',
      `    sh:path ${term(m.edge, m.objectProperty)} ;`,
      '    sh:minCount 1 ; sh:maxCount 1 ;',
      '  ] ;',
    ]
    for (const p of m.edge.props) {
      lines.push(...propertyShape(model, m.edge.prefix, m.edge.name, p, false, diagnostics))
    }
    const last = lines.length - 1
    lines[last] = (lines[last] ?? '').replace(/ ;$/, ' .')
    parts.push(...lines, '')
  }

  return { target: 'shacl', extension: 'ttl', content: parts.join('\n'), diagnostics }
}
