/** Messages between the extension host and the canvas webview. */

export interface WireProperty {
  id: string
  name: string
  type: string
  required: boolean
  unique: boolean
  isKey: boolean
  inheritedFrom?: string
}

export interface WireNode {
  id: string
  name: string
  abstract: boolean
  extends?: string
  props: WireProperty[]
}

export interface WireEdge {
  id: string
  name: string
  from: string
  to: string
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

export type ViewMessage =
  | { type: 'ready' }
  | { type: 'intent'; intent: Intent }
  | { type: 'move'; elementId: string; x: number; y: number }
  | { type: 'selectView'; name: string }
  | { type: 'createView'; name: string }
  | { type: 'setViewMembership'; view: string; name: string; include: boolean }
  | { type: 'generate'; target: string }
