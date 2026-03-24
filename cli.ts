#!/usr/bin/env node
// Attractor CLI — run and validate DOT-based AI pipelines

import { readFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { parseDot } from './parser.js'
import { validate } from './validator.js'
import { runPipeline } from './engine.js'
import { EventEmitter, consoleEventListener } from './events.js'

// ANSI
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'

function usage(): void {
  console.log(`
${BOLD}Attractor${RESET} — DOT-based pipeline runner for multi-stage AI workflows

${BOLD}Usage:${RESET}
  npx tsx attractor/cli.ts ${CYAN}run${RESET} <dotfile> [options]     Run a pipeline
  npx tsx attractor/cli.ts ${CYAN}validate${RESET} <dotfile>          Validate a pipeline
  npx tsx attractor/cli.ts ${CYAN}inspect${RESET} <dotfile>           Inspect pipeline structure

${BOLD}Options:${RESET}
  --resume          Resume from last checkpoint
  --logs-dir <dir>  Override logs directory (default: .attractor-runs/<name>)
  --help            Show this help
`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage()
    process.exit(0)
  }

  const command = args[0]
  const rest = args.slice(1)

  switch (command) {
    case 'run':
      await cmdRun(rest)
      break
    case 'validate':
      cmdValidate(rest)
      break
    case 'inspect':
      cmdInspect(rest)
      break
    default:
      console.error(`${RED}Unknown command: ${command}${RESET}`)
      usage()
      process.exit(1)
  }
}

async function cmdRun(args: string[]): Promise<void> {
  const { dotFile, resume, logsDir } = parseRunArgs(args)

  // Read and parse
  const source = readFileSync(dotFile, 'utf-8')
  const graph = parseDot(source)

  console.log(`${BOLD}${CYAN}Attractor${RESET} — Running pipeline: ${BOLD}${graph.attrs.label || graph.name}${RESET}`)
  if (graph.attrs.goal) {
    console.log(`${DIM}Goal: ${graph.attrs.goal.slice(0, 120)}${graph.attrs.goal.length > 120 ? '...' : ''}${RESET}`)
  }
  console.log('')

  // Validate
  const diagnostics = validate(graph)
  const errors = diagnostics.filter(d => d.severity === 'error')
  const warnings = diagnostics.filter(d => d.severity === 'warning')

  if (warnings.length > 0) {
    for (const w of warnings) {
      console.log(`${YELLOW}warning${RESET} [${w.rule}] ${w.message}`)
    }
    console.log('')
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.log(`${RED}error${RESET} [${e.rule}] ${e.message}`)
    }
    console.error(`\n${RED}Pipeline has ${errors.length} error(s). Cannot run.${RESET}`)
    process.exit(1)
  }

  // Determine logs directory
  const logsRoot = logsDir ?? resolve(
    dirname(dotFile),
    '.attractor-runs',
    `${graph.name}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`,
  )

  // Set up events
  const events = new EventEmitter()
  events.on(consoleEventListener)

  // Run
  const outcome = await runPipeline(graph, { logsRoot, resume, events })

  console.log('')
  if (outcome.status === 'success' || outcome.status === 'partial_success') {
    console.log(`${BOLD}${GREEN}Pipeline completed: ${outcome.status}${RESET}`)
  } else {
    console.log(`${BOLD}${RED}Pipeline failed: ${outcome.status}${RESET}`)
    if (outcome.failure_reason) {
      console.log(`${RED}Reason: ${outcome.failure_reason}${RESET}`)
    }
    process.exit(1)
  }

  if (outcome.notes) {
    console.log(`${DIM}${outcome.notes}${RESET}`)
  }
  console.log(`${DIM}Logs: ${logsRoot}${RESET}`)
}

