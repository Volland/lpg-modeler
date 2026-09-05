import { parseDocument, Document, isMap, isSeq, isScalar, YAMLMap, Node } from 'yaml'
import type { Assertion, Cardinality, Diagnostic, Loc, ScalarType, ValueType } from './ir'
import {
  ASSERTION_KINDS, CARDINALITY_NAMES, COMPARISON_KINDS, COMPOSITE_TYPE_NAMES,
  DEFAULT_CARDINALITY, SCALAR_TYPES, canonicalCardinality, parseBound,
  parsePropertyType, err,
} from './ir'

/** The raw shape of a model file, before imports or inheritance are resolved. */
export interface RawProperty {
  id?: string
  name: string
  type: ScalarType
  /** Parameters of a `decimal` type, when it was written with them. */
  precision?: number
  scale?: number
  list: boolean
  /** The whole type when it is composite. See lat.md/metamodel#Composite Types. */
  composite?: ValueType
  enum?: string
  min?: number
  max?: number
  pattern?: string
  minLength?: number
  maxLength?: number
  required: boolean
  unique: boolean
  loc?: Loc
}

export interface RawConstraint {
  id?: string
  name: string
  assert: Assertion
  message?: string
  loc?: Loc
}

export interface RawNode {
  id?: string
  name: string
  abstract: boolean
  open: boolean
  constraints: RawConstraint[]
  rawShacl?: string
  extends?: string
  mixins: string[]
  key: string[]
  props: RawProperty[]
  previousIri?: string
  loc?: Loc
}

export interface RawEdge {
  id?: string
  name: string
  from?: string
  to?: string
  cardinality: Cardinality
  props: RawProperty[]
  previousIri?: string
  loc?: Loc
}

export interface RawEnum {
  id?: string
  name: string
  values: string[]
  loc?: Loc
}

export interface RawMixin {
  id?: string
  name: string
  props: RawProperty[]
  loc?: Loc
}

export interface RawImport {
  path: string
  as: string
  loc?: Loc
}

export interface RawModel {
  file: string
  /** Value of the top-level `lpg:` key, when the file declares one. */
  formatVersion?: string
  namespace?: { prefix: string; iri: string }
  /** Extra prefix bindings declared by this file, beyond its own namespace. */
  prefixes: Record<string, string>
  imports: RawImport[]
  nodes: RawNode[]
  edges: RawEdge[]
  mixins: RawMixin[]
  enums: RawEnum[]
}

export interface ParseResult {
  raw: RawModel
  /** Retained so mutations can be applied to the same document. */
  doc: Document
  diagnostics: Diagnostic[]
}

function locOf(file: string, node: Node | null | undefined): Loc | undefined {
  const r = (node as { range?: [number, number, number] } | undefined)?.range
  if (!r) return undefined
  return { file, range: [r[0], r[1]] }
}

function str(map: YAMLMap, key: string): string | undefined {
  const v = map.get(key, true)
  return isScalar(v) && typeof v.value === 'string' ? v.value : undefined
}

