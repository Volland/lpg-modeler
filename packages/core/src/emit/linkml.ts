import type { Diagnostic, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR, ScalarType } from '../ir'
import {
  constraintDowngrade, downgrade,
  type Capabilities, type EmitOptions, type EmitResult,
} from '../capabilities'
import { describeCardinality, endpointIsSingular } from '../ir'
import { collectPrefixes, mapEdges, term, type EdgeMapping } from './reify'

/**
 * LinkML, the linked-data modelling language. Classes, slots, `is_a`, and `mixins` line
 * up with this metamodel almost directly, which is what makes the target worth having:
 * it opens the LinkML generator ecosystem to a model authored here.
 *
 * The one real mismatch is that LinkML has no binary edge carrying properties, so the
 * gradual reification of the RDF targets applies here too — but without the shortcut
 * property, which would imply a second place the same fact is written.
 * See lat.md/emitters#LinkML Target.
 */
export const LINKML_CAPABILITIES: Capabilities = {
  target: 'linkml',
  multiLabel: false,
  inheritance: 'subclass',
  requiredConstraint: 'enforced',
  uniqueConstraint: 'enforced',
  compositeKey: 'native',
  edgeProps: 'reified',
  nestedEdges: false,
  valueConstraints: 'partial',
  namedConstraints: 'unsupported',
  rawPassthrough: false,
  listProps: 'native',
  enums: 'enforced',
  openTypes: 'unsupported',
  cardinality: 'enforced',
}

const RANGES: Record<ScalarType, string> = {
  string: 'string',
  int8: 'integer', int16: 'integer', int32: 'integer', int: 'integer', int128: 'integer',
  uint8: 'integer', uint16: 'integer', uint32: 'integer', uint64: 'integer',
  float32: 'float', float: 'float', decimal: 'decimal',
  boolean: 'boolean',
  date: 'date', datetime: 'datetime', zoneddatetime: 'datetime',
  duration: 'string',
  uuid: 'string', blob: 'string', json: 'string',
}

/**
 * Scalar types LinkML has no dedicated range for; each is a reported downgrade. The
 * integer widths are not among them: LinkML has one `integer`, and a width is a storage
 * detail there rather than a different type.
 */
const LOSSY_TYPES = new Set<ScalarType>(['uuid', 'json', 'duration', 'blob'])

/** Properties this class declares itself. `is_a` and `mixins` bring in the rest. */
const ownProps = (props: PropertyIR[]) => props.filter((p) => !p.inheritedFrom)

function attribute(
  owner: string, ownerPrefix: string, p: PropertyIR, isIdentifier: boolean, diags: Diagnostic[],
): string[] {
  const lines: string[] = []
  if (LOSSY_TYPES.has(p.type)) {
    downgrade(diags, 'linkml', 'downgrade-type',
      `Property '${owner}.${p.name}' has type ${p.type}, which LinkML has no dedicated range for. Declared as ${RANGES[p.type]}.`,
      p.loc)
    lines.push(`        # DOWNGRADE: model type '${p.type}' has no LinkML range; using ${RANGES[p.type]}.`)
  }
  lines.push(`      ${p.name}:`)
  if (ownerPrefix) lines.push(`        slot_uri: ${ownerPrefix}:${p.name}`)
  // An enum is a LinkML range in its own right, so it replaces the scalar range.
  lines.push(`        range: ${p.enum ?? RANGES[p.type]}`)
  if (p.list) lines.push('        multivalued: true')
  // LinkML has value bounds and a pattern, but no string length.
  if (p.min !== undefined) lines.push(`        minimum_value: ${p.min}`)
  if (p.max !== undefined) lines.push(`        maximum_value: ${p.max}`)
  if (p.pattern !== undefined) lines.push(`        pattern: ${JSON.stringify(p.pattern)}`)
  if (p.minLength !== undefined || p.maxLength !== undefined) {
    constraintDowngrade(diags, 'linkml', 'downgrade-value-constraint',
      `Property '${owner}.${p.name}' bounds its length, which LinkML has no slot facet for.`,
      p.loc)
    lines.push(`        # DOWNGRADE: length bound unenforced; LinkML has no facet for it.`)
  }
  // identifier already implies required and unique, so do not restate them.
  // identifier already implies required and unique. Uniqueness of anything else is a
  // class-level unique_keys entry, which is the only mechanism LinkML has for it.
  if (isIdentifier) lines.push('        identifier: true')
  else if (p.required) lines.push('        required: true')
  return lines
}

