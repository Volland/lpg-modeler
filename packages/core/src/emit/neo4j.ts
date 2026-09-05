import type { Diagnostic, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR } from '../ir'
import { concreteNodes, describeCardinality, formatValueType, isUnconstrained } from '../ir'
import {
  compositeDowngrade, downgrade, reportUnsupportedConstraints,
  type Capabilities, type EmitOptions, type EmitResult,
} from '../capabilities'

/**
 * Neo4j is schema-optional: there is no table DDL, only constraints and indexes.
 * Multi-label nodes are native, so a hierarchy becomes labels rather than tables.
 * Existence and node key constraints require Enterprise.
 */
export const NEO4J_CAPABILITIES: Capabilities = {
  target: 'neo4j',
  multiLabel: true,
  inheritance: 'labels',
  requiredConstraint: 'edition-dependent',
  uniqueConstraint: 'enforced',
  compositeKey: 'native',
  edgeProps: 'native',
  nestedEdges: false,
  valueConstraints: 'unsupported',
  namedConstraints: 'unsupported',
  rawPassthrough: false,
  listProps: 'native',
  // A Neo4j property value is a primitive or an array of primitives. A struct or a map
  // has to become its own node, which the model does not say to do.
  compositeTypes: 'unsupported',
  enums: 'unsupported',
  // Neo4j is schema-optional, so a closed type cannot be enforced either.
  openTypes: 'always-open',
  cardinality: 'unsupported',
}

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

/** Every label a node of this type carries: its own, plus each ancestor's. */
export function labelsFor(node: NodeTypeIR): string[] {
  return [node.name, ...node.ancestors]
}

function nodeConstraints(
  node: NodeTypeIR, enterprise: boolean, diags: Diagnostic[],
): string[] {
  const out: string[] = []
  const n = snake(node.name)
  const labels = labelsFor(node)
  if (labels.length > 1) {
    out.push(`// ${node.name} carries labels :${labels.join(' :')} (hierarchy flattened to labels).`)
  }

  if (node.key.length > 0) {
    const props = node.key.map((k) => `n.${k}`).join(', ')
    if (enterprise) {
      out.push(
        `CREATE CONSTRAINT ${n}_key IF NOT EXISTS`,
        `  FOR (n:${node.name}) REQUIRE (${props}) IS NODE KEY;`)
    } else {
      downgrade(diags, 'neo4j', 'downgrade-node-key',
        `Node type '${node.name}' declares a key, but NODE KEY constraints require Neo4j Enterprise. A uniqueness constraint is emitted instead, which does not enforce that the key is present.`,
        node.loc)
      out.push(
        `// DOWNGRADE: NODE KEY requires Enterprise. Uniqueness only; presence unenforced.`,
        `CREATE CONSTRAINT ${n}_key_unique IF NOT EXISTS`,
        `  FOR (n:${node.name}) REQUIRE (${props}) IS UNIQUE;`)
    }
  }

  for (const p of node.props) {
    if (p.composite) {
      compositeDowngrade(diags, 'neo4j', node.name, p, 'an untyped property')
      out.push(`// UNSTORABLE: '${p.name}' is ${formatValueType(p.composite)} in the model; a Neo4j`)
      out.push(`// property value is a primitive or an array of primitives.`)
    }
    if (p.enum) {
      downgrade(diags, 'neo4j', 'downgrade-enum',
        `Property '${node.name}.${p.name}' is constrained to enum '${p.enum}', which Neo4j has no schema facility for.`,
        p.loc)
      out.push(`// UNENFORCED: '${p.name}' is limited to enum '${p.enum}' in the model.`)
    }
    if (p.unique && !node.key.includes(p.name)) {
      out.push(
        `CREATE CONSTRAINT ${n}_${snake(p.name)}_unique IF NOT EXISTS`,
        `  FOR (n:${node.name}) REQUIRE n.${p.name} IS UNIQUE;`)
    }
    if (p.required && !node.key.includes(p.name)) {
      if (enterprise) {
        out.push(
          `CREATE CONSTRAINT ${n}_${snake(p.name)}_exists IF NOT EXISTS`,
          `  FOR (n:${node.name}) REQUIRE n.${p.name} IS NOT NULL;`)
      } else {
        downgrade(diags, 'neo4j', 'downgrade-required',
          `Property '${node.name}.${p.name}' is required, but existence constraints require Neo4j Enterprise. It is unenforced on Community.`,
          p.loc)
        out.push(`// UNENFORCED: '${p.name}' is required; existence constraints require Enterprise.`)
      }
    }
  }
  return out
}

