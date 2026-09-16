import { describe, it, expect } from 'vitest'
import { planMigration, migrationFileName, type MigrationRequest } from '../src/migrate/index'
import { writeLockfile, readLockfile } from '../src/migrate/lockfile'
import { PAIRS, pairModels, resolveText, BASE } from './migrate-pairs'

/** A request as `lpg migrate` would make it, from a lockfile at revision 3. */
function request(name: string, extra: Partial<MigrationRequest> = {}): MigrationRequest {
  const { before, after } = pairModels(name)
  return { lockfile: { lockfileVersion: 1, lpg: '1.0', revision: 3, model: before }, model: after, ...extra }
}

const codes = (ds: Array<{ code: string }>) => ds.map((d) => d.code)
const script = (plan: ReturnType<typeof planMigration>, target: string) =>
  plan.scripts.find((s) => s.target === target)?.content ?? ''

// @lat: [[emitters#Migrations#Destructive Gate]]
describe('migration orchestration', () => {
  it('writes nothing for a model that has not changed', () => {
    const model = resolveText(BASE)
    const plan = planMigration({ lockfile: { lockfileVersion: 1, lpg: '1.0', revision: 3, model }, model })
    expect(plan.scripts).toEqual([])
    expect(plan.lockfileText).toBeUndefined()
    expect(plan.revision).toBe(3)
    expect(codes(plan.diagnostics)).toContain('model-unchanged')
  })

  it('generates the four database targets by default and advances the lockfile', () => {
    const plan = planMigration(request('add-optional-property'))
    expect(plan.scripts.map((s) => s.target)).toEqual(['ladybug', 'neo4j', 'falkordb', 'memgraph'])
    expect(plan.revision).toBe(4)
    expect(readLockfile(plan.lockfileText!).lockfile?.revision).toBe(4)
    expect(plan.lockfileText).toBe(writeLockfile(pairModels('add-optional-property').after, 4))
    expect(plan.scripts.map((s) => migrationFileName('shop', plan.revision, s.target, s.extension)))
      .toEqual(['shop.0004.ladybug.cypher', 'shop.0004.neo4j.cypher', 'shop.0004.falkordb.sh', 'shop.0004.memgraph.cypher'])
  })

  it('refuses a destructive change without permission, leaving the revision where it was', () => {
    const plan = planMigration(request('remove-node-type'))
    expect(plan.refused).toBe(true)
    expect(plan.scripts).toEqual([])
    expect(plan.lockfileText).toBeUndefined()
    expect(plan.revision).toBe(3)
    const errors = plan.diagnostics.filter((d) => d.code === 'destructive-change')
    expect(errors.some((d) => d.message.includes('node Car'))).toBe(true)
  })

  it('generates the destructive migration when permitted, marking each destructive statement', () => {
    const plan = planMigration(request('remove-node-type', { allowDestructive: true }))
    expect(plan.refused).toBe(false)
    for (const target of ['ladybug', 'neo4j', 'falkordb', 'memgraph']) {
      const lines = script(plan, target).split('\n')
      const drop = lines.findIndex((l) => /DROP (TABLE|CONSTRAINT) (Car|car_)|CONSTRAINT DROP .* Car |DROP CONSTRAINT ON \(n:Car\)/.test(l))
      expect(drop, target).toBeGreaterThan(0)
      expect(lines[drop - 1], target).toMatch(/DESTRUCTIVE: .*Car/)
    }
  })

  it('gates a merely breaking change that a target can only apply by discarding data', () => {
    const refused = planMigration(request('change-key'))
    expect(refused.refused).toBe(true)
    const gate = refused.diagnostics.find((d) => d.code === 'destructive-change')
    expect(gate).toMatchObject({ target: 'ladybug' })

    const allowed = planMigration(request('change-key', { allowDestructive: true }))
    expect(codes(allowed.diagnostics)).toContain('migration-downgrade')
    expect(script(allowed, 'ladybug')).toMatch(/DESTRUCTIVE: node Car: recreated[\s\S]*DROP TABLE Car;[\s\S]*CREATE NODE TABLE IF NOT EXISTS Car/)
  })

  it('says a change has no schema effect rather than writing an empty script, and still advances', () => {
    const plan = planMigration(request('value-pattern'))
    for (const s of plan.scripts) {
      expect(s.statements, s.target).toBe(0)
      expect(s.content, s.target).toContain(`No schema effect on ${s.target}`)
    }
    expect(plan.revision).toBe(4)
    expect(plan.lockfileText).toBeDefined()
  })

  it('refuses a target that is regenerated rather than migrated', () => {
    const plan = planMigration(request('add-optional-property', { targets: ['shacl'] }))
    expect(plan.refused).toBe(true)
    expect(codes(plan.diagnostics)).toEqual(['not-migratable'])
  })

  it('warns when a subset of the database targets is migrated', () => {
    const plan = planMigration(request('add-optional-property', { targets: ['ladybug'] }))
    expect(plan.diagnostics.find((d) => d.code === 'partial-migration')?.message).toMatch(/neo4j, falkordb and memgraph/)
  })

  it('refuses a model whose element ids are derived', () => {
    const plan = planMigration(request('add-optional-property', {
      model: resolveText(BASE.replace('nickname: { id: p_nick, type: string }', 'nickname: { type: string }')),
    }))
    expect(plan.refused).toBe(true)
    expect(codes(plan.diagnostics)).toContain('ids-not-written')
  })
})

