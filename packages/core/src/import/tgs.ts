import { parse as parseYaml } from 'yaml'
import {
  DEFAULT_CARDINALITY, info, parseBound, parsePropertyType, warn,
  type Cardinality, type Diagnostic, type EdgeTypeIR, type EnumIR, type MixinIR, type ModelIR,
  type NodeTypeIR, type PropertyIR,
} from '../ir'
import { deriveId } from '../ids'
import { nearestCommon } from './labels'
import { SCALAR_OF, SCHEMA_KEYS, splitNote, TGS_KINDS, TGS_MAJOR, type TgsKind } from '../tgs-note'
import type { ImportResult, TextImportInput } from './rdf'

/**
 * Typed Graph Schema notes read into a model. A schema folder holds any number of notes,
 * each declaring some types and edge types; together they are one ontology, and that is
 * what is read, whether the input is the folder or one note of it.
 * See lat.md/importers#Reading TGS Notes.
 */

interface PropDecl {
  name: string
  kind: TgsKind
  required: boolean
  many: boolean
  values?: unknown[]
  hasDefault: boolean
}

interface EdgeRule {
  /** Allowed targets; null when any target is allowed. */
  targets: string[] | null
  many: boolean
  required: boolean
}

interface TypeDecl {
  name: string
  note: string
  uri?: string
  properties: PropDecl[]
  /** Outgoing edges; null when the type does not restrict them. */
  edges: Map<string, EdgeRule> | null
  hasTemplate: boolean
  hasVisualization: boolean
  /** Properties named by the type's id rules, in order. */
  idProps: string[]
}

interface EdgeTypeDecl {
  name: string
  note: string
  uri?: string
  from: string[] | null
  to: string[] | null
  properties: PropDecl[]
  hasVisualization: boolean
}

/** What a note's `lpg` key says, merged over every note with the first one winning. */
interface LpgKey {
  format?: string
  namespace?: { prefix: string; iri: string }
  nodes: Map<string, Record<string, unknown>>
  edges: Map<string, Record<string, unknown>>
  mixins: Map<string, Record<string, unknown>>
  enums: Map<string, Record<string, unknown>>
}

const BUILT_IN_PREFIXES: Record<string, string> = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  sh: 'http://www.w3.org/ns/shacl#',
  schema: 'https://schema.org/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  tgs: 'https://volland.github.io/obsigraph/ns/tgs#',
}

/** The base IRI TGS names an undeclared identifier by (TGS §7). */
export const TGS_BASE_IRI = 'urn:tgs:'

const TYPE_KEYS = new Set(['uri', 'properties', 'edges', 'template', 'id', 'visualization', 'style'])
const EDGE_TYPE_KEYS = new Set(['from', 'to', 'properties', 'uri', 'visualization', 'style'])
const PROP_KEYS = new Set(['kind', 'required', 'many', 'values', 'default', 'uri', 'name'])
const RULE_KEYS = new Set(['target', 'many', 'required'])

const isMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** A nested mapping, when the key holds one. */
const sub = (o: Record<string, unknown>, k: string): Record<string, unknown> | undefined =>
  (isMap(o[k]) ? o[k] as Record<string, unknown> : undefined)

const names = (v: unknown): string[] | null => {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  return null
}

const titleOf = (path: string) => (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, '')

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A type name the model can carry: PascalCase words when it is not already an identifier. */
function typeIdent(s: string): string {
  if (IDENT.test(s)) return s
  const words = s.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const joined = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('')
  return /^[A-Za-z_]/.test(joined) ? joined : `T${joined || 'ype'}`
}

/** A property or edge name the model can carry: anything else becomes an underscore. */
function memberIdent(s: string): string {
  if (IDENT.test(s)) return s
  const replaced = s.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(replaced) ? replaced : `_${replaced}`
}

/** `depends_on` → `DependsOn`, for the names an enum is given after its property. */
const pascal = (s: string) => typeIdent(s.split(/[^A-Za-z0-9]+/).filter(Boolean)
  .map((w) => w[0]!.toUpperCase() + w.slice(1)).join('') || s)

