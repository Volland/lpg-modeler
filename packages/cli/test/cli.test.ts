import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  MEMGRAPH_URI, reset, run as runHarness, schemaState, useMemgraph,
} from '../../core/test/memgraph-harness'
import {
  NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, closeDriver as closeNeo4j, reset as resetNeo4j,
  run as runNeo4j, schemaState as neo4jSchemaState,
} from '../../core/test/neo4j-harness'
import {
  FALKORDB_URI, GRAPH_KEY, closeClient as closeFalkor, query as falkorQuery,
  reset as resetFalkor, schemaState as falkorSchemaState, send as falkorSend,
} from '../../core/test/falkordb-harness'
import { pair } from '../../core/test/migrate-pairs'

const CLI = resolve(__dirname, '..', 'dist', 'cli.js')
const FIXTURES = resolve(__dirname, '..', '..', 'core', 'test', 'fixtures')

/** spawnSync, not execFileSync: the latter discards stderr when the exit code is 0. */
function run(args: string[], cli = CLI, cwd?: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// @lat: [[architecture#Package Boundary]]
describe('lpg cli', () => {
  it('lists the registered targets', () => {
    const r = run(['targets'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim().split('\n').sort()).toEqual(
      ['falkordb', 'gql', 'ladybug', 'linkml', 'memgraph', 'neo4j', 'owl', 'pgschema', 'shacl'])
  })

  it('checks a valid model and exits zero', () => {
    const r = run(['check', join(FIXTURES, 'social.lpg.yaml')])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('0 error(s)')
  })

  it('exits non-zero on a model with errors', () => {
    const r = run(['check', join(FIXTURES, 'broken.lpg.yaml')])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('missing-key')
    expect(r.stderr).toMatch(/broken\.lpg\.yaml:\d+:\d+/)  // a findable position
  })

  it('emits the same content the library produces', () => {
    const r = run(['emit', join(FIXTURES, 'social.lpg.yaml'), '--target', 'ladybug'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('CREATE NODE TABLE IF NOT EXISTS Person (')
  })

  it('writes one artifact per target when given an output directory', () => {
    const out = mkdtempSync(join(tmpdir(), 'lpg-'))
    const r = run([
      'emit', join(FIXTURES, 'social.lpg.yaml'),
      '--target', 'ladybug', '--target', 'shacl', '--target', 'owl', '--out', out,
    ])
    expect(r.status).toBe(0)
    expect(readFileSync(join(out, 'social.ladybug.cypher'), 'utf8')).toContain('CREATE NODE TABLE')
    expect(readFileSync(join(out, 'social.shacl.ttl'), 'utf8')).toContain('sh:NodeShape')
    expect(readFileSync(join(out, 'social.owl.ttl'), 'utf8')).toContain('owl:Class')
  })

  it('refuses to generate from a model with errors', () => {
    const r = run(['emit', join(FIXTURES, 'broken.lpg.yaml'), '--target', 'ladybug'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('refusing to generate from a model with errors')
    expect(r.stdout).toBe('')
  })

  it('reports downgrades on stderr while still producing the artifact', () => {
    const r = run(['emit', join(FIXTURES, 'social.lpg.yaml'), '--target', 'neo4j', '--edition', 'community'])
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('[neo4j] downgrade-node-key')
    expect(r.stdout).toContain('CREATE CONSTRAINT')
  })

  it('assigns missing ids in place', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lpg-'))
    const file = join(dir, 'm.lpg.yaml')
    writeFileSync(file, [
      'namespace: { prefix: t, iri: "https://example.org/t#" }',
      'nodes:',
      '  Thing:',
      '    key: [id]',
      '    props:',
      '      id: { type: string }',
      '',
    ].join('\n'))
    expect(run(['ids', file]).status).toBe(0)
    const after = readFileSync(file, 'utf8')
    expect(after).toMatch(/id: n_[a-z0-9]+/)
    expect(after).toMatch(/\{ id: p_[a-z0-9]+, type: string \}/)
    expect(run(['ids', file]).stdout).toContain('all elements already have ids')
  })
})

// @lat: [[importers#Importers]]
describe('lpg import', () => {
  /** Generate the artifacts a model produces, into a fresh directory. */
  function artifacts(model: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'lpg-import-'))
    const r = run(['emit', join(FIXTURES, model),
      '--target', 'shacl', '--target', 'owl', '--target', 'ladybug', '--out', dir])
    expect(r.status).toBe(0)
    return dir
  }

  const stem = (dir: string, model: string, target: string) =>
    join(dir, `${model.replace(/\.lpg\.yaml$/, '')}.${target}.${target === 'ladybug' ? 'cypher' : 'ttl'}`)

  it('reads a shapes graph and an ontology back into a model that checks clean', () => {
    const dir = artifacts('social.lpg.yaml')
    const out = join(dir, 'rt.lpg.yaml')
    const r = run(['import', stem(dir, 'social.lpg.yaml', 'shacl'),
      stem(dir, 'social.lpg.yaml', 'owl'), '--out', out])
    expect(r.status).toBe(0)

    const written = readFileSync(out, 'utf8')
    expect(written).toContain('extends: Party')
    expect(written).toContain('from: Party')
    expect(run(['check', out]).stdout).toContain('0 error(s)')
  })

  it('says what the sources could not carry', () => {
    const dir = artifacts('social.lpg.yaml')
    const r = run(['import', stem(dir, 'social.lpg.yaml', 'shacl'),
      stem(dir, 'social.lpg.yaml', 'owl'), '--out', join(dir, 'rt.lpg.yaml')])
    expect(r.stderr).toContain('import-lossy')
  })

  it('collapses an expanded endpoint set when the DDL is imported with the ontology', () => {
    const dir = artifacts('social.lpg.yaml')
    const r = run(['import', stem(dir, 'social.lpg.yaml', 'shacl'),
      stem(dir, 'social.lpg.yaml', 'owl'), stem(dir, 'social.lpg.yaml', 'ladybug'),
      '--out', join(dir, 'rt.lpg.yaml')])
    expect(r.stderr).toContain('import-collapsed')
  })

  it('writes the model to stdout when no destination is named', () => {
    const dir = artifacts('social.lpg.yaml')
    const r = run(['import', stem(dir, 'social.lpg.yaml', 'shacl'),
      stem(dir, 'social.lpg.yaml', 'owl')])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('namespace:')
  })

  it('fails on a file it cannot read', () => {
    const r = run(['import', join(tmpdir(), 'no-such-file.ttl')])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('cannot read')
  })

  it('names import among the verbs it offers', () => {
    expect(run(['--help']).stderr).toContain('lpg import')
  })
})

// @lat: [[importers#Reading a LadybugDB Database]]
describe('lpg import from a LadybugDB database', () => {
  /** A database on disk holding the tables the ladybug target generates for a fixture. */
  async function database(name: string): Promise<{ dir: string; path: string }> {
    const lbug = await import('@ladybugdb/core')
    const dir = mkdtempSync(join(tmpdir(), 'lpg-lbdb-'))
    const emitted = run(['emit', join(FIXTURES, 'social.lpg.yaml'), '--target', 'ladybug'])
    const path = join(dir, name)
    const db = new lbug.Database(path, 256 * 1024 * 1024, true, false, 1024 * 1024 * 1024)
    const conn = new lbug.Connection(db)
    await conn.query(emitted.stdout)
    await conn.query("CREATE (:Person {id: '1', email: 'a@b.c'})")
    await conn.close()
    await db.close()
    return { dir, path }
  }

  it('writes the model to stdout, recognising the database by its extension', async () => {
    const { path } = await database('social.lbdb')
    const r = run(['import', path])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Person:')
    expect(r.stdout).toContain('key: [vin]')
    expect(r.stderr).toContain('import-multiplicity')
  })

  it('writes a model file that checks clean, and leaves the database as it was', async () => {
    const { dir, path } = await database('social.db')
    const before = readFileSync(path)
    const out = join(dir, 'social.lpg.yaml')
    const r = run(['import', path, '--from', 'ladybug-db', '--out', out])
    expect(r.status).toBe(0)
    expect(readFileSync(out, 'utf8')).toContain('LadybugDB keeps one table per concrete')
    expect(run(['check', out]).stdout).toContain('0 error(s)')
    expect(readFileSync(path).equals(before)).toBe(true)
  })

  it('fails on a database path that does not exist, writing nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lpg-lbdb-'))
    const out = join(dir, 'm.lpg.yaml')
    const r = run(['import', join(dir, 'missing.lbdb'), '--out', out])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('cannot open LadybugDB database')
    expect(existsSync(out)).toBe(false)
    expect(existsSync(join(dir, 'missing.lbdb'))).toBe(false)
  })

  it('takes a directory to be a database rather than a file it cannot read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lpg-lbdb-dir-'))
    const r = run(['import', dir])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`cannot open LadybugDB database ${dir}`)
    expect(r.stderr).not.toContain('cannot read')
  })

  it('fails on a file that is not a database, with the reason the engine gave', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lpg-lbdb-'))
    const bogus = join(dir, 'bogus.lbdb')
    writeFileSync(bogus, 'not a database')
    const out = join(dir, 'm.lpg.yaml')
    const r = run(['import', bogus, '--out', out])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/cannot open LadybugDB database .*bogus\.lbdb: .+/)
    expect(existsSync(out)).toBe(false)
  })

  it('tells the user how to install the runtime when it is missing, and nothing else needs it', () => {
    // Outside the workspace, the CLI finds no @ladybugdb/core beside it or in cwd.
    const dir = mkdtempSync(join(tmpdir(), 'lpg-noruntime-'))
    const cli = join(dir, 'cli.js')
    copyFileSync(CLI, cli)
    const r = run(['import', join(dir, 'x.lbdb')], cli, dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('npm install @ladybugdb/core@0.19.1')
    expect(run(['check', join(FIXTURES, 'social.lpg.yaml')], cli, dir).status).toBe(0)
  })
})

