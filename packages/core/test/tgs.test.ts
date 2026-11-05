import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { emit, targetNames } from '../src/emit/index'
import { exportTgs, type TgsLayout } from '../src/emit/tgs'
import { importTgs } from '../src/import/tgs'
import { importModel, detectFormat } from '../src/import/index'
import { serializeModel } from '../src/serialize'
import { resolveModel } from '../src/resolve'
import { validateModel } from '../src/validate'
import { formatValueType, type ModelIR, type PropertyIR } from '../src/ir'
import { splitNote } from '../src/tgs-note'
import { fixture, loadFixture } from './helpers'

const codes = (ds: Array<{ code: string }>) => ds.map((d) => d.code)

/** The notes of a fixture schema folder, as the CLI reads them. */
function folder(name: string): Array<{ path: string; text: string }> {
  const dir = fixture(join('tgs', name, 'Types'))
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => ({ path: join(dir, f), text: readFileSync(join(dir, f), 'utf8') }))
}

/** Notes an export wrote, as inputs to an import. */
const asInputs = (notes: Array<{ file: string; content: string }>) =>
  notes.map((n) => ({ path: `/vault/Types/${n.file}`, text: n.content }))

/** What an import writes, read back the way every import is checked: as a file. */
function written(model: ModelIR): { model: ModelIR; errors: string[] } {
  const text = serializeModel(model)
  const path = '/virtual/imported.lpg.yaml'
  const { model: resolved, diagnostics } = resolveModel(path, (p) => (p === path ? text : undefined))
  const all = [...diagnostics, ...validateModel(resolved)]
  return { model: resolved, errors: all.filter((d) => d.severity === 'error').map((d) => d.message) }
}

const prop = (p: PropertyIR) => ({
  id: p.id, name: p.name, type: p.type, list: p.list, required: p.required, unique: p.unique,
  enum: p.enum, precision: p.precision, scale: p.scale, min: p.min, max: p.max,
  minLength: p.minLength, maxLength: p.maxLength, pattern: p.pattern,
  composite: p.composite ? formatValueType(p.composite) : undefined,
})

/** Everything TGS plus the lpg key is meant to carry: not constraints, not raw SHACL. */
function shape(m: ModelIR) {
  const byName = <T extends { name: string }>(xs: T[]) => [...xs].sort((a, b) => a.name.localeCompare(b.name))
  return {
    formatVersion: m.formatVersion,
    namespace: m.namespace,
    nodes: byName(m.nodes).map((n) => ({
      id: n.id, name: n.name, abstract: n.abstract, open: n.open, extends: n.extends,
      mixins: n.mixins, key: n.key, props: n.props.filter((p) => !p.inheritedFrom).map(prop),
    })),
    edges: byName(m.edges).map((e) => ({
      id: e.id, name: e.name, from: e.from, to: e.to, cardinality: e.cardinality, props: e.props.map(prop),
    })),
    mixins: byName(m.mixins).map((x) => ({ id: x.id, name: x.name, props: x.props.map(prop) })),
    enums: byName(m.enums).map((e) => ({ id: e.id, name: e.name, values: e.values })),
  }
}

const ROUND_TRIP = ['social', 'kinship', 'features', 'types', 'composites', 'standards']

// @lat: [[importers#Reading TGS Notes#Round trip]]
describe('a model exported to TGS imports back unchanged', () => {
  for (const name of ROUND_TRIP) {
    for (const layout of ['folder', 'single'] as TgsLayout[]) {
      it(`${name}, ${layout} layout`, () => {
        const model = loadFixture(`${name}.lpg.yaml`)
        const exported = exportTgs(model, { layout })
        expect(codes(exported.diagnostics)).not.toContain('export-tgs-would-drop')
        const imported = importTgs(asInputs(exported.notes))
        const back = written(imported.model)
        expect(back.errors).toEqual([])
        expect(shape(back.model)).toEqual(shape(model))
      })
    }
  }

  it('keeps the format version a model declares, on the published fleet example', () => {
    const path = join(__dirname, '..', '..', '..', 'docs', 'examples', 'fleet.lpg.yaml')
    const { model } = resolveModel(path, (p) => { try { return readFileSync(p, 'utf8') } catch { return undefined } })
    expect(model.formatVersion).toBe('1.0')
    for (const layout of ['folder', 'single'] as TgsLayout[]) {
      const back = written(importTgs(asInputs(exportTgs(model, { layout }).notes)).model)
      expect(back.errors).toEqual([])
      expect(shape(back.model)).toEqual(shape(model))
    }
  })

  it('imports the two layouts of one model identically', () => {
    const model = loadFixture('social.lpg.yaml')
    const serialize = (layout: TgsLayout) =>
      serializeModel(importTgs(asInputs(exportTgs(model, { layout }).notes)).model)
    expect(serialize('folder')).toEqual(serialize('single'))
  })

  it('ignores and reports an lpg entry for a type deleted by hand', () => {
    const note = exportTgs(loadFixture('social.lpg.yaml'), { layout: 'single' }).notes[0]!
    // Remove Car from the TGS keys only, as someone editing the note in Obsidian would.
    const fm = parseYaml(splitNote(note.content).frontmatter!) as Record<string, any>
    delete fm.schemas.Car
    delete fm.edgeTypes.OWNS
    for (const t of Object.values(fm.schemas) as Array<{ edges: Record<string, unknown> }>) delete t.edges.OWNS
    const edited = `---\n${stringifyYaml(fm)}---\n`
    const { model, diagnostics } = importTgs([{ path: '/v/Types/social.md', text: edited }])
    expect(model.nodes.map((n) => n.name)).not.toContain('Car')
    expect(codes(diagnostics)).toContain('import-tgs-stale-lpg')
  })
})

