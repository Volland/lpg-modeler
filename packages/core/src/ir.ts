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

/**
 * A field of a `STRUCT` or a member of a `UNION`: a name and the type it carries.
 * See lat.md/metamodel#Composite Types.
 */
export interface TypeField {
  name: string
  type: ValueType
}

/**
 * A value type as written on a property. A scalar and a list of scalars are what every
 * target can hold; the rest are LadybugDB's composites, which nest arbitrarily and
 * which only the ladybug target stores. See lat.md/metamodel#Composite Types.
 */
export type ValueType =
  | { kind: 'scalar'; scalar: ScalarType; precision?: number; scale?: number }
  /** A variable-size list: `STRING[]` or `LIST<STRING>`. */
  | { kind: 'list'; of: ValueType }
  /** A fixed-size array: `FLOAT[128]` or `ARRAY<FLOAT, 128>`. */
  | { kind: 'array'; of: ValueType; size: number }
  | { kind: 'struct'; fields: TypeField[] }
  | { kind: 'map'; key: ValueType; value: ValueType }
  | { kind: 'union'; members: TypeField[] }

/** The composite keywords, for messages and for the schema the editor completes from. */
export const COMPOSITE_TYPE_NAMES: readonly string[] = ['ARRAY', 'STRUCT', 'MAP', 'UNION']

/**
 * A type is simple when it is a scalar or a variable-size list of one: exactly the
 * shapes every target could already hold before composites existed. Everything else is
 * composite, including a list of lists, and travels on `PropertyIR.composite`.
 */
export function isSimpleType(t: ValueType): boolean {
  return t.kind === 'scalar' || (t.kind === 'list' && t.of.kind === 'scalar')
}

/** The scalar a type ultimately holds, when every value in it is the same scalar. */
export function elementScalar(t: ValueType): ScalarType | undefined {
  if (t.kind === 'scalar') return t.scalar
  if (t.kind === 'list' || t.kind === 'array') return elementScalar(t.of)
  return undefined
}

/** Whether the outermost node holds many values, which is what a list marker means. */
export function holdsMany(t: ValueType): boolean {
  return t.kind === 'list' || t.kind === 'array'
}

/** Every type node in a tree, outermost first, so a check can look at all of them. */
export function walkType(t: ValueType): ValueType[] {
  switch (t.kind) {
    case 'scalar': return [t]
    case 'list': case 'array': return [t, ...walkType(t.of)]
    case 'map': return [t, ...walkType(t.key), ...walkType(t.value)]
    case 'struct': return [t, ...t.fields.flatMap((f) => walkType(f.type))]
    case 'union': return [t, ...t.members.flatMap((f) => walkType(f.type))]
  }
}

/**
 * Spell a type the way LadybugDB writes it. The scalar names are passed in rather than
 * fixed, so the ladybug target gets its own column types and a diagnostic gets the
 * canonical model names the file was written with.
 */
export function formatValueType(t: ValueType, spell: (s: ScalarType) => string = (s) => s): string {
  const field = (f: TypeField) => `${f.name} ${formatValueType(f.type, spell)}`
  switch (t.kind) {
    case 'scalar': return `${spell(t.scalar)}${typeParams(t)}`
    case 'list': return `${formatValueType(t.of, spell)}[]`
    case 'array': return `${formatValueType(t.of, spell)}[${t.size}]`
    case 'map': return `MAP(${formatValueType(t.key, spell)}, ${formatValueType(t.value, spell)})`
    case 'struct': return `STRUCT(${t.fields.map(field).join(', ')})`
    case 'union': return `UNION(${t.members.map(field).join(', ')})`
  }
}

type Token = { t: 'word'; v: string } | { t: 'num'; v: number } | { t: 'punct'; v: string }

/**
 * A composite type nests, so it cannot be read with a regular expression the way a bare
 * scalar could. The grammar is small enough that a hand-written reader is shorter than
 * pulling in a parser: words, numbers and the six punctuation marks the forms use.
 */
function tokenize(written: string): Token[] | undefined {
  const out: Token[] = []
  let i = 0
  while (i < written.length) {
    const c = written[i]!
    if (/\s/.test(c)) { i += 1; continue }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < written.length && /[A-Za-z0-9_]/.test(written[j]!)) j += 1
      out.push({ t: 'word', v: written.slice(i, j) })
      i = j
      continue
    }
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < written.length && /[0-9]/.test(written[j]!)) j += 1
      out.push({ t: 'num', v: Number(written.slice(i, j)) })
      i = j
      continue
    }
    if ('()<>[],'.includes(c)) { out.push({ t: 'punct', v: c }); i += 1; continue }
    return undefined
  }
  return out
}

/** Recursive-descent reader over the token stream. Returns undefined on anything unexpected. */
class TypeReader {
  private at = 0

  constructor(private readonly toks: Token[]) {}

  private peek(offset = 0): Token | undefined { return this.toks[this.at + offset] }

  private punct(v: string): boolean {
    const t = this.peek()
    if (t?.t === 'punct' && t.v === v) { this.at += 1; return true }
    return false
  }

  private word(): string | undefined {
    const t = this.peek()
    if (t?.t !== 'word') return undefined
    this.at += 1
    return t.v
  }

  private number(): number | undefined {
    const t = this.peek()
    if (t?.t !== 'num') return undefined
    this.at += 1
    return t.v
  }

  done(): boolean { return this.at >= this.toks.length }

  /** `LIST<STRING NOT NULL>` is how GQL spells a list of non-null values. */
  private skipNotNull(): void {
    const a = this.peek()
    const b = this.peek(1)
    if (a?.t === 'word' && a.v.toUpperCase() === 'NOT' && b?.t === 'word' && b.v.toUpperCase() === 'NULL') {
      this.at += 2
    }
  }

