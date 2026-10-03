import type { Diagnostic, EdgeTypeIR, ModelIR, NodeTypeIR, PropertyIR } from './ir'

/**
 * Query linting: the labels, relationship types and property names a Cypher or GQL query
 * names, checked against the model it assumes. There is no grammar here. A lexer reads
 * strings, comments and quoted names correctly, and pattern chains — `(a:L)-[r:T]->(b)` —
 * are extracted from the token stream; everything else is passed over. A linter that
 * cries wolf is worse than none, so whatever cannot be resolved is skipped, never
 * guessed: an unlabelled variable, a rebound one, a label expression, syntax this reader
 * does not recognise. See lat.md/lint#Query Lint.
 */

type Kind = 'ident' | 'string' | 'number' | 'punct' | 'param'

interface Token {
  kind: Kind
  text: string
  start: number
  end: number
  /** A backticked name is always a name, never a keyword. */
  quoted?: true
}

interface Lexed {
  tokens: Token[]
  /** Where the text stopped being readable, if it did. */
  error?: { at: number; what: string }
}

const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /[A-Za-z0-9_]/

/**
 * `//` and block comments, single- and double-quoted strings with backslash escapes, and
 * backticked names are all read to their end, so a label inside any of them is never seen
 * as one. `--` is deliberately not a comment: in a pattern it is an undirected edge.
 */
export function lex(text: string): Lexed {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (/\s/.test(c)) { i += 1; continue }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) return { tokens, error: { at: i, what: 'an unterminated block comment' } }
      i = end + 2
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1
      if (j >= text.length) return { tokens, error: { at: i, what: 'an unterminated string' } }
      tokens.push({ kind: 'string', text: text.slice(i + 1, j), start: i, end: j + 1 })
      i = j + 1
      continue
    }
    if (c === '`') {
      let j = i + 1
      while (j < text.length && !(text[j] === '`' && text[j + 1] !== '`')) j += text[j] === '`' ? 2 : 1
      if (j >= text.length) return { tokens, error: { at: i, what: 'an unterminated quoted name' } }
      tokens.push({ kind: 'ident', text: text.slice(i + 1, j).replace(/``/g, '`'), start: i, end: j + 1, quoted: true })
      i = j + 1
      continue
    }
    if (c === '$') {
      let j = i + 1
      while (j < text.length && IDENT_PART.test(text[j]!)) j += 1
      tokens.push({ kind: 'param', text: text.slice(i, j), start: i, end: j })
      i = j
      continue
    }
    if (IDENT_START.test(c)) {
      let j = i + 1
      while (j < text.length && IDENT_PART.test(text[j]!)) j += 1
      tokens.push({ kind: 'ident', text: text.slice(i, j), start: i, end: j })
      i = j
      continue
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1
      while (j < text.length && /[0-9]/.test(text[j]!)) j += 1
      // A fraction, but not the `..` of a variable-length range.
      if (text[j] === '.' && /[0-9]/.test(text[j + 1] ?? '')) {
        j += 1
        while (j < text.length && /[0-9]/.test(text[j]!)) j += 1
      }
      tokens.push({ kind: 'number', text: text.slice(i, j), start: i, end: j })
      i = j
      continue
    }
    const two = text.slice(i, i + 2)
    if (['<>', '<=', '>=', '=~', '..'].includes(two)) {
      tokens.push({ kind: 'punct', text: two, start: i, end: i + 2 })
      i += 2
      continue
    }
    tokens.push({ kind: 'punct', text: c, start: i, end: i + 1 })
    i += 1
  }
  return { tokens }
}

const isPunct = (t: Token | undefined, text: string): boolean => t?.kind === 'punct' && t.text === text
const isIdent = (t: Token | undefined): t is Token => t?.kind === 'ident'
const isWord = (t: Token | undefined, word: string): boolean =>
  t?.kind === 'ident' && !t.quoted && t.text.toLowerCase() === word

/** Words after which a `(` opens a pattern; any other word before one makes it a call. */
const PATTERN_LEADERS = new Set([
  'match', 'merge', 'create', 'where', 'and', 'or', 'xor', 'not', 'optional', 'exists',
  'with', 'return', 'unwind', 'then', 'when', 'else', 'case', 'in',
])

interface NodePattern {
  kind: 'node'
  variable?: string
  labels: Array<{ name: string; token: Token }>
  /** `:A|B`, `:!A` and `%`: a label expression, which this reader does not resolve. */
  expression: boolean
  mapKeys: Array<{ name: string; token: Token }>
  /** Index just past the closing paren. */
  next: number
  start: number
  end: number
}

