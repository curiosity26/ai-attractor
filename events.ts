// Event emitter for pipeline observability

import { PipelineEvent } from './types.js'

// ANSI color codes
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const MAGENTA = '\x1b[35m'
const BLUE = '\x1b[34m'

export type EventListener = (event: PipelineEvent) => void

export class EventEmitter {
  private listeners: EventListener[] = []

  on(listener: EventListener): void {
    this.listeners.push(listener)
  }

  emit(event: PipelineEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

export function consoleEventListener(event: PipelineEvent): void {
  const ts = new Date().toISOString().slice(11, 19)
  const prefix = `${DIM}[${ts}]${RESET}`

  switch (event.type) {
    case 'pipeline_started':
      console.log(`${prefix} ${BOLD}${MAGENTA}Pipeline started:${RESET} ${event.name} ${DIM}(${event.id})${RESET}`)
      break
    case 'pipeline_completed':
      console.log(`${prefix} ${BOLD}${GREEN}Pipeline completed${RESET} ${DIM}(${(event.duration / 1000).toFixed(1)}s)${RESET}`)
      break
    case 'pipeline_failed':
      console.log(`${prefix} ${BOLD}${RED}Pipeline failed:${RESET} ${event.error} ${DIM}(${(event.duration / 1000).toFixed(1)}s)${RESET}`)
      break
    case 'stage_started':
      console.log(`${prefix} ${CYAN}▶ Stage ${event.index}:${RESET} ${BOLD}${event.name}${RESET} ${DIM}(${event.node_id})${RESET}`)
      break
    case 'stage_completed':
      console.log(`${prefix} ${GREEN}✓ Stage ${event.index}:${RESET} ${BOLD}${event.name}${RESET} ${DIM}(${(event.duration / 1000).toFixed(1)}s)${RESET}`)
      break
    case 'stage_failed':
      console.log(`${prefix} ${RED}✗ Stage ${event.index}:${RESET} ${BOLD}${event.name}${RESET} — ${event.error}${event.will_retry ? ` ${YELLOW}(will retry)${RESET}` : ''}`)
      break
    case 'stage_retrying':
      console.log(`${prefix} ${YELLOW}↻ Stage ${event.index}:${RESET} ${event.name} — attempt ${event.attempt} ${DIM}(delay ${event.delay}ms)${RESET}`)
      break
    case 'checkpoint_saved':
      console.log(`${prefix} ${BLUE}💾 Checkpoint:${RESET} ${event.node_id}`)
      break
    case 'edge_selected':
      console.log(`${prefix} ${DIM}→ Edge:${RESET} ${event.from} → ${event.to}${event.label ? ` [${event.label}]` : ''} ${DIM}(${event.reason})${RESET}`)
      break
  }
}
