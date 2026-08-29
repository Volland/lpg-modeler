#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve as resolvePath, basename } from 'node:path'
import {
  applyEdits, backfillIdEdits, emit, parseViews, resolveModel, sidecarPaths,
  targetNames, validateModel, type Diagnostic, type EmitOptions,
} from '@lpg/core'

const read = (p: string): string | undefined => {
  try { return readFileSync(p, 'utf8') } catch { return undefined }
}

/** Character offset -> line:column, so diagnostics point at something a human can find. */
function position(text: string, offset: number): string {
  const upto = text.slice(0, offset)
  const line = upto.split('\n').length
  const col = offset - (upto.lastIndexOf('\n') + 1) + 1
  return `${line}:${col}`
}

function report(diagnostics: Diagnostic[]): { errors: number; warnings: number } {
  let errors = 0, warnings = 0
  const cache = new Map<string, string>()
  for (const d of diagnostics) {
    if (d.severity === 'error') errors++
    else if (d.severity === 'warning') warnings++
    let where = ''
    if (d.loc) {
      let text = cache.get(d.loc.file)
      if (text === undefined) { text = read(d.loc.file) ?? ''; cache.set(d.loc.file, text) }
      where = `${d.loc.file}:${position(text, d.loc.range[0])} `
    }
    const tag = d.target ? `[${d.target}] ` : ''
    process.stderr.write(`${where}${d.severity} ${tag}${d.code}: ${d.message}\n`)
  }
  return { errors, warnings }
}

function loadViews(modelPath: string) {
  const text = read(sidecarPaths(modelPath).views)
  return text ? parseViews(text).views : undefined
}

function analyse(modelPath: string) {
  const abs = resolvePath(modelPath)
  const { model, diagnostics } = resolveModel(abs, read)
  const all = [...diagnostics, ...validateModel(model, loadViews(abs))]
  return { abs, model, diagnostics: all }
}

function usage(): number {
  process.stderr.write(`lpg - labeled property graph modeler

Usage:
  lpg check <model.lpg.yaml>
  lpg emit  <model.lpg.yaml> --target <${targetNames().join('|')}> [options]
  lpg ids   <model.lpg.yaml>        assign any missing stable element ids
  lpg targets

Options:
  --target <name>       generation target (repeatable)
  --out <dir>           write artifacts to this directory instead of stdout
  --edition <name>      neo4j edition: community (default) or enterprise
`)
  return 2
}

/** Thrown by argument parsing so a usage error unwinds to a single exit path. */
class UsageError extends Error {}

function parseArgs(argv: string[]) {
  const positional: string[] = []
  const targets: string[] = []
  let out: string | undefined
  let edition: 'community' | 'enterprise' | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--target') targets.push(argv[++i] ?? '')
    else if (a === '--out') out = argv[++i]
    else if (a === '--edition') {
      const v = argv[++i]
      if (v !== 'community' && v !== 'enterprise') throw new UsageError()
      edition = v
    } else if (a?.startsWith('--')) throw new UsageError()
    else if (a) positional.push(a)
  }
  return { positional, targets, out, edition }
}

function main(argv: string[]): number {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h') return usage()
  if (command === 'targets') {
    process.stdout.write(targetNames().join('\n') + '\n')
    return 0
  }

  const { positional, targets, out, edition } = parseArgs(rest)
  const modelPath = positional[0]
  if (!modelPath) return usage()

  if (command === 'ids') {
    const abs = resolvePath(modelPath)
    const text = read(abs)
    if (text === undefined) { process.stderr.write(`cannot read ${abs}\n`); return 1 }
    const edits = backfillIdEdits(text)
    if (edits.length === 0) { process.stdout.write('all elements already have ids\n'); return 0 }
    writeFileSync(abs, applyEdits(text, edits))
    process.stdout.write(`assigned ${edits.length} id(s) in ${abs}\n`)
    return 0
  }

  const { abs, model, diagnostics } = analyse(modelPath)

  if (command === 'check') {
    const { errors, warnings } = report(diagnostics)
    process.stdout.write(`${errors} error(s), ${warnings} warning(s)\n`)
    return errors > 0 ? 1 : 0
  }

  if (command !== 'emit') return usage()
  if (targets.length === 0) return usage()

  // A model with errors must not produce an artifact.
  const modelErrors = diagnostics.filter((d) => d.severity === 'error')
  if (modelErrors.length > 0) {
    report(modelErrors)
    process.stderr.write('refusing to generate from a model with errors\n')
    return 1
  }

  const options: EmitOptions = edition ? { neo4jEdition: edition } : {}
  const collected: Diagnostic[] = [...diagnostics.filter((d) => d.severity !== 'error')]
  for (const target of targets) {
    const result = emit(model, target, options)
    collected.push(...result.diagnostics)
    if (result.diagnostics.some((d) => d.severity === 'error')) continue
    if (out) {
      if (!existsSync(out)) mkdirSync(out, { recursive: true })
      const stem = basename(abs).replace(/\.lpg\.ya?ml$/, '')
      const file = join(out, `${stem}.${target}.${result.extension}`)
      writeFileSync(file, result.content)
      process.stdout.write(`${file}\n`)
    } else {
      process.stdout.write(result.content)
    }
  }
  const { errors } = report(collected)
  return errors > 0 ? 1 : 0
}

// Assign exitCode rather than calling process.exit, which can truncate buffered
// stdout/stderr when either is a pipe.
try {
  process.exitCode = main(process.argv.slice(2))
} catch (e) {
  process.exitCode = e instanceof UsageError ? usage() : 1
  if (!(e instanceof UsageError)) process.stderr.write(`${(e as Error).message}\n`)
}
