import { Parser, Store, type Quad_Object, type Term } from 'n3'
import {
  DEFAULT_CARDINALITY, LPG_FORMAT_VERSION, info, warn, err,
  type Bound, type Cardinality, type ConstraintIR, type Diagnostic, type EdgeTypeIR,
  type EnumIR, type ModelIR, type NodeTypeIR, type PropertyIR, type ScalarType,
} from '../ir'
import { deriveId } from '../ids'
import {
  AMBIGUOUS, RDF, WELL_KNOWN, XSD, localName, namespaceOf, owl, rdfs,
  scalarForDatatype, sh, upperSnake,
} from './vocab'
import { lowerCamel } from '../emit/reify'

/**
 * Reads SHACL and OWL back into a model. The two are read together rather than one
 * apiece because neither is sufficient alone: SHACL says which class carries which
 * property but has the hierarchy flattened into it, while OWL carries `rdfs:subClassOf`
 * and `owl:hasKey` but deliberately asserts no `rdfs:domain`, so it cannot say where a
 * property lives. See lat.md/importers#Why SHACL and OWL Are Read Together.
 */

export interface ImportInput {
  path: string
  text: string
}

export interface ImportResult {
  model: ModelIR
  diagnostics: Diagnostic[]
}

/** A SHACL property shape, flattened out of its blank node. */
interface PropShape {
  path: string
  datatype?: string
  clazz?: string
  minCount?: number
  maxCount?: number
  values?: string[]
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  inverse?: string
}

