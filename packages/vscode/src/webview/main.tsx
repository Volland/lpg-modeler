import * as React from 'react'
import { createRoot } from 'react-dom/client'
import {
  Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow,
  getNodesBounds, getViewportForBounds,
  type Connection, type Edge, type FinalConnectionState, type Node,
  type NodeChange, applyNodeChanges,
} from '@xyflow/react'
import { toPng, toSvg } from 'html-to-image'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { HostMessage, Intent, Projection, ViewMessage } from '../protocol'
import { ErdNode, type ErdNodeData } from './nodes'
import { Inspector } from './inspector'
import {
  ConfirmDialog, EdgeDialog, EdgeToNewNodeDialog, PromptDialog, PropertyDialog,
  type Dialog,
} from './dialogs'

declare function acquireVsCodeApi(): { postMessage(m: ViewMessage): void }
const vscode = acquireVsCodeApi()
const post = (m: ViewMessage) => vscode.postMessage(m)
const intent = (i: Intent) => post({ type: 'intent', intent: i })


const elk = new ELK()
const NODE_TYPES = { erd: ErdNode }

const NODE_WIDTH = 240
/** Height estimate so ELK reserves room for the property rows. */
const heightOf = (propCount: number) => 56 + propCount * 22 + 26

/**
 * How far out the canvas may zoom. React Flow's own floor is 0.5, which is nowhere near
 * enough for a laid-out diagram: a few dozen ERD boxes span several thousand pixels, so
 * `fitView` asks for about 0.15, gets clamped to 0.5, and lands in the middle of a
 * diagram it cannot fit -- an empty patch of canvas, which reads as a model that failed
 * to load. See lat.md/architecture#Rendering.
 */
const MIN_ZOOM = 0.05
const FIT_VIEW = { padding: 0.15 }

type Positions = Record<string, { x: number; y: number }>

/**
 * Give every box a position. A diagram that has none is laid out wholesale by ELK; once
 * boxes are placed, a newly created type goes in a fresh column beside them rather than
 * triggering a relayout that would move everything the user had arranged.
 */
async function place(p: Projection, existing: Positions): Promise<Positions> {
  const missing = p.nodes.filter((n) => !existing[n.id])
  if (missing.length === 0) return existing

  const placed = p.nodes.map((n) => existing[n.id]).filter((pt): pt is { x: number; y: number } => Boolean(pt))
  if (placed.length > 0) {
    const x = Math.max(...placed.map((pt) => pt.x)) + NODE_WIDTH + 96
    const top = Math.min(...placed.map((pt) => pt.y))
    const out = { ...existing }
    missing.forEach((n, i) => { out[n.id] = { x, y: top + i * (heightOf(n.props.length) + 48) } })
    return out
  }

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
    },
    children: p.nodes.map((n) => ({ id: n.id, width: NODE_WIDTH, height: heightOf(n.props.length) })),
    edges: p.edges.map((e) => {
      const from = p.nodes.find((n) => n.name === e.from)
      const to = p.nodes.find((n) => n.name === e.to)
      return from && to ? { id: e.id, sources: [from.id], targets: [to.id] } : undefined
    }).filter((e): e is { id: string; sources: string[]; targets: string[] } => Boolean(e)),
  }
  const laid = await elk.layout(graph)
  const out = { ...existing }
  for (const child of laid.children ?? []) {
    if (!out[child.id]) out[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
  }
  return out
}

