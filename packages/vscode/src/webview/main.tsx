import * as React from 'react'
import { createRoot } from 'react-dom/client'
import {
  Background, Controls, ReactFlow, type Connection, type Edge, type Node,
  type NodeChange, applyNodeChanges,
} from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { HostMessage, Intent, Projection, ViewMessage, WireScalar } from '../protocol'
import { ErdNode, type ErdNodeData } from './nodes'
import { Inspector } from './inspector'

declare function acquireVsCodeApi(): { postMessage(m: ViewMessage): void }
const vscode = acquireVsCodeApi()
const post = (m: ViewMessage) => vscode.postMessage(m)
const intent = (i: Intent) => post({ type: 'intent', intent: i })


const elk = new ELK()
const NODE_TYPES = { erd: ErdNode }

/** Height estimate so ELK reserves room for the property rows. */
const heightOf = (propCount: number) => 56 + propCount * 22 + 26

async function autoLayout(p: Projection, existing: Record<string, { x: number; y: number }>) {
  const missing = p.nodes.filter((n) => !existing[n.id])
  if (missing.length === 0) return existing
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
    },
    children: p.nodes.map((n) => ({ id: n.id, width: 240, height: heightOf(n.props.length) })),
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
  const [pendingEdge, setPendingEdge] = React.useState<{ from: string; to: string } | undefined>()
  const [adding, setAdding] = React.useState<{ owner: string } | undefined>()

  React.useEffect(() => {
    const onMessage = async (event: MessageEvent<HostMessage>) => {
      const message = event.data
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
      const positions = await autoLayout(projection, projection.positions)
      if (cancelled) return
      const handlers = {
        onAddProperty: (owner: string) => setAdding({ owner }),
        onDeleteProperty: (owner: string, name: string) =>
          intent({ kind: 'deleteProperty', owner, ownerKind: 'nodes', name }),
        onRename: (from: string) => {
          const to = window.prompt(`Rename ${from} to`, from)
          if (to && to !== from) intent({ kind: 'renameNode', from, to })
        },
        onToggleKey: (owner: string, prop: string) => intent({ kind: 'setKey', name: owner, key: [prop] }),
        onDelete: (name: string) => {
          if (window.confirm(`Delete ${name}? Edges that reference it are removed too.`)) {
            intent({ kind: 'deleteNode', name })
          }
        },
      }
      setNodes(projection.nodes.map((n): Node => ({
        id: n.id,
        type: 'erd',
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: {
          name: n.name, abstract: n.abstract, open: n.open, extendsName: n.extends,
          props: n.props, constraintCount: n.constraints.length + (n.hasRawShacl ? 1 : 0),
          ...handlers,
        } satisfies ErdNodeData as unknown as Record<string, unknown>,
      })))
      setEdges(projection.edges.map((e): Edge => {
        const from = projection.nodes.find((n) => n.name === e.from)
        const to = projection.nodes.find((n) => n.name === e.to)
        // Multiplicity rides in the label rather than as endpoint markers: React Flow's
        // default edge has one label, and a wrong-looking crow's foot is worse than a
        // correct number. Editing happens on click.
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
          labelBgStyle: e.cardinality.constrained ? { fill: 'var(--vscode-editor-background)' } : undefined,
          animated: false,
          data: { edgeName: e.name, cardinality: e.cardinality },
        }
      }).filter((e) => e.source && e.target))
    })()
    return () => { cancelled = true }
  }, [projection])

  const onNodesChange = React.useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
    for (const change of changes) {
      // Only a finished drag is persisted, and only to the layout sidecar.
      if (change.type === 'position' && change.dragging === false && change.position) {
        post({ type: 'move', elementId: change.id, x: change.position.x, y: change.position.y })
      }
    }
  }, [])

  const [selected, setSelected] = React.useState<string | undefined>(undefined)

  const onNodeClick = React.useCallback((_: React.MouseEvent, n: Node) => {
    setSelected(n.id)
  }, [])

  const onPaneClick = React.useCallback(() => setSelected(undefined), [])

  const onEdgeClick = React.useCallback((_: React.MouseEvent, edge: Edge) => {
    const d = edge.data as { edgeName?: string; cardinality?: { from: string; to: string } } | undefined
    if (!d?.edgeName || !d.cardinality) return
    const from = window.prompt(
      `${d.edgeName}: how many ${'sources'} per target?\n`
      + `'*' any, '2' exactly two, '1..2' a range, '1..*' at least one.`,
      d.cardinality.from)
    if (from === null) return
    const to = window.prompt(
      `${d.edgeName}: how many targets per source?`, d.cardinality.to)
    if (to === null) return
    intent({ kind: 'setCardinality', name: d.edgeName, from: from.trim(), to: to.trim() })
  }, [])

  const onConnect = React.useCallback((c: Connection) => {
    const from = projection?.nodes.find((n) => n.id === c.source)
    const to = projection?.nodes.find((n) => n.id === c.target)
    if (from && to) setPendingEdge({ from: from.name, to: to.name })
  }, [projection])

  if (!projection) {
    return <div className="empty">{notice ?? 'Loading model…'}</div>
  }

  const errors = projection.diagnostics.filter((d) => d.severity === 'error')
  const warnings = projection.diagnostics.filter((d) => d.severity === 'warning')

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
        <button onClick={() => {
          const name = window.prompt('New view name')
          if (name) post({ type: 'createView', name })
        }}>+ view</button>
        <button onClick={() => {
          const name = window.prompt('New node type name')
          if (name) intent({ kind: 'addNode', name })
        }}>+ node type</button>
        <span className="spacer" />
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

      {pendingEdge && (
        <div className="modal">
          <div className="modal-body">
            <p>New edge {pendingEdge.from} → {pendingEdge.to}</p>
            <input autoFocus placeholder="EDGE_NAME" onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const name = (e.target as HTMLInputElement).value.trim()
                if (name) intent({ kind: 'addEdge', name, ...pendingEdge })
                setPendingEdge(undefined)
              }
              if (e.key === 'Escape') setPendingEdge(undefined)
            }} />
            <button onClick={() => setPendingEdge(undefined)}>cancel</button>
          </div>
        </div>
      )}

      {adding && (
        <div className="modal">
          <div className="modal-body">
            <p>New property on {adding.owner}</p>
            <PropertyForm
              scalars={projection.scalars}
              onCancel={() => setAdding(undefined)}
              onSubmit={(name, propType) => {
                intent({ kind: 'addProperty', owner: adding.owner, ownerKind: 'nodes', name, propType })
                setAdding(undefined)
              }} />
          </div>
        </div>
      )}

      <div className="workspace">
      <div className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <Inspector
        node={projection.nodes.find((n) => n.id === selected)}
        scalars={projection.scalars}
        emit={intent}
      />
      </div>
    </div>
  )
}

function PropertyForm(
  { scalars, onSubmit, onCancel }: {
    scalars: WireScalar[]
    onSubmit: (name: string, type: string) => void
    onCancel: () => void
  },
): React.ReactElement {
  const [name, setName] = React.useState('')
  const [type, setType] = React.useState('string')
  return (
    <div className="form">
      <input autoFocus placeholder="propertyName" value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSubmit(name.trim(), type) }} />
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {scalars.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
      </select>
      <button disabled={!name.trim()} onClick={() => onSubmit(name.trim(), type)}>add</button>
      <button onClick={onCancel}>cancel</button>
    </div>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
