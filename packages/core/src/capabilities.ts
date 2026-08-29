import type { Diagnostic, Loc } from './ir'

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
  /** Whether endpoint multiplicity is enforced. */
  cardinality: 'enforced' | 'unsupported'
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
