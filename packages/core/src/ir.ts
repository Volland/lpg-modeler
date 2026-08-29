/**
 * The intermediate representation every diagram and every generated artifact is
 * derived from. See lat.md/metamodel#Metamodel.
 */

export type ScalarType =
  | 'string' | 'int' | 'float' | 'boolean' | 'date' | 'datetime' | 'uuid' | 'json'

export const SCALAR_TYPES: readonly ScalarType[] = [
  'string', 'int', 'float', 'boolean', 'date', 'datetime', 'uuid', 'json',
]

/** A source location in a model file, used to anchor diagnostics. */
export interface Loc {
  file: string
  /** Character offset range in the file text. */
  range: [number, number]
}

export interface PropertyIR {
  /** Stable element id. See lat.md/metamodel#Stable Element IDs. */
  id: string
  name: string
  type: ScalarType
  required: boolean
  unique: boolean
  /** Name of the type this property was inherited from, if any. */
  inheritedFrom?: string
  loc?: Loc
}

export interface NodeTypeIR {
  id: string
  name: string
  /** Prefix-qualified name, for display when several models are in play. */
  qname: string
  /** Absolute IRI: the global identity of this type. lat.md/metamodel#Namespaces */
  iri: string
  /** Namespace prefix of the declaring model. */
  prefix: string
  abstract: boolean
  /** Name of the abstract parent, if any. */
  extends?: string
  /** All ancestors, nearest first. */
  ancestors: string[]
  mixins: string[]
  /** Property names forming this type's key. May be inherited. */
  key: string[]
  keyInheritedFrom?: string
  props: PropertyIR[]
  /** Previous IRI, when this type has been renamed. lat.md/metamodel#Namespaces */
  previousIri?: string
  loc?: Loc
}

export interface EdgeTypeIR {
  id: string
  name: string
  qname: string
  iri: string
  prefix: string
  from: string
  to: string
  props: PropertyIR[]
  previousIri?: string
  loc?: Loc
}

export interface MixinIR {
  id: string
  name: string
  props: PropertyIR[]
  loc?: Loc
}

export interface NamespaceIR {
  prefix: string
  iri: string
}

export interface ModelIR {
  /** Absolute path of the model file this IR was resolved from. */
  file: string
  namespace: NamespaceIR
  nodes: NodeTypeIR[]
  edges: EdgeTypeIR[]
  mixins: MixinIR[]
}

export type Severity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  severity: Severity
  /** Stable machine-readable code, e.g. 'missing-key' or 'downgrade'. */
  code: string
  message: string
  loc?: Loc
  /** Set on downgrade diagnostics: which target could not express the feature. */
  target?: string
}

/** Resolution is total: it always returns a model plus diagnostics, never throws. */
export interface ResolveResult {
  model: ModelIR
  diagnostics: Diagnostic[]
}

export function err(code: string, message: string, loc?: Loc): Diagnostic {
  return { severity: 'error', code, message, loc }
}

export function warn(code: string, message: string, loc?: Loc): Diagnostic {
  return { severity: 'warning', code, message, loc }
}

/** Concrete (non-abstract) node types, the only ones a database target realises. */
export function concreteNodes(model: ModelIR): NodeTypeIR[] {
  return model.nodes.filter((n) => !n.abstract)
}

export function findNode(model: ModelIR, name: string): NodeTypeIR | undefined {
  return model.nodes.find((n) => n.name === name)
}

/**
 * Concrete descendants of a type, or the type itself when it is already concrete.
 * Endpoint-pair expansion for table-per-leaf targets depends on this.
 */
export function concreteDescendants(model: ModelIR, name: string): NodeTypeIR[] {
  const self = findNode(model, name)
  if (self && !self.abstract) return [self]
  return model.nodes.filter((n) => !n.abstract && n.ancestors.includes(name))
}
