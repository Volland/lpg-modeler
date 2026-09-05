import {
  parseDocument, isMap, isScalar, isSeq,
  type Document, type Pair, type Scalar, type YAMLMap, type YAMLSeq,
} from 'yaml'
import type { ScalarType } from './ir'

/**
 * Canvas edits are applied as targeted text splices, never by re-serializing the
 * document: `Document.toString()` normalizes flow-collection padding across the whole
 * file, which would turn a one-property change into a whole-file diff.
 * See lat.md/architecture#Editing Surface.
 */
export interface TextEdit {
  start: number
  end: number
  newText: string
}

/** Apply edits to text. Edits must not overlap; they are applied right to left. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start)
  let out = text
  for (const e of ordered) out = out.slice(0, e.start) + e.newText + out.slice(e.end)
  return out
}

type Range3 = [number, number, number]
const rangeOf = (n: unknown): Range3 | undefined =>
  (n as { range?: Range3 } | undefined)?.range

function endOfLine(text: string, offset: number): number {
  const i = text.indexOf('\n', offset)
  return i === -1 ? text.length : i
}

function startOfLine(text: string, offset: number): number {
  const i = text.lastIndexOf('\n', Math.max(0, offset - 1))
  return i === -1 ? 0 : i + 1
}

function indentAt(text: string, offset: number): string {
  const s = startOfLine(text, offset)
  const line = text.slice(s, endOfLine(text, offset))
  return line.slice(0, line.length - line.trimStart().length)
}

/**
 * Offset just past the last line belonging to a block map. A YAML node's own range can
 * run past its block into following content, so the block is found by indentation:
 * scan forward from the first item until a non-blank line is less indented.
 */
function endOfMapBlock(text: string, map: YAMLMap): number | undefined {
  const firstKey = rangeOf(map.items[0]?.key)
  if (!firstKey) return undefined
  const itemIndent = indentAt(text, firstKey[0]).length

  let cursor = startOfLine(text, firstKey[0])
  let lastContent = endOfLine(text, cursor)
  while (cursor < text.length) {
    const eol = endOfLine(text, cursor)
    const line = text.slice(cursor, eol)
    if (line.trim().length > 0) {
      const indent = line.length - line.trimStart().length
      if (indent < itemIndent && cursor > startOfLine(text, firstKey[0])) break
      lastContent = eol
    }
    if (eol >= text.length) break
    cursor = eol + 1
  }
  return lastContent
}

function mapItem(map: YAMLMap, name: string): Pair | undefined {
  return map.items.find(
    (i) => isScalar(i.key) && i.key.value === name,
  ) as Pair | undefined
}

function section(doc: Document, name: string): YAMLMap | undefined {
  const root = doc.contents
  if (!isMap(root)) return undefined
  const v = root.get(name, true)
  return isMap(v) ? v : undefined
}

/**
 * Insert a block entry as the last item of a block map, matching the indentation its
 * siblings already use.
 */
function insertIntoMap(text: string, map: YAMLMap, entryLines: string[]): TextEdit | undefined {
  const last = map.items[map.items.length - 1]
  const first = map.items[0]
  if (!last || !first) return undefined
  const keyRange = rangeOf(first.key)
  if (!keyRange) return undefined
  const indent = indentAt(text, keyRange[0])
  void last

  const at = endOfMapBlock(text, map)
  if (at === undefined) return undefined
  const body = entryLines.map((l) => `\n${indent}${l}`).join('')
  return { start: at, end: at, newText: body }
}

/** Delete a whole map entry, including the line it starts on. */
function deleteItem(text: string, item: Pair): TextEdit | undefined {
  const keyRange = rangeOf(item.key)
  const valEnd = rangeOf(item.value)?.[1] ?? keyRange?.[1]
  if (!keyRange || valEnd === undefined) return undefined
  const start = startOfLine(text, keyRange[0])
  let end = endOfLine(text, valEnd)
  if (text[end] === '\n') end += 1
  return { start, end, newText: '' }
}

