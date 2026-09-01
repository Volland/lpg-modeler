import type { Diagnostic, ModelIR } from './ir'
import { LPG_FORMAT_VERSION, ORDERED_TYPES, TEXT_TYPES, assertionOperands, err, warn } from './ir'
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

  // --- Value constraints must suit the type they constrain.

  for (const owner of [...model.nodes, ...model.edges]) {
    for (const p of owner.props) {
      const where = `'${owner.name}.${p.name}'`
      if ((p.min !== undefined || p.max !== undefined) && !ORDERED_TYPES.has(p.type)) {
        out.push(err('constraint-type-mismatch',
          `Property ${where} has a min or max but type ${p.type}, which has no ordering. Bounds apply to the numeric and temporal types: ${[...ORDERED_TYPES].join(', ')}.`,
          p.loc))
      }
      if (p.min !== undefined && p.max !== undefined && p.min > p.max) {
        out.push(err('impossible-constraint',
          `Property ${where} has a min above its max, so no value can satisfy it.`, p.loc))
      }
      const stringOnly = p.pattern !== undefined || p.minLength !== undefined || p.maxLength !== undefined
      if (stringOnly && !TEXT_TYPES.has(p.type)) {
        out.push(err('constraint-type-mismatch',
          `Property ${where} has a pattern or a length bound but type ${p.type}. Those apply to string.`,
          p.loc))
      }
      if (p.minLength !== undefined && p.maxLength !== undefined && p.minLength > p.maxLength) {
        out.push(err('impossible-constraint',
          `Property ${where} has a minLength above its maxLength, so no value can satisfy it.`, p.loc))
      }
      if (p.pattern !== undefined) {
        try { new RegExp(p.pattern) } catch {
          out.push(err('malformed-pattern',
            `Property ${where} has a pattern that is not a valid regular expression.`, p.loc))
        }
      }
    }
  }

  // --- Named constraints refer to things the type actually has.
  for (const node of model.nodes) {
    const propNames = new Set(node.props.map((p) => p.name))
    const seen = new Set<string>()
    for (const k of node.constraints) {
      if (seen.has(k.name)) {
        out.push(err('duplicate-constraint',
          `Node type '${node.name}' declares two constraints named '${k.name}'.`, k.loc))
      }
      seen.add(k.name)

      for (const operand of assertionOperands(k.assert)) {
        if (!propNames.has(operand)) {
          out.push(err('unresolved-operand',
            `Constraint '${node.name}.${k.name}' refers to property '${operand}', which '${node.name}' neither declares nor inherits.`,
            k.loc))
        }
      }
      // Bound to a local so the narrowing survives the lookups below.
      const a = k.assert
      if (a.kind !== 'count') continue

      const edge = model.edges.find((e) => e.name === a.edge)
      if (!edge) {
        out.push(err('unresolved-operand',
          `Constraint '${node.name}.${k.name}' counts edge '${a.edge}', which is not a known edge type.`,
          k.loc))
        continue
      }
      const reachable = new Set([node.name, ...node.ancestors])
      if (!reachable.has(edge.from)) {
        out.push(err('unreachable-edge',
          `Constraint '${node.name}.${k.name}' counts edge '${edge.name}', which leaves '${edge.from}' rather than '${node.name}'.`,
          k.loc))
      }
      if (a.of && !model.nodes.some((n) => n.name === a.of)) {
        out.push(err('unresolved-operand',
          `Constraint '${node.name}.${k.name}' qualifies on type '${a.of}', which is not a known node type.`,
          k.loc))
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
