// Shared types for the Attractor pipeline runner

// ─── Stage Status ───

export type StageStatus = 'success' | 'fail' | 'partial_success' | 'retry' | 'skipped'

// ─── Outcome ───

export interface Outcome {
  status: StageStatus
  preferred_label?: string
  suggested_next_ids?: string[]
  context_updates?: Record<string, unknown>
  notes?: string
  failure_reason?: string
}

// ─── Graph Model ───

export interface GraphAttrs {
  goal: string
  label: string
  model_stylesheet: string
  default_max_retries: number
  retry_target: string
  fallback_retry_target: string
  default_fidelity: string
  [key: string]: unknown
}

export interface NodeAttrs {
  label: string
  shape: string
  type: string
  prompt: string
  max_retries?: number
  goal_gate: boolean
  retry_target: string
  fallback_retry_target: string
  fidelity: string
  thread_id: string
  class: string
  timeout?: number       // milliseconds after parsing duration
  llm_model: string
  llm_provider: string
  reasoning_effort: string
  auto_status: boolean
  allow_partial: boolean
  [key: string]: unknown
}

export interface EdgeAttrs {
  label: string
  condition: string
  weight: number
  fidelity: string
  thread_id: string
  loop_restart: boolean
  [key: string]: unknown
}

export interface GraphNode {
  id: string
  attrs: NodeAttrs
}

export interface GraphEdge {
  from: string
  to: string
  attrs: EdgeAttrs
}

export interface Graph {
  name: string
  attrs: GraphAttrs
  nodes: Map<string, GraphNode>
  edges: GraphEdge[]
}

// ─── Handler Interface ───

export interface Handler {
  execute(
    node: GraphNode,
    context: ContextStore,
    graph: Graph,
    logsRoot: string
  ): Promise<Outcome>
}

// ─── Context Store Interface ───

export interface ContextStore {
  set(key: string, value: unknown): void
  get(key: string, defaultValue?: unknown): unknown
  getString(key: string, defaultValue?: string): string
  snapshot(): Record<string, unknown>
  clone(): ContextStore
  applyUpdates(updates: Record<string, unknown>): void
  appendLog(entry: string): void
  getLogs(): string[]
}

// ─── Checkpoint ───

export interface CheckpointData {
  timestamp: string
  current_node: string
  completed_nodes: string[]
  node_retries: Record<string, number>
  node_outcomes: Record<string, Outcome>
  context: Record<string, unknown>
  logs: string[]
}

// ─── Retry Policy ───

export interface BackoffConfig {
  initial_delay_ms: number
  backoff_factor: number
  max_delay_ms: number
  jitter: boolean
}

export interface RetryPolicy {
  max_attempts: number
  backoff: BackoffConfig
}

// ─── Diagnostics ───

export type Severity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  rule: string
  severity: Severity
  message: string
  node_id?: string
  edge?: [string, string]
  fix?: string
}

// ─── Stylesheet ───

export interface StylesheetRule {
  selector: StylesheetSelector
  declarations: Record<string, string>
}

export interface StylesheetSelector {
  type: 'universal' | 'shape' | 'class' | 'id'
  value: string
  specificity: number
}

// ─── Events ───

export type PipelineEvent =
  | { type: 'pipeline_started'; name: string; id: string }
  | { type: 'pipeline_completed'; duration: number }
  | { type: 'pipeline_failed'; error: string; duration: number }
  | { type: 'stage_started'; name: string; node_id: string; index: number }
  | { type: 'stage_completed'; name: string; node_id: string; index: number; duration: number }
  | { type: 'stage_failed'; name: string; node_id: string; index: number; error: string; will_retry: boolean }
  | { type: 'stage_retrying'; name: string; node_id: string; index: number; attempt: number; delay: number }
  | { type: 'checkpoint_saved'; node_id: string }
  | { type: 'edge_selected'; from: string; to: string; label: string; reason: string }

// ─── Shape to handler type mapping ───

export const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: 'start',
  Msquare: 'exit',
  box: 'codergen',
  hexagon: 'wait.human',
  diamond: 'conditional',
  component: 'parallel',
  tripleoctagon: 'parallel.fan_in',
  parallelogram: 'tool',
  house: 'stack.manager_loop',
}

// ─── Duration parsing ───

export function parseDuration(value: string): number | undefined {
  const match = value.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) return undefined
  const num = parseInt(match[1], 10)
  switch (match[2]) {
    case 'ms': return num
    case 's': return num * 1000
    case 'm': return num * 60_000
    case 'h': return num * 3_600_000
    case 'd': return num * 86_400_000
    default: return undefined
  }
}
