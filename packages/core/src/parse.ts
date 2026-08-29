import { parseDocument, Document, isMap, isSeq, isScalar, YAMLMap, Node } from 'yaml'
import type { Diagnostic, Loc, ScalarType } from './ir'
import type { Cardinality } from './ir'
import {
  CARDINALITY_NAMES, DEFAULT_CARDINALITY, SCALAR_SPELLING_NAMES,
  canonicalCardinality, parsePropertyType, err,
} from './ir'

/** The raw shape of a model file, before imports or inheritance are resolved. */
export interface RawProperty {
  id?: string
  name: string
  type: ScalarType
  list: boolean
  enum?: string
  required: boolean
  unique: boolean
  loc?: Loc
}

export interface RawNode {
  id?: string
  name: string
  abstract: boolean
  open: boolean
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
      diags.push(err('unknown-type',
        `Property '${name}' has unknown type '${rawType}'. Known types: ${SCALAR_SPELLING_NAMES.join(', ')}, each also as LIST<…> or […].`, loc))
      continue
    }
    // `list: true` and a LIST<…> type say the same thing; either is enough.
    const list = parsed.list || bool(body, 'list')
    const enumRef = str(body, 'enum')
    out.push({
      id: str(body, 'id'),
      name,
      type: parsed.type,
      list,
      ...(enumRef ? { enum: enumRef } : {}),
      required: bool(body, 'required'),
      unique: bool(body, 'unique'),
      loc,
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
      const rawCard = str(item.value, 'cardinality')
      let cardinality = DEFAULT_CARDINALITY
      if (rawCard !== undefined) {
        const resolved = canonicalCardinality(rawCard)
        if (resolved) cardinality = resolved
        else {
          diags.push(err('unknown-cardinality',
            `Edge type '${name}' declares cardinality '${rawCard}', which is not a known multiplicity. Known: ${CARDINALITY_NAMES.join(', ')}.`, loc))
        }
      }
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