interface RelPattern {
  kind: 'rel'
  variable?: string
  types: Array<{ name: string; token: Token }>
  mapKeys: Array<{ name: string; token: Token }>
  direction: 'out' | 'in' | 'any'
  /** Anything this reader could not read inside the brackets. */
  unreadable: boolean
  next: number
  start: number
  end: number
}

/** Index of the token closing the group opened at `open`, or -1. */
function closeOf(tokens: Token[], open: number, left: string, right: string): number {
  let depth = 0
  for (let i = open; i < tokens.length; i++) {
    if (isPunct(tokens[i], left)) depth += 1
    if (isPunct(tokens[i], right)) { depth -= 1; if (depth === 0) return i }
  }
  return -1
}

/** `{key: value, …}` starting at `open`: the keys, and the index past the brace. */
function readMap(tokens: Token[], open: number): { keys: Array<{ name: string; token: Token }>; next: number } | undefined {
  const close = closeOf(tokens, open, '{', '}')
  if (close < 0) return undefined
  const keys: Array<{ name: string; token: Token }> = []
  let depth = 0
  for (let i = open + 1; i < close; i++) {
    const t = tokens[i]!
    if (isPunct(t, '{') || isPunct(t, '(') || isPunct(t, '[')) depth += 1
    if (isPunct(t, '}') || isPunct(t, ')') || isPunct(t, ']')) depth -= 1
    if (depth === 0 && isIdent(t) && isPunct(tokens[i + 1], ':') && (i === open + 1 || isPunct(tokens[i - 1], ','))) {
      keys.push({ name: t.text, token: t })
    }
  }
  return { keys, next: close + 1 }
}

function readNode(tokens: Token[], at: number): NodePattern | undefined {
  if (!isPunct(tokens[at], '(')) return undefined
  const prev = tokens[at - 1]
  // `count(n)` is a call, not a pattern; only a keyword that leads patterns lets a word
  // stand before one.
  if (isIdent(prev) && !prev.quoted && !PATTERN_LEADERS.has(prev.text.toLowerCase())) return undefined
  let j = at + 1
  let variable: string | undefined
  if (isIdent(tokens[j]) && !isWord(tokens[j], 'where')) { variable = tokens[j]!.text; j += 1 }
  const labels: NodePattern['labels'] = []
  let expression = false
  while (isPunct(tokens[j], ':')) {
    j += 1
    if (isPunct(tokens[j], '!') || isPunct(tokens[j], '%')) { expression = true; j += 1; continue }
    if (!isIdent(tokens[j])) return undefined
    labels.push({ name: tokens[j]!.text, token: tokens[j]! })
    j += 1
    while (isPunct(tokens[j], '|') || isPunct(tokens[j], '&')) {
      expression = true
      j += 1
      if (isPunct(tokens[j], ':')) j += 1
      if (isIdent(tokens[j])) { labels.push({ name: tokens[j]!.text, token: tokens[j]! }); j += 1 }
    }
  }
  let mapKeys: NodePattern['mapKeys'] = []
  if (isPunct(tokens[j], '{')) {
    const map = readMap(tokens, j)
    if (!map) return undefined
    mapKeys = map.keys
    j = map.next
  }
  // GQL allows `(n:L WHERE …)`: skip to the close, resolving nothing inside it.
  if (isWord(tokens[j], 'where')) {
    const close = closeOf(tokens, at, '(', ')')
    if (close < 0) return undefined
    j = close
  }
  if (!isPunct(tokens[j], ')')) return undefined
  return {
    kind: 'node', ...(variable ? { variable } : {}), labels, expression, mapKeys,
    next: j + 1, start: tokens[at]!.start, end: tokens[j]!.end,
  }
}

