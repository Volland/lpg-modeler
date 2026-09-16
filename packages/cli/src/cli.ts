#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve as resolvePath, basename, dirname } from 'node:path'
import {
  applyEdits, atLeast, backfillIdEdits, CHANGE_CLASSES, describeChange, detectFormat, diffModels,
  emit, idsNotWritten, importModel, importerNames, lockfilePath, migrationFileName, parseViews,
  planMigration, readLadybugCatalog, readLockfile, readMemgraphSchema, resolveModel, serializeModel, sidecarPaths,
  summarizeChanges, targetNames, validateModel, writeLockfile,
  type ChangeClass, type Diagnostic, type EmitOptions, type ImportInput, type LadybugConnection,
  type Lockfile, type ModelIR,
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
  lpg lock    <model.lpg.yaml> [--check]
  lpg diff    <model.lpg.yaml> [--fail-on <${CHANGE_CLASSES.join('|')}>] [--json]
  lpg migrate <model.lpg.yaml> [--target <ladybug|neo4j|falkordb|memgraph>] [--out <dir>]
                               [--allow-destructive] [--edition ...] [--graph-key ...]
  lpg import <file...> [--from <${[...importerNames(), 'ladybug-db'].sort().join('|')}>] [--out <model.lpg.yaml>]
  lpg import bolt://host:7687 [--user <name>] [--out <model.lpg.yaml>]
  lpg apply  <script> --target memgraph --uri bolt://host:7687 [--user <name>]
             [--allow-destructive] [--dry-run]
  lpg targets

Options:
  --target <name>       generation or migration target (repeatable); migrate defaults
                        to ladybug, neo4j, falkordb and memgraph
  --out <path>          emit: a directory to write artifacts into
                        migrate: where scripts go (default: migrations/ beside the model)
                        import: the model file to write, instead of stdout
  --from <name>         import: what the inputs are, when the names do not say;
                        ladybug-db opens each path as a LadybugDB database
  --edition <name>      neo4j edition: community (default) or enterprise
  --graph-key <key>     falkordb: the Redis key the graph lives under
                        (default: the model's namespace prefix)
  --check               lock: fail if the model has changed since the lockfile
  --fail-on <class>     diff: fail on a change of this class or a more severe one
  --json                diff: print the change set as JSON
  --allow-destructive   migrate: generate changes that discard stored data
                        apply: run a script whose statements are marked destructive
  --uri <bolt-uri>      apply: the Memgraph instance to run the script against
  --user <name>         import, apply: the Memgraph user; the password is read from
                        the MEMGRAPH_PASSWORD environment variable, never a flag
  --dry-run             apply: print the statements without connecting

The lockfile (<stem>.lpg.lock.json) is committed beside the model. It records what was
last deployed, so diff and migrate compare the model against it by element id.

Several files are imported together: a SHACL shapes graph and the OWL ontology
beside it each carry half of a model, and the DDL adds the endpoints and the
exact column widths neither of them keeps.

A LadybugDB database is read from its catalog, opened read-only. A directory or a
.lbdb, .lbug or .kuzu file is taken to be one; that needs @ladybugdb/core installed.

A bolt:// URI is a running Memgraph, whose schema is read without writing to it.
Reading one, and apply, need neo4j-driver installed.
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
  let failOn: ChangeClass | undefined
  let check = false
  let json = false
  let allowDestructive = false
  let uri: string | undefined
  let user: string | undefined
  let dryRun = false
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
    } else if (a === '--fail-on') {
      const v = argv[++i] as ChangeClass
      if (!CHANGE_CLASSES.includes(v)) throw new UsageError()
      failOn = v
    } else if (a === '--check') check = true
    else if (a === '--json') json = true
    else if (a === '--allow-destructive') allowDestructive = true
    else if (a === '--uri') uri = argv[++i]
    else if (a === '--user') user = argv[++i]
    else if (a === '--dry-run') dryRun = true
    else if (a?.startsWith('--')) throw new UsageError()
    else if (a) positional.push(a)
  }
  return { positional, targets, out, from, graphKey, edition, failOn, check, json, allowDestructive, uri, user, dryRun }
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

const NEO4J_DRIVER_VERSION = '6.2.0'

/**
 * The Bolt driver is an optional peer for the same reason the LadybugDB runtime is: only
 * a Memgraph import and `apply` use it, and everything else should not download it.
 * See lat.md/architecture#Distribution.
 */
