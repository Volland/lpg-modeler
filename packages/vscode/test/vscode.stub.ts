/**
 * Enough of the `vscode` module to drive the extension host entry point in a test.
 * Only the surface `src/extension.ts` actually touches is implemented; anything the
 * extension calls that is missing here fails loudly, which is the point.
 */
import * as fs from 'node:fs'
import * as nodePath from 'node:path'

export class Uri {
  private constructor(readonly fsPath: string) {}
  static file(p: string): Uri { return new Uri(p) }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(nodePath.join(base.fsPath, ...parts))
  }
  get path(): string { return this.fsPath }
  toString(): string { return `file://${this.fsPath}` }
}

export class Position {
  constructor(readonly line: number, readonly character: number) {}
}

export class Range {
  readonly start: Position
  readonly end: Position
  /** Both forms the real constructor takes: two positions, or four line/character numbers. */
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    if (typeof a === 'number') {
      this.start = new Position(a, b as number)
      this.end = new Position(c ?? 0, d ?? 0)
    } else {
      this.start = a
      this.end = b as Position
    }
  }
}

export enum DiagnosticSeverity { Error = 0, Warning = 1, Information = 2, Hint = 3 }
export enum ViewColumn { One = 1, Beside = -2 }

export class Diagnostic {
  source?: string
  code?: string
  constructor(readonly range: Range, readonly message: string, readonly severity: DiagnosticSeverity) {}
}

export class WorkspaceEdit {
  readonly edits: { uri: Uri; range: Range; newText: string }[] = []
  replace(uri: Uri, range: Range, newText: string): void { this.edits.push({ uri, range, newText }) }
}

class TextDocument {
  constructor(readonly uri: Uri, private text: string) {}
  getText(): string { return this.text }
  get lineCount(): number { return this.text.split('\n').length }
  lineAt(line: number): { text: string } { return { text: this.text.split('\n')[line] ?? '' } }
  positionAt(offset: number): Position {
    const before = this.text.slice(0, offset).split('\n')
    return new Position(before.length - 1, (before.at(-1) ?? '').length)
  }
  offsetAt(p: Position): number {
    const lines = this.text.split('\n')
    return lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character
  }
}

/** Everything the test steers: queued answers, and a record of what the extension did. */
export const harness = {
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  inputs: [] as (string | undefined)[],
  saveDialog: undefined as Uri | undefined,
  /** Answers to successive quick picks, in order: a flow can ask more than once. */
  quickPicks: [] as (string | undefined)[],
  /** What `findFiles` returns, i.e. the model files the workspace holds. */
  foundFiles: [] as Uri[],
  errors: [] as string[],
  warnings: [] as string[],
  openedEditors: [] as string[],
  panels: [] as FakePanel[],
  workspaceRoot: undefined as string | undefined,
  reset(root: string) {
    this.commands.clear()
    this.inputs = []
    this.saveDialog = undefined
    this.quickPicks = []
    this.foundFiles = []
    this.errors = []
    this.warnings = []
    this.openedEditors = []
    this.panels = []
    this.workspaceRoot = root
    window.activeTextEditor = undefined
    workspace.textDocuments = []
  },
}

class FakePanel {
  disposed = false
  /** A real panel takes focus on creation; a test says so explicitly instead. */
  active = false
  readonly messages: unknown[] = []
  private readonly listeners: ((m: unknown) => unknown)[] = []
  readonly webview = {
    html: '',
    cspSource: 'vscode-webview:',
    asWebviewUri: (u: Uri) => u,
    postMessage: (m: unknown) => { this.messages.push(m); return Promise.resolve(true) },
    onDidReceiveMessage: (cb: (m: unknown) => unknown) => { this.listeners.push(cb); return { dispose() {} } },
  }
  constructor(readonly viewType: string, readonly title: string) {}
  onDidDispose(_cb: () => void): { dispose(): void } { return { dispose() {} } }
  /**
   * Drive the webview -> host direction the way the real bundle does. The host's handler
   * is async, so the promise comes back and a test can await what the message did.
   */
  send(message: unknown): Promise<unknown[]> {
    return Promise.all(this.listeners.map((cb) => cb(message)))
  }
}

