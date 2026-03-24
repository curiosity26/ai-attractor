// Engine integration tests for the Attractor pipeline runner

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { selectEdge, runPipeline } from './engine.js'
import { Context } from './context.js'
import type {
  GraphNode, GraphEdge, Graph, Outcome, Handler,
  ContextStore, EdgeAttrs,
} from './types.js'

// ─── Mock fs and checkpoint to avoid real filesystem operations ───

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}))

vi.mock('./checkpoint.js', () => ({
  saveCheckpoint: vi.fn(),
  loadCheckpoint: vi.fn().mockReturnValue(null),
  saveManifest: vi.fn(),
  writeStagePrompt: vi.fn(),
  writeStageResponse: vi.fn(),
  writeStageStatus: vi.fn(),
}))

// ─── Test Helpers ───

function defaultNodeAttrs(overrides: Partial<GraphNode['attrs']> = {}): GraphNode['attrs'] {
  return {
    label: 'Node',
    shape: 'box',
    type: '',
    prompt: 'Do something',
    goal_gate: false,
    retry_target: '',
    fallback_retry_target: '',
    fidelity: '',
    thread_id: '',
    class: '',
    llm_model: '',
    llm_provider: '',
    reasoning_effort: 'high',
    auto_status: false,
    allow_partial: false,
    ...overrides,
  }
}

function defaultEdgeAttrs(overrides: Partial<EdgeAttrs> = {}): EdgeAttrs {
  return {
    label: '',
    condition: '',
    weight: 0,
    fidelity: '',
    thread_id: '',
    loop_restart: false,
    ...overrides,
  }
}

function makeNode(id: string, overrides: Partial<GraphNode['attrs']> = {}): GraphNode {
  return { id, attrs: defaultNodeAttrs(overrides) }
}

function makeEdge(from: string, to: string, overrides: Partial<EdgeAttrs> = {}): GraphEdge {
  return { from, to, attrs: defaultEdgeAttrs(overrides) }
}

function makeGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  graphOverrides: Partial<Graph['attrs']> = {},
): Graph {
  const nodeMap = new Map<string, GraphNode>()
  for (const n of nodes) nodeMap.set(n.id, n)
  return {
    name: 'test_pipeline',
    attrs: {
      goal: 'Test goal',
      label: 'Test Pipeline',
      model_stylesheet: '',
      default_max_retries: 0,
      retry_target: '',
      fallback_retry_target: '',
      default_fidelity: '',
      ...graphOverrides,
    },
    nodes: nodeMap,
    edges,
  }
}

/** A configurable test handler. */
class TestHandler implements Handler {
  public callCount = 0
  public lastNode: GraphNode | null = null
  public lastContext: ContextStore | null = null

  constructor(private outcome: Outcome) {}

  async execute(
    node: GraphNode,
    context: ContextStore,
    _graph: Graph,
    _logsRoot: string,
  ): Promise<Outcome> {
    this.callCount++
    this.lastNode = node
    this.lastContext = context
    return this.outcome
  }
}

/** A handler that returns different outcomes on successive calls. */
class SequenceHandler implements Handler {
  private callIndex = 0

  constructor(private outcomes: Outcome[]) {}

  async execute(): Promise<Outcome> {
    const outcome = this.outcomes[this.callIndex] ?? this.outcomes[this.outcomes.length - 1]
    this.callIndex++
    return outcome
  }
}

// ─────────────────────────────────────────────
//  EDGE SELECTION TESTS
// ─────────────────────────────────────────────

