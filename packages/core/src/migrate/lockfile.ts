import type { Diagnostic, Loc, ModelIR } from '../ir'
import { err, LPG_FORMAT_VERSION } from '../ir'

/** The lockfile format this build writes and reads. */
export const LOCKFILE_VERSION = 1

/**
 * A committed snapshot of the resolved IR: what the model was when its schema was last
 * migrated. See lat.md/emitters#Migrations.
 */
export interface Lockfile {
  lockfileVersion: number
  /** The model format version the snapshot was taken from. */
  lpg: string
  /** Incremented by every migration; names the scripts it produces. */
  revision: number
  model: ModelIR
}

/** `domain.lpg.yaml` -> `domain.lpg.lock.json`, beside the model. */
export function lockfilePath(modelPath: string): string {
  return /\.lpg\.ya?ml$/.test(modelPath)
    ? modelPath.replace(/\.lpg\.ya?ml$/, '.lpg.lock.json')
    : `${modelPath}.lock.json`
}

/**
 * Not semantics: where an element was written, which file it came from, and whether its
 * id was derived. A lockfile is only written once every id is written, so the last is
 * always absent there anyway.
 */
const STRIPPED = new Set(['loc', 'file', 'idDerived'])

/** Code-unit order, so the result does not depend on the machine's locale. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const hasId = (v: unknown): v is { id: string } =>
  v !== null && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string'

/**
 * Keys sorted, non-semantic keys dropped, and every array of identified elements sorted
 * by id — so reordering declarations in the file changes nothing, while arrays whose
 * order means something (a key, an ancestor chain, a mixin list) keep it.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonical)
    return items.length > 0 && items.every(hasId)
      ? [...items].sort((a, b) => byCodeUnit(a.id, b.id))
      : items
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort(byCodeUnit)) {
      const v = (value as Record<string, unknown>)[key]
      if (STRIPPED.has(key) || v === undefined) continue
      out[key] = canonical(v)
    }
    return out
  }
  return value
}

/** One-line canonical form of any IR fragment, for comparing two of them. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value)) ?? 'undefined'
}

/** The lockfile text for a model. Byte-identical for the same model, whatever its layout. */
export function writeLockfile(model: ModelIR, revision: number): string {
  const lock = {
    lockfileVersion: LOCKFILE_VERSION,
    lpg: model.formatVersion ?? LPG_FORMAT_VERSION,
    revision,
    model: canonical(model),
  }
  return `${JSON.stringify(lock, null, 2)}\n`
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object'

function looksLikeModel(v: unknown): boolean {
  return isObject(v) && isObject(v.namespace) && isObject(v.prefixes)
    && ['nodes', 'edges', 'mixins', 'enums'].every((k) => Array.isArray(v[k]))
}

export interface ReadLockfileResult {
  lockfile?: Lockfile
  diagnostics: Diagnostic[]
}

/** Read a lockfile back. Never throws: an unreadable one comes back as a diagnostic. */
export function readLockfile(text: string, file?: string): ReadLockfileResult {
  const where: Loc | undefined = file ? { file, range: [0, 0] } : undefined
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { diagnostics: [err('lockfile-unreadable', `The lockfile is not valid JSON: ${(e as Error).message}`, where)] }
  }
  if (!isObject(data) || typeof data.lockfileVersion !== 'number'
    || typeof data.revision !== 'number' || !looksLikeModel(data.model)) {
    return {
      diagnostics: [err('lockfile-unreadable',
        'The lockfile does not have the shape this tool writes. Restore it from version control, or run `lpg lock` to record a new baseline.', where)],
    }
  }
  if (data.lockfileVersion > LOCKFILE_VERSION) {
    return {
      diagnostics: [err('lockfile-newer',
        `The lockfile is format ${data.lockfileVersion}, and this build reads format ${LOCKFILE_VERSION}. Upgrade lpg-modeler rather than overwrite it.`, where)],
    }
  }
  return {
    lockfile: {
      lockfileVersion: data.lockfileVersion,
      lpg: typeof data.lpg === 'string' ? data.lpg : LPG_FORMAT_VERSION,
      revision: data.revision,
      model: { ...(data.model as unknown as ModelIR), file: file ?? '' },
    },
    diagnostics: [],
  }
}

/**
 * One error for every element whose id the file did not write. A derived id follows the
 * name, so a rename would read as a drop-plus-add and a migration would destroy data.
 * An inherited or mixin-applied property is reported once, where it is declared.
 * See lat.md/metamodel#Stable Element IDs.
 */
export function idsNotWritten(model: ModelIR): Diagnostic[] {
  const out: Diagnostic[] = []
  const note = (el: { idDerived?: true; loc?: Loc }, what: string) => {
    if (!el.idDerived) return
    out.push(err('ids-not-written',
      `${what} has no element id written in its file, so renaming it could not be told apart from removing it and adding another. Run \`lpg ids\` on the file that declares it.`,
      el.loc))
  }
  for (const x of model.enums) note(x, `Enum '${x.name}'`)
  for (const m of model.mixins) {
    note(m, `Mixin '${m.name}'`)
    for (const p of m.props) note(p, `Property '${m.name}.${p.name}'`)
  }
  for (const n of model.nodes) {
    note(n, `Node type '${n.name}'`)
    for (const p of n.props) if (!p.inheritedFrom) note(p, `Property '${n.name}.${p.name}'`)
    for (const k of n.constraints) note(k, `Constraint '${n.name}.${k.name}'`)
  }
  for (const e of model.edges) {
    note(e, `Edge type '${e.name}'`)
    for (const p of e.props) note(p, `Property '${e.name}.${p.name}'`)
  }
  return out
}
