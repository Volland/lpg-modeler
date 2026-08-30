import * as React from 'react'
import type { Intent, WireNode, WireProperty } from '../protocol'

/**
 * The panel beside the canvas. Value constraints and named constraints have no place
 * on a diagram box without crowding it, so they live here; the canvas shows only that
 * a type carries some. See lat.md/architecture#Editing Surface#Inspector.
 */

const FACETS = ['min', 'max', 'minLength', 'maxLength', 'pattern'] as const
type Facet = (typeof FACETS)[number]

/** Which facets suit which type: a pattern on an int would never be enforced. */
function facetsFor(type: string): readonly Facet[] {
  const t = type.toLowerCase()
  if (t === 'string') return ['minLength', 'maxLength', 'pattern']
  if (['int', 'float', 'date', 'datetime'].includes(t)) return ['min', 'max']
  return []
}

function PropertyFacets(
  { node, prop, emit }: { node: WireNode; prop: WireProperty; emit: (i: Intent) => void },
): React.ReactElement | null {
  const facets = facetsFor(prop.type)
  if (facets.length === 0 || prop.inheritedFrom) return null
  return (
    <div className="insp-prop">
      <div className="insp-prop-name">{prop.name}<span className="insp-dim"> {prop.type}</span></div>
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
                  owner: node.name, ownerKind: 'nodes', prop: prop.name, facet: f,
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
    const assertion = comparison
      ? `{ ${kind}: [${left}, ${right}] }`
      : `{ ${kind}: [${left}, ${right}] }`
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

export function Inspector(
  { node, emit }: { node: WireNode | undefined; emit: (i: Intent) => void },
): React.ReactElement {
  const [adding, setAdding] = React.useState(false)
  React.useEffect(() => { setAdding(false) }, [node?.id])

  if (!node) {
    return (
      <aside className="inspector">
        <div className="insp-empty">Select a type to edit its constraints.</div>
      </aside>
    )
  }
  const constrainable = node.props.filter(
    (p) => !p.inheritedFrom && facetsFor(p.type).length > 0)

  return (
    <aside className="inspector">
      <h2 className="insp-title">{node.name}</h2>

      <h3 className="insp-h">Value constraints</h3>
      {constrainable.length === 0
        ? <div className="insp-empty">No property here takes a bound.</div>
        : constrainable.map((p) => (
          <PropertyFacets key={p.id} node={node} prop={p} emit={emit} />
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
    </aside>
  )
}