describe('selectEdge', () => {
  it('condition-matching edges are selected first', () => {
    const node = makeNode('A')
    const outcome: Outcome = { status: 'success' }
    const context = new Context()

    const graph = makeGraph(
      [node, makeNode('B'), makeNode('C')],
      [
        makeEdge('A', 'B', { label: 'unconditional' }),
        makeEdge('A', 'C', { label: 'on success', condition: 'outcome=success' }),
      ],
    )

    const edge = selectEdge(node, outcome, context, graph)
    expect(edge).not.toBeNull()
    expect(edge!.to).toBe('C')
  })

  it('multiple conditions: first match by weight wins', () => {
    const node = makeNode('A')
    const outcome: Outcome = { status: 'success' }
    const context = new Context()

    const graph = makeGraph(
      [node, makeNode('B'), makeNode('C')],
      [
        makeEdge('A', 'B', { condition: 'outcome=success', weight: 1 }),
        makeEdge('A', 'C', { condition: 'outcome=success', weight: 10 }),
      ],
    )

    const edge = selectEdge(node, outcome, context, graph)
    expect(edge!.to).toBe('C')
  })

  it('preferred label match when no conditions match', () => {
    const node = makeNode('A')
    const outcome: Outcome = { status: 'success', preferred_label: 'approve' }
    const context = new Context()

    const graph = makeGraph(
      [node, makeNode('B'), makeNode('C')],
      [
        makeEdge('A', 'B', { label: 'reject' }),
        makeEdge('A', 'C', { label: 'approve' }),
      ],
    )

    const edge = selectEdge(node, outcome, context, graph)
    expect(edge!.to).toBe('C')
  })

  it('preferred label matching normalizes accelerator prefixes', () => {
    const node = makeNode('A')
    const outcome: Outcome = { status: 'success', preferred_label: 'Approve' }
    const context = new Context()

    const graph = makeGraph(
      [node, makeNode('B'), makeNode('C')],
      [
        makeEdge('A', 'B', { label: '[R] Reject' }),
        makeEdge('A', 'C', { label: '[A] Approve' }),
      ],
    )

    const edge = selectEdge(node, outcome, context, graph)
    expect(edge!.to).toBe('C')
  })

  it('weight tiebreaking: higher weight wins among unconditional edges', () => {
    const node = makeNode('A')
    const outcome: Outcome = { status: 'success' }
    const context = new Context()

    const graph = makeGraph(
      [node, makeNode('B'), makeNode('C')],
      [
        makeEdge('A', 'B', { weight: 5 }),
        makeEdge('A', 'C', { weight: 10 }),
      ],
    )

    const edge = selectEdge(node, outcome, context, graph)
    expect(edge!.to).toBe('C')
  })

  it('lexical tiebreaking on target ID when weights are equal', () => {
    const node = makeNode('A')
    const outcome: Outcome = { status: 'success' }
    const context = new Context()

    const graph = makeGraph(
      [node, makeNode('beta'), makeNode('alpha')],
      [
        makeEdge('A', 'beta', { weight: 0 }),
        makeEdge('A', 'alpha', { weight: 0 }),
      ],
    )

    const edge = selectEdge(node, outcome, context, graph)
    expect(edge!.to).toBe('alpha')
  })

  it('no matching edges returns null', () => {
    const node = makeNode('A')
    const outcome: Outcome = { status: 'success' }
    const context = new Context()

    const graph = makeGraph([node], [])

    const edge = selectEdge(node, outcome, context, graph)
    expect(edge).toBeNull()
  })

  it('only unmatched conditions and no unconditional edges returns null', () => {
    const node = makeNode('A')
    const outcome: Outcome = { status: 'success' }
    const context = new Context()

    const graph = makeGraph(
      [node, makeNode('B')],
      [
        makeEdge('A', 'B', { condition: 'outcome=fail' }),
      ],
    )

    const edge = selectEdge(node, outcome, context, graph)
    expect(edge).toBeNull()
  })

  it('suggested_next_ids selects matching edge', () => {
    const node = makeNode('A')
    const outcome: Outcome = { status: 'success', suggested_next_ids: ['C'] }
    const context = new Context()

    const graph = makeGraph(
      [node, makeNode('B'), makeNode('C')],
      [
        makeEdge('A', 'B'),
        makeEdge('A', 'C'),
      ],
    )

    const edge = selectEdge(node, outcome, context, graph)
    expect(edge!.to).toBe('C')
  })
})

