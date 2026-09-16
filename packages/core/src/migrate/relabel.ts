import type { ModelIR, NodeTypeIR } from '../ir'

/**
 * The data a labelled-graph target has to rewrite for a migration, worked out once for
 * Neo4j, FalkorDB and Memgraph alike. All three carry a hierarchy as labels, so a node of a subtype
 * also carries every ancestor's label, and one statement over a label reaches every
 * type that inherits it. See lat.md/emitters#Migrations#Target Planners.
 *
 * Steps are listed in the order they must run:
 * 1. deletions, by the names the data has before anything is renamed, so a type renamed
 *    to a removed type's name is not deleted along with it;
 * 2. label renames, so everything after addresses the new names;
 * 3. ancestor labels gained or lost by a changed hierarchy;
 * 4. property and relationship-type renames.
 */
export type DataStep =
  | { kind: 'delete-nodes'; label: string; except: string[]; element: string }
  | { kind: 'delete-edges'; type: string; element: string }
  | { kind: 'relabel'; from: string; to: string; element: string }
  | { kind: 'add-label'; on: string; label: string; element: string }
  | { kind: 'remove-label'; on: string; label: string; element: string }
  | { kind: 'rename-node-property'; label: string; from: string; to: string; element: string }
  | { kind: 'rename-edge-property'; type: string; from: string; to: string; element: string }
  | { kind: 'retype-edges'; from: string; to: string; element: string }

const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]))

export function dataSteps(before: ModelIR, after: ModelIR): DataStep[] {
  const steps: DataStep[] = []
  const nodesB = byId(before.nodes)
  const nodesA = byId(after.nodes)
  const edgesB = byId(before.edges)
  const edgesA = byId(after.edges)
  const nameAfterOrBefore = (m: ModelIR, name: string): string => {
    const id = m.nodes.find((n) => n.name === name)?.id
    return (id && nodesA.get(id)?.name) ?? name
  }

  // 1. Deletions. A removed concrete type loses its nodes, but not the nodes of a subtype
  // that still exists and carries its label as an ancestor.
  for (const e of before.edges) {
    if (!edgesA.has(e.id)) steps.push({ kind: 'delete-edges', type: e.name, element: `edge ${e.name}` })
  }
  for (const n of before.nodes) {
    if (n.abstract) continue
    const gone = !nodesA.has(n.id) || nodesA.get(n.id)!.abstract
    if (!gone) continue
    const except = before.nodes
      .filter((d) => d.ancestors.includes(n.name) && nodesA.has(d.id) && !nodesA.get(d.id)!.abstract)
      .map((d) => d.name)
    steps.push({ kind: 'delete-nodes', label: n.name, except, element: `node ${n.name}` })
  }

  // 2. Label renames, abstract types included: their label is carried by every subtype.
  for (const b of before.nodes) {
    const a = nodesA.get(b.id)
    if (a && a.name !== b.name) steps.push({ kind: 'relabel', from: b.name, to: a.name, element: `node ${a.name}` })
  }

  // 3. Ancestor labels, compared by id so a renamed ancestor is not a lost one.
  const ancestorIds = (m: ModelIR, n: NodeTypeIR) =>
    n.ancestors.map((name) => m.nodes.find((x) => x.name === name)?.id ?? `?${name}`)
  for (const a of after.nodes) {
    const b = nodesB.get(a.id)
    if (!b || a.abstract) continue
    const had = ancestorIds(before, b)
    const has = ancestorIds(after, a)
    for (const id of has) {
      if (had.includes(id)) continue
      steps.push({ kind: 'add-label', on: a.name, label: nodesA.get(id)?.name ?? id, element: `node ${a.name}` })
    }
    for (const id of had) {
      if (has.includes(id)) continue
      const old = nodesB.get(id)!
      steps.push({ kind: 'remove-label', on: a.name, label: nameAfterOrBefore(before, old.name), element: `node ${a.name}` })
    }
  }

  // 4. Property renames, where each property is declared. A mixin's property is renamed
  // on every type applying the mixin; a subtype is reached through its ancestor label.
  const declaredNode = (m: ModelIR) => {
    const map = new Map<string, { name: string; labels: string[] }>()
    for (const n of m.nodes) for (const p of n.props) if (!p.inheritedFrom) map.set(p.id, { name: p.name, labels: [n.name] })
    for (const x of m.mixins) {
      const labels = m.nodes.filter((n) => n.mixins.includes(x.name)).map((n) => n.name)
      for (const p of x.props) map.set(p.id, { name: p.name, labels })
    }
    return map
  }
  const propsB = declaredNode(before)
  for (const [id, a] of declaredNode(after)) {
    const b = propsB.get(id)
    if (!b || b.name === a.name) continue
    for (const label of a.labels) {
      steps.push({ kind: 'rename-node-property', label, from: b.name, to: a.name, element: `property ${label}.${a.name}` })
    }
  }
  for (const a of after.edges) {
    const b = edgesB.get(a.id)
    if (!b) continue
    const old = byId(b.props)
    for (const p of a.props) {
      const was = old.get(p.id)
      if (was && was.name !== p.name) {
        // Properties first, under the old type name, so the copy below carries them.
        steps.push({ kind: 'rename-edge-property', type: b.name, from: was.name, to: p.name, element: `property ${a.name}.${p.name}` })
      }
    }
  }
  for (const a of after.edges) {
    const b = edgesB.get(a.id)
    if (b && b.name !== a.name) steps.push({ kind: 'retype-edges', from: b.name, to: a.name, element: `edge ${a.name}` })
  }
  return steps
}

