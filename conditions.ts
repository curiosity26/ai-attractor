// Condition expression evaluator
//
// Supports: key=value, key!=value, && conjunction
// Keys: outcome, preferred_label, context.*

import { Outcome, ContextStore } from './types.js'

export function evaluateCondition(
  condition: string,
  outcome: Outcome,
  context: ContextStore,
): boolean {
  if (!condition || condition.trim() === '') return true

  const clauses = condition.split('&&')
  for (const clause of clauses) {
    const trimmed = clause.trim()
    if (!trimmed) continue
    if (!evaluateClause(trimmed, outcome, context)) {
      return false
    }
  }
  return true
}

function evaluateClause(
  clause: string,
  outcome: Outcome,
  context: ContextStore,
): boolean {
  // Check for != first (before =)
  const neqIndex = clause.indexOf('!=')
  if (neqIndex !== -1) {
    const key = clause.slice(0, neqIndex).trim()
    const value = parseLiteral(clause.slice(neqIndex + 2).trim())
    return resolveKey(key, outcome, context) !== value
  }

  const eqIndex = clause.indexOf('=')
  if (eqIndex !== -1) {
    const key = clause.slice(0, eqIndex).trim()
    const value = parseLiteral(clause.slice(eqIndex + 1).trim())
    return resolveKey(key, outcome, context) === value
  }

  // Bare key — check truthiness
  const resolved = resolveKey(clause.trim(), outcome, context)
  return resolved !== '' && resolved !== 'false' && resolved !== '0'
}

function resolveKey(
  key: string,
  outcome: Outcome,
  context: ContextStore,
): string {
  if (key === 'outcome') {
    return outcome.status
  }
  if (key === 'preferred_label') {
    return outcome.preferred_label ?? ''
  }
  if (key.startsWith('context.')) {
    // Try with the full key first
    let value = context.get(key)
    if (value !== undefined && value !== null) {
      return String(value)
    }
    // Try without the "context." prefix
    const shortKey = key.slice(8)
    value = context.get(shortKey)
    if (value !== undefined && value !== null) {
      return String(value)
    }
    return ''
  }
  // Direct context lookup for unqualified keys
  const value = context.get(key)
  if (value !== undefined && value !== null) {
    return String(value)
  }
  return ''
}

function parseLiteral(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
  }
  return trimmed
}

// Validate condition syntax — returns error message or null if valid
export function validateConditionSyntax(condition: string): string | null {
  if (!condition || condition.trim() === '') return null

  const clauses = condition.split('&&')
  for (const clause of clauses) {
    const trimmed = clause.trim()
    if (!trimmed) continue

    const hasNeq = trimmed.includes('!=')
    const hasEq = !hasNeq && trimmed.includes('=')

    if (!hasNeq && !hasEq) {
      // Bare key — check it looks like an identifier
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(trimmed)) {
        return `Invalid key: "${trimmed}"`
      }
      continue
    }

    const sep = hasNeq ? '!=' : '='
    const parts = trimmed.split(sep)
    if (parts.length < 2) {
      return `Missing value in clause: "${trimmed}"`
    }

    const key = parts[0].trim()
    if (!key) {
      return `Empty key in clause: "${trimmed}"`
    }
    if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(key)) {
      return `Invalid key: "${key}"`
    }
  }

  return null
}
