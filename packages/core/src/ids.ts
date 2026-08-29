import { parseDocument, isMap, isScalar, type YAMLMap } from 'yaml'
import type { TextEdit } from './mutate'
import type { Diagnostic } from './ir'
import { err } from './ir'
import type { RawModel } from './parse'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export type ElementKind = 'node' | 'edge' | 'prop' | 'mixin'

const PREFIX: Record<ElementKind, string> = {
  node: 'n', edge: 'e', prop: 'p', mixin: 'm',
}

/** Random source, injectable so tests can generate deterministic ids. */
export type RandomFn = () => number

export function generateId(kind: ElementKind, rand: RandomFn = Math.random): string {
  let s = ''
  for (let i = 0; i < 5; i++) {
    s += ALPHABET[Math.floor(rand() * ALPHABET.length)] ?? '0'
  }
  return `${PREFIX[kind]}_${s}`
}

/** Every id already present in a model, used to avoid collisions when generating. */
export function collectIds(raw: RawModel): string[] {
  const ids: string[] = []
  const push = (id?: string) => { if (id) ids.push(id) }
  for (const m of raw.mixins) { push(m.id); m.props.forEach((p) => push(p.id)) }
  for (const n of raw.nodes) { push(n.id); n.props.forEach((p) => push(p.id)) }
  for (const e of raw.edges) { push(e.id); e.props.forEach((p) => push(p.id)) }
  return ids
}

/**
 * Report ids used by more than one element. Copy-and-paste in the model file is the
 * usual cause. See lat.md/metamodel#Stable Element IDs.
 */
export function duplicateIdDiagnostics(raw: RawModel): Diagnostic[] {
  const seen = new Map<string, string[]>()
  const note = (id: string | undefined, label: string) => {
    if (!id) return
    seen.set(id, [...(seen.get(id) ?? []), label])
  }
  for (const m of raw.mixins) { note(m.id, `mixin ${m.name}`); m.props.forEach((p) => note(p.id, `${m.name}.${p.name}`)) }
  for (const n of raw.nodes) { note(n.id, `node ${n.name}`); n.props.forEach((p) => note(p.id, `${n.name}.${p.name}`)) }
  for (const e of raw.edges) { note(e.id, `edge ${e.name}`); e.props.forEach((p) => note(p.id, `${e.name}.${p.name}`)) }

  const out: Diagnostic[] = []
  for (const [id, owners] of seen) {
    if (owners.length > 1) {
      out.push(err('duplicate-id',
        `Element id '${id}' is used by ${owners.length} elements: ${owners.join(', ')}. Ids must be unique within a model.`,
        locateOwner(raw, id)))
    }
  }
  return out
}

function locateOwner(raw: RawModel, id: string) {
  for (const n of raw.nodes) {
    if (n.id === id) return n.loc
    for (const p of n.props) if (p.id === id) return p.loc
  }
  for (const e of raw.edges) {
    if (e.id === id) return e.loc
    for (const p of e.props) if (p.id === id) return p.loc
  }
  return undefined
}

type Range3 = [number, number, number]
const rangeOf = (n: unknown): Range3 | undefined => (n as { range?: Range3 } | undefined)?.range

function startOfLine(text: string, offset: number): number {
  const i = text.lastIndexOf('\n', Math.max(0, offset - 1))
  return i === -1 ? 0 : i + 1
}

function indentAt(text: string, offset: number): string {
  const s = startOfLine(text, offset)
  const line = text.slice(s, text.indexOf('\n', s) === -1 ? text.length : text.indexOf('\n', s))
  return line.slice(0, line.length - line.trimStart().length)
}

/** Insert `id: <value>` into an element body, in whichever style that body already uses. */
function idEdit(text: string, body: YAMLMap, id: string): TextEdit | undefined {
  const existing = body.get('id', true)
  if (isScalar(existing) && typeof existing.value === 'string' && existing.value.length > 0) {
    return undefined
  }
  const bodyRange = rangeOf(body)
  const first = body.items[0]
  const firstKey = rangeOf(first?.key)

  if (body.flow) {
    // `{ type: string }` -> `{ id: p_x, type: string }`
    if (!bodyRange) return undefined
    const open = text.indexOf('{', bodyRange[0])
    if (open === -1) return undefined
    // Insert after any space the author already put inside the brace, so
    // `{ type: string }` stays `{ id: p_x, type: string }` and not `{id: p_x, ...`.
    const at = text[open + 1] === ' ' ? open + 2 : open + 1
    return { start: at, end: at, newText: `id: ${id}, ` }
  }
  if (!firstKey) return undefined
  const at = startOfLine(text, firstKey[0])
  return { start: at, end: at, newText: `${indentAt(text, firstKey[0])}id: ${id}\n` }
}

/**
 * Produce the edits that give every element an id, without touching anything else.
 * See lat.md/metamodel#Stable Element IDs.
 */
export function backfillIdEdits(text: string, rand: RandomFn = Math.random): TextEdit[] {
  const doc = parseDocument(text, { keepSourceTokens: true })
  const root = doc.contents
  if (!isMap(root)) return []

  const taken = new Set<string>()
  const collect = (m: YAMLMap) => {
    const v = m.get('id', true)
    if (isScalar(v) && typeof v.value === 'string') taken.add(v.value)
  }

  const edits: TextEdit[] = []
  const sections: Array<[string, ElementKind]> = [
    ['mixins', 'mixin'], ['nodes', 'node'], ['edges', 'edge'],
  ]
  // First pass: learn which ids are already in use, so generated ones cannot collide.
  for (const [name] of sections) {
    const sec = root.get(name, true)
    if (!isMap(sec)) continue
    for (const item of sec.items) {
      if (!isMap(item.value)) continue
      collect(item.value)
      const props = item.value.get('props', true)
      if (isMap(props)) for (const p of props.items) if (isMap(p.value)) collect(p.value)
    }
  }

  const fresh = (kind: ElementKind) => {
    let id = generateId(kind, rand)
    while (taken.has(id)) id = generateId(kind, rand)
    taken.add(id)
    return id
  }

  for (const [name, kind] of sections) {
    const sec = root.get(name, true)
    if (!isMap(sec)) continue
    for (const item of sec.items) {
      if (!isMap(item.value)) continue
      const e = idEdit(text, item.value, fresh(kind))
      if (e) edits.push(e)
      const props = item.value.get('props', true)
      if (!isMap(props)) continue
      for (const p of props.items) {
        if (!isMap(p.value)) continue
        const pe = idEdit(text, p.value, fresh('prop'))
        if (pe) edits.push(pe)
      }
    }
  }
  return edits
}
