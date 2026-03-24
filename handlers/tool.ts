// Tool handler — execute shell commands

import { spawnSync } from 'node:child_process'
import { Handler, GraphNode, Graph, ContextStore, Outcome } from '../types.js'
import { writeStagePrompt, writeStageResponse, writeStageStatus } from '../checkpoint.js'

export class ToolHandler implements Handler {
  async execute(
    node: GraphNode,
    _context: ContextStore,
    _graph: Graph,
    logsRoot: string,
  ): Promise<Outcome> {
    const command = (node.attrs as Record<string, unknown>)['tool_command'] as string | undefined
    if (!command) {
      const outcome: Outcome = {
        status: 'fail',
        failure_reason: 'No tool_command specified',
      }
      writeStageStatus(logsRoot, node.id, outcome)
      return outcome
    }

    writeStagePrompt(logsRoot, node.id, `Tool command: ${command}`)

    const timeoutMs = node.attrs.timeout ?? 5 * 60 * 1000 // 5 min default

    try {
      const result = spawnSync('sh', ['-c', command], {
        cwd: process.cwd(),
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      })

      const output = (result.stdout || '') + (result.stderr || '')
      writeStageResponse(logsRoot, node.id, output)

      if (result.status !== 0) {
        const outcome: Outcome = {
          status: 'fail',
          failure_reason: `Tool exited with code ${result.status}`,
          context_updates: { 'tool.output': output },
        }
        writeStageStatus(logsRoot, node.id, outcome)
        return outcome
      }

      const outcome: Outcome = {
        status: 'success',
        context_updates: { 'tool.output': result.stdout || '' },
        notes: `Tool completed: ${command}`,
      }
      writeStageStatus(logsRoot, node.id, outcome)
      return outcome

    } catch (err) {
      const outcome: Outcome = {
        status: 'fail',
        failure_reason: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
      }
      writeStageStatus(logsRoot, node.id, outcome)
      return outcome
    }
  }
}
