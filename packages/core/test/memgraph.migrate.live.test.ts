import { describe, it, expect, beforeEach } from 'vitest'
import { emit } from '../src/emit/index'
import { planMigration } from '../src/migrate/index'
import type { ModelIR } from '../src/ir'
import { PAIRS, pairModels } from './migrate-pairs'
import {
  MEMGRAPH_URI, enumSuffix, enumsOf, reset, run, runScript, schemaState, useMemgraph, withUniqueEnums,
} from './memgraph-harness'

/**
 * Executes Memgraph migrations against a running instance. The oracle is the same one the
 * Ladybug planner answers to: an instance migrated from the previous revision must hold
 * exactly what a fresh instance built from the current one holds.
 * See lat.md/emitters#Migrations#Target Planners.
 */
useMemgraph()

function migration(before: ModelIR, after: ModelIR) {
  const plan = planMigration({
    lockfile: { lockfileVersion: 1, lpg: '1.0', revision: 1, model: before },
    model: after, targets: ['memgraph'], allowDestructive: true,
  })
  return plan.scripts[0]!
}

/** Values the migration could not remove: in the old revision's enum, not the new one's. */
function unremovable(before: ModelIR, after: ModelIR): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const b of before.enums) {
    const a = after.enums.find((e) => e.id === b.id)
    if (a) out.set(a.name, b.values.filter((v) => !a.values.includes(v)))
  }
  return out
}

// @lat: [[emitters#Migrations#Target Planners]]
describe.runIf(MEMGRAPH_URI).sequential('a migrated memgraph instance matches a fresh one', () => {
  beforeEach(reset)

  for (const pair of PAIRS) {
    it(pair.name, async () => {
      const { before, after } = pairModels(pair.name)
      const s1 = enumSuffix()
      const b1 = withUniqueEnums(before, s1).model
      const a1 = withUniqueEnums(after, s1).model
      await runScript(emit(b1, 'memgraph').content)
      await runScript(migration(b1, a1).content)
      const migrated = await schemaState()

      await reset()
      const s2 = enumSuffix()
      await runScript(emit(withUniqueEnums(after, s2).model, 'memgraph').content)
      const fresh = await schemaState()

      expect(migrated.constraints).toEqual(fresh.constraints)
      expect(migrated.indexes).toEqual(fresh.indexes)
      // An enum value Memgraph cannot remove is the one reported difference allowed.
      const lost = unremovable(before, after)
      const asSets = (enums: string[]) => enums.map((e) => {
        const [name, values = ''] = e.split(' ')
        return `${name} ${[...new Set([...values.split(','), ...(lost.get(name!) ?? [])])].sort().join(',')}`
      })
      expect(asSets(enumsOf(migrated.enums, s1))).toEqual(asSets(enumsOf(fresh.enums, s2)))
    })
  }
})

// @lat: [[emitters#Migrations#Target Planners]]
describe.runIf(MEMGRAPH_URI).sequential('a memgraph migration keeps the data it does not remove', () => {
  beforeEach(reset)

  async function seeded(name: string) {
    const { before, after } = pairModels(name)
    const s = enumSuffix()
    const b = withUniqueEnums(before, s).model
    await runScript(emit(b, 'memgraph').content)
    await run("CREATE (:Person:Party {id: 'p1', email: 'a@x'}), (:Person:Party {id: 'p2', email: 'b@x'})")
    await run("MATCH (a:Person {id: 'p1'}), (b:Person {id: 'p2'}) CREATE (a)-[:KNOWS]->(b)")
    await runScript(migration(b, withUniqueEnums(after, s).model).content)
  }

  it('keeps nodes and relationships through a node type rename, and the new key rejects a duplicate', async () => {
    await seeded('rename-node-type')
    expect(await run('MATCH (p:Individual) RETURN p.id AS id ORDER BY id')).toEqual([{ id: 'p1' }, { id: 'p2' }])
    expect(await run('MATCH (p:Person) RETURN count(p) AS n')).toEqual([{ n: 0 }])
    expect(await run('MATCH (:Individual)-[r:KNOWS]->(:Individual) RETURN count(r) AS n')).toEqual([{ n: 1 }])
    await expect(run("CREATE (:Individual:Party {id: 'p1', email: 'c@x'})")).rejects.toThrow(/unique constraint/)
  })

  it('keeps values through a property rename, under the renamed constraint', async () => {
    await seeded('rename-property')
    expect(await run("MATCH (p:Person {id: 'p1'}) RETURN p.mail AS mail, p.email AS email")).toEqual([{ mail: 'a@x', email: null }])
    await expect(run("CREATE (:Person:Party {id: 'p3', mail: 'a@x'})")).rejects.toThrow(/unique constraint/)
  })
})