export interface PropertySpec {
  name: string
  type: ScalarType
  required?: boolean
  unique?: boolean
  id?: string
}

function propEntry(p: PropertySpec): string {
  const bits = [`type: ${p.type}`]
  if (p.required) bits.push('required: true')
  if (p.unique) bits.push('unique: true')
  const idPart = p.id ? `id: ${p.id}, ` : ''
  return `${p.name}: { ${idPart}${bits.join(', ')} }`
}

/**
 * What a mutation addresses. A mixin body has the same shape as a type body — an id and
 * a props map — so every property operation works on one unchanged.
 * See lat.md/metamodel#Type Hierarchy#Mixins.
 */
export type OwnerKind = 'nodes' | 'edges' | 'mixins'

interface Ctx { text: string; doc: Document }

function ctx(text: string): Ctx {
  return { text, doc: parseDocument(text, { keepSourceTokens: true }) }
}

/** Locate a node type, edge type, or mixin body map. */
function typeBody(c: Ctx, kind: OwnerKind, name: string): YAMLMap | undefined {
  const sec = section(c.doc, kind)
  if (!sec) return undefined
  const item = mapItem(sec, name)
  return item && isMap(item.value) ? item.value : undefined
}

// --- Mutations ---------------------------------------------------------------

export function renameType(
  text: string, kind: OwnerKind, from: string, to: string,
): TextEdit[] {
  const c = ctx(text)
  const sec = section(c.doc, kind)
  const item = sec && mapItem(sec, from)
  const r = item && rangeOf(item.key)
  if (!r) return []
  const edits: TextEdit[] = [{ start: r[0], end: r[1], newText: to }]

  // Applications of a renamed mixin must move with it.
  if (kind === 'mixins') {
    for (const { seq } of mixinLists(c)) {
      for (const item of seq.items) {
        const ir = rangeOf(item)
        if (isScalar(item) && item.value === from && ir) {
          edits.push({ start: ir[0], end: ir[1], newText: to })
        }
      }
    }
  }

  // References to a renamed node type must move with it.
  if (kind === 'nodes') {
    const edges = section(c.doc, 'edges')
    for (const e of edges?.items ?? []) {
      if (!isMap(e.value)) continue
      for (const field of ['from', 'to', 'extends'] as const) {
        const v = e.value.get(field, true)
        const vr = rangeOf(v)
        if (isScalar(v) && v.value === from && vr) {
          edits.push({ start: vr[0], end: vr[1], newText: to })
        }
      }
    }
    const nodes = section(c.doc, 'nodes')
    for (const n of nodes?.items ?? []) {
      if (!isMap(n.value)) continue
      const ext = n.value.get('extends', true)
      const er = rangeOf(ext)
      if (isScalar(ext) && ext.value === from && er) {
        edits.push({ start: er[0], end: er[1], newText: to })
      }
    }
  }
  return edits
}

export function addNodeType(
  text: string, name: string, opts: { key?: string[]; abstract?: boolean; extends?: string; id?: string } = {},
): TextEdit[] {
  const c = ctx(text)
  const lines = [`${name}:`]
  if (opts.id) lines.push(`  id: ${opts.id}`)
  if (opts.abstract) lines.push('  abstract: true')
  if (opts.extends) lines.push(`  extends: ${opts.extends}`)
  if (opts.key && opts.key.length > 0) lines.push(`  key: [${opts.key.join(', ')}]`)
  // A bare `Name:` is a null value, not a mapping, and would not parse as a node type.
  if (lines.length === 1) lines.push('  props: {}')

  const sec = section(c.doc, 'nodes')
  if (sec) {
    const e = insertIntoMap(text, sec, lines)
    return e ? [e] : []
  }
  const suffix = text.endsWith('\n') ? '' : '\n'
  const body = `${suffix}\nnodes:\n${lines.map((l) => `  ${l}`).join('\n')}\n`
  return [{ start: text.length, end: text.length, newText: body }]
}

