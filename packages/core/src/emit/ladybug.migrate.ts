import type { Diagnostic, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR } from '../ir'
import { concreteNodes, warn } from '../ir'
import { propIdentity } from '../migrate/diff'
import { destructiveNote, migrationHeader, noSchemaEffect } from '../migrate/script'
import type { Change, MigrationContext, MigrationScript, Realization } from '../migrate/types'
import {
  columnNotes, columnType, edgeColumnNotes, endpointNodePairs, isSingleKey, multiplicity,
  nodeTable, relTable, syntheticKeyColumn,
} from './ladybug'

/**
 * Plans a LadybugDB migration by diffing the tables the two revisions flatten to, not the
 * declarations: a property added to an abstract parent is one column per concrete leaf,
 * and a hierarchy or mixin change is simply columns gained or lost. Tables are matched
 * by type id and columns by property identity, so a rename is a rename.
 *
 * Statement order, and why (measured against LadybugDB 0.19.1):
 * 1. drop rel tables, and endpoint pairs that go away -- a node table referenced by a rel
 *    table cannot be dropped;
 * 2. drop node tables;
 * 3. rename tables, so a new table may take a freed name;
 * 4. alter columns: drop, rename, then add, so a column may take a freed name;
 * 5. create node tables, then rel tables and new endpoint pairs.
 *
 * A rel table never loses its last endpoint pair in place: 0.19.1 accepts the drop, and
 * the next statement against that table crashes the engine. Such a table is recreated.
 * See lat.md/emitters#Migrations#Target Planners.
 */

const C = '//'

interface RelInfo {
  edge: EdgeTypeIR
  pairs: Array<{ key: string; from: NodeTypeIR; to: NodeTypeIR }>
}

function rels(model: ModelIR): Map<string, RelInfo> {
  const out = new Map<string, RelInfo>()
  for (const edge of model.edges) {
    const pairs = endpointNodePairs(model, edge).map(([from, to]) => ({ key: `${from.id}->${to.id}`, from, to }))
    if (pairs.length > 0) out.set(edge.id, { edge, pairs })
  }
  return out
}

/** A key as the column(s) that hold it: which properties, and in what type. */
function keySignature(node: NodeTypeIR): string {
  return node.key.map((k) => {
    const p = node.props.find((x) => x.name === k)
    return p ? `${propIdentity(p)}:${columnType(p)}` : `?${k}`
  }).join(',')
}

