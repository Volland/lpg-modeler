import type { Diagnostic, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR } from '../ir'
import { concreteNodes, describeCardinality, formatValueType, isUnconstrained } from '../ir'
import { labelsFor } from './neo4j'
import {
  compositeDowngrade, downgrade, reportUnsupportedConstraints,
  type Capabilities, type EmitOptions, type EmitResult,
} from '../capabilities'

/**
 * FalkorDB is schema-optional like Neo4j, and like Neo4j carries a hierarchy as labels.
 * What it does not share is the edition split: `MANDATORY` enforces existence on any
 * instance, so a required property is genuinely enforced here rather than reported.
 * See lat.md/emitters#FalkorDB Target.
 */
export const FALKORDB_CAPABILITIES: Capabilities = {
  target: 'falkordb',
  multiLabel: true,
  inheritance: 'labels',
  // No edition gate: MANDATORY is available on any instance.
  requiredConstraint: 'enforced',
  uniqueConstraint: 'enforced',
  // A UNIQUE constraint takes a property list, so a composite key is one constraint.
  compositeKey: 'native',
  edgeProps: 'native',
  nestedEdges: false,
  // An array is storable as long as no element is a graph entity or null.
  listProps: 'native',
  // A map cannot be stored as a property value, so a struct has nowhere to go.
  compositeTypes: 'unsupported',
  enums: 'unsupported',
  // Schema-optional: a node may always carry properties its type does not declare.
  openTypes: 'always-open',
  valueConstraints: 'unsupported',
  namedConstraints: 'unsupported',
  rawPassthrough: false,
  cardinality: 'unsupported',
}

/** A Cypher statement sent through redis-cli, which is how an index is created. */
const query = (cypher: string) => `$REDIS_CLI GRAPH.QUERY "$GRAPH_KEY" "${cypher}"`

/** `GRAPH.CONSTRAINT CREATE` takes no name and has no IF NOT EXISTS. */
function constraint(
  kind: 'UNIQUE' | 'MANDATORY', entity: 'NODE' | 'RELATIONSHIP', label: string, props: string[],
): string {
  return `$REDIS_CLI GRAPH.CONSTRAINT CREATE "$GRAPH_KEY" ${kind} ${entity} ${label}`
    + ` PROPERTIES ${props.length} ${props.join(' ')}`
}

const nodeIndex = (label: string, props: string[]) =>
  query(`CREATE INDEX FOR (n:${label}) ON (${props.map((p) => `n.${p}`).join(', ')})`)

const edgeIndex = (type: string, prop: string) =>
  query(`CREATE INDEX FOR ()-[r:${type}]-() ON (r.${prop})`)

/** A composite value has no property representation here, exactly as on Neo4j. */
function reportComposite(
  owner: string, p: PropertyIR, diags: Diagnostic[], out: string[],
): void {
  if (!p.composite) return
  compositeDowngrade(diags, 'falkordb', owner, p, 'an untyped property')
  out.push(`# UNSTORABLE: '${p.name}' is ${formatValueType(p.composite)} in the model;`)
  out.push('# a FalkorDB property holds a scalar or an array of scalars, never a map.')
}

function nodeSchema(node: NodeTypeIR, diags: Diagnostic[]): string[] {
  const out: string[] = []
  const labels = labelsFor(node)
  out.push(`# ${node.name}${labels.length > 1
    ? ` carries labels :${labels.join(' :')} (hierarchy flattened to labels).` : ''}`)

  for (const p of node.props) reportComposite(node.name, p, diags, out)

  // A unique constraint requires its exact-match index to exist first, so the index is
  // emitted immediately above the constraint that needs it rather than in a block of
  // its own -- the order of this file is the order FalkorDB requires.
  if (node.key.length > 0) {
    out.push(nodeIndex(node.name, node.key))
    out.push(constraint('UNIQUE', 'NODE', node.name, node.key))
    // UNIQUE alone is enforced only where every constrained property is non-null, so a
    // key also needs MANDATORY on each part to mean what a key means in the model.
    for (const k of node.key) out.push(constraint('MANDATORY', 'NODE', node.name, [k]))
  }

  for (const p of node.props) {
    if (node.key.includes(p.name)) continue
    if (p.unique) {
      out.push(nodeIndex(node.name, [p.name]))
      out.push(constraint('UNIQUE', 'NODE', node.name, [p.name]))
    }
    if (p.required) out.push(constraint('MANDATORY', 'NODE', node.name, [p.name]))
  }
  return out
}

