// Context key-value store for pipeline state

import { ContextStore } from './types.js'

export class Context implements ContextStore {
  private values: Record<string, unknown> = {}
  private logs_: string[] = []

  set(key: string, value: unknown): void {
    this.values[key] = value
  }

  get(key: string, defaultValue?: unknown): unknown {
    if (key in this.values) {
      return this.values[key]
    }
    return defaultValue ?? undefined
  }

  getString(key: string, defaultValue = ''): string {
    const value = this.get(key)
    if (value === undefined || value === null) return defaultValue
    return String(value)
  }

  snapshot(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this.values))
  }

  clone(): ContextStore {
    const ctx = new Context()
    ctx.values = JSON.parse(JSON.stringify(this.values))
    ctx.logs_ = [...this.logs_]
    return ctx
  }

  applyUpdates(updates: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(updates)) {
      this.values[key] = value
    }
  }

  appendLog(entry: string): void {
    this.logs_.push(entry)
  }

  getLogs(): string[] {
    return [...this.logs_]
  }
}
