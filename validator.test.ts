import { describe, it, expect } from 'vitest'
import { validate, validateOrRaise } from './validator.js'
import { Graph, GraphAttrs, GraphNode, GraphEdge, NodeAttrs, EdgeAttrs } from './types.js'

function makeGraph(overrides?: Partial<GraphAttrs>): Graph {
  const attrs: GraphAttrs = {
    goal: '',
    label: '',
    model_stylesheet: '',
    default_max_retries: 0,
    retry_target: '',
    fallback_retry_target: '',
    default_fidelity: '',
    ...overrides,
  }
  return {
    name: 'test',
    attrs,
    nodes: new Map(),
    edges: [],
  }
}

function makeNode(id: string, overrides?: Partial<NodeAttrs>): GraphNode {
  return {
    id,
    attrs: {
      label: id,
      shape: 'box',
      type: '',
      prompt: 'some prompt',
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
    },
  }
}

function makeEdge(from: string, to: string, overrides?: Partial<EdgeAttrs>): GraphEdge {
  return {
    from,
    to,
    attrs: {
      label: '',
      condition: '',
      weight: 0,
      fidelity: '',
      thread_id: '',
      loop_restart: false,
      ...overrides,
    },
  }
}

/** Build a minimal valid pipeline: start -> A -> exit */
function validPipeline(): Graph {
  const graph = makeGraph()
  graph.nodes.set('start', makeNode('start', { shape: 'Mdiamond', prompt: '' }))
  graph.nodes.set('A', makeNode('A', { shape: 'box', prompt: 'do work' }))
  graph.nodes.set('exit', makeNode('exit', { shape: 'Msquare', prompt: '' }))
  graph.edges.push(makeEdge('start', 'A'))
  graph.edges.push(makeEdge('A', 'exit'))
  return graph
}