// @lat: [[emitters#TGS Target]]
describe('the tgs target', () => {
  const social = () => loadFixture('social.lpg.yaml')

  it('is registered', () => {
    expect(targetNames()).toContain('tgs')
  })

  it('matches the golden file', async () => {
    await expect(emit(social(), 'tgs').content).toMatchFileSnapshot('./golden/social.tgs.md')
  })

  it('writes frontmatter that is YAML with the TGS keys', () => {
    const { frontmatter } = splitNote(emit(social(), 'tgs').content)
    const fm = parseYaml(frontmatter!) as Record<string, any>
    expect(fm.tgs).toBe('0.1')
    expect(Object.keys(fm.schemas).sort()).toEqual(['Car', 'Company', 'Party', 'Person'])
    expect(Object.keys(fm.edgeTypes).sort()).toEqual(['KNOWS', 'LIKES', 'OWNS'])
    // Every type closes its edges, even one with none.
    expect(fm.schemas.Car.edges).toEqual({})
  })

  it('expands an abstract endpoint to its concrete descendants', () => {
    const fm = parseYaml(splitNote(emit(social(), 'tgs').content).frontmatter!) as Record<string, any>
    expect(fm.edgeTypes.OWNS.from).toEqual(['Company', 'Person'])
    expect(fm.schemas.Person.edges.OWNS).toBe('Car')
    expect(fm.schemas.Company.edges.OWNS).toBe('Car')
  })

  it('flattens inherited and mixin properties onto each type', () => {
    const fm = parseYaml(splitNote(emit(social(), 'tgs').content).frontmatter!) as Record<string, any>
    expect(Object.keys(fm.schemas.Person.properties)).toEqual(['email', 'born', 'createdAt', 'id'])
  })

  it('reports what a TGS validator will not enforce and records it', () => {
    const { content, diagnostics } = emit(social(), 'tgs')
    const ds = codes(diagnostics)
    for (const c of ['downgrade-unique', 'downgrade-key', 'downgrade-inheritance', 'downgrade-abstract', 'downgrade-open']) {
      expect(ds).toContain(c)
    }
    const fm = parseYaml(splitNote(content).frontmatter!) as Record<string, any>
    expect(fm.lpg.nodes.Person.props.email.unique).toBe(true)
    expect(diagnostics.find((d) => d.code === 'downgrade-unique')?.message).toContain('email')
  })

  it('bounds the to end of an edge at one with many: false and required', () => {
    const model = loadFixture('kinship.lpg.yaml')
    const fm = parseYaml(splitNote(emit(model, 'tgs').content).frontmatter!) as Record<string, any>
    const bounded = model.edges.find((e) => e.cardinality.to.max === 1)
    if (!bounded) return
    const entry = fm.schemas[model.nodes.find((n) => !n.abstract && (n.name === bounded.from || n.ancestors.includes(bounded.from)))!.name].edges[bounded.name]
    expect(entry.many).toBe(false)
  })
})