export const commands = {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown) {
    harness.commands.set(id, handler)
    return { dispose() {} }
  },
  executeCommand(id: string, ...args: unknown[]) {
    const handler = harness.commands.get(id)
    if (!handler) throw new Error(`command not registered: ${id}`)
    return handler(...args)
  },
}

export const languages = {
  createDiagnosticCollection(_name: string) {
    const store = new Map<string, Diagnostic[]>()
    return {
      set: (uri: Uri, items: Diagnostic[]) => store.set(uri.fsPath, items),
      clear: () => store.clear(),
      dispose: () => store.clear(),
      get entries() { return [...store] },
    }
  },
}

export const window = {
  activeTextEditor: undefined as { document: TextDocument } | undefined,
  showInputBox: (_opts?: unknown) => Promise.resolve(harness.inputs.shift()),
  showSaveDialog: (_opts?: unknown) => Promise.resolve(harness.saveDialog),
  showQuickPick: (_items: unknown, _opts?: unknown) => Promise.resolve(harness.quickPicks.shift()),
  showErrorMessage: (m: string) => { harness.errors.push(m); return Promise.resolve(undefined) },
  showWarningMessage: (m: string) => { harness.warnings.push(m); return Promise.resolve(undefined) },
  showTextDocument: (doc: TextDocument, _opts?: unknown) => {
    harness.openedEditors.push(doc.uri.fsPath)
    window.activeTextEditor = { document: doc }
    return Promise.resolve({ document: doc })
  },
  createWebviewPanel(viewType: string, title: string, _column: ViewColumn, _opts?: unknown) {
    const panel = new FakePanel(viewType, title)
    harness.panels.push(panel)
    return panel
  },
}

const noop = () => ({ dispose() {} })

export const workspace = {
  get workspaceFolders() {
    return harness.workspaceRoot ? [{ uri: Uri.file(harness.workspaceRoot), index: 0, name: 'test' }] : undefined
  },
  textDocuments: [] as TextDocument[],
  fs: {
    writeFile: async (uri: Uri, content: Uint8Array) => {
      await fs.promises.mkdir(nodePath.dirname(uri.fsPath), { recursive: true })
      await fs.promises.writeFile(uri.fsPath, content)
    },
    readFile: async (uri: Uri) => fs.promises.readFile(uri.fsPath),
  },
  openTextDocument: async (target: Uri | string) => {
    const p = typeof target === 'string' ? target : target.fsPath
    const doc = new TextDocument(Uri.file(p), await fs.promises.readFile(p, 'utf8'))
    workspace.textDocuments = [...workspace.textDocuments.filter((d) => d.uri.fsPath !== p), doc]
    return doc
  },
  /**
   * Really apply the edit. A stub that swallowed it would let every canvas flow pass
   * without the model file ever changing, which is the one thing those flows do.
   */
  applyEdit: async (edit: WorkspaceEdit) => {
    const byFile = new Map<string, { start: number; end: number; newText: string }[]>()
    for (const e of edit.edits) {
      const doc = new TextDocument(e.uri, await fs.promises.readFile(e.uri.fsPath, 'utf8'))
      byFile.set(e.uri.fsPath, [
        ...(byFile.get(e.uri.fsPath) ?? []),
        { start: doc.offsetAt(e.range.start), end: doc.offsetAt(e.range.end), newText: e.newText },
      ])
    }
    for (const [p, edits] of byFile) {
      let text = await fs.promises.readFile(p, 'utf8')
      // Back to front, so an earlier edit's offsets stay valid.
      for (const e of [...edits].sort((a, b) => b.start - a.start)) {
        text = text.slice(0, e.start) + e.newText + text.slice(e.end)
      }
      await fs.promises.writeFile(p, text)
      const doc = new TextDocument(Uri.file(p), text)
      workspace.textDocuments = [...workspace.textDocuments.filter((d) => d.uri.fsPath !== p), doc]
    }
    return true
  },
  findFiles: async (_glob: string, _exclude?: string) => harness.foundFiles,
  getConfiguration: (_section?: string) => ({ get: <T>(_key: string, fallback: T) => fallback }),
  onDidChangeTextDocument: noop,
  onDidOpenTextDocument: noop,
  onDidSaveTextDocument: noop,
}