function loadDriver(): typeof import('neo4j-driver').default {
  for (const base of [__filename, join(process.cwd(), 'noop.js')]) {
    try {
      const mod = createRequire(base)('neo4j-driver')
      return mod.default ?? mod
    } catch { /* try the next place */ }
  }
  throw new ImportFailure(
    `connecting to Memgraph needs neo4j-driver: npm install neo4j-driver@${NEO4J_DRIVER_VERSION} ` +
    `(or npx -p lpg-modeler-cli -p neo4j-driver@${NEO4J_DRIVER_VERSION} lpg …)`)
}

const isBoltUri = (s: string) => /^bolt(\+s|\+ssc)?:\/\//i.test(s)

/** A driver to a Memgraph instance, verified before anything is asked of it. */
async function connectMemgraph(uri: string, user: string | undefined) {
  const neo4j = loadDriver()
  const driver = neo4j.driver(uri, neo4j.auth.basic(user ?? '', process.env.MEMGRAPH_PASSWORD ?? ''))
  try {
    await driver.verifyConnectivity()
  } catch (e) {
    await driver.close().catch(() => undefined)
    throw new ImportFailure(`cannot connect to Memgraph at ${uri}: ${(e as Error).message}`)
  }
  /** The driver's 64-bit integers, as numbers: a schema count never needs more. */
  const plain = (v: unknown): unknown => (neo4j.isInt(v) ? (v as { toNumber(): number }).toNumber()
    : Array.isArray(v) ? v.map(plain)
      : v !== null && typeof v === 'object' && v.constructor === Object
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v)
  const run = async (statement: string, mode: 'READ' | 'WRITE') => {
    const session = driver.session({ defaultAccessMode: mode === 'READ' ? neo4j.session.READ : neo4j.session.WRITE })
    try {
      const result = await session.run(statement)
      return result.records.map((r) => plain(r.toObject()) as Record<string, unknown>)
    } finally {
      await session.close()
    }
  }
  return { driver, run }
}

/**
 * Read a running Memgraph's schema. Every query runs in a read session, so an import
 * cannot change the instance. See lat.md/importers#Reading a Memgraph Instance.
 */
async function readMemgraph(uri: string, user: string | undefined): Promise<ImportInput> {
  const { driver, run } = await connectMemgraph(uri, user)
  try {
    const { catalog, diagnostics } = await readMemgraphSchema({ run: (q) => run(q, 'READ') })
    report(diagnostics)
    if (diagnostics.some((d) => d.severity === 'error')) {
      throw new ImportFailure(`cannot read the schema of Memgraph at ${uri}`)
    }
    return { path: uri, memgraphCatalog: catalog }
  } finally {
    await driver.close()
  }
}

/**
 * Read one or more foreign schemas into a model. The result is written through the
 * normal pipeline rather than trusted: it is serialized, then resolved and validated
 * from that text, so what the user is told is true of the file they now have.
 * See lat.md/importers#Importers.
 */
