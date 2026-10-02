/**
 * What the diagram is made of, apart from how it is drawn: where each box goes and which
 * connectors join them. Kept free of JSX and of the webview API so the tests can load it.
 * See lat.md/architecture#Rendering#Edge boxes.
 */

import { MarkerType, type Edge } from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Projection, WireEdge, WireNode } from '../protocol'

export const NODE_WIDTH = 240
export const EDGE_WIDTH = 200
/** Height estimate so ELK reserves room for the property rows. */
export const heightOf = (propCount: number) => 56 + propCount * 22 + 26
/** An edge box has one more header line than a node type box: its endpoints. */
export const edgeHeightOf = (propCount: number) => heightOf(propCount) + 16

const GAP = 48

export type Point = { x: number; y: number }
export type Positions = Record<string, Point>

const elk = new ELK()

/** The connector ids of an edge type: into its box, and out of it. */
export const connectorIds = (edgeId: string) => [`${edgeId}:from`, `${edgeId}:to`] as const

/**
 * Whether an edge type is drawn as abstract: it reaches an abstract node type at either
 * end. Such an edge belongs to every concrete descendant of that end, and no database
 * target stores it as declared -- the same claim `abstract` makes about a node type -- so
 * it is drawn the same way. Derived, never declared: the endpoints already say it.
 * See lat.md/architecture#Rendering#Abstract types.
 */
export function isAbstractEdge(e: WireEdge, nodes: WireNode[]): boolean {
  return nodes.some((n) => n.abstract && (n.name === e.from || n.name === e.to))
}

/** The dash an abstract edge type's connectors are drawn with: a line's one mark. */
export const ABSTRACT_DASH = '6 4'

/**
 * Two connectors per edge type: from its from type's box into the edge box, and from the
 * edge box into its to type's box. Each ends in an arrowhead, so the direction reads
 * without selecting anything, and both carry the edge type's id so either one selects it.
 */
export function connectors(p: Projection): Edge[] {
  const out: Edge[] = []
  for (const e of p.edges) {
    const from = p.nodes.find((n) => n.name === e.from)
    const to = p.nodes.find((n) => n.name === e.to)
    if (!from || !to) continue
    const [into, outOf] = connectorIds(e.id)
    const markerEnd = { type: MarkerType.ArrowClosed, color: 'var(--edge)', width: 18, height: 18 }
    const data = { edgeId: e.id }
    // A type joined to itself has both connectors between the same two sides, where they
    // would draw as one line with an arrowhead at each end. The way back is marked so it
    // attaches a little lower and the loop reads as two arrows.
    const back = from.id === to.id ? { edgeId: e.id, loop: true } : data
    const abstract = isAbstractEdge(e, p.nodes)
      ? { className: 'connector-abstract', style: { strokeDasharray: ABSTRACT_DASH } }
      : {}
    out.push(
      { id: into, source: from.id, target: e.id, markerEnd, data, ...abstract },
      { id: outOf, source: e.id, target: to.id, markerEnd, data: back, ...abstract },
    )
  }
  return out
}

/** Where a box stands and how wide it is: all that choosing a connector's sides needs. */
export type Extent = { x: number; width: number }

/**
 * Attach each connector to the sides of its two boxes that face each other. Every box
 * has a handle on the left (`l`) and the right (`r`), and a lower one on each (`l-lo`,
 * `r-lo`) for the way back of a loop; a connector leaving the right side
 * for a box to its left would run back through both boxes, which is what a type joined
 * to itself always does. Returns the same connector when its sides have not changed, so
 * calling it on every drag frame re-renders nothing that did not move.
 */
export function faceSides(cs: Edge[], boxes: Map<string, Extent>): Edge[] {
  let changed = false
  const out = cs.map((c) => {
    const a = boxes.get(c.source)
    const b = boxes.get(c.target)
    if (!a || !b) return c
    const rightwards = a.x + a.width / 2 <= b.x + b.width / 2
    const lower = (c.data as { loop?: boolean } | undefined)?.loop ? '-lo' : ''
    const sourceHandle = (rightwards ? 'r' : 'l') + lower
    const targetHandle = (rightwards ? 'l' : 'r') + lower
    if (c.sourceHandle === sourceHandle && c.targetHandle === targetHandle) return c
    changed = true
    return { ...c, sourceHandle, targetHandle }
  })
  return changed ? out : cs
}

