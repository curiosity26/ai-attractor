import { Handler, GraphNode, Graph, ContextStore, Outcome } from '../types.js'

export class ConditionalHandler implements Handler {
  async execute(
    node: GraphNode,
    _context: ContextStore,
    _graph: Graph,
    _logsRoot: string,
  ): Promise<Outcome> {
    return {
      status: 'success',
      notes: `Conditional node evaluated: ${node.id}`,
    }
  }
}