// @lat: [[emitters#Migrations#Destructive Gate]]
describe('lpg lock, diff and migrate', () => {
  const BASE = join(FIXTURES, 'migrate', 'base.lpg.yaml')

  /** A copy of the migration base model in a fresh directory, optionally locked. */
  function project(locked = true): { dir: string; model: string; lock: string } {
    const dir = mkdtempSync(join(tmpdir(), 'lpg-migrate-'))
    const model = join(dir, 'shop.lpg.yaml')
    writeFileSync(model, readFileSync(BASE, 'utf8'))
    if (locked) expect(run(['lock', model]).status).toBe(0)
    return { dir, model, lock: join(dir, 'shop.lpg.lock.json') }
  }
  const edit = (file: string, from: string, to: string) =>
    writeFileSync(file, readFileSync(file, 'utf8').replace(from, to))

  it('locks a model at revision 1, byte-identically on a second run', () => {
    const { model, lock } = project()
    const first = readFileSync(lock, 'utf8')
    expect(JSON.parse(first)).toMatchObject({ lockfileVersion: 1, revision: 1 })
    expect(run(['lock', model]).status).toBe(0)
    expect(readFileSync(lock, 'utf8')).toBe(first)
  })

  it('refuses to lock a model with errors, writing nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lpg-migrate-'))
    const model = join(dir, 'broken.lpg.yaml')
    writeFileSync(model, readFileSync(join(FIXTURES, 'broken.lpg.yaml'), 'utf8'))
    expect(run(['lock', model]).status).toBe(1)
    expect(existsSync(join(dir, 'broken.lpg.lock.json'))).toBe(false)
  })

  it('refuses to lock a model with derived element ids', () => {
    const { model, lock } = project(false)
    edit(model, 'nickname: { id: p_nick, type: string }', 'nickname: { type: string }')
    const r = run(['lock', model])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('ids-not-written')
    expect(existsSync(lock)).toBe(false)
  })

  it('requires a lockfile for diff and migrate', () => {
    const { model } = project(false)
    for (const verb of ['diff', 'migrate']) {
      const r = run([verb, model])
      expect(r.status, verb).toBe(1)
      expect(r.stderr, verb).toContain('lockfile-missing')
    }
  })

  it('gates on breaking changes, and passes only additive ones', () => {
    const renamed = project()
    edit(renamed.model, '      email: {', '      mail: {')
    const r = run(['diff', renamed.model, '--fail-on', 'breaking'])
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/breaking\s+property Person\.mail: renamed from 'email'/)

    const added = project()
    edit(added.model, '\nedges:\n', '\n  Bike:\n    id: n_bike\n    extends: Asset\n    key: [serial]\n    props:\n      serial: { id: p_serial, type: string, required: true }\n\nedges:\n')
    expect(run(['diff', added.model, '--fail-on', 'breaking']).status).toBe(0)
  })

  it('fails lock --check on a model changed since its lockfile, naming the change', () => {
    const { model } = project()
    expect(run(['lock', model, '--check']).status).toBe(0)
    edit(model, '      email: {', '      mail: {')
    const r = run(['lock', model, '--check'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('Person.mail')
  })

  it('prints the change set as JSON', () => {
    const { model } = project()
    edit(model, '      email: {', '      mail: {')
    const out = JSON.parse(run(['diff', model, '--json']).stdout)
    expect(out.revision).toBe(1)
    expect(out.changes).toMatchObject([{ kind: 'renamed', class: 'breaking', label: 'property Person.mail' }])
  })

  it('writes one script per database target at the next revision, then advances the lockfile', () => {
    const { dir, model, lock } = project()
    edit(model, '      id: { id: p_pid, type: string, required: true }\n',
      '      id: { id: p_pid, type: string, required: true }\n      phone: { id: p_phone, type: string }\n')
    const r = run(['migrate', model, '--out', join(dir, 'out')])
    expect(r.status).toBe(0)
    for (const f of ['shop.0002.ladybug.cypher', 'shop.0002.neo4j.cypher', 'shop.0002.falkordb.sh', 'shop.0002.memgraph.cypher']) {
      expect(existsSync(join(dir, 'out', f)), f).toBe(true)
    }
    expect(JSON.parse(readFileSync(lock, 'utf8')).revision).toBe(2)
    expect(run(['lock', model, '--check']).status).toBe(0)
  })

  it('refuses a destructive change without the flag, writing nothing and keeping the revision', () => {
    const { dir, model, lock } = project()
    edit(model, '      nickname: { id: p_nick, type: string }\n', '')
    const r = run(['migrate', model])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('destructive-change')
    expect(existsSync(join(dir, 'migrations'))).toBe(false)
    expect(JSON.parse(readFileSync(lock, 'utf8')).revision).toBe(1)

    expect(run(['migrate', model, '--allow-destructive']).status).toBe(0)
    expect(readFileSync(join(dir, 'migrations', 'shop.0002.ladybug.cypher'), 'utf8'))
      .toMatch(/DESTRUCTIVE: property Person\.nickname[^\n]*\nALTER TABLE Person DROP nickname;/)
  })

  it('refuses a target that is regenerated rather than migrated', () => {
    const { model } = project()
    edit(model, '      email: {', '      mail: {')
    const r = run(['migrate', model, '--target', 'shacl'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('not-migratable')
  })

  it('names lock, diff and migrate among the verbs it offers', () => {
    const help = run(['--help']).stderr
    for (const verb of ['lpg lock', 'lpg diff', 'lpg migrate']) expect(help).toContain(verb)
  })
})

// @lat: [[architecture#Distribution]]
describe('lpg apply, without a server', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'lpg-apply-'))
  const emitted = (d: string, target: string) => {
    expect(run(['emit', join(FIXTURES, 'social.lpg.yaml'), '--target', target, '--out', d]).status).toBe(0)
    return join(d, `social.${target}.${target === 'falkordb' ? 'sh' : 'cypher'}`)
  }

  it('prints the statements of a generated script in order on a dry run, without connecting', () => {
    const script = emitted(dir(), 'memgraph')
    const r = run(['apply', script, '--target', 'memgraph', '--dry-run'])
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split('\n')
    expect(lines[0]).toMatch(/^\[1\/\d+\] CREATE CONSTRAINT ON \(n:Car\) ASSERT n\.vin IS UNIQUE;$/)
    expect(lines.every((l) => /^\[\d+\/\d+\] /.test(l))).toBe(true)
    expect(r.stdout).not.toContain('//')
  })

  it('refuses a script generated for another target, and a file it did not generate', () => {
    const d = dir()
    const neo4j = run(['apply', emitted(d, 'neo4j'), '--target', 'memgraph', '--dry-run'])
    expect(neo4j.status).toBe(1)
    expect(neo4j.stderr).toContain('apply-target-mismatch')
    const hand = join(d, 'hand.cypher')
    writeFileSync(hand, 'CREATE INDEX ON :Car(vin);\n')
    const r = run(['apply', hand, '--target', 'memgraph', '--dry-run'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('apply-not-generated')
  })

  it('names the targets it can apply to when given one it cannot', () => {
    const r = run(['apply', emitted(dir(), 'shacl'), '--target', 'shacl', '--dry-run'])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/apply-unsupported: .*memgraph, neo4j, ladybug and falkordb/)
  })

  it('reads a header that names the engine after the target', () => {
    // `Target: ladybug (LadybugDB).` and `Target: falkordb (FalkorDB).` carry a
    // parenthetical the memgraph and neo4j headers do not.
    const d = dir()
    for (const target of ['ladybug', 'falkordb']) {
      const r = run(['apply', emitted(d, target), '--target', 'memgraph', '--dry-run'])
      expect(r.status, target).toBe(1)
      expect(r.stderr, target).toContain(`was generated for ${target}, not memgraph`)
    }
  })

  it('applies a neo4j script through the same checks', () => {
    const d = dir()
    const script = emitted(d, 'neo4j')
    const dry = run(['apply', script, '--target', 'neo4j', '--dry-run'])
    expect(dry.status).toBe(0)
    expect(dry.stdout).toMatch(/^\[1\/\d+\] CREATE CONSTRAINT /)
    const mismatch = run(['apply', script, '--target', 'memgraph', '--dry-run'])
    expect(mismatch.status).toBe(1)
    expect(mismatch.stderr).toContain('apply-target-mismatch')
  })

  it('refuses a script with destructive statements unless permitted', () => {
    const d = dir()
    const model = join(d, 'shop.lpg.yaml')
    writeFileSync(model, readFileSync(join(FIXTURES, 'migrate', 'base.lpg.yaml'), 'utf8'))
    expect(run(['lock', model]).status).toBe(0)
    // Removing a node type deletes its nodes, which is what apply refuses without the flag.
    writeFileSync(model, pair('remove-node-type').edit(readFileSync(model, 'utf8')))
    expect(run(['migrate', model, '--target', 'memgraph', '--allow-destructive']).status).toBe(0)
    const script = join(d, 'migrations', 'shop.0002.memgraph.cypher')
    const refused = run(['apply', script, '--target', 'memgraph', '--dry-run'])
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('destructive-change')
    expect(run(['apply', script, '--target', 'memgraph', '--dry-run', '--allow-destructive']).status).toBe(0)
  })

  it('reports an instance it cannot reach, naming the URI', () => {
    const r = run(['apply', emitted(dir(), 'memgraph'), '--target', 'memgraph', '--uri', 'bolt://127.0.0.1:1'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('cannot connect to memgraph at bolt://127.0.0.1:1')
  })

  // @lat: [[emitters#FalkorDB Target#Reading the Script Back]]
  it('prints the commands a falkordb script invokes, without connecting', () => {
    const r = run(['apply', emitted(dir(), 'falkordb'), '--target', 'falkordb', '--dry-run'])
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split('\n')
    expect(lines[0]).toMatch(/^\[1\/\d+\] GRAPH\.QUERY social CREATE INDEX FOR \(n:Car\) ON \(n\.vin\)$/)
    // The shell wrapper is gone: no variables, no redis-cli, only commands.
    expect(r.stdout).not.toContain('$REDIS_CLI')
    expect(r.stdout).not.toContain('$GRAPH_KEY')
  })

  // @lat: [[emitters#FalkorDB Target#Reading the Script Back]]
  it('refuses a falkordb script line it did not generate, without connecting', () => {
    const d = dir()
    const script = join(d, 'edited.falkordb.sh')
    writeFileSync(script, readFileSync(emitted(d, 'falkordb'), 'utf8')
      .replace(/^(\$REDIS_CLI GRAPH\.QUERY.*)$/m, '$1 | tee /tmp/leak.txt'))
    const r = run(['apply', script, '--target', 'falkordb', '--dry-run'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('apply-unreadable-line')
    expect(r.stderr).toMatch(/edited\.falkordb\.sh:\d+/)
  })

  it('reports a FalkorDB instance it cannot reach, naming the URI', () => {
    const r = run(['apply', emitted(dir(), 'falkordb'), '--target', 'falkordb', '--uri', 'redis://127.0.0.1:1'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('cannot connect to FalkorDB at redis://127.0.0.1:1')
  })

  it('tells the user how to install the Redis client when it is missing', () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-noredis-'))
    const cli = join(d, 'cli.js')
    copyFileSync(CLI, cli)
    for (const args of [
      ['import', 'redis://127.0.0.1:1'],
      ['apply', emitted(dir(), 'falkordb'), '--target', 'falkordb', '--uri', 'redis://127.0.0.1:1'],
    ]) {
      const r = run(args, cli, d)
      expect(r.status, args[0]).toBe(1)
      expect(r.stderr, args[0]).toContain('npm install redis@')
    }
  })

  // @lat: [[architecture#Distribution]]
  it('refuses a ladybug apply with no database, and one with a URI', () => {
    const script = emitted(dir(), 'ladybug')
    // A path is required, and a URI is not a path: an embedded database has no server.
    expect(run(['apply', script, '--target', 'ladybug']).status).toBe(2)
    expect(run(['apply', script, '--target', 'ladybug', '--uri', 'bolt://localhost:7687']).status).toBe(2)
  })

  it('tells the user how to install the driver when it is missing', () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-nodriver-'))
    const cli = join(d, 'cli.js')
    copyFileSync(CLI, cli)
    for (const args of [['import', 'bolt://127.0.0.1:1'], ['apply', emitted(dir(), 'memgraph'), '--target', 'memgraph', '--uri', 'bolt://127.0.0.1:1']]) {
      const r = run(args, cli, d)
      expect(r.status, args[0]).toBe(1)
      expect(r.stderr, args[0]).toContain('npm install neo4j-driver@6.2.0')
    }
  })
})

// The LadybugDB runtime is a development dependency of the workspace, so these need no
// container and no environment variable: the database is a directory in a temp folder.
// @lat: [[architecture#Distribution]]
describe('lpg apply against a LadybugDB database', () => {
  const emitted = (d: string, model = 'social.lpg.yaml') => {
    expect(run(['emit', join(FIXTURES, model), '--target', 'ladybug', '--out', d]).status).toBe(0)
    return join(d, `${model.replace('.lpg.yaml', '')}.ladybug.cypher`)
  }

  it('creates the database, applies every statement, and reads back as the same model', () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-lbug-'))
    const db = join(d, 'social.lbdb')
    const r = run(['apply', emitted(d), '--target', 'ladybug', '--database', db])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(`creating a LadybugDB database at ${db}`)
    expect(r.stdout).toMatch(/applied \d+ statement\(s\)/)
    expect(existsSync(db)).toBe(true)

    const out = join(d, 'back.lpg.yaml')
    expect(run(['import', db, '--out', out]).status).toBe(0)
    const written = readFileSync(out, 'utf8')
    for (const type of ['Car:', 'Company:', 'Person:']) expect(written).toContain(type)
    expect(run(['check', out]).stdout).toContain('0 error(s)')
  })

  it('opens a database read-only to import it, and read-write only to apply', () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-lbug-'))
    const db = join(d, 'social.lbdb')
    expect(run(['apply', emitted(d), '--target', 'ladybug', '--database', db]).status).toBe(0)

    // Write-protected on disk: a read-write open fails here, a read-only one does not.
    chmodSync(db, 0o555)
    try {
      expect(run(['import', db]).status).toBe(0)
      const r = run(['apply', emitted(d), '--target', 'ladybug', '--database', db])
      expect(r.status).toBe(1)
    } finally {
      chmodSync(db, 0o755)
    }
  })

  it('prints the statements without touching the path on a dry run', () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-lbug-'))
    const db = join(d, 'never.lbdb')
    const r = run(['apply', emitted(d), '--target', 'ladybug', '--database', db, '--dry-run'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/^\[1\/\d+\] CREATE NODE TABLE/)
    expect(existsSync(db)).toBe(false)
  })

  it('refuses a path holding no database when --no-create is given, creating nothing', () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-lbug-'))
    const db = join(d, 'absent.lbdb')
    const r = run(['apply', emitted(d), '--target', 'ladybug', '--database', db, '--no-create'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('apply-no-database')
    expect(existsSync(db)).toBe(false)
  })

  it('stops at the first statement the engine refuses, saying what had been applied', () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-lbug-'))
    const db = join(d, 'partial.lbdb')
    const script = join(d, 'broken.ladybug.cypher')
    // The generator's own header, so the file is one apply accepts, with a third
    // statement LadybugDB refuses: a rel table whose endpoint table does not exist.
    writeFileSync(script, [
      '// Generated by lpg-modeler. Target: ladybug (LadybugDB).',
      '',
      'CREATE NODE TABLE IF NOT EXISTS A (id STRING, PRIMARY KEY(id));',
      'CREATE NODE TABLE IF NOT EXISTS B (id STRING, PRIMARY KEY(id));',
      'CREATE REL TABLE IF NOT EXISTS R (FROM A TO Missing);',
      'CREATE NODE TABLE IF NOT EXISTS C (id STRING, PRIMARY KEY(id));',
      '',
    ].join('\n'))
    const r = run(['apply', script, '--target', 'ladybug', '--database', db])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/statement 3 of 4 failed:/)
    expect(r.stderr).toContain('2 statement(s) had been applied')

    // The two that ran are really there, and the fourth never ran.
    const out = join(d, 'partial.lpg.yaml')
    expect(run(['import', db, '--out', out]).status).toBe(0)
    const written = readFileSync(out, 'utf8')
    expect(written).toContain('A:')
    expect(written).toContain('B:')
    expect(written).not.toContain('C:')
  })

  it('applies a migration to a database built from the previous revision, keeping its rows', () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-lbug-'))
    const model = join(d, 'shop.lpg.yaml')
    writeFileSync(model, readFileSync(join(FIXTURES, 'migrate', 'base.lpg.yaml'), 'utf8'))
    expect(run(['emit', model, '--target', 'ladybug', '--out', d]).status).toBe(0)
    const db = join(d, 'shop.lbdb')
    expect(run(['apply', join(d, 'shop.ladybug.cypher'), '--target', 'ladybug', '--database', db]).status).toBe(0)
    expect(run(['lock', model]).status).toBe(0)

    // A rename is migrated as a rename, so the rows survive it.
    writeFileSync(model, pair('rename-property').edit(readFileSync(model, 'utf8')))
    expect(run(['migrate', model, '--target', 'ladybug']).status).toBe(0)
    const script = join(d, 'migrations', 'shop.0002.ladybug.cypher')
    const r = run(['apply', script, '--target', 'ladybug', '--database', db])
    expect(r.status).toBe(0)

    const out = join(d, 'after.lpg.yaml')
    expect(run(['import', db, '--out', out]).status).toBe(0)
    expect(readFileSync(out, 'utf8')).toContain('mail')
  })
})