function App(): React.ReactElement {
  const [projection, setProjection] = React.useState<Projection | undefined>()
  const [notice, setNotice] = React.useState<string | undefined>()
  const [nodes, setNodes] = React.useState<Node[]>([])
  const [edges, setEdges] = React.useState<Edge[]>([])
  const [dialog, setDialog] = React.useState<Dialog | undefined>()
  const [selected, setSelected] = React.useState<string | undefined>(undefined)
  const [lightExport, setLightExport] = React.useState(false)
  const { fitView, getNodes } = useReactFlow()
  // Read inside the projection effect without making that effect depend on selection.
  const selectedRef = React.useRef<string | undefined>(undefined)
  selectedRef.current = selected

  /**
   * The webview cannot write files, so it rasterizes `.react-flow__viewport` itself and
   * hands the host a data URL to save. Only that element is captured -- not the dotted
   * `<Background>` or the zoom `<Controls>`, which sit beside it rather than inside it --
   * so the export reads as the diagram alone. `light` swaps in the print-safe palette
   * defined as `.export-light` in styles.css for the duration of the capture, so an
   * export doesn't depend on switching VS Code's own theme first. See
   * lat.md/architecture#Rendering#Exporting the diagram.
   */
  const exportDiagram = React.useCallback(async (format: 'png' | 'svg', light: boolean) => {
    const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport')
    const flowNodes = getNodes()
    if (!viewportEl || flowNodes.length === 0) return
    const bounds = getNodesBounds(flowNodes)
    const width = Math.ceil(bounds.width)
    const height = Math.ceil(bounds.height)
    const { x, y, zoom } = getViewportForBounds(bounds, width, height, 0.1, 2, FIT_VIEW.padding)
    if (light) viewportEl.classList.add('export-light')
    try {
      const options = {
        backgroundColor: getComputedStyle(viewportEl).getPropertyValue('--bg').trim(),
        width,
        height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        },
      }
      const dataUrl = format === 'png' ? await toPng(viewportEl, options) : await toSvg(viewportEl, options)
      post({ type: 'export', format, dataUrl })
    } finally {
      if (light) viewportEl.classList.remove('export-light')
    }
  }, [getNodes])

  /**
   * A palette command can ask for an export before the canvas has drawn anything:
   * `lpg.exportPng` on a model whose canvas was closed opens it first, and the request
   * lands while the projection is still being laid out. Capturing then would write an
   * empty picture, so the request is held until there are boxes, and a tick longer so
   * React Flow has measured the ones the crop is computed from -- the same reason the
   * re-frame after a new type goes through a timeout.
   * See lat.md/architecture#Rendering#Exporting the diagram.
   */
  const [pendingExport, setPendingExport] =
    React.useState<{ format: 'png' | 'svg'; seq: number } | undefined>()

  React.useEffect(() => {
    if (!pendingExport || nodes.length === 0) return
    const { format } = pendingExport
    setPendingExport(undefined)
    const timer = window.setTimeout(() => void exportDiagram(format, lightExport), 0)
    return () => window.clearTimeout(timer)
  }, [pendingExport, nodes, exportDiagram, lightExport])

  React.useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data
      if (message.type === 'exportRequest') {
        // Counted, so asking for the same format twice runs twice.
        setPendingExport((n) => ({ format: message.format, seq: (n?.seq ?? 0) + 1 }))
        return
      }
      if (message.type === 'invalid') { setNotice(message.message); return }
      setNotice(undefined)
      setProjection(message.projection)
    }
    window.addEventListener('message', onMessage)
    post({ type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [])

  React.useEffect(() => {
    if (!projection) return
    let cancelled = false
    void (async () => {
      const positions = await place(projection, projection.positions)
      if (cancelled) return
      // A position the canvas computed is persisted straight away, so the box stays put
      // across refreshes without waiting for the user to drag it.
      for (const [id, pt] of Object.entries(positions)) {
        if (!projection.positions[id]) post({ type: 'move', elementId: id, x: pt.x, y: pt.y })
      }
      const handlers = {
        onAddProperty: (owner: string) => setDialog({ kind: 'addProperty', owner, ownerKind: 'nodes' }),
        onDeleteProperty: (owner: string, name: string) =>
          intent({ kind: 'deleteProperty', owner, ownerKind: 'nodes', name }),
        onRenameProperty: (owner: string, name: string) =>
          setDialog({ kind: 'renameProperty', owner, ownerKind: 'nodes', name }),
        onRename: (name: string) => setDialog({ kind: 'renameNode', name }),
        onToggleKey: (owner: string, prop: string, isKey: boolean) =>
          intent({ kind: 'setKey', name: owner, key: isKey ? [] : [prop] }),
        onDelete: (name: string) => setDialog({ kind: 'confirmDeleteNode', name }),
        onStartEdge: (name: string) => setDialog({ kind: 'edgeToNewNode', from: name }),
        onSelectMixin: (name: string) => {
          const found = projection.mixins.find((m) => m.name === name)
          if (found) setSelected(found.id)
        },
      }
      setNodes(projection.nodes.map((n): Node => ({
        id: n.id,
        type: 'erd',
        position: positions[n.id] ?? { x: 0, y: 0 },
        selected: n.id === selectedRef.current,
        data: {
          name: n.name, abstract: n.abstract, open: n.open, extendsName: n.extends,
          mixins: n.mixins,
          props: n.props, constraintCount: n.constraints.length + (n.hasRawShacl ? 1 : 0),
          ...handlers,
        } satisfies ErdNodeData as unknown as Record<string, unknown>,
      })))
      setEdges(projection.edges.map((e): Edge => {
        const from = projection.nodes.find((n) => n.name === e.from)
        const to = projection.nodes.find((n) => n.name === e.to)
        // Multiplicity rides in the label rather than as endpoint markers: React Flow's
        // default edge has one label, and a wrong-looking crow's foot is worse than a
        // correct number. Editing happens in the inspector.
        const props = e.props.length > 0 ? ` {${e.props.map((p) => p.name).join(', ')}}` : ''
        const mult = e.cardinality.constrained
          ? `  [${e.cardinality.from} → ${e.cardinality.to}]`
          : ''
        return {
          id: e.id,
          source: from?.id ?? '',
          target: to?.id ?? '',
          label: `${e.name}${props}${mult}`,
          labelStyle: { fontSize: 11 },
          labelBgStyle: e.cardinality.constrained ? { fill: 'var(--bg)' } : undefined,
          animated: false,
          data: { edgeName: e.name },
        }
      }).filter((e) => e.source && e.target))
    })()
    return () => { cancelled = true }
  }, [projection])

  // A type created from the canvas is placed outside the current viewport, so bring the
  // diagram back into frame once the new box exists.
  const knownIds = React.useRef<string>('')
  React.useEffect(() => {
    const ids = nodes.map((n) => n.id).sort().join(',')
    const grew = knownIds.current !== '' && ids !== knownIds.current
      && nodes.length > knownIds.current.split(',').filter(Boolean).length
    knownIds.current = ids
    if (grew) window.setTimeout(() => void fitView({ duration: 200, ...FIT_VIEW }), 0)
  }, [nodes, fitView])

  const onNodesChange = React.useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
    for (const change of changes) {
      // Only a finished drag is persisted, and only to the layout sidecar.
      if (change.type === 'position' && change.dragging === false && change.position) {
        post({ type: 'move', elementId: change.id, x: change.position.x, y: change.position.y })
      }
    }
  }, [])

  const onNodeClick = React.useCallback((_: React.MouseEvent, n: Node) => setSelected(n.id), [])
  const onEdgeClick = React.useCallback((_: React.MouseEvent, e: Edge) => setSelected(e.id), [])
  const onPaneClick = React.useCallback(() => setSelected(undefined), [])

  const onConnect = React.useCallback((c: Connection) => {
    const from = projection?.nodes.find((n) => n.id === c.source)
    const to = projection?.nodes.find((n) => n.id === c.target)
    if (from && to) setDialog({ kind: 'newEdge', from: from.name, to: to.name })
  }, [projection])

  /**
   * A connection dropped on empty canvas rather than on a box. That gesture means "and
   * then there is one of these", so it offers to create the type as well as the edge.
   */
  const onConnectEnd = React.useCallback((_: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.toNode || !state.fromNode) return
    const from = projection?.nodes.find((n) => n.id === state.fromNode?.id)
    if (from) setDialog({ kind: 'edgeToNewNode', from: from.name })
  }, [projection])

  if (!projection) {
    return <div className="empty">{notice ?? 'Loading model…'}</div>
  }

  const errors = projection.diagnostics.filter((d) => d.severity === 'error')
  const warnings = projection.diagnostics.filter((d) => d.severity === 'warning')
  const close = () => setDialog(undefined)
  const selectedNode = projection.nodes.find((n) => n.id === selected)
  const selectedEdge = projection.edges.find((e) => e.id === selected)
  const selectedMixin = projection.mixins.find((m) => m.id === selected)

  return (
    <div className="app">
      <div className="toolbar">
        <label>
          View{' '}
          <select value={projection.activeView}
            onChange={(e) => post({ type: 'selectView', name: e.target.value })}>
            {projection.views.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <button onClick={() => setDialog({ kind: 'newView' })}>+ view</button>
        <span className="toolbar-sep" />
        <button className="primary" onClick={() => setDialog({ kind: 'newNode' })}>+ node type</button>
        <button
          disabled={projection.nodes.length === 0}
          title={projection.nodes.length === 0
            ? 'An edge type needs a node type at each end.'
            : 'Connect two node types'}
          onClick={() => setDialog({
            kind: 'newEdge',
            from: projection.nodes[0]?.name ?? '',
            to: projection.nodes[1]?.name ?? projection.nodes[0]?.name ?? '',
          })}
        >
          + edge type
        </button>
        <button title="A named bag of properties types can apply"
          onClick={() => setDialog({ kind: 'newMixin' })}>+ mixin</button>
        <span className="spacer" />
        <label>
          Export{' '}
          <label className="toolbar-check"
            title="Print-safe palette: white background, dark ink, no color-only cues">
            <input type="checkbox" checked={lightExport}
              onChange={(e) => setLightExport(e.target.checked)} /> light
          </label>{' '}
          <button title="Save the diagram as a PNG image" onClick={() => void exportDiagram('png', lightExport)}>
            PNG
          </button>{' '}
          <button title="Save the diagram as an SVG image" onClick={() => void exportDiagram('svg', lightExport)}>
            SVG
          </button>
        </label>
        <span className="toolbar-sep" />
        <label>
          Generate{' '}
          <select value="" onChange={(e) => {
            if (e.target.value) post({ type: 'generate', target: e.target.value })
            e.target.value = ''
          }}>
            <option value="">choose target…</option>
            {projection.targets.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      {notice && <div className="banner warn">{notice}</div>}
      {errors.length > 0 && (
        <div className="banner error">
          {errors.length} error(s): {errors[0]?.message}
        </div>
      )}
      {errors.length === 0 && warnings.length > 0 && (
        <div className="banner warn">
          {warnings.length} warning(s), including downgrades. See the Problems panel.
        </div>
      )}

      {dialog?.kind === 'newNode' && (
        <PromptDialog
          title="New node type" label="Name" placeholder="TypeName" submitLabel="create"
          onCancel={close}
          onSubmit={(name) => { intent({ kind: 'addNode', name }); close() }} />
      )}

      {dialog?.kind === 'newView' && (
        <PromptDialog
          title="New view" label="Name" placeholder="overview" submitLabel="create"
          onCancel={close}
          onSubmit={(name) => { post({ type: 'createView', name }); close() }} />
      )}

      {dialog?.kind === 'renameNode' && (
        <PromptDialog
          title={`Rename ${dialog.name}`} label="Name" initial={dialog.name} submitLabel="rename"
          onCancel={close}
          onSubmit={(to) => {
            if (to !== dialog.name) intent({ kind: 'renameNode', from: dialog.name, to })
            close()
          }} />
      )}

      {dialog?.kind === 'renameProperty' && (
        <PromptDialog
          title={`Rename ${dialog.name}`} label="Name" initial={dialog.name} submitLabel="rename"
          onCancel={close}
          onSubmit={(to) => {
            if (to !== dialog.name) {
              intent({
                kind: 'renameProperty', owner: dialog.owner, ownerKind: dialog.ownerKind,
                from: dialog.name, to,
              })
            }
            close()
          }} />
      )}

      {dialog?.kind === 'confirmDeleteNode' && (
        <ConfirmDialog
          title={`Delete ${dialog.name}?`}
          message="Every edge type that references it is removed too, because a reference left behind would not resolve."
          onCancel={close}
          onConfirm={() => {
            intent({ kind: 'deleteNode', name: dialog.name })
            if (selected) setSelected(undefined)
            close()
          }} />
      )}

      {dialog?.kind === 'confirmDeleteEdge' && (
        <ConfirmDialog
          title={`Delete ${dialog.name}?`}
          message="The edge type and its properties are removed. The node types it joined stay."
          onCancel={close}
          onConfirm={() => {
            intent({ kind: 'deleteEdge', name: dialog.name })
            setSelected(undefined)
            close()
          }} />
      )}

      {dialog?.kind === 'newEdge' && (
        <EdgeDialog
          nodes={projection.nodes} from={dialog.from} to={dialog.to}
          onCancel={close}
          onSubmit={(name, from, to) => { intent({ kind: 'addEdge', name, from, to }); close() }} />
      )}

      {dialog?.kind === 'edgeToNewNode' && (
        <EdgeToNewNodeDialog
          from={dialog.from}
          onCancel={close}
          onSubmit={(nodeName, edgeName) => {
            // Two intents, in order: the edge cannot name a type the file does not have.
            intent({ kind: 'addNode', name: nodeName })
            intent({ kind: 'addEdge', name: edgeName, from: dialog.from, to: nodeName })
            close()
          }} />
      )}

      {dialog?.kind === 'newMixin' && (
        <PromptDialog
          title="New mixin" label="Name" placeholder="Timestamped" submitLabel="create"
          onCancel={close}
          onSubmit={(name) => { intent({ kind: 'addMixin', name }); close() }} />
      )}

      {dialog?.kind === 'renameMixin' && (
        <PromptDialog
          title={`Rename ${dialog.name}`} label="Name" initial={dialog.name} submitLabel="rename"
          onCancel={close}
          onSubmit={(to) => {
            if (to !== dialog.name) intent({ kind: 'renameMixin', from: dialog.name, to })
            close()
          }} />
      )}

      {dialog?.kind === 'confirmDeleteMixin' && (
        <ConfirmDialog
          title={`Delete ${dialog.name}?`}
          message={dialog.appliedBy.length === 0
            ? 'No type applies it, so nothing else changes.'
            : `${dialog.appliedBy.join(', ')} apply it and lose its properties.`}
          onCancel={close}
          onConfirm={() => {
            intent({ kind: 'deleteMixin', name: dialog.name })
            setSelected(undefined)
            close()
          }} />
      )}

      {dialog?.kind === 'addProperty' && (
        <PropertyDialog
          owner={dialog.owner} scalars={projection.scalars}
          onCancel={close}
          onSubmit={(name, propType) => {
            intent({
              kind: 'addProperty', owner: dialog.owner, ownerKind: dialog.ownerKind, name, propType,
            })
            close()
          }} />
      )}

      <div className="workspace">
      <div className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onEdgeClick={onEdgeClick}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          fitViewOptions={FIT_VIEW}
          minZoom={MIN_ZOOM}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <Inspector
        node={selectedNode}
        edge={selectedEdge}
        mixin={selectedMixin}
        nodes={projection.nodes}
        edges={projection.edges}
        mixins={projection.mixins}
        scalars={projection.scalars}
        emit={intent}
        ask={setDialog}
        select={setSelected}
      />
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    // The provider is what lets the canvas re-frame itself when a type is created.
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>,
  )
}
