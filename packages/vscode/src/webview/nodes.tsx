import * as React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { displayType, type WireProperty } from '../protocol'

/**
 * Where the way back of a loop attaches: just below the side's own handle, so a type
 * joined to itself shows two arrows rather than one line with a head at each end.
 */
function LoopHandles(): React.ReactElement {
  return (
    <>
      <Handle type="source" id="l-lo" position={Position.Left} isConnectable={false}
        className="erd-handle erd-handle-lo" />
      <Handle type="source" id="r-lo" position={Position.Right} isConnectable={false}
        className="erd-handle erd-handle-lo" />
    </>
  )
}

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
 * An ERD box: one row per property, and a handle on each side. A connection may be
 * dragged from either, and a connector attaches to whichever side faces the box at its
 * other end. See lat.md/architecture#Rendering.
 */
export function ErdNode({ data }: NodeProps): React.ReactElement {
  const d = data as unknown as ErdNodeData
  return (
    <div className={`erd erd-node${d.abstract ? ' erd-abstract' : ''}`}>
      <Handle type="source" id="l" position={Position.Left} className="erd-handle" />
      <div className="erd-title">
        <button
          className="erd-name"
          title={d.abstract ? 'Abstract: no instances of its own. Click to rename.' : 'Rename this type'}
          onClick={() => d.onRename(d.name)}
          onDoubleClick={() => d.onRename(d.name)}
        >
          {d.name}
        </button>
        {d.abstract && (
          <span className="erd-badge erd-abstract-badge"
            title="Abstract: no instances of its own; its concrete subtypes have them">«abstract»</span>
        )}
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
          <PropertyRow key={p.id} p={p} owner={d.name}
            onToggleKey={d.onToggleKey}
            onRename={d.onRenameProperty} onDelete={d.onDeleteProperty} />
        ))}
      </div>
      <button className="erd-add" onClick={() => d.onAddProperty(d.name)}>+ property</button>
      <Handle type="source" id="r" position={Position.Right} className="erd-handle" />
      <LoopHandles />
    </div>
  )
}

/**
 * One property row. A node type's row carries the key toggle; an edge type has no key,
 * so its rows leave that column out.
 */
function PropertyRow({ p, owner, onToggleKey, onRename, onDelete }: {
  p: WireProperty
  owner: string
  onToggleKey?: (owner: string, prop: string, isKey: boolean) => void
  onRename: (owner: string, prop: string) => void
  onDelete: (owner: string, prop: string) => void
}): React.ReactElement {
  return (
    <div className={`erd-row${p.inheritedFrom ? ' erd-inherited' : ''}`}>
      {onToggleKey && (
        <button
          className={`erd-key${p.isKey ? ' on' : ''}`}
          title={p.isKey ? 'Key property — click to clear' : 'Make this the key'}
          onClick={() => onToggleKey(owner, p.name, p.isKey)}
        >
          {p.isKey ? '🔑' : '○'}
        </button>
      )}
      {p.inheritedFrom
        ? <span className="erd-prop">{p.name}</span>
        : (
          <button className="erd-prop erd-prop-edit" title="Rename this property"
            onClick={() => onRename(owner, p.name)}>{p.name}</button>
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
            onClick={() => onDelete(owner, p.name)}>×</button>
        )}
    </div>
  )
}

export interface EdgeBoxData extends Record<string, unknown> {
  name: string
  from: string
  to: string
  /** Endpoint multiplicity, shown only when it constrains anything. */
  cardinality?: { from: string; to: string }
  /** Which ends are abstract node types; either makes the edge type abstract. */
  fromAbstract: boolean
  toAbstract: boolean
  props: WireProperty[]
  onAddProperty: (owner: string) => void
  onDeleteProperty: (owner: string, prop: string) => void
  onRenameProperty: (owner: string, prop: string) => void
  onDelete: (name: string) => void
}

/**
 * An edge type drawn as a box of its own, between the connectors that run into it from
 * its from type and out of it to its to type. Its shape, badge and endpoint line tell it
 * from a node type box without relying on color. Its handles are anchors only: a
 * connection dragged onto it would be an edge on an edge. See
 * lat.md/architecture#Rendering#Edge boxes.
 */
export function EdgeBox({ data }: NodeProps): React.ReactElement {
  const d = data as unknown as EdgeBoxData
  const abstract = d.fromAbstract || d.toAbstract
  const end = (name: string, isAbstract: boolean) =>
    isAbstract ? <span className="erd-end-abstract">{name}</span> : name
  return (
    <div className={`erd erd-edge${abstract ? ' erd-abstract' : ''}`}>
      <Handle type="source" id="l" position={Position.Left} className="erd-handle" isConnectable={false} />
      <div className="erd-title">
        <span className="erd-badge erd-kind-edge">edge</span>
        <span className="erd-edge-name" title="Select to rename in the inspector">{d.name}</span>
        {abstract && (
          <span className="erd-badge erd-abstract-badge"
            title={`Abstract: realised once per concrete subtype of ${
              [d.fromAbstract ? d.from : '', d.toAbstract ? d.to : ''].filter(Boolean).join(' and ')}`}>
            «abstract»
          </span>
        )}
        <span className="erd-title-spacer" />
        <button className="erd-x" title="Delete edge type" onClick={() => d.onDelete(d.name)}>×</button>
      </div>
      <div className="erd-ends" title={`${d.name} runs from ${d.from} to ${d.to}`}>
        {end(d.from, d.fromAbstract)} → {end(d.to, d.toAbstract)}
        {d.cardinality && (
          <span className="erd-card" title="cardinality: from → to">
            [{d.cardinality.from} → {d.cardinality.to}]
          </span>
        )}
      </div>
      <div className="erd-rows">
        {d.props.map((p) => (
          <PropertyRow key={p.id} p={p} owner={d.name}
            onRename={d.onRenameProperty} onDelete={d.onDeleteProperty} />
        ))}
      </div>
      <button className="erd-add" onClick={() => d.onAddProperty(d.name)}>+ property</button>
      <Handle type="source" id="r" position={Position.Right} className="erd-handle" isConnectable={false} />
      <LoopHandles />
    </div>
  )
}
