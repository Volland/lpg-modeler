import * as path from 'node:path'
import type {
  Diagnostic, EdgeTypeIR, EnumIR, ModelIR, NodeTypeIR, PropertyIR, ResolveResult,
} from './ir'
import { err } from './ir'
import { parseModel, type RawModel, type RawNode, type RawProperty } from './parse'
import { duplicateIdDiagnostics, generateId } from './ids'

/** Reading files is injected so the editor can resolve unsaved buffers. */
export type ReadFile = (absPath: string) => string | undefined

interface LoadedModel {
  raw: RawModel
  /** Alias declared by the importer, mapped to the absolute path it resolves to. */
  aliasToFile: Map<string, string>
}

/** Load the entry model and everything it transitively imports, deduped by file. */
function loadClosure(entry: string, readFile: ReadFile, diags: Diagnostic[]): Map<string, LoadedModel> {
  const loaded = new Map<string, LoadedModel>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (loaded.has(file)) continue
    const text = readFile(file)
    if (text === undefined) {
      diags.push(err('missing-import', `Cannot read model file '${file}'.`, { file: entry, range: [0, 0] }))
      continue
    }
    const { raw, diagnostics } = parseModel(file, text)
    diags.push(...diagnostics)
    diags.push(...duplicateIdDiagnostics(raw))
    if (!raw.namespace) {
      diags.push(err('missing-namespace',
        'A model must declare a namespace with a prefix and an iri.', { file, range: [0, 0] }))
    }
    const aliasToFile = new Map<string, string>()
    for (const imp of raw.imports) {
      const abs = path.resolve(path.dirname(file), imp.path)
      aliasToFile.set(imp.as, abs)
      queue.push(abs)
    }
    loaded.set(file, { raw, aliasToFile })
  }
  return loaded
}

/**
 * Models are deduped by namespace IRI, not by path, so the same vocabulary vendored at
 * two paths resolves to one type. See lat.md/metamodel#Namespaces.
 */
function dedupeByNamespace(loaded: Map<string, LoadedModel>): Map<string, LoadedModel> {
  const byIri = new Map<string, LoadedModel>()
  const canonical = new Map<string, LoadedModel>()
  for (const [file, m] of loaded) {
    const iri = m.raw.namespace?.iri
    if (!iri) { canonical.set(file, m); continue }
    const existing = byIri.get(iri)
    if (existing) continue
    byIri.set(iri, m)
    canonical.set(file, m)
  }
  // Drop later files whose namespace IRI was already claimed by an earlier file.
  for (const [file, m] of [...canonical]) {
    const iri = m.raw.namespace?.iri
    if (iri && byIri.get(iri) !== m) canonical.delete(file)
  }
  return canonical
}

function toProp(p: RawProperty, inheritedFrom?: string): PropertyIR {
  return {
    id: p.id ?? generateId('prop'),
    name: p.name,
    type: p.type,
    list: p.list,
    ...(p.enum ? { enum: p.enum } : {}),
    required: p.required,
    unique: p.unique,
    ...(inheritedFrom ? { inheritedFrom } : {}),
    ...(p.loc ? { loc: p.loc } : {}),
  }
}

/** Resolve `alias:Name` or a bare local `Name` to a simple type name. */
function stripAlias(ref: string): string {
  const i = ref.indexOf(':')
  return i === -1 ? ref : ref.slice(i + 1)
}