/** Reads a scalar as text, so `lpg: 1.0` and `lpg: "1.0"` mean the same thing. */
function scalarText(map: YAMLMap, key: string): string | undefined {
  const v = map.get(key, true)
  if (!isScalar(v)) return undefined
  const raw = (v as { source?: string }).source
  if (typeof raw === 'string' && raw.length > 0) return raw.replace(/^['"]|['"]$/g, '')
  if (typeof v.value === 'string') return v.value
  if (typeof v.value === 'number') return String(v.value)
  return undefined
}

function num(map: YAMLMap, key: string): number | undefined {
  const v = map.get(key, true)
  return isScalar(v) && typeof v.value === 'number' ? v.value : undefined
}

function bool(map: YAMLMap, key: string): boolean {
  const v = map.get(key, true)
  return isScalar(v) && v.value === true
}

function strList(map: YAMLMap, key: string): string[] {
  const v = map.get(key, true)
  if (isSeq(v)) {
    return v.items.flatMap((i) => (isScalar(i) && typeof i.value === 'string' ? [i.value] : []))
  }
  if (isScalar(v) && typeof v.value === 'string') return [v.value]
  return []
}

/** Spread-friendly reader, so an absent bound stays absent rather than becoming undefined. */
function numeric(body: YAMLMap, key: string): Record<string, number> {
  const v = num(body, key)
  return v === undefined ? {} : { [key]: v }
}

/**
 * What an unknown type is measured against. The canonical names rather than every
 * accepted spelling: sixty aliases in one line is a wall a reader has to scan rather
 * than an answer. See lat.md/metamodel#Type Spellings.
 */
const KNOWN_TYPES = [
  `Known scalars: ${SCALAR_TYPES.join(', ')}.`,
  'Each also answers to its GQL or LadybugDB name, so STRING and ZONED_DATETIME work as',
  'well as string and zoneddatetime, and any of them may take a […], […n] or LIST<…> suffix.',
  `Composites: ${COMPOSITE_TYPE_NAMES.join(', ')} — written STRUCT(field TYPE, …),`,
  'MAP(KEY, VALUE), UNION(member TYPE, …) and ARRAY<TYPE, n>.',
].join(' ')

function parseProps(file: string, owner: YAMLMap, diags: Diagnostic[]): RawProperty[] {
  const propsNode = owner.get('props', true)
  if (!isMap(propsNode)) return []
  const out: RawProperty[] = []
  for (const item of propsNode.items) {
    if (!isScalar(item.key) || typeof item.key.value !== 'string') continue
    const name = item.key.value
    const body = item.value
    const loc = locOf(file, item.key as Node)
    if (!isMap(body)) {
      diags.push(err('malformed-property', `Property '${name}' must be a mapping.`, loc))
      continue
    }
    const rawType = str(body, 'type')
    if (!rawType) {
      diags.push(err('missing-type', `Property '${name}' has no type.`, loc))
      continue
    }
    const parsed = parsePropertyType(rawType)
    if (!parsed) {
      diags.push(err('unknown-type', `Property '${name}' has unknown type '${rawType}'. ${KNOWN_TYPES}`, loc))
      continue
    }
    // `list: true` and a LIST<…> type say the same thing; either is enough.
    const list = parsed.list || bool(body, 'list')
    const enumRef = str(body, 'enum')
    out.push({
      id: str(body, 'id'),
      name,
      type: parsed.type,
      ...(parsed.precision !== undefined ? { precision: parsed.precision } : {}),
      ...(parsed.scale !== undefined ? { scale: parsed.scale } : {}),
      ...(parsed.composite ? { composite: parsed.composite } : {}),
      list,
      ...(enumRef ? { enum: enumRef } : {}),
      ...numeric(body, 'min'), ...numeric(body, 'max'),
      ...numeric(body, 'minLength'), ...numeric(body, 'maxLength'),
      ...(str(body, 'pattern') !== undefined ? { pattern: str(body, 'pattern')! } : {}),
      required: bool(body, 'required'),
      unique: bool(body, 'unique'),
      loc,
    })
  }
  return out
}


/**
 * Cardinality is either one of the named forms or a mapping of endpoint bounds:
 * `many-to-one`, or `{ to: "2" }`. An omitted end is unbounded.
 */
function parseCardinality(
  file: string, body: YAMLMap, edgeName: string, diags: Diagnostic[], loc: Loc | undefined,
): Cardinality {
  const node = body.get('cardinality', true)
  if (node === undefined || node === null) return DEFAULT_CARDINALITY()

  if (isScalar(node) && typeof node.value === 'string') {
    const named = canonicalCardinality(node.value)
    if (named) return named
    diags.push(err('unknown-cardinality',
      `Edge type '${edgeName}' declares cardinality '${node.value}', which is not a known multiplicity. Use one of ${CARDINALITY_NAMES.join(', ')}, or endpoint bounds such as { to: "2" }.`,
      locOf(file, node as Node) ?? loc))
    return DEFAULT_CARDINALITY()
  }

  if (!isMap(node)) {
    diags.push(err('malformed-cardinality',
      `Edge type '${edgeName}' must declare cardinality as a named multiplicity or a mapping of endpoint bounds.`,
      locOf(file, node as Node) ?? loc))
    return DEFAULT_CARDINALITY()
  }

  const out = DEFAULT_CARDINALITY()
  for (const end of ['from', 'to'] as const) {
    const written = str(node, end)
    if (written === undefined) continue
    const bound = parseBound(written)
    if (!bound) {
      diags.push(err('unknown-cardinality',
        `Edge type '${edgeName}' declares a '${end}' bound of '${written}', which is not a multiplicity. Write '*', an exact count such as '2', or a range such as '1..*'.`,
        locOf(file, node as Node) ?? loc))
      continue
    }
    if (bound.max !== null && bound.min > bound.max) {
      diags.push(err('impossible-cardinality',
        `Edge type '${edgeName}' declares a '${end}' bound of '${written}', whose minimum exceeds its maximum, so nothing can satisfy it.`,
        locOf(file, node as Node) ?? loc))
      continue
    }
    out[end] = bound
  }
  return out
}


/**
 * Read one assertion. The vocabulary is closed, so an unknown kind is an error rather
 * than something passed through to a target that could not translate it anyway.
 */
function parseAssertion(
  file: string, body: YAMLMap, owner: string, cname: string, diags: Diagnostic[],
): Assertion | undefined {
  const loc = locOf(file, body as Node)
  const kinds = body.items
    .filter((i) => isScalar(i.key) && typeof i.key.value === 'string')
    .map((i) => String((i.key as { value: unknown }).value))
  if (kinds.length !== 1) {
    diags.push(err('malformed-constraint',
      `Constraint '${owner}.${cname}' must assert exactly one thing. Known kinds: ${ASSERTION_KINDS.join(', ')}.`, loc))
    return undefined
  }
  const kind = kinds[0]!
  if (!(ASSERTION_KINDS as readonly string[]).includes(kind)) {
    diags.push(err('unknown-assertion',
      `Constraint '${owner}.${cname}' asserts '${kind}', which is not a known kind. Known kinds: ${ASSERTION_KINDS.join(', ')}.`, loc))
    return undefined
  }

  if (COMPARISON_KINDS.includes(kind)) {
    const pair = strList(body, kind)
    if (pair.length !== 2) {
      diags.push(err('malformed-constraint',
        `Constraint '${owner}.${cname}' asserts '${kind}', which compares exactly two properties.`, loc))
      return undefined
    }
    return { kind, left: pair[0]!, right: pair[1]! } as Assertion
  }

  if (kind === 'atLeastOne' || kind === 'exactlyOne') {
    const props = strList(body, kind)
    if (props.length < 2) {
      diags.push(err('malformed-constraint',
        `Constraint '${owner}.${cname}' asserts '${kind}' over ${props.length} propert${props.length === 1 ? 'y' : 'ies'}. It needs at least two to be a choice.`, loc))
      return undefined
    }
    return { kind, props }
  }

  const spec = body.get('count', true)
  if (!isMap(spec)) {
    diags.push(err('malformed-constraint',
      `Constraint '${owner}.${cname}' asserts 'count', which needs an edge and a bound.`, loc))
    return undefined
  }
  const edge = str(spec, 'edge')
  if (!edge) {
    diags.push(err('malformed-constraint',
      `Constraint '${owner}.${cname}' asserts 'count' without naming an edge.`, loc))
    return undefined
  }
  const of = str(spec, 'of')
  const min = num(spec, 'min')
  const max = num(spec, 'max')
  if (min === undefined && max === undefined) {
    diags.push(err('malformed-constraint',
      `Constraint '${owner}.${cname}' asserts 'count' on '${edge}' without a min or a max, so it constrains nothing.`, loc))
    return undefined
  }
  return {
    kind: 'count', edge,
    ...(of ? { of } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}),
  }
}

function parseConstraints(
  file: string, owner: YAMLMap, ownerName: string, diags: Diagnostic[],
): RawConstraint[] {
  const seq = owner.get('constraints', true)
  if (!isSeq(seq)) return []
  const out: RawConstraint[] = []
  for (const item of seq.items) {
    if (!isMap(item)) continue
    const loc = locOf(file, item as Node)
    const name = str(item, 'name')
    if (!name) {
      diags.push(err('malformed-constraint',
        `A constraint on '${ownerName}' has no name. A name is what a failure message and a diff refer to.`, loc))
      continue
    }
    const assertBody = item.get('assert', true)
    if (!isMap(assertBody)) {
      diags.push(err('malformed-constraint',
        `Constraint '${ownerName}.${name}' has no assert block.`, loc))
      continue
    }
    const assertion = parseAssertion(file, assertBody, ownerName, name, diags)
    if (!assertion) continue
    out.push({
      id: str(item, 'id'), name, assert: assertion,
      ...(str(item, 'message') !== undefined ? { message: str(item, 'message')! } : {}),
      ...(loc ? { loc } : {}),
    })
  }
  return out
}

/** Parse a model file. Never throws: syntax problems come back as diagnostics. */
export function parseModel(file: string, text: string): ParseResult {
  const diags: Diagnostic[] = []
  const doc = parseDocument(text, { keepSourceTokens: true })
  for (const e of doc.errors) {
    diags.push(err('yaml-syntax', e.message, { file, range: [e.pos[0], e.pos[1]] }))
  }
  const raw: RawModel = {
    file, prefixes: {}, imports: [], nodes: [], edges: [], mixins: [], enums: [],
  }
  const root = doc.contents
  if (!isMap(root)) {
    if (doc.errors.length === 0) {
      diags.push(err('malformed-model', 'A model file must be a mapping.', { file, range: [0, 0] }))
    }
    return { raw, doc, diagnostics: diags }
  }

  const declaredVersion = scalarText(root, 'lpg')
  if (declaredVersion !== undefined) raw.formatVersion = declaredVersion

  const prefixes = root.get('prefixes', true)
  if (isMap(prefixes)) {
    for (const item of prefixes.items) {
      if (!isScalar(item.key) || typeof item.key.value !== 'string') continue
      if (!isScalar(item.value) || typeof item.value.value !== 'string') {
        diags.push(err('malformed-prefix',
          `Prefix '${item.key.value}' must be bound to a base IRI string.`, locOf(file, item.key as Node)))
        continue
      }
      raw.prefixes[item.key.value] = item.value.value
    }
  }

  const ns = root.get('namespace', true)
  if (isMap(ns)) {
    const prefix = str(ns, 'prefix')
    const iri = str(ns, 'iri')
    if (prefix && iri) raw.namespace = { prefix, iri }
    else {
      diags.push(err('malformed-namespace',
        'namespace must declare both a prefix and an iri.', locOf(file, ns as Node)))
    }
  }

  const imports = root.get('imports', true)
  if (isSeq(imports)) {
    for (const item of imports.items) {
      if (!isMap(item)) continue
      const path = str(item, 'path')
      const as = str(item, 'as')
      if (path && as) raw.imports.push({ path, as, loc: locOf(file, item as Node) })
      else {
        diags.push(err('malformed-import',
          'An import must declare both a path and an alias.', locOf(file, item as Node)))
      }
    }
  }

  const mixins = root.get('mixins', true)
  if (isMap(mixins)) {
    for (const item of mixins.items) {
      if (!isScalar(item.key) || typeof item.key.value !== 'string') continue
      if (!isMap(item.value)) continue
      raw.mixins.push({
        id: str(item.value, 'id'),
        name: item.key.value,
        props: parseProps(file, item.value, diags),
        loc: locOf(file, item.key as Node),
      })
    }
  }

  const enums = root.get('enums', true)
  if (isMap(enums)) {
    for (const item of enums.items) {
      if (!isScalar(item.key) || typeof item.key.value !== 'string') continue
      const name = item.key.value
      const loc = locOf(file, item.key as Node)
      if (!isMap(item.value)) {
        diags.push(err('malformed-enum', `Enum '${name}' must be a mapping.`, loc))
        continue
      }
      const values = strList(item.value, 'values')
      if (values.length === 0) {
        diags.push(err('empty-enum',
          `Enum '${name}' declares no values. An enum with no values admits nothing.`, loc))
        continue
      }
      raw.enums.push({ id: str(item.value, 'id'), name, values, loc })
    }
  }

  const nodes = root.get('nodes', true)
  if (isMap(nodes)) {
    for (const item of nodes.items) {
      if (!isScalar(item.key) || typeof item.key.value !== 'string') continue
      const name = item.key.value
      const loc = locOf(file, item.key as Node)
      if (!isMap(item.value)) {
        diags.push(err('malformed-node', `Node type '${name}' must be a mapping.`, loc))
        continue
      }
      raw.nodes.push({
        id: str(item.value, 'id'),
        name,
        abstract: bool(item.value, 'abstract'),
        open: bool(item.value, 'open'),
        constraints: parseConstraints(file, item.value, name, diags),
        ...(str(item.value, 'shacl') !== undefined ? { rawShacl: str(item.value, 'shacl')! } : {}),
        extends: str(item.value, 'extends'),
        mixins: strList(item.value, 'mixins'),
        key: strList(item.value, 'key'),
        props: parseProps(file, item.value, diags),
        previousIri: str(item.value, 'previousIri'),
        loc,
      })
    }
  }

  const edges = root.get('edges', true)
  if (isMap(edges)) {
    for (const item of edges.items) {
      if (!isScalar(item.key) || typeof item.key.value !== 'string') continue
      const name = item.key.value
      const loc = locOf(file, item.key as Node)
      if (!isMap(item.value)) {
        diags.push(err('malformed-edge', `Edge type '${name}' must be a mapping.`, loc))
        continue
      }
      const cardinality = parseCardinality(file, item.value, name, diags, loc)
      raw.edges.push({
        id: str(item.value, 'id'),
        name,
        from: str(item.value, 'from'),
        to: str(item.value, 'to'),
        cardinality,
        props: parseProps(file, item.value, diags),
        previousIri: str(item.value, 'previousIri'),
        loc,
      })
    }
  }

  return { raw, doc, diagnostics: diags }
}
