import { describe, it, expect } from 'vitest'
import { Context } from './context.js'

describe('Context', () => {
  it('set() and get() round-trip', () => {
    const ctx = new Context()
    ctx.set('key', 'value')
    expect(ctx.get('key')).toBe('value')
  })

  it('get() returns various types correctly', () => {
    const ctx = new Context()
    ctx.set('str', 'hello')
    ctx.set('num', 42)
    ctx.set('bool', true)
    ctx.set('obj', { nested: 'data' })

    expect(ctx.get('str')).toBe('hello')
    expect(ctx.get('num')).toBe(42)
    expect(ctx.get('bool')).toBe(true)
    expect(ctx.get('obj')).toEqual({ nested: 'data' })
  })

  it('getString() returns string representation', () => {
    const ctx = new Context()
    ctx.set('num', 42)
    ctx.set('str', 'hello')
    ctx.set('bool', true)

    expect(ctx.getString('num')).toBe('42')
    expect(ctx.getString('str')).toBe('hello')
    expect(ctx.getString('bool')).toBe('true')
  })

  it('getString() returns default value when key is missing', () => {
    const ctx = new Context()
    expect(ctx.getString('missing')).toBe('')
    expect(ctx.getString('missing', 'fallback')).toBe('fallback')
  })

  it('get() with default value when key is missing', () => {
    const ctx = new Context()
    expect(ctx.get('missing')).toBeUndefined()
    expect(ctx.get('missing', 'default')).toBe('default')
  })

  it('snapshot() returns a plain object copy', () => {
    const ctx = new Context()
    ctx.set('a', 1)
    ctx.set('b', { nested: true })

    const snap = ctx.snapshot()
    expect(snap).toEqual({ a: 1, b: { nested: true } })

    // Mutating the snapshot does not affect the context
    snap.a = 999
    expect(ctx.get('a')).toBe(1)
  })

  it('clone() creates an independent copy (mutations do not propagate)', () => {
    const ctx = new Context()
    ctx.set('shared', 'original')
    ctx.appendLog('log entry 1')

    const cloned = ctx.clone() as Context

    // Clone has same values
    expect(cloned.get('shared')).toBe('original')
    expect(cloned.getLogs()).toEqual(['log entry 1'])

    // Mutate clone
    cloned.set('shared', 'modified')
    cloned.appendLog('log entry 2')

    // Original is unaffected
    expect(ctx.get('shared')).toBe('original')
    expect(ctx.getLogs()).toEqual(['log entry 1'])

    // Clone has its own state
    expect(cloned.get('shared')).toBe('modified')
    expect(cloned.getLogs()).toEqual(['log entry 1', 'log entry 2'])
  })

  it('applyUpdates() merges multiple key-value pairs', () => {
    const ctx = new Context()
    ctx.set('existing', 'keep')
    ctx.applyUpdates({ a: 1, b: 'two', c: true })

    expect(ctx.get('existing')).toBe('keep')
    expect(ctx.get('a')).toBe(1)
    expect(ctx.get('b')).toBe('two')
    expect(ctx.get('c')).toBe(true)
  })

  it('applyUpdates() overwrites existing keys', () => {
    const ctx = new Context()
    ctx.set('key', 'old')
    ctx.applyUpdates({ key: 'new' })
    expect(ctx.get('key')).toBe('new')
  })

  it('appendLog() and getLogs() round-trip', () => {
    const ctx = new Context()
    ctx.appendLog('first')
    ctx.appendLog('second')
    ctx.appendLog('third')

    expect(ctx.getLogs()).toEqual(['first', 'second', 'third'])
  })

  it('getLogs() returns a copy (mutations do not propagate)', () => {
    const ctx = new Context()
    ctx.appendLog('entry')

    const logs = ctx.getLogs()
    logs.push('injected')

    // Original is unaffected
    expect(ctx.getLogs()).toEqual(['entry'])
  })
})
