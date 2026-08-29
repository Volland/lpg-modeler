import { parse as parseYaml } from 'yaml'
import type { EdgeTypeIR, ModelIR, NodeTypeIR } from './ir'

/** A named subset of a model's types forming one diagram. lat.md/architecture#Views */
export interface ViewDef {
  name: string
  /** Node type names, or '*' for every type. */
  include: string[]
  /** Additional hops of neighbouring types to pull in. */
  expand?: number
}

export interface ViewsFile {
  views: ViewDef[]
}

export interface Point { x: number; y: number }

/** Positions keyed by view name, then by stable element id. */
export type Layout = Record<string, Record<string, Point>>

export const DEFAULT_VIEW: ViewDef = { name: 'overview', include: ['*'] }

export function parseViews(text: string): ViewsFile {
  const parsed = parseYaml(text) as { views?: Record<string, { include?: unknown; expand?: unknown }> } | null
  const views: ViewDef[] = []
  for (const [name, body] of Object.entries(parsed?.views ?? {})) {
    const include = Array.isArray(body?.include)
      ? body.include.filter((v): v is string => typeof v === 'string')
      : ['*']
    const expand = typeof body?.expand === 'number' ? body.expand : undefined
    views.push({ name, include, ...(expand !== undefined ? { expand } : {}) })
  }
  return { views: views.length > 0 ? views : [DEFAULT_VIEW] }
}

export function serializeViews(file: ViewsFile): string {
  const lines = ['views:']
  for (const v of file.views) {
    lines.push(`  ${v.name}:`)
    // Entries are quoted: '*' alone would parse as a YAML alias, not a string.
    lines.push(`    include: [${v.include.map((n) => JSON.stringify(n)).join(', ')}]`)
    if (v.expand !== undefined) lines.push(`    expand: ${v.expand}`)
  }
  return lines.join('\n') + '\n'
}

export interface Projection {
  view: ViewDef
  nodes: NodeTypeIR[]
  edges: EdgeTypeIR[]
}

/** Reduce a model to the types one diagram shows. */
export function projectView(model: ModelIR, view: ViewDef): Projection {
  const all = view.include.includes('*')
  let names = new Set(all ? model.nodes.map((n) => n.name) : view.include)

  const hops = view.expand ?? 0
  for (let i = 0; i < hops; i++) {
    const next = new Set(names)
    for (const e of model.edges) {
      if (names.has(e.from)) next.add(e.to)
      if (names.has(e.to)) next.add(e.from)
    }
    names = next
  }
  // Ancestors are always shown: a subtype's inherited properties are unreadable without them.
  for (const n of model.nodes) {
    if (names.has(n.name)) n.ancestors.forEach((a) => names.add(a))
  }

  return {
    view,
    nodes: model.nodes.filter((n) => names.has(n.name)),
    edges: model.edges.filter((e) => names.has(e.from) && names.has(e.to)),
  }
}

/** Node type names that no view includes. */
export function typesInNoView(model: ModelIR, views: ViewDef[]): string[] {
  const covered = new Set<string>()
  for (const v of views) projectView(model, v).nodes.forEach((n) => covered.add(n.name))
  return model.nodes.filter((n) => !covered.has(n.name)).map((n) => n.name)
}

// --- Layout -------------------------------------------------------------------

/**
 * Layout is stored apart from the model and keyed by stable element id, so renaming a
 * type never moves its box and moving a box never changes the model.
 * See lat.md/architecture#Source of Truth.
 */
export function parseLayout(json: string): Layout {
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Layout = {}
    for (const [view, entries] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entries || typeof entries !== 'object') continue
      const positions: Record<string, Point> = {}
      for (const [id, pt] of Object.entries(entries as Record<string, unknown>)) {
        const p = pt as { x?: unknown; y?: unknown }
        if (typeof p?.x === 'number' && typeof p?.y === 'number') positions[id] = { x: p.x, y: p.y }
      }
      out[view] = positions
    }
    return out
  } catch {
    return {}
  }
}

/** Stable key ordering so a position change produces a minimal diff. */
export function serializeLayout(layout: Layout): string {
  const ordered: Layout = {}
  for (const view of Object.keys(layout).sort()) {
    const entries = layout[view] ?? {}
    const inner: Record<string, Point> = {}
    for (const id of Object.keys(entries).sort()) inner[id] = entries[id]!
    ordered[view] = inner
  }
  return JSON.stringify(ordered, null, 2) + '\n'
}

export function setPosition(layout: Layout, view: string, elementId: string, at: Point): Layout {
  return { ...layout, [view]: { ...(layout[view] ?? {}), [elementId]: at } }
}

/** Drop positions for elements the model no longer contains. */
export function pruneLayout(layout: Layout, model: ModelIR): Layout {
  const live = new Set<string>([
    ...model.nodes.map((n) => n.id),
    ...model.edges.map((e) => e.id),
  ])
  const out: Layout = {}
  for (const [view, entries] of Object.entries(layout)) {
    const kept: Record<string, Point> = {}
    for (const [id, pt] of Object.entries(entries)) if (live.has(id)) kept[id] = pt
    out[view] = kept
  }
  return out
}

// --- View editing -------------------------------------------------------------

export function addView(file: ViewsFile, name: string, include: string[] = []): ViewsFile {
  if (file.views.some((v) => v.name === name)) return file
  return { views: [...file.views, { name, include }] }
}

export function addToView(file: ViewsFile, view: string, typeName: string): ViewsFile {
  return {
    views: file.views.map((v) =>
      v.name === view && !v.include.includes(typeName) && !v.include.includes('*')
        ? { ...v, include: [...v.include, typeName] }
        : v),
  }
}

export function removeFromView(file: ViewsFile, view: string, typeName: string): ViewsFile {
  return {
    views: file.views.map((v) =>
      v.name === view ? { ...v, include: v.include.filter((n) => n !== typeName) } : v),
  }
}

/** Conventional sidecar paths for a model file. */
export function sidecarPaths(modelPath: string): { views: string; layout: string } {
  const base = modelPath.replace(/\.lpg\.ya?ml$/, '')
  return { views: `${base}.views.yaml`, layout: `${base}.layout.json` }
}
