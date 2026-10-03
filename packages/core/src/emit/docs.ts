import type { Assertion, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR } from '../ir'
import { describeCardinality, formatValueType, isUnconstrained, typeParams } from '../ir'
import type { Capabilities, EmitOptions, EmitResult } from '../capabilities'
import { LADYBUG_CAPABILITIES } from './ladybug'
import { NEO4J_CAPABILITIES } from './neo4j'
import { MEMGRAPH_CAPABILITIES } from './memgraph'
import { FALKORDB_CAPABILITIES } from './falkordb'
import { SHACL_CAPABILITIES } from './shacl'
import { OWL_CAPABILITIES } from './owl'
import { GQL_CAPABILITIES } from './gql'
import { PGSCHEMA_CAPABILITIES } from './pgschema'
import { LINKML_CAPABILITIES } from './linkml'
import { SQLPGQ_CAPABILITIES } from './sqlpgq'

/**
 * The data dictionary: one self-contained HTML page a teammate reads instead of the
 * model file, with the enforcement matrix — the capability matrix made visible for the
 * features this model actually uses. A documentation target loses nothing, so the full
 * capability set is declared and no downgrade is reported.
 * See lat.md/emitters#Docs Target.
 */
export const DOCS_CAPABILITIES: Capabilities = {
  target: 'docs',
  multiLabel: true,
  inheritance: 'subclass',
  requiredConstraint: 'enforced',
  uniqueConstraint: 'enforced',
  compositeKey: 'native',
  edgeProps: 'native',
  nestedEdges: false,
  listProps: 'native',
  compositeTypes: 'native',
  enums: 'documented',
  openTypes: 'native',
  valueConstraints: 'enforced',
  namedConstraints: 'enforced',
  rawPassthrough: true,
  cardinality: 'enforced',
}

/**
 * The matrix's columns: every target that generates for an engine or a validator. The
 * constants are imported from the sibling modules rather than the registry, which
 * would be an import cycle; both `emit` and this page therefore read the same values.
 */
const MATRIX_TARGETS: Capabilities[] = [
  LADYBUG_CAPABILITIES, NEO4J_CAPABILITIES, MEMGRAPH_CAPABILITIES, FALKORDB_CAPABILITIES,
  SHACL_CAPABILITIES, OWL_CAPABILITIES, GQL_CAPABILITIES, PGSCHEMA_CAPABILITIES,
  LINKML_CAPABILITIES, SQLPGQ_CAPABILITIES,
]

/** A capability value in a reader's words. */
const WORDS: Record<string, string> = {
  'enforced': 'enforced',
  'native': 'native',
  'documented': 'documented',
  'partial': 'partial',
  'unsupported': 'reported, not carried',
  'key-only': 'key only',
  'edition-dependent': 'Enterprise only',
  'synthesized': 'synthesized',
  'reified': 'reified',
  'always-open': 'always open',
  'upper-bound-only': 'upper bound of one',
  'leaf-tables': 'table per concrete type',
  'labels': 'ancestor labels',
  'subclass': 'subclassing',
}

/** One matrix row: shown only when the model uses the feature. */
interface Feature {
  label: string
  used: (m: ModelIR) => boolean
  value: (c: Capabilities) => string
}

const anyProp = (m: ModelIR, test: (p: PropertyIR, owner: NodeTypeIR | EdgeTypeIR) => boolean) =>
  [...m.nodes, ...m.edges].some((o) => o.props.some((p) => test(p, o)))