/**
 * One Cypher statement for a step, batched where the target supports it: `true` for
 * `CALL { ... } IN TRANSACTIONS`, `{ periodicCommit }` for the `USING PERIODIC COMMIT`
 * directive, `false` for a single statement. Memgraph needs the directive: it refuses
 * `DELETE` inside `CALL ... IN TRANSACTIONS` (measured against 3.13.1).
 */
export function stepCypher(step: DataStep, batched: boolean | { periodicCommit: number }): string {
  const tx = (match: string, body: string, bound: string) => (batched === true
    ? `${match} CALL { WITH ${bound} ${body} } IN TRANSACTIONS`
    : batched
      ? `USING PERIODIC COMMIT ${batched.periodicCommit} ${match} ${body}`
      : `${match} ${body}`)
  switch (step.kind) {
    case 'delete-nodes': {
      const where = step.except.length > 0 ? ` WHERE ${step.except.map((l) => `NOT n:${l}`).join(' AND ')}` : ''
      return tx(`MATCH (n:${step.label})${where}`, 'DETACH DELETE n', 'n')
    }
    case 'delete-edges':
      return tx(`MATCH ()-[r:${step.type}]->()`, 'DELETE r', 'r')
    case 'relabel':
      return tx(`MATCH (n:${step.from})`, `SET n:${step.to} REMOVE n:${step.from}`, 'n')
    case 'add-label':
      return tx(`MATCH (n:${step.on})`, `SET n:${step.label}`, 'n')
    case 'remove-label':
      return tx(`MATCH (n:${step.on})`, `REMOVE n:${step.label}`, 'n')
    case 'rename-node-property':
      return tx(`MATCH (n:${step.label}) WHERE n.${step.from} IS NOT NULL`,
        `SET n.${step.to} = n.${step.from} REMOVE n.${step.from}`, 'n')
    case 'rename-edge-property':
      return tx(`MATCH ()-[r:${step.type}]->() WHERE r.${step.from} IS NOT NULL`,
        `SET r.${step.to} = r.${step.from} REMOVE r.${step.from}`, 'r')
    case 'retype-edges':
      return tx(`MATCH (a)-[r:${step.from}]->(b)`,
        `CREATE (a)-[r2:${step.to}]->(b) SET r2 = properties(r) DELETE r`, 'a, r, b')
  }
}

export const isDestructiveStep = (s: DataStep): boolean =>
  s.kind === 'delete-nodes' || s.kind === 'delete-edges'
