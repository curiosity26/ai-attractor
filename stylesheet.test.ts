import { describe, it, expect } from 'vitest'
import { parseStylesheet, applyStylesheet } from './stylesheet.js'
import { Graph, GraphAttrs, GraphNode, GraphEdge, NodeAttrs } from './types.js'

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
      ...overrides,
    },
  }
}

describe('parseStylesheet', () => {
  it('parses universal selector * { key: value; }', () => {
    const rules = parseStylesheet('* { llm_model: gpt-4; }')
    expect(rules).toHaveLength(1)
    expect(rules[0].selector.type).toBe('universal')
    expect(rules[0].selector.value).toBe('*')
    expect(rules[0].selector.specificity).toBe(0)
    expect(rules[0].declarations).toEqual({ llm_model: 'gpt-4' })
  })

  it('parses class selector .critical { key: value; }', () => {
    const rules = parseStylesheet('.critical { reasoning_effort: high; }')
    expect(rules).toHaveLength(1)
    expect(rules[0].selector.type).toBe('class')
    expect(rules[0].selector.value).toBe('critical')
    expect(rules[0].selector.specificity).toBe(2)
    expect(rules[0].declarations).toEqual({ reasoning_effort: 'high' })
  })

  it('parses shape selector box { key: value; }', () => {
    const rules = parseStylesheet('box { llm_model: claude-opus-4-6; }')
    expect(rules).toHaveLength(1)
    expect(rules[0].selector.type).toBe('shape')
    expect(rules[0].selector.value).toBe('box')
    expect(rules[0].selector.specificity).toBe(1)
    expect(rules[0].declarations).toEqual({ llm_model: 'claude-opus-4-6' })
  })

  it('parses ID selector #review { key: value; }', () => {
    const rules = parseStylesheet('#review { reasoning_effort: high; }')
    expect(rules).toHaveLength(1)
    expect(rules[0].selector.type).toBe('id')
    expect(rules[0].selector.value).toBe('review')
    expect(rules[0].selector.specificity).toBe(3)
    expect(rules[0].declarations).toEqual({ reasoning_effort: 'high' })
  })

  it('parses multiple rules correctly', () => {
    const rules = parseStylesheet(`
      * { llm_model: gpt-4; }
      .fast { llm_model: gemini-flash; }
      #review { reasoning_effort: high; }
    `)
    expect(rules).toHaveLength(3)
    expect(rules[0].selector.type).toBe('universal')
    expect(rules[1].selector.type).toBe('class')
    expect(rules[2].selector.type).toBe('id')
  })

  it('returns empty array for empty input', () => {
    expect(parseStylesheet('')).toEqual([])
    expect(parseStylesheet('  ')).toEqual([])
  })

  it('strips quotes from declaration values', () => {
    const rules = parseStylesheet('* { llm_model: "gpt-4"; }')
    expect(rules[0].declarations.llm_model).toBe('gpt-4')
  })
})

describe('applyStylesheet', () => {
  it('applies stylesheet properties to matching nodes', () => {
    const graph = makeGraph({ model_stylesheet: '* { llm_model: gpt-4; }' })
    const node = makeNode('work')
    graph.nodes.set('work', node)

    applyStylesheet(graph)

    expect(node.attrs.llm_model).toBe('gpt-4')
  })

  it('specificity order: universal < shape < class < ID', () => {
    const graph = makeGraph({
      model_stylesheet: `
        * { llm_model: universal-model; }
        box { llm_model: shape-model; }
        .fast { llm_model: class-model; }
        #work { llm_model: id-model; }
      `,
    })
    const node = makeNode('work', { shape: 'box', class: 'fast' })
    graph.nodes.set('work', node)

    applyStylesheet(graph)

    // ID selector has highest specificity, so it wins
    expect(node.attrs.llm_model).toBe('id-model')
  })

  it('explicit node attributes override stylesheet', () => {
    const graph = makeGraph({
      model_stylesheet: '* { llm_model: stylesheet-model; llm_provider: stylesheet-provider; }',
    })
    const node = makeNode('work', { llm_model: 'explicit-model' })
    graph.nodes.set('work', node)

    applyStylesheet(graph)

    // Explicit attribute is preserved
    expect(node.attrs.llm_model).toBe('explicit-model')
    // Non-explicit attribute is set from stylesheet
    expect(node.attrs.llm_provider).toBe('stylesheet-provider')
  })

  it('does nothing when model_stylesheet is empty', () => {
    const graph = makeGraph({ model_stylesheet: '' })
    const node = makeNode('work')
    graph.nodes.set('work', node)

    applyStylesheet(graph)

    expect(node.attrs.llm_model).toBe('')
  })

  it('class selector matches nodes with that class', () => {
    const graph = makeGraph({
      model_stylesheet: '.critical { llm_provider: anthropic; }',
    })
    const nodeWithClass = makeNode('a', { class: 'critical' })
    const nodeWithoutClass = makeNode('b', { class: '' })
    graph.nodes.set('a', nodeWithClass)
    graph.nodes.set('b', nodeWithoutClass)

    applyStylesheet(graph)

    expect(nodeWithClass.attrs.llm_provider).toBe('anthropic')
    expect(nodeWithoutClass.attrs.llm_provider).toBe('')
  })

  it('shape selector matches nodes with that shape', () => {
    const graph = makeGraph({
      model_stylesheet: 'diamond { llm_model: fast-model; }',
    })
    const boxNode = makeNode('a', { shape: 'box' })
    const diamondNode = makeNode('b', { shape: 'diamond' })
    graph.nodes.set('a', boxNode)
    graph.nodes.set('b', diamondNode)

    applyStylesheet(graph)

    expect(boxNode.attrs.llm_model).toBe('')
    expect(diamondNode.attrs.llm_model).toBe('fast-model')
  })
})