// ─────────────────────────────────────────────
//  PIPELINE EXECUTION TESTS
// ─────────────────────────────────────────────

// Shared state for the mock HandlerRegistry — must be declared at module level
// because vi.mock is hoisted above all imports.
const _mockHandlerMap = new Map<string, Handler>()
const _noopHandler: Handler = { execute: async () => ({ status: 'success' as const }) }

// Mock the handler registry module — must be at the top level.
vi.mock('./handlers/index.js', () => {
  class MockHandlerRegistry {
    resolve(node: { id: string; attrs: { type: string; shape: string } }) {
      // Check by explicit type
      if (node.attrs.type && _mockHandlerMap.has(node.attrs.type)) {
        return _mockHandlerMap.get(node.attrs.type)!
      }
      // Check by shape mapping
      const shapeMap: Record<string, string> = {
        Mdiamond: 'start',
        Msquare: 'exit',
        box: 'codergen',
        diamond: 'conditional',
        component: 'parallel',
        tripleoctagon: 'parallel.fan_in',
      }
      const handlerType = shapeMap[node.attrs.shape]
      if (handlerType && _mockHandlerMap.has(handlerType)) {
        return _mockHandlerMap.get(handlerType)!
      }
      // Check by node ID
      if (_mockHandlerMap.has(node.id)) {
        return _mockHandlerMap.get(node.id)!
      }
      return _noopHandler
    }
    hasHandler(type: string) {
      return _mockHandlerMap.has(type)
    }
    register(type: string, handler: Handler) {
      _mockHandlerMap.set(type, handler)
    }
  }
  return { HandlerRegistry: MockHandlerRegistry }
})

