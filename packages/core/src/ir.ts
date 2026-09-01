/**
 * The intermediate representation every diagram and every generated artifact is
 * derived from. See lat.md/metamodel#Metamodel.
 */

export type ScalarType =
  | 'string'
  | 'int8' | 'int16' | 'int32' | 'int' | 'int128'
  | 'uint8' | 'uint16' | 'uint32' | 'uint64'
  | 'float32' | 'float' | 'decimal'
  | 'boolean'
  | 'date' | 'datetime' | 'zoneddatetime' | 'duration'
  | 'uuid' | 'blob' | 'json'

/**
 * Every scalar a property may take, in the order the canvas offers them. The set is
 * what LadybugDB stores natively minus what is not a value type — see
 * lat.md/metamodel#Scalar Types.
 */
export const SCALAR_TYPES: readonly ScalarType[] = [
  'string',
  'int8', 'int16', 'int32', 'int', 'int128',
  'uint8', 'uint16', 'uint32', 'uint64',
  'float32', 'float', 'decimal',
  'boolean',
  'date', 'datetime', 'zoneddatetime', 'duration',
  'uuid', 'blob', 'json',
]

/**
 * Scalars that carry an ordering, so `min` and `max` mean something on them. Validation
 * and the inspector both read this, rather than each keeping its own list.
 */
export const ORDERED_TYPES: ReadonlySet<ScalarType> = new Set<ScalarType>([
  'int8', 'int16', 'int32', 'int', 'int128',
  'uint8', 'uint16', 'uint32', 'uint64',
  'float32', 'float', 'decimal',
  'date', 'datetime', 'zoneddatetime', 'duration',
])

/** Scalars that carry text, so a pattern or a length bound means something on them. */
export const TEXT_TYPES: ReadonlySet<ScalarType> = new Set<ScalarType>(['string'])

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
  INT8: 'int8', TINYINT: 'int8',
  INT16: 'int16', SMALLINT: 'int16',
  INT32: 'int32',
  // `INT` keeps its original 64-bit meaning: models were written against it before the
  // narrower widths existed, and SQL's 32-bit reading would silently change them.
  INT: 'int', INTEGER: 'int', INT64: 'int', BIGINT: 'int',
  INT128: 'int128', HUGEINT: 'int128',
  UINT8: 'uint8', UINT16: 'uint16', UINT32: 'uint32', UINT64: 'uint64',
  FLOAT32: 'float32', REAL: 'float32',
  FLOAT: 'float', FLOAT64: 'float', DOUBLE: 'float',
  DECIMAL: 'decimal', NUMERIC: 'decimal',
  BOOL: 'boolean', BOOLEAN: 'boolean',
  DATE: 'date',
  DATETIME: 'datetime', TIMESTAMP: 'datetime', 'LOCAL DATETIME': 'datetime',
  ZONEDDATETIME: 'zoneddatetime', 'ZONED DATETIME': 'zoneddatetime',
  'TIMESTAMP TZ': 'zoneddatetime', TIMESTAMPTZ: 'zoneddatetime',
  DURATION: 'duration', INTERVAL: 'duration',
  UUID: 'uuid',
  BLOB: 'blob', BYTES: 'blob', BINARY: 'blob',
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
  int8: 'INT8',
  int16: 'INT16',
  int32: 'INT32',
  int: 'INTEGER',
  int128: 'INT128',
  uint8: 'UINT8',
  uint16: 'UINT16',
  uint32: 'UINT32',
  uint64: 'UINT64',
  float32: 'FLOAT32',
  float: 'FLOAT',
  decimal: 'DECIMAL',
  boolean: 'BOOLEAN',
  date: 'DATE',
  datetime: 'LOCAL DATETIME',
  zoneddatetime: 'ZONED DATETIME',
  duration: 'DURATION',
  blob: 'BYTES',
  uuid: 'STRING',
  json: 'STRING',
}

/**
 * One endpoint's multiplicity. `max: null` is unbounded.
 * See lat.md/metamodel#Cardinality.
 */
export interface Bound {
  min: number
  max: number | null
}