// @lat: [[importers#Reading a FalkorDB Instance]]
describe.runIf(FALKORDB_URI).sequential('lpg apply and import against a running falkordb', () => {
  const emitted = (d: string) => {
    expect(run(['emit', join(FIXTURES, 'social.lpg.yaml'), '--target', 'falkordb', '--out', d]).status).toBe(0)
    return join(d, 'social.falkordb.sh')
  }
  const apply = (script: string, ...extra: string[]) =>
    run(['apply', script, '--target', 'falkordb', '--uri', FALKORDB_URI!, '--graph-key', GRAPH_KEY, ...extra])

  beforeEach(resetFalkor)
  afterAll(closeFalkor)

  it('sends every command of a generated script to an empty graph', async () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-fk-'))
    const r = apply(emitted(d))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/sent \d+ command\(s\)/)
    const state = await falkorSchemaState()
    expect(state.constraints.some((c) => c.includes('UNIQUE') && c.includes('Person'))).toBe(true)
    expect(state.indexes.length).toBeGreaterThan(0)
  })

  it('reports a constraint that settled FAILED because the stored data defeats it', async () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-fk-'))
    // Two cars sharing a vin: the unique constraint on it can never be enforced.
    await falkorQuery("CREATE (:Car {vin: 'v'}), (:Car {vin: 'v'})")
    const r = apply(emitted(d))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('apply-constraint-failed')
    expect(r.stderr).toMatch(/FAILED/)
  })

  it('imports the graph back to a model file that checks clean', async () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-fk-'))
    expect(apply(emitted(d)).status).toBe(0)
    await falkorQuery("CREATE (:Person:Party {id: 'p', email: 'e', createdAt: 1})-[:OWNS]->(:Car {vin: 'v', seats: 4}), (:Company:Party {id: 'c', createdAt: 2})")
    const out = join(d, 'imported.lpg.yaml')
    const r = run(['import', FALKORDB_URI!, '--graph-key', GRAPH_KEY, '--out', out])
    expect(r.status).toBe(0)
    const written = readFileSync(out, 'utf8')
    expect(written).toContain('extends: Party')
    expect(written).toContain('key: [id]')
    expect(run(['check', out]).stdout).toContain('0 error(s)')
  })

  it('refuses a graph key the server does not hold, and creates no graph', async () => {
    const r = run(['import', FALKORDB_URI!, '--graph-key', 'lpg_no_such_graph'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('import-no-graph')
    const listed = await falkorSend(['GRAPH.LIST'])
    expect((listed as string[]).map(String)).not.toContain('lpg_no_such_graph')
  })

  it('refuses a script line it did not generate, sending nothing', () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-fk-'))
    const script = join(d, 'edited.falkordb.sh')
    writeFileSync(script, readFileSync(emitted(d), 'utf8')
      .replace(/^(\$REDIS_CLI GRAPH\.QUERY.*)$/m, '$1 | tee /tmp/leak.txt'))
    const r = apply(script)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('apply-unreadable-line')
    expect(r.stderr).toContain('tee')
  })
})