// @lat: [[emitters#Migrations#Target Planners]]
describe('migration scripts, golden', () => {
  for (const pair of PAIRS) {
    it(pair.name, async () => {
      const community = planMigration(request(pair.name, { allowDestructive: true }))
      const enterprise = planMigration(request(pair.name, {
        allowDestructive: true, targets: ['neo4j'], options: { neo4jEdition: 'enterprise' },
      }))
      await expect(script(community, 'ladybug')).toMatchFileSnapshot(`./golden/migrate/${pair.name}.ladybug.cypher`)
      await expect(script(community, 'neo4j')).toMatchFileSnapshot(`./golden/migrate/${pair.name}.neo4j.community.cypher`)
      await expect(script(enterprise, 'neo4j')).toMatchFileSnapshot(`./golden/migrate/${pair.name}.neo4j.enterprise.cypher`)
      await expect(script(community, 'falkordb')).toMatchFileSnapshot(`./golden/migrate/${pair.name}.falkordb.sh`)
      await expect(script(community, 'memgraph')).toMatchFileSnapshot(`./golden/migrate/${pair.name}.memgraph.cypher`)
    })
  }
})

// @lat: [[emitters#Migrations#Target Planners]]
describe('ladybug migration', () => {
  it('adds a property on an abstract parent to every concrete table and creates none', () => {
    const s = script(planMigration(request('add-optional-property')), 'ladybug')
    expect(s).toContain('ALTER TABLE Person ADD phone STRING;')
    expect(s).toContain('ALTER TABLE Company ADD phone STRING;')
    expect(s).not.toContain('CREATE')
  })

  it('renames a table in place', () => {
    expect(script(planMigration(request('rename-node-type')), 'ladybug')).toContain('ALTER TABLE Person RENAME TO Individual;')
  })
})

// @lat: [[emitters#Migrations#Target Planners]]
describe('neo4j migration', () => {
  it('drops the old key, relabels, then creates the new key, in that order', () => {
    const s = script(planMigration(request('rename-node-type', { options: { neo4jEdition: 'enterprise' } })), 'neo4j')
    const drop = s.indexOf('DROP CONSTRAINT person_key IF EXISTS;')
    const relabel = s.indexOf('SET n:Individual REMOVE n:Person')
    const create = s.indexOf('CREATE CONSTRAINT individual_key IF NOT EXISTS')
    expect(drop).toBeGreaterThan(0)
    expect(relabel).toBeGreaterThan(drop)
    expect(create).toBeGreaterThan(relabel)
  })

  it('reports the Community downgrade for an added required property, with a comment instead of the constraint', () => {
    const plan = planMigration(request('add-required-property'))
    const s = script(plan, 'neo4j')
    expect(plan.diagnostics.some((d) => d.code === 'downgrade-required' && d.target === 'neo4j' && d.message.includes('rating'))).toBe(true)
    expect(s).toContain("// UNENFORCED: 'rating' is required; existence constraints require Enterprise.")
    expect(s).not.toContain('car_rating_exists')
  })
})