function edgeSchema(edge: EdgeTypeIR, diags: Diagnostic[]): string[] {
  const out: string[] = [`# (:${edge.from})-[:${edge.name}]->(:${edge.to})`]

  if (!isUnconstrained(edge.cardinality)) {
    downgrade(diags, 'falkordb', 'downgrade-cardinality',
      `Edge type '${edge.name}' declares ${describeCardinality(edge.cardinality)} cardinality, which FalkorDB has no constraint for: multiplicity is not part of its schema facility.`,
      edge.loc)
    out.push(`# UNENFORCED: ${describeCardinality(edge.cardinality)} in the model; FalkorDB has no multiplicity constraint.`)
  }

  for (const p of edge.props) {
    reportComposite(edge.name, p, diags, out)
    if (p.unique) {
      out.push(edgeIndex(edge.name, p.name))
      out.push(constraint('UNIQUE', 'RELATIONSHIP', edge.name, [p.name]))
    }
    if (p.required) out.push(constraint('MANDATORY', 'RELATIONSHIP', edge.name, [p.name]))
  }
  return out
}

export function emitFalkorDb(model: ModelIR, options: EmitOptions = {}): EmitResult {
  const diagnostics: Diagnostic[] = []
  const graphKey = options.falkorGraphKey ?? model.namespace.prefix

  const parts: string[] = [
    '#!/bin/sh',
    '# Generated by lpg-modeler. Target: falkordb (FalkorDB).',
    `# Model: ${model.namespace.prefix} <${model.namespace.iri}>`,
    '#',
    '# FalkorDB splits its schema across two protocols: an index is Cypher, a constraint',
    '# is a Redis command. No single client applies both, so this is a shell script over',
    '# redis-cli rather than a .cypher file -- which is also what lets it carry the',
    '# downgrade notes below, since a line a redis pipe does not understand is an error.',
    '#',
    '#   sh <this file>            REDIS_CLI and GRAPH_KEY override the defaults below.',
    '#',
    '# Not idempotent. FalkorDB has no IF NOT EXISTS for an index or a constraint, so a',
    '# second run reports each one as already existing and changes nothing.',
    '#',
    '# A constraint is applied asynchronously: the command returns PENDING and enforcement',
    '# follows. If data already in the graph violates it, the constraint ends FAILED and is',
    '# never enforced -- so run GRAPH.CONSTRAINT LIST afterwards rather than assuming.',
    '#',
    '# A hierarchy is expressed as labels, so a node carries its own label and every',
    '# ancestor label too. FalkorDB is schema-optional, so a closed type is documentation',
    '# here, not a constraint: a property may always appear that the type does not declare.',
    '',
    'REDIS_CLI="${REDIS_CLI:-redis-cli}"',
    `GRAPH_KEY="\${GRAPH_KEY:-${graphKey}}"`,
    '',
  ]

  for (const node of concreteNodes(model)) {
    parts.push(...nodeSchema(node, diagnostics), '')
  }
  for (const edge of model.edges) {
    parts.push(...edgeSchema(edge, diagnostics), '')
  }

  reportUnsupportedConstraints(diagnostics, 'falkordb', model, FALKORDB_CAPABILITIES)

  return { target: 'falkordb', extension: 'sh', content: parts.join('\n'), diagnostics }
}
