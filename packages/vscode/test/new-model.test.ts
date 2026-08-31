import { describe, expect, it, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { harness } from './vscode.stub'
import { activate } from '../src/extension'

const { Uri, commands } = vscode as unknown as typeof import('./vscode.stub')

function context(): any {
  return { subscriptions: [], extensionUri: Uri.file('/ext') }
}

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lpg-new-model-'))
  harness.reset(root)
})

describe('LPG: New Model', () => {
  it('writes the scaffold, opens it, and opens the canvas on it', async () => {
    activate(context())

    harness.inputs = ['social', 'https://example.org/vocab/social#']
    harness.saveDialog = Uri.file(path.join(root, 'social.lpg.yaml'))

    await commands.executeCommand('lpg.newModel')

    const written = path.join(root, 'social.lpg.yaml')
    expect(fs.existsSync(written)).toBe(true)
    expect(fs.readFileSync(written, 'utf8')).toContain('social')
    expect(harness.errors).toEqual([])
    expect(harness.openedEditors).toContain(written)
    expect(harness.panels).toHaveLength(1)
  })

  it('forces the .lpg.yaml suffix when the save dialog returns a plain .yaml name', async () => {
    activate(context())

    harness.inputs = ['social', 'https://example.org/vocab/social#']
    harness.saveDialog = Uri.file(path.join(root, 'social.yaml'))

    await commands.executeCommand('lpg.newModel')

    expect(fs.existsSync(path.join(root, 'social.lpg.yaml'))).toBe(true)
    expect(harness.errors).toEqual([])
  })

  // @lat: [[architecture#Editing Surface#Command failures]]
  it('reports a failure instead of dying silently', async () => {
    activate(context())

    harness.inputs = ['social', 'https://example.org/vocab/social#']
    // A directory that cannot be written: the flow must say so, not vanish.
    harness.saveDialog = Uri.file(path.join(root, 'nope.lpg.yaml'))
    fs.mkdirSync(path.join(root, 'nope.lpg.yaml'))

    await commands.executeCommand('lpg.newModel')

    expect(harness.errors.join(' ')).toMatch(/model/i)
  })

  it('does nothing when the prefix prompt is cancelled', async () => {
    activate(context())

    harness.inputs = [undefined]

    await commands.executeCommand('lpg.newModel')

    expect(fs.readdirSync(root)).toEqual([])
    expect(harness.errors).toEqual([])
  })
})
