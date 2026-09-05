import { describe, expect, it, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { newModelSource, parseViews, sidecarPaths } from '@lpg/core'
import { harness } from './vscode.stub'
import { activate } from '../src/extension'
import type { Intent, Projection } from '../src/protocol'

const { Uri, commands } = vscode as unknown as typeof import('./vscode.stub')

function context(): any {
  return { subscriptions: [], extensionUri: Uri.file('/ext') }
}

let root: string
let model: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lpg-canvas-'))
  harness.reset(root)
  model = path.join(root, 'social.lpg.yaml')
  fs.writeFileSync(model, newModelSource({ prefix: 'social', iri: 'https://example.org/vocab/social#' }))
  harness.foundFiles = [Uri.file(model)]
})

/** Open the canvas and hand back the panel, the way the webview bundle drives it. */
async function canvas() {
  activate(context())
  await commands.executeCommand('lpg.openCanvas')
  const panel = harness.panels[0]!
  await panel.send({ type: 'ready' })
  const send = async (m: unknown) => { await panel.send(m) }
  return {
    panel,
    send,
    intent: (intent: Intent) => send({ type: 'intent', intent }),
    /** The most recent diagram the host pushed. */
    latest(): Projection {
      const projections = panel.messages
        .filter((m): m is { type: 'projection'; projection: Projection } =>
          (m as { type?: string }).type === 'projection')
      return projections[projections.length - 1]!.projection
    },
  }
}

const views = () => parseViews(fs.readFileSync(sidecarPaths(model).views, 'utf8')).views

// @lat: [[architecture#Editing Surface#Intents]]
describe('creating types from the canvas', () => {
  it('shows a newly created node type on the diagram in front of the user', async () => {
    const c = await canvas()

    await c.intent({ kind: 'addNode', name: 'Address' })

    expect(c.latest().nodes.map((n) => n.name)).toContain('Address')
    expect(harness.errors).toEqual([])
  })

  it('adds the new type to a view that names its members, so it is not created out of sight', async () => {
    // A view listing its types explicitly would otherwise swallow the new one: the file
    // gains it and the diagram does not, which reads as a button that does nothing.
    fs.writeFileSync(sidecarPaths(model).views, 'views:\n  overview:\n    include: ["Thing"]\n')
    const c = await canvas()

    await c.intent({ kind: 'addNode', name: 'Address' })

    expect(views()[0]!.include).toEqual(['Thing', 'Address'])
    expect(c.latest().nodes.map((n) => n.name)).toContain('Address')
  })

  it('creates the node type and the edge that reaches it, in that order', async () => {
    // The gesture is a connection dropped on empty canvas: the target does not exist yet.
    const c = await canvas()

    // The webview posts both without waiting between them, so the host has to apply
    // them in order: splices computed against the same original text would collide.
    await Promise.all([
      c.intent({ kind: 'addNode', name: 'Address' }),
      c.intent({ kind: 'addEdge', name: 'LIVES_AT', from: 'Thing', to: 'Address' }),
    ])
    // A type created from the canvas has no key yet, which is an error until it does.
    await c.intent({
      kind: 'addProperty', owner: 'Address', ownerKind: 'nodes', name: 'id', propType: 'string',
    })
    await c.intent({ kind: 'setKey', name: 'Address', key: ['id'] })

    const edge = c.latest().edges.find((e) => e.name === 'LIVES_AT')
    expect(edge && [edge.from, edge.to]).toEqual(['Thing', 'Address'])
    expect(c.latest().diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('carries a rename into every view that named the old type', async () => {
    fs.writeFileSync(sidecarPaths(model).views, 'views:\n  overview:\n    include: ["Thing"]\n')
    const c = await canvas()

    await c.intent({ kind: 'renameNode', from: 'Thing', to: 'Place' })

    expect(views()[0]!.include).toEqual(['Place'])
    expect(c.latest().nodes.map((n) => n.name)).toEqual(['Place'])
  })

  it('drops a deleted type from the views sidecar', async () => {
    fs.writeFileSync(sidecarPaths(model).views, 'views:\n  overview:\n    include: ["Thing"]\n')
    const c = await canvas()

    await c.intent({ kind: 'deleteNode', name: 'Thing' })

    expect(views()[0]!.include).toEqual([])
    expect(c.latest().nodes).toEqual([])
  })
})

// @lat: [[metamodel#Type Hierarchy#Mixins]]
describe('authoring a hierarchy from the canvas', () => {
  it('creates a mixin, applies it, and the property lands on the type', async () => {
    const c = await canvas()

    await c.intent({ kind: 'addMixin', name: 'Timestamped' })
    await c.intent({
      kind: 'addProperty', owner: 'Timestamped', ownerKind: 'mixins',
      name: 'createdAt', propType: 'datetime',
    })
    await c.intent({ kind: 'setMixins', name: 'Thing', mixins: ['Timestamped'] })

    const p = c.latest()
    expect(p.mixins.map((m) => m.name)).toEqual(['Timestamped'])
    expect(p.mixins[0]!.appliedBy).toEqual(['Thing'])

    const thing = p.nodes.find((n) => n.name === 'Thing')!
    expect(thing.mixins).toEqual(['Timestamped'])
    const created = thing.props.find((q) => q.name === 'createdAt')!
    // The canvas has to tell a mixin's property from a parent's: one is a bag of
    // properties, the other a supertype.
    expect(created.inheritedFrom).toBe('Timestamped')
    expect(created.inheritedVia).toBe('mixin')
    expect(harness.errors).toEqual([])
  })

  it('marks a property inherited from a parent as coming from one', async () => {
    const c = await canvas()

    await c.intent({ kind: 'addNode', name: 'Party' })
    await c.intent({ kind: 'setAbstract', name: 'Party', abstract: true })
    await c.intent({
      kind: 'addProperty', owner: 'Party', ownerKind: 'nodes', name: 'ref', propType: 'string',
    })
    await c.intent({ kind: 'setAbstractParent', name: 'Thing', parent: 'Party' })

    const thing = c.latest().nodes.find((n) => n.name === 'Thing')!
    expect(thing.ancestors).toEqual(['Party'])
    const ref = thing.props.find((q) => q.name === 'ref')!
    expect(ref.inheritedFrom).toBe('Party')
    expect(ref.inheritedVia).toBe('parent')
  })

  it('deleting a mixin takes it off every type that applied it', async () => {
    const c = await canvas()

    await c.intent({ kind: 'addMixin', name: 'Timestamped' })
    await c.intent({ kind: 'setMixins', name: 'Thing', mixins: ['Timestamped'] })
    await c.intent({ kind: 'deleteMixin', name: 'Timestamped' })

    const p = c.latest()
    expect(p.mixins).toEqual([])
    expect(p.nodes.find((n) => n.name === 'Thing')!.mixins).toEqual([])
    // A type left applying a mixin the model no longer has would not resolve.
    expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })
})

// @lat: [[architecture#Editing Surface#Asking]]
describe('the canvas asks its questions in the document', () => {
  it('never reaches for a dialog the webview sandbox discards', () => {
    // window.prompt, window.confirm and window.alert return without showing anything in
    // a VS Code webview, so an action routed through one silently does nothing at all.
    const dir = path.resolve(__dirname, '..', 'src', 'webview')
    const sources = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f))
    expect(sources.length).toBeGreaterThan(0)
    for (const file of sources) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8')
      expect(text, file).not.toMatch(/\bwindow\.(prompt|confirm|alert)\s*\(/)
    }
  })
})
