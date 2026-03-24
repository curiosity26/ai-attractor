// Core execution engine — traverses the graph, executes handlers, selects edges

import { mkdirSync } from 'node:fs'
import {
  Graph, GraphNode, GraphEdge, Outcome, RetryPolicy, BackoffConfig,
  PipelineEvent, ContextStore,
} from './types.js'
import { Context } from './context.js'
import { HandlerRegistry } from './handlers/index.js'
import { evaluateCondition } from './conditions.js'
import { applyStylesheet } from './stylesheet.js'
import {
  saveCheckpoint, loadCheckpoint, saveManifest,
} from './checkpoint.js'
import { EventEmitter } from './events.js'

export interface RunConfig {
  logsRoot: string
  resume?: boolean
  events?: EventEmitter
}

export async function runPipeline(
  graph: Graph,
  config: RunConfig,
): Promise<Outcome> {
  const startTime = Date.now()
  const runId = `run-${Date.now()}`
  const logsRoot = config.logsRoot
  const events = config.events ?? new EventEmitter()

  // Apply stylesheet transform
  applyStylesheet(graph)

  // Apply variable expansion transform
  expandGoalVariables(graph)

  // Initialize context
  const context = new Context()
  mirrorGraphAttributes(graph, context)

  // Initialize state
  let completedNodes: string[] = []
  const nodeOutcomes: Record<string, Outcome> = {}
  const nodeRetries: Record<string, number> = {}

  // Create handler registry
  const registry = new HandlerRegistry()

  // Create logs directory
  mkdirSync(logsRoot, { recursive: true })
  saveManifest(logsRoot, graph.name, graph.attrs.goal)

  // Find start node
  let currentNode = findStartNode(graph)

  // Resume from checkpoint if requested
  if (config.resume) {
    const checkpoint = loadCheckpoint(logsRoot)
    if (checkpoint) {
      completedNodes = checkpoint.completed_nodes
      context.applyUpdates(checkpoint.context)
      Object.assign(nodeOutcomes, checkpoint.node_outcomes)
      Object.assign(nodeRetries, checkpoint.node_retries)

      // Advance past the last completed node
      const lastNodeId = checkpoint.current_node
      const lastNode = graph.nodes.get(lastNodeId)
      if (lastNode) {
        // Find the next edge from the last completed node
        const lastOutcome = nodeOutcomes[lastNodeId] ?? { status: 'success' as const }
        const nextEdge = selectEdge(lastNode, lastOutcome, context, graph)
        if (nextEdge) {
          currentNode = graph.nodes.get(nextEdge.to)!
        } else {
          return {
            status: 'success',
            notes: 'Pipeline completed (no next edge after resume)',
          }
        }
      }

      events.emit({
        type: 'pipeline_started',
        name: graph.name,
        id: `${runId}-resumed`,
      })
    } else {
      events.emit({ type: 'pipeline_started', name: graph.name, id: runId })
    }
  } else {
    events.emit({ type: 'pipeline_started', name: graph.name, id: runId })
  }

  let stageIndex = completedNodes.length

  // Core execution loop
  while (true) {
    const node = currentNode

    // Step 1: Check for terminal node
    if (isTerminal(node)) {
      const [gateOk, failedGate] = checkGoalGates(graph, nodeOutcomes)
      if (!gateOk && failedGate) {
        const retryTarget = getRetryTarget(failedGate, graph)
        if (retryTarget) {
          const targetNode = graph.nodes.get(retryTarget)
          if (targetNode) {
            context.appendLog(`Goal gate unsatisfied for "${failedGate.id}", retrying from "${retryTarget}"`)
            currentNode = targetNode
            continue
          }
        }
        const outcome: Outcome = {
          status: 'fail',
          failure_reason: `Goal gate unsatisfied for node "${failedGate.id}" and no valid retry target`,
        }
        events.emit({
          type: 'pipeline_failed',
          error: outcome.failure_reason!,
          duration: Date.now() - startTime,
        })
        return outcome
      }

      const outcome: Outcome = {
        status: 'success',
        notes: 'Pipeline completed',
      }
      events.emit({ type: 'pipeline_completed', duration: Date.now() - startTime })
      return outcome
    }

    // Step 2: Execute node handler with retry policy
    stageIndex++
    events.emit({
      type: 'stage_started',
      name: node.attrs.label,
      node_id: node.id,
      index: stageIndex,
    })
    const stageStart = Date.now()

    const retryPolicy = buildRetryPolicy(node, graph)
    let outcome: Outcome

    // Special handling for parallel fan-out nodes (shape=component)
    // Execute all branches concurrently, then advance to the fan-in node
    if (node.attrs.shape === 'component') {
      outcome = await executeParallelSubgraph(node, context, graph, logsRoot, registry, events, stageIndex)
    } else {
      outcome = await executeWithRetry(node, context, graph, logsRoot, registry, retryPolicy, events, stageIndex)
    }

    events.emit({
      type: outcome.status === 'success' || outcome.status === 'partial_success'
        ? 'stage_completed'
        : 'stage_failed',
      name: node.attrs.label,
      node_id: node.id,
      index: stageIndex,
      duration: Date.now() - stageStart,
      ...(outcome.status === 'fail' ? { error: outcome.failure_reason ?? 'Unknown', will_retry: false } : {}),
    } as PipelineEvent)

    // Step 3: Record completion
    completedNodes.push(node.id)
    nodeOutcomes[node.id] = outcome

    // Step 4: Apply context updates
    if (outcome.context_updates) {
      context.applyUpdates(outcome.context_updates)
    }
    context.set('outcome', outcome.status)
    if (outcome.preferred_label) {
      context.set('preferred_label', outcome.preferred_label)
    }

    // Step 5: Save checkpoint
    saveCheckpoint(logsRoot, node.id, completedNodes, nodeRetries, nodeOutcomes, context)
    events.emit({ type: 'checkpoint_saved', node_id: node.id })

    // Step 6: Select next edge
    // For parallel subgraphs, select from the fan-in node's edges
    let edgeSourceNode = node
    const fanInNodeId = context.getString('parallel.fan_in_node', '')
    if (node.attrs.shape === 'component' && fanInNodeId) {
      const fanIn = graph.nodes.get(fanInNodeId)
      if (fanIn) {
        edgeSourceNode = fanIn
        completedNodes.push(fanIn.id)
        nodeOutcomes[fanIn.id] = outcome
      }
      // Clear the fan-in context for next parallel section
      context.set('parallel.fan_in_node', '')
    }
    const nextEdge = selectEdge(edgeSourceNode, outcome, context, graph)
    if (!nextEdge) {
      if (outcome.status === 'fail') {
        events.emit({
          type: 'pipeline_failed',
          error: outcome.failure_reason ?? 'No next edge and last outcome was FAIL',
          duration: Date.now() - startTime,
        })
        return outcome
      }
      events.emit({ type: 'pipeline_completed', duration: Date.now() - startTime })
      return { status: 'success', notes: 'Pipeline completed (no outgoing edges)' }
    }

    events.emit({
      type: 'edge_selected',
      from: node.id,
      to: nextEdge.to,
      label: nextEdge.attrs.label,
      reason: 'selected',
    })

    // Step 7: Handle loop_restart
    if (nextEdge.attrs.loop_restart) {
      // For simplicity, just restart from the target node
      currentNode = graph.nodes.get(nextEdge.to)!
      completedNodes = []
      continue
    }

    // Step 8: Advance to next node
    const nextNode = graph.nodes.get(nextEdge.to)
    if (!nextNode) {
      return {
        status: 'fail',
        failure_reason: `Edge target "${nextEdge.to}" not found in graph`,
      }
    }
    currentNode = nextNode
  }
}

