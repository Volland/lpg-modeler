import type { Diagnostic, Loc, ModelIR } from './ir'
import { hasValueConstraints } from './ir'

/**
 * What a target can express. The compiler compares a model against this and reports
 * everything the target cannot carry. See lat.md/emitters#Capability Matrix.
 */
export interface Capabilities {
  target: string
  /** Can a node carry more than one label at once? */
  multiLabel: boolean
  /** How an abstract hierarchy is realised. */
  inheritance: 'leaf-tables' | 'labels' | 'subclass'
  /** Whether a required property is enforced, and where. */
  requiredConstraint: 'enforced' | 'key-only' | 'edition-dependent' | 'unsupported'
  /** Whether a unique property other than the key is enforced. */
  uniqueConstraint: 'enforced' | 'key-only' | 'edition-dependent' | 'unsupported'
  /** How a composite key is realised. */
  compositeKey: 'native' | 'synthesized' | 'unsupported'
  /** How edge properties are carried. */
  edgeProps: 'native' | 'reified'
  /** Edges that are themselves endpoints of other edges. Out of the core metamodel. */
  nestedEdges: boolean
  /** Whether a property may hold a list of values. */
  listProps: 'native' | 'unsupported'
  /**
   * Whether an enumerated value set is enforced, merely written down where a reader
   * will see it, or has nowhere to go at all.
   */
  enums: 'enforced' | 'documented' | 'unsupported'
  /**
   * Whether a type can say that undeclared properties are allowed. `always-open`
   * means the target cannot enforce a closed type either way.
   */
  openTypes: 'native' | 'always-open' | 'unsupported'
  /**
   * Whether bounds and patterns on a value are enforced. `partial` means some are and
   * some are not, each reported individually.
   */
  valueConstraints: 'enforced' | 'partial' | 'unsupported'
  /** Whether an assertion spanning more than one property is enforced. */
  namedConstraints: 'enforced' | 'unsupported'
  /** Whether a raw SHACL fragment is spliced through rather than ignored. */
  rawPassthrough: boolean
  /**
   * Whether endpoint multiplicity is enforced. `upper-bound-only` means the target can
   * say an end holds at most one, and nothing else: no minimum, no exact count.
   */
  cardinality: 'enforced' | 'upper-bound-only' | 'unsupported'
}

export interface EmitOptions {
  /** Community cannot enforce existence or node key constraints. */
  neo4jEdition?: 'community' | 'enterprise'
}

export interface EmitResult {
  target: string
  /** Suggested file extension, without a leading dot. */
  extension: string
  content: string
  diagnostics: Diagnostic[]
}

/**
 * Record a feature the target cannot express. Always produces a diagnostic; callers
 * additionally write a comment at the lossy site in the artifact. Never drop silently.
 */
export function downgrade(
  into: Diagnostic[], target: string, code: string, message: string, loc?: Loc,
): void {
  into.push({ severity: 'warning', code, message, target, ...(loc ? { loc } : {}) })
}

/**
 * A downgrade of a constraint that only the validation targets were ever going to
 * carry. Reported at info rather than warning: on a model with constraints, five of
 * the seven targets cannot hold any of them, and a warning apiece would bury the
 * downgrades that are genuinely surprising. See lat.md/emitters#Capability Matrix.
 */
export function constraintDowngrade(
  into: Diagnostic[], target: string, code: string, message: string, loc?: Loc,
): void {
  into.push({ severity: 'info', code, message, target, ...(loc ? { loc } : {}) })
}

/**
 * Report every constraint a target cannot carry, in one place, so the five targets that
 * carry none of them cannot drift apart in what they say about it.
 */
export function reportUnsupportedConstraints(
  into: Diagnostic[], target: string, model: ModelIR, caps: Capabilities,
): void {
  if (caps.valueConstraints === 'unsupported') {
    for (const owner of [...model.nodes, ...model.edges]) {
      for (const p of owner.props) {
        if (!hasValueConstraints(p)) continue
        constraintDowngrade(into, target, 'downgrade-value-constraint',
          `Property '${owner.name}.${p.name}' bounds its values, which ${target} has no schema facility for. The SHACL artifact carries it.`,
          p.loc)
      }
    }
  }
  if (caps.namedConstraints === 'unsupported') {
    for (const node of model.nodes) {
      for (const k of node.constraints) {
        constraintDowngrade(into, target, 'downgrade-named-constraint',
          `Constraint '${node.name}.${k.name}' asserts '${k.assert.kind}', which ${target} cannot express. The SHACL artifact carries it.`,
          k.loc)
      }
    }
  }
  if (!caps.rawPassthrough) {
    for (const node of model.nodes) {
      if (!node.rawShacl) continue
      constraintDowngrade(into, target, 'downgrade-raw-shacl',
        `Node type '${node.name}' carries a raw SHACL fragment, which only the shacl target can use.`,
        node.loc)
    }
  }
}
