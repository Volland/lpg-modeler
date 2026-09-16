#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve as resolvePath, basename } from 'node:path'
import {
  applyEdits, backfillIdEdits, detectFormat, emit, importModel, importerNames, parseViews,
  readLadybugCatalog, resolveModel, serializeModel, sidecarPaths, targetNames, validateModel,
  type Diagnostic, type EmitOptions, type ImportInput, type LadybugConnection,
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
  lpg ids    <model.lpg.yaml>       assign any missing stable element ids
  lpg import <file...> [--from <${[...importerNames(), 'ladybug-db'].sort().join('|')}>] [--out <model.lpg.yaml>]
  lpg targets

Options:
  --target <name>       generation target (repeatable)
  --out <path>          emit: a directory to write artifacts into
                        import: the model file to write, instead of stdout
  --from <name>         import: what the inputs are, when the names do not say;
                        ladybug-db opens each path as a LadybugDB database
  --edition <name>      neo4j edition: community (default) or enterprise
  --graph-key <key>     falkordb: the Redis key the graph lives under
                        (default: the model's namespace prefix)

Several files are imported together: a SHACL shapes graph and the OWL ontology
beside it each carry half of a model, and the DDL adds the endpoints and the
exact column widths neither of them keeps.

A LadybugDB database is read from its catalog, opened read-only. A directory or a
.lbdb, .lbug or .kuzu file is taken to be one; that needs @ladybugdb/core installed.
`)
  return 2
}

/** Thrown by argument parsing so a usage error unwinds to a single exit path. */
class UsageError extends Error {}

function parseArgs(argv: string[]) {
  const positional: string[] = []
  const targets: string[] = []
  let out: string | undefined
  let from: string | undefined
  let graphKey: string | undefined
  let edition: 'community' | 'enterprise' | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--target') targets.push(argv[++i] ?? '')
    else if (a === '--out') out = argv[++i]
    else if (a === '--from') from = argv[++i]
    else if (a === '--graph-key') graphKey = argv[++i]
    else if (a === '--edition') {
      const v = argv[++i]
      if (v !== 'community' && v !== 'enterprise') throw new UsageError()
      edition = v
    } else if (a?.startsWith('--')) throw new UsageError()
    else if (a) positional.push(a)
  }
  return { positional, targets, out, from, graphKey, edition }
}

/** Where a database import pauses for a message rather than a stack trace. */
class ImportFailure extends Error {}

const DATABASE_EXTENSIONS = ['.lbdb', '.lbug', '.kuzu']

/**
 * A path is opened as a database when the user said so, or when it can be nothing else a
 * text reader would accept. Content is not sniffed: the file format is not a contract.
 */
function isDatabasePath(path: string, from: string | undefined): boolean {
  if (from?.toLowerCase() === 'ladybug-db') return true
  if (DATABASE_EXTENSIONS.some((e) => path.toLowerCase().endsWith(e))) return true
  try { return statSync(path).isDirectory() } catch { return false }
}

const LADYBUG_VERSION = '0.19.1'

/**
 * The runtime is an optional peer, not a dependency: it is a native binding per platform
 * that every `check` and `emit` would otherwise download. It is looked for beside the CLI
 * first and then in the working directory, so a project-local install serves a global
 * CLI too. See lat.md/architecture#Distribution.
 */
function loadLadybug(): typeof import('@ladybugdb/core') {
  for (const base of [__filename, join(process.cwd(), 'noop.js')]) {
    try { return createRequire(base)('@ladybugdb/core') } catch { /* try the next place */ }
  }
  throw new ImportFailure(
    `importing a LadybugDB database needs @ladybugdb/core: npm install @ladybugdb/core@${LADYBUG_VERSION} ` +
    `(or npx -p lpg-modeler-cli -p @ladybugdb/core@${LADYBUG_VERSION} lpg import …)`)
}

/** Bounded as in the live tests: the defaults reserve 8 TiB of address space per open. */
const BUFFER_POOL = 256 * 1024 * 1024
const MAX_DB_SIZE = 1024 * 1024 * 1024

/**
 * Open a database read-only, read its catalog, and close it. A catalog query the engine
 * refuses is an error, and nothing is written from a catalog known to be incomplete.
 * See lat.md/importers#Reading a LadybugDB Database.
 */
async function readDatabase(path: string): Promise<ImportInput> {
  const lbug = loadLadybug()
  if (!existsSync(path)) throw new ImportFailure(`cannot open LadybugDB database ${path}: no such file or directory`)
  let db: InstanceType<typeof lbug.Database> | undefined
  let conn: InstanceType<typeof lbug.Connection> | undefined
  try {
    try {
      db = new lbug.Database(path, BUFFER_POOL, true, /* readOnly */ true, MAX_DB_SIZE)
      conn = new lbug.Connection(db)
      await conn.init()
    } catch (e) {
      throw new ImportFailure(`cannot open LadybugDB database ${path}: ${(e as Error).message}`)
    }
    const { catalog, diagnostics } = await readLadybugCatalog(conn as unknown as LadybugConnection)
    if (diagnostics.some((d) => d.severity === 'error')) {
      report(diagnostics)
      throw new ImportFailure(`cannot read the catalog of LadybugDB database ${path}`)
    }
    return { path, ladybugCatalog: catalog }
  } finally {
    await conn?.close().catch(() => undefined)
    await db?.close().catch(() => undefined)
  }
}

/**
 * Read one or more foreign schemas into a model. The result is written through the
 * normal pipeline rather than trusted: it is serialized, then resolved and validated
 * from that text, so what the user is told is true of the file they now have.
 * See lat.md/importers#Importers.
 */
async function runImport(files: string[], from: string | undefined, out: string | undefined): Promise<number> {
  const inputs: ImportInput[] = []
  try {
    for (const file of files) {
      const abs = resolvePath(file)
      if (isDatabasePath(abs, from)) { inputs.push(await readDatabase(abs)); continue }
      const text = read(abs)
      if (text === undefined) { process.stderr.write(`cannot read ${abs}\n`); return 1 }
      inputs.push({ path: abs, text })
    }
  } catch (e) {
    if (!(e instanceof ImportFailure)) throw e
    process.stderr.write(`${e.message}\n`)
    return 1
  }

  const { model, diagnostics } = importModel(inputs, from)
  const rdf = inputs.some((i) => (from ? from !== 'ladybug' && from !== 'ladybug-db' : detectFormat(i) === 'rdf'))
  const source = serializeModel(model, {
    header: [
      `Imported by lpg-modeler from ${files.map((f) => basename(f)).join(', ')}.`,
      '',
      ...(rdf
        ? ['Check anything the import reported: RDF cannot express an abstract type, a',
          'mixin or a uniqueness constraint, and several scalars share one XSD datatype.']
        : ['Check anything the import reported: LadybugDB keeps one table per concrete',
          'type, so an abstract type, a mixin, an enum and a value constraint are not in it.']),
    ],
  })

  if (!out) {
    process.stdout.write(source)
    report(diagnostics)
    return diagnostics.some((d) => d.severity === 'error') ? 1 : 0
  }

  const target = resolvePath(out)
  writeFileSync(target, source)
  process.stdout.write(`${target}\n`)
  // Validate what was actually written, not the model in memory.
  const { errors } = report([...diagnostics, ...analyse(target).diagnostics])
  return errors > 0 ? 1 : 0
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h') return usage()
  if (command === 'targets') {
    process.stdout.write(targetNames().join('\n') + '\n')
    return 0
  }

  const { positional, targets, out, from, graphKey, edition } = parseArgs(rest)
  const modelPath = positional[0]
  if (!modelPath) return usage()

  if (command === 'import') return runImport(positional, from, out)

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

  const options: EmitOptions = {
    ...(edition ? { neo4jEdition: edition } : {}),
    ...(graphKey ? { falkorGraphKey: graphKey } : {}),
  }
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
// stdout/stderr when either is a pipe. Only a database import awaits anything; every
// other command settles in the same tick it did when `main` was synchronous.
main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code },
  (e: unknown) => {
    process.exitCode = e instanceof UsageError ? usage() : 1
    if (!(e instanceof UsageError)) process.stderr.write(`${(e as Error).message}\n`)
  },
)
