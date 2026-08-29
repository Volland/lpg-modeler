import type { Diagnostic, ModelIR } from './ir'
import { err, warn } from './ir'
import type { ViewDef } from './views'
import { typesInNoView } from './views'

/**
 * Semantic rules that resolution alone does not cover. Structural and reference errors
 * come back from resolveModel; these are the model-level obligations.
 */
export function validateModel(model: ModelIR, views?: ViewDef[]): Diagnostic[] {
  const out: Diagnostic[] = []

  for (const node of model.nodes) {
    if (!node.abstract && node.key.length === 0) {
      out.push(err('missing-key',
        `Node type '${node.name}' is concrete but has no key on itself or any ancestor. Every concrete node type needs exactly one key.`,
        node.loc))
    }
    const propNames = new Set(node.props.map((p) => p.name))
    for (const k of node.key) {
      if (!propNames.has(k)) {
        out.push(err('key-unknown-property',
          `Node type '${node.name}' declares key property '${k}', which it neither declares nor inherits.`,
          node.loc))
      }
    }
  }

  if (views && views.length > 0) {
    for (const name of typesInNoView(model, views)) {
      const node = model.nodes.find((n) => n.name === name)
      out.push(warn('type-in-no-view',
        `Node type '${name}' appears in no view, so it is invisible on every diagram.`,
        node?.loc))
    }
  }

  return out
}