class Reader {
  readonly diagnostics: Diagnostic[] = []
  readonly types = new Map<string, TypeDecl>()
  readonly edgeTypes = new Map<string, EdgeTypeDecl>()
  readonly prefixes = new Map<string, string>()
  readonly lpg: LpgKey = { nodes: new Map(), edges: new Map(), mixins: new Map(), enums: new Map() }
  readonly unknownKeys: string[] = []
  readonly defaults: string[] = []

  private unknown(where: string, keys: string[], allowed: Set<string>): void {
    for (const k of keys) if (!allowed.has(k)) this.unknownKeys.push(`${where}.${k}`)
  }

  private props(owner: string, v: unknown): PropDecl[] {
    const out: PropDecl[] = []
    const seen = new Set<string>()
    const add = (name: string, decl: unknown) => {
      if (seen.has(name)) return
      seen.add(name)
      out.push(this.prop(owner, name, decl))
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string') add(item, null)
        else if (isMap(item) && typeof item.name === 'string') add(item.name, item)
        else this.invalid(`${owner}.properties`, 'a list item is neither a name nor a mapping with a name')
      }
    } else if (isMap(v)) {
      for (const [name, decl] of Object.entries(v)) add(name, decl)
    } else if (v !== undefined && v !== null) {
      this.invalid(`${owner}.properties`, 'it is neither a mapping nor a list')
    }
    return out
  }

  private prop(owner: string, name: string, decl: unknown): PropDecl {
    const kindOf = (k: unknown): TgsKind => {
      if (k === undefined || k === null) return 'text'
      if (typeof k === 'string' && (TGS_KINDS as readonly string[]).includes(k)) return k as TgsKind
      this.diagnostics.push(warn('import-tgs-unknown-kind',
        `Property '${owner}.${name}' declares kind '${String(k)}', which TGS does not define. It is read as text.`))
      return 'text'
    }
    if (decl === null || decl === undefined) return { name, kind: 'text', required: false, many: false, hasDefault: false }
    if (typeof decl === 'string') {
      const kind = kindOf(decl)
      return { name, kind, required: false, many: kind === 'list', hasDefault: false }
    }
    if (!isMap(decl)) {
      this.invalid(`${owner}.${name}`, 'a property declaration is a kind or a mapping')
      return { name, kind: 'text', required: false, many: false, hasDefault: false }
    }
    this.unknown(`${owner}.${name}`, Object.keys(decl), PROP_KEYS)
    const kind = kindOf(decl.kind)
    if (decl.default !== undefined) this.defaults.push(`${owner}.${name}`)
    return {
      name, kind,
      required: decl.required === true,
      many: decl.many === true || kind === 'list',
      ...(Array.isArray(decl.values) ? { values: decl.values } : {}),
      hasDefault: decl.default !== undefined,
    }
  }

  private edgeRules(owner: string, v: unknown): Map<string, EdgeRule> | null {
    if (v === undefined || v === null) return null
    const out = new Map<string, EdgeRule>()
    if (Array.isArray(v)) {
      for (const e of v) if (typeof e === 'string') out.set(e, { targets: null, many: true, required: false })
      return out
    }
    if (!isMap(v)) { this.invalid(`${owner}.edges`, 'it is neither a list nor a mapping'); return null }
    for (const [edge, rule] of Object.entries(v)) {
      if (isMap(rule)) {
        this.unknown(`${owner}.edges.${edge}`, Object.keys(rule), RULE_KEYS)
        out.set(edge, { targets: names(rule.target), many: rule.many !== false, required: rule.required === true })
      } else {
        out.set(edge, { targets: names(rule), many: true, required: false })
      }
    }
    return out
  }

  private invalid(where: string, why: string): void {
    this.diagnostics.push(warn('import-tgs-invalid-declaration', `'${where}' is not read: ${why}.`))
  }

  private type(name: string, note: string, decl: unknown): void {
    if (this.types.has(name)) {
      this.diagnostics.push(warn('import-tgs-duplicate',
        `Type '${name}' is declared in '${this.types.get(name)!.note}' and again in '${note}'. The first is used.`))
      return
    }
    const d = isMap(decl) ? decl : {}
    if (decl !== null && decl !== undefined && !isMap(decl)) this.invalid(name, 'a type declaration is a mapping')
    this.unknown(name, Object.keys(d), TYPE_KEYS)
    const rules = Array.isArray(d.id) ? d.id : d.id === undefined ? [] : [d.id]
    const idProps = rules.map((r) => (isMap(r) ? (typeof r.property === 'string' ? r.property : 'id') : 'id'))
    this.types.set(name, {
      name, note,
      ...(typeof d.uri === 'string' ? { uri: d.uri } : {}),
      properties: this.props(name, d.properties),
      edges: this.edgeRules(name, d.edges),
      hasTemplate: d.template !== undefined,
      hasVisualization: d.visualization !== undefined || d.style !== undefined,
      idProps,
    })
  }

  private edgeType(name: string, note: string, decl: unknown): void {
    if (this.edgeTypes.has(name)) {
      this.diagnostics.push(warn('import-tgs-duplicate',
        `Edge type '${name}' is declared in '${this.edgeTypes.get(name)!.note}' and again in '${note}'. The first is used.`))
      return
    }
    const d = isMap(decl) ? decl : {}
    this.unknown(name, Object.keys(d), EDGE_TYPE_KEYS)
    this.edgeTypes.set(name, {
      name, note,
      ...(typeof d.uri === 'string' ? { uri: d.uri } : {}),
      from: names(d.from), to: names(d.to),
      properties: this.props(name, d.properties),
      hasVisualization: d.visualization !== undefined || d.style !== undefined,
    })
  }

  private lpgKey(v: unknown): void {
    if (!isMap(v)) return
    if (this.lpg.format === undefined && (typeof v.format === 'string' || typeof v.format === 'number')) this.lpg.format = String(v.format)
    const ns = v.namespace
    if (!this.lpg.namespace && isMap(ns) && typeof ns.prefix === 'string' && typeof ns.iri === 'string') {
      this.lpg.namespace = { prefix: ns.prefix, iri: ns.iri }
    }
    for (const part of ['nodes', 'edges', 'mixins', 'enums'] as const) {
      const entries = v[part]
      if (!isMap(entries)) continue
      for (const [name, x] of Object.entries(entries)) {
        if (isMap(x) && !this.lpg[part].has(name)) this.lpg[part].set(name, x)
      }
    }
  }

  read(input: TextImportInput): void {
    const { frontmatter } = splitNote(input.text)
    const title = titleOf(input.path)
    let fm: unknown = {}
    if (frontmatter !== undefined) {
      try { fm = parseYaml(frontmatter) ?? {} } catch (e) {
        this.diagnostics.push(warn('import-tgs-invalid-frontmatter',
          `'${input.path}' has frontmatter that is not YAML: ${(e as Error).message.split('\n')[0]}`))
        return
      }
    }
    if (!isMap(fm)) {
      this.diagnostics.push(warn('import-tgs-invalid-frontmatter', `The frontmatter of '${input.path}' is not a mapping.`))
      return
    }
    if (fm.tgs !== undefined) {
      const major = Number(String(fm.tgs).split('.')[0])
      if (major !== TGS_MAJOR) {
        this.diagnostics.push(warn('import-tgs-version',
          `'${input.path}' declares TGS ${String(fm.tgs)}; this reader implements ${TGS_MAJOR}.x, so none of its declarations are read.`))
        return
      }
    }
    if (isMap(fm.prefixes)) {
      for (const [p, iri] of Object.entries(fm.prefixes)) {
        if (typeof iri !== 'string') continue
        const had = this.prefixes.get(p)
        if (had !== undefined && had !== iri) {
          this.diagnostics.push(warn('import-tgs-duplicate',
            `Prefix '${p}' is bound to ${had} and again, in '${input.path}', to ${iri}. The first is used.`))
          continue
        }
        this.prefixes.set(p, iri)
      }
    }
    const declares = SCHEMA_KEYS.some((k) => k in fm)
    // A schema note that declares nothing declares an empty type named by its title (TGS §3).
    if (!declares) this.type(title, input.path, {})
    if ('schema' in fm) this.type(title, input.path, fm.schema)
    if (isMap(fm.schemas)) for (const [name, decl] of Object.entries(fm.schemas)) this.type(name, input.path, decl)
    if (isMap(fm.edgeTypes)) for (const [name, decl] of Object.entries(fm.edgeTypes)) this.edgeType(name, input.path, decl)
    this.lpgKey(fm.lpg)
  }

  /** A `uri` as a full IRI, per TGS §7. */
  expand(uri: string): string | undefined {
    const colon = uri.indexOf(':')
    if (colon < 0) return undefined
    const p = uri.slice(0, colon)
    const local = uri.slice(colon + 1)
    if (local.startsWith('//')) return uri
    const base = this.prefixes.get(p) ?? BUILT_IN_PREFIXES[p]
    if (base !== undefined) return base + local
    if (['http', 'https', 'urn', 'mailto', 'tag', 'did', 'file'].includes(p)) return uri
    return undefined
  }
}