/** Edges with no properties become a plain slot on the source class. */
function plainEdgeSlots(model: ModelIR, mappings: EdgeMapping[]): Map<string, EdgeTypeIR[]> {
  const bySource = new Map<string, EdgeTypeIR[]>()
  for (const m of mappings) {
    if (m.kind !== 'plain') continue
    if (!model.nodes.some((n) => n.name === m.edge.from)) continue
    const list = bySource.get(m.edge.from) ?? []
    list.push(m.edge)
    bySource.set(m.edge.from, list)
  }
  return bySource
}

function classBlock(
  node: NodeTypeIR, outgoing: EdgeTypeIR[], mappings: EdgeMapping[], diags: Diagnostic[],
): string[] {
  const lines = [`  ${node.name}:`]
  if (node.iri) lines.push(`    class_uri: ${term(node)}`)
  if (node.abstract) lines.push('    abstract: true')
  if (node.open) {
    downgrade(diags, 'linkml', 'downgrade-open',
      `Node type '${node.name}' is open, but a LinkML class declares a fixed set of attributes.`,
      node.loc)
    lines.push(`    # DOWNGRADE: '${node.name}' is open in the model; this class is not.`)
  }
  if (node.extends) lines.push(`    is_a: ${node.extends}`)
  if (node.constraints.length > 0) {
    constraintDowngrade(diags, 'linkml', 'downgrade-named-constraint',
      `Node type '${node.name}' declares ${node.constraints.length} named constraint(s), which LinkML has no cross-slot assertion for. The SHACL artifact carries them.`,
      node.loc)
    lines.push(`    # DOWNGRADE: ${node.constraints.map((k) => k.name).join(', ')} unenforced here.`)
  }
  if (node.rawShacl) {
    constraintDowngrade(diags, 'linkml', 'downgrade-raw-shacl',
      `Node type '${node.name}' carries a raw SHACL fragment, which only the shacl target can use.`,
      node.loc)
  }
  if (node.mixins.length > 0) {
    lines.push('    mixins:')
    for (const m of node.mixins) lines.push(`      - ${m}`)
  }

  // LinkML's identifier is single-valued, so a composite key becomes a unique_keys
  // entry instead. Every other unique property needs one too.
  const composite = node.key.length > 1
  const uniqueKeys: Array<[string, string[]]> = []
  if (composite && !node.keyInheritedFrom) uniqueKeys.push(['primary_key', node.key])
  for (const p of ownProps(node.props)) {
    if (p.unique && !node.key.includes(p.name)) uniqueKeys.push([`${p.name}_key`, [p.name]])
  }
  if (uniqueKeys.length > 0) {
    lines.push('    unique_keys:')
    for (const [name, slots] of uniqueKeys) {
      lines.push(`      ${name}:`, '        unique_key_slots:')
      for (const slot of slots) lines.push(`          - ${slot}`)
    }
  }

  const own = ownProps(node.props)
  const taken = new Set(node.props.map((p) => p.name))
  const attrs: string[] = []
  for (const p of own) {
    const isIdentifier = !composite && !node.keyInheritedFrom && node.key.includes(p.name)
    attrs.push(...attribute(node.name, node.prefix, p, isIdentifier, diags))
  }
  for (const edge of outgoing) {
    const mapping = mappings.find((m) => m.edge === edge)
    if (!mapping || mapping.kind !== 'plain') continue
    // A relation slot must not collide with a property of the same name.
    const name = taken.has(mapping.property) ? `${mapping.property}Rel` : mapping.property
    // A slot carries an upper bound of one, as `multivalued: false`, and a lower bound
    // of one, as `required`. An exact count beyond that has no LinkML spelling.
    const b = edge.cardinality.to
    const many = !endpointIsSingular(edge.cardinality).to
    attrs.push(
      `      ${name}:`,
      `        slot_uri: ${term(edge)}`,
      `        range: ${edge.to}`,
      `        multivalued: ${many}`)
    if (b.min > 0) attrs.push('        required: true')
    if ((b.max !== null && b.max > 1) || b.min > 1) {
      downgrade(diags, 'linkml', 'downgrade-cardinality',
        `Edge type '${edge.name}' declares ${describeCardinality(edge.cardinality)} cardinality. A LinkML slot expresses only 'multivalued' and 'required', so the exact bound is unenforced.`,
        edge.loc)
      attrs.push(`        # DOWNGRADE: ${describeCardinality(edge.cardinality)}; exact bound unenforced.`)
    }
  }
  if (attrs.length > 0) lines.push('    attributes:', ...attrs)
  return lines
}

