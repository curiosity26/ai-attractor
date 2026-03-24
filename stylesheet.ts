// Model stylesheet parser and applicator
//
// CSS-like specificity: * (0) < shape (1) < .class (2) < #id (3)

import { Graph, StylesheetRule, StylesheetSelector } from './types.js'

// ─── Parser ───

export function parseStylesheet(source: string): StylesheetRule[] {
  const rules: StylesheetRule[] = []
  if (!source || source.trim() === '') return rules

  let i = 0
  const s = source.trim()

  function skipWhitespace(): void {
    while (i < s.length && /\s/.test(s[i])) i++
  }

  function readUntil(ch: string): string {
    let result = ''
    while (i < s.length && s[i] !== ch) {
      result += s[i]
      i++
    }
    return result
  }

  while (i < s.length) {
    skipWhitespace()
    if (i >= s.length) break

    // Read selector
    const selectorStart = i
    while (i < s.length && s[i] !== '{') i++
    const selectorStr = s.slice(selectorStart, i).trim()
    if (!selectorStr) break

    const selector = parseSelector(selectorStr)
    if (!selector) {
      // Skip this rule
      if (i < s.length) i++ // skip {
      readUntil('}')
      if (i < s.length) i++ // skip }
      continue
    }

    if (i < s.length) i++ // skip {

    // Read declarations
    const declStr = readUntil('}')
    if (i < s.length) i++ // skip }

    const declarations = parseDeclarations(declStr)
    if (Object.keys(declarations).length > 0) {
      rules.push({ selector, declarations })
    }
  }

  return rules
}

function parseSelector(selectorStr: string): StylesheetSelector | null {
  const s = selectorStr.trim()

  if (s === '*') {
    return { type: 'universal', value: '*', specificity: 0 }
  }
  if (s.startsWith('#')) {
    return { type: 'id', value: s.slice(1), specificity: 3 }
  }
  if (s.startsWith('.')) {
    return { type: 'class', value: s.slice(1), specificity: 2 }
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
    return { type: 'shape', value: s, specificity: 1 }
  }

  return null
}

function parseDeclarations(declStr: string): Record<string, string> {
  const decls: Record<string, string> = {}
  const parts = declStr.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) continue
    const prop = trimmed.slice(0, colonIndex).trim()
    let value = trimmed.slice(colonIndex + 1).trim()
    // Strip quotes from value
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }
    if (prop && value) {
      decls[prop] = value
    }
  }
  return decls
}

// ─── Applicator ───

export function applyStylesheet(graph: Graph): void {
  const stylesheetSource = graph.attrs.model_stylesheet
  if (!stylesheetSource) return

  const rules = parseStylesheet(stylesheetSource)
  if (rules.length === 0) return

  // Sort rules by specificity (lower first, so later overrides)
  rules.sort((a, b) => a.selector.specificity - b.selector.specificity)

  for (const [, node] of graph.nodes) {
    // Collect matching rules in specificity order
    const matchingDecls: Record<string, string> = {}

    for (const rule of rules) {
      if (selectorMatches(rule.selector, node.id, node.attrs.shape, node.attrs.class)) {
        Object.assign(matchingDecls, rule.declarations)
      }
    }

    // Apply declarations only where the node doesn't have explicit values
    for (const [prop, value] of Object.entries(matchingDecls)) {
      switch (prop) {
        case 'llm_model':
          if (!node.attrs.llm_model) node.attrs.llm_model = value
          break
        case 'llm_provider':
          if (!node.attrs.llm_provider) node.attrs.llm_provider = value
          break
        case 'reasoning_effort':
          if (node.attrs.reasoning_effort === 'high') {
            // Only override if not explicitly set (high is default)
            // We can't distinguish "explicitly set to high" from "default high"
            // so we always apply stylesheet for reasoning_effort
            node.attrs.reasoning_effort = value
          }
          break
      }
    }
  }
}

function selectorMatches(
  selector: StylesheetSelector,
  nodeId: string,
  nodeShape: string,
  nodeClasses: string,
): boolean {
  switch (selector.type) {
    case 'universal':
      return true
    case 'shape':
      return nodeShape === selector.value
    case 'class': {
      if (!nodeClasses) return false
      const classes = nodeClasses.split(',').map(c => c.trim())
      return classes.includes(selector.value)
    }
    case 'id':
      return nodeId === selector.value
  }
}

// ─── Validation ───

export function validateStylesheetSyntax(source: string): string | null {
  if (!source || source.trim() === '') return null

  try {
    const rules = parseStylesheet(source)
    if (rules.length === 0 && source.trim().length > 0) {
      return 'No valid rules found in stylesheet'
    }
    return null
  } catch (e) {
    return String(e)
  }
}
