// Codergen handler — multi-agent LLM backend
// Supports: Claude (anthropic), Codex (openai), Gemini (google/gemini)
// Resolves the correct CLI from the node's llm_provider attribute or model stylesheet.

import { spawn } from 'node:child_process'
import { Handler, GraphNode, Graph, ContextStore, Outcome } from '../types.js'
import { writeStagePrompt, writeStageResponse, writeStageStatus } from '../checkpoint.js'

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

// Provider defaults — model used when llm_model is unset for that provider
const PROVIDER_DEFAULTS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.4',
  gemini: 'gemini-3.1-pro-preview-customtools',
}

// Canonical provider aliases — normalize before any lookup
const PROVIDER_ALIASES: Record<string, string> = {
  google: 'gemini',
}

function normalizeProvider(provider: string): string {
  return PROVIDER_ALIASES[provider] || provider
}

// Auto-detect provider from model name
function detectProvider(model: string): string {
  if (model.startsWith('claude-') || model.startsWith('opus') || model.startsWith('sonnet') || model.startsWith('haiku')) {
    return 'anthropic'
  }
  if (model.startsWith('gpt-') || model.startsWith('o') || model.includes('codex')) {
    return 'openai'
  }
  if (model.startsWith('gemini-') || model.startsWith('gemini/') || model.startsWith('models/gemini-')) {
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
          '-m', model.replace(/^models\//, ''),
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

function execAsync(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: Error }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
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
        resolve({ stdout, stderr, exitCode: code, error: new Error(`Timed out after ${timeoutMs}ms`) })
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

    // 1b. Inject failure context from previous runs if this node is being retried
    const failureContext = context.getString('failure_context', '')
    if (failureContext) {
      prompt += `\n\n## FAILURE CONTEXT FROM PREVIOUS RUN\n\nThe following issues were reported by QA validators or other pipeline stages. You MUST address these issues:\n\n${failureContext}`
      // Clear after injection so it doesn't accumulate forever
      context.set('failure_context', '')
    }

    // 2. Write prompt to logs
    writeStagePrompt(logsRoot, node.id, prompt)

    // 3. Resolve provider and model
    const model = node.attrs.llm_model || ''
    const explicitProvider = normalizeProvider(node.attrs.llm_provider || '')
    const provider = explicitProvider || (model ? detectProvider(model) : 'anthropic')
    const resolvedModel = model || PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.anthropic

    // 4. Resolve timeout
    const timeoutMs = node.attrs.timeout ?? DEFAULT_TIMEOUT_MS

    // 5. Build and execute CLI command
    const { cmd, args } = buildCliCommand(provider, resolvedModel, prompt)
    const displayName = `${provider}/${resolvedModel}`

    try {
      console.log(`    \x1b[2m→ ${displayName} via ${cmd}\x1b[0m`)

      const result = await execAsync(cmd, args, timeoutMs)

      if (result.error) {
        const outcome: Outcome = {
          status: 'fail',
          failure_reason: `${displayName} CLI error: ${result.error.message}`,
        }
        writeStageStatus(logsRoot, node.id, outcome)
        return outcome
      }

      if (result.exitCode !== 0) {
        const stderr = result.stderr?.trim() || 'Unknown error'
        const outcome: Outcome = {
          status: 'fail',
          failure_reason: `${displayName} CLI exited with code ${result.exitCode}: ${stderr}`,
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
        // Store full response keyed by node ID for downstream context
        [`response.${node.id}`]: responseText.slice(0, 4000),
      }
      const contextPattern = /^CONTEXT_SET:\s*(\S+?)=(.*)$/gm
      let match: RegExpExecArray | null
      while ((match = contextPattern.exec(responseText)) !== null) {
        const key = match[1]
        const value = match[2].trim()
        contextUpdates[key] = value
      }

      // 8. Determine pass/fail from response content
      const responseUpper = responseText.toUpperCase()
      const hasExplicitFail = /\bFAIL\b/.test(responseUpper) && !/\bPASS\b/.test(responseUpper)
      const hasValidationFail = /VALIDATION[_ ]RESULTS?:\s*FAIL/i.test(responseText)
      const hasCriticalFail = /CRITICAL\s+(FAIL|ERROR)/i.test(responseText)
      const determinedFail = hasExplicitFail || hasValidationFail || hasCriticalFail

      // If this node failed, store the response as failure_context for downstream retry
      if (determinedFail) {
        contextUpdates['failure_context'] = (context.getString('failure_context', '') +
          `\n\n### ${node.id} REPORTED FAIL:\n${responseText.slice(0, 4000)}`).trim()
      }

      const outcome: Outcome = {
        status: determinedFail ? 'fail' : 'success',
        notes: determinedFail
          ? `Stage ${node.id} reported FAIL in response (${displayName})`
          : `Stage completed: ${node.id} (${displayName})`,
        context_updates: contextUpdates,
        failure_reason: determinedFail ? 'Agent reported FAIL in response text' : undefined,
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