function edgeConstraints(edge: EdgeTypeIR, enterprise: boolean, diags: Diagnostic[]): string[] {
  const out: string[] = []
  const e = snake(edge.name)
  out.push(`// (:${edge.from})-[:${edge.name}]->(:${edge.to})`)
  if (!isUnconstrained(edge.cardinality)) {
    downgrade(diags, 'neo4j', 'downgrade-cardinality',
      `Edge type '${edge.name}' declares ${describeCardinality(edge.cardinality)} cardinality, which Neo4j has no constraint for: multiplicity is not part of its schema facility.`,
      edge.loc)
    out.push(`// UNENFORCED: ${describeCardinality(edge.cardinality)} in the model; Neo4j has no multiplicity constraint.`)
  }
  for (const p of edge.props) {
    if (p.composite) {
      compositeDowngrade(diags, 'neo4j', edge.name, p, 'an untyped property')
      out.push(`// UNSTORABLE: '${p.name}' is ${formatValueType(p.composite)} in the model; a Neo4j`)
      out.push(`// property value is a primitive or an array of primitives.`)
    }
    if (!p.required) continue
    if (enterprise) {
      out.push(
        `CREATE CONSTRAINT ${e}_${snake(p.name)}_exists IF NOT EXISTS`,
        `  FOR ()-[r:${edge.name}]-() REQUIRE r.${p.name} IS NOT NULL;`)
    } else {
      downgrade(diags, 'neo4j', 'downgrade-required',
        `Edge property '${edge.name}.${p.name}' is required, but relationship existence constraints require Neo4j Enterprise.`,
        p.loc)
      out.push(`// UNENFORCED: '${p.name}' is required; requires Enterprise.`)
    }
  }
  return out
}

function indexes(node: NodeTypeIR): string[] {
  const out: string[] = []
  const n = snake(node.name)
  const indexed = node.props.filter((p: PropertyIR) =>
    !p.unique && !node.key.includes(p.name) && p.required)
  for (const p of indexed) {
    out.push(
      `CREATE INDEX ${n}_${snake(p.name)} IF NOT EXISTS`,
      `  FOR (n:${node.name}) ON (n.${p.name});`)
  }
  return out
}

export function emitNeo4j(model: ModelIR, options: EmitOptions = {}): EmitResult {
  const diagnostics: Diagnostic[] = []
  const enterprise = options.neo4jEdition === 'enterprise'
  const parts: string[] = [
    '// Generated by lpg-modeler. Target: neo4j.',
    `// Model: ${model.namespace.prefix} <${model.namespace.iri}>`,
    `// Edition: ${enterprise ? 'enterprise' : 'community'}`,
    '//',
    '// Neo4j has no table DDL. A hierarchy is expressed as labels, so a Person node',
    '// also carries every ancestor label. See lat.md/emitters#Neo4j Target.',
    '//',
    '// Neo4j is schema-optional, so a node may always carry properties its type does not',
    '// declare. A closed type in the model is therefore documentation here, not a constraint.',
    '',
  ]

  for (const node of concreteNodes(model)) {
    const lines = [...nodeConstraints(node, enterprise, diagnostics), ...indexes(node)]
    if (lines.length > 0) parts.push(...lines, '')
  }
  for (const edge of model.edges) {
    parts.push(...edgeConstraints(edge, enterprise, diagnostics), '')
  }

  reportUnsupportedConstraints(diagnostics, 'neo4j', model, NEO4J_CAPABILITIES)

  return { target: 'neo4j', extension: 'cypher', content: parts.join('\n'), diagnostics }
}
