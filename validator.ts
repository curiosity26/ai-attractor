// Validation and linting rules from Section 7 of the spec

import { Graph, Diagnostic, SHAPE_TO_TYPE } from './types.js'
import { validateConditionSyntax } from './conditions.js'
import { validateStylesheetSyntax } from './stylesheet.js'

const KNOWN_HANDLER_TYPES = new Set([
  'start', 'exit', 'codergen', 'conditional',
  'wait.human', 'parallel', 'parallel.fan_in', 'tool',
  'stack.manager_loop',
])

const VALID_FIDELITY_MODES = new Set([
  'full', 'truncate', 'compact',
  'summary:low', 'summary:medium', 'summary:high',
])

export function validate(graph: Graph): Diagnostic[] {
  const diagnostics: Diagnostic[] = []

  // Rule: start_node — exactly one start node
  const startNodes = findNodesByRole(graph, 'start')
  if (startNodes.length === 0) {
    diagnostics.push({
      rule: 'start_node',
      severity: 'error',
      message: 'Pipeline must have exactly one start node (shape=Mdiamond or id matching "start"/"Start")',
      fix: 'Add a node with shape=Mdiamond',
    })
  } else if (startNodes.length > 1) {
    diagnostics.push({
      rule: 'start_node',
      severity: 'error',
      message: `Pipeline has ${startNodes.length} start nodes: ${startNodes.map(n => n.id).join(', ')}. Exactly one is required.`,
    })
  }

  // Rule: terminal_node — exactly one exit node
  const exitNodes = findNodesByRole(graph, 'exit')
  if (exitNodes.length === 0) {
    diagnostics.push({
      rule: 'terminal_node',
      severity: 'error',
      message: 'Pipeline must have exactly one terminal/exit node (shape=Msquare or id matching "exit"/"end")',
      fix: 'Add a node with shape=Msquare',
    })
  } else if (exitNodes.length > 1) {
    diagnostics.push({
      rule: 'terminal_node',
      severity: 'error',
      message: `Pipeline has ${exitNodes.length} exit nodes: ${exitNodes.map(n => n.id).join(', ')}. Exactly one is required.`,
    })
  }

  // Rule: edge_target_exists — all edge targets reference existing nodes
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.from)) {
      diagnostics.push({
        rule: 'edge_target_exists',
        severity: 'error',
        message: `Edge source "${edge.from}" does not reference an existing node`,
        edge: [edge.from, edge.to],
      })
    }
    if (!graph.nodes.has(edge.to)) {
      diagnostics.push({
        rule: 'edge_target_exists',
        severity: 'error',
        message: `Edge target "${edge.to}" does not reference an existing node`,
        edge: [edge.from, edge.to],
      })
    }
  }

  // Rule: start_no_incoming — start node must have no incoming edges
  if (startNodes.length === 1) {
    const startId = startNodes[0].id
    const incoming = graph.edges.filter(e => e.to === startId)
    if (incoming.length > 0) {
      diagnostics.push({
        rule: 'start_no_incoming',
        severity: 'error',
        message: `Start node "${startId}" has ${incoming.length} incoming edge(s). Start nodes must have no incoming edges.`,
        node_id: startId,
      })
    }
  }

  // Rule: exit_no_outgoing — exit node must have no outgoing edges
  if (exitNodes.length === 1) {
    const exitId = exitNodes[0].id
    const outgoing = graph.edges.filter(e => e.from === exitId)
    if (outgoing.length > 0) {
      diagnostics.push({
        rule: 'exit_no_outgoing',
        severity: 'error',
        message: `Exit node "${exitId}" has ${outgoing.length} outgoing edge(s). Exit nodes must have no outgoing edges.`,
        node_id: exitId,
      })
    }
  }

  // Rule: reachability — all nodes reachable from start
  if (startNodes.length === 1) {
    const reachable = bfs(graph, startNodes[0].id)
    for (const [nodeId] of graph.nodes) {
      if (!reachable.has(nodeId)) {
        diagnostics.push({
          rule: 'reachability',
          severity: 'error',
          message: `Node "${nodeId}" is not reachable from the start node`,
          node_id: nodeId,
        })
      }
    }
  }

  // Rule: condition_syntax — edge conditions must parse
  for (const edge of graph.edges) {
    if (edge.attrs.condition) {
      const error = validateConditionSyntax(edge.attrs.condition)
      if (error) {
        diagnostics.push({
          rule: 'condition_syntax',
          severity: 'error',
          message: `Invalid condition on edge ${edge.from} -> ${edge.to}: ${error}`,
          edge: [edge.from, edge.to],
        })
      }
    }
  }

  // Rule: stylesheet_syntax
  if (graph.attrs.model_stylesheet) {
    const error = validateStylesheetSyntax(graph.attrs.model_stylesheet)
    if (error) {
      diagnostics.push({
        rule: 'stylesheet_syntax',
        severity: 'error',
        message: `Invalid model_stylesheet: ${error}`,
      })
    }
  }

  // Rule: type_known — node types should be recognized
  for (const [, node] of graph.nodes) {
    if (node.attrs.type && !KNOWN_HANDLER_TYPES.has(node.attrs.type)) {
      diagnostics.push({
        rule: 'type_known',
        severity: 'warning',
        message: `Node "${node.id}" has unknown type "${node.attrs.type}"`,
        node_id: node.id,
      })
    }
  }

  // Rule: fidelity_valid
  for (const [, node] of graph.nodes) {
    if (node.attrs.fidelity && !VALID_FIDELITY_MODES.has(node.attrs.fidelity)) {
      diagnostics.push({
        rule: 'fidelity_valid',
        severity: 'warning',
        message: `Node "${node.id}" has invalid fidelity mode "${node.attrs.fidelity}"`,
        node_id: node.id,
      })
    }
  }
  for (const edge of graph.edges) {
    if (edge.attrs.fidelity && !VALID_FIDELITY_MODES.has(edge.attrs.fidelity)) {
      diagnostics.push({
        rule: 'fidelity_valid',
        severity: 'warning',
        message: `Edge ${edge.from} -> ${edge.to} has invalid fidelity mode "${edge.attrs.fidelity}"`,
        edge: [edge.from, edge.to],
      })
    }
  }

  // Rule: retry_target_exists
  for (const [, node] of graph.nodes) {
    if (node.attrs.retry_target && !graph.nodes.has(node.attrs.retry_target)) {
      diagnostics.push({
        rule: 'retry_target_exists',
        severity: 'warning',
        message: `Node "${node.id}" has retry_target "${node.attrs.retry_target}" which does not exist`,
        node_id: node.id,
      })
    }
    if (node.attrs.fallback_retry_target && !graph.nodes.has(node.attrs.fallback_retry_target)) {
      diagnostics.push({
        rule: 'retry_target_exists',
        severity: 'warning',
        message: `Node "${node.id}" has fallback_retry_target "${node.attrs.fallback_retry_target}" which does not exist`,
        node_id: node.id,
      })
    }
  }
  if (graph.attrs.retry_target && !graph.nodes.has(graph.attrs.retry_target)) {
    diagnostics.push({
      rule: 'retry_target_exists',
      severity: 'warning',
      message: `Graph retry_target "${graph.attrs.retry_target}" does not exist`,
    })
  }
  if (graph.attrs.fallback_retry_target && !graph.nodes.has(graph.attrs.fallback_retry_target)) {
    diagnostics.push({
      rule: 'retry_target_exists',
      severity: 'warning',
      message: `Graph fallback_retry_target "${graph.attrs.fallback_retry_target}" does not exist`,
    })
  }

  // Rule: goal_gate_has_retry
  for (const [, node] of graph.nodes) {
    if (node.attrs.goal_gate && !node.attrs.retry_target && !node.attrs.fallback_retry_target
      && !graph.attrs.retry_target && !graph.attrs.fallback_retry_target) {
      diagnostics.push({
        rule: 'goal_gate_has_retry',
        severity: 'warning',
        message: `Node "${node.id}" has goal_gate=true but no retry_target is configured (node, or graph level)`,
        node_id: node.id,
        fix: 'Set retry_target on the node or graph to handle unsatisfied goal gates',
      })
    }
  }

  // Rule: prompt_on_llm_nodes
  for (const [, node] of graph.nodes) {
    const handlerType = node.attrs.type || SHAPE_TO_TYPE[node.attrs.shape] || 'codergen'
    if (handlerType === 'codergen' && !node.attrs.prompt && !node.attrs.label) {
      diagnostics.push({
        rule: 'prompt_on_llm_nodes',
        severity: 'warning',
        message: `Codergen node "${node.id}" has no prompt or label`,
        node_id: node.id,
        fix: 'Add a prompt or label attribute',
      })
    }
  }

  return diagnostics
}

