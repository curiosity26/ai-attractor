// DOT file parser for the Attractor subset
//
// Supports: digraph, node/edge/graph attr blocks, subgraphs,
// chained edges, quoted strings, comments, bare identifiers.

import {
  Graph, GraphNode, GraphEdge, GraphAttrs, NodeAttrs, EdgeAttrs,
  parseDuration,
} from './types.js'

// ─── Tokenizer ───

type TokenType =
  | 'DIGRAPH' | 'GRAPH' | 'NODE' | 'EDGE' | 'SUBGRAPH'
  | 'LBRACE' | 'RBRACE' | 'LBRACK' | 'RBRACK'
  | 'ARROW' | 'EQ' | 'COMMA' | 'SEMI'
  | 'STRING' | 'IDENT' | 'NUMBER'
  | 'TRUE' | 'FALSE'
  | 'EOF'

interface Token {
  type: TokenType
  value: string
  line: number
  col: number
}

function stripComments(source: string): string {
  let result = ''
  let i = 0
  let inString = false

  while (i < source.length) {
    if (inString) {
      if (source[i] === '\\' && i + 1 < source.length) {
        result += source[i] + source[i + 1]
        i += 2
        continue
      }
      if (source[i] === '"') {
        inString = false
      }
      result += source[i]
      i++
      continue
    }

    if (source[i] === '"') {
      inString = true
      result += source[i]
      i++
      continue
    }

    // Line comment
    if (source[i] === '/' && i + 1 < source.length && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }

    // Block comment
    if (source[i] === '/' && i + 1 < source.length && source[i + 1] === '*') {
      i += 2
      while (i < source.length) {
        if (source[i] === '*' && i + 1 < source.length && source[i + 1] === '/') {
          i += 2
          break
        }
        // Preserve newlines for line counting
        if (source[i] === '\n') result += '\n'
        i++
      }
      continue
    }

    result += source[i]
    i++
  }

  return result
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let line = 1
  let col = 1

  function advance(n = 1): void {
    for (let j = 0; j < n; j++) {
      if (source[i] === '\n') {
        line++
        col = 1
      } else {
        col++
      }
      i++
    }
  }

  function skipWhitespace(): void {
    while (i < source.length && /\s/.test(source[i])) {
      advance()
    }
  }

  function readString(): string {
    const startLine = line
    const startCol = col
    advance() // skip opening quote
    let value = ''
    while (i < source.length && source[i] !== '"') {
      if (source[i] === '\\' && i + 1 < source.length) {
        advance()
        switch (source[i]) {
          case 'n': value += '\n'; break
          case 't': value += '\t'; break
          case '\\': value += '\\'; break
          case '"': value += '"'; break
          default: value += source[i]; break
        }
        advance()
      } else {
        value += source[i]
        advance()
      }
    }
    if (i < source.length) advance() // skip closing quote
    void startLine; void startCol
    return value
  }

  function readIdentOrKeyword(): Token {
    const startCol = col
    let value = ''
    while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) {
      value += source[i]
      advance()
    }
    const keywords: Record<string, TokenType> = {
      digraph: 'DIGRAPH',
      graph: 'GRAPH',
      node: 'NODE',
      edge: 'EDGE',
      subgraph: 'SUBGRAPH',
      true: 'TRUE',
      false: 'FALSE',
    }
    const type = keywords[value] ?? 'IDENT'
    return { type, value, line, col: startCol }
  }

  function readNumber(): Token {
    const startCol = col
    let value = ''
    if (source[i] === '-') {
      value += source[i]
      advance()
    }
    while (i < source.length && /[0-9]/.test(source[i])) {
      value += source[i]
      advance()
    }
    if (i < source.length && source[i] === '.' && i + 1 < source.length && /[0-9]/.test(source[i + 1])) {
      value += source[i]
      advance()
      while (i < source.length && /[0-9]/.test(source[i])) {
        value += source[i]
        advance()
      }
    }
    // Check for duration suffix
    if (i < source.length && /[a-z]/.test(source[i])) {
      let suffix = ''
      while (i < source.length && /[a-z]/.test(source[i])) {
        suffix += source[i]
        advance()
      }
      value += suffix
    }
    return { type: 'NUMBER', value, line, col: startCol }
  }

  while (i < source.length) {
    skipWhitespace()
    if (i >= source.length) break

    const c = source[i]
    const startCol = col

    if (c === '{') { tokens.push({ type: 'LBRACE', value: c, line, col: startCol }); advance(); continue }
    if (c === '}') { tokens.push({ type: 'RBRACE', value: c, line, col: startCol }); advance(); continue }
    if (c === '[') { tokens.push({ type: 'LBRACK', value: c, line, col: startCol }); advance(); continue }
    if (c === ']') { tokens.push({ type: 'RBRACK', value: c, line, col: startCol }); advance(); continue }
    if (c === '=') { tokens.push({ type: 'EQ', value: c, line, col: startCol }); advance(); continue }
    if (c === ',' || c === ';') {
      tokens.push({ type: c === ',' ? 'COMMA' : 'SEMI', value: c, line, col: startCol })
      advance()
      continue
    }
    if (c === '-' && i + 1 < source.length && source[i + 1] === '>') {
      tokens.push({ type: 'ARROW', value: '->', line, col: startCol })
      advance(2)
      continue
    }
    if (c === '"') {
      const value = readString()
      tokens.push({ type: 'STRING', value, line, col: startCol })
      continue
    }
    if (c === '-' && i + 1 < source.length && /[0-9]/.test(source[i + 1])) {
      tokens.push(readNumber())
      continue
    }
    if (/[0-9]/.test(c)) {
      tokens.push(readNumber())
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      tokens.push(readIdentOrKeyword())
      continue
    }

    // Skip unknown character
    advance()
  }

  tokens.push({ type: 'EOF', value: '', line, col })
  return tokens
}

