import type { Diagnostic, EdgeTypeIR, EnumIR, MixinIR, ModelIR, NodeTypeIR, PropertyIR, ScalarType } from '../ir'
import { concreteDescendants, describeCardinality, err, formatBound, info, isUnconstrained, warn } from '../ir'
import {
  compositeDowngrade, downgrade, reportUnsupportedConstraints,
  type Capabilities, type EmitOptions, type EmitResult,
} from '../capabilities'
import { writtenType } from '../serialize'
import { collectPrefixes, term } from './reify'
import { parse as parseYaml } from 'yaml'
import {
  flow, frontmatterBlocks, KIND_OF, OWNED_KEYS, SCALAR_OF, splitNote, TGS_WRITTEN_VERSION, yamlString,
} from '../tgs-note'

/**
 * Typed Graph Schema notes: YAML frontmatter in Markdown notes in a `Types/` folder, which
 * Typed Graph (the Obsidian plugin and `tg`) reads. TGS has properties, typed edges and
 * edge properties, and nothing about identity, inheritance or uniqueness, so those travel
 * in a note-level `lpg` key that TGS readers must ignore (TGS §3), and each is reported.
 * See lat.md/emitters#TGS Target.
 */
export const TGS_CAPABILITIES: Capabilities = {
  target: 'tgs',
  // A note's `type` may be a list, and its schema is the merge of its labels (TGS §10).
  multiLabel: true,
  // There is no inheritance: every type carries its inherited properties itself.
  inheritance: 'leaf-tables',
  // A TGS validator reports `missing-property`.
  requiredConstraint: 'enforced',
  uniqueConstraint: 'unsupported',
  compositeKey: 'unsupported',
  edgeProps: 'native',
  nestedEdges: false,
  listProps: 'native',
  compositeTypes: 'unsupported',
  enums: 'enforced',
  // Frontmatter is open by definition: TGS never closes a note's properties.
  openTypes: 'always-open',
  valueConstraints: 'unsupported',
  namedConstraints: 'unsupported',
  rawPassthrough: false,
  // `many: false` and `required: true` on a type's edge entry bound the to end at one.
  cardinality: 'upper-bound-only',
}

/** How the notes are laid out in the schema folder. See lat.md/emitters#TGS Target#Layouts. */
export type TgsLayout = 'folder' | 'single'
export const TGS_LAYOUTS: readonly TgsLayout[] = ['folder', 'single']

export interface TgsExportOptions {
  layout: TgsLayout
  /** File name, without `.md`, of the single note. Defaults to the namespace prefix. */
  stem?: string
  /** What the model was read from, named in the single note's body. */
  source?: string
  /**
   * The notes already in the schema folder, by file name. An export merges into a note
   * that exists rather than overwriting it, and reports notes it leaves stale.
   */
  existing?: Record<string, string>
  /** Rewrite a note even when it declares types this export does not contain. */
  force?: boolean
}

export interface TgsNote {
  /** File name inside the schema folder. */
  file: string
  content: string
  /** The node types and edge types this note declares. */
  types: string[]
  edgeTypes: string[]
  /** Whether an existing note was merged into rather than created. */
  merged: boolean
}

export interface TgsExportResult {
  notes: TgsNote[]
  diagnostics: Diagnostic[]
}

/** Scalars with no TGS kind of their own: each is written as text and reported. */
const LOSSY_TYPES = new Set<ScalarType>(['uuid', 'json', 'duration', 'blob'])

const own = (props: PropertyIR[]) => props.filter((p) => !p.inheritedFrom)

/** The scalar a TGS declaration reads back as, so the exact type is recorded only when it differs. */
function readsBackExactly(p: PropertyIR): boolean {
  if (p.composite) return false
  if (p.precision !== undefined) return false
  return SCALAR_OF[KIND_OF[p.type]] === p.type
}

interface Context {
  model: ModelIR
  diagnostics: Diagnostic[]
  enums: Map<string, EnumIR>
  /** Edge types leaving each node type, inherited ones included. */
  outgoing: Map<string, EdgeTypeIR[]>
}

/** A type's concrete descendants, or the type itself when it has none to stand for it. */
function expand(model: ModelIR, name: string): string[] {
  const names = concreteDescendants(model, name).map((n) => n.name).sort()
  return names.length > 0 ? names : [name]
}

const one = (names: string[]): string | string[] => (names.length === 1 ? names[0]! : names)

