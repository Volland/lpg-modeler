import * as React from 'react'
import type { OwnerKind, WireNode, WireScalar } from '../protocol'

/**
 * Every question the canvas asks. A VS Code webview is a sandboxed iframe where
 * `window.prompt`, `window.confirm` and `window.alert` are inert: they return without
 * showing anything, so an action routed through one silently does nothing. Each of
 * these renders in the document instead. See lat.md/architecture#Editing Surface#Asking.
 */
export type Dialog =
  | { kind: 'newNode' }
  | { kind: 'newView' }
  | { kind: 'renameNode'; name: string }
  | { kind: 'renameProperty'; owner: string; ownerKind: OwnerKind; name: string }
  | { kind: 'addProperty'; owner: string; ownerKind: OwnerKind }
  | { kind: 'confirmDeleteNode'; name: string }
  | { kind: 'confirmDeleteEdge'; name: string }
  /** Both endpoints known: the user dragged between two boxes, or used the toolbar. */
  | { kind: 'newEdge'; from: string; to: string }
  /** Dragged from a box and dropped on empty canvas: the target does not exist yet. */
  | { kind: 'edgeToNewNode'; from: string }
  | { kind: 'newMixin' }
  | { kind: 'renameMixin'; name: string }
  | { kind: 'confirmDeleteMixin'; name: string; appliedBy: string[] }

export function Modal(
  { title, onCancel, children }: {
    title: string; onCancel: () => void; children: React.ReactNode
  },
): React.ReactElement {
  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal-body" onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  )
}

/** One text answer. Enter submits, Escape cancels, and an empty answer cannot submit. */
export function PromptDialog(
  { title, label, initial = '', placeholder, submitLabel = 'ok', onSubmit, onCancel }: {
    title: string
    label?: string
    initial?: string
    placeholder?: string
    submitLabel?: string
    onSubmit: (value: string) => void
    onCancel: () => void
  },
): React.ReactElement {
  const [value, setValue] = React.useState(initial)
  const submit = () => { if (value.trim()) onSubmit(value.trim()) }
  return (
    <Modal title={title} onCancel={onCancel}>
      <div className="modal-row">
        {label && <label className="modal-label">{label}</label>}
        <input autoFocus value={value} placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      </div>
      <div className="modal-actions">
        <button className="primary" disabled={!value.trim()} onClick={submit}>{submitLabel}</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    </Modal>
  )
}

export function ConfirmDialog(
  { title, message, confirmLabel = 'delete', onConfirm, onCancel }: {
    title: string; message: string; confirmLabel?: string
    onConfirm: () => void; onCancel: () => void
  },
): React.ReactElement {
  return (
    <Modal title={title} onCancel={onCancel}>
      <p className="modal-text">{message}</p>
      <div className="modal-actions">
        <button className="danger" autoFocus onClick={onConfirm}>{confirmLabel}</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    </Modal>
  )
}

/** A property's name and scalar type. */
export function PropertyDialog(
  { owner, scalars, onSubmit, onCancel }: {
    owner: string
    scalars: WireScalar[]
    onSubmit: (name: string, type: string) => void
    onCancel: () => void
  },
): React.ReactElement {
  const [name, setName] = React.useState('')
  const [type, setType] = React.useState('string')
  const submit = () => { if (name.trim()) onSubmit(name.trim(), type) }
  return (
    <Modal title={`New property on ${owner}`} onCancel={onCancel}>
      <div className="modal-row">
        <input autoFocus placeholder="propertyName" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {scalars.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
      </div>
      <div className="modal-actions">
        <button className="primary" disabled={!name.trim()} onClick={submit}>add</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    </Modal>
  )
}

/**
 * An edge type between two existing node types. The endpoints are dropdowns rather than
 * free text, so an edge cannot be authored against a type that does not exist.
 */
export function EdgeDialog(
  { nodes, from, to, onSubmit, onCancel }: {
    nodes: WireNode[]
    from: string
    to: string
    onSubmit: (name: string, from: string, to: string) => void
    onCancel: () => void
  },
): React.ReactElement {
  const [name, setName] = React.useState('')
  const [source, setSource] = React.useState(from || nodes[0]?.name || '')
  const [target, setTarget] = React.useState(to || nodes[1]?.name || nodes[0]?.name || '')
  const valid = name.trim() !== '' && source !== '' && target !== ''
  const submit = () => { if (valid) onSubmit(name.trim(), source, target) }
  return (
    <Modal title="New edge type" onCancel={onCancel}>
      <div className="modal-row">
        <input autoFocus placeholder="EDGE_NAME" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      </div>
      <div className="modal-row">
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {nodes.map((n) => <option key={n.id} value={n.name}>{n.name}</option>)}
        </select>
        <span className="modal-arrow">→</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {nodes.map((n) => <option key={n.id} value={n.name}>{n.name}</option>)}
        </select>
      </div>
      <div className="modal-actions">
        <button className="primary" disabled={!valid} onClick={submit}>add</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    </Modal>
  )
}

/**
 * The target of a dropped connection does not exist: name it and the edge in one step,
 * so drawing outwards from a box creates the type it points at.
 */
export function EdgeToNewNodeDialog(
  { from, onSubmit, onCancel }: {
    from: string
    onSubmit: (nodeName: string, edgeName: string) => void
    onCancel: () => void
  },
): React.ReactElement {
  const [nodeName, setNodeName] = React.useState('')
  const [edgeName, setEdgeName] = React.useState('')
  const valid = nodeName.trim() !== '' && edgeName.trim() !== ''
  const submit = () => { if (valid) onSubmit(nodeName.trim(), edgeName.trim()) }
  return (
    <Modal title={`New node type from ${from}`} onCancel={onCancel}>
      <div className="modal-row">
        <label className="modal-label">Node type</label>
        <input autoFocus placeholder="TypeName" value={nodeName}
          onChange={(e) => setNodeName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      </div>
      <div className="modal-row">
        <label className="modal-label">Edge</label>
        <input placeholder="EDGE_NAME" value={edgeName}
          onChange={(e) => setEdgeName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      </div>
      <p className="modal-text">
        {from} → {nodeName.trim() || 'the new type'}
      </p>
      <div className="modal-actions">
        <button className="primary" disabled={!valid} onClick={submit}>create</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    </Modal>
  )
}
