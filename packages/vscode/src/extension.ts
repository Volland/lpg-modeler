import * as vscode from 'vscode'
import * as path from 'node:path'
import {
  DEFAULT_VIEW, addToView, addView, applyEdits, backfillIdEdits, emit, parseLayout,
  parseViews, projectView, pruneLayout, removeFromView, resolveModel, serializeLayout,
  serializeViews, setPosition, sidecarPaths, targetNames, validateModel,
  type Diagnostic, type Layout, type ModelIR, type TextEdit, type ViewDef,
} from '@lpg/core'
import type { HostMessage, Intent, Projection, ViewMessage, WireProperty } from './protocol'
import { intentToEdits } from './intents'

const MODEL_GLOB = '**/*.lpg.{yaml,yml}'
const isModelFile = (doc: vscode.TextDocument) => /\.lpg\.ya?ml$/.test(doc.uri.fsPath)

/** Read through open editors first, so an unsaved buffer is what the canvas shows. */
function makeReader(): (p: string) => string | undefined {
  return (p) => {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === p)
    if (open) return open.getText()
    try {
      return require('node:fs').readFileSync(p, 'utf8') as string
    } catch {
      return undefined
    }
  }
}

function toRange(doc: vscode.TextDocument, range: [number, number]): vscode.Range {
  return new vscode.Range(doc.positionAt(range[0]), doc.positionAt(range[1]))
}

const SEVERITY: Record<Diagnostic['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
}

// --- Sidecars ----------------------------------------------------------------

async function readSidecar(p: string): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(p))).toString('utf8')
  } catch {
    return undefined
  }
}

async function writeSidecar(p: string, content: string): Promise<void> {
  await vscode.workspace.fs.writeFile(vscode.Uri.file(p), Buffer.from(content, 'utf8'))
}

async function loadViews(modelPath: string): Promise<ViewDef[]> {
  const text = await readSidecar(sidecarPaths(modelPath).views)
  return text ? parseViews(text).views : [DEFAULT_VIEW]
}

async function loadLayout(modelPath: string): Promise<Layout> {
  const text = await readSidecar(sidecarPaths(modelPath).layout)
  return text ? parseLayout(text) : {}
}

// --- Canvas ------------------------------------------------------------------