const FEATURES: Feature[] = [
  {
    label: 'Abstract hierarchy',
    used: (m) => m.nodes.some((n) => n.abstract || n.extends),
    value: (c) => c.inheritance,
  },
  {
    label: 'Required property (non-key)',
    used: (m) => anyProp(m, (p, o) => p.required && !('key' in o && o.key.includes(p.name))),
    value: (c) => c.requiredConstraint,
  },
  {
    label: 'Unique property (non-key)',
    used: (m) => anyProp(m, (p, o) => p.unique && !('key' in o && o.key.includes(p.name))),
    value: (c) => c.uniqueConstraint,
  },
  {
    label: 'Composite key',
    used: (m) => m.nodes.some((n) => n.key.length > 1),
    value: (c) => c.compositeKey,
  },
  {
    label: 'Edge properties',
    used: (m) => m.edges.some((e) => e.props.length > 0),
    value: (c) => c.edgeProps,
  },
  { label: 'List properties', used: (m) => anyProp(m, (p) => p.list), value: (c) => c.listProps },
  {
    label: 'Composite types',
    used: (m) => anyProp(m, (p) => p.composite !== undefined),
    value: (c) => c.compositeTypes,
  },
  { label: 'Enums', used: (m) => m.enums.length > 0, value: (c) => c.enums },
  { label: 'Open types', used: (m) => m.nodes.some((n) => n.open), value: (c) => c.openTypes },
  {
    label: 'Value constraints',
    used: (m) => anyProp(m, (p) => p.min !== undefined || p.max !== undefined
      || p.pattern !== undefined || p.minLength !== undefined || p.maxLength !== undefined),
    value: (c) => c.valueConstraints,
  },
  {
    label: 'Named constraints',
    used: (m) => m.nodes.some((n) => n.constraints.length > 0),
    value: (c) => c.namedConstraints,
  },
  {
    label: 'Cardinality',
    used: (m) => m.edges.some((e) => !isUnconstrained(e.cardinality)),
    value: (c) => c.cardinality,
  },
]

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const anchor = (kind: string, name: string): string =>
  `${kind}-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`

const typeRef = (m: ModelIR, name: string): string =>
  (m.nodes.some((n) => n.name === name)
    ? `<a href="#${anchor('t', name)}">${esc(name)}</a>` : esc(name))

function assertionWords(a: Assertion): string {
  switch (a.kind) {
    case 'lessThan': return `${a.left} is less than ${a.right}`
    case 'lessThanOrEquals': return `${a.left} is at most ${a.right}`
    case 'equals': return `${a.left} equals ${a.right}`
    case 'disjoint': return `${a.left} differs from ${a.right}`
    case 'atLeastOne': return `at least one of ${a.props.join(', ')} is present`
    case 'exactlyOne': return `exactly one of ${a.props.join(', ')} is present`
    case 'count': {
      const of = a.of ? ` of type ${a.of}` : ''
      const min = a.min !== undefined ? `at least ${a.min}` : ''
      const max = a.max !== undefined ? `at most ${a.max}` : ''
      return `the count of ${a.edge}${of} is ${[min, max].filter(Boolean).join(' and ')}`
    }
  }
}

function propertyRows(m: ModelIR, props: PropertyIR[]): string[] {
  const rows: string[] = []
  for (const p of props) {
    const type = p.composite ? formatValueType(p.composite)
      : `${p.type}${typeParams(p)}${p.list ? '[]' : ''}`
    const limits: string[] = []
    if (p.enum) limits.push(`enum <a href="#${anchor('n', p.enum)}">${esc(p.enum)}</a>`)
    if (p.min !== undefined || p.max !== undefined) limits.push(esc(`${p.min ?? ''}..${p.max ?? ''}`))
    if (p.minLength !== undefined || p.maxLength !== undefined) {
      limits.push(`length ${esc(`${p.minLength ?? ''}..${p.maxLength ?? ''}`)}`)
    }
    if (p.pattern !== undefined) limits.push(`pattern <code>${esc(p.pattern)}</code>`)
    const from = p.inheritedFrom
      ? (m.mixins.some((x) => x.name === p.inheritedFrom)
        ? `◇ ${esc(p.inheritedFrom)}` : `↑ ${typeRef(m, p.inheritedFrom)}`)
      : ''
    rows.push(`<tr><td><code>${esc(p.name)}</code></td><td><code>${esc(type)}</code></td>`
      + `<td>${p.required ? 'yes' : ''}</td><td>${p.unique ? 'yes' : ''}</td>`
      + `<td>${limits.join('; ')}</td><td>${from}</td></tr>`)
  }
  return rows
}

const PROP_TABLE_HEAD = '<table><thead><tr><th>Property</th><th>Type</th><th>Required</th>'
  + '<th>Unique</th><th>Limits</th><th>From</th></tr></thead><tbody>'