/** A property declaration: the kind shorthand when that says everything, a mapping otherwise. */
function propertyDecl(ctx: Context, owner: string, p: PropertyIR): unknown {
  if (p.composite) compositeDowngrade(ctx.diagnostics, 'tgs', owner, p, p.list ? 'text, many' : 'text')
  else if (LOSSY_TYPES.has(p.type)) {
    downgrade(ctx.diagnostics, 'tgs', 'downgrade-type',
      `Property '${owner}.${p.name}' has type ${p.type}, which TGS has no kind for. Declared as text; the exact type is kept in the note's lpg key.`,
      p.loc)
  }
  const kind = p.composite ? 'text' : KIND_OF[p.type]
  const listOfText = p.list && !p.composite && p.type === 'string' && !p.enum
  const decl: Record<string, unknown> = {}
  if (listOfText) decl.kind = 'list'
  else if (kind !== 'text') decl.kind = kind
  if (p.list && !listOfText) decl.many = true
  if (p.required) decl.required = true
  const values = p.enum ? ctx.enums.get(p.enum)?.values : undefined
  if (values) decl.values = values
  const keys = Object.keys(decl)
  if (keys.length === 0) return 'text'
  if (keys.length === 1 && keys[0] === 'kind') return decl.kind
  return decl
}

/** What the `lpg` key records about a property: only what its TGS declaration cannot say. */
function propertyExtras(p: PropertyIR): Record<string, unknown> {
  const x: Record<string, unknown> = { id: p.id }
  if (!readsBackExactly(p)) x.type = writtenType(p)
  if (p.unique) x.unique = true
  if (p.enum) x.enum = p.enum
  if (p.min !== undefined) x.min = p.min
  if (p.max !== undefined) x.max = p.max
  if (p.minLength !== undefined) x.minLength = p.minLength
  if (p.maxLength !== undefined) x.maxLength = p.maxLength
  if (p.pattern !== undefined) x.pattern = p.pattern
  return x
}

function propertiesBlock(ctx: Context, owner: string, props: PropertyIR[], indent: string): string[] {
  if (props.length === 0) return []
  const lines = [`${indent}properties:`]
  for (const p of props) lines.push(`${indent}  ${yamlString(p.name)}: ${flow(propertyDecl(ctx, owner, p))}`)
  return lines
}

/** A type's entry for one outgoing edge: the targets, and the to end's bound when it is one. */
function edgeEntry(ctx: Context, e: EdgeTypeIR): unknown {
  const target = one(expand(ctx.model, e.to))
  const b = e.cardinality.to
  if (b.max !== 1 && b.min < 1) return target
  const entry: Record<string, unknown> = { target }
  if (b.max === 1) entry.many = false
  if (b.min >= 1) entry.required = true
  return entry
}

function typeBlock(ctx: Context, node: NodeTypeIR, indent: string): string[] {
  const lines = [`${indent}uri: ${yamlString(term(node))}`]
  lines.push(...propertiesBlock(ctx, node.name, node.props, indent))
  // Always written: an LPG type's outgoing edges are exactly those declared, and TGS reads
  // an absent `edges` as "any edge at all".
  const out = ctx.outgoing.get(node.name) ?? []
  if (out.length === 0) lines.push(`${indent}edges: {}`)
  else {
    lines.push(`${indent}edges:`)
    for (const e of out) lines.push(`${indent}  ${yamlString(e.name)}: ${flow(edgeEntry(ctx, e))}`)
  }
  return lines
}

function edgeTypeBlock(ctx: Context, e: EdgeTypeIR, indent: string): string[] {
  const lines = [
    `${indent}uri: ${yamlString(term(e))}`,
    `${indent}from: ${flow(one(expand(ctx.model, e.from)))}`,
    `${indent}to: ${flow(one(expand(ctx.model, e.to)))}`,
  ]
  lines.push(...propertiesBlock(ctx, e.name, e.props, indent))
  return lines
}

function nodeExtras(node: NodeTypeIR): Record<string, unknown> {
  const x: Record<string, unknown> = { id: node.id }
  if (node.abstract) x.abstract = true
  if (node.open) x.open = true
  if (node.extends) x.extends = node.extends
  if (node.mixins.length > 0) x.mixins = node.mixins
  if (node.key.length > 0 && !node.keyInheritedFrom) x.key = node.key
  const props = own(node.props)
  if (props.length > 0) x.props = Object.fromEntries(props.map((p) => [p.name, propertyExtras(p)]))
  return x
}