/**
 * Delete a type. Removing a node type also removes every edge type that references it:
 * leaving the reference behind would produce a model that cannot resolve, and a canvas
 * delete is expected to take the connected edges with it. Callers that need to warn
 * first can inspect `edgesReferencing` before applying.
 */
export function deleteType(text: string, kind: OwnerKind, name: string): TextEdit[] {
  const c = ctx(text)
  const sec = section(c.doc, kind)
  const item = sec && mapItem(sec, name)
  if (!item) return []
  const edits: TextEdit[] = []
  const own = deleteItem(text, item)
  if (own) edits.push(own)

  if (kind === 'mixins') {
    // A type left applying a mixin the model no longer has would not resolve.
    for (const { pair, seq } of mixinLists(c)) {
      if (!seq.items.some((i) => isScalar(i) && i.value === name)) continue
      const remaining = seq.items
        .filter((i) => isScalar(i) && i.value !== name)
        .map((i) => String((i as Scalar).value))
      const e = remaining.length === 0
        ? deleteItem(text, pair)
        : replaceSeq(text, seq, remaining)
      if (e) edits.push(e)
    }
  }

  if (kind === 'nodes') {
    const edges = section(c.doc, 'edges')
    for (const e of edges?.items ?? []) {
      const body = e.value
      if (!isMap(body)) continue
      const touches = (['from', 'to'] as const).some((f) => {
        const v = body.get(f, true)
        return isScalar(v) && v.value === name
      })
      if (!touches) continue
      const del = deleteItem(text, e as Pair)
      if (del) edits.push(del)
    }
  }
  return edits
}

/** Edge type names whose endpoints reference a node type. */
export function edgesReferencing(text: string, nodeName: string): string[] {
  const c = ctx(text)
  const edges = section(c.doc, 'edges')
  const out: string[] = []
  for (const e of edges?.items ?? []) {
    const body = e.value
    if (!isMap(body) || !isScalar(e.key)) continue
    const touches = (['from', 'to'] as const).some((f) => {
      const v = body.get(f, true)
      return isScalar(v) && v.value === nodeName
    })
    if (touches) out.push(String(e.key.value))
  }
  return out
}

export function addProperty(
  text: string, kind: OwnerKind, typeName: string, prop: PropertySpec,
): TextEdit[] {
  const c = ctx(text)
  const body = typeBody(c, kind, typeName)
  if (!body) return []
  const props = body.get('props', true)
  if (isMap(props) && props.items.length > 0) {
    const e = insertIntoMap(text, props, [propEntry(prop)])
    return e ? [e] : []
  }
  if (isMap(props)) {
    // An empty `props: {}` placeholder: replace it rather than adding a second key.
    const pr = rangeOf(props)
    const firstKey = rangeOf(body.items[0]?.key)
    if (!pr || !firstKey) return []
    const indent = indentAt(text, firstKey[0])
    // Swallow the space after `props:` so no trailing whitespace is left behind.
    let start = pr[0]
    while (start > 0 && text[start - 1] === ' ') start--
    return [{ start, end: pr[1], newText: `\n${indent}  ${propEntry(prop)}` }]
  }
  // No props block yet: create one at the end of the type body.
  const firstKey = rangeOf(body.items[0]?.key)
  const at = endOfMapBlock(text, body)
  if (at === undefined || !firstKey) return []
  const indent = indentAt(text, firstKey[0])
  return [{ start: at, end: at, newText: `\n${indent}props:\n${indent}  ${propEntry(prop)}` }]
}

export function deleteProperty(
  text: string, kind: OwnerKind, typeName: string, propName: string,
): TextEdit[] {
  const c = ctx(text)
  const body = typeBody(c, kind, typeName)
  const props = body?.get('props', true)
  if (!isMap(props)) return []
  const item = mapItem(props, propName)
  if (!item) return []
  const e = deleteItem(text, item)
  return e ? [e] : []
}

