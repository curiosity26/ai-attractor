// Handler unit tests for the Attractor pipeline runner

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StartHandler } from './handlers/start.js'
import { ExitHandler } from './handlers/exit.js'
import { ConditionalHandler } from './handlers/conditional.js'
import { CodergenHandler } from './handlers/codergen.js'
import { ParallelHandler } from './handlers/parallel.js'
import { FanInHandler } from './handlers/fan_in.js'
import { HandlerRegistry } from './handlers/index.js'
import { Context } from './context.js'
import type { GraphNode, Graph, Outcome, Handler, ContextStore } from './types.js'

// ─── Test Helpers ───

function makeNode(overrides: Partial<GraphNode> & { id?: string } = {}): GraphNode {
  return {
    id: overrides.id ?? 'test_node',
    attrs: {
      label: 'Test Node',
      shape: 'box',
      type: '',
      prompt: '',
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
      ...overrides.attrs,
    },
  }
}

function makeGraph(overrides: Partial<Graph> = {}): Graph {
  return {
    name: 'test_graph',
    attrs: {
      goal: 'Test goal',
      label: 'Test Graph',
      model_stylesheet: '',
      default_max_retries: 0,
      retry_target: '',
      fallback_retry_target: '',
      default_fidelity: '',
    },
    nodes: overrides.nodes ?? new Map(),
    edges: overrides.edges ?? [],
  }
}

// ─── Mock checkpoint module (used by codergen, parallel, fan_in) ───

vi.mock('./checkpoint.js', () => ({
  writeStagePrompt: vi.fn(),
  writeStageResponse: vi.fn(),
  writeStageStatus: vi.fn(),
  saveCheckpoint: vi.fn(),
  loadCheckpoint: vi.fn(),
  saveManifest: vi.fn(),
}))

// ─── Mock child_process for CodergenHandler and ToolHandler ───
//
// Both handlers now use async `spawn`. We mock it to return a fake
// ChildProcess that emits events according to test-configured values.

import { EventEmitter as NodeEventEmitter } from 'node:events'

let spawnMockConfig: {
  stdout: string
  stderr: string
  exitCode: number | null
  error?: Error | null
} = { stdout: '', stderr: '', exitCode: 0, error: null }

