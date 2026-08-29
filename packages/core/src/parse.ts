import { parseDocument, Document, isMap, isSeq, isScalar, YAMLMap, Node } from 'yaml'
import type { Diagnostic, Loc, ScalarType } from './ir'
import { SCALAR_TYPES, err } from './ir'

/** The raw shape of a model file, before imports or inheritance are resolved. */
export interface RawProperty {
  id?: string
  name: string
  type: ScalarType
  required: boolean
  unique: boolean
  loc?: Loc
}

export interface RawNode {
  id?: string
  name: string
  abstract: boolean
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
  props: RawProperty[]
  previousIri?: string
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
  namespace?: { prefix: string; iri: string }
  imports: RawImport[]
  nodes: RawNode[]
  edges: RawEdge[]
  mixins: RawMixin[]
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
    if (!SCALAR_TYPES.includes(rawType as ScalarType)) {
      diags.push(err('unknown-type',
        `Property '${name}' has unknown type '${rawType}'. Known types: ${SCALAR_TYPES.join(', ')}.`, loc))
      continue
    }
    out.push({
      id: str(body, 'id'),
      name,
      type: rawType as ScalarType,
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
  const raw: RawModel = { file, imports: [], nodes: [], edges: [], mixins: [] }
  const root = doc.contents
  if (!isMap(root)) {
    if (doc.errors.length === 0) {
      diags.push(err('malformed-model', 'A model file must be a mapping.', { file, range: [0, 0] }))
    }
    return { raw, doc, diagnostics: diags }
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
      raw.edges.push({
        id: str(item.value, 'id'),
        name,
        from: str(item.value, 'from'),
        to: str(item.value, 'to'),
        props: parseProps(file, item.value, diags),
        previousIri: str(item.value, 'previousIri'),
        loc,
      })
    }
  }

  return { raw, doc, diagnostics: diags }
}