export function renameProperty(
  text: string, kind: OwnerKind, typeName: string, from: string, to: string,
): TextEdit[] {
  const c = ctx(text)
  const body = typeBody(c, kind, typeName)
  const props = body?.get('props', true)
  if (!isMap(props)) return []
  const item = mapItem(props, from)
  const r = item && rangeOf(item.key)
  if (!r) return []
  const edits: TextEdit[] = [{ start: r[0], end: r[1], newText: to }]
  // A key naming this property must follow the rename.
  const key = body?.get('key', true)
  if (key && !isScalar(key)) {
    for (const k of (key as { items?: unknown[] }).items ?? []) {
      const kr = rangeOf(k)
      if (isScalar(k) && k.value === from && kr) edits.push({ start: kr[0], end: kr[1], newText: to })
    }
  }
  return edits
}

/**
 * Remove one entry from a flow mapping, taking the separator with it. A flow map holds
 * several entries on one line, so the line-based deletion would take the lot.
 */
function deleteFlowItem(text: string, map: YAMLMap, field: string): TextEdit | undefined {
  const index = map.items.findIndex(
    (i) => isScalar(i.key) && i.key.value === field)
  if (index === -1) return undefined
  const item = map.items[index]!
  const keyRange = rangeOf(item.key)
  const valueRange = rangeOf(item.value)
  if (!keyRange || !valueRange) return undefined

  let start = keyRange[0]
  let end = valueRange[1]
  const previous = index > 0 ? rangeOf(map.items[index - 1]?.value) : undefined
  if (previous) {
    // Swallow the comma that joined this entry to the one before it.
    start = previous[1]
  } else {
    while (end < text.length && /[\s,]/.test(text[end] ?? '')) end++
  }
  return { start, end, newText: '' }
}

/**
 * Set, replace, or remove one facet inside a property's own mapping — a bound, a
 * pattern, a length. Written in whichever style the property body already uses.
 */
export function setPropertyFacet(
  text: string, kind: OwnerKind, typeName: string, propName: string,
  facet: string, rendered: string | undefined,
): TextEdit[] {
  const c = ctx(text)
  const body = typeBody(c, kind, typeName)
  const props = body?.get('props', true)
  if (!isMap(props)) return []
  const item = mapItem(props, propName)
  if (!item || !isMap(item.value)) return []
  const pbody = item.value as YAMLMap

  const existing = mapItem(pbody, facet)
  if (existing) {
    if (rendered === undefined) {
      // deleteItem takes whole lines, which would swallow a whole flow-style property.
      const e = pbody.flow ? deleteFlowItem(text, pbody, facet) : deleteItem(text, existing)
      return e ? [e] : []
    }
    const vr = rangeOf(existing.value)
    return vr ? [{ start: vr[0], end: vr[1], newText: rendered }] : []
  }
  if (rendered === undefined) return []

  const pr = rangeOf(pbody)
  if (!pr) return []
  if (pbody.flow) {
    // `{ type: int }` -> `{ type: int, min: 0 }`, inserted before the closing brace.
    let close = text.lastIndexOf('}', pr[1])
    if (close === -1) return []
    let at = close
    while (at > pr[0] && text[at - 1] === ' ') at--
    return [{ start: at, end: at, newText: `, ${facet}: ${rendered}` }]
  }
  const firstKey = rangeOf(pbody.items[0]?.key)
  const at = endOfMapBlock(text, pbody)
  if (at === undefined || !firstKey) return []
  return [{ start: at, end: at, newText: `\n${indentAt(text, firstKey[0])}${facet}: ${rendered}` }]
}