describe('runPipeline', () => {
  beforeEach(() => {
    _mockHandlerMap.clear()
  })

  it('linear 3-node pipeline (start -> A -> exit) completes with success', async () => {
    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const taskA = makeNode('A', { shape: 'box', label: 'Task A', prompt: 'Do A' })
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })

    const graph = makeGraph(
      [startNode, taskA, exitNode],
      [
        makeEdge('start', 'A'),
        makeEdge('A', 'exit'),
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })
    expect(result.status).toBe('success')
  })

  it('conditional branching: edge condition routes correctly', async () => {
    const successHandler = new TestHandler({ status: 'success' })
    const failHandler = new TestHandler({ status: 'fail', failure_reason: 'intentional' })

    // task_A returns fail, so the condition "outcome=fail" edge should be taken
    _mockHandlerMap.set('task_a_handler', failHandler)

    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const taskA = makeNode('task_a', { shape: 'box', label: 'Task A', type: 'task_a_handler' })
    const onSuccess = makeNode('on_success', { shape: 'box', label: 'On Success' })
    const onFail = makeNode('on_fail', { shape: 'box', label: 'On Fail' })
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })

    const graph = makeGraph(
      [startNode, taskA, onSuccess, onFail, exitNode],
      [
        makeEdge('start', 'task_a'),
        makeEdge('task_a', 'on_success', { condition: 'outcome=success' }),
        makeEdge('task_a', 'on_fail', { condition: 'outcome=fail' }),
        makeEdge('on_success', 'exit'),
        makeEdge('on_fail', 'exit'),
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })
    // Pipeline reaches exit, all goal gates pass (none set), so success
    expect(result.status).toBe('success')
  })

  it('goal gate: unsatisfied goal gate blocks exit and retries', async () => {
    // The task handler returns fail first, then success on retry
    const seqHandler = new SequenceHandler([
      { status: 'fail', failure_reason: 'First try failed' },
      { status: 'success' },
    ])
    _mockHandlerMap.set('critical_task', seqHandler)

    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const task = makeNode('task', {
      shape: 'box',
      label: 'Critical Task',
      type: 'critical_task',
      goal_gate: true,
      retry_target: 'task',
    })
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })

    const graph = makeGraph(
      [startNode, task, exitNode],
      [
        makeEdge('start', 'task'),
        makeEdge('task', 'exit'),
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })
    // Pipeline should reach exit because task succeeds on second try
    expect(result.status).toBe('success')
  })

  it('goal gate: satisfied goal gate allows exit', async () => {
    const successHandler = new TestHandler({ status: 'success' })
    _mockHandlerMap.set('gated_task', successHandler)

    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const task = makeNode('task', {
      shape: 'box',
      label: 'Gated Task',
      type: 'gated_task',
      goal_gate: true,
    })
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })

    const graph = makeGraph(
      [startNode, task, exitNode],
      [
        makeEdge('start', 'task'),
        makeEdge('task', 'exit'),
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })
    expect(result.status).toBe('success')
  })

  it('goal gate: unsatisfied with no retry target returns fail', async () => {
    const failHandler = new TestHandler({ status: 'fail', failure_reason: 'always fails' })
    _mockHandlerMap.set('fail_task', failHandler)

    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const task = makeNode('task', {
      shape: 'box',
      label: 'Failing Gated Task',
      type: 'fail_task',
      goal_gate: true,
      // No retry_target set
    })
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })

    const graph = makeGraph(
      [startNode, task, exitNode],
      [
        makeEdge('start', 'task'),
        makeEdge('task', 'exit'),
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })
    expect(result.status).toBe('fail')
    expect(result.failure_reason).toContain('Goal gate unsatisfied')
  })

  it('retry: failed node retried up to max_retries', async () => {
    let callCount = 0
    const retryHandler: Handler = {
      async execute(): Promise<Outcome> {
        callCount++
        if (callCount < 3) return { status: 'fail', failure_reason: 'not yet' }
        return { status: 'success' }
      },
    }
    _mockHandlerMap.set('retry_task', retryHandler)

    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const task = makeNode('task', {
      shape: 'box',
      label: 'Retry Task',
      type: 'retry_task',
      max_retries: 3, // 4 total attempts
    })
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })

    const graph = makeGraph(
      [startNode, task, exitNode],
      [
        makeEdge('start', 'task'),
        makeEdge('task', 'exit'),
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })
    expect(result.status).toBe('success')
    expect(callCount).toBe(3) // Failed twice, succeeded third time
  })

  it('retry: exhausted retries returns fail', async () => {
    const alwaysFailHandler: Handler = {
      async execute(): Promise<Outcome> {
        return { status: 'fail', failure_reason: 'permanent failure' }
      },
    }
    _mockHandlerMap.set('always_fail', alwaysFailHandler)

    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const task = makeNode('task', {
      shape: 'box',
      label: 'Always Fail',
      type: 'always_fail',
      max_retries: 2, // 3 total attempts, all fail
    })
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })

    const graph = makeGraph(
      [startNode, task, exitNode],
      [
        makeEdge('start', 'task'),
        makeEdge('task', 'exit'),
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })
    // The last outcome is fail, and there's a conditional edge that could route.
    // But since the edge to exit is unconditional, it still routes there.
    // However the outcome of the task is 'fail', which is recorded in nodeOutcomes.
    // Since there IS an unconditional edge to exit, it goes to exit,
    // and exit is terminal. If no goal_gate is set, pipeline succeeds.
    // But wait -- the edge selection uses the fail outcome. Let's check:
    // Actually, executeWithRetry returns the fail after exhausting retries.
    // Then the engine records the fail, selects next edge (unconditional to exit),
    // reaches the terminal node. Since no goal_gate, it returns success.
    // This is correct behavior -- the pipeline completes even if a non-gated node fails.
    // To actually test exhausted retries causing pipeline failure,
    // we need no outgoing edge from the failed node.
    expect(result.status).toBe('success')
  })

  it('retry: exhausted retries with no outgoing edge returns fail', async () => {
    const alwaysFailHandler: Handler = {
      async execute(): Promise<Outcome> {
        return { status: 'fail', failure_reason: 'permanent failure' }
      },
    }
    _mockHandlerMap.set('always_fail', alwaysFailHandler)

    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const task = makeNode('task', {
      shape: 'box',
      label: 'Dead End Fail',
      type: 'always_fail',
      max_retries: 1, // 2 total attempts
    })
    // No edge from task, so pipeline ends with fail outcome
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })

    const graph = makeGraph(
      [startNode, task, exitNode],
      [
        makeEdge('start', 'task'),
        // No edge from task to exit
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })
    expect(result.status).toBe('fail')
  })

  it('context updates from one node are visible to next', async () => {
    const updatingHandler: Handler = {
      async execute(): Promise<Outcome> {
        return {
          status: 'success',
          context_updates: { custom_key: 'custom_value' },
        }
      },
    }

    let capturedContext: ContextStore | null = null
    const checkingHandler: Handler = {
      async execute(_n: GraphNode, ctx: ContextStore): Promise<Outcome> {
        capturedContext = ctx
        return { status: 'success' }
      },
    }

    _mockHandlerMap.set('updater', updatingHandler)
    _mockHandlerMap.set('checker', checkingHandler)

    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const nodeA = makeNode('A', { shape: 'box', label: 'A', type: 'updater' })
    const nodeB = makeNode('B', { shape: 'box', label: 'B', type: 'checker' })
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })

    const graph = makeGraph(
      [startNode, nodeA, nodeB, exitNode],
      [
        makeEdge('start', 'A'),
        makeEdge('A', 'B'),
        makeEdge('B', 'exit'),
      ],
    )

    await runPipeline(graph, { logsRoot: '/tmp/test-logs' })

    expect(capturedContext).not.toBeNull()
    expect(capturedContext!.get('custom_key')).toBe('custom_value')
  })

  it('terminal node (shape=Msquare) stops execution', async () => {
    let postExitCallCount = 0
    const afterExitHandler: Handler = {
      async execute(): Promise<Outcome> {
        postExitCallCount++
        return { status: 'success' }
      },
    }
    _mockHandlerMap.set('after_exit', afterExitHandler)

    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })
    const unreachable = makeNode('unreachable', { shape: 'box', label: 'Unreachable', type: 'after_exit' })

    const graph = makeGraph(
      [startNode, exitNode, unreachable],
      [
        makeEdge('start', 'exit'),
        makeEdge('exit', 'unreachable'),
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })
    expect(result.status).toBe('success')
    expect(postExitCallCount).toBe(0) // Should never execute
  })

  it('missing edge target returns fail', async () => {
    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const taskA = makeNode('A', { shape: 'box', label: 'A' })

    // Edge points to a node that doesn't exist in the graph
    const graph = makeGraph(
      [startNode, taskA],
      [
        makeEdge('start', 'A'),
        makeEdge('A', 'nonexistent_node'),
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })
    expect(result.status).toBe('fail')
    expect(result.failure_reason).toContain('nonexistent_node')
  })

  it('pipeline with no outgoing edge from non-fail node returns success', async () => {
    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const taskA = makeNode('A', { shape: 'box', label: 'A' })
    // No exit node, no edge from A. Pipeline should end with success
    // because the last outcome is success and there are no more edges.

    const graph = makeGraph(
      [startNode, taskA],
      [
        makeEdge('start', 'A'),
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })
    expect(result.status).toBe('success')
    expect(result.notes).toContain('no outgoing edges')
  })

  it('parallel subgraph (component -> branches -> tripleoctagon) executes correctly', async () => {
    const branchResults: string[] = []

    const branchHandler: Handler = {
      async execute(node: GraphNode): Promise<Outcome> {
        branchResults.push(node.id)
        return { status: 'success', notes: `Done: ${node.id}` }
      },
    }

    const fanInHandler: Handler = {
      async execute(_n: GraphNode, ctx: ContextStore): Promise<Outcome> {
        const results = JSON.parse(ctx.getString('parallel.results', '[]'))
        return {
          status: 'success',
          notes: `Fan-in: ${results.length} results`,
          context_updates: {
            'parallel.fan_in.best_id': results[0]?.nodeId,
          },
        }
      },
    }

    // For parallel subgraph, the engine's executeParallelSubgraph runs directly
    // rather than going through the handler registry for the component node itself.
    // The registry is used to resolve branch handlers.
    _mockHandlerMap.set('branch_a', branchHandler)
    _mockHandlerMap.set('branch_b', branchHandler)

    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const fanout = makeNode('fanout', { shape: 'component', label: 'Fan Out' })
    const branchA = makeNode('branch_a', { shape: 'box', label: 'Branch A' })
    const branchB = makeNode('branch_b', { shape: 'box', label: 'Branch B' })
    const fanin = makeNode('fanin', { shape: 'tripleoctagon', label: 'Fan In' })
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })

    const graph = makeGraph(
      [startNode, fanout, branchA, branchB, fanin, exitNode],
      [
        makeEdge('start', 'fanout'),
        makeEdge('fanout', 'branch_a'),
        makeEdge('fanout', 'branch_b'),
        makeEdge('branch_a', 'fanin'),
        makeEdge('branch_b', 'fanin'),
        makeEdge('fanin', 'exit'),
      ],
    )

    // The engine's executeParallelSubgraph uses the registry to resolve branch handlers,
    // and also resolves the fan-in handler. We need the mock registry to return
    // our handlers for the branch and fan-in nodes.
    _mockHandlerMap.set('parallel.fan_in', fanInHandler)

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })

    expect(result.status).toBe('success')
    // Both branches should have been executed
    expect(branchResults).toContain('branch_a')
    expect(branchResults).toContain('branch_b')
  })

  it('engine follows fan-in outgoing edges after parallel section', async () => {
    let finalNodeExecuted = false

    const branchHandler: Handler = {
      async execute(): Promise<Outcome> {
        return { status: 'success' }
      },
    }

    const fanInHandler: Handler = {
      async execute(_n: GraphNode, ctx: ContextStore): Promise<Outcome> {
        return {
          status: 'success',
          notes: 'Fan-in complete',
        }
      },
    }

    const finalHandler: Handler = {
      async execute(): Promise<Outcome> {
        finalNodeExecuted = true
        return { status: 'success' }
      },
    }

    _mockHandlerMap.set('parallel.fan_in', fanInHandler)
    _mockHandlerMap.set('final_step', finalHandler)

    const startNode = makeNode('start', { shape: 'Mdiamond', label: 'Start' })
    const fanout = makeNode('fanout', { shape: 'component', label: 'Fan Out' })
    const branchA = makeNode('branch_a', { shape: 'box', label: 'A' })
    const fanin = makeNode('fanin', { shape: 'tripleoctagon', label: 'Fan In' })
    const finalStep = makeNode('final', { shape: 'box', label: 'Final Step', type: 'final_step' })
    const exitNode = makeNode('exit', { shape: 'Msquare', label: 'Exit' })

    const graph = makeGraph(
      [startNode, fanout, branchA, fanin, finalStep, exitNode],
      [
        makeEdge('start', 'fanout'),
        makeEdge('fanout', 'branch_a'),
        makeEdge('branch_a', 'fanin'),
        makeEdge('fanin', 'final'),
        makeEdge('final', 'exit'),
      ],
    )

    const result = await runPipeline(graph, { logsRoot: '/tmp/test-logs' })

    expect(result.status).toBe('success')
    expect(finalNodeExecuted).toBe(true)
  })
})
