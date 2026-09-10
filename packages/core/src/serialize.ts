import {
  formatValueType, typeParams,
  type ConstraintIR, type EdgeTypeIR, type EnumIR, type MixinIR,
  type ModelIR, type NodeTypeIR, type PropertyIR, type ScalarType,
} from './ir'

/**
 * Writes a resolved model back out as `.lpg.yaml` source. The inverse of parsing, and
 * the surface every importer ends at. See lat.md/importers#Serializing a Model.
 *
 * Hand-built lines rather than a YAML library, for the same reason `serializeViews` is:
 * the format uses inline flow maps for properties, which a generic dumper would expand
 * into a block map per property and turn a readable file into a tall one.
 *
 * Key order is fixed rather than incidental, so serializing the same model twice gives
 * the same bytes -- which is what a lockfile diff would later be built on. See
 * lat.md/architecture#Still deferred.
 */

/**
 * One unambiguous spelling per scalar, used when writing a type back out. `GQL_TYPES`
 * cannot serve: it maps `uuid` and `json` both onto `STRING`, so a file written through
 * it would not read back as the model it came from.
 */
const SPELLING: Record<ScalarType, string> = {
  string: 'STRING',
  int8: 'INT8', int16: 'INT16', int32: 'INT32', int: 'INT64', int128: 'INT128',
  uint8: 'UINT8', uint16: 'UINT16', uint32: 'UINT32', uint64: 'UINT64',
  float32: 'FLOAT32', float: 'DOUBLE', decimal: 'DECIMAL',
  boolean: 'BOOLEAN',
  date: 'DATE', datetime: 'TIMESTAMP', zoneddatetime: 'ZONED_DATETIME',
  duration: 'DURATION',
  uuid: 'UUID', blob: 'BLOB', json: 'JSON',
}

const spell = (s: ScalarType) => SPELLING[s]

/** A YAML scalar that is safe unquoted, or a quoted one when it is not. */
function scalar(v: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(v) ? v : JSON.stringify(v)
}

/**
 * A property as an inline flow map. Fields appear in a fixed order rather than in
 * whatever order they happen to be set, so two serializations agree.
 */
function property(p: PropertyIR): string {
  const parts = [`id: ${p.id}`]
  // A composite carries its own spelling, including any list suffix; `type` alone holds
  // only the scalar it degrades to, which would lose the structure on the way out. A
  // decimal's `(precision, scale)` rides in the spelling too -- that is where the type
  // parser reads it from, so writing the pair as sibling keys would drop it silently.
  const written = p.composite
    ? formatValueType(p.composite, spell)
    : `${spell(p.type)}${typeParams(p)}`
  // `DOUBLE[128]` and `STRUCT(a INT64)` both carry characters that start a flow
  // collection, so an unquoted type would end the property map early.
  parts.push(`type: ${scalar(written)}`)
  if (p.list && !p.composite) parts.push('list: true')
  if (p.enum) parts.push(`enum: ${scalar(p.enum)}`)
  if (p.required) parts.push('required: true')
  if (p.unique) parts.push('unique: true')
  if (p.min !== undefined) parts.push(`min: ${p.min}`)
  if (p.max !== undefined) parts.push(`max: ${p.max}`)
  if (p.minLength !== undefined) parts.push(`minLength: ${p.minLength}`)
  if (p.maxLength !== undefined) parts.push(`maxLength: ${p.maxLength}`)
  if (p.pattern !== undefined) parts.push(`pattern: ${JSON.stringify(p.pattern)}`)
  return `{ ${parts.join(', ')} }`
}

/** Only what the type declares itself: an inherited property is written by its owner. */
function ownProps(props: PropertyIR[]): PropertyIR[] {
  return props.filter((p) => !p.inheritedFrom)
}

function propsBlock(props: PropertyIR[], indent: string): string[] {
  const own = ownProps(props)
  if (own.length === 0) return []
  const lines = [`${indent}props:`]
  for (const p of own) lines.push(`${indent}  ${scalar(p.name)}: ${property(p)}`)
  return lines
}

function constraintBlock(constraints: ConstraintIR[], indent: string): string[] {
  if (constraints.length === 0) return []
  const lines = [`${indent}constraints:`]
  for (const k of constraints) {
    const a = k.assert
    let assertion: string
    switch (a.kind) {
      case 'lessThan': case 'lessThanOrEquals': case 'equals': case 'disjoint':
        assertion = `{ ${a.kind}: [${scalar(a.left)}, ${scalar(a.right)}] }`
        break
      case 'atLeastOne': case 'exactlyOne':
        assertion = `{ ${a.kind}: [${a.props.map(scalar).join(', ')}] }`
        break
      case 'count': {
        const parts = [`edge: ${scalar(a.edge)}`]
        if (a.of !== undefined) parts.push(`of: ${scalar(a.of)}`)
        if (a.min !== undefined) parts.push(`min: ${a.min}`)
        if (a.max !== undefined) parts.push(`max: ${a.max}`)
        assertion = `{ count: { ${parts.join(', ')} } }`
        break
      }
    }
    lines.push(`${indent}  - id: ${k.id}`)
    lines.push(`${indent}    name: ${scalar(k.name)}`)
    lines.push(`${indent}    assert: ${assertion}`)
    if (k.message !== undefined) lines.push(`${indent}    message: ${JSON.stringify(k.message)}`)
  }
  return lines
}

