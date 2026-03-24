// Codergen handler — multi-agent LLM backend
// Supports: Claude (anthropic), Codex (openai), Gemini (google/gemini)
// Resolves the correct CLI from the node's llm_provider attribute or model stylesheet.

import { spawnSync } from 'node:child_process'
import { Handler, GraphNode, Graph, ContextStore, Outcome } from '../types.js'
import { writeStagePrompt, writeStageResponse, writeStageStatus } from '../checkpoint.js'

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

// Provider defaults — model used when llm_model is unset for that provider
const PROVIDER_DEFAULTS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.4',
  gemini: 'gemini-3.1-pro-preview-customtools',
}

// Auto-detect provider from model name
function detectProvider(model: string): string {
  if (model.startsWith('claude-') || model.startsWith('opus') || model.startsWith('sonnet') || model.startsWith('haiku')) {
    return 'anthropic'
  }
  if (model.startsWith('gpt-') || model.startsWith('o') || model.includes('codex')) {
    return 'openai'
  }
  if (model.startsWith('gemini-')) {
    return 'gemini'
  }
  // Default to anthropic
  return 'anthropic'
}

// Build CLI command + args for each provider
function buildCliCommand(provider: string, model: string, prompt: string): { cmd: string, args: string[] } {
  switch (provider) {
    case 'openai':
      return {
        cmd: 'codex',
        args: [
          'exec',
          '--dangerously-bypass-approvals-and-sandbox',
          '-m', model,
          prompt,
        ],
      }

    case 'gemini':
      return {
        cmd: 'gemini',
        args: [
          '--yolo',
          '-m', model,
          '-p', prompt,
        ],
      }

    case 'anthropic':
    default:
      return {
        cmd: 'claude',
        args: [
          '--dangerously-skip-permissions',
          '--model', model,
          '-p',
          prompt,
        ],
      }
  }
}

export class CodergenHandler implements Handler {
  async execute(
    node: GraphNode,
    context: ContextStore,
    graph: Graph,
    logsRoot: string,
  ): Promise<Outcome> {
    // 1. Build prompt
    let prompt = node.attrs.prompt || node.attrs.label
    prompt = expandVariables(prompt, graph, context)

    // 2. Write prompt to logs
    writeStagePrompt(logsRoot, node.id, prompt)

    // 3. Resolve provider and model
    const model = node.attrs.llm_model || ''
    const explicitProvider = node.attrs.llm_provider || ''
    const provider = explicitProvider || (model ? detectProvider(model) : 'anthropic')
    const resolvedModel = model || PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.anthropic

    // 4. Resolve timeout
    const timeoutMs = node.attrs.timeout ?? DEFAULT_TIMEOUT_MS

    // 5. Build and execute CLI command
    const { cmd, args } = buildCliCommand(provider, resolvedModel, prompt)
    const displayName = `${provider}/${resolvedModel}`

    try {
      console.log(`    \x1b[2m→ ${displayName} via ${cmd}\x1b[0m`)

      const result = spawnSync(cmd, args, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      })

      if (result.error) {
        const outcome: Outcome = {
          status: 'fail',
          failure_reason: `${displayName} CLI error: ${result.error.message}`,
        }
        writeStageStatus(logsRoot, node.id, outcome)
        return outcome
      }

      if (result.status !== 0) {
        const stderr = result.stderr?.trim() || 'Unknown error'
        const outcome: Outcome = {
          status: 'fail',
          failure_reason: `${displayName} CLI exited with code ${result.status}: ${stderr}`,
        }
        writeStageResponse(logsRoot, node.id, result.stdout || '')
        writeStageStatus(logsRoot, node.id, outcome)
        return outcome
      }

      const responseText = result.stdout || ''

      // 6. Write response to logs
      writeStageResponse(logsRoot, node.id, responseText)

      // 7. Extract context directives from response
      // LLMs can set context variables by including lines like:
      //   CONTEXT_SET: key=value
      const contextUpdates: Record<string, unknown> = {
        last_stage: node.id,
        last_response: responseText.slice(0, 200),
        last_provider: provider,
        last_model: resolvedModel,
      }
      const contextPattern = /^CONTEXT_SET:\s*(\S+?)=(.*)$/gm
      let match: RegExpExecArray | null
      while ((match = contextPattern.exec(responseText)) !== null) {
        const key = match[1]
        const value = match[2].trim()
        contextUpdates[key] = value
      }

      // 8. Return outcome
      const outcome: Outcome = {
        status: 'success',
        notes: `Stage completed: ${node.id} (${displayName})`,
        context_updates: contextUpdates,
      }
      writeStageStatus(logsRoot, node.id, outcome)
      return outcome

    } catch (err) {
      const outcome: Outcome = {
        status: 'fail',
        failure_reason: `Exception calling ${displayName}: ${err instanceof Error ? err.message : String(err)}`,
      }
      writeStageStatus(logsRoot, node.id, outcome)
      return outcome
    }
  }
}

function expandVariables(prompt: string, graph: Graph, context: ContextStore): string {
  let expanded = prompt.replace(/\$goal/g, graph.attrs.goal)
  // Replace $context.key references with context values
  expanded = expanded.replace(/\$context\.(\w+)/g, (_match, key: string) => {
    const value = context.get(key)
    return value !== undefined && value !== null ? String(value) : ''
  })
  return expanded
}
