// Tool handler — execute shell commands

import { spawn } from 'node:child_process'
import { Handler, GraphNode, Graph, ContextStore, Outcome } from '../types.js'
import { writeStagePrompt, writeStageResponse, writeStageStatus } from '../checkpoint.js'

function execAsync(
  command: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], {
      cwd: process.cwd(),
      env: process.env,
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (killed) {
        reject(new Error(`Tool timed out after ${timeoutMs}ms`))
      } else {
        resolve({ stdout, stderr, exitCode: code })
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

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
      const result = await execAsync(command, timeoutMs)

      const output = (result.stdout || '') + (result.stderr || '')
      writeStageResponse(logsRoot, node.id, output)

      if (result.exitCode !== 0) {
        const outcome: Outcome = {
          status: 'fail',
          failure_reason: `Tool exited with code ${result.exitCode}`,
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
