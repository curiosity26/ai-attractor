import { Handler, GraphNode, Graph, ContextStore, Outcome } from '../types.js'

export class ExitHandler implements Handler {
  async execute(
    _node: GraphNode,
    _context: ContextStore,
    _graph: Graph,
    _logsRoot: string,
  ): Promise<Outcome> {
    return { status: 'success' }
  }
}
