import { resolveModel } from './resolve'
import { validateModel } from './validate'
import { emit, targetNames } from './emit/index'
import type { Diagnostic } from './ir'

/**
 * The entry the documentation site's playground is bundled from: parse, resolve,
 * validate and emit, with nothing that needs a filesystem, an editor or a native
 * runtime. A model pasted into a page has no neighbours, so an import resolves to
 * nothing and is reported as the CLI would report a missing file.
 * See lat.md/playground#Playground.
 */

const FILE = '/playground.lpg.yaml'

export interface PlaygroundDiagnostic {
  severity: Diagnostic['severity']
  code: string
  message: string
  target?: string
  /** 1-based, present when the diagnostic points into the pasted model. */
  line?: number
  column?: number
}

export interface PlaygroundResult {
  diagnostics: PlaygroundDiagnostic[]
  /** Absent when the model has errors: like the CLI, nothing is generated from one. */
  artifact?: { target: string; extension: string; content: string }
}

function place(text: string, d: Diagnostic): PlaygroundDiagnostic {
  const out: PlaygroundDiagnostic = {
    severity: d.severity, code: d.code, message: d.message, ...(d.target ? { target: d.target } : {}),
  }
  if (d.loc && d.loc.file === FILE) {
    const before = text.slice(0, d.loc.range[0])
    out.line = before.split('\n').length
    out.column = d.loc.range[0] - (before.lastIndexOf('\n') + 1) + 1
  }
  return out
}

/** The targets the page offers: every one, since none of them touches a runtime. */
export const targets = (): string[] => targetNames()

export function run(text: string, target?: string): PlaygroundResult {
  const { model, diagnostics } = resolveModel(FILE, (p) => (p === FILE ? text : undefined))
  const all = [...diagnostics, ...validateModel(model)]
  if (all.some((d) => d.severity === 'error') || !target) {
    return { diagnostics: all.map((d) => place(text, d)) }
  }
  const result = emit(model, target, {})
  return {
    diagnostics: [...all, ...result.diagnostics].map((d) => place(text, d)),
    artifact: { target: result.target, extension: result.extension, content: result.content },
  }
}
