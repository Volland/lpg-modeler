import {
  addEdgeType, addNodeType, addProperty, applyEdits, deleteProperty, deleteType,
  addConstraint, deleteConstraint, renameProperty, renameType, resolveModel,
  setAbstractParent, setCardinality, setEndpoint, setKey, setPropertyFacet,
  setPreviousIri, type ScalarType, type TextEdit,
} from '@lpg/core'
import type { Intent } from './protocol'

/**
 * Translate a canvas intent into edits on the model file. Pure: no editor API, so the
 * authoring surface can be tested without a running VS Code.
 */
export function intentToEdits(
  text: string,
  intent: Intent,
  modelPath: string,
  read: (p: string) => string | undefined,
): TextEdit[] {
  switch (intent.kind) {
    case 'addNode':
      return addNodeType(text, intent.name, {})

    case 'renameNode': {
      // Record the pre-rename IRI first so the ontology can assert equivalence to it.
      const { model } = resolveModel(modelPath, read)
      const node = model.nodes.find((n) => n.name === intent.from)
      const pre = node && !node.previousIri
        ? setPreviousIri(text, 'nodes', intent.from, node.iri)
        : []
      // The rename is computed against the already-patched text, so both sets of edits
      // are consistent; return them as a single application over the original.
      const patched = applyEdits(text, pre)
      const renames = renameType(patched, 'nodes', intent.from, intent.to)
      return combine(text, pre, renames)
    }

    case 'deleteNode':
      return deleteType(text, 'nodes', intent.name)
    case 'setAbstractParent':
      return setAbstractParent(text, intent.name, intent.parent)
    case 'addProperty':
      return addProperty(text, intent.ownerKind, intent.owner, {
        name: intent.name, type: intent.propType as ScalarType,
      })
    case 'renameProperty':
      return renameProperty(text, intent.ownerKind, intent.owner, intent.from, intent.to)
    case 'deleteProperty':
      return deleteProperty(text, intent.ownerKind, intent.owner, intent.name)
    case 'setKey':
      return setKey(text, intent.name, intent.key)
    case 'addEdge':
      return addEdgeType(text, intent.name, intent.from, intent.to)
    case 'deleteEdge':
      return deleteType(text, 'edges', intent.name)
    case 'setEndpoint':
      return setEndpoint(text, intent.name, intent.which, intent.target)
    case 'setCardinality':
      return setCardinality(text, intent.name, intent.from, intent.to)

    case 'setPropertyFacet': {
      // A pattern is a string and has to stay quoted; a bound is a number.
      const quoted = intent.facet === 'pattern'
      const rendered = intent.value === undefined || intent.value === ''
        ? undefined
        : quoted ? JSON.stringify(intent.value) : intent.value
      return setPropertyFacet(
        text, intent.ownerKind, intent.owner, intent.prop, intent.facet, rendered)
    }

    case 'addConstraint':
      return addConstraint(text, intent.owner, intent.name, intent.assertion, intent.message)
    case 'deleteConstraint':
      return deleteConstraint(text, intent.owner, intent.name)
  }
}

/**
 * Fold two edit passes into one set against the original text. The second pass was
 * computed against text already carrying the first, so its offsets are shifted back.
 */
function combine(original: string, first: TextEdit[], second: TextEdit[]): TextEdit[] {
  const shifted = second.map((e) => {
    let delta = 0
    for (const a of first) {
      if (a.end <= e.start) delta += a.newText.length - (a.end - a.start)
    }
    return { start: e.start - delta, end: e.end - delta, newText: e.newText }
  })
  const all = [...first, ...shifted].sort((a, b) => a.start - b.start)
  // Overlapping edits would corrupt the file; drop the later of any overlapping pair.
  const out: TextEdit[] = []
  for (const e of all) {
    const prev = out[out.length - 1]
    if (prev && e.start < prev.end) continue
    out.push(e)
  }
  void original
  return out
}