/** Edge types whose endpoints are both on the diagram. The rest have nothing to join. */
const drawnEdges = (p: Projection): WireEdge[] =>
  p.edges.filter((e) => p.nodes.some((n) => n.name === e.from) && p.nodes.some((n) => n.name === e.to))

/**
 * Give every box a position. A diagram that has none is laid out wholesale by ELK; once
 * boxes are placed, a newly created type goes in a fresh column beside them and a new
 * edge box between its endpoints, rather than triggering a relayout that would move
 * everything the user had arranged.
 */
export async function place(p: Projection, existing: Positions): Promise<Positions> {
  const edges = drawnEdges(p)
  const missingNodes = p.nodes.filter((n) => !existing[n.id])
  const missingEdges = edges.filter((e) => !existing[e.id])
  if (missingNodes.length === 0 && missingEdges.length === 0) return existing

  const anyPlaced = [...p.nodes, ...edges].some((x) => existing[x.id])
  if (!anyPlaced) return layoutAll(p, edges, existing)

  const out = { ...existing }
  const placedNodes = p.nodes.map((n) => existing[n.id]).filter((pt): pt is Point => Boolean(pt))
  if (missingNodes.length > 0) {
    const x = placedNodes.length > 0 ? Math.max(...placedNodes.map((pt) => pt.x)) + NODE_WIDTH + 96 : 0
    const top = placedNodes.length > 0 ? Math.min(...placedNodes.map((pt) => pt.y)) : 0
    let y = top
    for (const n of missingNodes) {
      out[n.id] = { x, y }
      y += heightOf(n.props.length) + GAP
    }
  }

  // Between its endpoints, or beside its one type when it joins a type to itself. Boxes
  // that would land on the same spot -- two edge types between one pair -- stack down.
  const taken = new Map<string, number>()
  for (const e of missingEdges) {
    const from = p.nodes.find((n) => n.name === e.from)!
    const to = p.nodes.find((n) => n.name === e.to)!
    const a = out[from.id]!
    const b = out[to.id]!
    const centre = (pt: Point, props: number) =>
      ({ x: pt.x + NODE_WIDTH / 2, y: pt.y + heightOf(props) / 2 })
    const ca = centre(a, from.props.length)
    const cb = centre(b, to.props.length)
    const h = edgeHeightOf(e.props.length)
    const anchor = from.id === to.id
      ? { x: a.x + NODE_WIDTH + GAP, y: a.y }
      : { x: (ca.x + cb.x) / 2 - EDGE_WIDTH / 2, y: (ca.y + cb.y) / 2 - h / 2 }
    const key = `${Math.round(anchor.x)},${Math.round(anchor.y)}`
    const below = taken.get(key) ?? 0
    out[e.id] = { x: anchor.x, y: anchor.y + below }
    taken.set(key, below + h + GAP / 2)
  }
  return out
}

async function layoutAll(p: Projection, edges: WireEdge[], existing: Positions): Promise<Positions> {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
    },
    children: [
      ...p.nodes.map((n) => ({ id: n.id, width: NODE_WIDTH, height: heightOf(n.props.length) })),
      ...edges.map((e) => ({ id: e.id, width: EDGE_WIDTH, height: edgeHeightOf(e.props.length) })),
    ],
    // Each connector is an ELK edge, so a layered layout puts every edge box in the layer
    // between its endpoints and the diagram reads in the edges' direction.
    edges: connectors({ ...p, edges }).map((c) => ({ id: c.id, sources: [c.source], targets: [c.target] })),
  }
  const laid = await elk.layout(graph)
  const out = { ...existing }
  for (const child of laid.children ?? []) out[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
  return out
}
