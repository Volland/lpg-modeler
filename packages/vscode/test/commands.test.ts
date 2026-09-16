import { describe, expect, it, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { newModelSource } from '@lpg/core'
import { harness } from './vscode.stub'
import { activate } from '../src/extension'

const { Uri, commands, window } = vscode as unknown as typeof import('./vscode.stub')

function context(): any {
  return { subscriptions: [], extensionUri: Uri.file('/ext') }
}

/** Anything the extension generated for `stem`, whatever extension the target uses. */
function artifacts(stem: string): string[] {
  return fs.readdirSync(root).filter((f) => f.startsWith(`${stem}.shacl.`))
}

function writeModel(name: string): string {
  const file = path.join(root, `${name}.lpg.yaml`)
  fs.writeFileSync(file, newModelSource({ prefix: name, iri: `https://example.org/vocab/${name}#` }))
  return file
}

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lpg-commands-'))
  harness.reset(root)
})

// @lat: [[architecture#Editing Surface#Reaching a model]]
describe('LPG: Generate Schema', () => {
  it('scaffolds a model when the workspace has none, then generates from it', async () => {
    activate(context())

    harness.inputs = ['social', 'https://example.org/vocab/social#']
    harness.saveDialog = Uri.file(path.join(root, 'social.lpg.yaml'))
    harness.quickPicks = ['shacl']

    await commands.executeCommand('lpg.generate')

    expect(fs.existsSync(path.join(root, 'social.lpg.yaml'))).toBe(true)
    expect(artifacts('social')).toHaveLength(1)
    expect(harness.errors).toEqual([])
  })

  // @lat: [[emitters#Memgraph Target]]
  it('offers memgraph in the command palette pick list', async () => {
    activate(context())
    const file = writeModel('shop')
    harness.foundFiles = [Uri.file(file)]
    harness.quickPicks = ['memgraph']

    await commands.executeCommand('lpg.generate')

    expect(harness.quickPickItems[0]).toContain('memgraph')
    expect(fs.existsSync(path.join(root, 'shop.memgraph.cypher'))).toBe(true)
    expect(harness.errors).toEqual([])
  })

  it('generates from the focused canvas when no text editor is active', async () => {
    activate(context())

    harness.inputs = ['social', 'https://example.org/vocab/social#']
    harness.saveDialog = Uri.file(path.join(root, 'social.lpg.yaml'))
    await commands.executeCommand('lpg.newModel')

    // The canvas has focus, which is precisely when `activeTextEditor` is undefined.
    window.activeTextEditor = undefined
    harness.panels[0].active = true
    harness.quickPicks = ['shacl']

    await commands.executeCommand('lpg.generate')

    // No further prompts were answered, so the scaffold flow was not the path taken.
    expect(harness.inputs).toEqual([])
    expect(artifacts('social')).toHaveLength(1)
    expect(harness.errors).toEqual([])
  })

  it('falls back to the only model in the workspace', async () => {
    writeModel('social')
    harness.foundFiles = [Uri.file(path.join(root, 'social.lpg.yaml'))]
    activate(context())

    harness.quickPicks = ['shacl']

    await commands.executeCommand('lpg.generate')

    expect(artifacts('social')).toHaveLength(1)
    expect(harness.errors).toEqual([])
  })

  it('asks which model when the workspace holds more than one', async () => {
    writeModel('social')
    writeModel('retail')
    harness.foundFiles = [
      Uri.file(path.join(root, 'social.lpg.yaml')),
      Uri.file(path.join(root, 'retail.lpg.yaml')),
    ]
    activate(context())

    harness.quickPicks = ['retail.lpg.yaml', 'shacl']

    await commands.executeCommand('lpg.generate')

    expect(artifacts('retail')).toHaveLength(1)
    expect(artifacts('social')).toEqual([])
    expect(harness.errors).toEqual([])
  })

  it('does nothing when the model pick is cancelled', async () => {
    writeModel('social')
    writeModel('retail')
    harness.foundFiles = [
      Uri.file(path.join(root, 'social.lpg.yaml')),
      Uri.file(path.join(root, 'retail.lpg.yaml')),
    ]
    activate(context())

    harness.quickPicks = [undefined]

    await commands.executeCommand('lpg.generate')

    expect(artifacts('social')).toEqual([])
    expect(artifacts('retail')).toEqual([])
    expect(harness.errors).toEqual([])
  })
})

// @lat: [[importers#Importers]]
describe('LPG: Import Model', () => {
  /** A shapes graph and the ontology beside it, written into the workspace. */
  function artifacts(): vscode.Uri[] {
    const model = writeModel('social')
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'social.lpg.yaml'), 'utf8')
    fs.writeFileSync(model, source)
    const { resolveModel, emit } = require('@lpg/core')
    const resolved = resolveModel(model, (p: string) => {
      try { return fs.readFileSync(p, 'utf8') } catch { return undefined }
    })
    const out: vscode.Uri[] = []
    for (const target of ['shacl', 'owl']) {
      const file = path.join(root, `social.${target}.ttl`)
      fs.writeFileSync(file, emit(resolved.model, target).content)
      out.push(Uri.file(file))
    }
    return out
  }

  it('reads the chosen files into a model, opens it, and opens the canvas', async () => {
    activate(context())
    harness.openDialog = artifacts()
    harness.saveDialog = Uri.file(path.join(root, 'imported.lpg.yaml'))

    await harness.commands.get('lpg.import')?.()

    const written = fs.readFileSync(path.join(root, 'imported.lpg.yaml'), 'utf8')
    expect(written).toContain('extends: Party')
    expect(harness.openedEditors).toContain(path.join(root, 'imported.lpg.yaml'))
    expect(harness.panels.length).toBe(1)
  })

  it('says how much arrived and what could not be carried', async () => {
    activate(context())
    harness.openDialog = artifacts()
    harness.saveDialog = Uri.file(path.join(root, 'imported.lpg.yaml'))

    await harness.commands.get('lpg.import')?.()

    expect(harness.infos.join(' ')).toMatch(/Imported \d+ type\(s\)/)
  })

  it('does nothing when the picker is dismissed', async () => {
    activate(context())
    harness.openDialog = undefined

    await harness.commands.get('lpg.import')?.()

    expect(harness.openedEditors).toEqual([])
  })

  it('warns rather than writing an empty model when nothing was recognised', async () => {
    activate(context())
    const empty = path.join(root, 'empty.ttl')
    fs.writeFileSync(empty, '@prefix ex: <https://example.org/x#> .\n')
    harness.openDialog = [Uri.file(empty)]

    await harness.commands.get('lpg.import')?.()

    expect(harness.warnings.join(' ')).toContain('Nothing was imported')
  })
})