function nodeSection(m: ModelIR, node: NodeTypeIR): string[] {
  const out: string[] = [`<section id="${anchor('t', node.name)}">`]
  const badges = [
    ...(node.abstract ? ['<span class="badge">abstract</span>'] : []),
    ...(node.open ? ['<span class="badge">open</span>'] : []),
  ]
  out.push(`<h3>${esc(node.name)} ${badges.join(' ')}</h3>`)
  const facts: string[] = []
  if (node.extends) facts.push(`extends ${typeRef(m, node.extends)}`)
  if (node.mixins.length > 0) facts.push(`mixins ${node.mixins.map(esc).join(', ')}`)
  if (node.key.length > 0) {
    facts.push(`key <code>${node.key.map(esc).join(' + ')}</code>`
      + (node.keyInheritedFrom ? ` (from ${typeRef(m, node.keyInheritedFrom)})` : ''))
  }
  facts.push(`IRI <code>${esc(node.iri)}</code>`)
  out.push(`<p>${facts.join(' · ')}</p>`)
  if (node.props.length > 0) {
    out.push(PROP_TABLE_HEAD, ...propertyRows(m, node.props), '</tbody></table>')
  }
  if (node.constraints.length > 0) {
    out.push('<ul>')
    for (const k of node.constraints) {
      const sev = k.severity && k.severity !== 'violation' ? ` <em>(${k.severity})</em>` : ''
      out.push(`<li><strong>${esc(k.name)}</strong>: ${esc(assertionWords(k.assert))}${sev}`
        + `${k.message ? ` — “${esc(k.message)}”` : ''}</li>`)
    }
    out.push('</ul>')
  }
  if (node.rawShacl) out.push(`<details><summary>Raw SHACL</summary><pre>${esc(node.rawShacl)}</pre></details>`)

  const reaches = (name: string) => name === node.name || node.ancestors.includes(name)
  const outgoing = m.edges.filter((e) => reaches(e.from))
  const incoming = m.edges.filter((e) => reaches(e.to))
  const edgeItem = (e: EdgeTypeIR, declared: string) =>
    `<li><a href="#${anchor('e', e.name)}">${esc(e.name)}</a> → ${typeRef(m, e.to)}`
    + `${declared !== node.name ? ` <em>(declared on ${esc(declared)})</em>` : ''}</li>`
  if (outgoing.length > 0) {
    out.push('<p class="edges">Outgoing:</p><ul>')
    for (const e of outgoing) out.push(edgeItem(e, e.from))
    out.push('</ul>')
  }
  if (incoming.length > 0) {
    out.push('<p class="edges">Incoming:</p><ul>')
    for (const e of incoming) {
      out.push(`<li>${typeRef(m, e.from)} → <a href="#${anchor('e', e.name)}">${esc(e.name)}</a>`
        + `${e.to !== node.name ? ` <em>(declared on ${esc(e.to)})</em>` : ''}</li>`)
    }
    out.push('</ul>')
  }
  out.push('</section>')
  return out
}

function edgeSection(m: ModelIR, edge: EdgeTypeIR): string[] {
  const out: string[] = [`<section id="${anchor('e', edge.name)}">`]
  out.push(`<h3>${esc(edge.name)} <span class="badge">edge</span></h3>`)
  const card = isUnconstrained(edge.cardinality) ? '' : ` · ${describeCardinality(edge.cardinality)}`
  out.push(`<p>${typeRef(m, edge.from)} → ${typeRef(m, edge.to)}${card} · IRI <code>${esc(edge.iri)}</code></p>`)
  if (edge.props.length > 0) {
    out.push(PROP_TABLE_HEAD, ...propertyRows(m, edge.props), '</tbody></table>')
  }
  out.push('</section>')
  return out
}

