import * as React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { displayType, type WireProperty } from '../protocol'

export interface ErdNodeData extends Record<string, unknown> {
  name: string
  abstract: boolean
  open: boolean
  extendsName?: string
  /** Mixins this type applies. Shown as chips: they are not supertypes. */
  mixins: string[]
  props: WireProperty[]
  /** Named constraints plus a raw fragment, if any: the diagram shows only the count. */
  constraintCount: number
  onAddProperty: (owner: string) => void
  onDeleteProperty: (owner: string, prop: string) => void
  onRenameProperty: (owner: string, prop: string) => void
  onRename: (from: string) => void
  onToggleKey: (owner: string, prop: string, isKey: boolean) => void
  onDelete: (name: string) => void
  /** Draw an edge from this type to one that does not exist yet. */
  onStartEdge: (name: string) => void
  onSelectMixin: (name: string) => void
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
        <button
          className="erd-name"
          title="Rename this type"
          onClick={() => d.onRename(d.name)}
          onDoubleClick={() => d.onRename(d.name)}
        >
          {d.name}
        </button>
        {d.abstract && <span className="erd-badge">abstract</span>}
        {d.open && (
          <span className="erd-badge erd-open" title="Open: instances may carry undeclared properties">
            open
          </span>
        )}
        {d.extendsName && (
          <span className="erd-extends" title={`Extends ${d.extendsName}`}>▸ {d.extendsName}</span>
        )}
        {d.mixins.map((m) => (
          <button key={m} className="erd-mixin" title={`Applies mixin ${m}`}
            onClick={() => d.onSelectMixin(m)}>◇{m}</button>
        ))}
        {d.constraintCount > 0 && (
          <span className="erd-badge erd-constrained"
            title={`${d.constraintCount} constraint(s) — see the inspector`}>
            ƒ{d.constraintCount}
          </span>
        )}
        <span className="erd-title-spacer" />
        <button className="erd-x" title="New edge to a new type"
          onClick={() => d.onStartEdge(d.name)}>→</button>
        <button className="erd-x" title="Delete type" onClick={() => d.onDelete(d.name)}>×</button>
      </div>
      <div className="erd-rows">
        {d.props.length === 0 && <div className="erd-empty">no properties</div>}
        {d.props.map((p) => (
          <div key={p.id} className={`erd-row${p.inheritedFrom ? ' erd-inherited' : ''}`}>
            <button
              className={`erd-key${p.isKey ? ' on' : ''}`}
              title={p.isKey ? 'Key property — click to clear' : 'Make this the key'}
              onClick={() => d.onToggleKey(d.name, p.name, p.isKey)}
            >
              {p.isKey ? '🔑' : '○'}
            </button>
            {p.inheritedFrom
              ? <span className="erd-prop">{p.name}</span>
              : (
                <button className="erd-prop erd-prop-edit" title="Rename this property"
                  onClick={() => d.onRenameProperty(d.name, p.name)}>{p.name}</button>
              )}
            <span className="erd-type">{displayType(p)}</span>
            {p.enum && (
              <span className="erd-enum" title={`limited to enum ${p.enum}`}>≔{p.enum}</span>
            )}
            {p.required && <span className="erd-flag" title="required">!</span>}
            {p.unique && <span className="erd-flag" title="unique">u</span>}
            {p.inheritedFrom
              ? (
                <span
                  className={`erd-from${p.inheritedVia === 'mixin' ? ' erd-from-mixin' : ''}`}
                  title={p.inheritedVia === 'mixin'
                    ? `from mixin ${p.inheritedFrom}`
                    : `inherited from ${p.inheritedFrom}`}
                >
                  {p.inheritedVia === 'mixin' ? '◇' : '↑'}{p.inheritedFrom}
                </span>
              )
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