function edgeExtras(e: EdgeTypeIR): Record<string, unknown> {
  const x: Record<string, unknown> = { id: e.id, from: e.from, to: e.to }
  if (!isUnconstrained(e.cardinality)) {
    x.cardinality = { from: formatBound(e.cardinality.from), to: formatBound(e.cardinality.to) }
  }
  if (e.props.length > 0) x.props = Object.fromEntries(e.props.map((p) => [p.name, propertyExtras(p)]))
  return x
}

function mixinExtras(m: MixinIR): Record<string, unknown> {
  return { id: m.id, props: Object.fromEntries(m.props.map((p) => [p.name, propertyExtras(p)])) }
}

/** The `lpg` key for the elements of one note. */
function lpgBlock(
  ctx: Context, nodes: NodeTypeIR[], edges: EdgeTypeIR[], mixins: MixinIR[], enums: EnumIR[],
): string[] {
  const { prefix, iri } = ctx.model.namespace
  const lines = ['lpg:']
  // The model's own format version, so a model that declared one still does after a round trip.
  if (ctx.model.formatVersion !== undefined) lines.push(`  format: ${JSON.stringify(ctx.model.formatVersion)}`)
  lines.push(`  namespace: ${flow({ prefix, iri })}`)
  if (nodes.length > 0) {
    lines.push('  nodes:')
    for (const n of nodes) lines.push(`    ${yamlString(n.name)}: ${flow(nodeExtras(n))}`)
  }
  if (edges.length > 0) {
    lines.push('  edges:')
    for (const e of edges) lines.push(`    ${yamlString(e.name)}: ${flow(edgeExtras(e))}`)
  }
  if (mixins.length > 0) {
    lines.push('  mixins:')
    for (const m of mixins) lines.push(`    ${yamlString(m.name)}: ${flow(mixinExtras(m))}`)
  }
  if (enums.length > 0) {
    lines.push('  enums:')
    for (const e of enums) lines.push(`    ${yamlString(e.name)}: ${flow({ id: e.id, values: e.values })}`)
  }
  return lines
}

function prefixesBlock(model: ModelIR): string[] {
  const entries = [...collectPrefixes(model)].sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return []
  return ['prefixes:', ...entries.map(([p, iri]) => `  ${yamlString(p)}: ${yamlString(iri)}`)]
}

/** Everything the target cannot say, reported once per site. */
function reportDowngrades(ctx: Context): void {
  const { model, diagnostics } = ctx
  for (const n of model.nodes) {
    if (n.abstract) {
      downgrade(diagnostics, 'tgs', 'downgrade-abstract',
        `Node type '${n.name}' is abstract, which TGS cannot say: notes of it can be created. It is recorded in the note's lpg key.`,
        n.loc)
    }
    if (n.extends) {
      downgrade(diagnostics, 'tgs', 'downgrade-inheritance',
        `Node type '${n.name}' extends '${n.extends}', which TGS has no hierarchy for. Its inherited properties are written on it, and its edges' endpoints list concrete types.`,
        n.loc)
    }
    if (n.key.length > 0 && !n.keyInheritedFrom) {
      downgrade(diagnostics, 'tgs', 'downgrade-key',
        `Node type '${n.name}' is keyed by (${n.key.join(', ')}), which TGS has no identity for: a note is identified by its title. The key is recorded in the note's lpg key.`,
        n.loc)
    }
    for (const p of own(n.props)) {
      if (p.unique && !n.key.includes(p.name)) {
        downgrade(diagnostics, 'tgs', 'downgrade-unique',
          `Property '${n.name}.${p.name}' is unique, which a TGS validator does not check. It is recorded in the note's lpg key.`,
          p.loc)
      }
    }
  }
  for (const e of model.edges) {
    const { from, to } = e.cardinality
    const fromBounded = !(from.min === 0 && from.max === null)
    const toBeyondOne = to.min > 1 || (to.max !== null && to.max > 1)
    if (fromBounded || toBeyondOne) {
      downgrade(diagnostics, 'tgs', 'downgrade-cardinality',
        `Edge type '${e.name}' declares ${describeCardinality(e.cardinality)} cardinality. TGS bounds only the to end, at zero or one, so the exact bound is kept in the note's lpg key and not enforced.`,
        e.loc)
    }
  }
  const closed = model.nodes.filter((n) => !n.open && !n.abstract).length
  if (closed > 0) {
    diagnostics.push({
      severity: 'info', code: 'downgrade-open', target: 'tgs',
      message: `TGS frontmatter is always open, so the ${closed} closed node type(s) will accept properties they do not declare.`,
    })
  }
  reportUnsupportedConstraints(diagnostics, 'tgs', model, TGS_CAPABILITIES)
}