const STYLE = `
:root { --ink: #1e2a32; --muted: #5c6b76; --line: #d4dce2; --bg: #ffffff; --soft: #f4f7f9; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #e6edf2; --muted: #9fb0bb; --line: #3a4850; --bg: #14191d; --soft: #1d242a; }
}
body { font: 15px/1.55 system-ui, sans-serif; color: var(--ink); background: var(--bg);
  max-width: 60rem; margin: 2rem auto; padding: 0 16px; }
h1, h2, h3 { line-height: 1.25; } h2 { margin-top: 2.5rem; }
a { color: inherit; } code, pre { background: var(--soft); border-radius: 4px; padding: 0 4px; }
pre { padding: 8px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1rem; }
th, td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: var(--soft); }
.badge { font-size: 11px; border: 1px solid var(--line); border-radius: 8px; padding: 1px 7px;
  color: var(--muted); vertical-align: middle; }
.edges { margin-bottom: 0; color: var(--muted); }
.muted { color: var(--muted); } nav ul { columns: 2; }
@media print { body { max-width: none; } }
`

export function emitDocs(model: ModelIR, _options: EmitOptions = {}): EmitResult {
  const m = model
  const parts: string[] = [
    '<!doctype html>',
    '<!-- Generated by lpg-modeler. Target: docs. -->',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(m.namespace.prefix)} schema</title>`,
    `<style>${STYLE}</style>`,
    '</head><body>',
    `<h1>${esc(m.namespace.prefix)} <span class="muted">schema</span></h1>`,
    `<p class="muted">Namespace <code>${esc(m.namespace.iri)}</code> · generated by lpg-modeler.</p>`,
  ]

  parts.push('<nav><ul>')
  for (const n of m.nodes) parts.push(`<li><a href="#${anchor('t', n.name)}">${esc(n.name)}</a></li>`)
  for (const e of m.edges) parts.push(`<li><a href="#${anchor('e', e.name)}">${esc(e.name)}</a> <span class="badge">edge</span></li>`)
  for (const x of m.mixins) parts.push(`<li><a href="#${anchor('m', x.name)}">${esc(x.name)}</a> <span class="badge">mixin</span></li>`)
  for (const e of m.enums) parts.push(`<li><a href="#${anchor('n', e.name)}">${esc(e.name)}</a> <span class="badge">enum</span></li>`)
  parts.push('<li><a href="#enforcement">Enforcement matrix</a></li>')
  parts.push('</ul></nav>')

  parts.push('<h2>Node types</h2>')
  for (const n of m.nodes) parts.push(...nodeSection(m, n))

  if (m.edges.length > 0) {
    parts.push('<h2>Edge types</h2>')
    for (const e of m.edges) parts.push(...edgeSection(m, e))
  }

  if (m.mixins.length > 0) {
    parts.push('<h2>Mixins</h2>')
    for (const x of m.mixins) {
      parts.push(`<section id="${anchor('m', x.name)}"><h3>${esc(x.name)} <span class="badge">mixin</span></h3>`)
      parts.push(PROP_TABLE_HEAD, ...propertyRows(m, x.props), '</tbody></table></section>')
    }
  }

  if (m.enums.length > 0) {
    parts.push('<h2>Enums</h2>')
    for (const e of m.enums) {
      parts.push(`<section id="${anchor('n', e.name)}"><h3>${esc(e.name)} <span class="badge">enum</span></h3>`)
      parts.push(`<p><code>${e.values.map(esc).join('</code> · <code>')}</code></p></section>`)
    }
  }

  const used = FEATURES.filter((f) => f.used(m))
  parts.push('<h2 id="enforcement">Enforcement matrix</h2>')
  if (used.length === 0) {
    parts.push('<p class="muted">This model uses no feature whose enforcement differs by target.</p>')
  } else {
    parts.push('<p>What each target does with the features this model uses. “Reported, not',
      'carried” means generation raises a diagnostic and writes a comment at the site;',
      'nothing is ever dropped silently.</p>')
    parts.push('<table><thead><tr><th>Feature</th>'
      + MATRIX_TARGETS.map((t) => `<th>${esc(t.target)}</th>`).join('') + '</tr></thead><tbody>')
    for (const f of used) {
      parts.push(`<tr><td>${esc(f.label)}</td>`
        + MATRIX_TARGETS.map((t) => `<td>${esc(WORDS[f.value(t)] ?? f.value(t))}</td>`).join('')
        + '</tr>')
    }
    parts.push('</tbody></table>')
  }

  parts.push('</body></html>')
  return { target: 'docs', extension: 'html', content: parts.join('\n') + '\n', diagnostics: [] }
}