// @lat: [[importers#Reading a Memgraph Instance]]
describe.runIf(MEMGRAPH_URI).sequential('lpg apply and import against a running memgraph', () => {
  useMemgraph()
  beforeEach(reset)

  it('applies a generated schema to a fresh instance', async () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-apply-'))
    expect(run(['emit', join(FIXTURES, 'social.lpg.yaml'), '--target', 'memgraph', '--out', d]).status).toBe(0)
    const r = run(['apply', join(d, 'social.memgraph.cypher'), '--target', 'memgraph', '--uri', MEMGRAPH_URI!])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/applied \d+ statement\(s\)/)
    expect((await schemaState()).constraints).toContain('unique Person id')
  })

  it('stops at the first statement the instance refuses, saying what had been applied', async () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-apply-'))
    expect(run(['emit', join(FIXTURES, 'social.lpg.yaml'), '--target', 'memgraph', '--out', d]).status).toBe(0)
    // Two cars sharing a vin: the first statement, Car's key, is refused.
    await runHarness("CREATE (:Car {vin: 'v'}), (:Car {vin: 'v'})")
    const r = run(['apply', join(d, 'social.memgraph.cypher'), '--target', 'memgraph', '--uri', MEMGRAPH_URI!])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/statement 1 of \d+ failed: .*existing node violates it/)
    expect(r.stderr).toContain('0 statement(s) had been applied')
    expect((await schemaState()).constraints).toEqual([])
  })

  it('imports the instance to a model file that checks clean', async () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-apply-'))
    expect(run(['emit', join(FIXTURES, 'social.lpg.yaml'), '--target', 'memgraph', '--out', d]).status).toBe(0)
    expect(run(['apply', join(d, 'social.memgraph.cypher'), '--target', 'memgraph', '--uri', MEMGRAPH_URI!]).status).toBe(0)
    // A Company as well as a Person: Party occurring with more than one label is what reads as a parent.
    await runHarness("CREATE (:Person:Party {id: 'p', email: 'e', createdAt: localDateTime('2020-01-01T00:00:00')})-[:OWNS {since: date('2020-01-01')}]->(:Car {vin: 'v', seats: 4}), (:Company:Party {id: 'c'})")
    const out = join(d, 'imported.lpg.yaml')
    const r = run(['import', MEMGRAPH_URI!, '--out', out])
    expect(r.status).toBe(0)
    const written = readFileSync(out, 'utf8')
    expect(written).toContain('extends: Party')
    expect(run(['check', out]).stdout).toContain('0 error(s)')
  })

  // A Memgraph answers Neo4j's own `SHOW CONSTRAINTS` with an empty list rather than an
  // error, so being read as a Neo4j would look like an instance with no schema at all.
  // @lat: [[importers#Telling Two Bolt Engines Apart]]
  it('is identified as memgraph from what it calls itself, not from the URI', async () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-probe-'))
    expect(run(['emit', join(FIXTURES, 'social.lpg.yaml'), '--target', 'memgraph', '--out', d]).status).toBe(0)
    expect(run(['apply', join(d, 'social.memgraph.cypher'), '--target', 'memgraph', '--uri', MEMGRAPH_URI!]).status).toBe(0)
    const out = join(d, 'probed.lpg.yaml')
    const r = run(['import', MEMGRAPH_URI!, '--out', out])
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('A Memgraph schema holds no edge constraints')
    expect(r.stderr).not.toContain('A Neo4j schema')
    expect(readFileSync(out, 'utf8')).toContain('Car')
  })
})

