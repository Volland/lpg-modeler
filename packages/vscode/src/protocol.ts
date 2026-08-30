/** Messages between the extension host and the canvas webview. */

export interface WireProperty {
  id: string
  name: string
  type: string
  required: boolean
  unique: boolean
  isKey: boolean
  /** Whether the property holds a list of its type. */
  list: boolean
  /** Name of the enum constraining its values, if any. */
  enum?: string
  /** Bounds and shape on the value. See lat.md/metamodel#Value Constraints. */
  min?: number
  max?: number
  pattern?: string
  minLength?: number
  maxLength?: number
  inheritedFrom?: string
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

export interface WireDiagnostic {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  target?: string
}

export interface Projection {
  views: string[]
  activeView: string
  nodes: WireNode[]
  edges: WireEdge[]
  /** Saved positions for the active view, keyed by element id. */
  positions: Record<string, { x: number; y: number }>
  diagnostics: WireDiagnostic[]
  targets: string[]
}

export type HostMessage =
  | { type: 'projection'; projection: Projection }
  /**
   * The model file cannot be parsed. The canvas keeps its last valid diagram and shows
   * this, rather than going blank. See lat.md/architecture#Editing Surface.
   */
  | { type: 'invalid'; message: string }

export type Intent =
  | { kind: 'addNode'; name: string }
  | { kind: 'renameNode'; from: string; to: string }
  | { kind: 'deleteNode'; name: string }
  | { kind: 'setAbstractParent'; name: string; parent: string | undefined }
  | { kind: 'addProperty'; owner: string; ownerKind: 'nodes' | 'edges'; name: string; propType: string }
  | { kind: 'renameProperty'; owner: string; ownerKind: 'nodes' | 'edges'; from: string; to: string }
  | { kind: 'deleteProperty'; owner: string; ownerKind: 'nodes' | 'edges'; name: string }
  | { kind: 'setKey'; name: string; key: string[] }
  | { kind: 'addEdge'; name: string; from: string; to: string }
  | { kind: 'deleteEdge'; name: string }
  | { kind: 'setEndpoint'; name: string; which: 'from' | 'to'; target: string }
  | { kind: 'setCardinality'; name: string; from: string; to: string }
  | {
      kind: 'setPropertyFacet'
      owner: string
      ownerKind: 'nodes' | 'edges'
      prop: string
      facet: 'min' | 'max' | 'pattern' | 'minLength' | 'maxLength'
      /** Absent clears the facet. */
      value?: string
    }
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