/** Append a named constraint, creating the block when the type has none yet. */
export function addConstraint(
  text: string, typeName: string, name: string, assertion: string,
  message?: string, id?: string,
): TextEdit[] {
  const c = ctx(text)
  const body = typeBody(c, 'nodes', typeName)
  if (!body) return []
  const firstKey = rangeOf(body.items[0]?.key)
  if (!firstKey) return []
  const indent = indentAt(text, firstKey[0])

  const entry = [
    `${indent}  - ${id ? `id: ${id}\n${indent}    name: ${name}` : `name: ${name}`}`,
    `${indent}    assert: ${assertion}`,
    ...(message ? [`${indent}    message: ${JSON.stringify(message)}`] : []),
  ].join('\n')

  const existing = body.get('constraints', true)
  if (isSeq(existing)) {
    const r = rangeOf(existing)
    if (!r) return []
    // End of the sequence, before whatever follows it.
    let end = r[1]
    while (end > r[0] && /\s/.test(text[end - 1] ?? '')) end--
    return [{ start: end, end, newText: `\n${entry}` }]
  }
  const at = endOfMapBlock(text, body)
  if (at === undefined) return []
  return [{ start: at, end: at, newText: `\n${indent}constraints:\n${entry}` }]
}

export function deleteConstraint(text: string, typeName: string, name: string): TextEdit[] {
  const c = ctx(text)
  const body = typeBody(c, 'nodes', typeName)
  const raw = body?.get('constraints', true)
  if (!isSeq(raw)) return []
  const seq = raw as YAMLSeq
  const index = seq.items.findIndex(
    (i: unknown) => isMap(i) && (i as YAMLMap).get('name') === name)
  if (index === -1) return []
  const r = rangeOf(seq.items[index])
  if (!r) return []
  // Take the whole entry including the leading dash and its indentation.
  let start = startOfLine(text, r[0])
  let end = endOfLine(text, r[1] - 1) + 1
  // A sole remaining entry leaves an empty `constraints:` key, so remove that too.
  if (seq.items.length === 1) {
    const item = mapItem(body as YAMLMap, 'constraints')
    if (item) {
      const e = deleteItem(text, item)
      if (e) return [e]
    }
  }
  return [{ start, end }].map((x) => ({ ...x, newText: '' }))
}

/** Replace, add, or remove a scalar/sequence field on a type body. */
function setField(
  text: string, kind: OwnerKind, typeName: string, field: string, rendered: string | undefined,
): TextEdit[] {
  const c = ctx(text)
  const body = typeBody(c, kind, typeName)
  if (!body) return []
  const item = mapItem(body, field)
  if (item) {
    if (rendered === undefined) {
      const e = deleteItem(text, item)
      return e ? [e] : []
    }
    const vr = rangeOf(item.value)
    const kr = rangeOf(item.key)
    if (vr) return [{ start: vr[0], end: vr[1], newText: rendered }]
    if (kr) return [{ start: kr[1], end: kr[1], newText: `: ${rendered}` }]
    return []
  }
  if (rendered === undefined) return []
  const firstKey = rangeOf(body.items[0]?.key)
  const at = endOfMapBlock(text, body)
  if (at === undefined || !firstKey) return []
  const indent = indentAt(text, firstKey[0])
  return [{ start: at, end: at, newText: `\n${indent}${field}: ${rendered}` }]
}

export function setKey(text: string, typeName: string, key: string[]): TextEdit[] {
  return setField(text, 'nodes', typeName, 'key', key.length > 0 ? `[${key.join(', ')}]` : undefined)
}

export function setAbstractParent(text: string, typeName: string, parent: string | undefined): TextEdit[] {
  return setField(text, 'nodes', typeName, 'extends', parent)
}

export function setAbstract(text: string, typeName: string, abstract: boolean): TextEdit[] {
  return setField(text, 'nodes', typeName, 'abstract', abstract ? 'true' : undefined)
}

/**
 * Set endpoint multiplicity. Both ends unbounded is the default, so it is written by
 * removing the field rather than by spelling it out.
 */
