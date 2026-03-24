// Checkpoint save/resume for crash recovery

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { CheckpointData, Outcome, ContextStore } from './types.js'

export function saveCheckpoint(
  logsRoot: string,
  currentNode: string,
  completedNodes: string[],
  nodeRetries: Record<string, number>,
  nodeOutcomes: Record<string, Outcome>,
  context: ContextStore,
): void {
  mkdirSync(logsRoot, { recursive: true })

  const checkpoint: CheckpointData = {
    timestamp: new Date().toISOString(),
    current_node: currentNode,
    completed_nodes: [...completedNodes],
    node_retries: { ...nodeRetries },
    node_outcomes: { ...nodeOutcomes },
    context: context.snapshot(),
    logs: context.getLogs(),
  }

  const path = join(logsRoot, 'checkpoint.json')
  writeFileSync(path, JSON.stringify(checkpoint, null, 2), 'utf-8')
}

export function loadCheckpoint(logsRoot: string): CheckpointData | null {
  const path = join(logsRoot, 'checkpoint.json')
  if (!existsSync(path)) return null

  try {
    const data = readFileSync(path, 'utf-8')
    return JSON.parse(data) as CheckpointData
  } catch {
    return null
  }
}

export function saveManifest(
  logsRoot: string,
  name: string,
  goal: string,
): void {
  mkdirSync(logsRoot, { recursive: true })

  const manifest = {
    name,
    goal,
    started_at: new Date().toISOString(),
  }

  const path = join(logsRoot, 'manifest.json')
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf-8')
}

export function writeStageStatus(
  logsRoot: string,
  nodeId: string,
  outcome: Outcome,
): void {
  const stageDir = join(logsRoot, nodeId)
  mkdirSync(stageDir, { recursive: true })

  const status = {
    outcome: outcome.status,
    preferred_label: outcome.preferred_label ?? '',
    suggested_next_ids: outcome.suggested_next_ids ?? [],
    context_updates: outcome.context_updates ?? {},
    notes: outcome.notes ?? '',
    failure_reason: outcome.failure_reason ?? '',
  }

  writeFileSync(join(stageDir, 'status.json'), JSON.stringify(status, null, 2), 'utf-8')
}

export function writeStagePrompt(logsRoot: string, nodeId: string, prompt: string): void {
  const stageDir = join(logsRoot, nodeId)
  mkdirSync(stageDir, { recursive: true })
  writeFileSync(join(stageDir, 'prompt.md'), prompt, 'utf-8')
}

export function writeStageResponse(logsRoot: string, nodeId: string, response: string): void {
  const stageDir = join(logsRoot, nodeId)
  mkdirSync(stageDir, { recursive: true })
  writeFileSync(join(stageDir, 'response.md'), response, 'utf-8')
}