/** The relationship that follows a node: `-[r:T]->`, `<-[:T]-`, or a bare `--`. */
function readRel(tokens: Token[], at: number): RelPattern | undefined {
  let k = at
  let left = false
  if (isPunct(tokens[k], '<') && isPunct(tokens[k + 1], '-')) { left = true; k += 2 }
  else if (isPunct(tokens[k], '-')) k += 1
  else return undefined
  const start = tokens[at]!.start

  if (!isPunct(tokens[k], '[')) {
    // `--`, `-->`, `<--`: an edge with no type to check.
    if (!isPunct(tokens[k], '-')) return undefined
    k += 1
    const right = isPunct(tokens[k], '>')
    if (right) k += 1
    return {
      kind: 'rel', types: [], mapKeys: [], unreadable: false,
      direction: left && !right ? 'in' : right && !left ? 'out' : 'any',
      next: k, start, end: tokens[k - 1]!.end,
    }
  }

  const close = closeOf(tokens, k, '[', ']')
  if (close < 0) return undefined
  let j = k + 1
  let variable: string | undefined
  if (isIdent(tokens[j]) && !isWord(tokens[j], 'where')) { variable = tokens[j]!.text; j += 1 }
  const types: RelPattern['types'] = []
  if (isPunct(tokens[j], ':')) {
    j += 1
    if (isIdent(tokens[j])) { types.push({ name: tokens[j]!.text, token: tokens[j]! }); j += 1 }
    while (isPunct(tokens[j], '|')) {
      j += 1
      if (isPunct(tokens[j], ':')) j += 1
      if (isIdent(tokens[j])) { types.push({ name: tokens[j]!.text, token: tokens[j]! }); j += 1 }
    }
  }
  let unreadable = false
  if (isPunct(tokens[j], '*')) {
    j += 1
    while (j < close && (tokens[j]!.kind === 'number' || isPunct(tokens[j], '..'))) j += 1
  }
  let mapKeys: RelPattern['mapKeys'] = []
  if (isPunct(tokens[j], '{')) {
    const map = readMap(tokens, j)
    if (map) { mapKeys = map.keys; j = map.next } else unreadable = true
  }
  if (j !== close) unreadable = true

  let n = close + 1
  if (!isPunct(tokens[n], '-')) return undefined
  n += 1
  const right = isPunct(tokens[n], '>')
  if (right) n += 1
  return {
    kind: 'rel', ...(variable ? { variable } : {}), types, mapKeys, unreadable,
    direction: left && !right ? 'in' : right && !left ? 'out' : 'any',
    next: n, start, end: tokens[n - 1]!.end,
  }
}

type Element = NodePattern | RelPattern

/** Every pattern chain in a statement: a node, then any number of (relationship, node). */
function readChains(tokens: Token[]): Element[][] {
  const chains: Element[][] = []
  let i = 0
  while (i < tokens.length) {
    const first = readNode(tokens, i)
    if (!first) { i += 1; continue }
    const chain: Element[] = [first]
    let at = first.next
    for (;;) {
      const rel = readRel(tokens, at)
      if (!rel) break
      const node = readNode(tokens, rel.next)
      // A relationship with no node after it is syntax this reader does not know.
      if (!node) break
      chain.push(rel, node)
      at = node.next
    }
    chains.push(chain)
    i = at
  }
  return chains
}

const NUMERIC = new Set(['int8', 'int16', 'int32', 'int', 'int128', 'uint8', 'uint16', 'uint32', 'uint64', 'float32', 'float', 'decimal'])

/** What a literal in a query is, as far as comparing it to a property is concerned. */
function literalFamily(tokens: Token[], at: number): 'string' | 'number' | 'boolean' | undefined {
  let t = tokens[at]
  if (isPunct(t, '-')) t = tokens[at + 1]
  if (!t) return undefined
  if (t.kind === 'string') return 'string'
  if (t.kind === 'number') return 'number'
  if (isWord(t, 'true') || isWord(t, 'false')) return 'boolean'
  return undefined
}

function propertyFamily(p: PropertyIR): 'string' | 'number' | 'boolean' | 'enum' | undefined {
  if (p.list || p.composite) return undefined
  if (p.enum) return 'enum'
  if (p.type === 'string') return 'string'
  if (p.type === 'boolean') return 'boolean'
  return NUMERIC.has(p.type) ? 'number' : undefined
}