// ─── Edge Selection Algorithm (Section 3.3) ───

export function selectEdge(
  node: GraphNode,
  outcome: Outcome,
  context: ContextStore,
  graph: Graph,
): GraphEdge | null {
  const edges = graph.edges.filter(e => e.from === node.id)
  if (edges.length === 0) return null

  // Step 1: Condition-matching edges
  const conditionMatched: GraphEdge[] = []
  for (const edge of edges) {
    if (edge.attrs.condition) {
      if (evaluateCondition(edge.attrs.condition, outcome, context)) {
        conditionMatched.push(edge)
      }
    }
  }
  if (conditionMatched.length > 0) {
    return bestByWeightThenLexical(conditionMatched)
  }

  // Step 2: Preferred label match
  if (outcome.preferred_label) {
    for (const edge of edges) {
      if (!edge.attrs.condition && normalizeLabel(edge.attrs.label) === normalizeLabel(outcome.preferred_label)) {
        return edge
      }
    }
  }

  // Step 3: Suggested next IDs
  if (outcome.suggested_next_ids && outcome.suggested_next_ids.length > 0) {
    for (const suggestedId of outcome.suggested_next_ids) {
      for (const edge of edges) {
        if (!edge.attrs.condition && edge.to === suggestedId) {
          return edge
        }
      }
    }
  }

  // Step 4 & 5: Unconditional edges, weight + lexical tiebreak
  const unconditional = edges.filter(e => !e.attrs.condition)
  if (unconditional.length > 0) {
    return bestByWeightThenLexical(unconditional)
  }

  return null
}

