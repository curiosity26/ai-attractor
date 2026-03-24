import { describe, it, expect } from 'vitest'
import { evaluateCondition, validateConditionSyntax } from './conditions.js'
import { Context } from './context.js'
import { Outcome } from './types.js'

function makeOutcome(status: Outcome['status'], preferred_label?: string): Outcome {
  return { status, preferred_label }
}

describe('evaluateCondition', () => {
  it('empty condition evaluates to true', () => {
    const ctx = new Context()
    expect(evaluateCondition('', makeOutcome('success'), ctx)).toBe(true)
    expect(evaluateCondition('  ', makeOutcome('success'), ctx)).toBe(true)
  })

  it('outcome=success matches when outcome is success', () => {
    const ctx = new Context()
    expect(evaluateCondition('outcome=success', makeOutcome('success'), ctx)).toBe(true)
  })

  it('outcome=fail matches when outcome is fail', () => {
    const ctx = new Context()
    expect(evaluateCondition('outcome=fail', makeOutcome('fail'), ctx)).toBe(true)
  })

  it('outcome=fail does NOT match when outcome is success', () => {
    const ctx = new Context()
    expect(evaluateCondition('outcome=fail', makeOutcome('success'), ctx)).toBe(false)
  })

  it('outcome!=success matches when outcome is not success', () => {
    const ctx = new Context()
    expect(evaluateCondition('outcome!=success', makeOutcome('fail'), ctx)).toBe(true)
  })

  it('outcome!=success does NOT match when outcome is success', () => {
    const ctx = new Context()
    expect(evaluateCondition('outcome!=success', makeOutcome('success'), ctx)).toBe(false)
  })

  it('context.key=value matches when context has that value', () => {
    const ctx = new Context()
    ctx.set('language', 'typescript')
    expect(evaluateCondition('context.language=typescript', makeOutcome('success'), ctx)).toBe(true)
  })

  it('context.key=value does NOT match when context has a different value', () => {
    const ctx = new Context()
    ctx.set('language', 'python')
    expect(evaluateCondition('context.language=typescript', makeOutcome('success'), ctx)).toBe(false)
  })

  it('context.missing_key=value does NOT match (missing key resolves to empty string)', () => {
    const ctx = new Context()
    expect(evaluateCondition('context.missing_key=value', makeOutcome('success'), ctx)).toBe(false)
  })

  it('&& conjunction: all clauses must pass', () => {
    const ctx = new Context()
    ctx.set('ready', 'true')
    expect(
      evaluateCondition('outcome=success && context.ready=true', makeOutcome('success'), ctx)
    ).toBe(true)
  })

  it('&& conjunction: fails if any clause fails', () => {
    const ctx = new Context()
    ctx.set('ready', 'false')
    expect(
      evaluateCondition('outcome=success && context.ready=true', makeOutcome('success'), ctx)
    ).toBe(false)
  })
})

describe('validateConditionSyntax', () => {
  it('returns null for valid conditions', () => {
    expect(validateConditionSyntax('')).toBeNull()
    expect(validateConditionSyntax('outcome=success')).toBeNull()
    expect(validateConditionSyntax('outcome!=fail')).toBeNull()
    expect(validateConditionSyntax('outcome=success && context.key=val')).toBeNull()
  })

  it('returns an error string for invalid conditions', () => {
    const err = validateConditionSyntax('123invalid=value')
    expect(err).toBeTypeOf('string')
    expect(err).not.toBeNull()
  })

  it('returns null for a bare valid key', () => {
    expect(validateConditionSyntax('outcome')).toBeNull()
    expect(validateConditionSyntax('context.ready')).toBeNull()
  })
})
