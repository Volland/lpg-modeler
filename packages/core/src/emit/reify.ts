import type { EdgeTypeIR, ModelIR, NodeTypeIR, ScalarType } from '../ir'

/**
 * Gradual reification: a bare edge stays a plain object property, while an edge that
 * carries properties becomes an n-ary class plus a shortcut property. Reify only what
 * needs it. See lat.md/emitters#Gradual Reification.
 */

/** KNOWS -> knows, LIVES_AT -> livesAt */
export function lowerCamel(name: string): string {
  const parts = name.split(/[_\s-]+/).filter(Boolean)
  return parts
    .map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join('')
}

/** KNOWS -> Knows, LIVES_AT -> LivesAt */
export function pascal(name: string): string {
  const c = lowerCamel(name)
  return c.charAt(0).toUpperCase() + c.slice(1)
}

export interface PlainEdgeMapping {
  kind: 'plain'
  edge: EdgeTypeIR
  /** Local name of the object property. */
  property: string
}

export interface ReifiedEdgeMapping {
  kind: 'reified'
  edge: EdgeTypeIR
  /** Local name of the class standing for the relationship. */
  className: string
  subjectProperty: string
  objectProperty: string
  /** Direct endpoint-to-endpoint property, kept for convenient querying. */
  shortcutProperty: string
}

export type EdgeMapping = PlainEdgeMapping | ReifiedEdgeMapping

export function mapEdge(edge: EdgeTypeIR): EdgeMapping {
  const base = lowerCamel(edge.name)
  if (edge.props.length === 0) {
    return { kind: 'plain', edge, property: base }
  }
  return {
    kind: 'reified',
    edge,
    className: pascal(edge.name),
    subjectProperty: `${base}Subject`,
    objectProperty: `${base}Object`,
    shortcutProperty: base,
  }
}

export function mapEdges(model: ModelIR): EdgeMapping[] {
  return model.edges.map(mapEdge)
}

/** Namespace prefixes in play across a resolved closure, prefix -> base IRI. */
export function collectPrefixes(model: ModelIR): Map<string, string> {
  const out = new Map<string, string>()
  // Prefixes the model declared explicitly, so a vocabulary it references by CURIE is
  // bound in the generated document rather than left dangling.
  for (const [p, iri] of Object.entries(model.prefixes ?? {})) out.set(p, iri)
  const add = (t: NodeTypeIR | EdgeTypeIR) => {
    if (!t.prefix) return
    out.set(t.prefix, t.iri.slice(0, t.iri.length - t.name.length))
  }
  model.nodes.forEach(add)
  model.edges.forEach(add)
  if (model.namespace.prefix) out.set(model.namespace.prefix, model.namespace.iri)
  return out
}

/** Qualified term for a type, e.g. `social:Person`. */
export function term(t: NodeTypeIR | EdgeTypeIR, localName?: string): string {
  return `${t.prefix}:${localName ?? t.name}`
}

export const XSD: Record<ScalarType, string> = {
  string: 'xsd:string',
  int8: 'xsd:byte',
  int16: 'xsd:short',
  int32: 'xsd:int',
  int: 'xsd:integer',
  int128: 'xsd:integer',
  uint8: 'xsd:unsignedByte',
  uint16: 'xsd:unsignedShort',
  uint32: 'xsd:unsignedInt',
  uint64: 'xsd:unsignedLong',
  float32: 'xsd:float',
  float: 'xsd:double',
  decimal: 'xsd:decimal',
  boolean: 'xsd:boolean',
  date: 'xsd:date',
  datetime: 'xsd:dateTime',
  // XSD has no separate zoned form: the offset lives in the lexical value either way.
  zoneddatetime: 'xsd:dateTime',
  duration: 'xsd:duration',
  uuid: 'xsd:string',
  blob: 'xsd:base64Binary',
  json: 'xsd:string',
}

/** Scalar types RDF has no dedicated datatype for; each is a reported downgrade. */
export const LOSSY_TYPES: ReadonlySet<ScalarType> = new Set<ScalarType>(['uuid', 'json'])

export function prefixHeader(model: ModelIR, extra: Array<[string, string]>): string[] {
  const lines = extra.map(([p, iri]) => `@prefix ${p}: <${iri}> .`)
  for (const [p, iri] of [...collectPrefixes(model)].sort()) {
    lines.push(`@prefix ${p}: <${iri}> .`)
  }
  return lines
}
