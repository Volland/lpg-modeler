import * as React from 'react'
import {
  displayType,
  type Intent, type OwnerKind, type WireEdge, type WireMixin, type WireNode,
  type WireProperty, type WireScalar,
} from '../protocol'
import type { Dialog } from './dialogs'

/**
 * The panel beside the canvas. It holds what a type is — its name, whether it is
 * abstract, what it extends — together with the constraints that have no place on a
 * diagram box without crowding it. The canvas shows only that a type carries some.
 * See lat.md/architecture#Editing Surface#Inspector.
 */

const FACETS = ['min', 'max', 'minLength', 'maxLength', 'pattern'] as const
type Facet = (typeof FACETS)[number]

/**
 * Which facets suit which type: a pattern on an int would never be enforced. The host
 * says which is which, so the panel cannot disagree with what validation enforces.
 */
function facetsFor(type: string, scalars: WireScalar[]): readonly Facet[] {
  const kind = scalars.find((s) => s.name === type.toLowerCase())?.facets
  if (kind === 'text') return ['minLength', 'maxLength', 'pattern']
  if (kind === 'ordered') return ['min', 'max']
  return []
}

/**
 * A field that commits on Enter or on blur and reverts on Escape. Committing per
 * keystroke would rewrite the model file on every letter typed.
 */
function TextField(
  { value, placeholder, onCommit }: {
    value: string; placeholder?: string; onCommit: (next: string) => void
  },
): React.ReactElement {
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => { setDraft(value) }, [value])
  const commit = () => {
    const next = draft.trim()
    if (next === value) return
    if (next === '') { setDraft(value); return }
    onCommit(next)
  }
  return (
    <input
      className="insp-input"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(value)
      }}
    />
  )
}