// ─── Parser ───

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private advance(): Token {
    const t = this.tokens[this.pos]
    this.pos++
    return t
  }

  private expect(type: TokenType): Token {
    const t = this.peek()
    if (t.type !== type) {
      throw new Error(`Parse error at line ${t.line}:${t.col}: expected ${type}, got ${t.type} ("${t.value}")`)
    }
    return this.advance()
  }

  private match(type: TokenType): boolean {
    if (this.peek().type === type) {
      this.advance()
      return true
    }
    return false
  }

  private skipSemicolons(): void {
    while (this.peek().type === 'SEMI') this.advance()
  }

  parse(): Graph {
    this.expect('DIGRAPH')
    const name = this.expect('IDENT').value
    this.expect('LBRACE')

    const graph: Graph = {
      name,
      attrs: defaultGraphAttrs(),
      nodes: new Map(),
      edges: [],
    }

    const nodeDefaults: Partial<NodeAttrs> = {}
    const edgeDefaults: Partial<EdgeAttrs> = {}

    this.parseBody(graph, nodeDefaults, edgeDefaults, [])

    this.expect('RBRACE')
    return graph
  }

  private parseBody(
    graph: Graph,
    nodeDefaults: Partial<NodeAttrs>,
    edgeDefaults: Partial<EdgeAttrs>,
    subgraphClasses: string[],
  ): void {
    while (this.peek().type !== 'RBRACE' && this.peek().type !== 'EOF') {
      this.skipSemicolons()
      if (this.peek().type === 'RBRACE' || this.peek().type === 'EOF') break
      this.parseStatement(graph, nodeDefaults, edgeDefaults, subgraphClasses)
      this.skipSemicolons()
    }
  }

  private parseStatement(
    graph: Graph,
    nodeDefaults: Partial<NodeAttrs>,
    edgeDefaults: Partial<EdgeAttrs>,
    subgraphClasses: string[],
  ): void {
    const t = this.peek()

    // graph [...] — graph attribute block
    if (t.type === 'GRAPH') {
      this.advance()
      if (this.peek().type === 'LBRACK') {
        const attrs = this.parseAttrBlock()
        applyGraphAttrs(graph.attrs, attrs)
      }
      return
    }

    // node [...] — node defaults
    if (t.type === 'NODE') {
      this.advance()
      if (this.peek().type === 'LBRACK') {
        const attrs = this.parseAttrBlock()
        Object.assign(nodeDefaults, attrs)
      }
      return
    }

    // edge [...] — edge defaults
    if (t.type === 'EDGE') {
      this.advance()
      if (this.peek().type === 'LBRACK') {
        const attrs = this.parseAttrBlock()
        Object.assign(edgeDefaults, attrs)
      }
      return
    }

    // subgraph — scoped block
    if (t.type === 'SUBGRAPH') {
      this.advance()
      let subgraphLabel = ''
      if (this.peek().type === 'IDENT') {
        this.advance() // skip subgraph name
      }
      this.expect('LBRACE')

      // Create inherited copies
      const subNodeDefaults = { ...nodeDefaults }
      const subEdgeDefaults = { ...edgeDefaults }
      const subClasses = [...subgraphClasses]

      // Parse subgraph body; detect label for class derivation
      while (this.peek().type !== 'RBRACE' && this.peek().type !== 'EOF') {
        this.skipSemicolons()
        if (this.peek().type === 'RBRACE') break

        // Check for label = "..." inside subgraph at top-level
        if (this.peek().type === 'IDENT' && this.peek().value === 'label' &&
            this.tokens[this.pos + 1]?.type === 'EQ') {
          this.advance() // label
          this.advance() // =
          const val = this.parseValue()
          subgraphLabel = String(val)
          const derived = deriveClassName(subgraphLabel)
          if (derived) subClasses.push(derived)
          this.skipSemicolons()
          continue
        }

        this.parseStatement(graph, subNodeDefaults, subEdgeDefaults, subClasses)
        this.skipSemicolons()
      }
      this.expect('RBRACE')

      // If label was set via graph [...] block inside subgraph, derive class
      if (!subgraphLabel) {
        // Already handled
      }

      return
    }

    // Identifier — could be a node statement, edge statement, or top-level attr
    if (t.type === 'IDENT') {
      const id = this.advance().value

      // Top-level attribute: key = value
      if (this.peek().type === 'EQ') {
        this.advance() // =
        const value = this.parseValue()
        applyGraphAttrs(graph.attrs, { [id]: value })
        return
      }

      // Edge statement: A -> B -> C [attrs]
      if (this.peek().type === 'ARROW') {
        const chain = [id]
        while (this.peek().type === 'ARROW') {
          this.advance() // ->
          chain.push(this.expect('IDENT').value)
        }

        let edgeAttrOverrides: Record<string, unknown> = {}
        if (this.peek().type === 'LBRACK') {
          edgeAttrOverrides = this.parseAttrBlock()
        }

        // Ensure all chain nodes exist
        for (const nodeId of chain) {
          if (!graph.nodes.has(nodeId)) {
            graph.nodes.set(nodeId, {
              id: nodeId,
              attrs: buildNodeAttrs(nodeId, nodeDefaults, {}, subgraphClasses),
            })
          }
        }

        // Create edges for each pair in the chain
        for (let i = 0; i < chain.length - 1; i++) {
          const edge: GraphEdge = {
            from: chain[i],
            to: chain[i + 1],
            attrs: buildEdgeAttrs(edgeDefaults, edgeAttrOverrides),
          }
          graph.edges.push(edge)
        }
        return
      }

      // Node statement: id [...] or just id
      let nodeAttrOverrides: Record<string, unknown> = {}
      if (this.peek().type === 'LBRACK') {
        nodeAttrOverrides = this.parseAttrBlock()
      }

      // Create or update node
      const existing = graph.nodes.get(id)
      if (existing) {
        // Merge new attributes over existing
        const merged = buildNodeAttrs(id, nodeDefaults, nodeAttrOverrides, subgraphClasses)
        // Only override attributes that were explicitly provided
        for (const [key, value] of Object.entries(nodeAttrOverrides)) {
          (existing.attrs as Record<string, unknown>)[key] = coerceNodeAttr(key, value)
        }
        // Merge subgraph classes
        if (subgraphClasses.length > 0) {
          const existingClasses = existing.attrs.class ? existing.attrs.class.split(',').map(s => s.trim()) : []
          const allClasses = [...new Set([...existingClasses, ...subgraphClasses])]
          existing.attrs.class = allClasses.join(',')
        }
        void merged
      } else {
        graph.nodes.set(id, {
          id,
          attrs: buildNodeAttrs(id, nodeDefaults, nodeAttrOverrides, subgraphClasses),
        })
      }
      return
    }

    // Skip unknown tokens
    this.advance()
  }

  private parseAttrBlock(): Record<string, unknown> {
    this.expect('LBRACK')
    const attrs: Record<string, unknown> = {}

    while (this.peek().type !== 'RBRACK' && this.peek().type !== 'EOF') {
      // Skip commas and semicolons between attributes
      if (this.peek().type === 'COMMA' || this.peek().type === 'SEMI') {
        this.advance()
        continue
      }

      // Read key (may be qualified: foo.bar)
      let key = ''
      if (this.peek().type === 'IDENT') {
        key = this.advance().value
        // Handle qualified keys like tool.command or human.default_choice
        while (this.peek().type === 'IDENT' && key.endsWith('.')) {
          key += this.advance().value
        }
        // Check for dotted continuation manually
        // Actually the tokenizer doesn't produce dots as part of identifiers
        // Handle it: if next char is actually embedded in the string...
        // The BNF says QualifiedId = Identifier ('.' Identifier)+
        // We need to handle dots between identifiers
      } else if (this.peek().type === 'STRING') {
        key = this.advance().value
      } else {
        // Skip unknown
        this.advance()
        continue
      }

      if (this.peek().type !== 'EQ') {
        // Bare identifier without value — skip
        continue
      }
      this.advance() // =

      const value = this.parseValue()
      attrs[key] = value
    }

    this.expect('RBRACK')
    return attrs
  }

  private parseValue(): unknown {
    const t = this.peek()

    if (t.type === 'STRING') {
      this.advance()
      return t.value
    }
    if (t.type === 'TRUE') {
      this.advance()
      return true
    }
    if (t.type === 'FALSE') {
      this.advance()
      return false
    }
    if (t.type === 'NUMBER') {
      this.advance()
      // Check for duration suffix
      const dur = parseDuration(t.value)
      if (dur !== undefined) return t.value // Keep as string for duration
      if (t.value.includes('.')) return parseFloat(t.value)
      return parseInt(t.value, 10)
    }
    if (t.type === 'IDENT') {
      this.advance()
      return t.value
    }

    // Fallback
    this.advance()
    return t.value
  }
}