function reifiedClass(mapping: EdgeMapping, diags: Diagnostic[]): string[] {
  if (mapping.kind !== 'reified') return []
  const { edge, className, subjectProperty, objectProperty } = mapping
  downgrade(diags, 'linkml', 'downgrade-edge-props',
    `Edge type '${edge.name}' carries properties, which LinkML has no binary relation for. It is reified as class '${className}' with '${subjectProperty}' and '${objectProperty}' endpoints.`,
    edge.loc)
  const lines = [
    `  ${className}:`,
    `    class_uri: ${term(edge, className)}`,
    `    description: Reified from edge type ${edge.name}, which carries properties.`,
    '    attributes:',
    `      ${subjectProperty}:`,
    `        range: ${edge.from}`,
    '        required: true',
    `      ${objectProperty}:`,
    `        range: ${edge.to}`,
    '        required: true',
  ]
  for (const p of edge.props) {
    lines.push(...attribute(edge.name, edge.prefix, p, false, diags))
  }
  return lines
}

export function emitLinkml(model: ModelIR, _options: EmitOptions = {}): EmitResult {
  const diagnostics: Diagnostic[] = []
  const mappings = mapEdges(model)
  const bySource = plainEdgeSlots(model, mappings)
  // A LinkML schema id is a bare URI, while a namespace IRI ends in a separator.
  const schemaId = model.namespace.iri.replace(/[#/]$/, '')

  const parts: string[] = [
    '# Generated by lpg-modeler. Target: linkml.',
    '#',
    '# Every class and slot carries the IRI it has in this model, so identity survives the',
    '# round trip into the LinkML generator ecosystem. Edge types that carry properties are',
    '# reified: LinkML has no binary relation that can hold them.',
    '',
    `id: ${schemaId}`,
    `name: ${model.namespace.prefix}`,
    'prefixes:',
    '  linkml: https://w3id.org/linkml/',
  ]
  for (const [prefix, iri] of [...collectPrefixes(model)].sort()) {
    parts.push(`  ${prefix}: ${iri}`)
  }
  parts.push(
    `default_prefix: ${model.namespace.prefix}`,
    'default_range: string',
    'imports:',
    '  - linkml:types',
    '',
    'classes:')

  for (const mixin of [...model.mixins].sort((a, b) => a.name.localeCompare(b.name))) {
    parts.push(`  ${mixin.name}:`, '    mixin: true')
    if (mixin.props.length > 0) {
      parts.push('    attributes:')
      for (const p of mixin.props) parts.push(...attribute(mixin.name, '', p, false, diagnostics))
    }
  }

  const ordered = [...model.nodes].sort((a, b) =>
    a.ancestors.length - b.ancestors.length || a.name.localeCompare(b.name))
  for (const node of ordered) {
    parts.push(...classBlock(node, bySource.get(node.name) ?? [], mappings, diagnostics))
  }
  for (const m of mappings) parts.push(...reifiedClass(m, diagnostics))

  if (model.enums.length > 0) {
    parts.push('', 'enums:')
    for (const e of model.enums) {
      parts.push(`  ${e.name}:`)
      if (e.iri) parts.push(`    enum_uri: ${e.prefix}:${e.name}`)
      parts.push('    permissible_values:')
      for (const v of e.values) parts.push(`      ${v}:`)
    }
  }

  return { target: 'linkml', extension: 'yaml', content: parts.join('\n') + '\n', diagnostics }
}