  /** A type with its `[]` and `[n]` suffixes applied outward. */
  type(): ValueType | undefined {
    let base = this.base()
    if (!base) return undefined
    for (;;) {
      if (!this.punct('[')) break
      const size = this.number()
      if (!this.punct(']')) return undefined
      base = size === undefined ? { kind: 'list', of: base } : { kind: 'array', of: base, size }
    }
    this.skipNotNull()
    return base
  }

  private fields(): TypeField[] | undefined {
    const out: TypeField[] = []
    do {
      const name = this.word()
      if (name === undefined) return undefined
      const type = this.type()
      if (!type) return undefined
      out.push({ name, type })
    } while (this.punct(','))
    return out.length > 0 ? out : undefined
  }

  private base(): ValueType | undefined {
    const head = this.peek()
    if (head?.t !== 'word') return undefined
    switch (head.v.toUpperCase()) {
      case 'STRUCT': case 'UNION': {
        this.at += 1
        if (!this.punct('(')) return undefined
        const fields = this.fields()
        if (!fields || !this.punct(')')) return undefined
        return head.v.toUpperCase() === 'STRUCT'
          ? { kind: 'struct', fields }
          : { kind: 'union', members: fields }
      }
      case 'MAP': {
        this.at += 1
        if (!this.punct('(')) return undefined
        const key = this.type()
        if (!key || !this.punct(',')) return undefined
        const value = this.type()
        if (!value || !this.punct(')')) return undefined
        return { kind: 'map', key, value }
      }
      case 'ARRAY': {
        this.at += 1
        if (!this.punct('<')) return undefined
        const of = this.type()
        if (!of || !this.punct(',')) return undefined
        const size = this.number()
        if (size === undefined || !this.punct('>')) return undefined
        return { kind: 'array', of, size }
      }
      case 'LIST': {
        this.at += 1
        if (!this.punct('<')) return undefined
        const of = this.type()
        if (!of || !this.punct('>')) return undefined
        return { kind: 'list', of }
      }
      default:
        return this.scalar()
    }
  }

  /**
   * A scalar, greedily: two words first, because `ZONED DATETIME` and `LOCAL DATETIME`
   * are spelled with a space. Only `decimal` then takes a `(precision, scale)`.
   */
  private scalar(): ValueType | undefined {
    const a = this.peek()
    const b = this.peek(1)
    let scalar: ScalarType | undefined
    if (a?.t === 'word' && b?.t === 'word') {
      scalar = canonicalScalar(`${a.v} ${b.v}`)
      if (scalar) this.at += 2
    }
    if (!scalar) {
      if (a?.t !== 'word') return undefined
      scalar = canonicalScalar(a.v)
      if (!scalar) return undefined
      this.at += 1
    }
    if (!this.punct('(')) return { kind: 'scalar', scalar }
    // A precision on anything but a decimal reads better as an unknown type than as a
    // silently ignored parameter.
    if (scalar !== 'decimal') return undefined
    const precision = this.number()
    if (precision === undefined || !this.punct(',')) return undefined
    const scale = this.number()
    if (scale === undefined || !this.punct(')')) return undefined
    return { kind: 'scalar', scalar, precision, scale }
  }
}

/** Read a type as written in a model file, scalar or composite, or fail. */
export function parseValueType(written: string): ValueType | undefined {
  const toks = tokenize(written)
  if (!toks || toks.length === 0) return undefined
  const reader = new TypeReader(toks)
  const type = reader.type()
  return type && reader.done() ? type : undefined
}

/**
 * A property type as written: the scalar, its parameters, and whether it is a list.
 * A composite additionally carries the whole type, and `type` is then the scalar the
 * targets without composites keep. See lat.md/metamodel#Composite Types.
 */
export interface ParsedType {
  type: ScalarType
  list: boolean
  /** Total digits of a `decimal`, when it was written with them. */
  precision?: number
  /** Digits after the point of a `decimal`. */
  scale?: number
  /** The whole type, present only when it is composite. */
  composite?: ValueType
}

/**
 * The scalar a composite degrades to on a target that cannot hold it. A struct, a map
 * and a union have no single element type, so they keep `json` — the one scalar in the
 * set that already stands for "a value with structure inside it".
 */
const COMPOSITE_FALLBACK: ScalarType = 'json'

/**
 * Resolve a property type as written. Accepts a bare scalar, the GQL `LIST<STRING>` and
 * bracket `STRING[]` forms, and LadybugDB's `ARRAY`, `STRUCT`, `MAP` and `UNION`.
 */
export function parsePropertyType(written: string): ParsedType | undefined {
  const type = parseValueType(written)
  if (!type) return undefined
  if (isSimpleType(type)) {
    const inner = type.kind === 'list' ? type.of : type
    if (inner.kind !== 'scalar') return undefined
    return {
      type: inner.scalar,
      list: type.kind === 'list',
      ...(inner.precision !== undefined ? { precision: inner.precision } : {}),
      ...(inner.scale !== undefined ? { scale: inner.scale } : {}),
    }
  }
  return {
    type: elementScalar(type) ?? COMPOSITE_FALLBACK,
    list: holdsMany(type),
    composite: type,
  }
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
  /**
   * The whole type when it is composite, which `type` and `list` cannot describe: they
   * then say only what a target without composites keeps. See
   * lat.md/metamodel#Composite Types.
   */
  composite?: ValueType
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

/** Something worth saying that is not a problem: a rule the model applied silently. */
export function info(code: string, message: string, loc?: Loc): Diagnostic {
  return { severity: 'info', code, message, loc }
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