// @lat: [[importers#Reading a Neo4j Instance]]
describe.runIf(NEO4J_URI).sequential('lpg apply and import against a running neo4j', () => {
  const env = { ...process.env, NEO4J_PASSWORD: NEO4J_PASSWORD }
  const runWithPassword = (args: string[]) => {
    const r = spawnSync('node', [CLI, ...args, '--user', NEO4J_USER], { encoding: 'utf8', env })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }
  const emitted = (d: string) => {
    expect(run(['emit', join(FIXTURES, 'social.lpg.yaml'), '--target', 'neo4j', '--out', d]).status).toBe(0)
    return join(d, 'social.neo4j.cypher')
  }

  beforeEach(resetNeo4j)
  afterAll(closeNeo4j)

  it('applies a generated schema to a fresh instance, and again with no effect', async () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-n4j-'))
    const r = runWithPassword(['apply', emitted(d), '--target', 'neo4j', '--uri', NEO4J_URI!])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/applied \d+ statement\(s\)/)
    const after = await neo4jSchemaState()
    expect(after.constraints.some((c) => c.includes('Person') && c.includes('id'))).toBe(true)

    // Every statement the generator writes carries IF NOT EXISTS.
    expect(runWithPassword(['apply', emitted(d), '--target', 'neo4j', '--uri', NEO4J_URI!]).status).toBe(0)
    expect(await neo4jSchemaState()).toEqual(after)
  })

  it('stops at a constraint the stored data violates, saying what had been applied', async () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-n4j-'))
    await runNeo4j("CREATE (:Car {vin: 'v'}), (:Car {vin: 'v'})")
    const r = runWithPassword(['apply', emitted(d), '--target', 'neo4j', '--uri', NEO4J_URI!])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/statement 1 of \d+ failed:/)
    expect(r.stderr).toContain('0 statement(s) had been applied')
    expect((await neo4jSchemaState()).constraints).toEqual([])
  })

  it('refuses an enterprise script against a Community instance before applying anything', async () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-n4j-'))
    expect(run(['emit', join(FIXTURES, 'social.lpg.yaml'), '--target', 'neo4j',
      '--edition', 'enterprise', '--out', d]).status).toBe(0)
    const r = runWithPassword(['apply', join(d, 'social.neo4j.cypher'), '--target', 'neo4j', '--uri', NEO4J_URI!])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('apply-edition')
    expect(r.stderr).toContain('require Neo4j Enterprise')
    expect((await neo4jSchemaState()).constraints).toEqual([])
  })

  it('imports the instance to a model file that checks clean', async () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-n4j-'))
    expect(runWithPassword(['apply', emitted(d), '--target', 'neo4j', '--uri', NEO4J_URI!]).status).toBe(0)
    await runNeo4j("CREATE (:Person:Party {id: 'p', email: 'e', createdAt: datetime()})-[:OWNS {since: date('2020-01-01')}]->(:Car {vin: 'v', seats: 4}), (:Company:Party {id: 'c'})")
    const out = join(d, 'imported.lpg.yaml')
    const r = runWithPassword(['import', NEO4J_URI!, '--out', out])
    expect(r.status).toBe(0)
    const written = readFileSync(out, 'utf8')
    expect(written).toContain('extends: Party')
    expect(run(['check', out]).stdout).toContain('0 error(s)')
  })

  // @lat: [[importers#Telling Two Bolt Engines Apart]]
  it('is identified as neo4j from what it calls itself, not from the URI', () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-n4j-'))
    expect(runWithPassword(['apply', emitted(d), '--target', 'neo4j', '--uri', NEO4J_URI!]).status).toBe(0)
    const r = runWithPassword(['import', NEO4J_URI!, '--out', join(d, 'probed.lpg.yaml')])
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('A Neo4j schema holds no cardinality')
    expect(r.stderr).not.toContain('A Memgraph schema')
  })

  // @lat: [[importers#Telling Two Bolt Engines Apart]]
  it('lets --from name the engine instead of asking the instance', () => {
    const d = mkdtempSync(join(tmpdir(), 'lpg-n4j-'))
    expect(runWithPassword(['apply', emitted(d), '--target', 'neo4j', '--uri', NEO4J_URI!]).status).toBe(0)
    const r = runWithPassword(['import', NEO4J_URI!, '--from', 'neo4j', '--out', join(d, 'named.lpg.yaml')])
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('A Neo4j schema holds no cardinality')

    // The password follows the engine that was named, so naming the wrong one does not
    // silently borrow the other's credentials.
    const unauthorized = runWithPassword(['import', NEO4J_URI!, '--from', 'memgraph', '--out', join(d, 'wrong.lpg.yaml')])
    expect(unauthorized.status).toBe(1)
    expect(unauthorized.stderr).toContain('cannot connect to memgraph')

    // Given the credentials, naming the wrong engine asks for a schema this instance
    // does not have: Neo4j refuses Memgraph's syntax outright, which is reported rather
    // than producing a model. The reverse is the dangerous direction, and is why the
    // probe exists: a Memgraph answers Neo4j's SHOW CONSTRAINTS with an empty list.
    const wrong = spawnSync('node', [CLI, 'import', NEO4J_URI!, '--from', 'memgraph',
      '--out', join(d, 'wrong.lpg.yaml'), '--user', NEO4J_USER],
    { encoding: 'utf8', env: { ...process.env, MEMGRAPH_PASSWORD: NEO4J_PASSWORD } })
    expect(wrong.status).toBe(1)
    expect(wrong.stderr).toContain('import-catalog')
    expect(existsSync(join(d, 'wrong.lpg.yaml'))).toBe(false)
  })
})
