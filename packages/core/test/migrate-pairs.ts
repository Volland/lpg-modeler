import { readFileSync } from 'node:fs'
import { resolveModel } from '../src/resolve'
import type { ModelIR } from '../src/ir'
import { fixture } from './helpers'

/** The revision every pair starts from. */
export const BASE = readFileSync(fixture('migrate/base.lpg.yaml'), 'utf8')

/** Where a resolved text claims to live; nothing is read from disk at this path. */
const VIRTUAL = '/virtual/shop.lpg.yaml'

/** Resolve model text that exists only in memory, failing loudly on any error. */
export function resolveText(text: string): ModelIR {
  const { model, diagnostics } = resolveModel(VIRTUAL, (p) => (p === VIRTUAL ? text : undefined))
  const errors = diagnostics.filter((d) => d.severity === 'error')
  if (errors.length > 0) throw new Error(errors.map((e) => `${e.code}: ${e.message}`).join('\n'))
  return model
}

/** A replacement that must find what it replaces, so an edited base cannot silently empty a pair. */
function swap(text: string, from: string | RegExp, to: string): string {
  const found = typeof from === 'string' ? text.includes(from) : from.test(text)
  if (!found) throw new Error(`migration pair edit found nothing to replace: ${String(from)}`)
  return typeof from === 'string' ? text.split(from).join(to) : text.replace(from, to)
}

const block = (text: string, start: string, end: string) => {
  const i = text.indexOf(start)
  const j = text.indexOf(end, i + start.length)
  if (i === -1 || j === -1) throw new Error(`migration pair edit found no block from ${start}`)
  return text.slice(0, i) + text.slice(j)
}

export interface Pair {
  name: string
  edit: (base: string) => string
}

/** Each pair is the base model plus one edit, named for what it changes. */
export const PAIRS: Pair[] = [
  { name: 'add-optional-property', edit: (t) => swap(t,
    '      id: { id: p_pid, type: string, required: true }\n',
    '      id: { id: p_pid, type: string, required: true }\n      phone: { id: p_phone, type: string }\n') },
  { name: 'add-required-property', edit: (t) => swap(t,
    '      seats: { id: p_seat, type: int }\n',
    '      seats: { id: p_seat, type: int }\n      rating: { id: p_rate, type: int, required: true }\n') },
  { name: 'add-node-type', edit: (t) => swap(t, '\nedges:\n', [
    '  Bike:', '    id: n_bike', '    extends: Asset', '    key: [serial]', '    props:',
    '      serial: { id: p_serial, type: string, required: true }', '', 'edges:', ''].join('\n').replace(/^/, '\n')) },
  { name: 'add-subtype', edit: (t) => swap(t, '  Asset:\n',
    '  Trust:\n    id: n_trust\n    extends: Party\n\n  Asset:\n') },
  { name: 'rename-node-type', edit: (t) => swap(t, /\bPerson\b/g, 'Individual') },
  { name: 'rename-property', edit: (t) => swap(t, '      email: {', '      mail: {') },
  { name: 'rename-edge', edit: (t) => swap(t, '  KNOWS:', '  ACQUAINTED:') },
  { name: 'remove-node-type', edit: (t) => block(block(t, '  Car:\n', '\nedges:'), '  OWNS:\n', '  KNOWS:') },
  { name: 'remove-property', edit: (t) => swap(t, '      nickname: { id: p_nick, type: string }\n', '') },
  { name: 'change-key', edit: (t) => swap(t, '    key: [vin]', '    key: [vin, seats]') },
  { name: 'retype-property', edit: (t) => swap(t, 'seats: { id: p_seat, type: int }', 'seats: { id: p_seat, type: string }') },
  { name: 'change-cardinality', edit: (t) => swap(t, 'cardinality: one-to-many', 'cardinality: many-to-many') },
  { name: 'change-endpoints', edit: (t) => swap(t, '    from: Person\n    to: Person\n', '    from: Person\n    to: Company\n') },
  { name: 'make-required', edit: (t) => swap(t,
    'nickname: { id: p_nick, type: string }', 'nickname: { id: p_nick, type: string, required: true }') },
  { name: 'drop-uniqueness', edit: (t) => swap(t,
    'email: { id: p_mail, type: string, unique: true }', 'email: { id: p_mail, type: string }') },
  { name: 'add-unique', edit: (t) => swap(t,
    'nickname: { id: p_nick, type: string }', 'nickname: { id: p_nick, type: string, unique: true }') },
  { name: 'value-pattern', edit: (t) => swap(t,
    'vat: { id: p_vat, type: string }', 'vat: { id: p_vat, type: string, pattern: "^[A-Z]{2}" }') },
  { name: 'move-to-ancestor', edit: (t) => swap(swap(t,
    '      seats: { id: p_seat, type: int }\n', ''),
    '    id: n_asset\n    abstract: true\n',
    '    id: n_asset\n    abstract: true\n    props:\n      seats: { id: p_seat, type: int }\n') },
  { name: 'replace-id', edit: (t) => swap(t, 'p_nick', 'p_nick2') },
  { name: 'mixin-on-parent', edit: (t) => swap(swap(t,
    '    mixins: [Timestamped]\n', ''),
    '    abstract: true\n    key: [id]\n', '    abstract: true\n    key: [id]\n    mixins: [Timestamped]\n') },
  { name: 'remove-enum-value', edit: (t) => swap(t, 'values: [active, retired]', 'values: [active]') },
]

export const pair = (name: string): Pair => {
  const p = PAIRS.find((x) => x.name === name)
  if (!p) throw new Error(`no migration pair named ${name}`)
  return p
}

/** The two revisions of a pair, resolved. */
export function pairModels(name: string): { before: ModelIR; after: ModelIR; afterText: string } {
  const afterText = pair(name).edit(BASE)
  return { before: resolveText(BASE), after: resolveText(afterText), afterText }
}