export function validateOrRaise(graph: Graph): Diagnostic[] {
  const diagnostics = validate(graph)
  const errors = diagnostics.filter(d => d.severity === 'error')
  if (errors.length > 0) {
    const messages = errors.map(e => `  [${e.rule}] ${e.message}`).join('\n')
    throw new Error(`Validation failed with ${errors.length} error(s):\n${messages}`)
  }
  return diagnostics
}

// ─── Helpers ───

interface NodeLike { id: string; attrs: { shape: string } }

function findNodesByRole(graph: Graph, role: 'start' | 'exit'): NodeLike[] {
  const nodes: NodeLike[] = []
  for (const [, node] of graph.nodes) {
    if (role === 'start') {
      if (node.attrs.shape === 'Mdiamond' || node.id === 'start' || node.id === 'Start') {
        nodes.push(node)
      }
    } else {
      if (node.attrs.shape === 'Msquare' || node.id === 'exit' || node.id === 'end') {
        nodes.push(node)
      }
    }
  }
  return nodes
}

function bfs(graph: Graph, startId: string): Set<string> {
  const visited = new Set<string>()
  const queue = [startId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    for (const edge of graph.edges) {
      if (edge.from === current && !visited.has(edge.to)) {
        queue.push(edge.to)
      }
    }
  }
  return visited
}