function PropertyFacets(
  { owner, ownerKind, prop, scalars, emit }: {
    owner: string
    ownerKind: OwnerKind
    prop: WireProperty
    scalars: WireScalar[]
    emit: (i: Intent) => void
  },
): React.ReactElement | null {
  const facets = facetsFor(prop.type, scalars)
  if (facets.length === 0 || prop.inheritedFrom) return null
  return (
    <div className="insp-prop">
      <div className="insp-prop-name">{prop.name}<span className="insp-dim"> {displayType(prop)}</span></div>
      <div className="insp-facets">
        {facets.map((f) => (
          <label key={f} className="insp-facet">
            <span>{f}</span>
            <input
              type="text"
              defaultValue={prop[f] === undefined ? '' : String(prop[f])}
              placeholder="—"
              onBlur={(e) => {
                const raw = e.target.value.trim()
                const current = prop[f] === undefined ? '' : String(prop[f])
                if (raw === current) return
                emit({
                  kind: 'setPropertyFacet',
                  owner, ownerKind, prop: prop.name, facet: f,
                  ...(raw === '' ? {} : { value: raw }),
                })
              }}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * The constraint builder. Every operand comes from a dropdown of what the type
 * actually has, which is only possible because the assertion vocabulary is closed.
 */
function AddConstraint(
  { node, emit, done }: { node: WireNode; emit: (i: Intent) => void; done: () => void },
): React.ReactElement {
  const propNames = node.props.map((p) => p.name)
  const [name, setName] = React.useState('')
  const [kind, setKind] = React.useState('lessThan')
  const [left, setLeft] = React.useState(propNames[0] ?? '')
  const [right, setRight] = React.useState(propNames[1] ?? propNames[0] ?? '')
  const [message, setMessage] = React.useState('')

  const comparison = ['lessThan', 'lessThanOrEquals', 'equals', 'disjoint'].includes(kind)
  const choice = kind === 'atLeastOne' || kind === 'exactlyOne'
  const valid = name.trim() !== '' && left !== '' && right !== '' && left !== right

  const submit = () => {
    // Rendered as inline YAML, which is what the model file uses for a short mapping.
    const assertion = `{ ${kind}: [${left}, ${right}] }`
    emit({
      kind: 'addConstraint', owner: node.name, name: name.trim(), assertion,
      ...(message.trim() ? { message: message.trim() } : {}),
    })
    done()
  }

  return (
    <div className="insp-add">
      <input placeholder="constraint name" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="lessThan">lessThan</option>
        <option value="lessThanOrEquals">lessThanOrEquals</option>
        <option value="equals">equals</option>
        <option value="disjoint">disjoint</option>
        <option value="atLeastOne">atLeastOne</option>
        <option value="exactlyOne">exactlyOne</option>
      </select>
      <div className="insp-operands">
        <select value={left} onChange={(e) => setLeft(e.target.value)}>
          {propNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="insp-dim">{comparison ? 'vs' : choice ? 'and' : ''}</span>
        <select value={right} onChange={(e) => setRight(e.target.value)}>
          {propNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <input placeholder="message (optional)" value={message}
        onChange={(e) => setMessage(e.target.value)} />
      <div className="insp-actions">
        <button disabled={!valid} onClick={submit}>add</button>
        <button onClick={done}>cancel</button>
      </div>
    </div>
  )
}

/**
 * The mixins a type applies, as checkboxes over every mixin the model declares. A mixin
 * is a bag of properties rather than a supertype, so applying one is a set membership
 * and not a parent. See lat.md/metamodel#Type Hierarchy#Mixins.
 */
function MixinChecklist(
  { node, mixins, emit, ask, select }: {
    node: WireNode
    mixins: WireMixin[]
    emit: (i: Intent) => void
    ask: (d: Dialog) => void
    select: (id: string) => void
  },
): React.ReactElement {
  const toggle = (name: string, on: boolean) => {
    const next = on
      ? [...node.mixins, name]
      : node.mixins.filter((m) => m !== name)
    emit({ kind: 'setMixins', name: node.name, mixins: next })
  }
  return (
    <>
      <h3 className="insp-h">Mixins</h3>
      {mixins.length === 0
        ? <div className="insp-empty">This model declares none.</div>
        : mixins.map((m) => (
          <label key={m.id} className="insp-check">
            <input type="checkbox" checked={node.mixins.includes(m.name)}
              onChange={(e) => toggle(m.name, e.target.checked)} />
            <button className="insp-link" onClick={() => select(m.id)}>{m.name}</button>
            <span className="insp-dim">{m.props.length} prop(s)</span>
          </label>
        ))}
      <button className="erd-add" onClick={() => ask({ kind: 'newMixin' })}>+ mixin</button>
    </>
  )
}

/**
 * Every edge this type can take part in, including those declared on an ancestor. An
 * inherited edge is not drawn on the subtype's box — it is declared on the parent, and
 * the diagram says where a thing is written — so this is where a subtype's full reach
 * is legible. See lat.md/architecture#Rendering#Inherited edges.
 */
function EdgeList(
  { node, edges, select }: {
    node: WireNode; edges: WireEdge[]; select: (id: string) => void
  },
): React.ReactElement {
  const reach = new Set([node.name, ...node.ancestors])
  interface Reach { edge: WireEdge; out: boolean; declaredOn?: string }
  const touching = edges.flatMap((e): Reach[] => {
    const out = reach.has(e.from)
    if (!out && !reach.has(e.to)) return []
    const end = out ? e.from : e.to
    return [{ edge: e, out, ...(end === node.name ? {} : { declaredOn: end }) }]
  })

  return (
    <>
      <h3 className="insp-h">Edges</h3>
      {touching.length === 0 && <div className="insp-empty">None reach this type.</div>}
      {touching.map(({ edge, out, declaredOn }) => (
        <div key={edge.id} className="insp-edge">
          <button className="insp-link" onClick={() => select(edge.id)}>{edge.name}</button>
          <span className="insp-dim">{out ? `→ ${edge.to}` : `← ${edge.from}`}</span>
          {declaredOn && (
            <span className="insp-inherited" title={`declared on ${declaredOn}`}>↑{declaredOn}</span>
          )}
        </div>
      ))}
    </>
  )
}

/** What a node type is: its name, whether it is abstract, and what it extends. */
function NodeIdentity(
  { node, nodes, emit }: { node: WireNode; nodes: WireNode[]; emit: (i: Intent) => void },
): React.ReactElement {
  // A type cannot extend itself, and a name the active view does not show is still a
  // valid parent, so the current value is always offered.
  const parents = nodes.map((n) => n.name).filter((n) => n !== node.name)
  const options = node.extends && !parents.includes(node.extends)
    ? [node.extends, ...parents]
    : parents
  return (
    <>
      <h3 className="insp-h">Type</h3>
      <label className="insp-field">
        <span>Name</span>
        <TextField value={node.name}
          onCommit={(to) => emit({ kind: 'renameNode', from: node.name, to })} />
      </label>
      <label className="insp-field">
        <span>Extends</span>
        <select className="insp-input" value={node.extends ?? ''}
          onChange={(e) => emit({
            kind: 'setAbstractParent', name: node.name,
            parent: e.target.value === '' ? undefined : e.target.value,
          })}>
          <option value="">— none —</option>
          {options.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="insp-check">
        <input type="checkbox" checked={node.abstract}
          onChange={(e) => emit({ kind: 'setAbstract', name: node.name, abstract: e.target.checked })} />
        <span>Abstract — no instances of its own</span>
      </label>
    </>
  )
}

/**
 * The selected edge type. Cardinality belongs to the relationship rather than to either
 * type, which is why it is edited here and not on a box. See lat.md/metamodel#Cardinality.
 */
function EdgeInspector(
  { edge, nodes, scalars, emit, ask }: {
    edge: WireEdge
    nodes: WireNode[]
    scalars: WireScalar[]
    emit: (i: Intent) => void
    ask: (d: Dialog) => void
  },
): React.ReactElement {
  const names = nodes.map((n) => n.name)
  const endpoints = (current: string) => (names.includes(current) ? names : [current, ...names])
  const setBound = (which: 'from' | 'to', raw: string) => {
    const next = { from: edge.cardinality.from, to: edge.cardinality.to, [which]: raw }
    emit({ kind: 'setCardinality', name: edge.name, from: next.from, to: next.to })
  }
  return (
    <aside className="inspector">
      <h2 className="insp-title">{edge.name}<span className="insp-dim"> edge</span></h2>

      <h3 className="insp-h">Type</h3>
      <label className="insp-field">
        <span>Name</span>
        <TextField value={edge.name}
          onCommit={(to) => emit({ kind: 'renameEdge', from: edge.name, to })} />
      </label>
      <label className="insp-field">
        <span>From</span>
        <select className="insp-input" value={edge.from}
          onChange={(e) => emit({
            kind: 'setEndpoint', name: edge.name, which: 'from', target: e.target.value,
          })}>
          {endpoints(edge.from).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="insp-field">
        <span>To</span>
        <select className="insp-input" value={edge.to}
          onChange={(e) => emit({
            kind: 'setEndpoint', name: edge.name, which: 'to', target: e.target.value,
          })}>
          {endpoints(edge.to).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>

      <h3 className="insp-h">Cardinality</h3>
      <label className="insp-field">
        <span>Sources</span>
        <TextField value={edge.cardinality.from} onCommit={(v) => setBound('from', v)} />
      </label>
      <label className="insp-field">
        <span>Targets</span>
        <TextField value={edge.cardinality.to} onCommit={(v) => setBound('to', v)} />
      </label>
      <div className="insp-dim">
        <code>*</code> any, <code>2</code> exactly two, <code>1..2</code> a range,
        {' '}<code>1..*</code> at least one. Reads as {edge.cardinality.label}.
      </div>

      <h3 className="insp-h">Properties</h3>
      {edge.props.length === 0 && <div className="insp-empty">None.</div>}
      {edge.props.map((p) => (
        <div key={p.id} className="insp-c-head">
          <span>{p.name}<span className="insp-dim"> {displayType(p)}</span></span>
          <button className="erd-x" title="Delete property"
            onClick={() => emit({
              kind: 'deleteProperty', owner: edge.name, ownerKind: 'edges', name: p.name,
            })}>×</button>
        </div>
      ))}
      <button className="erd-add"
        onClick={() => ask({ kind: 'addProperty', owner: edge.name, ownerKind: 'edges' })}>
        + property
      </button>

      {edge.props.some((p) => facetsFor(p.type, scalars).length > 0) && (
        <>
          <h3 className="insp-h">Value constraints</h3>
          {edge.props.map((p) => (
            <PropertyFacets key={p.id} owner={edge.name} ownerKind="edges" prop={p}
              scalars={scalars} emit={emit} />
          ))}
        </>
      )}

      <button className="insp-danger"
        onClick={() => ask({ kind: 'confirmDeleteEdge', name: edge.name })}>
        Delete edge type
      </button>
    </aside>
  )
}

/**
 * A selected mixin. Editing one edits every type that applies it at once, so the panel
 * says which those are before it offers a delete.
 */
function MixinInspector(
  { mixin, scalars, emit, ask, select }: {
    mixin: WireMixin
    scalars: WireScalar[]
    emit: (i: Intent) => void
    ask: (d: Dialog) => void
    select: (id: string | undefined) => void
  },
): React.ReactElement {
  return (
    <aside className="inspector">
      <h2 className="insp-title">◇ {mixin.name}<span className="insp-dim"> mixin</span></h2>
      <div className="insp-dim">
        A bag of properties. Applying it copies them into a type; it declares no supertype
        and no identity of its own.
      </div>

      <h3 className="insp-h">Name</h3>
      <TextField value={mixin.name}
        onCommit={(to) => emit({ kind: 'renameMixin', from: mixin.name, to })} />

      <h3 className="insp-h">Properties</h3>
      {mixin.props.length === 0 && <div className="insp-empty">None yet.</div>}
      {mixin.props.map((p) => (
        <div key={p.id} className="insp-c-head">
          <button className="insp-link" title="Rename this property"
            onClick={() => ask({
              kind: 'renameProperty', owner: mixin.name, ownerKind: 'mixins', name: p.name,
            })}>{p.name}</button>
          <span className="insp-dim">{displayType(p)}</span>
          <button className="erd-x" title="Delete property"
            onClick={() => emit({
              kind: 'deleteProperty', owner: mixin.name, ownerKind: 'mixins', name: p.name,
            })}>×</button>
        </div>
      ))}
      <button className="erd-add"
        onClick={() => ask({ kind: 'addProperty', owner: mixin.name, ownerKind: 'mixins' })}>
        + property
      </button>

      {mixin.props.some((p) => facetsFor(p.type, scalars).length > 0) && (
        <>
          <h3 className="insp-h">Value constraints</h3>
          {mixin.props.map((p) => (
            <PropertyFacets key={p.id} owner={mixin.name} ownerKind="mixins" prop={p}
              scalars={scalars} emit={emit} />
          ))}
        </>
      )}

      <h3 className="insp-h">Applied by</h3>
      {mixin.appliedBy.length === 0
        ? (
          <div className="insp-empty">
            No type applies it, so it reaches no generated artifact.
          </div>
        )
        : <div>{mixin.appliedBy.join(', ')}</div>}

      <button className="insp-danger"
        onClick={() => {
          ask({ kind: 'confirmDeleteMixin', name: mixin.name, appliedBy: mixin.appliedBy })
          select(undefined)
        }}>
        Delete mixin
      </button>
    </aside>
  )
}

export function Inspector(
  { node, edge, mixin, nodes, edges, mixins, scalars, emit, ask, select }: {
    node: WireNode | undefined
    edge: WireEdge | undefined
    mixin: WireMixin | undefined
    nodes: WireNode[]
    edges: WireEdge[]
    mixins: WireMixin[]
    scalars: WireScalar[]
    emit: (i: Intent) => void
    ask: (d: Dialog) => void
    select: (id: string | undefined) => void
  },
): React.ReactElement {
  const [adding, setAdding] = React.useState(false)
  React.useEffect(() => { setAdding(false) }, [node?.id, edge?.id, mixin?.id])

  if (mixin && !node) {
    return <MixinInspector mixin={mixin} scalars={scalars} emit={emit} ask={ask} select={select} />
  }

  if (edge && !node) {
    return <EdgeInspector edge={edge} nodes={nodes} scalars={scalars} emit={emit} ask={ask} />
  }

  if (!node) {
    // Nothing selected is the one place a mixin nothing applies is reachable, so the
    // empty panel is the model's own overview rather than a blank.
    return (
      <aside className="inspector">
        <div className="insp-empty">Select a type, an edge or a mixin to edit it.</div>
        <h3 className="insp-h">Mixins</h3>
        {mixins.length === 0
          ? <div className="insp-empty">None declared.</div>
          : mixins.map((m) => (
            <div key={m.id} className="insp-edge">
              <button className="insp-link" onClick={() => select(m.id)}>◇{m.name}</button>
              <span className="insp-dim">
                {m.appliedBy.length === 0 ? 'applied by nothing' : m.appliedBy.join(', ')}
              </span>
            </div>
          ))}
        <button className="erd-add" onClick={() => ask({ kind: 'newMixin' })}>+ mixin</button>
      </aside>
    )
  }
  const constrainable = node.props.filter(
    (p) => !p.inheritedFrom && facetsFor(p.type, scalars).length > 0)

  return (
    <aside className="inspector">
      <h2 className="insp-title">{node.name}</h2>

      <NodeIdentity node={node} nodes={nodes} emit={emit} />

      <MixinChecklist node={node} mixins={mixins} emit={emit} ask={ask} select={select} />

      <EdgeList node={node} edges={edges} select={select} />

      <h3 className="insp-h">Value constraints</h3>
      {constrainable.length === 0
        ? <div className="insp-empty">No property here takes a bound.</div>
        : constrainable.map((p) => (
          <PropertyFacets key={p.id} owner={node.name} ownerKind="nodes" prop={p}
            scalars={scalars} emit={emit} />
        ))}

      <h3 className="insp-h">Constraints</h3>
      {node.constraints.length === 0 && !adding && (
        <div className="insp-empty">None.</div>
      )}
      {node.constraints.map((k) => (
        <div key={k.id} className="insp-constraint">
          <div className="insp-c-head">
            <span className="insp-c-name">{k.name}</span>
            <button className="erd-x" title="Delete constraint"
              onClick={() => emit({ kind: 'deleteConstraint', owner: node.name, name: k.name })}>
              ×
            </button>
          </div>
          <div className="insp-dim">{k.summary}</div>
          {k.message && <div className="insp-msg">“{k.message}”</div>}
        </div>
      ))}
      {adding
        ? <AddConstraint node={node} emit={emit} done={() => setAdding(false)} />
        : <button className="erd-add" onClick={() => setAdding(true)}>+ constraint</button>}

      {node.hasRawShacl && (
        <div className="insp-raw">
          Carries a raw SHACL fragment. Only the <code>shacl</code> target uses it; every
          other target reports that it ignored it. Edit it in the model file.
        </div>
      )}

      <button className="insp-danger"
        onClick={() => ask({ kind: 'confirmDeleteNode', name: node.name })}>
        Delete node type
      </button>
    </aside>
  )
}