/** `*` for an unbounded end, `2` for an exact count, `1..*` and `1..2` for a range. */
function bound(b: { min: number; max: number | null }): string {
  if (b.max === null) return b.min === 0 ? '*' : `${b.min}..*`
  return b.min === b.max ? `${b.max}` : `${b.min}..${b.max}`
}

/** Omitted entirely when both ends are unbounded, which is the default. */
function cardinality(e: EdgeTypeIR): string[] {
  const { from, to } = e.cardinality
  const isDefault = from.min === 0 && from.max === null && to.min === 0 && to.max === null
  if (isDefault) return []
  return [`    cardinality: { from: "${bound(from)}", to: "${bound(to)}" }`]
}

function enumsBlock(enums: EnumIR[]): string[] {
  if (enums.length === 0) return []
  const lines = ['', 'enums:']
  for (const e of enums) {
    lines.push(`  ${scalar(e.name)}:`)
    lines.push(`    id: ${e.id}`)
    lines.push(`    values: [${e.values.map((v) => JSON.stringify(v)).join(', ')}]`)
  }
  return lines
}

function mixinsBlock(mixins: MixinIR[]): string[] {
  if (mixins.length === 0) return []
  const lines = ['', 'mixins:']
  for (const m of mixins) {
    lines.push(`  ${scalar(m.name)}:`)
    lines.push(`    id: ${m.id}`)
    lines.push(...propsBlock(m.props, '    '))
  }
  return lines
}

function nodesBlock(nodes: NodeTypeIR[]): string[] {
  if (nodes.length === 0) return []
  const lines = ['', 'nodes:']
  for (const n of nodes) {
    lines.push(`  ${scalar(n.name)}:`)
    lines.push(`    id: ${n.id}`)
    if (n.abstract) lines.push('    abstract: true')
    if (n.open) lines.push('    open: true')
    if (n.extends) lines.push(`    extends: ${scalar(n.extends)}`)
    if (n.mixins.length > 0) lines.push(`    mixins: [${n.mixins.map(scalar).join(', ')}]`)
    // A key reached through an ancestor is that ancestor's declaration, not this one's.
    if (n.key.length > 0 && !n.keyInheritedFrom) {
      lines.push(`    key: [${n.key.map(scalar).join(', ')}]`)
    }
    lines.push(...propsBlock(n.props, '    '))
    lines.push(...constraintBlock(n.constraints, '    '))
    if (n.rawShacl !== undefined) {
      lines.push('    shacl: |')
      for (const l of n.rawShacl.replace(/\n+$/, '').split('\n')) lines.push(`      ${l}`)
    }
  }
  return lines
}

function edgesBlock(edges: EdgeTypeIR[]): string[] {
  if (edges.length === 0) return []
  const lines = ['', 'edges:']
  for (const e of edges) {
    lines.push(`  ${scalar(e.name)}:`)
    lines.push(`    id: ${e.id}`)
    lines.push(`    from: ${scalar(e.from)}`)
    lines.push(`    to: ${scalar(e.to)}`)
    lines.push(...cardinality(e))
    lines.push(...propsBlock(e.props, '    '))
  }
  return lines
}

export interface SerializeOptions {
  /** Lines placed at the top of the file, each written as a `#` comment. */
  header?: string[]
}

export function serializeModel(model: ModelIR, options: SerializeOptions = {}): string {
  const lines: string[] = []
  for (const h of options.header ?? []) lines.push(h === '' ? '#' : `# ${h}`)

  // Only written when the model declared one: adding it to a file that declared
  // nothing would put a claim in the file its author never made.
  if (model.formatVersion !== undefined) {
    lines.push(`lpg: ${JSON.stringify(model.formatVersion)}`)
  }
  lines.push('namespace:')
  lines.push(`  prefix: ${scalar(model.namespace.prefix)}`)
  lines.push(`  iri: ${model.namespace.iri}`)

  const extra = Object.entries(model.prefixes ?? {})
    .filter(([p]) => p !== model.namespace.prefix)
    .sort(([a], [b]) => a.localeCompare(b))
  if (extra.length > 0) {
    lines.push('', 'prefixes:')
    for (const [p, iri] of extra) lines.push(`  ${scalar(p)}: ${iri}`)
  }

  lines.push(...enumsBlock(model.enums))
  lines.push(...mixinsBlock(model.mixins))
  lines.push(...nodesBlock(model.nodes))
  lines.push(...edgesBlock(model.edges))

  return lines.join('\n') + '\n'
}
