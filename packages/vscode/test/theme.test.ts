import { describe, expect, it, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { newModelSource, resolveModel } from '@lpg/core'
import { harness } from './vscode.stub'
import { activate } from '../src/extension'
import { COLOR_TOKENS, PRESETS, contrast, resolveTheme } from '../src/theme'
import type { HostMessage } from '../src/protocol'

const { Uri, commands } = vscode as unknown as typeof import('./vscode.stub')

let root: string
let model: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lpg-theme-'))
  harness.reset(root)
  model = path.join(root, 'social.lpg.yaml')
  fs.writeFileSync(model, newModelSource({ prefix: 'social', iri: 'https://example.org/vocab/social#' }))
  harness.foundFiles = [Uri.file(model)]
})

async function canvas() {
  activate({ subscriptions: [], extensionUri: Uri.file('/ext') } as any)
  await commands.executeCommand('lpg.openCanvas')
  const panel = harness.panels[0]!
  await panel.send({ type: 'ready' })
  return {
    panel,
    send: async (m: unknown) => { await panel.send(m) },
    themes: () => panel.messages
      .filter((m): m is Extract<HostMessage, { type: 'theme' }> => (m as HostMessage).type === 'theme'),
  }
}

// @lat: [[architecture#Rendering#Canvas Theme#Contrast floor]]
describe('every built-in theme meets the contrast floor', () => {
  // WCAG 2.1: 7:1 for body text, 4.5:1 for secondary text, 3:1 for non-text UI.
  for (const [name, p] of Object.entries(PRESETS)) {
    it(name, () => {
      for (const surface of [p.background, p.box, p.boxHeader]) {
        expect(contrast(p.foreground, surface)).toBeGreaterThanOrEqual(7)
        expect(contrast(p.muted, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(p.accent, surface)).toBeGreaterThanOrEqual(4.5)
      }
      for (const heading of [p.nodeKind, p.edgeKind, p.mixinKind]) {
        expect(contrast(heading, p.background)).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(p.border, p.background)).toBeGreaterThanOrEqual(3)
      expect(contrast(p.border, p.box)).toBeGreaterThanOrEqual(3)
      expect(contrast(p.edge, p.background)).toBeGreaterThanOrEqual(3)
      // The grid is texture: visible, but never louder than a border.
      expect(contrast(p.grid, p.background)).toBeGreaterThan(1.2)
      expect(contrast(p.grid, p.background)).toBeLessThan(contrast(p.border, p.background))
    })
  }

  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })

  it('reads no VS Code color outside the palette block, so nothing escapes the theme', () => {
    // Borrowed panel and widget colors were the original bug: in most themes they sit
    // within a few percent of the editor background. Only the token block may read one.
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'webview', 'styles.css'), 'utf8')
    const afterPalette = css.slice(css.indexOf('.export-light {'))
    const uses = afterPalette.match(/var\(--vscode-[a-zA-Z-]+/g) ?? []
    expect(uses.filter((u) => u !== 'var(--vscode-font-family')).toEqual([])
  })

  it('draws the key toggle in a palette color, not the browser default', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'webview', 'styles.css'), 'utf8')
    expect(css).toMatch(/\.erd-key \{[^}]*color: var\(--muted\)/)
    expect(css).toMatch(/\.erd-key\.on \{[^}]*color: var\(--accent\)/)
  })
})

// @lat: [[architecture#Rendering#Canvas Theme#Presets and overrides]]
describe('a theme and the user overrides combine', () => {
  it('fills every token for a preset', () => {
    const { colors, overridden } = resolveTheme('solarizedDark', {})
    expect(Object.keys(colors).sort()).toEqual([...COLOR_TOKENS].sort())
    expect(overridden).toEqual([])
  })

  it('leaves auto to the stylesheet except for what the user set', () => {
    expect(resolveTheme('auto', { edge: '#FF0000' })).toEqual(
      { theme: 'auto', colors: { edge: '#ff0000' }, overridden: ['edge'] })
  })

  it('replaces one token of a preset and keeps the rest', () => {
    const { colors } = resolveTheme('black', { edge: '#ff0000' })
    expect(colors.edge).toBe('#ff0000')
    expect(colors.background).toBe(PRESETS.black.background)
  })

  it('ignores a value that is not a hex color, and an unknown theme', () => {
    const { theme, colors } = resolveTheme('neon', { border: 'red-ish', box: '' })
    expect(theme).toBe('auto')
    expect(colors).toEqual({})
  })
})