const num = (t: Term | undefined): number | undefined => {
  if (!t) return undefined
  const n = Number(t.value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * SHACL conjoins property shapes: two `sh:property` blocks on one path both hold, which
 * is how the raw [[metamodel#Escape Hatch|escape hatch]] adds a constraint to a property
 * the model already declares. They are merged into one, tightest bound winning, rather
 * than read as two properties of the same name.
 */
function mergeShapes(a: PropShape, b: PropShape): PropShape {
  const tighter = (x: number | undefined, y: number | undefined, pick: (n: number[]) => number) => {
    const both = [x, y].filter((n): n is number => n !== undefined)
    return both.length === 0 ? undefined : pick(both)
  }
  const lo = (x?: number, y?: number) => tighter(x, y, (n) => Math.max(...n))
  const hi = (x?: number, y?: number) => tighter(x, y, (n) => Math.min(...n))
  return {
    path: a.path,
    datatype: a.datatype ?? b.datatype,
    clazz: a.clazz ?? b.clazz,
    minCount: lo(a.minCount, b.minCount),
    maxCount: hi(a.maxCount, b.maxCount),
    values: a.values ?? b.values,
    min: lo(a.min, b.min),
    max: hi(a.max, b.max),
    minLength: lo(a.minLength, b.minLength),
    maxLength: hi(a.maxLength, b.maxLength),
    pattern: a.pattern ?? b.pattern,
    inverse: a.inverse ?? b.inverse,
  }
}

/** One entry per path, so a property constrained twice is still one property. */
function byPath(shapes: PropShape[]): PropShape[] {
  const out = new Map<string, PropShape>()
  for (const ps of shapes) {
    const found = out.get(ps.path)
    out.set(ps.path, found ? mergeShapes(found, ps) : ps)
  }
  return [...out.values()]
}

export function importRdf(inputs: ImportInput[]): ImportResult {
  const diagnostics: Diagnostic[] = []
  const store = new Store()
  const prefixes = new Map<string, string>()

  for (const input of inputs) {
    try {
      const quads = new Parser({ baseIRI: `file://${input.path}` })
        .parse(input.text, null, (prefix, iri) => {
          if (!prefixes.has(prefix)) prefixes.set(prefix, (iri as Term).value)
        })
      store.addQuads(quads)
    } catch (e) {
      diagnostics.push(err('import-parse',
        `Could not parse '${input.path}' as Turtle: ${(e as Error).message}`))
    }
  }

  // A subject is passed as a term wherever one is in hand: N3 reads a bare string as a
  // NamedNode, so a blank node addressed by its label would never match.
  type Subj = Term | string
  const one = (s: Subj, p: string): Quad_Object | undefined => store.getObjects(s, p, null)[0]
  const all = (s: Subj, p: string): Quad_Object[] => store.getObjects(s, p, null)

  /** Walk an RDF collection into its members. Used by `owl:hasKey` and `sh:in`. */
  const list = (head: Term | undefined): Term[] => {
    const out: Term[] = []
    let node = head
    while (node && node.value !== RDF + 'nil') {
      const first = store.getObjects(node, RDF + 'first', null)[0]
      if (first) out.push(first)
      node = store.getObjects(node, RDF + 'rest', null)[0]
    }
    return out
  }

  // --- Namespace -----------------------------------------------------------------
  // The model's own vocabulary is the one prefix that is not a standard.
  const own = [...prefixes].filter(([p]) => !WELL_KNOWN.has(p))
  const shapeClasses = store.getObjects(null, sh('targetClass'), null).map((t) => t.value)
  const owlClasses = store.getSubjects(RDF + 'type', owl('Class'), null).map((t) => t.value)
  const sample = shapeClasses[0] ?? owlClasses[0]
  const nsIri = own[0]?.[1] ?? (sample ? namespaceOf(sample) : 'https://example.org/imported#')
  const nsPrefix = own[0]?.[0] ?? 'model'
  if (own.length > 1) {
    diagnostics.push(info('import-namespace',
      `Several non-standard prefixes are bound (${own.map(([p]) => p).join(', ')}); '${nsPrefix}' is taken as the model's own namespace and the rest are kept as prefix bindings.`))
  }

  const isOwn = (iri: string) => iri.startsWith(nsIri)
  const nameOf = (iri: string) => localName(iri)

  // --- Shapes --------------------------------------------------------------------
  const readPropShape = (bnode: Term): PropShape | undefined => {
    const pathTerm = one(bnode, sh('path'))
    if (!pathTerm) return undefined
    // An inverse path is a blank node carrying sh:inversePath, used for the bound at
    // the far end of an edge rather than for a property of this type.
    if (pathTerm.termType === 'BlankNode') {
      const inv = one(pathTerm, sh('inversePath'))
      return inv ? { path: '', inverse: inv.value } : undefined
    }
    const values = list(one(bnode, sh('in')))
    return {
      path: pathTerm.value,
      datatype: one(bnode, sh('datatype'))?.value,
      clazz: one(bnode, sh('class'))?.value,
      minCount: num(one(bnode, sh('minCount'))),
      maxCount: num(one(bnode, sh('maxCount'))),
      ...(values.length > 0 ? { values: values.map((v) => v.value) } : {}),
      min: num(one(bnode, sh('minInclusive'))),
      max: num(one(bnode, sh('maxInclusive'))),
      minLength: num(one(bnode, sh('minLength'))),
      maxLength: num(one(bnode, sh('maxLength'))),
      pattern: one(bnode, sh('pattern'))?.value,
    }
  }

  /** Every shape that targets a class, with its property shapes read out. */
  const shapes = new Map<string, { shape: string; closed: boolean; props: PropShape[] }>()
  const constraintShapes: Array<{ shape: string; target: string }> = []

  for (const shape of store.getSubjects(RDF + 'type', sh('NodeShape'), null)) {
    const target = one(shape, sh('targetClass'))
    if (!target) continue
    const props = all(shape, sh('property'))
      .map(readPropShape)
      .filter((p): p is PropShape => p !== undefined)
    // A shape named `<Type>_<name>Shape` is a named constraint, not the type's own
    // shape: one shape per constraint is what lets each carry its own sh:message.
    if (/^.+_.+Shape$/.test(localName(shape.value))) {
      constraintShapes.push({ shape: shape.value, target: target.value })
      continue
    }
    const existing = shapes.get(target.value)
    if (existing) existing.props.push(...props)
    else {
      shapes.set(target.value, {
        shape: shape.value,
        closed: one(shape, sh('closed'))?.value === 'true',
        props,
      })
    }
  }

  // Without shapes there is no evidence of cardinality, closure, value constraints, or
  // which classes are relations rather than types -- an n-ary relation class is an
  // ordinary class to an ontology. Saying so beats reading a relation back as a node type
  // and leaving the user to notice.
  if (shapes.size === 0 && store.size > 0) {
    diagnostics.push(info('import-no-shapes',
      'No SHACL node shapes were supplied. An ontology alone carries no cardinality, no value constraints, no open/closed distinction, and no way to tell a reified relation class from a node type. Import the shapes graph alongside it for those.'))
  }

  // --- Reified edges -------------------------------------------------------------
  // An edge that carries properties was reified into a class with a subject/object
  // pair. Recognising that pair is what keeps a relationship from being read back as
  // an ordinary node type. See lat.md/importers#Reading Edges.
  interface Reified { clazz: string; base: string; from?: string; to?: string; props: PropShape[] }
  const reified = new Map<string, Reified>()

  for (const [clazz, entry] of shapes) {
    const locals = new Map(entry.props.map((p) => [nameOf(p.path), p]))
    let base: string | undefined
    for (const local of locals.keys()) {
      if (!local.endsWith('Subject')) continue
      const stem = local.slice(0, -'Subject'.length)
      if (locals.has(`${stem}Object`)) { base = stem; break }
    }
    if (base === undefined) continue
    reified.set(clazz, {
      clazz,
      base,
      from: locals.get(`${base}Subject`)?.clazz,
      to: locals.get(`${base}Object`)?.clazz,
      props: entry.props.filter((p) => {
        const l = nameOf(p.path)
        return l !== `${base}Subject` && l !== `${base}Object`
      }),
    })
  }

  /** Shortcut properties stand for a reified edge, so they are not node properties. */
  const shortcuts = new Set([...reified.values()].map((r) => r.base))

  // --- Node types ----------------------------------------------------------------
  const classIris = [...new Set([...shapeClasses, ...owlClasses])]
    .filter((c) => isOwn(c) && !reified.has(c))
    .sort()

  const labelOf = (iri: string) => one(iri, rdfs('label'))?.value ?? nameOf(iri)

  const enums: EnumIR[] = []
  const takenEnum = new Set<string>()
  /** An `sh:in` list has values but no name, so one is made from the property it sits on. */
  const enumFor = (propName: string, values: string[]): string => {
    const found = enums.find((e) => e.values.length === values.length
      && e.values.every((v, i) => v === values[i]))
    if (found) return found.name
    let name = propName.charAt(0).toUpperCase() + propName.slice(1)
    while (takenEnum.has(name)) name += '_'
    takenEnum.add(name)
    const id = deriveId('enum', name)
    enums.push({
      id, name, values,
      qname: `${nsPrefix}:${name}`, iri: nsIri + name, prefix: nsPrefix,
    })
    return name
  }

  const ambiguous = new Set<string>()

  const toProperty = (owner: string, ps: PropShape): PropertyIR => {
    const name = nameOf(ps.path)
    let type: ScalarType = 'string'
    if (ps.datatype) {
      const s = scalarForDatatype(ps.datatype)
      if (s) {
        type = s
        if (ps.datatype.startsWith(XSD) && AMBIGUOUS.has(ps.datatype.slice(XSD.length))) {
          ambiguous.add(`${owner}.${name}`)
        }
      } else {
        diagnostics.push(warn('import-datatype',
          `Property '${owner}.${name}' has datatype <${ps.datatype}>, which is not an XSD type this metamodel knows. Read as string.`))
      }
    }
    return {
      id: deriveId('prop', name, owner),
      name,
      type,
      list: ps.maxCount === undefined || ps.maxCount > 1,
      required: (ps.minCount ?? 0) >= 1,
      unique: false,
      ...(ps.values ? { enum: enumFor(name, ps.values) } : {}),
      ...(ps.min !== undefined ? { min: ps.min } : {}),
      ...(ps.max !== undefined ? { max: ps.max } : {}),
      ...(ps.minLength !== undefined ? { minLength: ps.minLength } : {}),
      ...(ps.maxLength !== undefined ? { maxLength: ps.maxLength } : {}),
      ...(ps.pattern !== undefined ? { pattern: ps.pattern } : {}),
    }
  }

  const nodes: NodeTypeIR[] = []
  for (const iri of classIris) {
    const name = nameOf(iri)
    const entry = shapes.get(iri)
    const parentIri = one(iri, rdfs('subClassOf'))?.value
    const keyIris = list(one(iri, owl('hasKey'))).map((t) => nameOf(t.value))
    // A datatype path is a property; a path carrying sh:class is an edge, and a
    // shortcut property stands for a reified edge.
    const propShapes = (entry?.props ?? []).filter((p) => {
      const l = nameOf(p.path)
      return p.inverse === undefined && !shortcuts.has(l) && p.clazz === undefined
    })
    nodes.push({
      id: deriveId('node', name),
      name,
      qname: `${nsPrefix}:${name}`,
      iri,
      prefix: nsPrefix,
      // OWL has no notion of an uninstantiable class, so this cannot be recovered.
      abstract: false,
      // No shape is no evidence either way, so the metamodel's default stands.
      open: entry ? !entry.closed : false,
      ...(parentIri && isOwn(parentIri) ? { extends: nameOf(parentIri) } : {}),
      ancestors: [],
      mixins: [],
      key: keyIris,
      props: byPath(propShapes).map((p) => toProperty(name, p)),
      constraints: [],
    })
  }

  const byName = new Map(nodes.map((n) => [n.name, n]))

  // --- What only OWL says --------------------------------------------------------
  // This project's own ontology asserts no rdfs:domain, so on a round trip the block
  // below adds nothing and SHACL supplies every property. A foreign ontology is the
  // other way round: domain and range are usually the only statement of where a
  // property lives, and without reading them every property in it would be dropped.
  // See lat.md/importers#What Only OWL Says.

  /** A domain may be one class, or a union of them written as a blank node. */
  const domainsOf = (iri: string): string[] => {
    const out: string[] = []
    for (const d of all(iri, rdfs('domain'))) {
      if (d.termType !== 'BlankNode') { out.push(d.value); continue }
      const union = one(d, owl('unionOf'))
      if (union) for (const m of list(union)) out.push(m.value)
    }
    return out.filter(isOwn)
  }

  /** Named somewhere already, so a shape has placed it and OWL need not. */
  const placed = (local: string) =>
    nodes.some((n) => n.props.some((p) => p.name === local))

  const unplaced = new Set<string>()

  for (const prop of store.getSubjects(RDF + 'type', owl('DatatypeProperty'), null)) {
    const iri = prop.value
    if (!isOwn(iri)) continue
    const local = nameOf(iri)
    const domains = domainsOf(iri)
    if (domains.length === 0) {
      if (!placed(local)) unplaced.add(local)
      continue
    }
    const range = one(iri, rdfs('range'))?.value
    for (const d of domains) {
      const node = byName.get(nameOf(d))
      if (!node || node.props.some((p) => p.name === local)) continue
      let type: ScalarType = 'string'
      if (range) {
        const scalar = scalarForDatatype(range)
        if (scalar) {
          type = scalar
          if (range.startsWith(XSD) && AMBIGUOUS.has(range.slice(XSD.length))) {
            ambiguous.add(`${node.name}.${local}`)
          }
        } else {
          diagnostics.push(warn('import-datatype',
            `Property '${node.name}.${local}' has range <${range}>, which is not an XSD type this metamodel knows. Read as string.`))
        }
      }
      node.props.push({
        id: deriveId('prop', local, node.name),
        name: local, type, list: false, required: false, unique: false,
      })
    }
  }

  // --- Edges ---------------------------------------------------------------------
  const edges: EdgeTypeIR[] = []
  const makeEdge = (name: string, from: string, to: string, props: PropertyIR[],
    cardinality: Cardinality): EdgeTypeIR => ({
    id: deriveId('edge', name),
    name,
    qname: `${nsPrefix}:${name}`,
    iri: nsIri + name,
    prefix: nsPrefix,
    from, to, props, cardinality,
  })

  /** The nearest type that every one of these types reaches by `extends`. */
  const commonAncestor = (names: string[]): string => {
    if (names.length === 1) return names[0]!
    const chain = (n: string): string[] => {
      const out = [n]
      let cur = byName.get(n)
      while (cur?.extends) { out.push(cur.extends); cur = byName.get(cur.extends) }
      return out
    }
    const first = chain(names[0]!)
    for (const candidate of first) {
      if (names.every((n) => chain(n).includes(candidate))) return candidate
    }
    return names[0]!
  }

  // A plain edge appears as a class-valued path on every shape whose type may travel
  // it, so the same edge is seen once per concrete subtype. Collapsing those to their
  // common ancestor is what puts the declaration back where the model had it.
  const plain = new Map<string, { froms: string[]; to: string; bound: Bound }>()
  for (const [clazz, entry] of shapes) {
    if (reified.has(clazz) || !byName.has(nameOf(clazz))) continue
    for (const ps of entry.props) {
      if (ps.inverse !== undefined || ps.clazz === undefined) continue
      const local = nameOf(ps.path)
      if (shortcuts.has(local)) continue
      const found = plain.get(local)
      const bound: Bound = { min: ps.minCount ?? 0, max: ps.maxCount ?? null }
      if (found) found.froms.push(nameOf(clazz))
      else plain.set(local, { froms: [nameOf(clazz)], to: nameOf(ps.clazz), bound })
    }
  }

  /** The bound at the far end, read from the inverse-path shapes that carry it. */
  const inverseBound = (shortcutLocal: string): Bound => {
    for (const entry of shapes.values()) {
      for (const ps of entry.props) {
        if (ps.inverse && nameOf(ps.inverse) === shortcutLocal) {
          return { min: ps.minCount ?? 0, max: ps.maxCount ?? null }
        }
      }
    }
    return { min: 0, max: null }
  }

  for (const [local, e] of [...plain].sort(([a], [b]) => a.localeCompare(b))) {
    const iri = nsIri + local
    const name = one(iri, rdfs('label'))?.value ?? upperSnake(local)
    edges.push(makeEdge(name, commonAncestor(e.froms), e.to, [],
      { from: inverseBound(local), to: e.bound }))
  }

  for (const r of [...reified.values()].sort((a, b) => a.base.localeCompare(b.base))) {
    const name = labelOf(r.clazz) === nameOf(r.clazz)
      ? upperSnake(r.base)
      : labelOf(r.clazz)
    if (!r.from || !r.to) {
      diagnostics.push(warn('import-endpoint',
        `Edge '${name}' is reified but its subject or object shape declares no sh:class, so its endpoints could not be determined.`))
    }
    // The shortcut carries the bounds; the reified class only says a relationship has
    // exactly one subject and one object, which is true of every edge.
    const cardinality: Cardinality = plain.has(r.base)
      ? { from: inverseBound(r.base), to: plain.get(r.base)!.bound }
      : { from: inverseBound(r.base), to: { min: 0, max: null } }
    edges.push(makeEdge(name, r.from ? nameOf(r.from) : '', r.to ? nameOf(r.to) : '',
      byPath(r.props).map((p) => toProperty(name, p)), cardinality))
  }

  // The same for relations: an object property with a domain and a range is an edge,
  // unless a shape already produced one for it.
  const takenEdge = new Set<string>()
  for (const e of edges) takenEdge.add(lowerCamel(e.name))
  for (const r of reified.values()) {
    takenEdge.add(r.base)
    takenEdge.add(`${r.base}Subject`)
    takenEdge.add(`${r.base}Object`)
  }

  for (const prop of store.getSubjects(RDF + 'type', owl('ObjectProperty'), null)) {
    const iri = prop.value
    if (!isOwn(iri)) continue
    const local = nameOf(iri)
    if (takenEdge.has(local)) continue
    const domains = domainsOf(iri)
    const range = one(iri, rdfs('range'))?.value
    if (domains.length === 0 || !range || !isOwn(range) || !byName.has(nameOf(range))) {
      unplaced.add(local)
      continue
    }
    takenEdge.add(local)
    const label = one(iri, rdfs('label'))?.value
    edges.push(makeEdge(label ?? upperSnake(local), commonAncestor(domains.map(nameOf)),
      nameOf(range), [], { from: { min: 0, max: null }, to: { min: 0, max: null } }))
  }

  if (unplaced.size > 0) {
    diagnostics.push(warn('import-unplaced',
      `${unplaced.size} propert${unplaced.size === 1 ? 'y is' : 'ies are'} declared in the vocabulary but could not be attached to a type, because nothing says which type carries them — no SHACL shape names them and they have no rdfs:domain (${[...unplaced].sort().slice(0, 8).join(', ')}${unplaced.size > 8 ? ', …' : ''}). They were not imported.`))
  }

  // --- Un-flatten inheritance ----------------------------------------------------
  hoistInherited(nodes, byName, diagnostics)

  // --- Named constraints ---------------------------------------------------------
  for (const { shape, target } of constraintShapes) {
    const node = byName.get(nameOf(target))
    if (!node) continue
    const k = readConstraint(shape, node.name, one, all, list, nameOf, readPropShape)
    if (k) node.constraints.push(k)
    else {
      diagnostics.push(info('import-constraint',
        `Shape <${localName(shape)}> targets '${node.name}' but does not match any assertion this metamodel can express; it was not imported.`))
    }
  }

  if (ambiguous.size > 0) {
    diagnostics.push(info('import-datatype-ambiguous',
      `${ambiguous.size} propert${ambiguous.size === 1 ? 'y' : 'ies'} used an XSD datatype that more than one scalar generates (${[...ambiguous].sort().slice(0, 6).join(', ')}${ambiguous.size > 6 ? ', …' : ''}). The commonest scalar was chosen; check any that should be a narrower width, a zoned timestamp, a uuid or json.`))
  }
  diagnostics.push(info('import-lossy',
    'RDF cannot express an abstract type, a mixin, or a uniqueness constraint, so none were recovered. Mark abstract types and re-apply mixins by hand.'))

  const extra: Record<string, string> = {}
  for (const [p, iri] of prefixes) {
    if (!WELL_KNOWN.has(p) && p !== nsPrefix) extra[p] = iri
  }

  return {
    model: {
      file: inputs[0]?.path ?? '',
      namespace: { prefix: nsPrefix, iri: nsIri },
      formatVersion: LPG_FORMAT_VERSION,
      prefixes: extra,
      nodes,
      edges,
      mixins: [],
      enums,
    },
    diagnostics,
  }
}

/**
 * SHACL copies an inherited property onto every subtype, because a shape has no notion
 * of inheritance. A property carried identically by every child of a type belongs to
 * that type, so it is moved back up. This is a good reading of the evidence rather than
 * a proof -- three subtypes that happen to share a `label` would be hoisted too -- so
 * every move is reported. See lat.md/importers#Un-flattening Inheritance.
 */
function hoistInherited(
  nodes: NodeTypeIR[], byName: Map<string, NodeTypeIR>, diagnostics: Diagnostic[],
): void {
  const childrenOf = new Map<string, NodeTypeIR[]>()
  for (const n of nodes) {
    if (!n.extends) continue
    const list = childrenOf.get(n.extends) ?? []
    list.push(n)
    childrenOf.set(n.extends, list)
  }

  const same = (a: PropertyIR, b: PropertyIR) =>
    a.name === b.name && a.type === b.type && a.required === b.required
    && a.list === b.list && a.enum === b.enum && a.pattern === b.pattern
    && a.min === b.min && a.max === b.max
    && a.minLength === b.minLength && a.maxLength === b.maxLength

  // Deepest parents first, so a property shared by every leaf reaches the root.
  const depth = (n: NodeTypeIR): number => {
    let d = 0
    let cur: NodeTypeIR | undefined = n
    while (cur?.extends) { d++; cur = byName.get(cur.extends) }
    return d
  }
  const parents = nodes.filter((n) => childrenOf.has(n.name)).sort((a, b) => depth(b) - depth(a))

  const hoisted: string[] = []

  // A key belongs to the type owl:hasKey names it for, whatever the subtype count: a
  // child repeating its parent's key is repeating an inherited declaration.
  for (const parent of nodes) {
    if (parent.key.length === 0) continue
    for (const child of childrenOf.get(parent.name) ?? []) {
      for (const name of parent.key) {
        const onChild = child.props.find((p) => p.name === name)
        const onParent = parent.props.find((p) => p.name === name)
        if (!onChild) continue
        if (!onParent) { parent.props.push(onChild); hoisted.push(`${parent.name}.${name}`) }
        child.props = child.props.filter((p) => p.name !== name)
      }
      if (child.key.length === parent.key.length
          && child.key.every((k, i) => k === parent.key[i])) {
        child.key = []
      }
    }
  }

  for (const parent of parents) {
    const children = childrenOf.get(parent.name) ?? []
    // One subtype is no evidence: a property on the only child of a type is exactly as
    // consistent with the child declaring it as with the parent doing so. Two agreeing
    // subtypes are the least that distinguishes the two readings -- except for a key,
    // which owl:hasKey attributes to a type outright.
    if (children.length < 2) continue
    const first = children[0]!
    for (const candidate of [...first.props]) {
      if (parent.props.some((p) => p.name === candidate.name)) continue
      if (!children.every((c) => c.props.some((p) => same(p, candidate)))) continue
      parent.props.push(candidate)
      for (const c of children) c.props = c.props.filter((p) => p.name !== candidate.name)
      hoisted.push(`${parent.name}.${candidate.name}`)
    }
    for (const c of children) {
      if (c.key.length === parent.key.length && c.key.every((k, i) => k === parent.key[i])) {
        c.key = []
      }
    }
  }

  hoisted.sort()
  if (hoisted.length > 0) {
    diagnostics.push(info('import-hoisted',
      `${hoisted.length} propert${hoisted.length === 1 ? 'y was' : 'ies were'} carried by every subtype and moved up to the parent that most likely declared them (${hoisted.slice(0, 8).join(', ')}${hoisted.length > 8 ? ', …' : ''}). Check any that were genuinely repeated rather than inherited.`))
  }
}

/** One named constraint, read back from the shape that carries it. */
function readConstraint(
  shape: string, owner: string,
  one: (s: Term | string, p: string) => Term | undefined,
  all: (s: Term | string, p: string) => Term[],
  list: (head: Term | undefined) => Term[],
  nameOf: (iri: string) => string,
  readPropShape: (t: Term) => PropShape | undefined,
): ConstraintIR | undefined {
  const local = localName(shape)
  const name = local.replace(/Shape$/, '').slice(owner.length + 1)
  const id = deriveId('constraint', name, owner)
  // The emitter writes the message and the severity on whichever shape reports the
  // result: the node shape for a choice, the property shape for everything else.
  const reported = (p: string) => one(shape, sh(p))
    ?? all(shape, sh('property')).map((b) => one(b, sh(p))).find((t) => t !== undefined)
  const message = reported('message')?.value
  const severity = { [sh('Warning')]: 'warning', [sh('Info')]: 'info' }[reported('severity')?.value ?? ''] as
    ConstraintIR['severity']

  const finish = (assert: ConstraintIR['assert']): ConstraintIR =>
    ({ id, name, assert, ...(message ? { message } : {}), ...(severity ? { severity } : {}) })

  for (const [kind, pred] of [['lessThan', 'lessThan'], ['lessThanOrEquals', 'lessThanOrEquals'],
    ['equals', 'equals'], ['disjoint', 'disjoint']] as const) {
    for (const bnode of all(shape, sh('property'))) {
      const right = one(bnode, sh(pred))
      const path = one(bnode, sh('path'))
      if (right && path) {
        return finish({ kind, left: nameOf(path.value), right: nameOf(right.value) })
      }
    }
  }

  for (const [kind, pred] of [['atLeastOne', 'or'], ['exactlyOne', 'xone']] as const) {
    const head = one(shape, sh(pred))
    if (!head) continue
    const members = list(head)
      .map((m) => one(m, sh('path')))
      .filter((p): p is Term => p !== undefined)
      .map((p) => nameOf(p.value))
    if (members.length > 0) return finish({ kind, props: members })
  }

  for (const bnode of all(shape, sh('property'))) {
    const ps = readPropShape(bnode)
    if (!ps || !ps.path) continue
    const qualified = one(bnode, sh('qualifiedValueShape'))
    const of = qualified ? one(qualified, sh('class')) : undefined
    const min = qualified
      ? Number(one(bnode, sh('qualifiedMinCount'))?.value)
      : ps.minCount
    const max = qualified
      ? Number(one(bnode, sh('qualifiedMaxCount'))?.value)
      : ps.maxCount
    if (min === undefined && max === undefined) continue
    return finish({
      kind: 'count',
      edge: upperSnake(nameOf(ps.path)),
      ...(of ? { of: nameOf(of.value) } : {}),
      ...(Number.isFinite(min) ? { min: min as number } : {}),
      ...(Number.isFinite(max) ? { max: max as number } : {}),
    })
  }
  return undefined
}