function cmdValidate(args: string[]): void {
  if (args.length === 0) {
    console.error(`${RED}Usage: attractor validate <dotfile>${RESET}`)
    process.exit(1)
  }

  const dotFile = resolve(args[0])
  const source = readFileSync(dotFile, 'utf-8')

  console.log(`${BOLD}${CYAN}Attractor${RESET} — Validating: ${basename(dotFile)}`)
  console.log('')

  // Parse
  let graph
  try {
    graph = parseDot(source)
    console.log(`${GREEN}Parse:${RESET} OK`)
  } catch (err) {
    console.log(`${RED}Parse: FAILED${RESET}`)
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // Report structure
  console.log(`${DIM}  Name:  ${graph.name}${RESET}`)
  console.log(`${DIM}  Nodes: ${graph.nodes.size}${RESET}`)
  console.log(`${DIM}  Edges: ${graph.edges.length}${RESET}`)
  if (graph.attrs.goal) {
    console.log(`${DIM}  Goal:  ${graph.attrs.goal.slice(0, 100)}${graph.attrs.goal.length > 100 ? '...' : ''}${RESET}`)
  }
  console.log('')

  // Validate
  const diagnostics = validate(graph)

  const errors = diagnostics.filter(d => d.severity === 'error')
  const warnings = diagnostics.filter(d => d.severity === 'warning')
  const info = diagnostics.filter(d => d.severity === 'info')

  if (errors.length > 0) {
    console.log(`${BOLD}${RED}Errors (${errors.length}):${RESET}`)
    for (const d of errors) {
      console.log(`  ${RED}[${d.rule}]${RESET} ${d.message}`)
      if (d.fix) console.log(`    ${DIM}Fix: ${d.fix}${RESET}`)
    }
    console.log('')
  }

  if (warnings.length > 0) {
    console.log(`${BOLD}${YELLOW}Warnings (${warnings.length}):${RESET}`)
    for (const d of warnings) {
      console.log(`  ${YELLOW}[${d.rule}]${RESET} ${d.message}`)
      if (d.fix) console.log(`    ${DIM}Fix: ${d.fix}${RESET}`)
    }
    console.log('')
  }

  if (info.length > 0) {
    for (const d of info) {
      console.log(`  ${DIM}[${d.rule}] ${d.message}${RESET}`)
    }
    console.log('')
  }

  // Summary
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`${BOLD}${GREEN}Validation: PASSED${RESET} — no errors or warnings`)
  } else if (errors.length === 0) {
    console.log(`${BOLD}${GREEN}Validation: PASSED${RESET} ${YELLOW}(${warnings.length} warning(s))${RESET}`)
  } else {
    console.log(`${BOLD}${RED}Validation: FAILED${RESET} — ${errors.length} error(s), ${warnings.length} warning(s)`)
    process.exit(1)
  }
}

function cmdInspect(args: string[]): void {
  if (args.length === 0) {
    console.error(`${RED}Usage: attractor inspect <dotfile>${RESET}`)
    process.exit(1)
  }

  const dotFile = resolve(args[0])
  const source = readFileSync(dotFile, 'utf-8')
  const graph = parseDot(source)

  console.log(`${BOLD}${CYAN}Pipeline:${RESET} ${graph.attrs.label || graph.name}`)
  console.log('')

  console.log(`${BOLD}Nodes (${graph.nodes.size}):${RESET}`)
  for (const [id, node] of graph.nodes) {
    const handlerType = node.attrs.type || (
      node.attrs.shape in { Mdiamond: 1, Msquare: 1, hexagon: 1, diamond: 1, parallelogram: 1 }
        ? (node.attrs.shape === 'Mdiamond' ? 'start' :
           node.attrs.shape === 'Msquare' ? 'exit' :
           node.attrs.shape === 'hexagon' ? 'wait.human' :
           node.attrs.shape === 'diamond' ? 'conditional' :
           node.attrs.shape === 'parallelogram' ? 'tool' : 'codergen')
        : 'codergen'
    )
    const flags = []
    if (node.attrs.goal_gate) flags.push('goal_gate')
    if (node.attrs.class) flags.push(`class="${node.attrs.class}"`)
    if (node.attrs.llm_model) flags.push(`model=${node.attrs.llm_model}`)
    const flagStr = flags.length > 0 ? ` ${DIM}(${flags.join(', ')})${RESET}` : ''

    console.log(`  ${BOLD}${id}${RESET} [${handlerType}] "${node.attrs.label}"${flagStr}`)
  }
  console.log('')

  console.log(`${BOLD}Edges (${graph.edges.length}):${RESET}`)
  for (const edge of graph.edges) {
    const parts = []
    if (edge.attrs.label) parts.push(`label="${edge.attrs.label}"`)
    if (edge.attrs.condition) parts.push(`condition="${edge.attrs.condition}"`)
    if (edge.attrs.weight) parts.push(`weight=${edge.attrs.weight}`)
    const attrStr = parts.length > 0 ? ` ${DIM}[${parts.join(', ')}]${RESET}` : ''
    console.log(`  ${edge.from} -> ${edge.to}${attrStr}`)
  }
}

function parseRunArgs(args: string[]): { dotFile: string; resume: boolean; logsDir: string | null } {
  let dotFile = ''
  let resume = false
  let logsDir: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resume') {
      resume = true
    } else if (args[i] === '--logs-dir' && i + 1 < args.length) {
      logsDir = resolve(args[i + 1])
      i++
    } else if (!args[i].startsWith('--')) {
      dotFile = resolve(args[i])
    }
  }

  if (!dotFile) {
    console.error(`${RED}Usage: attractor run <dotfile> [--resume] [--logs-dir <dir>]${RESET}`)
    process.exit(1)
  }

  return { dotFile, resume, logsDir }
}

main().catch(err => {
  console.error(`${RED}Fatal error:${RESET}`, err)
  process.exit(1)
})