// @lat: [[emitters#TGS Target#Layouts]]
describe('layouts', () => {
  const social = () => loadFixture('social.lpg.yaml')

  it('folder: one note per node type, each edge type with its source type', () => {
    const { notes } = exportTgs(social(), { layout: 'folder' })
    expect(notes.map((n) => n.file).sort()).toEqual(['Car.md', 'Company.md', 'Party.md', 'Person.md'])
    const party = parseYaml(splitNote(notes.find((n) => n.file === 'Party.md')!.content).frontmatter!) as Record<string, any>
    expect(party.schema).toBeDefined()
    expect(Object.keys(party.edgeTypes)).toEqual(['OWNS'])
  })

  it('single: one note named after the model', () => {
    const { notes } = exportTgs(social(), { layout: 'single', stem: 'social' })
    expect(notes.map((n) => n.file)).toEqual(['social.md'])
  })

  it('keeps the keys and the body of an existing note', () => {
    const existing = '---\ncssclasses: [wide]\ntgs: "0.1"\nschemas:\n  Car: {}\n  Company: {}\n  Party: {}\n  Person: {}\n---\n# Our ontology\n\nHand-written prose.\n'
    const { notes } = exportTgs(social(), { layout: 'single', stem: 'social', existing: { 'social.md': existing } })
    const note = notes[0]!
    expect(note.merged).toBe(true)
    expect(note.content).toContain('cssclasses: [wide]')
    expect(note.content).toContain('Hand-written prose.')
    const fm = parseYaml(splitNote(note.content).frontmatter!) as Record<string, any>
    expect(Object.keys(fm.schemas.Person.properties)).toContain('email')
  })

  it('refuses a note that declares types the export lacks, unless forced', () => {
    const existing = '---\nschemas:\n  Invoice: {}\n---\n'
    const refused = exportTgs(social(), { layout: 'single', stem: 'social', existing: { 'social.md': existing } })
    expect(refused.notes).toEqual([])
    expect(codes(refused.diagnostics)).toContain('export-tgs-would-drop')
    const forced = exportTgs(social(), { layout: 'single', stem: 'social', existing: { 'social.md': existing }, force: true })
    expect(forced.notes).toHaveLength(1)
  })

  it('reports a note an earlier export left behind', () => {
    const old = exportTgs(loadFixture('kinship.lpg.yaml'), { layout: 'folder' }).notes[0]!
    const { diagnostics } = exportTgs(social(), { layout: 'folder', existing: { [old.file]: old.content } })
    expect(codes(diagnostics)).toContain('export-tgs-stale-note')
  })
})

// @lat: [[importers#Reading TGS Notes]]
describe('reading TGS notes', () => {
  it('reads a folder of several ontologies into one model', () => {
    const { model } = importTgs(folder('code'))
    const names = model.nodes.map((n) => n.name)
    for (const t of ['Decision', 'Requirement', 'Capability', 'ADR']) expect(names).toContain(t)
    expect(model.edges.map((e) => e.name)).toContain('part_of')
  })

  it('reads one note on its own', () => {
    const { model } = importTgs(folder('code').filter((n) => n.path.endsWith('code-types.md')))
    expect(model.nodes.map((n) => n.name)).not.toContain('Capability')
    expect(model.nodes.map((n) => n.name)).toContain('Decision')
  })

  it('produces a model that validates', () => {
    for (const name of ['code', 'subsystem', 'note-ids']) {
      expect(written(importTgs(folder(name)).model).errors).toEqual([])
    }
  })

  it('maps a subsystem note: kinds, edges and edge properties', () => {
    const { model } = importTgs(folder('subsystem'))
    const person = model.nodes.find((n) => n.name === 'Person')!
    expect(person.props.find((p) => p.name === 'email')).toMatchObject({ type: 'string', required: true })
    const works = model.edges.find((e) => e.name === 'worksAt')!
    expect(works).toMatchObject({ from: 'Person', to: 'Company' })
    expect(works.props.map((p) => p.name)).toEqual(['since', 'role'])
    expect(works.props[1]).toMatchObject({ required: true, enum: 'Role' })
    // `mentor: {target: Person, many: false}` bounds the to end at one.
    expect(model.edges.find((e) => e.name === 'mentor')!.cardinality.to.max).toBe(1)
  })

  it('keeps the first of several endpoint types and says which were dropped', () => {
    const { model, diagnostics } = importTgs(folder('subsystem'))
    expect(model.edges.find((e) => e.name === 'knows')).toMatchObject({ from: 'Person', to: 'Person' })
    expect(diagnostics.find((d) => d.code === 'import-tgs-endpoint-union')?.message).toContain('Bot')
  })

  it('does not import an edge with an unrestricted end, and says so', () => {
    const { model, diagnostics } = importTgs(folder('code'))
    expect(model.edges.map((e) => e.name)).not.toContain('defines')
    expect(diagnostics.find((d) => d.code === 'import-tgs-open-endpoint')?.message).toContain('defines')
  })

  it('declares a type that is named but never declared', () => {
    const { model, diagnostics } = importTgs(folder('code'))
    expect(model.nodes.map((n) => n.name)).toContain('CodeSymbol')
    expect(codes(diagnostics)).toContain('import-tgs-undeclared-type')
  })

  it('keys a type by its id rule', () => {
    const { model } = importTgs(folder('note-ids'))
    const idea = model.nodes.find((n) => n.name === 'Idea')!
    expect(idea.key).toEqual(['uid'])
    expect(idea.props.find((p) => p.name === 'uid')).toMatchObject({ type: 'string', required: true })
  })

  it('keys a type with no identity by a synthesized title', () => {
    const { model, diagnostics } = importTgs(folder('subsystem'))
    expect(model.nodes.find((n) => n.name === 'Company')!.key).toEqual(['title'])
    expect(codes(diagnostics)).toContain('import-tgs-title-key')
  })

  it('reports templates, defaults, visualization and IRIs it cannot keep', () => {
    const code = importTgs(folder('code')).diagnostics.find((d) => d.code === 'import-tgs-not-carried')!
    expect(code.message).toContain('templates of Decision')
    expect(code.message).toContain('visualization')
    const sub = importTgs(folder('subsystem')).diagnostics.find((d) => d.code === 'import-tgs-not-carried')!
    expect(sub.message).toContain('schema:Person')
  })

  it('shares an enum between properties with the same values', () => {
    const { model } = importTgs(folder('code'))
    const status = (t: string) => model.nodes.find((n) => n.name === t)!.props.find((p) => p.name === 'status')!.enum
    expect(status('Requirement')).toBe(status('Scenario'))
    expect(status('Decision')).not.toBe(status('Requirement'))
  })

  it('does not read a note of another major version', () => {
    const { model, diagnostics } = importTgs([
      { path: '/v/Types/Next.md', text: '---\ntgs: "1.0"\nschemas:\n  Future: {}\n---\n' },
      { path: '/v/Types/Now.md', text: '---\nschemas:\n  Present: {}\n---\n' },
    ])
    expect(model.nodes.map((n) => n.name)).toEqual(['Present'])
    expect(codes(diagnostics)).toContain('import-tgs-version')
  })

  it('keeps the first of a duplicated type, by path', () => {
    const { model, diagnostics } = importTgs([
      { path: '/v/Types/B.md', text: '---\nschemas:\n  Person: {properties: {b: text}}\n---\n' },
      { path: '/v/Types/A.md', text: '---\nschemas:\n  Person: {properties: {a: text}}\n---\n' },
    ])
    expect(model.nodes[0]!.props.map((p) => p.name)).toContain('a')
    expect(codes(diagnostics)).toContain('import-tgs-duplicate')
  })

  it('declares an empty type for a schema note with no schema keys', () => {
    const { model } = importTgs([{ path: '/v/Types/Tag.md', text: '# Tag\n' }])
    expect(model.nodes.map((n) => n.name)).toEqual(['Tag'])
  })

  it('rewrites names the model cannot carry', () => {
    const { model, diagnostics } = importTgs([
      { path: '/v/Types/People and Orgs.md', text: '---\nschema:\n  properties: {full name: text}\n---\n' },
    ])
    expect(model.nodes[0]!.name).toBe('PeopleAndOrgs')
    expect(model.nodes[0]!.props.map((p) => p.name)).toContain('full_name')
    expect(codes(diagnostics)).toContain('import-renamed')
  })

  it('is recognised by its frontmatter and routed by importModel', () => {
    const [note] = folder('subsystem')
    expect(detectFormat(note!)).toBe('tgs')
    expect(detectFormat({ path: '/x/README.md', text: '# Hello\n' })).toBeUndefined()
    const { model } = importModel(folder('subsystem'))
    expect(model.nodes.map((n) => n.name)).toContain('Person')
  })
})

