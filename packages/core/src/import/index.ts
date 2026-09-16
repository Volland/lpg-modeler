import { err, info, type Diagnostic, type ModelIR, type NodeTypeIR } from '../ir'
import { importRdf, type ImportResult, type TextImportInput } from './rdf'
import { importLadybug, type CatalogImportInput } from './ladybug'
import { importMemgraph, type MemgraphImportInput } from './memgraph'

/**
 * A file read as text, or a LadybugDB database whose catalog the caller has already
 * read -- `core` never opens a database itself. See lat.md/importers#Reading a LadybugDB Database.
 */
export type ImportInput = TextImportInput | CatalogImportInput | MemgraphImportInput

export type { ImportResult, TextImportInput, CatalogImportInput, MemgraphImportInput }

const texts = (inputs: ImportInput[]): TextImportInput[] =>
  inputs.filter((i): i is TextImportInput => 'text' in i)

/**
 * Internal registry, the mirror of the emitter one. Adding a source is a file plus one
 * entry here, and this is the same seam a public plugin API would expose.
 * See lat.md/importers#Importers.
 */
export type Importer = (inputs: ImportInput[]) => ImportResult

interface Registration {
  importer: Importer
  /** Extensions this source is recognised by when no format is named. */
  extensions: string[]
}

const REGISTRY = new Map<string, Registration>([
  ['rdf', { importer: (i) => importRdf(texts(i)), extensions: ['.ttl', '.owl', '.shacl', '.n3'] }],
  ['ladybug', { importer: (i) => importLadybug(i.filter((x): x is TextImportInput | CatalogImportInput => !('memgraphCatalog' in x))), extensions: ['.cypher', '.ddl'] }],
  // A running instance, read by the caller: it has no file extension to answer to.
  ['memgraph', { importer: (i) => importMemgraph(i.filter((x): x is MemgraphImportInput => 'memgraphCatalog' in x)), extensions: [] }],
])

export function registerImporter(name: string, reg: Registration): void {
  REGISTRY.set(name, reg)
}

export function importerNames(): string[] {
  return [...REGISTRY.keys()].sort()
}

/**
 * `shacl` and `owl` are read by one reader, so both name the same importer. `ladybug-db`
 * does too: to the command line it means "open this path as a database", but once the
 * catalog is read a database is just another LadybugDB source.
 */
const ALIASES: Record<string, string> = {
  shacl: 'rdf', owl: 'rdf', turtle: 'rdf', ttl: 'rdf', 'ladybug-db': 'ladybug',
}

export function resolveFormat(name: string): string | undefined {
  const key = name.toLowerCase()
  const target = ALIASES[key] ?? key
  return REGISTRY.has(target) ? target : undefined
}

/**
 * What a file is, from its name and then from its first line. Content wins nothing here
 * that the extension already settled; it is the fallback for a file named `schema.txt`.
 */
export function detectFormat(input: ImportInput): string | undefined {
  if ('ladybugCatalog' in input) return 'ladybug'
  if ('memgraphCatalog' in input) return 'memgraph'
  const lower = input.path.toLowerCase()
  for (const [name, reg] of REGISTRY) {
    if (reg.extensions.some((e) => lower.endsWith(e))) return name
  }
  if (/^\s*@prefix\b|^\s*@base\b|\bsh:NodeShape\b|\bowl:Class\b/m.test(input.text)) return 'rdf'
  if (/CREATE\s+(NODE|REL)\s+TABLE/i.test(input.text)) return 'ladybug'
  return undefined
}

/**
 * Import one or more files into a single model. Several files of the same kind are read
 * together rather than one at a time: a SHACL shapes graph and the OWL ontology beside
 * it each hold half of what a model says, and only their union reconstructs it.
 * See lat.md/importers#Why SHACL and OWL Are Read Together.
 */