function bestByWeightThenLexical(edges: GraphEdge[]): GraphEdge {
  return edges.sort((a, b) => {
    // Higher weight first
    if (b.attrs.weight !== a.attrs.weight) return b.attrs.weight - a.attrs.weight
    // Lexical tiebreak on target node ID
    return a.to.localeCompare(b.to)
  })[0]
}

function normalizeLabel(label: string): string {
  let normalized = label.toLowerCase().trim()
  // Strip accelerator prefixes: [Y] , Y) , Y -
  normalized = normalized.replace(/^\[[^\]]+\]\s*/, '')
  normalized = normalized.replace(/^[a-z0-9]\)\s*/i, '')
  normalized = normalized.replace(/^[a-z0-9]\s+-\s*/i, '')
  return normalized
}

// ─── Retry Logic (Section 3.5) ───

async function executeWithRetry(
  node: GraphNode,
  context: ContextStore,
  graph: Graph,
  logsRoot: string,
  registry: HandlerRegistry,
  retryPolicy: RetryPolicy,
  events: EventEmitter,
  stageIndex: number,
): Promise<Outcome> {
  const handler = registry.resolve(node)

  for (let attempt = 1; attempt <= retryPolicy.max_attempts; attempt++) {
    try {
      const outcome = await handler.execute(node, context, graph, logsRoot)

      if (outcome.status === 'success' || outcome.status === 'partial_success') {
        return outcome
      }

      if (outcome.status === 'retry') {
        if (attempt < retryPolicy.max_attempts) {
          const delay = delayForAttempt(attempt, retryPolicy.backoff)
          events.emit({
            type: 'stage_retrying',
            name: node.attrs.label,
            node_id: node.id,
            index: stageIndex,
            attempt,
            delay,
          })
          await sleep(delay)
          continue
        } else {
          if (node.attrs.allow_partial) {
            return { status: 'partial_success', notes: 'Retries exhausted, partial accepted' }
          }
          return { status: 'fail', failure_reason: 'Max retries exceeded' }
        }
      }

      if (outcome.status === 'fail') {
        // Check if we should retry
        if (attempt < retryPolicy.max_attempts) {
          const delay = delayForAttempt(attempt, retryPolicy.backoff)
          events.emit({
            type: 'stage_retrying',
            name: node.attrs.label,
            node_id: node.id,
            index: stageIndex,
            attempt,
            delay,
          })
          await sleep(delay)
          continue
        }
        return outcome
      }

      // SKIPPED or unknown — just return
      return outcome

    } catch (err) {
      if (attempt < retryPolicy.max_attempts) {
        const delay = delayForAttempt(attempt, retryPolicy.backoff)
        events.emit({
          type: 'stage_retrying',
          name: node.attrs.label,
          node_id: node.id,
          index: stageIndex,
          attempt,
          delay,
        })
        await sleep(delay)
        continue
      }
      return {
        status: 'fail',
        failure_reason: `Exception: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  return { status: 'fail', failure_reason: 'Max retries exceeded' }
}

// ─── Parallel Subgraph Execution ───
//
// For shape=component nodes, execute all outgoing branch targets concurrently,
// then find and execute the fan-in node (shape=tripleoctagon) where branches converge.

async function executeParallelSubgraph(
  fanOutNode: GraphNode,
  context: ContextStore,
  graph: Graph,
  logsRoot: string,
  registry: HandlerRegistry,
  events: EventEmitter,
  stageIndex: number,
): Promise<Outcome> {
  // 1. Find all branch targets from the fan-out node
  const branchEdges = graph.edges.filter((e) => e.from === fanOutNode.id)
  const branchNodes = branchEdges
    .map((e) => graph.nodes.get(e.to))
    .filter((n): n is GraphNode => n !== undefined)

  if (branchNodes.length === 0) {
    return { status: 'success', notes: 'Parallel fan-out with no branches' }
  }

  const maxParallel = Number(fanOutNode.attrs.max_parallel ?? 4)
  const joinPolicy = String(fanOutNode.attrs.join_policy ?? 'wait_all')

  console.log(`    \x1b[2m⑂ Parallel fan-out: ${branchNodes.length} branches\x1b[0m`)

  // 2. Execute all branches concurrently with bounded parallelism
  const results: Array<{ nodeId: string; label: string; outcome: Outcome }> = []

  for (let i = 0; i < branchNodes.length; i += maxParallel) {
    const chunk = branchNodes.slice(i, i + maxParallel)
    const chunkResults = await Promise.all(
      chunk.map(async (branchNode) => {
        const branchContext = context.clone()
        const handler = registry.resolve(branchNode)
        const branchStart = Date.now()

        events.emit({
          type: 'stage_started',
          name: branchNode.attrs.label,
          node_id: branchNode.id,
          index: stageIndex,
        })

        try {
          const branchOutcome = await handler.execute(branchNode, branchContext, graph, logsRoot)

          events.emit({
            type: 'stage_completed',
            name: branchNode.attrs.label,
            node_id: branchNode.id,
            index: stageIndex,
            duration: Date.now() - branchStart,
          })

          return {
            nodeId: branchNode.id,
            label: branchNode.attrs.label,
            outcome: branchOutcome,
          }
        } catch (err) {
          const failOutcome: Outcome = {
            status: 'fail',
            failure_reason: `Branch exception: ${err instanceof Error ? err.message : String(err)}`,
          }

          events.emit({
            type: 'stage_failed',
            name: branchNode.attrs.label,
            node_id: branchNode.id,
            index: stageIndex,
            error: failOutcome.failure_reason!,
            will_retry: false,
          })

          return {
            nodeId: branchNode.id,
            label: branchNode.attrs.label,
            outcome: failOutcome,
          }
        }
      }),
    )
    results.push(...chunkResults)
  }

  // 3. Store results in context for fan-in
  context.set(
    'parallel.results',
    JSON.stringify(
      results.map((r) => ({
        nodeId: r.nodeId,
        label: r.label,
        status: r.outcome.status,
        notes: r.outcome.notes,
        failure_reason: r.outcome.failure_reason,
        response: r.outcome.context_updates?.last_response ?? '',
      })),
    ),
  )

  // 4. Find the fan-in node — where all branches converge
  // Look for a tripleoctagon node that all branch targets have edges pointing to
  const branchTargetIds = new Set(branchNodes.map((n) => n.id))
  let fanInNode: GraphNode | undefined

  for (const [, candidateNode] of graph.nodes) {
    if (candidateNode.attrs.shape === 'tripleoctagon') {
      // Check if ALL branches have an edge to this node
      const incomingFromBranches = graph.edges.filter(
        (e) => branchTargetIds.has(e.from) && e.to === candidateNode.id,
      )
      if (incomingFromBranches.length === branchNodes.length) {
        fanInNode = candidateNode
        break
      }
    }
  }

  // 5. Execute fan-in node if found
  if (fanInNode) {
    console.log(`    \x1b[2m⑂ Fan-in: ${fanInNode.attrs.label}\x1b[0m`)

    events.emit({
      type: 'stage_started',
      name: fanInNode.attrs.label,
      node_id: fanInNode.id,
      index: stageIndex,
    })

    const fanInHandler = registry.resolve(fanInNode)
    const fanInOutcome = await fanInHandler.execute(fanInNode, context, graph, logsRoot)

    events.emit({
      type: 'stage_completed',
      name: fanInNode.attrs.label,
      node_id: fanInNode.id,
      index: stageIndex,
      duration: 0,
    })

    // The engine should advance from the fan-in node's outgoing edges
    // Store fan-in node ID so selectEdge can be called on it
    context.set('parallel.fan_in_node', fanInNode.id)

    return fanInOutcome
  }

  // 6. No fan-in node — evaluate join policy directly
  const successCount = results.filter(
    (r) => r.outcome.status === 'success' || r.outcome.status === 'partial_success',
  ).length
  const failCount = results.filter((r) => r.outcome.status === 'fail').length

  if (joinPolicy === 'first_success') {
    return successCount > 0
      ? { status: 'success', notes: `${successCount}/${results.length} branches succeeded` }
      : { status: 'fail', failure_reason: `All ${results.length} branches failed` }
  }

  // wait_all
  if (failCount === 0) {
    return { status: 'success', notes: `All ${results.length} branches succeeded` }
  } else if (successCount > 0) {
    return { status: 'partial_success', notes: `${successCount}/${results.length} succeeded` }
  }
  return { status: 'fail', failure_reason: `All ${results.length} branches failed` }
}

function buildRetryPolicy(node: GraphNode, graph: Graph): RetryPolicy {
  let maxRetries = node.attrs.max_retries
  if (maxRetries === undefined || maxRetries === null || isNaN(maxRetries)) {
    maxRetries = graph.attrs.default_max_retries
  }
  const maxAttempts = Math.max(1, (maxRetries ?? 0) + 1)

  return {
    max_attempts: maxAttempts,
    backoff: {
      initial_delay_ms: 200,
      backoff_factor: 2.0,
      max_delay_ms: 60000,
      jitter: true,
    },
  }
}

function delayForAttempt(attempt: number, config: BackoffConfig): number {
  let delay = config.initial_delay_ms * Math.pow(config.backoff_factor, attempt - 1)
  delay = Math.min(delay, config.max_delay_ms)
  if (config.jitter) {
    delay = delay * (0.5 + Math.random())
  }
  return Math.round(delay)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Goal Gate Enforcement (Section 3.4) ───

function checkGoalGates(
  graph: Graph,
  nodeOutcomes: Record<string, Outcome>,
): [boolean, GraphNode | null] {
  for (const [nodeId, outcome] of Object.entries(nodeOutcomes)) {
    const node = graph.nodes.get(nodeId)
    if (!node) continue
    if (node.attrs.goal_gate) {
      if (outcome.status !== 'success' && outcome.status !== 'partial_success') {
        return [false, node]
      }
    }
  }
  return [true, null]
}

function getRetryTarget(node: GraphNode, graph: Graph): string | null {
  if (node.attrs.retry_target) return node.attrs.retry_target
  if (node.attrs.fallback_retry_target) return node.attrs.fallback_retry_target
  if (graph.attrs.retry_target) return graph.attrs.retry_target
  if (graph.attrs.fallback_retry_target) return graph.attrs.fallback_retry_target
  return null
}

// ─── Helpers ───

function findStartNode(graph: Graph): GraphNode {
  // 1. By shape=Mdiamond
  for (const [, node] of graph.nodes) {
    if (node.attrs.shape === 'Mdiamond') return node
  }
  // 2. By id
  for (const id of ['start', 'Start']) {
    const node = graph.nodes.get(id)
    if (node) return node
  }
  throw new Error('No start node found. Add a node with shape=Mdiamond.')
}

function isTerminal(node: GraphNode): boolean {
  return node.attrs.shape === 'Msquare' || node.id === 'exit' || node.id === 'end'
}

function mirrorGraphAttributes(graph: Graph, context: Context): void {
  context.set('graph.goal', graph.attrs.goal)
  context.set('graph.label', graph.attrs.label)
  context.set('graph.name', graph.name)
}

function expandGoalVariables(graph: Graph): void {
  for (const [, node] of graph.nodes) {
    if (node.attrs.prompt && node.attrs.prompt.includes('$goal')) {
      node.attrs.prompt = node.attrs.prompt.replace(/\$goal/g, graph.attrs.goal)
    }
  }
}