// @lat: [[architecture#Rendering#Canvas Theme#Settings as the store]]
describe('the canvas and the settings stay one store', () => {
  it('sends the palette before the first diagram', async () => {
    harness.config.set('lpg.canvas.theme', 'white')
    const c = await canvas()
    const types = c.panel.messages.map((m) => (m as HostMessage).type)
    expect(types.indexOf('theme')).toBeLessThan(types.indexOf('projection'))
    expect(c.themes()[0]!.colors.background).toBe('#ffffff')
  })

  it('redraws an open canvas when the setting changes', async () => {
    const c = await canvas()
    await vscode.workspace.getConfiguration('lpg').update('canvas.theme', 'solarizedDark', 1)
    expect(c.themes().at(-1)!.theme).toBe('solarizedDark')
    expect(c.themes().at(-1)!.colors.background).toBe(PRESETS.solarizedDark.background)
  })

  it('writes the toolbar choice to user settings and leaves the model alone', async () => {
    const c = await canvas()
    const before = fs.readFileSync(model, 'utf8')
    const files = fs.readdirSync(root).sort()

    await c.send({ type: 'setTheme', theme: 'solarizedLight' })
    await c.send({ type: 'setColor', token: 'border', value: '#123456' })

    expect(harness.config.get('lpg.canvas.theme')).toBe('solarizedLight')
    expect(harness.config.get('lpg.canvas.colors.border')).toBe('#123456')
    expect(c.themes().at(-1)).toMatchObject({
      theme: 'solarizedLight', overridden: ['border'], colors: { border: '#123456' },
    })
    expect(fs.readFileSync(model, 'utf8')).toBe(before)
    expect(fs.readdirSync(root).sort()).toEqual(files)
    expect(harness.errors).toEqual([])
  })

  it('clears an override on reset, and refuses a malformed color or theme', async () => {
    const c = await canvas()
    await c.send({ type: 'setColor', token: 'border', value: '#123456' })
    await c.send({ type: 'setColor', token: 'border', value: undefined })
    await c.send({ type: 'setColor', token: 'edge', value: 'javascript:alert(1)' })
    await c.send({ type: 'setTheme', theme: 'neon' })

    expect(harness.config.has('lpg.canvas.colors.border')).toBe(false)
    expect(harness.config.has('lpg.canvas.colors.edge')).toBe(false)
    expect(harness.config.has('lpg.canvas.theme')).toBe(false)
    expect(c.themes().at(-1)!.overridden).toEqual([])
  })
})

// @lat: [[architecture#Editing Surface#Inspector#Choosing the key]]
describe('the key is chosen in the inspector', () => {
  it('writes a composite key, and clears it', async () => {
    const c = await canvas()
    const intent = (i: unknown) => c.send({ type: 'intent', intent: i })
    await intent({ kind: 'addNode', name: 'Passport' })
    await intent({ kind: 'addProperty', owner: 'Passport', ownerKind: 'nodes', name: 'country', propType: 'string' })
    await intent({ kind: 'addProperty', owner: 'Passport', ownerKind: 'nodes', name: 'number', propType: 'string' })

    // What the checklist posts after ticking both boxes: the ticked names in property order.
    await intent({ kind: 'setKey', name: 'Passport', key: ['country', 'number'] })
    const keyOf = () => resolveModel(model, (p) => fs.readFileSync(p, 'utf8'))
      .model.nodes.find((n) => n.name === 'Passport')!.key
    expect(keyOf()).toEqual(['country', 'number'])

    await intent({ kind: 'setKey', name: 'Passport', key: [] })
    expect(keyOf()).toEqual([])
    expect(harness.errors).toEqual([])
  })
})