/** The node types and edge types an existing note declares, for the refusal of TGS §13.5. */
function declaredBy(file: string, text: string): { types: string[]; edgeTypes: string[] } {
  const { frontmatter } = splitNote(text)
  if (frontmatter === undefined) return { types: [], edgeTypes: [] }
  let fm: unknown
  try { fm = parseYaml(frontmatter) } catch { return { types: [], edgeTypes: [] } }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return { types: [], edgeTypes: [] }
  const o = fm as Record<string, unknown>
  const keys = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v) : [])
  const types = keys(o.schemas)
  if ('schema' in o) types.push(file.replace(/\.md$/i, ''))
  return { types, edgeTypes: keys(o.edgeTypes) }
}

/**
 * Write the owned keys into a note, keeping every other key byte for byte and the body.
 * A note that does not exist yet gets the generated body.
 */
function mergeNote(existing: string | undefined, owned: string[], body: string): string {
  if (existing === undefined) return ['---', ...owned, '---', body].join('\n')
  const { frontmatter, body: oldBody } = splitNote(existing)
  const kept = frontmatter === undefined ? [] : frontmatterBlocks(frontmatter)
    .filter((b) => b.key === undefined || !(OWNED_KEYS as readonly string[]).includes(b.key))
    .flatMap((b) => b.lines)
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop()
  const keptBody = frontmatter === undefined ? existing : oldBody
  return ['---', ...owned, ...kept, '---', keptBody.trim() === '' ? body : keptBody].join('\n')
}

/** Mixins and enums a set of node types reaches, so each note carries what it needs. */
function reached(model: ModelIR, nodes: NodeTypeIR[], edges: EdgeTypeIR[]): { mixins: MixinIR[]; enums: EnumIR[] } {
  const mixinNames = new Set(nodes.flatMap((n) => n.mixins))
  const enumNames = new Set([...nodes, ...edges].flatMap((t) => t.props.map((p) => p.enum).filter((x): x is string => !!x)))
  for (const m of model.mixins) {
    if (!mixinNames.has(m.name)) continue
    for (const p of m.props) if (p.enum) enumNames.add(p.enum)
  }
  return {
    mixins: model.mixins.filter((m) => mixinNames.has(m.name)),
    enums: model.enums.filter((e) => enumNames.has(e.name)),
  }
}

/**
 * Write a model as TGS schema notes in one of the two layouts. Pure: the caller reads the
 * folder and writes the notes, so the same function serves the CLI and the editor.
 * See lat.md/emitters#TGS Target.
 */
