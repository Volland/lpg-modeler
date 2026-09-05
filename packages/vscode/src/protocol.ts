/** Messages between the extension host and the canvas webview. */

export interface WireProperty {
  id: string
  name: string
  type: string
  /** Parameters of a decimal, when it declares them. */
  precision?: number
  scale?: number
  required: boolean
  unique: boolean
  isKey: boolean
  /** Whether the property holds a list of its type. */
  list: boolean
  /**
   * The whole type, already spelled out, when it is composite. `type` and `list` then
   * say only what a target without composites keeps, so this is what the canvas shows.
   */
  composite?: string
  /** Name of the enum constraining its values, if any. */
  enum?: string
  /** Bounds and shape on the value. See lat.md/metamodel#Value Constraints. */
  min?: number
  max?: number
  pattern?: string
  minLength?: number
  maxLength?: number
  /** The type or mixin this property came from, when it is not declared here. */
  inheritedFrom?: string
  /** Whether `inheritedFrom` names an ancestor or a mixin. */
  inheritedVia?: 'parent' | 'mixin'
}

/** A named constraint, already rendered for display. */
export interface WireConstraint {
  id: string
  name: string
  kind: string
  /** Human-readable form, e.g. `startDate < endDate`. */
  summary: string
  message?: string
}

export interface WireNode {
  id: string
  name: string
  abstract: boolean
  /** Whether instances may carry properties the type does not declare. */
  open: boolean
  extends?: string
  /** Every ancestor, nearest first. See lat.md/metamodel#Type Hierarchy. */
  ancestors: string[]
  /** Mixins this type applies, in the order it applies them. */
  mixins: string[]
  props: WireProperty[]
  constraints: WireConstraint[]
  /** Whether the type carries a raw SHACL fragment. */
  hasRawShacl: boolean
}

/** Endpoint multiplicity, already formatted for display and for editing. */
export interface WireCardinality {
  from: string
  to: string
  /** The named form when one fits, else the bounds. */
  label: string
  /** Whether it constrains anything at all. */
  constrained: boolean
}

export interface WireEdge {
  id: string
  name: string
  from: string
  to: string
  cardinality: WireCardinality
  props: WireProperty[]
}

/**
 * A mixin: a named bag of properties that types apply. It is not a supertype and has no
 * identity of its own. See lat.md/metamodel#Type Hierarchy#Mixins.
 */
export interface WireMixin {
  id: string
  name: string
  props: WireProperty[]
  /** Node types applying it, so the panel can say what a change would touch. */
  appliedBy: string[]
}

export interface WireDiagnostic {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  target?: string
}

/**
 * A scalar the canvas may offer, and which facets it admits: 'ordered' takes min and
 * max, 'text' takes a pattern and length bounds. The host sends the set rather than the
 * webview keeping its own copy, which would drift from the metamodel.
 */
export interface WireScalar {
  name: string
  facets: 'ordered' | 'text' | 'none'
}

/**
 * How a property's type reads: the scalar, its parameters, and its list marker, or the
 * composite spelled out whole.
 */
export function displayType(p: WireProperty): string {
  if (p.composite) return p.composite
  const params = p.precision !== undefined && p.scale !== undefined
    ? `(${p.precision},${p.scale})` : ''
  return `${p.type}${params}${p.list ? '[]' : ''}`
}

export interface Projection {
  views: string[]
  activeView: string
  nodes: WireNode[]
  edges: WireEdge[]
  /** Declared mixins. Model-wide: a mixin belongs to no one diagram. */
  mixins: WireMixin[]
  /** Saved positions for the active view, keyed by element id. */
  positions: Record<string, { x: number; y: number }>
  diagnostics: WireDiagnostic[]
  targets: string[]
  /** Every scalar a property may take, in the order the canvas offers them. */
  scalars: WireScalar[]
}

export type HostMessage =
  | { type: 'projection'; projection: Projection }
  /**
   * The model file cannot be parsed. The canvas keeps its last valid diagram and shows
   * this, rather than going blank. See lat.md/architecture#Editing Surface.
   */
  | { type: 'invalid'; message: string }

/** What an intent addresses. A mixin holds properties the same way a type does. */
export type OwnerKind = 'nodes' | 'edges' | 'mixins'

export type Intent =
  | { kind: 'addNode'; name: string }
  | { kind: 'renameNode'; from: string; to: string }
  | { kind: 'deleteNode'; name: string }
  | { kind: 'setAbstractParent'; name: string; parent: string | undefined }
  | { kind: 'setAbstract'; name: string; abstract: boolean }
  | { kind: 'addProperty'; owner: string; ownerKind: OwnerKind; name: string; propType: string }
  | { kind: 'renameProperty'; owner: string; ownerKind: OwnerKind; from: string; to: string }
  | { kind: 'deleteProperty'; owner: string; ownerKind: OwnerKind; name: string }
  | { kind: 'setKey'; name: string; key: string[] }
  | { kind: 'addEdge'; name: string; from: string; to: string }
  | { kind: 'renameEdge'; from: string; to: string }
  | { kind: 'deleteEdge'; name: string }
  | { kind: 'setEndpoint'; name: string; which: 'from' | 'to'; target: string }
  | { kind: 'setCardinality'; name: string; from: string; to: string }
  | {
      kind: 'setPropertyFacet'
      owner: string
      ownerKind: OwnerKind
      prop: string
      facet: 'min' | 'max' | 'pattern' | 'minLength' | 'maxLength'
      /** Absent clears the facet. */
      value?: string
    }
  | { kind: 'addMixin'; name: string }
  | { kind: 'renameMixin'; from: string; to: string }
  | { kind: 'deleteMixin'; name: string }
  /** The whole set a type applies, which is what a list of checkboxes says. */
  | { kind: 'setMixins'; name: string; mixins: string[] }
  | { kind: 'addConstraint'; owner: string; name: string; assertion: string; message?: string }
  | { kind: 'deleteConstraint'; owner: string; name: string }

export type ViewMessage =
  | { type: 'ready' }
  | { type: 'intent'; intent: Intent }
  | { type: 'move'; elementId: string; x: number; y: number }
  | { type: 'selectView'; name: string }
  | { type: 'createView'; name: string }
  | { type: 'setViewMembership'; view: string; name: string; include: boolean }
  | { type: 'generate'; target: string }
  /** The canvas selects; the inspector renders whatever is selected. */
  | { type: 'select'; elementId: string | undefined }