export function migrateLadybug(
  before: ModelIR, after: ModelIR, changes: Change[], context: MigrationContext,
): MigrationScript {
  const diagnostics: Diagnostic[] = []
  const realizations: Realization[] = []
  const body: string[] = []
  let statements = 0
  const statement = (text: string, notes: string[] = []) => {
    body.push(...notes, text)
    statements++
  }
  const section = () => { if (body.length > 0 && body[body.length - 1] !== '') body.push('') }
  const realize = (label: string, message: string, loc?: PropertyIR['loc']) => {
    realizations.push({ label, message, ...(loc ? { loc } : {}) })
    diagnostics.push({ ...warn('migration-downgrade', message, loc), target: 'ladybug' })
  }

  const nodesB = new Map(concreteNodes(before).map((n) => [n.id, n]))
  const nodesA = new Map(concreteNodes(after).map((n) => [n.id, n]))
  const relsB = rels(before)
  const relsA = rels(after)
  const edgeIdsAfter = new Set(after.edges.map((e) => e.id))

  // --- Which node tables cannot be changed in place.
  const recreatedNodes = new Set<string>()
  for (const [id, a] of nodesA) {
    const b = nodesB.get(id)
    if (!b || keySignature(b) === keySignature(a)) continue
    recreatedNodes.add(id)
    realize(`node ${a.name}`,
      `LadybugDB cannot change the primary key of '${a.name}' in place, so its node table is dropped and recreated, discarding its rows and every relationship touching them.`,
      a.loc)
  }
  const nodeSurvives = (id: string) => nodesB.has(id) && nodesA.has(id) && !recreatedNodes.has(id)

  // --- Which rel tables cannot be changed in place.
  const recreatedRels = new Set<string>()
  for (const [id, a] of relsA) {
    const b = relsB.get(id)
    if (!b) continue
    const beforeKeys = new Set(b.pairs.map((p) => p.key))
    const survivors = a.pairs.filter((p) => beforeKeys.has(p.key) && nodeSurvives(p.from.id) && nodeSurvives(p.to.id))
    if (multiplicity(b.edge.cardinality) !== multiplicity(a.edge.cardinality)) {
      recreatedRels.add(id)
      realize(`edge ${a.edge.name}`,
        `LadybugDB cannot change the multiplicity of '${a.edge.name}' in place (${multiplicity(b.edge.cardinality) ?? 'none'} -> ${multiplicity(a.edge.cardinality) ?? 'none'}), so its rel table is dropped and recreated, discarding its relationships.`,
        a.edge.loc)
    } else if (survivors.length === 0) {
      recreatedRels.add(id)
      // A table losing its pairs only because a node table is recreated is already covered.
      if (!b.pairs.some((p) => recreatedNodes.has(p.from.id) || recreatedNodes.has(p.to.id))) {
        realize(`edge ${a.edge.name}`,
          `None of the endpoint pairs of '${a.edge.name}' survives, and LadybugDB cannot empty a rel table's pairs in place, so the table is dropped and recreated, discarding its relationships.`,
          a.edge.loc)
      }
    }
  }

  // --- 1. Drop rel tables, then endpoint pairs that go away.
  for (const [id, b] of relsB) {
    if (relsA.has(id) && !recreatedRels.has(id)) continue
    const why = recreatedRels.has(id) ? 'recreated, discarding its relationships'
      : edgeIdsAfter.has(id) ? 'no longer has a concrete endpoint pair, discarding its relationships'
        : 'removed, discarding its relationships'
    if (!recreatedRels.has(id) && edgeIdsAfter.has(id)) {
      realize(`edge ${b.edge.name}`, `Edge type '${b.edge.name}' no longer connects any concrete node types, so its rel table is dropped, discarding its relationships.`, b.edge.loc)
    }
    statement(`DROP TABLE ${b.edge.name};`, [destructiveNote(C, `edge ${b.edge.name}`, why)])
  }
  section()
  for (const [id, a] of relsA) {
    const b = relsB.get(id)
    if (!b || recreatedRels.has(id)) continue
    const kept = new Set(a.pairs.map((p) => p.key))
    for (const p of b.pairs) {
      const gone = !kept.has(p.key) || !nodeSurvives(p.from.id) || !nodeSurvives(p.to.id)
      if (!gone) continue
      const bothRemain = nodesA.has(p.from.id) && nodesA.has(p.to.id)
      if (bothRemain && !recreatedNodes.has(p.from.id) && !recreatedNodes.has(p.to.id)) {
        realize(`edge ${a.edge.name}`,
          `Edge type '${a.edge.name}' no longer connects ${p.from.name} to ${p.to.name}, so that endpoint pair is dropped, discarding the relationships between them.`,
          a.edge.loc)
      }
      statement(`ALTER TABLE ${b.edge.name} DROP FROM ${p.from.name} TO ${p.to.name};`,
        [destructiveNote(C, `edge ${a.edge.name}`, `endpoint pair ${p.from.name} -> ${p.to.name} dropped, discarding its relationships`)])
    }
  }
  section()

  // --- 2. Drop node tables.
  for (const [id, b] of nodesB) {
    if (nodesA.has(id) && !recreatedNodes.has(id)) continue
    const why = recreatedNodes.has(id) ? 'recreated to change its primary key, discarding its rows'
      : after.nodes.some((n) => n.id === id) ? 'no longer a concrete type, discarding its rows'
        : 'removed, discarding its rows'
    const notes = [destructiveNote(C, `node ${b.name}`, why)]
    if (recreatedNodes.has(id)) notes.unshift(`${C} DOWNGRADE: LadybugDB cannot change a primary key in place.`)
    statement(`DROP TABLE ${b.name};`, notes)
  }
  section()

  // --- 3. Renames. A swap of two names goes through a temporary name.
  const renames: Array<[string, string]> = []
  for (const [id, a] of nodesA) {
    const b = nodesB.get(id)
    if (b && !recreatedNodes.has(id) && b.name !== a.name) renames.push([b.name, a.name])
  }
  for (const [id, a] of relsA) {
    const b = relsB.get(id)
    if (b && !recreatedRels.has(id) && b.edge.name !== a.edge.name) renames.push([b.edge.name, a.edge.name])
  }
  const froms = new Set(renames.map(([f]) => f))
  const deferred: Array<[string, string]> = []
  for (const [from, to] of renames) {
    if (froms.has(to)) {
      const tmp = `_lpg_rename_${from}`
      statement(`ALTER TABLE ${from} RENAME TO ${tmp};`)
      deferred.push([tmp, to])
    } else {
      statement(`ALTER TABLE ${from} RENAME TO ${to};`)
    }
  }
  for (const [tmp, to] of deferred) statement(`ALTER TABLE ${tmp} RENAME TO ${to};`)
  section()

  // --- 4. Columns of tables kept in place.
  const alterColumns = (
    table: string, propsB: PropertyIR[], propsA: PropertyIR[], notesFor: (p: PropertyIR) => string[],
  ) => {
    const byB = new Map(propsB.map((p) => [propIdentity(p), p]))
    const byA = new Map(propsA.map((p) => [propIdentity(p), p]))
    for (const [ident, p] of byB) {
      if (byA.has(ident)) continue
      statement(`ALTER TABLE ${table} DROP ${p.name};`,
        [destructiveNote(C, `property ${table}.${p.name}`, 'column dropped, discarding its values')])
    }
    const retyped: Array<[PropertyIR, PropertyIR]> = []
    for (const [ident, a] of byA) {
      const b = byB.get(ident)
      if (!b) continue
      if (columnType(b) !== columnType(a)) { retyped.push([b, a]); continue }
      if (b.name !== a.name) statement(`ALTER TABLE ${table} RENAME ${b.name} TO ${a.name};`)
    }
    for (const [b, a] of retyped) {
      realize(`property ${table}.${a.name}`,
        `LadybugDB cannot change the type of '${table}.${a.name}' in place (${columnType(b)} -> ${columnType(a)}), so the column is dropped and added again, discarding its values.`,
        a.loc)
      statement(`ALTER TABLE ${table} DROP ${b.name};`, [
        `${C} DOWNGRADE: LadybugDB cannot change a column type in place.`,
        destructiveNote(C, `property ${table}.${a.name}`, `retyped from ${columnType(b)}, discarding its values`),
      ])
      statement(`ALTER TABLE ${table} ADD ${a.name} ${columnType(a)};`, notesFor(a))
    }
    for (const [ident, a] of byA) {
      if (byB.has(ident)) continue
      statement(`ALTER TABLE ${table} ADD ${a.name} ${columnType(a)};`, notesFor(a))
    }
  }

  for (const [id, a] of nodesA) {
    const b = nodesB.get(id)
    if (!b || recreatedNodes.has(id)) continue
    // A composite key lives in a synthesized column named after the type.
    if (b.key.length > 1 && syntheticKeyColumn(b) !== syntheticKeyColumn(a)) {
      statement(`ALTER TABLE ${a.name} RENAME ${syntheticKeyColumn(b)} TO ${syntheticKeyColumn(a)};`)
    }
    // The key column itself is settled by the key signature: equal here, so a rename is all it can need.
    alterColumns(a.name, b.props, a.props,
      (p) => columnNotes(a.name, p, isSingleKey(a, p), diagnostics, ''))
  }
  for (const [id, a] of relsA) {
    const b = relsB.get(id)
    if (!b || recreatedRels.has(id)) continue
    alterColumns(a.edge.name, b.edge.props, a.edge.props,
      (p) => edgeColumnNotes(a.edge.name, p, diagnostics, ''))
  }
  section()

  // --- 5. Create node tables, then rel tables and new endpoint pairs.
  for (const [id, a] of nodesA) {
    if (nodesB.has(id) && !recreatedNodes.has(id)) continue
    body.push(nodeTable(a, diagnostics))
    statements++
    section()
  }
  for (const [id, a] of relsA) {
    if (relsB.has(id) && !recreatedRels.has(id)) continue
    const table = relTable(after, a.edge, diagnostics)
    if (!table) continue
    body.push(table)
    statements++
    section()
  }
  for (const [id, a] of relsA) {
    const b = relsB.get(id)
    if (!b || recreatedRels.has(id)) continue
    const had = new Set(b.pairs.filter((p) => nodeSurvives(p.from.id) && nodeSurvives(p.to.id)).map((p) => p.key))
    for (const p of a.pairs) {
      if (!had.has(p.key)) statement(`ALTER TABLE ${a.edge.name} ADD FROM ${p.from.name} TO ${p.to.name};`)
    }
  }
  section()

  const header = migrationHeader(C, 'ladybug', after, changes, context, [
    'Apply once, to a database built from the previous revision\'s DDL. The statements run',
    'in order with no enclosing transaction, so take a backup first.',
  ])
  const content = [...header, ...(statements === 0 ? [noSchemaEffect(C, 'ladybug'), ''] : body)]
    .join('\n').replace(/\n{3,}/g, '\n\n')
  return { target: 'ladybug', extension: 'cypher', content, statements, realizations, diagnostics }
}
