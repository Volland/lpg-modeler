import type { Diagnostic, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR, ScalarType } from '../ir'
import { concreteNodes, describeCardinality, formatValueType, isUnconstrained } from '../ir'
import {
  compositeDowngrade, downgrade, reportUnsupportedConstraints,
  type Capabilities, type EmitOptions, type EmitResult,
} from '../capabilities'
import { labelsFor } from './neo4j'

/**
 * Memgraph is schema-optional and multi-label like Neo4j, but its Community edition
 * enforces more: existence, uniqueness and value-type constraints, and native enums,
 * all checked on write and all refused up front when existing data violates them.
 * What it has none of is a relationship constraint. Measured against 3.13.1.
 * See lat.md/emitters#Memgraph Target.
 */
export const MEMGRAPH_CAPABILITIES: Capabilities = {
  target: 'memgraph',
  multiLabel: true,
  inheritance: 'labels',
  requiredConstraint: 'enforced',
  uniqueConstraint: 'enforced',
  // A uniqueness constraint takes a property list, so a composite key is one constraint.
  compositeKey: 'native',
  edgeProps: 'native',
  nestedEdges: false,
  listProps: 'native',
  // `IS TYPED MAP` would admit any map, which is not what a struct declares.
  compositeTypes: 'unsupported',
  enums: 'enforced',
  openTypes: 'always-open',
  valueConstraints: 'unsupported',
  namedConstraints: 'unsupported',
  rawPassthrough: false,
  cardinality: 'unsupported',
}

/**
 * One enum, constraint, index or downgrade note. The emitter prints `create`; the
 * migration planner diffs two sets by `identity` and runs `drop` for what went away, so
 * a migration cannot spell a statement differently from `emit`.
 */
export interface MemgraphSchemaObject {
  kind: 'enum' | 'constraint' | 'index' | 'note'
  /** Everything that defines the object, so a changed definition is a different object. */
  identity: string
  /** The statement, or the comment lines of a note. */
  create: string
  /** Absent for a note, and for an enum, which Memgraph cannot drop. */
  drop?: string
  /** The type or enum the object belongs to, as named in the model. */
  owner: string
  /** Set on an enum object, for the planner to compare value by value. */
  enum?: { name: string; values: string[] }
}

/** The `IS TYPED` keyword for a scalar, and what the keyword fails to hold of it. */
const TYPED: Record<ScalarType, { keyword?: string; lost?: string }> = {
  string: { keyword: 'STRING' },
  int: { keyword: 'INTEGER' },
  int8: { keyword: 'INTEGER', lost: 'its 8-bit width' },
  int16: { keyword: 'INTEGER', lost: 'its 16-bit width' },
  int32: { keyword: 'INTEGER', lost: 'its 32-bit width' },
  int128: { keyword: 'INTEGER', lost: 'its 128-bit range; a Memgraph integer is 64-bit' },
  uint8: { keyword: 'INTEGER', lost: 'that it is unsigned and 8-bit' },
  uint16: { keyword: 'INTEGER', lost: 'that it is unsigned and 16-bit' },
  uint32: { keyword: 'INTEGER', lost: 'that it is unsigned and 32-bit' },
  uint64: { keyword: 'INTEGER', lost: 'that it is unsigned; a Memgraph integer is signed 64-bit' },
  float: { keyword: 'FLOAT' },
  float32: { keyword: 'FLOAT', lost: 'its 32-bit precision' },
  decimal: { keyword: 'FLOAT', lost: 'its exact decimal precision' },
  boolean: { keyword: 'BOOLEAN' },
  date: { keyword: 'DATE' },
  datetime: { keyword: 'LOCALDATETIME' },
  zoneddatetime: { keyword: 'ZONEDDATETIME' },
  duration: { keyword: 'DURATION' },
  uuid: { lost: 'any type at all: Memgraph has no UUID type, and STRING would admit any string' },
  json: { lost: 'any type at all: Memgraph has no JSON type' },
  blob: { lost: 'any type at all: Memgraph has no binary type' },
}

/** A name as Memgraph will parse it: bare when it is an identifier, backticked otherwise. */
export const ident = (name: string): string =>
  (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `\`${name.replace(/`/g, '``')}\``)