describe('validate', () => {
  it('valid pipeline passes validation with no errors', () => {
    const diagnostics = validate(validPipeline())
    const errors = diagnostics.filter(d => d.severity === 'error')
    expect(errors).toHaveLength(0)
  })

  it('missing start node produces an error', () => {
    const graph = makeGraph()
    graph.nodes.set('A', makeNode('A'))
    graph.nodes.set('exit', makeNode('exit', { shape: 'Msquare' }))
    graph.edges.push(makeEdge('A', 'exit'))

    const diagnostics = validate(graph)
    const startErrors = diagnostics.filter(d => d.rule === 'start_node' && d.severity === 'error')
    expect(startErrors.length).toBeGreaterThanOrEqual(1)
  })

  it('missing exit node produces an error', () => {
    const graph = makeGraph()
    graph.nodes.set('start', makeNode('start', { shape: 'Mdiamond' }))
    graph.nodes.set('A', makeNode('A'))
    graph.edges.push(makeEdge('start', 'A'))

    const diagnostics = validate(graph)
    const exitErrors = diagnostics.filter(d => d.rule === 'terminal_node' && d.severity === 'error')
    expect(exitErrors.length).toBeGreaterThanOrEqual(1)
  })

  it('start node with incoming edges produces an error', () => {
    const graph = makeGraph()
    graph.nodes.set('start', makeNode('start', { shape: 'Mdiamond' }))
    graph.nodes.set('A', makeNode('A'))
    graph.nodes.set('exit', makeNode('exit', { shape: 'Msquare' }))
    graph.edges.push(makeEdge('start', 'A'))
    graph.edges.push(makeEdge('A', 'exit'))
    graph.edges.push(makeEdge('A', 'start')) // incoming to start

    const diagnostics = validate(graph)
    const incoming = diagnostics.filter(d => d.rule === 'start_no_incoming')
    expect(incoming.length).toBeGreaterThanOrEqual(1)
    expect(incoming[0].severity).toBe('error')
  })

  it('exit node with outgoing edges produces an error', () => {
    const graph = makeGraph()
    graph.nodes.set('start', makeNode('start', { shape: 'Mdiamond' }))
    graph.nodes.set('A', makeNode('A'))
    graph.nodes.set('exit', makeNode('exit', { shape: 'Msquare' }))
    graph.edges.push(makeEdge('start', 'A'))
    graph.edges.push(makeEdge('A', 'exit'))
    graph.edges.push(makeEdge('exit', 'A')) // outgoing from exit

    const diagnostics = validate(graph)
    const outgoing = diagnostics.filter(d => d.rule === 'exit_no_outgoing')
    expect(outgoing.length).toBeGreaterThanOrEqual(1)
    expect(outgoing[0].severity).toBe('error')
  })

  it('orphan node (unreachable from start) produces an error', () => {
    const graph = validPipeline()
    // Add an orphan node with no edges leading to it
    graph.nodes.set('orphan', makeNode('orphan'))

    const diagnostics = validate(graph)
    const reachability = diagnostics.filter(
      d => d.rule === 'reachability' && d.message.includes('orphan')
    )
    expect(reachability.length).toBeGreaterThanOrEqual(1)
  })

  it('edge target references non-existent node produces an error', () => {
    const graph = makeGraph()
    graph.nodes.set('start', makeNode('start', { shape: 'Mdiamond' }))
    graph.nodes.set('exit', makeNode('exit', { shape: 'Msquare' }))
    graph.edges.push(makeEdge('start', 'exit'))
    graph.edges.push(makeEdge('start', 'nonexistent')) // bad target

    const diagnostics = validate(graph)
    const edgeErrors = diagnostics.filter(
      d => d.rule === 'edge_target_exists' && d.message.includes('nonexistent')
    )
    expect(edgeErrors.length).toBeGreaterThanOrEqual(1)
    expect(edgeErrors[0].severity).toBe('error')
  })

  it('codergen node without prompt or label produces a warning', () => {
    const graph = makeGraph()
    graph.nodes.set('start', makeNode('start', { shape: 'Mdiamond', prompt: '' }))
    // A box node (codergen) with no prompt and empty label
    graph.nodes.set('work', makeNode('work', { shape: 'box', prompt: '', label: '' }))
    graph.nodes.set('exit', makeNode('exit', { shape: 'Msquare', prompt: '' }))
    graph.edges.push(makeEdge('start', 'work'))
    graph.edges.push(makeEdge('work', 'exit'))

    const diagnostics = validate(graph)
    const promptWarnings = diagnostics.filter(
      d => d.rule === 'prompt_on_llm_nodes' && d.node_id === 'work'
    )
    expect(promptWarnings.length).toBeGreaterThanOrEqual(1)
    expect(promptWarnings[0].severity).toBe('warning')
  })

  it('invalid condition syntax on edge produces an error', () => {
    const graph = validPipeline()
    // Replace edge with one that has an invalid condition
    graph.edges = [
      makeEdge('start', 'A'),
      makeEdge('A', 'exit', { condition: '123bad=value' }),
    ]

    const diagnostics = validate(graph)
    const condErrors = diagnostics.filter(d => d.rule === 'condition_syntax')
    expect(condErrors.length).toBeGreaterThanOrEqual(1)
    expect(condErrors[0].severity).toBe('error')
  })

  it('multiple start nodes produces an error', () => {
    const graph = makeGraph()
    graph.nodes.set('start1', makeNode('start1', { shape: 'Mdiamond' }))
    graph.nodes.set('start2', makeNode('start2', { shape: 'Mdiamond' }))
    graph.nodes.set('exit', makeNode('exit', { shape: 'Msquare' }))
    graph.edges.push(makeEdge('start1', 'exit'))
    graph.edges.push(makeEdge('start2', 'exit'))

    const diagnostics = validate(graph)
    const startErrors = diagnostics.filter(d => d.rule === 'start_node' && d.severity === 'error')
    expect(startErrors.length).toBeGreaterThanOrEqual(1)
    expect(startErrors[0].message).toContain('2')
  })

  it('valid conditions pass syntax check (no condition_syntax errors)', () => {
    const graph = validPipeline()
    graph.edges = [
      makeEdge('start', 'A', { condition: 'outcome=success' }),
      makeEdge('A', 'exit', { condition: 'outcome!=fail && context.ready=true' }),
    ]

    const diagnostics = validate(graph)
    const condErrors = diagnostics.filter(d => d.rule === 'condition_syntax')
    expect(condErrors).toHaveLength(0)
  })

  it('validate() returns Diagnostic objects with correct severity and rule', () => {
    const graph = makeGraph() // No nodes at all
    const diagnostics = validate(graph)

    for (const d of diagnostics) {
      expect(d).toHaveProperty('rule')
      expect(d).toHaveProperty('severity')
      expect(d).toHaveProperty('message')
      expect(['error', 'warning', 'info']).toContain(d.severity)
      expect(typeof d.rule).toBe('string')
      expect(typeof d.message).toBe('string')
    }
  })

  it('node ID "start" is recognized as a start node even without Mdiamond shape', () => {
    const graph = makeGraph()
    graph.nodes.set('start', makeNode('start', { shape: 'box' }))
    graph.nodes.set('exit', makeNode('exit', { shape: 'Msquare' }))
    graph.edges.push(makeEdge('start', 'exit'))

    const diagnostics = validate(graph)
    const startErrors = diagnostics.filter(d => d.rule === 'start_node')
    expect(startErrors).toHaveLength(0)
  })

  it('node ID "exit" is recognized as an exit node even without Msquare shape', () => {
    const graph = makeGraph()
    graph.nodes.set('start', makeNode('start', { shape: 'Mdiamond' }))
    graph.nodes.set('exit', makeNode('exit', { shape: 'box' }))
    graph.edges.push(makeEdge('start', 'exit'))

    const diagnostics = validate(graph)
    const exitErrors = diagnostics.filter(d => d.rule === 'terminal_node')
    expect(exitErrors).toHaveLength(0)
  })
})

describe('validateOrRaise', () => {
  it('does not throw for a valid pipeline', () => {
    expect(() => validateOrRaise(validPipeline())).not.toThrow()
  })

  it('throws on error-severity violations', () => {
    const graph = makeGraph() // empty graph, no start/exit
    expect(() => validateOrRaise(graph)).toThrow(/Validation failed/)
  })

  it('returns warnings without throwing', () => {
    const graph = validPipeline()
    // Add an orphan to get a warning (reachability is error in this implementation)
    // Instead, add a codergen node without prompt
    graph.nodes.set('noprompt', makeNode('noprompt', { shape: 'box', prompt: '', label: '' }))
    // Make it reachable so no reachability error
    graph.edges.push(makeEdge('A', 'noprompt'))
    graph.edges.push(makeEdge('noprompt', 'exit'))

    const diagnostics = validateOrRaise(graph)
    const warnings = diagnostics.filter(d => d.severity === 'warning')
    expect(warnings.length).toBeGreaterThanOrEqual(1)
  })
})