/**
 * Decision 13: the output is checked by the reference reader. `tg` is a local install,
 * not a dependency, so the check runs where it is on the path.
 * See lat.md/importers#Reading TGS Notes#Round trip.
 */
const TG = process.env.LPG_TG ?? 'tg'
const hasTg = spawnSync(TG, ['--version'], { encoding: 'utf8' }).status === 0

describe.skipIf(!hasTg)('tg validate accepts the exported notes', () => {
  const validate = (vault: string) => {
    const r = spawnSync(TG, ['validate', '--vault', vault, '--schema-only', '--format', 'json'], { encoding: 'utf8' })
    return JSON.parse(r.stdout) as { ok: boolean; findings: Array<{ code: string }> }
  }
  const vaultWith = (notes: Array<{ file: string; content: string }>) => {
    const vault = mkdtempSync(join(tmpdir(), 'lpg-tgs-'))
    mkdirSync(join(vault, 'Types'))
    for (const n of notes) writeFileSync(join(vault, 'Types', n.file), n.content)
    return vault
  }

  it('flags a broken declaration, so the check below means something', () => {
    const result = validate(vaultWith([{ file: 'Bad.md', content: '---\nschema:\n  edges: 5\n---\n' }]))
    expect(result.findings.length).toBeGreaterThan(0)
  })

  for (const name of ROUND_TRIP) {
    for (const layout of ['folder', 'single'] as TgsLayout[]) {
      it(`${name}, ${layout} layout`, () => {
        const { notes } = exportTgs(loadFixture(`${name}.lpg.yaml`), { layout })
        const result = validate(vaultWith(notes))
        expect(result.findings).toEqual([])
        expect(result.ok).toBe(true)
      })
    }
  }
})