function nodeObjects(node: NodeTypeIR, diags: Diagnostic[], out: MemgraphSchemaObject[]): void {
  const L = ident(node.name)
  const note = (...lines: string[]) =>
    out.push({ kind: 'note', identity: `note ${node.name} ${lines.join(' ')}`, create: lines.join('\n'), owner: node.name })
  const constraint = (identity: string, assertion: string) => out.push({
    kind: 'constraint', identity: `${identity} ${node.name}`, owner: node.name,
    create: `CREATE CONSTRAINT ON (n:${L}) ASSERT ${assertion};`,
    drop: `DROP CONSTRAINT ON (n:${L}) ASSERT ${assertion};`,
  })
  const prop = (p: PropertyIR) => `n.${ident(p.name)}`
  const isKey = (p: PropertyIR) => node.key.includes(p.name)

  if (node.key.length > 0) {
    const keyProps = node.key.map((k) => `n.${ident(k)}`)
    constraint(`unique ${node.key.join(',')}`, `${keyProps.join(', ')} IS UNIQUE`)
    // Uniqueness ignores a node without the property, so a key also needs existence on
    // each part to mean what a key means in the model.
    for (const k of node.key) constraint(`exists ${k}`, `EXISTS (n.${ident(k)})`)
    // Memgraph constraints carry no name, so a type with two unique, present properties
    // would not say which is the key. The index says it, for a reader and for lookups.
    const on = node.key.map(ident).join(', ')
    out.push({
      kind: 'index', identity: `key-index ${node.name} ${node.key.join(',')}`, owner: node.name,
      create: `CREATE INDEX ON :${L}(${on});`, drop: `DROP INDEX ON :${L}(${on});`,
    })
  }

  for (const p of node.props) {
    if (p.unique && !isKey(p)) constraint(`unique ${p.name}`, `${prop(p)} IS UNIQUE`)
    if (p.required && !isKey(p)) constraint(`exists ${p.name}`, `EXISTS (${prop(p)})`)

    if (p.composite) {
      compositeDowngrade(diags, 'memgraph', node.name, p, 'an untyped property')
      note(`// UNENFORCED: '${p.name}' is ${formatValueType(p.composite)} in the model; Memgraph can only`,
        '// say a value is some map or list, so no type constraint is emitted.')
    } else if (p.enum) {
      downgrade(diags, 'memgraph', 'downgrade-enum-identity',
        `Property '${node.name}.${p.name}' is limited to enum '${p.enum}'. Memgraph can require that the value is an enum, but not that it is this one.`,
        p.loc)
      note(`// PARTIAL: '${p.name}' must be an enum value; that it belongs to ${p.enum} is unenforced.`)
      constraint(`typed ${p.name} ENUM`, `${prop(p)} IS TYPED ENUM`)
    } else if (p.list) {
      downgrade(diags, 'memgraph', 'downgrade-list-element',
        `Property '${node.name}.${p.name}' is a list of ${p.type}. Memgraph can require a list, but not the type of its elements.`,
        p.loc)
      note(`// PARTIAL: '${p.name}' must be a list; its elements being ${p.type} is unenforced.`)
      constraint(`typed ${p.name} LIST`, `${prop(p)} IS TYPED LIST`)
    } else {
      const typed = TYPED[p.type]
      if (typed.lost) {
        downgrade(diags, 'memgraph', typed.keyword ? 'downgrade-type-width' : 'downgrade-type',
          `Property '${node.name}.${p.name}' is ${p.type}. Memgraph's type constraint does not hold ${typed.lost}.`,
          p.loc)
        note(`// ${typed.keyword ? 'PARTIAL' : 'UNENFORCED'}: '${p.name}' is ${p.type} in the model; the constraint does not hold ${typed.lost}.`)
      }
      if (typed.keyword) constraint(`typed ${p.name} ${typed.keyword}`, `${prop(p)} IS TYPED ${typed.keyword}`)
    }
  }

  for (const p of node.props) {
    if (!p.required || p.unique || isKey(p)) continue
    out.push({
      kind: 'index', identity: `index ${node.name} ${p.name}`, owner: node.name,
      create: `CREATE INDEX ON :${L}(${ident(p.name)});`,
      drop: `DROP INDEX ON :${L}(${ident(p.name)});`,
    })
  }
}

