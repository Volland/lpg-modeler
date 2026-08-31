import { generateId, type RandomFn } from './ids'

/**
 * Source text for a new model file. Lives in core rather than in the extension so the
 * canvas and the CLI can offer the same starting point, and so it can be checked
 * without an editor. See lat.md/architecture#Editing Surface#Creating a Model.
 */

/** The prefix pattern the JSON Schema enforces. */
const PREFIX = /^[A-Za-z][A-Za-z0-9_-]*$/

export function isValidPrefix(prefix: string): boolean {
  return PREFIX.test(prefix)
}

/**
 * A base IRI has to end in a separator, or every type name would run straight into
 * the last character of the namespace.
 */
export function normalizeBaseIri(iri: string): string {
  const trimmed = iri.trim()
  return /[#/]$/.test(trimmed) ? trimmed : `${trimmed}#`
}

/** A name usable as a node type: leading capital, no separators. */
export function toTypeName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9]+/g, ' ').trim()
  if (cleaned === '') return 'Thing'
  return cleaned
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

export interface NewModelOptions {
  /** Namespace prefix, and the natural file name. */
  prefix: string
  /** Base IRI; a trailing separator is added when missing. */
  iri: string
  /**
   * Seed the model with one node type. A model with no concrete type is valid but
   * generates nothing, which is a poor first run.
   */
  seedType?: string
  /** Injected so tests can generate deterministic ids. */
  rand?: RandomFn
}

export function newModelSource(options: NewModelOptions): string {
  const { prefix, rand } = options
  const iri = normalizeBaseIri(options.iri)
  const type = toTypeName(options.seedType ?? 'Thing')

  return `# ${prefix} — a Labeled Property Graph model.
#
# Every type this file declares is identified by the namespace IRI below, not by this
# file's path, so renaming the file changes nothing. Reference:
# https://www.lpg-modeler.com/model-format.html
lpg: "1.0"

namespace:
  prefix: ${prefix}
  iri: ${iri}

nodes:
  # Rename this, or delete it and draw your own on the canvas. Every concrete node
  # type needs exactly one key, which is what identifies an instance.
  ${type}:
    id: ${generateId('node', rand)}
    key: [id]
    props:
      id:   { id: ${generateId('prop', rand)}, type: string, required: true }
      name: { id: ${generateId('prop', rand)}, type: string }

# edges:
#   RELATES_TO:
#     from: ${type}
#     to: ${type}
#     cardinality: { to: "0..1" }
`
}
