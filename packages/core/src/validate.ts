import type { Diagnostic, ModelIR } from './ir'
import { LPG_FORMAT_VERSION, err, warn } from './ir'
import type { ViewDef } from './views'
import { typesInNoView } from './views'

/**
 * Semantic rules that resolution alone does not cover. Structural and reference errors
 * come back from resolveModel; these are the model-level obligations.
 */
export function validateModel(model: ModelIR, views?: ViewDef[]): Diagnostic[] {
  const out: Diagnostic[] = []

  // A file from a future format is read on a best-effort basis rather than rejected:
  // the keys this build knows still resolve, and the ones it does not are reported.
  const declared = model.formatVersion
  if (declared !== undefined) {
    const major = (v: string) => Number.parseInt(v.split('.')[0] ?? '', 10)
    const theirs = major(declared)
    if (!Number.isFinite(theirs)) {
      out.push(warn('unknown-format-version',
        `Model declares format version '${declared}', which is not a version number. This build reads ${LPG_FORMAT_VERSION}.`))
    } else if (theirs > major(LPG_FORMAT_VERSION)) {
      out.push(warn('unsupported-format-version',
        `Model declares format version ${declared}, which is newer than the ${LPG_FORMAT_VERSION} this build reads. Anything it adds is ignored.`))
    }
  }

  // Enum references resolve by name across the closure, like every other type ref.
  const enumNames = new Set(model.enums.map((e) => e.name))
  const checkEnumRefs = (owner: string, props: typeof model.nodes[number]['props']) => {
    for (const p of props) {
      if (!p.enum) continue
      if (!enumNames.has(p.enum)) {
        out.push(err('unresolved-enum',
          `Property '${owner}.${p.name}' references enum '${p.enum}', which is not declared in this model or any it imports.`,
          p.loc))
        continue
      }
      if (p.type !== 'string') {
        out.push(err('enum-type-mismatch',
          `Property '${owner}.${p.name}' references enum '${p.enum}' but has type ${p.type}. An enum constrains string values.`,
          p.loc))
      }
    }
  }
  for (const node of model.nodes) checkEnumRefs(node.name, node.props)
  for (const edge of model.edges) checkEnumRefs(edge.name, edge.props)

  for (const enumeration of model.enums) {
    const duplicates = enumeration.values.filter((v, i) => enumeration.values.indexOf(v) !== i)
    if (duplicates.length > 0) {
      out.push(err('duplicate-enum-value',
        `Enum '${enumeration.name}' repeats the value '${duplicates[0]}'. Values must be distinct.`,
        enumeration.loc))
    }
  }

  for (const node of model.nodes) {
    if (!node.abstract && node.key.length === 0) {
      out.push(err('missing-key',
        `Node type '${node.name}' is concrete but has no key on itself or any ancestor. Every concrete node type needs exactly one key.`,
        node.loc))
    }
    const propNames = new Set(node.props.map((p) => p.name))
    for (const k of node.key) {
      const keyProp = node.props.find((p) => p.name === k)
      if (keyProp?.list) {
        out.push(err('list-key',
          `Node type '${node.name}' uses list property '${k}' as part of its key. A key must identify one node, which a list of values cannot do.`,
          node.loc))
      }
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