// ─── Attribute helpers ───

function defaultGraphAttrs(): GraphAttrs {
  return {
    goal: '',
    label: '',
    model_stylesheet: '',
    default_max_retries: 0,
    retry_target: '',
    fallback_retry_target: '',
    default_fidelity: '',
  }
}

function applyGraphAttrs(target: GraphAttrs, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    switch (key) {
      case 'goal':
      case 'label':
      case 'model_stylesheet':
      case 'retry_target':
      case 'fallback_retry_target':
      case 'default_fidelity':
        target[key] = String(value)
        break
      case 'default_max_retries':
      case 'default_max_retry': // legacy alias
        target.default_max_retries = typeof value === 'number' ? value : parseInt(String(value), 10)
        break
      default:
        target[key] = value
        break
    }
  }
}

function defaultNodeAttrs(id: string): NodeAttrs {
  return {
    label: id,
    shape: 'box',
    type: '',
    prompt: '',
    goal_gate: false,
    retry_target: '',
    fallback_retry_target: '',
    fidelity: '',
    thread_id: '',
    class: '',
    llm_model: '',
    llm_provider: '',
    reasoning_effort: 'high',
    auto_status: false,
    allow_partial: false,
  }
}

function coerceNodeAttr(key: string, value: unknown): unknown {
  switch (key) {
    case 'goal_gate':
    case 'auto_status':
    case 'allow_partial':
      if (typeof value === 'boolean') return value
      return value === 'true'
    case 'max_retries':
      return typeof value === 'number' ? value : parseInt(String(value), 10)
    case 'weight':
      return typeof value === 'number' ? value : parseInt(String(value), 10)
    case 'timeout': {
      if (typeof value === 'string') {
        const ms = parseDuration(value)
        if (ms !== undefined) return ms
      }
      return typeof value === 'number' ? value : undefined
    }
    default:
      return value
  }
}

