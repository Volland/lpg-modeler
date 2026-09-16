import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
      ['falkordb', 'gql', 'ladybug', 'linkml', 'neo4j', 'owl', 'pgschema', 'shacl'])
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