async function runImport(
  files: string[], from: string | undefined, out: string | undefined, user: string | undefined,
): Promise<number> {
  const inputs: ImportInput[] = []
  try {
    for (const file of files) {
      if (isBoltUri(file) || from?.toLowerCase() === 'memgraph') { inputs.push(await readMemgraph(file, user)); continue }
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
  const kinds = new Set(inputs.map((i) => ('memgraphCatalog' in i ? 'memgraph'
    : from && 'text' in i ? (from === 'ladybug' || from === 'ladybug-db' ? 'ladybug' : 'rdf') : detectFormat(i))))
  const caveat = kinds.has('rdf')
    ? ['Check anything the import reported: RDF cannot express an abstract type, a',
      'mixin or a uniqueness constraint, and several scalars share one XSD datatype.']
    : kinds.has('memgraph')
      ? ['Check anything the import reported: Memgraph holds no edge constraint, cardinality,',
        'value bound or mixin, and a hierarchy is read from labels that occur together.']
      : ['Check anything the import reported: LadybugDB keeps one table per concrete',
        'type, so an abstract type, a mixin, an enum and a value constraint are not in it.']
  const source = serializeModel(model, {
    header: [
      `Imported by lpg-modeler from ${files.map((f) => (isBoltUri(f) ? f : basename(f))).join(', ')}.`,
      '',
      ...caveat,
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

const stemOf = (modelPath: string) => basename(modelPath).replace(/\.lpg\.ya?ml$/, '')

/**
 * The model and its lockfile, or the reason a lock, diff or migrate cannot go on. A model
 * with errors, or with ids that follow names, cannot be compared by element id at all.
 * See lat.md/emitters#Migrations#Lockfile.
 */
function lockInputs(modelPath: string, needLockfile: boolean):
  { abs: string; model: ModelIR; lockfile?: Lockfile; lockPath: string; diagnostics: Diagnostic[] } | undefined {
  const { abs, model, diagnostics } = analyse(modelPath)
  const lockPath = lockfilePath(abs)
  const errors = diagnostics.filter((d) => d.severity === 'error')
  if (errors.length > 0) {
    report(errors)
    process.stderr.write('refusing to compare a model with errors\n')
    return undefined
  }
  const derived = idsNotWritten(model)
  if (derived.length > 0) { report(derived); return undefined }

  const text = read(lockPath)
  if (text === undefined) {
    if (!needLockfile) return { abs, model, lockPath, diagnostics }
    report([{ severity: 'error', code: 'lockfile-missing',
      message: `No lockfile at ${lockPath}. Run \`lpg lock\` on the model as it is deployed to record a baseline.` }])
    return undefined
  }
  const { lockfile, diagnostics: lockDiags } = readLockfile(text, lockPath)
  // Relocking is how an unreadable lockfile is replaced; one from a newer build is not overwritten.
  if (!lockfile && !needLockfile && lockDiags.every((d) => d.code === 'lockfile-unreadable')) {
    report(lockDiags.map((d) => ({ ...d, severity: 'warning' as const })))
    return { abs, model, lockPath, diagnostics }
  }
  if (!lockfile) { report(lockDiags); return undefined }
  return { abs, model, lockfile, lockPath, diagnostics }
}

/** `lpg lock`: record the baseline, or with --check fail when the model has moved on. */
function runLock(modelPath: string, check: boolean): number {
  const inputs = lockInputs(modelPath, check)
  if (!inputs) return 1
  const { model, lockfile, lockPath, diagnostics } = inputs
  report(diagnostics.filter((d) => d.severity === 'warning'))
  if (check) {
    const changes = diffModels(lockfile!.model, model)
    if (changes.length === 0) { process.stdout.write(`${lockPath} is up to date\n`); return 0 }
    for (const c of changes) process.stderr.write(`${describeChange(c)}\n`)
    process.stderr.write(`lockfile is stale: ${summarizeChanges(changes)} since revision ${lockfile!.revision}. Run \`lpg migrate\`, or \`lpg lock\` to rebaseline.\n`)
    return 1
  }
  // Relocking keeps the revision: it rebaselines what is deployed, it does not migrate it.
  const revision = lockfile?.revision ?? 1
  writeFileSync(lockPath, writeLockfile(model, revision))
  process.stdout.write(`${lockPath} (revision ${revision})\n`)
  return 0
}

/** `lpg diff`: print the change set, and fail at the chosen severity. */
function runDiff(modelPath: string, failOn: ChangeClass | undefined, json: boolean): number {
  const inputs = lockInputs(modelPath, true)
  if (!inputs) return 1
  const { model, lockfile } = inputs
  const changes = diffModels(lockfile!.model, model)
  if (json) {
    process.stdout.write(`${JSON.stringify({ revision: lockfile!.revision, changes: changes.map(({ loc: _loc, ...c }) => c) }, null, 2)}\n`)
  } else {
    for (const c of changes) process.stdout.write(`${describeChange(c)}\n`)
    process.stdout.write(`${summarizeChanges(changes)} since revision ${lockfile!.revision}\n`)
  }
  if (!failOn) return 0
  const failing = changes.filter((c) => atLeast(c.class, failOn))
  if (failing.length > 0) {
    process.stderr.write(`${failing.length} change(s) are ${failOn} or more severe\n`)
    return 1
  }
  return 0
}

/**
 * `lpg migrate`: every script is planned before anything is written, the scripts are
 * written before the lockfile, and the lockfile last -- so a refusal writes nothing and
 * a failed write leaves the old baseline in place. See lat.md/emitters#Migrations#Destructive Gate.
 */
function runMigrate(
  modelPath: string, targets: string[], out: string | undefined, allowDestructive: boolean,
  options: EmitOptions,
): number {
  const inputs = lockInputs(modelPath, true)
  if (!inputs) return 1
  const { abs, model, lockfile, lockPath, diagnostics } = inputs
  const plan = planMigration({
    lockfile: lockfile!, model, allowDestructive, options,
    ...(targets.length > 0 ? { targets } : {}),
  })
  const collected = [...diagnostics.filter((d) => d.severity !== 'error'), ...plan.diagnostics]
  if (plan.refused || plan.scripts.length === 0) {
    const { errors } = report(collected)
    if (!plan.refused) process.stdout.write(`unchanged since revision ${lockfile!.revision}; nothing written\n`)
    return plan.refused || errors > 0 ? 1 : 0
  }

  const dir = resolvePath(out ?? join(dirname(abs), 'migrations'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  for (const s of plan.scripts) {
    const file = join(dir, migrationFileName(stemOf(abs), plan.revision, s.target, s.extension))
    writeFileSync(file, s.content)
    process.stdout.write(`${file}\n`)
  }
  writeFileSync(lockPath, plan.lockfileText!)
  process.stdout.write(`${lockPath} (revision ${plan.revision}: ${summarizeChanges(plan.changes)})\n`)
  const { errors } = report(collected)
  return errors > 0 ? 1 : 0
}

/**
 * `lpg apply`: run a reviewed script against a running Memgraph, one statement per
 * auto-commit transaction, stopping at the first failure. It takes a script, never a
 * model, so what runs is exactly what was reviewed. Everything that can be checked
 * without a connection is checked first. See lat.md/architecture#Distribution.
 */
async function runApply(
  scriptPath: string, targets: string[], uri: string | undefined, user: string | undefined,
  allowDestructive: boolean, dryRun: boolean,
): Promise<number> {
  const target = targets[0]
  if (!target || targets.length > 1) return usage()
  const fail = (code: string, message: string) => { report([{ severity: 'error', code, message }]); return 1 }
  if (target !== 'memgraph') return fail('apply-unsupported', `apply runs scripts against memgraph only; '${target}' is not supported.`)

  const abs = resolvePath(scriptPath)
  const text = read(abs)
  if (text === undefined) { process.stderr.write(`cannot read ${abs}\n`); return 1 }
  const header = text.split('\n').slice(0, 3)
    .map((l) => /^(?:\/\/|#) Generated by lpg-modeler\. Target: (\S+?)(?: migration)?\.$/.exec(l)?.[1])
    .find(Boolean)
  if (!header) return fail('apply-not-generated', `${abs} is not a script generated by lpg-modeler, so it is not run.`)
  if (header !== target) return fail('apply-target-mismatch', `${abs} was generated for ${header}, not ${target}.`)

  const destructive = text.split('\n').filter((l) => l.startsWith('// DESTRUCTIVE: '))
  if (destructive.length > 0 && !allowDestructive) {
    return fail('destructive-change',
      `${abs} contains ${destructive.length} statement(s) marked destructive (${destructive.map((l) => l.slice('// DESTRUCTIVE: '.length).split(':')[0]).join(', ')}). Pass --allow-destructive to run it.`)
  }

  // The generator writes one statement per `;`-terminated group of lines and never puts
  // a `;` inside a string, so this split is exact for the scripts apply accepts.
  const statements = text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    .split(/;[ \t]*(?:\n|$)/).map((x) => x.trim()).filter(Boolean)
  if (dryRun) {
    statements.forEach((st, i) => process.stdout.write(`[${i + 1}/${statements.length}] ${st};\n`))
    return 0
  }
  if (!uri) return usage()

  let connection: Awaited<ReturnType<typeof connectMemgraph>>
  try {
    connection = await connectMemgraph(uri, user)
  } catch (e) {
    if (!(e instanceof ImportFailure)) throw e
    process.stderr.write(`${e.message}\n`)
    return 1
  }
  try {
    for (const [i, st] of statements.entries()) {
      try {
        await connection.run(st, 'WRITE')
      } catch (e) {
        process.stderr.write(`statement ${i + 1} of ${statements.length} failed: ${(e as Error).message}\n  ${st};\n`)
        process.stderr.write(`${i} statement(s) had been applied; the rest did not run.\n`)
        return 1
      }
      process.stdout.write(`[${i + 1}/${statements.length}] ${st.split('\n')[0]}\n`)
    }
    process.stdout.write(`applied ${statements.length} statement(s) to ${uri}\n`)
    return 0
  } finally {
    await connection.driver.close()
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h') return usage()
  if (command === 'targets') {
    process.stdout.write(targetNames().join('\n') + '\n')
    return 0
  }

  const {
    positional, targets, out, from, graphKey, edition, failOn, check, json, allowDestructive, uri, user, dryRun,
  } = parseArgs(rest)
  const modelPath = positional[0]
  if (!modelPath) return usage()

  const options: EmitOptions = {
    ...(edition ? { neo4jEdition: edition } : {}),
    ...(graphKey ? { falkorGraphKey: graphKey } : {}),
  }

  if (command === 'import') return runImport(positional, from, out, user)
  if (command === 'apply') return runApply(modelPath, targets, uri, user, allowDestructive, dryRun)
  if (command === 'lock') return runLock(modelPath, check)
  if (command === 'diff') return runDiff(modelPath, failOn, json)
  if (command === 'migrate') return runMigrate(modelPath, targets, out, allowDestructive, options)

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