// @lat: [[emitters#Migrations#Target Planners]]
describe('falkordb migration', () => {
  it('drops a unique constraint before the index it depends on', () => {
    const lines = script(planMigration(request('drop-uniqueness')), 'falkordb').split('\n')
    const constraint = lines.findIndex((l) => l.includes('GRAPH.CONSTRAINT DROP') && l.includes('Person PROPERTIES 1 email'))
    const index = lines.findIndex((l) => l.includes('DROP INDEX FOR (n:Person) ON (n.email)'))
    expect(constraint).toBeGreaterThan(0)
    expect(index).toBeGreaterThan(constraint)
  })

  it('creates the exact-match index on the line before a new unique constraint', () => {
    const lines = script(planMigration(request('add-unique')), 'falkordb').split('\n')
    const constraint = lines.findIndex((l) => l.includes('GRAPH.CONSTRAINT CREATE') && l.includes('UNIQUE NODE Person PROPERTIES 1 nickname'))
    expect(constraint).toBeGreaterThan(0)
    expect(lines[constraint - 1]).toContain('CREATE INDEX FOR (n:Person) ON (n.nickname)')
  })

  it('indexes only the properties a new composite key adds', () => {
    const s = script(planMigration(request('change-key', { allowDestructive: true })), 'falkordb')
    expect(s).toContain('CREATE INDEX FOR (n:Car) ON (n.seats)')
    expect(s).not.toContain('ON (n.vin, n.seats)')
  })
})

// @lat: [[emitters#Migrations#Target Planners]]
describe('memgraph migration', () => {
  it('drops the old key constraints, relabels in batches, then creates the new ones, in that order', () => {
    const s = script(planMigration(request('rename-node-type')), 'memgraph')
    const drop = s.indexOf('DROP CONSTRAINT ON (n:Person) ASSERT n.id IS UNIQUE;')
    const relabel = s.indexOf('USING PERIODIC COMMIT 1000 MATCH (n:Person) SET n:Individual REMOVE n:Person;')
    const create = s.indexOf('CREATE CONSTRAINT ON (n:Individual) ASSERT n.id IS UNIQUE;')
    expect(drop).toBeGreaterThan(0)
    expect(relabel).toBeGreaterThan(drop)
    expect(create).toBeGreaterThan(relabel)
  })

  it('replaces a type constraint on a retyped property, warning that existing values block it', () => {
    // Ladybug has to drop and re-add the column, so the migration needs the flag.
    const lines = script(planMigration(request('retype-property', { allowDestructive: true })), 'memgraph').split('\n')
    const drop = lines.indexOf('DROP CONSTRAINT ON (n:Car) ASSERT n.seats IS TYPED INTEGER;')
    const create = lines.indexOf('CREATE CONSTRAINT ON (n:Car) ASSERT n.seats IS TYPED STRING;')
    expect(drop).toBeGreaterThan(0)
    expect(create).toBeGreaterThan(drop)
    expect(lines[create - 1]).toMatch(/BREAKING: .*refused while existing values of the previous type remain/)
  })

  it('adds an enum value in place, and a new enum', () => {
    expect(script(planMigration(request('add-enum-value')), 'memgraph')).toContain('ALTER ENUM Status ADD VALUE sold;')
    expect(script(planMigration(request('add-enum')), 'memgraph')).toContain('CREATE ENUM Fuel VALUES { petrol, electric };')
  })

  it('reports an enum value it cannot remove, with a comment instead of a statement', () => {
    const plan = planMigration(request('remove-enum-value', { allowDestructive: true }))
    const s = script(plan, 'memgraph')
    expect(plan.diagnostics.some((d) => d.code === 'migration-downgrade' && d.target === 'memgraph' && d.message.includes('retired'))).toBe(true)
    expect(s).toContain("// DOWNGRADE: 'retired' removed from enum 'Status'; Memgraph cannot remove an enum value, so it stays valid.")
    expect(plan.scripts.find((x) => x.target === 'memgraph')?.statements).toBe(0)
  })
})