export function lintQuery(model: ModelIR, text: string, file: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const nodes = new Map(model.nodes.map((n) => [n.name, n]))
  const edges = new Map(model.edges.map((e) => [e.name, e]))
  const at = (start: number, end: number) => ({ file, range: [start, end] as [number, number] })
  const find = (code: string, message: string, start: number, end: number) =>
    out.push({ severity: 'error', code, message, loc: at(start, end) })

  const { tokens: lexed, error } = lex(text)
  let tokens = lexed
  if (error) {
    // Drop the statement the break is in: half a statement resolves wrongly.
    const lastSemicolon = tokens.map((t) => isPunct(t, ';')).lastIndexOf(true)
    tokens = tokens.slice(0, lastSemicolon + 1)
    out.push({
      severity: 'warning', code: 'lint-unreadable',
      message: `The query text has ${error.what}, so everything after the last complete statement was not checked.`,
      loc: at(error.at, error.at + 1),
    })
  }

  const statements: Token[][] = [[]]
  for (const t of tokens) {
    if (isPunct(t, ';')) statements.push([])
    else statements[statements.length - 1]!.push(t)
  }

  const descendantHasProperty = (labels: string[], prop: string): boolean =>
    model.nodes.some((n) => labels.some((l) => n.ancestors.includes(l)) && n.props.some((p) => p.name === prop))

  /** The node types a variable's labels name, or undefined when one is not a known type. */
  const nodeProps = (labels: string[]): NodeTypeIR[] | undefined => {
    const types = labels.map((l) => nodes.get(l))
    if (types.length === 0 || types.some((t) => !t)) return undefined
    return types as NodeTypeIR[]
  }
  /** An open type may carry any property, so an undeclared one proves nothing there. */
  const anyOpen = (types: NodeTypeIR[]): boolean => types.some((t) => t.open)
  const edgeProps = (types: string[]): EdgeTypeIR[] | undefined => {
    const found = types.map((t) => edges.get(t))
    return found.length === 0 || found.some((e) => !e) ? undefined : found as EdgeTypeIR[]
  }

  const compatible = (labels: string[], declared: string): boolean =>
    labels.length === 0 || labels.some((l) =>
      l === declared || nodes.get(l)?.ancestors.includes(declared) || nodes.get(declared)?.ancestors.includes(l))

  for (const statement of statements) {
    const chains = readChains(statement)

    // A name a statement rebinds — `AS p`, `[p IN xs]` — no longer means what a pattern
    // said it did, so it is resolved nowhere.
    const poisoned = new Set<string>()
    statement.forEach((t, i) => {
      if (isWord(statement[i - 1], 'as') && isIdent(t)) poisoned.add(t.text)
      if (isWord(t, 'in') && isIdent(statement[i - 1])
        && ['[', '(', ','].some((p) => isPunct(statement[i - 2], p))) poisoned.add(statement[i - 1]!.text)
    })

    const nodeVars = new Map<string, string[]>()
    const relVars = new Map<string, string[]>()
    const bind = (map: Map<string, string[]>, name: string | undefined, names: string[], resolvable: boolean) => {
      if (!name || poisoned.has(name)) return
      if (!resolvable) { poisoned.add(name); map.delete(name); return }
      const prior = map.get(name)
      if (prior && names.length > 0 && prior.join() !== names.join()) { poisoned.add(name); map.delete(name); return }
      if (!prior && names.length > 0) map.set(name, names)
    }

    for (const el of chains.flat()) {
      if (el.kind === 'node') {
        for (const l of el.labels) {
          if (!nodes.has(l.name)) {
            find('lint-unknown-label', `No node type is called '${l.name}'. Known: ${[...nodes.keys()].join(', ')}.`, l.token.start, l.token.end)
          }
        }
        bind(nodeVars, el.variable, el.labels.map((l) => l.name), !el.expression)
      } else {
        for (const t of el.types) {
          if (!edges.has(t.name)) {
            find('lint-unknown-edge', `No edge type is called '${t.name}'. Known: ${[...edges.keys()].join(', ')}.`, t.token.start, t.token.end)
          }
        }
        bind(relVars, el.variable, el.types.map((t) => t.name), !el.unreadable && el.types.length > 0)
      }
    }

    const labelsOf = (n: NodePattern): string[] =>
      n.labels.length > 0 && !n.expression ? n.labels.map((l) => l.name)
        : n.variable && !poisoned.has(n.variable) ? nodeVars.get(n.variable) ?? [] : []

    // Endpoints and direction, against each chain's resolved ends.
    for (const chain of chains) {
      for (let k = 1; k < chain.length; k += 2) {
        const rel = chain[k] as RelPattern
        const a = labelsOf(chain[k - 1] as NodePattern)
        const b = labelsOf(chain[k + 1] as NodePattern)
        const known = rel.types.map((t) => edges.get(t.name)).filter((e): e is EdgeTypeIR => e !== undefined)
        if (known.length === 0 || known.length !== rel.types.length || (a.length === 0 && b.length === 0)) continue
        const ok = (e: EdgeTypeIR, from: string[], to: string[]) => compatible(from, e.from) && compatible(to, e.to)
        const forward = known.some((e) => (rel.direction === 'in' ? ok(e, b, a) : ok(e, a, b)))
        const either = known.some((e) => ok(e, a, b) || ok(e, b, a))
        if (forward || (rel.direction === 'any' && either)) continue
        const names = known.map((e) => e.name).join('|')
        const declared = known.map((e) => `${e.name}: ${e.from} → ${e.to}`).join('; ')
        const shown = `(${a.join(':') || '…'}) and (${b.join(':') || '…'})`
        if (rel.direction !== 'any' && either) {
          find('lint-edge-direction', `${names} is traversed against its direction: the model declares ${declared}, and the other way round would fit ${shown}.`, rel.start, rel.end)
        } else {
          find('lint-edge-endpoint', `${names} cannot connect ${shown}: the model declares ${declared}.`, rel.start, rel.end)
        }
      }
    }

    // Property names in node and relationship maps.
    for (const el of chains.flat()) {
      if (el.kind === 'node') {
        const types = nodeProps(labelsOf(el))
        if (!types) continue
        for (const key of el.mapKeys) {
          if (!anyOpen(types) && !types.some((t) => t.props.some((p) => p.name === key.name))
            && !descendantHasProperty(labelsOf(el), key.name)) {
            find('lint-unknown-property', `${labelsOf(el).join(':')} has no property '${key.name}'.`, key.token.start, key.token.end)
          }
        }
      } else {
        const types = edgeProps(el.types.map((t) => t.name))
        if (!types) continue
        for (const key of el.mapKeys) {
          if (!types.some((e) => e.props.some((p) => p.name === key.name))) {
            find('lint-unknown-property', `${el.types.map((t) => t.name).join('|')} has no property '${key.name}'.`, key.token.start, key.token.end)
          }
        }
      }
    }

    // `variable.property` accesses, and a literal compared to one.
    statement.forEach((t, i) => {
      if (!isIdent(t) || t.quoted || !isPunct(statement[i + 1], '.') || !isIdent(statement[i + 2])
        || isPunct(statement[i - 1], '.') || poisoned.has(t.text)) return
      const prop = statement[i + 2]!
      const nodeLabels = nodeVars.get(t.text)
      const relTypes = relVars.get(t.text)
      let candidates: PropertyIR[] | undefined
      let owner = ''
      if (nodeLabels) {
        const types = nodeProps(nodeLabels)
        if (!types) return
        const found = types.flatMap((n) => n.props.filter((p) => p.name === prop.text))
        if (found.length === 0) {
          // A subtype's property, read off a supertype-labelled node, is a question of
          // which instances are meant. Not a finding.
          if (!anyOpen(types) && !descendantHasProperty(nodeLabels, prop.text)) {
            find('lint-unknown-property', `${nodeLabels.join(':')} has no property '${prop.text}'.`, prop.start, prop.end)
          }
          return
        }
        candidates = found
        owner = nodeLabels.join(':')
      } else if (relTypes) {
        const types = edgeProps(relTypes)
        if (!types) return
        const found = types.flatMap((e) => e.props.filter((p) => p.name === prop.text))
        if (found.length === 0) {
          find('lint-unknown-property', `${relTypes.join('|')} has no property '${prop.text}'.`, prop.start, prop.end)
          return
        }
        candidates = found
        owner = relTypes.join('|')
      }
      if (!candidates || candidates.length === 0) return

      const op = statement[i + 3]
      if (!op || op.kind !== 'punct' || !['=', '<>', '<', '>', '<=', '>='].includes(op.text)) return
      const literal = literalFamily(statement, i + 4)
      const families = new Set(candidates.map(propertyFamily))
      if (!literal || families.size !== 1) return
      const family = [...families][0]
      const p = candidates[0]!
      if (family === 'enum') {
        const values = model.enums.find((e) => e.name === p.enum)?.values ?? []
        const lit = statement[i + 4]!
        if (literal !== 'string') {
          find('lint-type-mismatch', `${owner}.${p.name} is limited to enum ${p.enum}, and is compared with a ${literal} literal.`, lit.start, lit.end)
        } else if (['=', '<>'].includes(op.text) && !values.includes(lit.text)) {
          find('lint-enum-value', `'${lit.text}' is not a value of enum ${p.enum} (${values.join(', ')}).`, lit.start, lit.end)
        }
      } else if (family && family !== literal) {
        const lit = isPunct(statement[i + 4], '-') ? statement[i + 5]! : statement[i + 4]!
        find('lint-type-mismatch', `${owner}.${p.name} is ${p.type}, and is compared with a ${literal} literal.`, lit.start, lit.end)
      }
    })
  }
  return out
}
