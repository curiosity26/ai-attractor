// Wait for human handler — console-based interactive choice

import { createInterface } from 'node:readline'
import { Handler, GraphNode, Graph, ContextStore, Outcome } from '../types.js'

// ANSI
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'

interface Choice {
  key: string
  label: string
  to: string
}

export class WaitForHumanHandler implements Handler {
  async execute(
    node: GraphNode,
    _context: ContextStore,
    graph: Graph,
    _logsRoot: string,
  ): Promise<Outcome> {
    // 1. Derive choices from outgoing edges
    const edges = graph.edges.filter(e => e.from === node.id)
    const choices: Choice[] = edges.map(edge => {
      const label = edge.attrs.label || edge.to
      const key = parseAcceleratorKey(label)
      return { key, label, to: edge.to }
    })

    if (choices.length === 0) {
      return {
        status: 'fail',
        failure_reason: 'No outgoing edges for human gate',
      }
    }

    // 2. Present choices
    const questionText = node.attrs.label || 'Select an option:'
    console.log('')
    console.log(`${BOLD}${CYAN}[?] ${questionText}${RESET}`)
    for (const choice of choices) {
      console.log(`  ${BOLD}[${choice.key}]${RESET} ${choice.label}`)
    }

    // 3. Read selection from stdin
    const answer = await readLine(`${DIM}Select: ${RESET}`)
    const normalizedAnswer = answer.trim().toUpperCase()

    // 4. Find matching choice
    let selected = choices.find(c => c.key.toUpperCase() === normalizedAnswer)
    if (!selected) {
      // Try matching by first character of each key
      selected = choices.find(c => c.key.toUpperCase().startsWith(normalizedAnswer))
    }
    if (!selected) {
      // Fallback to first choice
      selected = choices[0]
    }

    // 5. Return outcome
    return {
      status: 'success',
      suggested_next_ids: [selected.to],
      preferred_label: selected.label,
      context_updates: {
        'human.gate.selected': selected.key,
        'human.gate.label': selected.label,
      },
    }
  }
}

function parseAcceleratorKey(label: string): string {
  // Pattern: [K] Label
  const bracketMatch = label.match(/^\[([^\]]+)\]\s+/)
  if (bracketMatch) return bracketMatch[1]

  // Pattern: K) Label
  const parenMatch = label.match(/^([A-Za-z0-9])\)\s+/)
  if (parenMatch) return parenMatch[1]

  // Pattern: K - Label
  const dashMatch = label.match(/^([A-Za-z0-9])\s+-\s+/)
  if (dashMatch) return dashMatch[1]

  // Fallback: first character
  return label.charAt(0).toUpperCase()
}

function readLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}