class Canvas {
  private lastValid: Projection | undefined
  private activeView = DEFAULT_VIEW.name

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly modelUri: vscode.Uri,
    private readonly diagnostics: vscode.DiagnosticCollection,
    extensionUri: vscode.Uri,
  ) {
    panel.webview.html = this.html(extensionUri)
    panel.webview.onDidReceiveMessage((m: ViewMessage) => void this.onMessage(m))
  }

  get modelPath(): string { return this.modelUri.fsPath }

  private post(message: HostMessage): void {
    void this.panel.webview.postMessage(message)
  }

  private html(extensionUri: vscode.Uri): string {
    const script = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview.js'))
    const styles = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview.css'))
    const nonce = Math.random().toString(36).slice(2)
    const csp = [
      `default-src 'none'`,
      `img-src ${this.panel.webview.cspSource} data:`,
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ')
    return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${styles}">
</head><body><div id="root"></div>
<script nonce="${nonce}" src="${script}"></script>
</body></html>`
  }

  /** Resolve, validate, publish diagnostics, and push a projection to the canvas. */
  async refresh(): Promise<void> {
    const read = makeReader()
    const text = read(this.modelPath)
    if (text === undefined) {
      this.post({ type: 'invalid', message: 'Model file cannot be read.' })
      return
    }

    const { model, diagnostics } = resolveModel(this.modelPath, read)
    const views = await loadViews(this.modelPath)
    const all = [...diagnostics, ...validateModel(model, views)]
    await this.publishDiagnostics(all)

    // A file that will not parse leaves the last good diagram on screen.
    const fatal = all.some((d) => d.code === 'yaml-syntax' || d.code === 'malformed-model')
    if (fatal && this.lastValid) {
      this.post({ type: 'invalid', message: 'Model file is not valid YAML. Showing the last valid diagram.' })
      return
    }

    if (!views.some((v) => v.name === this.activeView)) {
      this.activeView = views[0]?.name ?? DEFAULT_VIEW.name
    }
    const view = views.find((v) => v.name === this.activeView) ?? DEFAULT_VIEW
    const projection = projectView(model, view)
    const layout = await loadLayout(this.modelPath)

    const wireProps = (props: ModelIR['nodes'][number]['props'], key: string[]): WireProperty[] =>
      props.map((p) => ({
        id: p.id, name: p.name, type: p.type, required: p.required, unique: p.unique,
        isKey: key.includes(p.name),
        ...(p.inheritedFrom ? { inheritedFrom: p.inheritedFrom } : {}),
      }))

    this.lastValid = {
      views: views.map((v) => v.name),
      activeView: this.activeView,
      nodes: projection.nodes.map((n) => ({
        id: n.id, name: n.name, abstract: n.abstract,
        ...(n.extends ? { extends: n.extends } : {}),
        props: wireProps(n.props, n.key),
      })),
      edges: projection.edges.map((e) => ({
        id: e.id, name: e.name, from: e.from, to: e.to, props: wireProps(e.props, []),
      })),
      positions: layout[this.activeView] ?? {},
      diagnostics: all.map((d) => ({
        severity: d.severity, code: d.code, message: d.message,
        ...(d.target ? { target: d.target } : {}),
      })),
      targets: targetNames(),
    }
    this.post({ type: 'projection', projection: this.lastValid })
  }

  private async publishDiagnostics(all: Diagnostic[]): Promise<void> {
    const byFile = new Map<string, vscode.Diagnostic[]>()
    for (const d of all) {
      const file = d.loc?.file ?? this.modelPath
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file)).then(
        (x) => x, () => undefined)
      if (!doc) continue
      const range = d.loc ? toRange(doc, d.loc.range) : new vscode.Range(0, 0, 0, 0)
      const item = new vscode.Diagnostic(range,
        d.target ? `[${d.target}] ${d.message}` : d.message, SEVERITY[d.severity])
      item.source = 'lpg'
      item.code = d.code
      byFile.set(file, [...(byFile.get(file) ?? []), item])
    }
    this.diagnostics.clear()
    for (const [file, items] of byFile) {
      this.diagnostics.set(vscode.Uri.file(file), items)
    }
  }

  /** Apply core-produced text edits to the model document. VS Code owns undo. */
  private async applyToModel(edits: TextEdit[]): Promise<void> {
    if (edits.length === 0) return
    const doc = await vscode.workspace.openTextDocument(this.modelUri)
    const workspaceEdit = new vscode.WorkspaceEdit()
    for (const e of edits) {
      workspaceEdit.replace(this.modelUri, toRange(doc, [e.start, e.end]), e.newText)
    }
    await vscode.workspace.applyEdit(workspaceEdit)
  }

  private async onMessage(message: ViewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.refresh()
        return

      case 'move': {
        // Position only: the model file must not change. lat.md/architecture#Views
        const paths = sidecarPaths(this.modelPath)
        const layout = await loadLayout(this.modelPath)
        const next = setPosition(layout, this.activeView, message.elementId,
          { x: message.x, y: message.y })
        await writeSidecar(paths.layout, serializeLayout(next))
        return
      }

      case 'selectView':
        this.activeView = message.name
        await this.refresh()
        return

      case 'createView': {
        const paths = sidecarPaths(this.modelPath)
        const existing = await readSidecar(paths.views)
        const file = existing ? parseViews(existing) : { views: [DEFAULT_VIEW] }
        await writeSidecar(paths.views, serializeViews(addView(file, message.name, [])))
        this.activeView = message.name
        await this.refresh()
        return
      }

      case 'setViewMembership': {
        const paths = sidecarPaths(this.modelPath)
        const existing = await readSidecar(paths.views)
        const file = existing ? parseViews(existing) : { views: [DEFAULT_VIEW] }
        const next = message.include
          ? addToView(file, message.view, message.name)
          : removeFromView(file, message.view, message.name)
        await writeSidecar(paths.views, serializeViews(next))
        await this.refresh()
        return
      }

      case 'generate':
        await generate(this.modelPath, message.target)
        return

      case 'intent':
        await this.applyIntent(message.intent)
        await this.refresh()
        return
    }
  }

  private async applyIntent(intent: Intent): Promise<void> {
    const read = makeReader()
    const text = read(this.modelPath)
    if (text === undefined) return

    const edits = intentToEdits(text, intent, this.modelPath, read)
    await this.applyToModel(edits)

    // Any element created by an intent needs an id before it can hold a position.
    const after = makeReader()(this.modelPath)
    if (after !== undefined) {
      const idEdits = backfillIdEdits(after)
      if (idEdits.length > 0) await this.applyToModel(idEdits)
    }
  }
}

// --- Generation --------------------------------------------------------------

async function generate(modelPath: string, target: string): Promise<void> {
  const read = makeReader()
  const { model, diagnostics } = resolveModel(modelPath, read)
  const views = await loadViews(modelPath)
  const errors = [...diagnostics, ...validateModel(model, views)]
    .filter((d) => d.severity === 'error')
  if (errors.length > 0) {
    void vscode.window.showErrorMessage(
      `Cannot generate ${target}: the model has ${errors.length} error(s). See the Problems panel.`)
    return
  }

  const edition = vscode.workspace.getConfiguration('lpg')
    .get<'community' | 'enterprise'>('targets.neo4j.edition', 'community')
  const result = emit(model, target, { neo4jEdition: edition })
  if (result.diagnostics.some((d) => d.severity === 'error')) {
    void vscode.window.showErrorMessage(`Cannot generate ${target}.`)
    return
  }

  const stem = path.basename(modelPath).replace(/\.lpg\.ya?ml$/, '')
  const outPath = path.join(path.dirname(modelPath), `${stem}.${target}.${result.extension}`)
  await writeSidecar(outPath, result.content)

  const downgrades = result.diagnostics.filter((d) => d.severity === 'warning')
  if (downgrades.length > 0) {
    void vscode.window.showWarningMessage(
      `Generated ${target} with ${downgrades.length} downgrade(s). The artifact records each one.`)
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(outPath))
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside })
}

// --- Activation --------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('lpg')
  context.subscriptions.push(diagnostics)

  const canvases = new Map<string, Canvas>()

  const openCanvas = async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri
    if (!target || !/\.lpg\.ya?ml$/.test(target.fsPath)) {
      void vscode.window.showErrorMessage('Open a .lpg.yaml model file first.')
      return
    }
    const existing = canvases.get(target.fsPath)
    if (existing) { await existing.refresh(); return }

    const panel = vscode.window.createWebviewPanel(
      'lpg.canvas', `LPG: ${path.basename(target.fsPath)}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')] })
    const canvas = new Canvas(panel, target, diagnostics, context.extensionUri)
    canvases.set(target.fsPath, canvas)
    panel.onDidDispose(() => canvases.delete(target.fsPath))
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('lpg.openCanvas', () => void openCanvas()),
    vscode.commands.registerCommand('lpg.generate', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri
      if (!uri || !/\.lpg\.ya?ml$/.test(uri.fsPath)) {
        void vscode.window.showErrorMessage('Open a .lpg.yaml model file first.')
        return
      }
      const target = await vscode.window.showQuickPick(targetNames(), { title: 'Generate schema for' })
      if (target) await generate(uri.fsPath, target)
    }),
  )

  // Typing in the model file re-renders the canvas: the file is the source of truth.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!isModelFile(e.document)) return
      for (const canvas of canvases.values()) void canvas.refresh()
    }),
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (!isModelFile(doc)) return
      await validateOnly(doc, diagnostics)
    }),
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!isModelFile(doc)) return
      // Prune positions for elements that no longer exist.
      const read = makeReader()
      const { model } = resolveModel(doc.uri.fsPath, read)
      const paths = sidecarPaths(doc.uri.fsPath)
      const existing = await readSidecar(paths.layout)
      if (existing) await writeSidecar(paths.layout, serializeLayout(pruneLayout(parseLayout(existing), model)))
    }),
  )

  void vscode.workspace.findFiles(MODEL_GLOB, '**/node_modules/**').then(async (uris) => {
    for (const uri of uris) {
      const doc = await vscode.workspace.openTextDocument(uri)
      await validateOnly(doc, diagnostics)
    }
  })
}

async function validateOnly(
  doc: vscode.TextDocument, collection: vscode.DiagnosticCollection,
): Promise<void> {
  const read = makeReader()
  const { model, diagnostics } = resolveModel(doc.uri.fsPath, read)
  const views = await loadViews(doc.uri.fsPath)
  const all = [...diagnostics, ...validateModel(model, views)]
  collection.set(doc.uri, all
    .filter((d) => !d.loc || d.loc.file === doc.uri.fsPath)
    .map((d) => {
      const range = d.loc ? toRange(doc, d.loc.range) : new vscode.Range(0, 0, 0, 0)
      const item = new vscode.Diagnostic(range,
        d.target ? `[${d.target}] ${d.message}` : d.message, SEVERITY[d.severity])
      item.source = 'lpg'
      item.code = d.code
      return item
    }))
}

export function deactivate(): void { /* nothing to clean up */ }