export function importModel(inputs: ImportInput[], format?: string): ImportResult {
  const diagnostics: Diagnostic[] = []

  const groups = new Map<string, ImportInput[]>()
  for (const input of inputs) {
    // A catalog was already read from a database, so no format named for files applies to it.
    const kind = 'ladybugCatalog' in input ? 'ladybug'
      : 'memgraphCatalog' in input ? 'memgraph'
        : format ? resolveFormat(format) : detectFormat(input)
    if (!kind) {
      diagnostics.push(info('import-unknown-format',
        `Could not tell what '${input.path}' is from its name or its first lines. Name the format explicitly to read it.`))
      continue
    }
    const list = groups.get(kind) ?? []
    list.push(input)
    groups.set(kind, list)
  }

  const rdfInputs = groups.get('rdf') ?? []
  const ddlInputs = groups.get('ladybug') ?? []
  const memgraphInputs = (groups.get('memgraph') ?? []) as MemgraphImportInput[]

  // A running Memgraph is a whole schema on its own; nothing merges it with files yet.
  if (memgraphInputs.length > 0) {
    if (rdfInputs.length > 0 || ddlInputs.length > 0) {
      diagnostics.push(err('import-mixed-sources',
        'A Memgraph instance is imported on its own. Import it separately from RDF or LadybugDB sources.'))
    }
    const out = importMemgraph(memgraphInputs)
    return { model: out.model, diagnostics: [...diagnostics, ...out.diagnostics] }
  }

  if (rdfInputs.length > 0 && ddlInputs.length === 0) {
    const out = importRdf(texts(rdfInputs))
    return { model: out.model, diagnostics: [...diagnostics, ...out.diagnostics] }
  }
  if (ddlInputs.length > 0 && rdfInputs.length === 0) {
    const out = importLadybug(ddlInputs as Array<TextImportInput | CatalogImportInput>)
    return { model: out.model, diagnostics: [...diagnostics, ...out.diagnostics] }
  }
  if (rdfInputs.length === 0 && ddlInputs.length === 0) {
    return {
      model: {
        file: inputs[0]?.path ?? '',
        namespace: { prefix: 'model', iri: 'https://example.org/imported#' },
        prefixes: {}, nodes: [], edges: [], mixins: [], enums: [],
      },
      diagnostics,
    }
  }

  // Both kinds are present, so each can supply what the other cannot: RDF carries the
  // hierarchy and the constraints, the DDL the exact column widths and the endpoints.
  const rdf = importRdf(texts(rdfInputs))
  const parents = new Map<string, string>()
  for (const n of rdf.model.nodes) if (n.extends) parents.set(n.name, n.extends)
  const ddl = importLadybug(ddlInputs as Array<TextImportInput | CatalogImportInput>, { parents })
  return {
    model: merge(rdf.model, ddl.model, diagnostics),
    diagnostics: [...diagnostics, ...rdf.diagnostics, ...ddl.diagnostics],
  }
}

/**
 * RDF is the base because it alone carries the hierarchy, and a DDL column overrides
 * the datatype it read back: `xsd:integer` is written by two scalars and `xsd:string`
 * by three, while `INT128` and `UUID` name exactly one each.
 */
function merge(base: ModelIR, ddl: ModelIR, diagnostics: Diagnostic[]): ModelIR {
  const byName = new Map(base.nodes.map((n) => [n.name, n]))
  const refined: string[] = []

  const declaringType = (node: NodeTypeIR, prop: string): NodeTypeIR | undefined => {
    let cur: NodeTypeIR | undefined = node
    while (cur) {
      if (cur.props.some((p) => p.name === prop)) return cur
      cur = cur.extends ? byName.get(cur.extends) : undefined
    }
    return undefined
  }

  for (const table of ddl.nodes) {
    const node = byName.get(table.name)
    if (!node) { base.nodes.push(table); continue }
    for (const col of table.props) {
      // A column copied down by the generator belongs to whichever ancestor declares
      // it, so the width is applied there rather than pushed back onto the subtype.
      const owner = declaringType(node, col.name)
      if (!owner) { node.props.push(col); continue }
      const existing = owner.props.find((p) => p.name === col.name)
      if (!existing || existing.type === col.type) continue
      existing.type = col.type
      if (col.composite) existing.composite = col.composite
      if (col.precision !== undefined) existing.precision = col.precision
      if (col.scale !== undefined) existing.scale = col.scale
      refined.push(`${owner.name}.${col.name}`)
    }
  }

  const edgeByName = new Map(base.edges.map((e) => [e.name, e]))
  for (const rel of ddl.edges) {
    const edge = edgeByName.get(rel.name)
    if (!edge) { base.edges.push(rel); continue }
    const c = edge.cardinality
    const unset = c.from.min === 0 && c.from.max === null && c.to.min === 0 && c.to.max === null
    if (unset) edge.cardinality = rel.cardinality
    for (const col of rel.props) {
      const existing = edge.props.find((p) => p.name === col.name)
      if (!existing) { edge.props.push(col); continue }
      if (existing.type === col.type) continue
      existing.type = col.type
      if (col.composite) existing.composite = col.composite
      refined.push(`${edge.name}.${col.name}`)
    }
  }

  if (refined.length > 0) {
    diagnostics.push(info('import-refined',
      `${refined.length} datatype${refined.length === 1 ? ' was' : 's were'} taken from the DDL rather than from RDF, which writes several scalars onto one XSD type (${refined.sort().slice(0, 8).join(', ')}${refined.length > 8 ? ', …' : ''}).`))
  }
  return base
}
