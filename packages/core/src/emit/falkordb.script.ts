/**
 * Reads a generated FalkorDB script back into the Redis commands it invokes, so `apply`
 * can send them without running a shell. The artifact stays a shell script for the
 * reason lat.md/emitters#FalkorDB Target gives -- an index is Cypher and a constraint is
 * a Redis command, and a shell comment can carry a downgrade note where a line in a
 * redis pipe cannot. See lat.md/emitters#FalkorDB Target#Reading the Script Back.
 */

export interface FalkorCommand {
  /** The line this came from, 1-based, for a failure that names where it is. */
  line: number
  /** The command and its arguments, as they would be sent. */
  args: string[]
}

export interface FalkorScriptRead {
  commands: FalkorCommand[]
  /** The graph key the script names, from its `GRAPH_KEY` assignment. */
  graphKey?: string
  /** A line that is not one of the shapes the generator writes. */
  error?: { line: number; text: string }
}

/**
 * Splits a line into words, honouring `"..."` and `'...'`. The generator quotes a Cypher
 * statement and nothing else, and never puts a quote inside one, so this is exact for
 * the shapes it writes -- and anything it is not exact for is refused by the caller
 * rather than guessed at.
 */
function words(line: string): string[] | undefined {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let started = false
  for (const ch of line) {
    if (quote) {
      if (ch === quote) { quote = undefined; continue }
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue }
    // A shell metacharacter outside quotes means the line does something this reader
    // does not model -- a pipe, a redirect, a second command, a substitution. Sending
    // its words as one command would run something other than what the line says, so
    // the whole line is refused.
    if ('|;&<>()`'.includes(ch)) return undefined
    if (/\s/.test(ch)) {
      if (started) { out.push(current); current = ''; started = false }
      continue
    }
    current += ch
    started = true
  }
  if (quote) return undefined  // an unterminated quote is not a shape we write
  if (started) out.push(current)
  return out
}

const ASSIGNMENT = /^([A-Z_][A-Z0-9_]*)="\$\{\1:-([^}]*)\}"$/

/**
 * Reads the script. Every `$REDIS_CLI` line becomes one command with `$GRAPH_KEY`
 * substituted; the preamble's two assignments are understood, comments and blank lines
 * are skipped, and anything else stops the read with the line that caused it. Refusing
 * rather than interpreting is the point: a reader that accepts exactly what this tool
 * writes can say honestly what it is about to run, where a general shell reader would
 * be a shell, with the failure modes of one, applied to a file a user may have edited.
 */
export function readFalkorScript(text: string, overrideGraphKey?: string): FalkorScriptRead {
  const commands: FalkorCommand[] = []
  let graphKey: string | undefined
  let redisCli = 'redis-cli'

  const lines = text.split('\n')
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue

    const assignment = ASSIGNMENT.exec(line)
    if (assignment) {
      if (assignment[1] === 'GRAPH_KEY') graphKey = assignment[2]
      else if (assignment[1] === 'REDIS_CLI') redisCli = assignment[2] ?? redisCli
      else return { commands, graphKey, error: { line: index + 1, text: line } }
      continue
    }

    const parts = words(line)
    if (!parts || parts.length < 2 || parts[0] !== '$REDIS_CLI') {
      return { commands, graphKey, error: { line: index + 1, text: line } }
    }
    const args = parts.slice(1).map((a) => (a === '$GRAPH_KEY' ? (overrideGraphKey ?? graphKey ?? '') : a))
    if (args.some((a) => a.includes('$'))) {
      return { commands, graphKey, error: { line: index + 1, text: line } }
    }
    const verb = args[0]?.toUpperCase()
    if (verb !== 'GRAPH.QUERY' && verb !== 'GRAPH.CONSTRAINT') {
      return { commands, graphKey, error: { line: index + 1, text: line } }
    }
    commands.push({ line: index + 1, args })
  }

  void redisCli  // read so an override is understood rather than silently ignored
  return { commands, graphKey }
}