export function exportTgs(model: ModelIR, options: TgsExportOptions): TgsExportResult {
  const ctx: Context = {
    model, diagnostics: [],
    enums: new Map(model.enums.map((e) => [e.name, e])),
    outgoing: new Map(),
  }
  for (const n of model.nodes) {
    const lineage = new Set([n.name, ...n.ancestors])
    ctx.outgoing.set(n.name, model.edges.filter((e) => lineage.has(e.from)))
  }
  reportDowngrades(ctx)

  const header = [`tgs: ${JSON.stringify(TGS_WRITTEN_VERSION)}`, ...prefixesBlock(model)]
  const planned: Array<Omit<TgsNote, 'merged' | 'content'> & { owned: string[]; body: string }> = []

  if (options.layout === 'single') {
    const stem = options.stem ?? model.namespace.prefix
    const owned = [...header]
    if (model.nodes.length > 0) {
      owned.push('schemas:')
      for (const n of model.nodes) owned.push(`  ${yamlString(n.name)}:`, ...typeBlock(ctx, n, '    '))
    }
    if (model.edges.length > 0) {
      owned.push('edgeTypes:')
      for (const e of model.edges) owned.push(`  ${yamlString(e.name)}:`, ...edgeTypeBlock(ctx, e, '    '))
    }
    owned.push(...lpgBlock(ctx, model.nodes, model.edges, model.mixins, model.enums))
    const from = options.source ? ` from \`${options.source}\`` : ''
    const body = [
      `# ${model.namespace.prefix}`,
      '',
      `The node types and edge types of the \`${model.namespace.prefix}\` model (${model.namespace.iri}), written by lpg-modeler${from}.`,
      '',
      'The `lpg` key keeps what TGS cannot say -- abstract types, inheritance, keys, uniqueness and exact types -- so `lpg import` reads this note back into the same model. TGS readers ignore it.',
      '',
    ].join('\n')
    planned.push({ file: `${stem}.md`, types: model.nodes.map((n) => n.name), edgeTypes: model.edges.map((e) => e.name), owned, body })
  } else {
    const byName = new Set(model.nodes.map((n) => n.name))
    const edgesOf = new Map<string, EdgeTypeIR[]>()
    for (const e of model.edges) {
      const home = byName.has(e.from) ? e.from : model.nodes[0]?.name
      if (!home) continue
      edgesOf.set(home, [...(edgesOf.get(home) ?? []), e])
    }
    const everything = reached(model, model.nodes, model.edges)
    model.nodes.forEach((n, i) => {
      const edges = edgesOf.get(n.name) ?? []
      const { mixins, enums } = reached(model, [n], edges)
      // Whatever no type reaches still has to live somewhere, so the first note takes it.
      const ms = i === 0 ? [...mixins, ...model.mixins.filter((m) => !everything.mixins.includes(m))] : mixins
      const es = i === 0 ? [...enums, ...model.enums.filter((en) => !everything.enums.includes(en))] : enums
      const owned = [...header, 'schema:', ...typeBlock(ctx, n, '  ')]
      if (edges.length > 0) {
        owned.push('edgeTypes:')
        for (const e of edges) owned.push(`  ${yamlString(e.name)}:`, ...edgeTypeBlock(ctx, e, '    '))
      }
      owned.push(...lpgBlock(ctx, [n], edges, ms, es))
      // The body of a `schema` note is the type's template (TGS §8), so none is written:
      // the reader then generates one from the declaration.
      planned.push({ file: `${n.name}.md`, types: [n.name], edgeTypes: edges.map((e) => e.name), owned, body: '' })
    })
  }

  const notes: TgsNote[] = []
  const existing = options.existing ?? {}
  for (const p of planned) {
    const old = existing[p.file]
    if (old !== undefined && !options.force) {
      const before = declaredBy(p.file, old)
      const lostTypes = before.types.filter((t) => !p.types.includes(t))
      const lostEdges = before.edgeTypes.filter((t) => !p.edgeTypes.includes(t))
      if (lostTypes.length > 0 || lostEdges.length > 0) {
        ctx.diagnostics.push(err('export-tgs-would-drop',
          `'${p.file}' already declares ${[...lostTypes, ...lostEdges].join(', ')}, which this export does not contain. It was not rewritten; pass --force to replace its schema keys anyway.`))
        continue
      }
    }
    notes.push({
      file: p.file, types: p.types, edgeTypes: p.edgeTypes,
      content: mergeNote(old, p.owned, p.body).replace(/\n*$/, '\n'),
      merged: old !== undefined,
    })
  }

  // A note an earlier export wrote and this one does not is left alone, but it still
  // declares its types, and importing the folder would bring them back.
  const written = new Set(planned.map((p) => p.file))
  for (const [file, text] of Object.entries(existing).sort(([a], [b]) => a.localeCompare(b))) {
    if (written.has(file)) continue
    const { frontmatter } = splitNote(text)
    if (frontmatter === undefined || !frontmatterBlocks(frontmatter).some((b) => b.key === 'lpg')) continue
    const { types } = declaredBy(file, text)
    if (types.length === 0) continue
    ctx.diagnostics.push(warn('export-tgs-stale-note',
      `'${file}' was written by an earlier export and still declares ${types.join(', ')}, which the model no longer has. It was not deleted; importing the folder would bring ${types.length === 1 ? 'it' : 'them'} back.`))
  }

  if (notes.length > 0) {
    ctx.diagnostics.push(info('export-tgs-layout',
      options.layout === 'single'
        ? `Wrote the joint ontology as one note, ${notes[0]!.file}.`
        : `Wrote ${notes.length} note(s), one per node type, each edge type in its source type's note.`,
    ))
  }
  return { notes, diagnostics: ctx.diagnostics }
}

/** The target as the registry sees it: the single layout, one note. */
export function emitTgs(model: ModelIR, _options: EmitOptions = {}): EmitResult {
  const { notes, diagnostics } = exportTgs(model, { layout: 'single' })
  return {
    target: 'tgs', extension: 'md', content: notes[0]?.content ?? '',
    diagnostics: diagnostics.filter((d) => d.code !== 'export-tgs-layout'),
  }
}