/**
 * Endpoint multiplicity. The bound written at an end says how many nodes at that end
 * may relate to one node at the other end, which is the UML reading: `to` bounds how
 * many targets one source has, `from` how many sources one target has.
 */
export interface Cardinality {
  from: Bound
  to: Bound
}

const unbounded = (): Bound => ({ min: 0, max: null })
const atMostOne = (): Bound => ({ min: 0, max: 1 })

export const DEFAULT_CARDINALITY = (): Cardinality => ({ from: unbounded(), to: unbounded() })

/**
 * The four named forms, kept because they read better than bounds for the common
 * cases and because every model written before bounds existed uses them.
 */
const NAMED_CARDINALITIES: Record<string, () => Cardinality> = {
  'ONE-TO-ONE': () => ({ from: atMostOne(), to: atMostOne() }),
  'ONE-TO-MANY': () => ({ from: atMostOne(), to: unbounded() }),
  'MANY-TO-ONE': () => ({ from: unbounded(), to: atMostOne() }),
  'MANY-TO-MANY': () => ({ from: unbounded(), to: unbounded() }),
  // The LadybugDB spellings of the same four.
  'ONE-ONE': () => ({ from: atMostOne(), to: atMostOne() }),
  'ONE-MANY': () => ({ from: atMostOne(), to: unbounded() }),
  'MANY-ONE': () => ({ from: unbounded(), to: atMostOne() }),
  'MANY-MANY': () => ({ from: unbounded(), to: unbounded() }),
}

export const CARDINALITY_NAMES: readonly string[] = Object.keys(NAMED_CARDINALITIES).sort()

/** Resolve a named multiplicity, ignoring case and separator. */
export function canonicalCardinality(written: string): Cardinality | undefined {
  return NAMED_CARDINALITIES[written.trim().replace(/_/g, '-').toUpperCase()]?.()
}

/**
 * Read one endpoint bound: `*` unbounded, `2` exactly two, `1..2` a range, `1..*` a
 * lower bound only.
 */
export function parseBound(written: string): Bound | undefined {
  const t = written.trim()
  if (t === '*') return unbounded()
  const exact = /^\d+$/.exec(t)
  if (exact) { const n = Number(t); return { min: n, max: n } }
  const range = /^(\d+)\s*\.\.\s*(\d+|\*)$/.exec(t)
  if (!range) return undefined
  const min = Number(range[1])
  const max = range[2] === '*' ? null : Number(range[2])
  return { min, max }
}

export function formatBound(b: Bound): string {
  if (b.min === 0 && b.max === null) return '*'
  if (b.max === null) return `${b.min}..*`
  if (b.min === b.max) return String(b.min)
  return `${b.min}..${b.max}`
}

/** The name of a multiplicity, preferring a named form when one fits exactly. */
export function describeCardinality(c: Cardinality): string {
  for (const [name, make] of Object.entries(NAMED_CARDINALITIES)) {
    if (!name.includes('-TO-')) continue
    const n = make()
    if (sameBound(n.from, c.from) && sameBound(n.to, c.to)) return name.toLowerCase()
  }
  return `${formatBound(c.from)}-to-${formatBound(c.to)}`
}

const sameBound = (a: Bound, b: Bound) => a.min === b.min && a.max === b.max

/** Whether the multiplicity says nothing at all, which is the default. */
export function isUnconstrained(c: Cardinality): boolean {
  return c.from.min === 0 && c.from.max === null && c.to.min === 0 && c.to.max === null
}

/** Whether each end admits at most one node. */
export function endpointIsSingular(c: Cardinality): { from: boolean; to: boolean } {
  return { from: c.from.max === 1, to: c.to.max === 1 }
}

/** A property type as written: the scalar, its parameters, and whether it is a list. */
export interface ParsedType {
  type: ScalarType
  list: boolean
  /** Total digits of a `decimal`, when it was written with them. */
  precision?: number
  /** Digits after the point of a `decimal`. */
  scale?: number
}

