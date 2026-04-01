// Parallel fan-in handler — consolidates parallel branch results
//
// shape=tripleoctagon → type=parallel.fan_in
//
// Reads parallel.results from context (set by the upstream ParallelHandler),
// selects the best result, and stores it in context for downstream nodes.
//
// If the node has a prompt, it executes as a codergen node with the parallel
// results injected into the prompt. This allows an LLM to consolidate/merge
// the branch outputs.

import { Handler, GraphNode, Graph, ContextStore, Outcome } from '../types.js'
import { writeStagePrompt, writeStageResponse, writeStageStatus } from '../checkpoint.js'

export class FanInHandler implements Handler {
  private codergenHandler: Handler | null = null

  /**
   * Set the codergen handler for LLM-based consolidation.
   * If the fan-in node has a prompt, it delegates to codergen after injecting results.
   */
  setCodergenHandler(handler: Handler): void {
    this.codergenHandler = handler
  }

  async execute(
    node: GraphNode,
    context: ContextStore,
    graph: Graph,
    logsRoot: string,
  ): Promise<Outcome> {
    // 1. Retrieve parallel results from context
    const rawResults = context.getString('parallel.results', '[]')
    let results: Array<{
      nodeId: string
      status: string
      notes?: string
      failure_reason?: string
    }>

    try {
      results = JSON.parse(rawResults)
    } catch {
      results = []
    }

    if (results.length === 0) {
      writeStagePrompt(logsRoot, node.id, 'Fan-in: no parallel results found')
      const outcome: Outcome = {
        status: 'success',
        notes: 'Fan-in with no parallel results — pass-through',
      }
      writeStageStatus(logsRoot, node.id, outcome)
      return outcome
    }

    // 2. If the node has a prompt, delegate to codergen with results injected
    if (node.attrs.prompt && this.codergenHandler) {
      // Inject parallel results into the prompt
      const resultsSection = results
        .map((r) => {
          const detail = r.notes || r.failure_reason || 'No details'
          return `### Branch: ${r.nodeId}\n**Status:** ${r.status}\n**Details:** ${detail}`
        })
        .join('\n\n')

      const originalPrompt = node.attrs.prompt
      node.attrs.prompt = `${originalPrompt}\n\n## Parallel Branch Results\n\n${resultsSection}`

      const outcome = await this.codergenHandler.execute(node, context, graph, logsRoot)

      // Restore original prompt (in case of retry)
      node.attrs.prompt = originalPrompt

      return outcome
    }

    // 3. Without a prompt, select the best result automatically
    writeStagePrompt(
      logsRoot,
      node.id,
      `Fan-in: consolidating ${results.length} branch results`,
    )

    // Find the best candidate (prefer success, then partial_success)
    const sorted = [...results].sort((a, b) => {
      const priority: Record<string, number> = {
        success: 3,
        partial_success: 2,
        fail: 1,
      }
      return (priority[b.status] ?? 0) - (priority[a.status] ?? 0)
    })

    const best = sorted[0]
    const successCount = results.filter(
      (r) => r.status === 'success' || r.status === 'partial_success',
    ).length

    // 4. Record winner in context
    const contextUpdates: Record<string, unknown> = {
      'parallel.fan_in.best_id': best.nodeId,
      'parallel.fan_in.best_status': best.status,
      'parallel.fan_in.total_branches': results.length,
      'parallel.fan_in.success_count': successCount,
    }

    const summary = results
      .map((r) => `  ${r.nodeId}: ${r.status}`)
      .join('\n')

    writeStageResponse(logsRoot, node.id, `Fan-in results:\n${summary}\nBest: ${best.nodeId}`)

    const allSucceeded = successCount === results.length

    // Aggregate failure context from failed branches for downstream retry nodes
    if (!allSucceeded) {
      const failedBranches = results.filter((r) => r.status !== 'success' && r.status !== 'partial_success')
      const failureDetails = failedBranches
        .map((r) => {
          const branchResponse = context.getString(`response.${r.nodeId}`, '')
          const detail = branchResponse || r.notes || r.failure_reason || 'No details available'
          return `### ${r.nodeId} (${r.status}):\n${detail}`
        })
        .join('\n\n')
      contextUpdates['failure_context'] = failureDetails.slice(0, 64000)
    }

    const outcome: Outcome = {
      status: allSucceeded ? 'success' : 'fail',
      notes: `Fan-in: ${successCount}/${results.length} branches succeeded. Best: ${best.nodeId}`,
      context_updates: contextUpdates,
      failure_reason: !allSucceeded ? `${results.length - successCount} of ${results.length} branches failed` : undefined,
    }

    writeStageStatus(logsRoot, node.id, outcome)
    return outcome
  }
}
