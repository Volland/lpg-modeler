/**
 * The intermediate representation every diagram and every generated artifact is
 * derived from. See lat.md/metamodel#Metamodel.
 */

export type ScalarType =
  | 'string' | 'int' | 'float' | 'boolean' | 'date' | 'datetime' | 'uuid' | 'json'

export const SCALAR_TYPES: readonly ScalarType[] = [
  'string', 'int', 'float', 'boolean', 'date', 'datetime', 'uuid', 'json',
]

/**
 * The model format version this build reads. A file declares its own with a top-level
 * `lpg:` key; a file that declares nothing is read as 1.0, which is what every model
 * written before the key existed is.
 */
export const LPG_FORMAT_VERSION = '1.0'

/**
 * Accepted spellings of each scalar type, normalised to upper case. The lower-case
 * names are the original surface syntax; the upper-case ones are the GQL (ISO/IEC
 * 39075) spellings, accepted so a model reads the same way as the standard it is
 * generated into. Both resolve to the same canonical name in the IR.
 */
const SCALAR_SPELLINGS: Record<string, ScalarType> = {
  STRING: 'string',
  INT: 'int', INTEGER: 'int', INT64: 'int',
  FLOAT: 'float', FLOAT64: 'float', DOUBLE: 'float',
  BOOL: 'boolean', BOOLEAN: 'boolean',
  DATE: 'date',
  DATETIME: 'datetime', TIMESTAMP: 'datetime', 'ZONED DATETIME': 'datetime',
  UUID: 'uuid',
  JSON: 'json',
}

/** Every spelling a model file may use for a type, for schema generation and messages. */
export const SCALAR_SPELLING_NAMES: readonly string[] = Object.keys(SCALAR_SPELLINGS)
  .concat(SCALAR_TYPES)
  .sort()

/**
 * Resolve a type as written in a model file to its canonical name. Matching ignores
 * case and treats an underscore as a space, so `ZONED_DATETIME` and `zoned datetime`
 * are the same type.
 */
export function canonicalScalar(written: string): ScalarType | undefined {
  const key = written.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toUpperCase()
  return SCALAR_SPELLINGS[key]
}

/** The GQL (ISO/IEC 39075) value type each scalar is generated as. */
export const GQL_TYPES: Record<ScalarType, string> = {
  string: 'STRING',
  int: 'INTEGER',
  float: 'FLOAT',
  boolean: 'BOOLEAN',
  date: 'DATE',
  datetime: 'ZONED DATETIME',
  uuid: 'STRING',
  json: 'STRING',
}

/**
 * Endpoint multiplicity, read as `<from end>-to-<to end>`. `many-to-one` says each
 * source node has at most one target. See lat.md/metamodel#Cardinality.
 */
export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'

export const DEFAULT_CARDINALITY: Cardinality = 'many-to-many'

/** Accepted spellings, including the LadybugDB ones, normalised to upper case. */
const CARDINALITY_SPELLINGS: Record<string, Cardinality> = {
  'ONE-TO-ONE': 'one-to-one', 'ONE-ONE': 'one-to-one',
  'ONE-TO-MANY': 'one-to-many', 'ONE-MANY': 'one-to-many',
  'MANY-TO-ONE': 'many-to-one', 'MANY-ONE': 'many-to-one',
  'MANY-TO-MANY': 'many-to-many', 'MANY-MANY': 'many-to-many',
}

export const CARDINALITY_NAMES: readonly string[] = Object.keys(CARDINALITY_SPELLINGS).sort()

/** Resolve a cardinality as written to its canonical name, ignoring case and separator. */
export function canonicalCardinality(written: string): Cardinality | undefined {
  return CARDINALITY_SPELLINGS[written.trim().replace(/_/g, '-').toUpperCase()]
}

/** Whether each end admits at most one node. */
export function endpointIsSingular(c: Cardinality): { from: boolean; to: boolean } {
  return { from: c.startsWith('one-'), to: c.endsWith('-one') }
}

/** A property type as written: the scalar, and whether it holds a list of them. */
export interface ParsedType {
  type: ScalarType
  list: boolean
}

/**
 * Resolve a property type as written. Accepts the GQL `LIST<STRING>` form and the
 * bracket form `STRING[]` alongside a bare scalar name.
 */
export function parsePropertyType(written: string): ParsedType | undefined {
  const trimmed = written.trim()
  const listed = /^LIST\s*<(.+)>$/i.exec(trimmed) ?? /^(.+?)\s*\[\s*\]$/.exec(trimmed)
  if (listed) {
    // `LIST<STRING NOT NULL>` is how GQL spells a list of non-null values; the
    // nullability of the element is not something this metamodel carries.
    const inner = canonicalScalar(listed[1]!.replace(/\s+NOT\s+NULL$/i, ''))
    return inner ? { type: inner, list: true } : undefined
  }
  const scalar = canonicalScalar(trimmed)
  return scalar ? { type: scalar, list: false } : undefined
}

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
  /** Whether the property holds a list of its type rather than a single value. */
  list: boolean
  /** Name of the enum constraining this property's values. See lat.md/metamodel#Enums. */
  enum?: string
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
  /**
   * Whether an instance may carry properties the type does not declare. Closed by
   * default, and never inherited. See lat.md/metamodel#Open and Closed Types.
   */
  open: boolean
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
  /** Endpoint multiplicity. See lat.md/metamodel#Cardinality. */
  cardinality: Cardinality
  props: PropertyIR[]
  previousIri?: string
  loc?: Loc
}

export interface EnumIR {
  id: string
  name: string
  /** Prefix-qualified name, for display when several models are in play. */
  qname: string
  /** Absolute IRI: the global identity of this enum. */
  iri: string
  prefix: string
  values: string[]
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
  /**
   * Format version the entry file declared, absent when it declared none.
   * See lat.md/metamodel#Format Version.
   */
  formatVersion?: string
  /**
   * Prefix bindings declared across the closure, beyond each model's own namespace.
   * Carried so a model can name the vocabularies its RDF output should bind.
   */
  prefixes: Record<string, string>
  nodes: NodeTypeIR[]
  edges: EdgeTypeIR[]
  mixins: MixinIR[]
  enums: EnumIR[]
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

export function findEnum(model: ModelIR, name: string): EnumIR | undefined {
  return model.enums.find((e) => e.name === name)
}
