// Parallel handler — concurrent fan-out execution
//
// shape=component → type=parallel
//
// Executes all outgoing edges' target nodes concurrently. Each branch
// receives an isolated clone of the parent context. Branch context
// changes are NOT merged back — only the handler's outcome and
// context_updates are applied.
//
// Node attributes:
//   join_policy: "wait_all" (default) | "first_success"
//   max_parallel: number (default 4)

import { Handler, GraphNode, Graph, ContextStore, Outcome } from '../types.js'
import { writeStagePrompt, writeStageResponse, writeStageStatus } from '../checkpoint.js'

export class ParallelHandler implements Handler {
  private registry: { resolve: (node: GraphNode) => Handler } | null = null

  /**
   * Set the handler registry so parallel branches can resolve their own handlers.
   * Called by the HandlerRegistry after construction.
   */
  setRegistry(registry: { resolve: (node: GraphNode) => Handler }): void {
    this.registry = registry
  }

  async execute(
    node: GraphNode,
    context: ContextStore,
    graph: Graph,
    logsRoot: string,
  ): Promise<Outcome> {
    if (!this.registry) {
      return {
        status: 'fail',
        failure_reason: 'ParallelHandler: no registry set — cannot resolve branch handlers',
      }
    }

    // 1. Identify fan-out edges (all outgoing edges from this node)
    const branches = graph.edges.filter((e) => e.from === node.id)

    if (branches.length === 0) {
      return {
        status: 'success',
        notes: 'Parallel node with no outgoing edges — nothing to fan out',
      }
    }

    writeStagePrompt(logsRoot, node.id, `Parallel fan-out: ${branches.length} branches`)

    // 2. Determine join policy
    const joinPolicy = String(node.attrs.join_policy ?? 'wait_all')
    const maxParallel = Number(node.attrs.max_parallel ?? 4)

    // 3. Execute branches concurrently with bounded parallelism
    const branchNodes = branches
      .map((edge) => graph.nodes.get(edge.to))
      .filter((n): n is GraphNode => n !== undefined)

    const results: Array<{ nodeId: string; outcome: Outcome }> = []

    // Bounded concurrency via chunking
    for (let i = 0; i < branchNodes.length; i += maxParallel) {
      const chunk = branchNodes.slice(i, i + maxParallel)
      const chunkResults = await Promise.all(
        chunk.map(async (branchNode) => {
          const branchContext = context.clone()
          const handler = this.registry!.resolve(branchNode)
          try {
            const outcome = await handler.execute(
              branchNode,
              branchContext,
              graph,
              logsRoot,
            )
            return { nodeId: branchNode.id, outcome }
          } catch (err) {
            return {
              nodeId: branchNode.id,
              outcome: {
                status: 'fail' as const,
                failure_reason: `Branch exception: ${err instanceof Error ? err.message : String(err)}`,
              },
            }
          }
        }),
      )
      results.push(...chunkResults)
    }

    // 4. Store results in context for downstream fan-in
    context.set(
      'parallel.results',
      JSON.stringify(
        results.map((r) => ({
          nodeId: r.nodeId,
          status: r.outcome.status,
          notes: r.outcome.notes,
          failure_reason: r.outcome.failure_reason,
        })),
      ),
    )

    // 5. Evaluate join policy
    const successCount = results.filter(
      (r) => r.outcome.status === 'success' || r.outcome.status === 'partial_success',
    ).length
    const failCount = results.filter(
      (r) => r.outcome.status === 'fail',
    ).length

    const summary = results
      .map((r) => `  ${r.nodeId}: ${r.outcome.status}`)
      .join('\n')

    writeStageResponse(logsRoot, node.id, `Parallel results:\n${summary}`)

    let outcome: Outcome

    if (joinPolicy === 'first_success') {
      outcome = successCount > 0
        ? { status: 'success', notes: `${successCount}/${results.length} branches succeeded` }
        : { status: 'fail', failure_reason: `All ${results.length} branches failed` }
    } else {
      // wait_all (default)
      if (failCount === 0) {
        outcome = { status: 'success', notes: `All ${results.length} branches succeeded` }
      } else if (successCount > 0) {
        outcome = {
          status: 'partial_success',
          notes: `${successCount}/${results.length} succeeded, ${failCount} failed`,
        }
      } else {
        outcome = { status: 'fail', failure_reason: `All ${results.length} branches failed` }
      }
    }

    writeStageStatus(logsRoot, node.id, outcome)
    return outcome
  }
}