function edgeObjects(edge: EdgeTypeIR, diags: Diagnostic[], out: MemgraphSchemaObject[]): void {
  const note = (line: string) =>
    out.push({ kind: 'note', identity: `note ${edge.name} ${line}`, create: line, owner: edge.name })
  if (!isUnconstrained(edge.cardinality)) {
    downgrade(diags, 'memgraph', 'downgrade-cardinality',
      `Edge type '${edge.name}' declares ${describeCardinality(edge.cardinality)} cardinality, which Memgraph has no constraint for.`,
      edge.loc)
    note(`// UNENFORCED: ${describeCardinality(edge.cardinality)} in the model; Memgraph has no multiplicity constraint.`)
  }
  for (const p of edge.props) {
    if (p.composite) {
      compositeDowngrade(diags, 'memgraph', edge.name, p, 'an untyped property')
      note(`// UNENFORCED: '${p.name}' is ${formatValueType(p.composite)} in the model.`)
    }
    if (p.required) {
      downgrade(diags, 'memgraph', 'downgrade-edge-required',
        `Edge property '${edge.name}.${p.name}' is required, but Memgraph has no constraint on relationships.`,
        p.loc)
      note(`// UNENFORCED: '${p.name}' is required; Memgraph has no relationship constraints.`)
    }
    if (p.unique) {
      downgrade(diags, 'memgraph', 'downgrade-edge-unique',
        `Edge property '${edge.name}.${p.name}' is unique, but Memgraph has no constraint on relationships.`,
        p.loc)
      note(`// UNENFORCED: '${p.name}' is unique; Memgraph has no relationship constraints.`)
    }
  }
}

/**
 * Every enum, constraint, index and note the target produces, in the order they are
 * written: enums first, since data written afterwards names them, then each concrete
 * type's objects, then each edge type's notes. See lat.md/emitters#Memgraph Target.
 */
export function memgraphSchema(model: ModelIR): { objects: MemgraphSchemaObject[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const objects: MemgraphSchemaObject[] = []
  for (const e of model.enums) {
    objects.push({
      kind: 'enum', identity: `enum ${e.name}`, owner: e.name,
      create: `CREATE ENUM ${ident(e.name)} VALUES { ${e.values.map(ident).join(', ')} };`,
      enum: { name: e.name, values: [...e.values] },
    })
  }
  for (const node of concreteNodes(model)) nodeObjects(node, diagnostics, objects)
  for (const edge of model.edges) edgeObjects(edge, diagnostics, objects)
  reportUnsupportedConstraints(diagnostics, 'memgraph', model, MEMGRAPH_CAPABILITIES)
  return { objects, diagnostics }
}

export function emitMemgraph(model: ModelIR, _options: EmitOptions = {}): EmitResult {
  const { objects, diagnostics } = memgraphSchema(model)
  const parts: string[] = [
    '// Generated by lpg-modeler. Target: memgraph.',
    `// Model: ${model.namespace.prefix} <${model.namespace.iri}>`,
    '//',
    '// Measured against Memgraph 3.13.1 Community. See lat.md/emitters#Memgraph Target.',
    '//',
    '// Apply to a fresh instance, then carry it forward with `lpg migrate`: a type',
    '// constraint and an enum cannot be created twice, and an enum outlives every reset.',
    '//',
    '// Enums are native here. A value is written as Enum::value, e.g. Status::active,',
    '// and a plain string is rejected wherever a property is limited to an enum.',
    '//',
    '// A hierarchy is expressed as labels, so a node carries its own label and every',
    '// ancestor label. Memgraph is schema-optional: a closed type is documentation here.',
    '',
  ]

  const enums = objects.filter((o) => o.kind === 'enum')
  if (enums.length > 0) parts.push(...enums.map((o) => o.create), '')

  const byOwner = new Map<string, MemgraphSchemaObject[]>()
  for (const o of objects) {
    if (o.kind === 'enum') continue
    byOwner.set(o.owner, [...(byOwner.get(o.owner) ?? []), o])
  }
  for (const node of concreteNodes(model)) {
    const labels = labelsFor(node)
    parts.push(`// ${node.name}${labels.length > 1 ? ` carries labels :${labels.join(' :')}.` : ''}`)
    parts.push(...(byOwner.get(node.name) ?? []).map((o) => o.create), '')
  }
  for (const edge of model.edges) {
    const lines = (byOwner.get(edge.name) ?? []).map((o) => o.create)
    parts.push(`// (:${edge.from})-[:${edge.name}]->(:${edge.to})`, ...lines, '')
  }

  return { target: 'memgraph', extension: 'cypher', content: parts.join('\n'), diagnostics }
}