export function resolveModel(entry: string, readFile: ReadFile): ResolveResult {
  const diagnostics: Diagnostic[] = []
  const loaded = dedupeByNamespace(loadClosure(entry, readFile, diagnostics))
  const entryModel = loaded.get(entry)

  // Imported models may bind prefixes too; the entry file wins on a conflict, so a
  // consumer can rebind a vendored vocabulary without editing it.
  const prefixes: Record<string, string> = {}
  for (const [file, m] of loaded) {
    if (file === entry) continue
    Object.assign(prefixes, m.raw.prefixes)
  }
  Object.assign(prefixes, entryModel?.raw.prefixes ?? {})

  const emptyNs = { prefix: '', iri: '' }
  const model: ModelIR = {
    file: entry,
    namespace: entryModel?.raw.namespace ?? emptyNs,
    ...(entryModel?.raw.formatVersion ? { formatVersion: entryModel.raw.formatVersion } : {}),
    prefixes,
    nodes: [], edges: [], mixins: [], enums: [],
  }

  // --- Sealed imports: a local declaration must not shadow an imported type name.
  if (entryModel) {
    const importedNames = new Set<string>()
    for (const [file, m] of loaded) {
      if (file === entry) continue
      m.raw.nodes.forEach((n) => importedNames.add(n.name))
      m.raw.edges.forEach((e) => importedNames.add(e.name))
      m.raw.enums.forEach((x) => importedNames.add(x.name))
    }
    for (const n of entryModel.raw.nodes) {
      if (importedNames.has(n.name)) {
        diagnostics.push(err('sealed-import',
          `Node type '${n.name}' shadows an imported type of the same name. Imported definitions are sealed: extend it with a new name instead of redeclaring it.`,
          n.loc))
      }
    }
    for (const e of entryModel.raw.edges) {
      if (importedNames.has(e.name)) {
        diagnostics.push(err('sealed-import',
          `Edge type '${e.name}' shadows an imported type of the same name. Imported definitions are sealed.`,
          e.loc))
      }
    }
  }

  // --- Gather every raw declaration across the closure.
  const rawNodes = new Map<string, { raw: RawNode; prefix: string; iri: string }>()
  const mixinProps = new Map<string, PropertyIR[]>()
  const seenEnums = new Set<string>()
  for (const m of loaded.values()) {
    const prefix = m.raw.namespace?.prefix ?? ''
    const base = m.raw.namespace?.iri ?? ''
    for (const x of m.raw.enums) {
      if (seenEnums.has(x.name)) continue
      seenEnums.add(x.name)
      const e: EnumIR = {
        id: x.id ?? generateId('enum'),
        name: x.name,
        qname: prefix ? `${prefix}:${x.name}` : x.name,
        iri: base + x.name,
        prefix,
        values: x.values,
        ...(x.loc ? { loc: x.loc } : {}),
      }
      model.enums.push(e)
    }
    for (const mx of m.raw.mixins) {
      mixinProps.set(mx.name, mx.props.map((p) => toProp(p)))
      model.mixins.push({
        id: mx.id ?? generateId('mixin'), name: mx.name,
        props: mx.props.map((p) => toProp(p)), ...(mx.loc ? { loc: mx.loc } : {}),
      })
    }
    for (const n of m.raw.nodes) {
      if (!rawNodes.has(n.name)) rawNodes.set(n.name, { raw: n, prefix, iri: base + n.name })
    }
  }

  // --- Ancestors, with cycle detection.
  const ancestorsOf = new Map<string, string[]>()
  for (const [name, entryDecl] of rawNodes) {
    const chain: string[] = []
    const seen = new Set<string>([name])
    let cursor = entryDecl.raw.extends
    while (cursor) {
      const parent = stripAlias(cursor)
      if (seen.has(parent)) {
        diagnostics.push(err('cyclic-inheritance',
          `Node type '${name}' has a cyclic inheritance chain through '${parent}'.`,
          entryDecl.raw.loc))
        break
      }
      const parentDecl = rawNodes.get(parent)
      if (!parentDecl) {
        diagnostics.push(err('unresolved-parent',
          `Node type '${name}' extends '${cursor}', which is not declared in this model or any it imports.`,
          entryDecl.raw.loc))
        break
      }
      seen.add(parent)
      chain.push(parent)
      cursor = parentDecl.raw.extends
    }
    ancestorsOf.set(name, chain)
  }

  // --- Build resolved node types.
  for (const [name, decl] of rawNodes) {
    const ancestors = ancestorsOf.get(name) ?? []
    const own = decl.raw.props.map((p) => toProp(p))
    const seenProps = new Set(own.map((p) => p.name))
    const props: PropertyIR[] = [...own]

    for (const mixinName of decl.raw.mixins) {
      const mp = mixinProps.get(mixinName)
      if (!mp) {
        diagnostics.push(err('unresolved-mixin',
          `Node type '${name}' applies mixin '${mixinName}', which is not declared.`, decl.raw.loc))
        continue
      }
      for (const p of mp) {
        if (seenProps.has(p.name)) continue
        seenProps.add(p.name)
        props.push({ ...p, id: generateId('prop'), inheritedFrom: mixinName })
      }
    }

    for (const ancestor of ancestors) {
      const a = rawNodes.get(ancestor)
      if (!a) continue
      for (const p of a.raw.props) {
        if (seenProps.has(p.name)) continue
        seenProps.add(p.name)
        props.push(toProp(p, ancestor))
      }
    }

    let key = decl.raw.key
    let keyInheritedFrom: string | undefined
    if (key.length === 0) {
      for (const ancestor of ancestors) {
        const a = rawNodes.get(ancestor)
        if (a && a.raw.key.length > 0) { key = a.raw.key; keyInheritedFrom = ancestor; break }
      }
    }

    const node: NodeTypeIR = {
      id: decl.raw.id ?? generateId('node'),
      name,
      qname: decl.prefix ? `${decl.prefix}:${name}` : name,
      iri: decl.iri,
      prefix: decl.prefix,
      abstract: decl.raw.abstract,
      open: decl.raw.open,
      ...(decl.raw.extends ? { extends: stripAlias(decl.raw.extends) } : {}),
      ancestors,
      mixins: decl.raw.mixins,
      key,
      ...(keyInheritedFrom ? { keyInheritedFrom } : {}),
      props,
      ...(decl.raw.previousIri ? { previousIri: decl.raw.previousIri } : {}),
      ...(decl.raw.loc ? { loc: decl.raw.loc } : {}),
    }
    model.nodes.push(node)
  }

  // --- Build resolved edge types.
  for (const m of loaded.values()) {
    const prefix = m.raw.namespace?.prefix ?? ''
    const base = m.raw.namespace?.iri ?? ''
    for (const e of m.raw.edges) {
      const from = e.from ? stripAlias(e.from) : undefined
      const to = e.to ? stripAlias(e.to) : undefined
      if (!from || !to) {
        diagnostics.push(err('missing-endpoint',
          `Edge type '${e.name}' must declare both from and to.`, e.loc))
        continue
      }
      for (const [label, ref] of [['from', from], ['to', to]] as const) {
        if (!rawNodes.has(ref)) {
          diagnostics.push(err('unresolved-endpoint',
            `Edge type '${e.name}' declares ${label} '${ref}', which is not a known node type.`, e.loc))
        }
      }
      const edge: EdgeTypeIR = {
        id: e.id ?? generateId('edge'),
        name: e.name,
        qname: prefix ? `${prefix}:${e.name}` : e.name,
        iri: base + e.name,
        prefix,
        from, to,
        cardinality: e.cardinality,
        props: e.props.map((p) => toProp(p)),
        ...(e.previousIri ? { previousIri: e.previousIri } : {}),
        ...(e.loc ? { loc: e.loc } : {}),
      }
      model.edges.push(edge)
    }
  }

  model.nodes.sort((a, b) => a.name.localeCompare(b.name))
  model.edges.sort((a, b) => a.name.localeCompare(b.name))
  model.enums.sort((a, b) => a.name.localeCompare(b.name))
  return { model, diagnostics }
}
