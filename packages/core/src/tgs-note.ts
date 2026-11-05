import type { ScalarType } from './ir'

/**
 * What the TGS reader and the TGS target share: how a schema note is cut into its
 * frontmatter and its body, which frontmatter keys belong to TGS, and how the two
 * vocabularies of value types line up. See lat.md/importers#Reading TGS Notes and
 * lat.md/emitters#TGS Target.
 */

/** The TGS version the target writes. It uses no key added after 0.1, so it claims 0.1. */
export const TGS_WRITTEN_VERSION = '0.1'

/** The TGS major version this build reads (TGS §12). */
export const TGS_MAJOR = 0

/**
 * The frontmatter keys an export owns. Everything else in an existing note belongs to
 * the note and is kept; TGS §13.5 lets an importer replace only these.
 */
export const OWNED_KEYS = ['tgs', 'schema', 'schemas', 'edgeTypes', 'prefixes', 'lpg'] as const

/** The keys that make a note a TGS schema note rather than an ordinary one. */
export const SCHEMA_KEYS = ['schema', 'schemas', 'edgeTypes', 'prefixes'] as const

export type TgsKind = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'link' | 'list'

export const TGS_KINDS: readonly TgsKind[] =
  ['text', 'number', 'boolean', 'date', 'datetime', 'link', 'list']

/**
 * The kind each scalar is written as. Several scalars share a kind -- every integer width
 * is a `number` -- which is why the exact type also travels in the `lpg` key.
 */
export const KIND_OF: Record<ScalarType, TgsKind> = {
  string: 'text',
  int8: 'number', int16: 'number', int32: 'number', int: 'number', int128: 'number',
  uint8: 'number', uint16: 'number', uint32: 'number', uint64: 'number',
  float32: 'number', float: 'number', decimal: 'number',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime', zoneddatetime: 'datetime',
  duration: 'text', uuid: 'text', blob: 'text', json: 'text',
}

/**
 * The scalar each kind is read back as when nothing more exact is recorded. A `number`
 * is read as a double because that is what a YAML number is; `link` is a string, being
 * a wikilink or a URL as text.
 */
export const SCALAR_OF: Record<TgsKind, ScalarType> = {
  text: 'string', number: 'float', boolean: 'boolean', date: 'date', datetime: 'datetime',
  link: 'string', list: 'string',
}

export interface NoteParts {
  /** The frontmatter text between the fences, without them; undefined when there is none. */
  frontmatter?: string
  body: string
}

/** Cut a note into frontmatter and body. The closing fence may be `---` or `...` (TGS §1). */
export function splitNote(text: string): NoteParts {
  const normalized = text.replace(/^﻿/, '')
  const lines = normalized.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { body: normalized }
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!.trim()
    if (l === '---' || l === '...') {
      return { frontmatter: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n') }
    }
  }
  return { body: normalized }
}

/**
 * The top-level blocks of a frontmatter, each a key and the exact lines it spans. Cut by
 * indentation rather than reparsed and re-dumped, so that a key the export does not own
 * comes back byte for byte -- the same reason model edits are text splices.
 */
export function frontmatterBlocks(frontmatter: string): Array<{ key: string | undefined; lines: string[] }> {
  const out: Array<{ key: string | undefined; lines: string[] }> = []
  for (const line of frontmatter.split('\n')) {
    const m = /^([^\s#][^:]*?)\s*:(\s|$)/.exec(line)
    if (m) {
      out.push({ key: m[1]!.replace(/^["']|["']$/g, ''), lines: [line] })
    } else if (out.length === 0) {
      out.push({ key: undefined, lines: [line] })
    } else {
      out[out.length - 1]!.lines.push(line)
    }
  }
  return out
}

const PLAIN = /^[A-Za-z_][A-Za-z0-9_.-]*$/
const CURIE = /^[A-Za-z][A-Za-z0-9_.-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$/
/** Words YAML 1.1 or 1.2 would read as something other than a string. */
const RESERVED = /^(true|false|yes|no|on|off|null|y|n|~)$/i

/** A string as YAML: bare when that reads back as the same string, quoted otherwise. */
export function yamlString(s: string): string {
  if ((PLAIN.test(s) || CURIE.test(s)) && !RESERVED.test(s)) return s
  return JSON.stringify(s)
}

/**
 * Any value as YAML flow syntax: `{a: b, c: [d, e]}`. Key order is the insertion order,
 * which the writer fixes, so two exports of one model are byte-identical.
 */
export function flow(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return yamlString(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(flow).join(', ')}]`
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
  return `{${entries.map(([k, x]) => `${yamlString(k)}: ${flow(x)}`).join(', ')}}`
}
