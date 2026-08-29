import * as React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { WireProperty } from '../protocol'

export interface ErdNodeData extends Record<string, unknown> {
  name: string
  abstract: boolean
  extendsName?: string
  props: WireProperty[]
  onAddProperty: (owner: string) => void
  onDeleteProperty: (owner: string, prop: string) => void
  onRename: (from: string) => void
  onToggleKey: (owner: string, prop: string) => void
  onDelete: (name: string) => void
}

/**
 * An ERD box: one row per property, with a handle on each row so an edge can attach to
 * the property it references. See lat.md/architecture#Rendering.
 */
export function ErdNode({ data }: NodeProps): React.ReactElement {
  const d = data as unknown as ErdNodeData
  return (
    <div className={`erd${d.abstract ? ' erd-abstract' : ''}`}>
      <Handle type="target" position={Position.Left} className="erd-handle" />
      <div className="erd-title">
        <span className="erd-name" onDoubleClick={() => d.onRename(d.name)} title="Double-click to rename">
          {d.name}
        </span>
        {d.abstract && <span className="erd-badge">abstract</span>}
        {d.extendsName && <span className="erd-extends">▸ {d.extendsName}</span>}
        <button className="erd-x" title="Delete type" onClick={() => d.onDelete(d.name)}>×</button>
      </div>
      <div className="erd-rows">
        {d.props.length === 0 && <div className="erd-empty">no properties</div>}
        {d.props.map((p) => (
          <div key={p.id} className={`erd-row${p.inheritedFrom ? ' erd-inherited' : ''}`}>
            <button
              className={`erd-key${p.isKey ? ' on' : ''}`}
              title={p.isKey ? 'Key property' : 'Make this the key'}
              onClick={() => d.onToggleKey(d.name, p.name)}
            >
              {p.isKey ? '🔑' : '○'}
            </button>
            <span className="erd-prop">{p.name}</span>
            <span className="erd-type">{p.type}</span>
            {p.required && <span className="erd-flag" title="required">!</span>}
            {p.unique && <span className="erd-flag" title="unique">u</span>}
            {p.inheritedFrom
              ? <span className="erd-from" title={`inherited from ${p.inheritedFrom}`}>↑{p.inheritedFrom}</span>
              : (
                <button className="erd-x" title="Delete property"
                  onClick={() => d.onDeleteProperty(d.name, p.name)}>×</button>
              )}
          </div>
        ))}
      </div>
      <button className="erd-add" onClick={() => d.onAddProperty(d.name)}>+ property</button>
      <Handle type="source" position={Position.Right} className="erd-handle" />
    </div>
  )
}