export interface TgsImportOptions {
  /** What names the model when the notes do not: a folder or note name. */
  name?: string
}

/**
 * What names a model read from notes that do not name it: the note for one note, and for
 * a folder the folder -- or, for the default schema folder `Types`, the vault it sits in.
 */
function defaultName(inputs: TextImportInput[]): string | undefined {
  const first = inputs[0]?.path
  if (!first) return undefined
  if (inputs.length === 1) return titleOf(first)
  const parts = first.split(/[\\/]/)
  const folder = parts[parts.length - 2]
  return folder === 'Types' ? parts[parts.length - 3] ?? folder : folder
}

/** The note title the namespace prefix falls back to, as a prefix the model accepts. */
function prefixFrom(name: string | undefined): string {
  const cleaned = (name ?? '').replace(/\.md$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[^A-Za-z]+/, '').replace(/-+$/, '')
  return cleaned || 'model'
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

export function importTgs(inputs: TextImportInput[], options: TgsImportOptions = {}): ImportResult {
  const reader = new Reader()
  const sorted = [...inputs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const input of sorted) reader.read(input)
  const { diagnostics, lpg } = reader

  // --- Names -------------------------------------------------------------------------
  const renamed: string[] = []
  const typeName = new Map<string, string>()
  const nameType = (original: string): string => {
    const known = typeName.get(original)
    if (known) return known
    const taken = new Set(typeName.values())
    let n = typeIdent(original)
    for (let i = 2; taken.has(n); i++) n = `${typeIdent(original)}${i}`
    if (n !== original) renamed.push(`${original}→${n}`)
    typeName.set(original, n)
    return n
  }
  const member = (original: string): string => {
    const n = memberIdent(original)
    if (n !== original && !renamed.includes(`${original}→${n}`)) renamed.push(`${original}→${n}`)
    return n
  }
  for (const t of reader.types.keys()) nameType(t)

  // A type named as an endpoint or a target but declared by no note still has to exist
  // for the edge to have somewhere to go.
  const referenced = new Set<string>()
  for (const e of reader.edgeTypes.values()) for (const n of [...(e.from ?? []), ...(e.to ?? [])]) referenced.add(n)
  for (const t of reader.types.values()) for (const r of t.edges?.values() ?? []) for (const n of r.targets ?? []) referenced.add(n)
  const undeclared = [...referenced].filter((n) => !reader.types.has(n)).sort()
  for (const n of undeclared) {
    reader.types.set(n, { name: n, note: '', properties: [], edges: null, hasTemplate: false, hasVisualization: false, idProps: [] })
    nameType(n)
  }
  if (undeclared.length > 0) {
    diagnostics.push(info('import-tgs-undeclared-type',
      `${undeclared.join(', ')} ${undeclared.length === 1 ? 'is' : 'are'} named as an endpoint or a target but declared by no note, so ${undeclared.length === 1 ? 'it is' : 'they are'} read as ${undeclared.length === 1 ? 'an empty node type' : 'empty node types'}.`))
  }

  // --- Namespace ---------------------------------------------------------------------
  let namespace = lpg.namespace
  if (!namespace) {
    const curiePrefixes = new Set([...reader.types.values()].filter((t) => t.uri)
      .map((t) => t.uri!.slice(0, Math.max(0, t.uri!.indexOf(':')))))
    const [only] = [...curiePrefixes]
    const declared = [...reader.types.values()].every((t) => t.note === '' || t.uri !== undefined)
    if (curiePrefixes.size === 1 && only && declared && reader.prefixes.has(only)) {
      namespace = { prefix: only, iri: reader.prefixes.get(only)! }
    } else {
      namespace = { prefix: prefixFrom(options.name ?? defaultName(sorted)), iri: TGS_BASE_IRI }
    }
  }
  const prefixes: Record<string, string> = {}
  for (const [p, iri] of reader.prefixes) if (p !== namespace.prefix) prefixes[p] = iri

  // --- Enums -------------------------------------------------------------------------
  const enums: EnumIR[] = []
  const enumByValues = new Map<string, EnumIR>()
  const enumNames = new Set<string>()
  const allTypeNames = new Set(typeName.values())
  const listsByProp = new Map<string, Set<string>>()
  const valueOwners: Array<[string, PropDecl]> = [
    ...[...reader.types.values()].flatMap((t) => t.properties.map((p) => [t.name, p] as [string, PropDecl])),
    ...[...reader.edgeTypes.values()].flatMap((e) => e.properties.map((p) => [e.name, p] as [string, PropDecl])),
  ]
  for (const [, p] of valueOwners) {
    if (!p.values) continue
    const set = listsByProp.get(p.name) ?? new Set<string>()
    set.add(JSON.stringify(p.values.map(String)))
    listsByProp.set(p.name, set)
  }
  const droppedValues: string[] = []
  const enumFor = (owner: string, p: PropDecl, named?: string): string | undefined => {
    if (!p.values) return undefined
    if (p.kind !== 'text' && p.kind !== 'list') { droppedValues.push(`${owner}.${p.name}`); return undefined }
    const values = p.values.map(String)
    const key = JSON.stringify(values)
    if (named) {
      const existing = enums.find((e) => e.name === named)
      if (existing) return existing.name
      const recorded = lpg.enums.get(named)
      const e: EnumIR = {
        id: str(recorded?.id) ?? deriveId('enum', named), name: named, qname: named, iri: named, prefix: '', values,
      }
      enums.push(e); enumNames.add(named); enumByValues.set(key, e)
      return named
    }
    const shared = enumByValues.get(key)
    if (shared) return shared.name
    const base = (listsByProp.get(p.name)?.size ?? 0) > 1 ? pascal(owner) + pascal(p.name) : pascal(p.name)
    let name = base
    for (let i = 2; enumNames.has(name) || allTypeNames.has(name); i++) name = `${base}${i}`
    const e: EnumIR = { id: deriveId('enum', name), name, qname: name, iri: name, prefix: '', values }
    enums.push(e); enumNames.add(name); enumByValues.set(key, e)
    return name
  }

  // --- Properties --------------------------------------------------------------------
  const linkProps: string[] = []
  const toProp = (owner: string, p: PropDecl, extras: Record<string, unknown> | undefined): PropertyIR => {
    const name = member(p.name)
    const written = str(extras?.type)
    const parsed = written ? parsePropertyType(written) : undefined
    if (written && !parsed) {
      diagnostics.push(warn('import-tgs-stale-lpg', `'${owner}.${p.name}' records type '${written}' in its lpg key, which is not a model type. The TGS kind is used.`))
    }
    if (p.kind === 'link' && !parsed) linkProps.push(`${owner}.${p.name}`)
    const enumName = enumFor(owner, p, str(extras?.enum))
    const prop: PropertyIR = {
      id: str(extras?.id) ?? deriveId('prop', name, owner),
      name,
      type: parsed?.type ?? SCALAR_OF[p.kind],
      list: parsed?.composite ? parsed.list : p.many,
      required: p.required,
      unique: extras?.unique === true,
      ...(parsed?.composite ? { composite: parsed.composite } : {}),
      ...(parsed?.precision !== undefined ? { precision: parsed.precision, scale: parsed.scale } : {}),
      ...(enumName ? { enum: enumName } : {}),
    }
    for (const k of ['min', 'max', 'minLength', 'maxLength'] as const) {
      const v = num(extras?.[k])
      if (v !== undefined) prop[k] = v
    }
    const pattern = str(extras?.pattern)
    if (pattern !== undefined) prop.pattern = pattern
    return prop
  }

  // --- The lpg key, checked against what the TGS keys still declare ------------------
  const stale: string[] = []
  const nodeLpg = (original: string) => lpg.nodes.get(original)
  const parentOf = new Map<string, string>()
  for (const t of reader.types.values()) {
    const ext = str(nodeLpg(t.name)?.extends)
    if (ext && reader.types.has(ext)) parentOf.set(t.name, ext)
    else if (ext) stale.push(`${t.name} extends ${ext}`)
  }
  for (const n of lpg.nodes.keys()) if (!reader.types.has(n)) stale.push(n)
  for (const e of lpg.edges.keys()) {
    const declaredSomewhere = reader.edgeTypes.has(e)
      || [...reader.types.values()].some((t) => t.edges?.has(e))
    if (!declaredSomewhere) stale.push(e)
  }
  if (stale.length > 0) {
    diagnostics.push(warn('import-tgs-stale-lpg',
      `The lpg key records ${stale.sort().join(', ')}, which no note's TGS keys declare any more. ${stale.length === 1 ? 'It is' : 'They are'} not imported.`))
  }
  const ancestorsOf = (n: string): string[] => {
    const out: string[] = []
    let cur = parentOf.get(n)
    while (cur && !out.includes(cur) && cur !== n) { out.push(cur); cur = parentOf.get(cur) }
    return out
  }

  // An enum no property names any more is still part of the model it was exported from.
  const recordEnums = () => {
    for (const [ename, x] of lpg.enums) {
      if (enums.some((e) => e.name === ename) || !Array.isArray(x.values)) continue
      enums.push({
        id: str(x.id) ?? deriveId('enum', ename), name: ename, qname: ename, iri: ename, prefix: '',
        values: x.values.map(String),
      })
    }
  }

  // --- Mixins ------------------------------------------------------------------------
  const mixins: MixinIR[] = []
  const mixinProps = new Map<string, Set<string>>()
  for (const [mname, x] of lpg.mixins) {
    const recorded = isMap(x.props) ? x.props : {}
    const propNames = Object.keys(recorded)
    const carrier = [...reader.types.values()].find((t) => (names(nodeLpg(t.name)?.mixins) ?? []).includes(mname))
    const props: PropertyIR[] = []
    for (const pn of propNames) {
      const decl = carrier?.properties.find((p) => p.name === pn)
        ?? { name: pn, kind: 'text' as TgsKind, required: false, many: false, hasDefault: false }
      props.push(toProp(mname, decl, sub(recorded, pn)))
    }
    mixins.push({ id: str(x.id) ?? deriveId('mixin', mname), name: mname, props })
    mixinProps.set(mname, new Set(propNames))
  }

  // --- Node types --------------------------------------------------------------------
  const notCarried = { templates: [] as string[], visualization: [] as string[], idRules: [] as string[], iris: [] as string[] }
  const titleKeyed: string[] = []
  const unknownPrefixes: string[] = []
  const nodes: NodeTypeIR[] = []
  for (const t of reader.types.values()) {
    const x = nodeLpg(t.name)
    const name = typeName.get(t.name)!
    const extras = isMap(x?.props) ? x.props : {}
    const inherited = new Set(ancestorsOf(t.name).flatMap((a) => reader.types.get(a)!.properties.map((p) => p.name)))
    const mixinNames = (names(x?.mixins) ?? []).filter((m) => mixinProps.has(m))
    for (const m of mixinNames) for (const pn of mixinProps.get(m)!) inherited.add(pn)
    const props = t.properties.filter((p) => !inherited.has(p.name))
      .map((p) => toProp(name, p, sub(extras, p.name)))
    if (t.hasTemplate) notCarried.templates.push(t.name)
    if (t.hasVisualization) notCarried.visualization.push(t.name)
    if (t.uri) {
      const iri = reader.expand(t.uri)
      if (iri === undefined) unknownPrefixes.push(`${t.name} (${t.uri})`)
      else if (iri !== namespace.iri + name) notCarried.iris.push(`${t.name} (${t.uri})`)
    }
    const parent = parentOf.get(t.name)
    nodes.push({
      id: str(x?.id) ?? deriveId('node', name), name, qname: name, iri: name, prefix: '',
      abstract: x?.abstract === true, open: x?.open === true,
      ...(parent ? { extends: typeName.get(parent)! } : {}),
      ancestors: ancestorsOf(t.name).map((a) => typeName.get(a)!),
      mixins: mixinNames,
      key: (names(x?.key) ?? []).map(member),
      props, constraints: [],
    })
  }

  // Decision 4: every concrete type has a key. A note's identity is its title, so a
  // type that names none gets that, said out loud.
  const byName = new Map(nodes.map((n) => [n.name, n]))
  const keyed = (n: NodeTypeIR): boolean =>
    n.key.length > 0 || (!!n.extends && !!byName.get(n.extends) && keyed(byName.get(n.extends)!))
  for (const t of reader.types.values()) {
    const node = byName.get(typeName.get(t.name)!)!
    const [idProp, ...otherRules] = t.idProps
    if (otherRules.length > 0) notCarried.idRules.push(...otherRules.map((p) => `${t.name}.${p}`))
    if (node.abstract || keyed(node)) {
      if (idProp && node.key.length === 0) notCarried.idRules.push(`${t.name}.${idProp}`)
      continue
    }
    const keyName = idProp ? member(idProp) : 'title'
    let prop = node.props.find((p) => p.name === keyName)
    if (!prop) {
      prop = { id: deriveId('prop', keyName, node.name), name: keyName, type: 'string', list: false, required: true, unique: false }
      node.props.unshift(prop)
    }
    prop.required = true
    node.key = [keyName]
    if (!idProp) titleKeyed.push(node.name)
  }

  // --- Edge types --------------------------------------------------------------------
  const edgeNames = new Set<string>([...reader.edgeTypes.keys()])
  for (const t of reader.types.values()) for (const e of t.edges?.keys() ?? []) edgeNames.add(e)
  const ancestorMap = new Map(nodes.map((n) => [n.name, n.ancestors]))
  const edges: EdgeTypeIR[] = []
  const open: string[] = []
  const unions: string[] = []
  const collapse = (edge: string, side: string, candidates: string[]): string => {
    const unique = [...new Set(candidates)]
    if (unique.length === 1) return unique[0]!
    const common = nearestCommon(unique, ancestorMap)
    if (common) return common
    unions.push(`${edge} ${side} ${unique[0]} (dropped ${unique.slice(1).join(', ')})`)
    return unique[0]!
  }
  for (const ename of edgeNames) {
    const decl = reader.edgeTypes.get(ename)
    if (decl?.hasVisualization) notCarried.visualization.push(ename)
    const x = lpg.edges.get(ename)
    const sourcesFromTypes = [...reader.types.values()].filter((t) => t.edges?.has(ename))
    const rules = sourcesFromTypes.map((t) => t.edges!.get(ename)!)
    const name = member(ename)

    let from: string | undefined
    let to: string | undefined
    const recordedFrom = str(x?.from)
    const recordedTo = str(x?.to)
    if (recordedFrom && recordedTo && reader.types.has(recordedFrom) && reader.types.has(recordedTo)) {
      from = typeName.get(recordedFrom)
      to = typeName.get(recordedTo)
    } else {
      const sources = [...(decl?.from ?? []), ...sourcesFromTypes.map((t) => t.name)]
      const targetSets = rules.map((r) => r.targets ?? decl?.to ?? null)
      if (decl?.to) targetSets.push(decl.to)
      const targets = targetSets.some((s) => s === null) ? null : targetSets.flatMap((s) => s!)
      if (sources.length === 0 || !targets || targets.length === 0) {
        open.push(ename)
        continue
      }
      from = collapse(ename, 'from', sources.map((s) => typeName.get(s)!))
      to = collapse(ename, 'to', targets.map((s) => typeName.get(s)!))
    }

    let cardinality: Cardinality = DEFAULT_CARDINALITY()
    const recorded = isMap(x?.cardinality) ? x!.cardinality as Record<string, unknown> : undefined
    const fromB = recorded ? parseBound(String(recorded.from ?? '*')) : undefined
    const toB = recorded ? parseBound(String(recorded.to ?? '*')) : undefined
    if (fromB && toB) cardinality = { from: fromB, to: toB }
    else if (rules.length > 0) {
      if (rules.every((r) => !r.many)) cardinality.to.max = 1
      if (rules.every((r) => r.required)) cardinality.to.min = 1
    }
    const extras = isMap(x?.props) ? x!.props as Record<string, unknown> : {}
    edges.push({
      id: str(x?.id) ?? deriveId('edge', name), name, qname: name, iri: name, prefix: '',
      from: from!, to: to!, cardinality,
      props: (decl?.properties ?? []).map((p) => toProp(name, p, sub(extras, p.name))),
    })
    if (decl?.uri) {
      const iri = reader.expand(decl.uri)
      if (iri === undefined) unknownPrefixes.push(`${ename} (${decl.uri})`)
      else if (iri !== namespace.iri + name) notCarried.iris.push(`${ename} (${decl.uri})`)
    }
  }

  recordEnums()

  // --- Reports -----------------------------------------------------------------------
  const some = (xs: string[]) => `${xs.slice(0, 8).join(', ')}${xs.length > 8 ? ', …' : ''}`
  if (open.length > 0) {
    diagnostics.push(warn('import-tgs-open-endpoint',
      `${open.join(', ')} ${open.length === 1 ? 'allows' : 'allow'} any type at one end, and an edge type here runs between two named types, so ${open.length === 1 ? 'it is' : 'they are'} not imported.`))
  }
  if (unions.length > 0) {
    diagnostics.push(warn('import-tgs-endpoint-union',
      `An edge type here has one type at each end. With no common ancestor to stand for the several TGS names, the first is kept: ${unions.join('; ')}.`))
  }
  if (titleKeyed.length > 0) {
    diagnostics.push(info('import-tgs-title-key',
      `${some(titleKeyed)} ${titleKeyed.length === 1 ? 'names' : 'name'} no identity, and every concrete node type needs a key, so each is keyed by a required 'title': a note is identified by its title.`))
  }
  const carried: string[] = []
  if (notCarried.templates.length > 0) carried.push(`templates of ${some(notCarried.templates)}`)
  if (reader.defaults.length > 0) carried.push(`defaults of ${some(reader.defaults)}`)
  if (notCarried.idRules.length > 0) carried.push(`id rules ${some(notCarried.idRules)}`)
  if (notCarried.visualization.length > 0) carried.push(`visualization of ${some(notCarried.visualization)}`)
  if (notCarried.iris.length > 0) carried.push(`IRIs outside the namespace ${namespace.iri}: ${some(notCarried.iris)}`)
  if (linkProps.length > 0) carried.push(`the link kind of ${some(linkProps)}, read as strings`)
  if (droppedValues.length > 0) carried.push(`allowed values of the non-text properties ${some(droppedValues)}`)
  if (carried.length > 0) {
    diagnostics.push(info('import-tgs-not-carried', `The model has nowhere to keep ${carried.join('; ')}.`))
  }
  if (unknownPrefixes.length > 0) {
    diagnostics.push(warn('import-tgs-unknown-prefix',
      `A uri names a prefix no note binds and TGS does not build in: ${unknownPrefixes.join(', ')}.`))
  }
  if (reader.unknownKeys.length > 0) {
    diagnostics.push(info('import-tgs-unknown-key',
      `Keys this reader does not know were ignored: ${some(reader.unknownKeys)}.`))
  }
  if (renamed.length > 0) {
    diagnostics.push(info('import-renamed',
      `${renamed.length} TGS name(s) were read into model spelling: ${some(renamed)}.`))
  }

  // Sorted, so the folder layout and the single layout of one model import identically.
  const byNameOrder = <T extends { name: string }>(a: T, b: T) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  nodes.sort(byNameOrder)
  edges.sort(byNameOrder)
  const model: ModelIR = {
    file: sorted[0]?.path ?? '',
    ...(lpg.format !== undefined ? { formatVersion: lpg.format } : {}),
    namespace, prefixes, nodes, edges, mixins, enums,
  }
  return { model, diagnostics }
}

/** Whether a text is a TGS schema note: a frontmatter declaring one of the TGS keys. */
export function looksLikeTgs(text: string): boolean {
  const { frontmatter } = splitNote(text)
  if (frontmatter === undefined) return false
  return /^(tgs|schema|schemas|edgeTypes)\s*:/m.test(frontmatter)
}