function createMockChildProcess() {
  const child = new NodeEventEmitter() as NodeEventEmitter & {
    stdout: NodeEventEmitter
    stderr: NodeEventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new NodeEventEmitter()
  child.stderr = new NodeEventEmitter()
  child.kill = vi.fn()

  // Emit data and close on next tick so the promise resolves
  process.nextTick(() => {
    if (spawnMockConfig.error) {
      child.emit('error', spawnMockConfig.error)
    } else {
      if (spawnMockConfig.stdout) child.stdout.emit('data', Buffer.from(spawnMockConfig.stdout))
      if (spawnMockConfig.stderr) child.stderr.emit('data', Buffer.from(spawnMockConfig.stderr))
      child.emit('close', spawnMockConfig.exitCode)
    }
  })

  return child
}

const spawnMock = vi.fn(() => createMockChildProcess())

vi.mock('node:child_process', () => ({
  spawn: vi.fn((...args: unknown[]) => spawnMock(...args)),
  spawnSync: vi.fn(),
}))

// ─── Start Handler ───

describe('StartHandler', () => {
  const handler = new StartHandler()
  const context = new Context()
  const graph = makeGraph()

  it('returns outcome with status success', async () => {
    const node = makeNode({ attrs: { shape: 'Mdiamond', label: 'Start' } } as Partial<GraphNode>)
    const outcome = await handler.execute(node, context, graph, '/tmp/logs')
    expect(outcome.status).toBe('success')
  })

  it('has no side effects on context', async () => {
    const ctx = new Context()
    const snapshotBefore = ctx.snapshot()
    const node = makeNode({ attrs: { shape: 'Mdiamond', label: 'Start' } } as Partial<GraphNode>)
    await handler.execute(node, ctx, graph, '/tmp/logs')
    expect(ctx.snapshot()).toEqual(snapshotBefore)
  })
})

// ─── Exit Handler ───

describe('ExitHandler', () => {
  const handler = new ExitHandler()
  const context = new Context()
  const graph = makeGraph()

  it('returns outcome with status success', async () => {
    const node = makeNode({ attrs: { shape: 'Msquare', label: 'Exit' } } as Partial<GraphNode>)
    const outcome = await handler.execute(node, context, graph, '/tmp/logs')
    expect(outcome.status).toBe('success')
  })

  it('has no side effects on context', async () => {
    const ctx = new Context()
    const snapshotBefore = ctx.snapshot()
    const node = makeNode({ attrs: { shape: 'Msquare', label: 'Exit' } } as Partial<GraphNode>)
    await handler.execute(node, ctx, graph, '/tmp/logs')
    expect(ctx.snapshot()).toEqual(snapshotBefore)
  })
})

// ─── Conditional Handler ───

describe('ConditionalHandler', () => {
  const handler = new ConditionalHandler()
  const context = new Context()
  const graph = makeGraph()

  it('returns outcome with status success (pass-through)', async () => {
    const node = makeNode({ id: 'gate_1', attrs: { shape: 'diamond', label: 'Check' } } as Partial<GraphNode>)
    const outcome = await handler.execute(node, context, graph, '/tmp/logs')
    expect(outcome.status).toBe('success')
  })

  it('includes the node ID in notes', async () => {
    const node = makeNode({ id: 'my_conditional', attrs: { shape: 'diamond', label: 'My Gate' } } as Partial<GraphNode>)
    const outcome = await handler.execute(node, context, graph, '/tmp/logs')
    expect(outcome.notes).toContain('my_conditional')
  })
})

// ─── Codergen Handler ───

describe('CodergenHandler', () => {
  let handler: CodergenHandler

  beforeEach(async () => {
    handler = new CodergenHandler()
    spawnMock.mockClear()
    spawnMockConfig = { stdout: '', stderr: '', exitCode: 0, error: null }
  })

  it('expands $goal in prompt', async () => {
    const node = makeNode({
      id: 'plan',
      attrs: { prompt: 'Achieve $goal efficiently', label: 'Plan' } as GraphNode['attrs'],
    })
    const graph = makeGraph()
    graph.attrs.goal = 'world domination'
    const context = new Context()

    spawnMockConfig = { stdout: 'done', stderr: '', exitCode: 0 }

    await handler.execute(node, context, graph, '/tmp/logs')

    // spawn(cmd, args, ...) — second argument is the args array
    const args = spawnMock.mock.calls[0][1] as string[]
    // The prompt is the last argument for anthropic provider
    const promptArg = args[args.length - 1]
    expect(promptArg).toContain('world domination')
    expect(promptArg).not.toContain('$goal')
  })

  it('auto-detects anthropic provider from claude- model name', async () => {
    const node = makeNode({
      id: 'task',
      attrs: { prompt: 'Do thing', llm_model: 'claude-sonnet-4-6', label: 'Task' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: 'ok', stderr: '', exitCode: 0 }

    await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(spawnMock.mock.calls[0][0]).toBe('claude')
  })

  it('auto-detects openai provider from gpt- model name', async () => {
    const node = makeNode({
      id: 'task',
      attrs: { prompt: 'Do thing', llm_model: 'gpt-4o', label: 'Task' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: 'ok', stderr: '', exitCode: 0 }

    await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(spawnMock.mock.calls[0][0]).toBe('codex')
  })

  it('auto-detects gemini provider from gemini- model name', async () => {
    const node = makeNode({
      id: 'task',
      attrs: { prompt: 'Do thing', llm_model: 'gemini-3.1-pro', label: 'Task' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: 'ok', stderr: '', exitCode: 0 }

    await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(spawnMock.mock.calls[0][0]).toBe('gemini')
  })

  it('builds correct CLI command for anthropic provider', async () => {
    const node = makeNode({
      id: 'task',
      attrs: { prompt: 'Build it', llm_model: 'claude-sonnet-4-6', label: 'Task' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: 'ok', stderr: '', exitCode: 0 }

    await handler.execute(node, context, makeGraph(), '/tmp/logs')

    const [cmd, args] = spawnMock.mock.calls[0]
    expect(cmd).toBe('claude')
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).toContain('--model')
    expect(args).toContain('claude-sonnet-4-6')
    expect(args).toContain('-p')
    expect(args).toContain('Build it')
  })

  it('builds correct CLI command for openai provider', async () => {
    const node = makeNode({
      id: 'task',
      attrs: { prompt: 'Build it', llm_model: 'gpt-4o', label: 'Task' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: 'ok', stderr: '', exitCode: 0 }

    await handler.execute(node, context, makeGraph(), '/tmp/logs')

    const [cmd, args] = spawnMock.mock.calls[0]
    expect(cmd).toBe('codex')
    expect(args).toContain('exec')
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(args).toContain('-m')
    expect(args).toContain('gpt-4o')
  })

  it('normalizes google provider to gemini CLI', async () => {
    const node = makeNode({
      id: 'task',
      attrs: { prompt: 'Do thing', llm_model: 'gemini-2.5-pro', llm_provider: 'google', label: 'Task' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: 'ok', stderr: '', exitCode: 0 }

    await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(spawnMock.mock.calls[0][0]).toBe('gemini')
  })

  it('strips models/ prefix from gemini model names', async () => {
    const node = makeNode({
      id: 'task',
      attrs: { prompt: 'Do thing', llm_model: 'models/gemini-2.5-pro', label: 'Task' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: 'ok', stderr: '', exitCode: 0 }

    await handler.execute(node, context, makeGraph(), '/tmp/logs')

    const [cmd, args] = spawnMock.mock.calls[0]
    expect(cmd).toBe('gemini')
    expect(args).toContain('gemini-2.5-pro')
    expect(args).not.toContain('models/gemini-2.5-pro')
  })

  it('uses gemini default model when google provider set without model', async () => {
    const node = makeNode({
      id: 'task',
      attrs: { prompt: 'Do thing', llm_provider: 'google', label: 'Task' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: 'ok', stderr: '', exitCode: 0 }

    await handler.execute(node, context, makeGraph(), '/tmp/logs')

    const [cmd, args] = spawnMock.mock.calls[0]
    expect(cmd).toBe('gemini')
    expect(args).toContain('gemini-3.1-pro-preview-customtools')
  })

  it('builds correct CLI command for gemini provider', async () => {
    const node = makeNode({
      id: 'task',
      attrs: { prompt: 'Build it', llm_model: 'gemini-3.1-pro', label: 'Task' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: 'ok', stderr: '', exitCode: 0 }

    await handler.execute(node, context, makeGraph(), '/tmp/logs')

    const [cmd, args] = spawnMock.mock.calls[0]
    expect(cmd).toBe('gemini')
    expect(args).toContain('--yolo')
    expect(args).toContain('-m')
    expect(args).toContain('gemini-3.1-pro')
    expect(args).toContain('-p')
  })

  it('returns fail outcome when CLI exits non-zero', async () => {
    const node = makeNode({
      id: 'task',
      attrs: { prompt: 'Fail me', label: 'Task' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: '', stderr: 'Something went wrong', exitCode: 1 }

    const outcome = await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(outcome.status).toBe('fail')
    expect(outcome.failure_reason).toContain('exited with code 1')
    expect(outcome.failure_reason).toContain('Something went wrong')
  })

  it('returns success with context_updates on success', async () => {
    const node = makeNode({
      id: 'plan_step',
      attrs: { prompt: 'Plan things', label: 'Plan' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: 'Here is the plan...', stderr: '', exitCode: 0 }

    const outcome = await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(outcome.status).toBe('success')
    expect(outcome.context_updates).toBeDefined()
    expect(outcome.context_updates!.last_stage).toBe('plan_step')
    expect(outcome.context_updates!.last_response).toBe('Here is the plan...')
  })

  it('returns fail outcome when CLI has an error object', async () => {
    const node = makeNode({
      id: 'task',
      attrs: { prompt: 'Do thing', label: 'Task' } as GraphNode['attrs'],
    })
    const context = new Context()

    spawnMockConfig = { stdout: '', stderr: '', exitCode: null, error: new Error('ENOENT: command not found') }

    const outcome = await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(outcome.status).toBe('fail')
    expect(outcome.failure_reason).toContain('ENOENT')
  })
})

// ─── Parallel Handler ───

describe('ParallelHandler', () => {
  let handler: ParallelHandler

  beforeEach(() => {
    handler = new ParallelHandler()
  })

  it('fails if no registry is set', async () => {
    const node = makeNode({ id: 'fanout', attrs: { shape: 'component', label: 'Fan Out' } as GraphNode['attrs'] })
    const context = new Context()
    const graph = makeGraph()

    const outcome = await handler.execute(node, context, graph, '/tmp/logs')
    expect(outcome.status).toBe('fail')
    expect(outcome.failure_reason).toContain('no registry set')
  })

  it('executes multiple branch nodes concurrently', async () => {
    const executionOrder: string[] = []

    class TrackingHandler implements Handler {
      constructor(private nodeId: string) {}
      async execute(): Promise<Outcome> {
        executionOrder.push(this.nodeId)
        return { status: 'success', notes: `Done: ${this.nodeId}` }
      }
    }

    const branchA = makeNode({ id: 'branch_a', attrs: { shape: 'box', label: 'A' } as GraphNode['attrs'] })
    const branchB = makeNode({ id: 'branch_b', attrs: { shape: 'box', label: 'B' } as GraphNode['attrs'] })
    const fanout = makeNode({ id: 'fanout', attrs: { shape: 'component', label: 'Fan Out' } as GraphNode['attrs'] })

    const nodes = new Map<string, GraphNode>()
    nodes.set('fanout', fanout)
    nodes.set('branch_a', branchA)
    nodes.set('branch_b', branchB)

    const graph = makeGraph({
      nodes,
      edges: [
        { from: 'fanout', to: 'branch_a', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
        { from: 'fanout', to: 'branch_b', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
      ],
    })

    const mockRegistry = {
      resolve: (node: GraphNode) => new TrackingHandler(node.id),
    }
    handler.setRegistry(mockRegistry)

    const context = new Context()
    const outcome = await handler.execute(fanout, context, graph, '/tmp/logs')

    expect(outcome.status).toBe('success')
    expect(executionOrder).toContain('branch_a')
    expect(executionOrder).toContain('branch_b')
  })

  it('stores results in context as parallel.results', async () => {
    class SuccessHandler implements Handler {
      async execute(): Promise<Outcome> {
        return { status: 'success', notes: 'ok' }
      }
    }

    const fanout = makeNode({ id: 'fanout', attrs: { shape: 'component', label: 'Fan Out' } as GraphNode['attrs'] })
    const branch = makeNode({ id: 'branch_a', attrs: { shape: 'box', label: 'A' } as GraphNode['attrs'] })

    const nodes = new Map<string, GraphNode>()
    nodes.set('fanout', fanout)
    nodes.set('branch_a', branch)

    const graph = makeGraph({
      nodes,
      edges: [
        { from: 'fanout', to: 'branch_a', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
      ],
    })

    handler.setRegistry({ resolve: () => new SuccessHandler() })

    const context = new Context()
    await handler.execute(fanout, context, graph, '/tmp/logs')

    const results = JSON.parse(context.getString('parallel.results', '[]'))
    expect(results).toHaveLength(1)
    expect(results[0].nodeId).toBe('branch_a')
    expect(results[0].status).toBe('success')
  })

  it('wait_all policy: success when all branches succeed', async () => {
    class SuccessHandler implements Handler {
      async execute(): Promise<Outcome> {
        return { status: 'success' }
      }
    }

    const fanout = makeNode({ id: 'fanout', attrs: { shape: 'component', label: 'Fan Out', join_policy: 'wait_all' } as GraphNode['attrs'] })
    const branchA = makeNode({ id: 'a', attrs: { shape: 'box', label: 'A' } as GraphNode['attrs'] })
    const branchB = makeNode({ id: 'b', attrs: { shape: 'box', label: 'B' } as GraphNode['attrs'] })

    const nodes = new Map<string, GraphNode>()
    nodes.set('fanout', fanout)
    nodes.set('a', branchA)
    nodes.set('b', branchB)

    const graph = makeGraph({
      nodes,
      edges: [
        { from: 'fanout', to: 'a', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
        { from: 'fanout', to: 'b', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
      ],
    })

    handler.setRegistry({ resolve: () => new SuccessHandler() })

    const outcome = await handler.execute(fanout, new Context(), graph, '/tmp/logs')
    expect(outcome.status).toBe('success')
  })

  it('wait_all policy: partial_success when some branches fail', async () => {
    let callCount = 0

    class MixedHandler implements Handler {
      async execute(): Promise<Outcome> {
        callCount++
        if (callCount === 1) return { status: 'success' }
        return { status: 'fail', failure_reason: 'branch failed' }
      }
    }

    const fanout = makeNode({ id: 'fanout', attrs: { shape: 'component', label: 'Fan Out', join_policy: 'wait_all' } as GraphNode['attrs'] })
    const branchA = makeNode({ id: 'a', attrs: { shape: 'box', label: 'A' } as GraphNode['attrs'] })
    const branchB = makeNode({ id: 'b', attrs: { shape: 'box', label: 'B' } as GraphNode['attrs'] })

    const nodes = new Map<string, GraphNode>()
    nodes.set('fanout', fanout)
    nodes.set('a', branchA)
    nodes.set('b', branchB)

    const graph = makeGraph({
      nodes,
      edges: [
        { from: 'fanout', to: 'a', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
        { from: 'fanout', to: 'b', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
      ],
    })

    handler.setRegistry({ resolve: () => new MixedHandler() })

    const outcome = await handler.execute(fanout, new Context(), graph, '/tmp/logs')
    expect(outcome.status).toBe('partial_success')
  })

  it('wait_all policy: fail when all branches fail', async () => {
    class FailHandler implements Handler {
      async execute(): Promise<Outcome> {
        return { status: 'fail', failure_reason: 'nope' }
      }
    }

    const fanout = makeNode({ id: 'fanout', attrs: { shape: 'component', label: 'Fan Out', join_policy: 'wait_all' } as GraphNode['attrs'] })
    const branchA = makeNode({ id: 'a', attrs: { shape: 'box', label: 'A' } as GraphNode['attrs'] })
    const branchB = makeNode({ id: 'b', attrs: { shape: 'box', label: 'B' } as GraphNode['attrs'] })

    const nodes = new Map<string, GraphNode>()
    nodes.set('fanout', fanout)
    nodes.set('a', branchA)
    nodes.set('b', branchB)

    const graph = makeGraph({
      nodes,
      edges: [
        { from: 'fanout', to: 'a', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
        { from: 'fanout', to: 'b', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
      ],
    })

    handler.setRegistry({ resolve: () => new FailHandler() })

    const outcome = await handler.execute(fanout, new Context(), graph, '/tmp/logs')
    expect(outcome.status).toBe('fail')
  })

  it('first_success policy: success when any branch succeeds', async () => {
    let callIndex = 0

    class MixedHandler implements Handler {
      async execute(): Promise<Outcome> {
        callIndex++
        if (callIndex === 2) return { status: 'success' }
        return { status: 'fail', failure_reason: 'nope' }
      }
    }

    const fanout = makeNode({ id: 'fanout', attrs: { shape: 'component', label: 'Fan Out', join_policy: 'first_success' } as GraphNode['attrs'] })
    const branchA = makeNode({ id: 'a', attrs: { shape: 'box', label: 'A' } as GraphNode['attrs'] })
    const branchB = makeNode({ id: 'b', attrs: { shape: 'box', label: 'B' } as GraphNode['attrs'] })

    const nodes = new Map<string, GraphNode>()
    nodes.set('fanout', fanout)
    nodes.set('a', branchA)
    nodes.set('b', branchB)

    const graph = makeGraph({
      nodes,
      edges: [
        { from: 'fanout', to: 'a', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
        { from: 'fanout', to: 'b', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
      ],
    })

    handler.setRegistry({ resolve: () => new MixedHandler() })

    const outcome = await handler.execute(fanout, new Context(), graph, '/tmp/logs')
    expect(outcome.status).toBe('success')
  })

  it('bounded parallelism respects max_parallel', async () => {
    let concurrentCount = 0
    let maxConcurrent = 0

    class ConcurrencyTracker implements Handler {
      async execute(): Promise<Outcome> {
        concurrentCount++
        maxConcurrent = Math.max(maxConcurrent, concurrentCount)
        // Simulate async work
        await new Promise(r => setTimeout(r, 10))
        concurrentCount--
        return { status: 'success' }
      }
    }

    const fanout = makeNode({
      id: 'fanout',
      attrs: { shape: 'component', label: 'Fan Out', max_parallel: 2 } as GraphNode['attrs'],
    })

    const nodes = new Map<string, GraphNode>()
    nodes.set('fanout', fanout)
    const edges: Graph['edges'] = []

    // Create 4 branches
    for (let i = 0; i < 4; i++) {
      const branch = makeNode({ id: `b${i}`, attrs: { shape: 'box', label: `B${i}` } as GraphNode['attrs'] })
      nodes.set(`b${i}`, branch)
      edges.push({
        from: 'fanout',
        to: `b${i}`,
        attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false },
      })
    }

    const graph = makeGraph({ nodes, edges })
    handler.setRegistry({ resolve: () => new ConcurrencyTracker() })

    await handler.execute(fanout, new Context(), graph, '/tmp/logs')

    // max_parallel=2, so we should never exceed 2 concurrent
    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })

  it('branch exceptions are caught gracefully', async () => {
    class ThrowingHandler implements Handler {
      async execute(): Promise<Outcome> {
        throw new Error('Branch exploded')
      }
    }

    const fanout = makeNode({ id: 'fanout', attrs: { shape: 'component', label: 'Fan Out' } as GraphNode['attrs'] })
    const branch = makeNode({ id: 'branch_a', attrs: { shape: 'box', label: 'A' } as GraphNode['attrs'] })

    const nodes = new Map<string, GraphNode>()
    nodes.set('fanout', fanout)
    nodes.set('branch_a', branch)

    const graph = makeGraph({
      nodes,
      edges: [
        { from: 'fanout', to: 'branch_a', attrs: { label: '', condition: '', weight: 0, fidelity: '', thread_id: '', loop_restart: false } },
      ],
    })

    handler.setRegistry({ resolve: () => new ThrowingHandler() })

    // Should not throw
    const outcome = await handler.execute(fanout, new Context(), graph, '/tmp/logs')

    expect(outcome.status).toBe('fail')
    const results = JSON.parse(new Context().getString('parallel.results', '[]') || '[]')
    // The handler itself should have set parallel.results but the returned outcome
    // reflects that all branches failed
    expect(outcome.failure_reason).toContain('All 1 branches failed')
  })
})

// ─── Fan-In Handler ───

describe('FanInHandler', () => {
  let handler: FanInHandler

  beforeEach(() => {
    handler = new FanInHandler()
  })

  it('reads parallel.results from context', async () => {
    const context = new Context()
    context.set('parallel.results', JSON.stringify([
      { nodeId: 'a', status: 'success', notes: 'OK' },
    ]))

    const node = makeNode({ id: 'fan_in', attrs: { shape: 'tripleoctagon', label: 'Fan In' } as GraphNode['attrs'] })
    const outcome = await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(outcome.status).toBe('success')
    expect(outcome.notes).toContain('1/1 branches succeeded')
  })

  it('without prompt: selects best result by status priority', async () => {
    const context = new Context()
    context.set('parallel.results', JSON.stringify([
      { nodeId: 'a', status: 'fail', failure_reason: 'bad' },
      { nodeId: 'b', status: 'success', notes: 'good' },
      { nodeId: 'c', status: 'partial_success', notes: 'ok' },
    ]))

    const node = makeNode({ id: 'fan_in', attrs: { shape: 'tripleoctagon', label: 'Fan In' } as GraphNode['attrs'] })
    const outcome = await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(outcome.status).toBe('success')
    expect(outcome.context_updates!['parallel.fan_in.best_id']).toBe('b')
    expect(outcome.context_updates!['parallel.fan_in.best_status']).toBe('success')
  })

  it('with prompt: delegates to codergen handler with results injected', async () => {
    let capturedPrompt = ''

    class MockCodergen implements Handler {
      async execute(node: GraphNode, _ctx: ContextStore, _g: Graph, _lr: string): Promise<Outcome> {
        capturedPrompt = node.attrs.prompt
        return { status: 'success', notes: 'LLM consolidated' }
      }
    }

    handler.setCodergenHandler(new MockCodergen())

    const context = new Context()
    context.set('parallel.results', JSON.stringify([
      { nodeId: 'a', status: 'success', notes: 'Branch A done' },
      { nodeId: 'b', status: 'fail', failure_reason: 'Branch B failed' },
    ]))

    const node = makeNode({
      id: 'fan_in',
      attrs: { shape: 'tripleoctagon', label: 'Fan In', prompt: 'Consolidate the results' } as GraphNode['attrs'],
    })
    const outcome = await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(outcome.status).toBe('success')
    expect(capturedPrompt).toContain('Consolidate the results')
    expect(capturedPrompt).toContain('Branch: a')
    expect(capturedPrompt).toContain('Branch: b')
    // Prompt should be restored after execution (for potential retry)
    expect(node.attrs.prompt).toBe('Consolidate the results')
  })

  it('sets context updates (best_id, best_status, counts)', async () => {
    const context = new Context()
    context.set('parallel.results', JSON.stringify([
      { nodeId: 'x', status: 'success', notes: 'good' },
      { nodeId: 'y', status: 'fail', failure_reason: 'bad' },
      { nodeId: 'z', status: 'partial_success', notes: 'ok' },
    ]))

    const node = makeNode({ id: 'fan_in', attrs: { shape: 'tripleoctagon', label: 'Fan In' } as GraphNode['attrs'] })
    const outcome = await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(outcome.context_updates!['parallel.fan_in.best_id']).toBe('x')
    expect(outcome.context_updates!['parallel.fan_in.best_status']).toBe('success')
    expect(outcome.context_updates!['parallel.fan_in.total_branches']).toBe(3)
    expect(outcome.context_updates!['parallel.fan_in.success_count']).toBe(2)
  })

  it('empty results produce pass-through success', async () => {
    const context = new Context()
    // No parallel.results set at all
    const node = makeNode({ id: 'fan_in', attrs: { shape: 'tripleoctagon', label: 'Fan In' } as GraphNode['attrs'] })
    const outcome = await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(outcome.status).toBe('success')
    expect(outcome.notes).toContain('pass-through')
  })

  it('all failures produce fail outcome', async () => {
    const context = new Context()
    context.set('parallel.results', JSON.stringify([
      { nodeId: 'a', status: 'fail', failure_reason: 'bad1' },
      { nodeId: 'b', status: 'fail', failure_reason: 'bad2' },
    ]))

    const node = makeNode({ id: 'fan_in', attrs: { shape: 'tripleoctagon', label: 'Fan In' } as GraphNode['attrs'] })
    const outcome = await handler.execute(node, context, makeGraph(), '/tmp/logs')

    expect(outcome.status).toBe('fail')
    expect(outcome.failure_reason).toContain('All parallel branches failed')
  })
})

// ─── Handler Registry ───

describe('HandlerRegistry', () => {
  it('resolve() finds handler by explicit type attribute', () => {
    const registry = new HandlerRegistry()
    const node = makeNode({
      id: 'my_node',
      attrs: { shape: 'box', type: 'start', label: 'Custom Start' } as GraphNode['attrs'],
    })
    const handler = registry.resolve(node)
    expect(handler).toBeInstanceOf(StartHandler)
  })

  it('resolve() finds handler by shape mapping', () => {
    const registry = new HandlerRegistry()
    const node = makeNode({
      id: 'my_node',
      attrs: { shape: 'diamond', type: '', label: 'Conditional' } as GraphNode['attrs'],
    })
    const handler = registry.resolve(node)
    expect(handler).toBeInstanceOf(ConditionalHandler)
  })

  it('resolve() falls back to codergen for unknown shapes', () => {
    const registry = new HandlerRegistry()
    const node = makeNode({
      id: 'my_node',
      attrs: { shape: 'ellipse', type: '', label: 'Unknown' } as GraphNode['attrs'],
    })
    const handler = registry.resolve(node)
    expect(handler).toBeInstanceOf(CodergenHandler)
  })

  it('hasHandler() returns true for registered types', () => {
    const registry = new HandlerRegistry()
    expect(registry.hasHandler('start')).toBe(true)
    expect(registry.hasHandler('exit')).toBe(true)
    expect(registry.hasHandler('codergen')).toBe(true)
    expect(registry.hasHandler('conditional')).toBe(true)
    expect(registry.hasHandler('parallel')).toBe(true)
    expect(registry.hasHandler('parallel.fan_in')).toBe(true)
  })

  it('hasHandler() returns false for unregistered types', () => {
    const registry = new HandlerRegistry()
    expect(registry.hasHandler('nonexistent')).toBe(false)
    expect(registry.hasHandler('custom_handler')).toBe(false)
  })
})