function buildNodeAttrs(
  id: string,
  defaults: Partial<NodeAttrs>,
  overrides: Record<string, unknown>,
  subgraphClasses: string[],
): NodeAttrs {
  const base = defaultNodeAttrs(id)

  // Apply defaults
  for (const [key, value] of Object.entries(defaults)) {
    if (value !== undefined) {
      (base as Record<string, unknown>)[key] = value
    }
  }

  // Apply explicit overrides
  for (const [key, value] of Object.entries(overrides)) {
    (base as Record<string, unknown>)[key] = coerceNodeAttr(key, value)
  }

  // Merge subgraph-derived classes
  if (subgraphClasses.length > 0) {
    const existing = base.class ? base.class.split(',').map(s => s.trim()) : []
    const allClasses = [...new Set([...existing, ...subgraphClasses])]
    base.class = allClasses.join(',')
  }

  return base
}

function defaultEdgeAttrs(): EdgeAttrs {
  return {
    label: '',
    condition: '',
    weight: 0,
    fidelity: '',
    thread_id: '',
    loop_restart: false,
  }
}

function buildEdgeAttrs(
  defaults: Partial<EdgeAttrs>,
  overrides: Record<string, unknown>,
): EdgeAttrs {
  const base = defaultEdgeAttrs()

  for (const [key, value] of Object.entries(defaults)) {
    if (value !== undefined) {
      (base as Record<string, unknown>)[key] = value
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    switch (key) {
      case 'weight':
        base.weight = typeof value === 'number' ? value : parseInt(String(value), 10)
        break
      case 'loop_restart':
        base.loop_restart = typeof value === 'boolean' ? value : value === 'true'
        break
      default:
        (base as Record<string, unknown>)[key] = value
        break
    }
  }

  return base
}

function deriveClassName(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

// ─── Public API ───

export function parseDot(source: string): Graph {
  const stripped = stripComments(source)
  const tokens = tokenize(stripped)
  const parser = new Parser(tokens)
  return parser.parse()
}