export function setCardinality(
  text: string, edgeName: string, from: string, to: string,
): TextEdit[] {
  const rendered = from === '*' && to === '*' ? undefined : `{ from: "${from}", to: "${to}" }`
  return setField(text, 'edges', edgeName, 'cardinality', rendered)
}

export function setEndpoint(
  text: string, edgeName: string, which: 'from' | 'to', target: string,
): TextEdit[] {
  return setField(text, 'edges', edgeName, which, target)
}

export function addEdgeType(
  text: string, name: string, from: string, to: string, id?: string,
): TextEdit[] {
  const c = ctx(text)
  const lines = [`${name}:`]
  if (id) lines.push(`  id: ${id}`)
  lines.push(`  from: ${from}`, `  to: ${to}`)

  const sec = section(c.doc, 'edges')
  if (sec) {
    const e = insertIntoMap(text, sec, lines)
    return e ? [e] : []
  }
  const suffix = text.endsWith('\n') ? '' : '\n'
  const body = `${suffix}\nedges:\n${lines.map((l) => `  ${l}`).join('\n')}\n`
  return [{ start: text.length, end: text.length, newText: body }]
}

/** Record the pre-rename IRI so ontology consumers keep resolving. */
/** Every node type's `mixins:` list, paired with the entry that holds it. */
function mixinLists(c: Ctx): { pair: Pair; seq: YAMLSeq }[] {
  const out: { pair: Pair; seq: YAMLSeq }[] = []
  const nodes = section(c.doc, 'nodes')
  for (const n of nodes?.items ?? []) {
    if (!isMap(n.value)) continue
    const pair = mapItem(n.value as YAMLMap, 'mixins')
    if (pair && isSeq(pair.value)) out.push({ pair, seq: pair.value as YAMLSeq })
  }
  return out
}

/** Rewrite a whole sequence as a flow list, which is how a model file spells one. */
function replaceSeq(text: string, seq: YAMLSeq, names: string[]): TextEdit | undefined {
  const r = rangeOf(seq)
  if (!r) return undefined
  // A block sequence's range runs to the start of whatever follows it.
  let end = r[1]
  while (end > r[0] && /\s/.test(text[end - 1] ?? '')) end--
  return { start: r[0], end, newText: `[${names.join(', ')}]` }
}

/**
 * Declare a mixin. It lands before `nodes:` when there is one, because a bag of
 * properties reads as a preamble to the types that apply it.
 * See lat.md/metamodel#Type Hierarchy#Mixins.
 */
export function addMixin(text: string, name: string, id?: string): TextEdit[] {
  const c = ctx(text)
  const lines = [`${name}:`, ...(id ? [`  id: ${id}`] : []), '  props: {}']

  const sec = section(c.doc, 'mixins')
  if (sec) {
    const e = insertIntoMap(text, sec, lines)
    return e ? [e] : []
  }
  const body = `mixins:\n${lines.map((l) => `  ${l}`).join('\n')}\n\n`

  const root = c.doc.contents
  const nodesKey = isMap(root)
    ? (root.items.find((i) => isScalar(i.key) && i.key.value === 'nodes') as Pair | undefined)
    : undefined
  const at = nodesKey && rangeOf(nodesKey.key)
  if (at) {
    const start = startOfLine(text, at[0])
    return [{ start, end: start, newText: body }]
  }
  const suffix = text.endsWith('\n') ? '' : '\n'
  return [{ start: text.length, end: text.length, newText: `${suffix}\n${body}` }]
}

/**
 * Set which mixins a node type applies. Written as a whole list rather than as an
 * add and a remove, so the canvas can send what the checkboxes say.
 */
export function setMixins(text: string, typeName: string, names: string[]): TextEdit[] {
  return setField(text, 'nodes', typeName, 'mixins',
    names.length > 0 ? `[${names.join(', ')}]` : undefined)
}

export function setPreviousIri(
  text: string, kind: OwnerKind, typeName: string, iri: string,
): TextEdit[] {
  return setField(text, kind, typeName, 'previousIri', iri)
}