/**
 * A scalar with its parameters, e.g. `DECIMAL(18, 3)`. Only `decimal` takes any: a
 * precision on anything else is a mistake, and reads better as an unknown type than as
 * a silently ignored parameter.
 */
function parseScalar(written: string): Omit<ParsedType, 'list'> | undefined {
  const params = /^(.+?)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(written.trim())
  if (params) {
    const base = canonicalScalar(params[1]!)
    if (base !== 'decimal') return undefined
    return { type: base, precision: Number(params[2]), scale: Number(params[3]) }
  }
  const scalar = canonicalScalar(written)
  return scalar ? { type: scalar } : undefined
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
    const inner = parseScalar(listed[1]!.replace(/\s+NOT\s+NULL$/i, ''))
    return inner ? { ...inner, list: true } : undefined
  }
  const scalar = parseScalar(trimmed)
  return scalar ? { ...scalar, list: false } : undefined
}

/** A decimal's `(precision, scale)` suffix, for the targets that spell one. */
export function typeParams(p: { precision?: number; scale?: number }): string {
  return p.precision === undefined || p.scale === undefined ? '' : `(${p.precision},${p.scale})`
}

/** A source location in a model file, used to anchor diagnostics. */
export interface Loc {
  file: string
  /** Character offset range in the file text. */
  range: [number, number]
}

/**
 * A closed set of assertions about a type, each of which SHACL can carry. The set is
 * closed rather than an expression language so that every kind can be translated per
 * target, and so the canvas can offer a form per kind rather than a parser.
 * See lat.md/metamodel#Named Constraints.
 */
export type Assertion =
  /** Two properties compared, e.g. startDate before endDate. */
  | { kind: 'lessThan'; left: string; right: string }
  | { kind: 'lessThanOrEquals'; left: string; right: string }
  | { kind: 'equals'; left: string; right: string }
  | { kind: 'disjoint'; left: string; right: string }
  /** At least one of these properties must be present. */
  | { kind: 'atLeastOne'; props: string[] }
  /** Exactly one of these properties must be present. */
  | { kind: 'exactlyOne'; props: string[] }
  /** How many of an edge's targets must be of a given type. */
  | { kind: 'count'; edge: string; of?: string; min?: number; max?: number }

export const ASSERTION_KINDS = [
  'lessThan', 'lessThanOrEquals', 'equals', 'disjoint',
  'atLeastOne', 'exactlyOne', 'count',
] as const

/** The two-property comparisons, which share a shape and a SHACL spelling. */
export const COMPARISON_KINDS: readonly string[] =
  ['lessThan', 'lessThanOrEquals', 'equals', 'disjoint']

export interface ConstraintIR {
  id: string
  name: string
  assert: Assertion
  /** Shown instead of the generated wording when the constraint fails. */
  message?: string
  loc?: Loc
}

export interface PropertyIR {
  /** Stable element id. See lat.md/metamodel#Stable Element IDs. */
  id: string
  name: string
  type: ScalarType
  /** Total digits and digits after the point of a `decimal`, when it declares them. */
  precision?: number
  scale?: number
  /** Inclusive bounds on the value itself. See lat.md/metamodel#Value Constraints. */
  min?: number
  max?: number
  /** Constraints on a string value's shape. */
  pattern?: string
  minLength?: number
  maxLength?: number
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
  /** Assertions spanning more than one property. See lat.md/metamodel#Named Constraints. */
  constraints: ConstraintIR[]
  /**
   * A raw SHACL fragment spliced into this type's shape verbatim. Portable to nothing,
   * and reported as such. See lat.md/metamodel#Escape Hatch.
   */
  rawShacl?: string
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

/** Whether a property carries any bound or shape constraint on its values. */
export function hasValueConstraints(p: PropertyIR): boolean {
  return p.min !== undefined || p.max !== undefined || p.pattern !== undefined
    || p.minLength !== undefined || p.maxLength !== undefined
}

/** Property names an assertion refers to, for validation and for the canvas. */
export function assertionOperands(a: Assertion): string[] {
  if ('left' in a) return [a.left, a.right]
  if ('props' in a) return a.props
  return []
}
