import { describe, it, expect } from 'vitest'
import { parseDot } from './parser.js'

describe('parseDot', () => {
  it('parses a minimal digraph (start -> exit)', () => {
    const graph = parseDot(`
      digraph minimal {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        start -> exit
      }
    `)
    expect(graph.name).toBe('minimal')
    expect(graph.nodes.size).toBe(2)
    expect(graph.nodes.has('start')).toBe(true)
    expect(graph.nodes.has('exit')).toBe(true)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].from).toBe('start')
    expect(graph.edges[0].to).toBe('exit')
  })

  it('parses graph-level attributes (goal, label, model_stylesheet)', () => {
    const graph = parseDot(`
      digraph attrs {
        graph [goal="Build something", label="My Pipeline", model_stylesheet="* { llm_model: gpt-4; }"]
        start [shape=Mdiamond]
        exit [shape=Msquare]
        start -> exit
      }
    `)
    expect(graph.attrs.goal).toBe('Build something')
    expect(graph.attrs.label).toBe('My Pipeline')
    expect(graph.attrs.model_stylesheet).toBe('* { llm_model: gpt-4; }')
  })

  it('parses top-level key=value as graph attributes', () => {
    const graph = parseDot(`
      digraph toplevel {
        goal = "Top-level goal"
        label = "Top label"
        start [shape=Mdiamond]
        exit [shape=Msquare]
        start -> exit
      }
    `)
    expect(graph.attrs.goal).toBe('Top-level goal')
    expect(graph.attrs.label).toBe('Top label')
  })

  it('parses node attributes (label, shape, prompt, class, timeout)', () => {
    const graph = parseDot(`
      digraph nodeattrs {
        start [shape=Mdiamond]
        work [shape=box, label="Work Node", prompt="Do the work", class="fast", timeout="30s"]
        exit [shape=Msquare]
        start -> work -> exit
      }
    `)
    const work = graph.nodes.get('work')!
    expect(work.attrs.label).toBe('Work Node')
    expect(work.attrs.shape).toBe('box')
    expect(work.attrs.prompt).toBe('Do the work')
    expect(work.attrs.class).toBe('fast')
    expect(work.attrs.timeout).toBe(30000)
  })

  it('parses edge attributes (label, condition, weight)', () => {
    const graph = parseDot(`
      digraph edgeattrs {
        start [shape=Mdiamond]
        A [shape=box]
        exit [shape=Msquare]
        start -> A [label="begin"]
        A -> exit [condition="outcome=success", weight=10]
      }
    `)
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges[0].attrs.label).toBe('begin')
    expect(graph.edges[1].attrs.condition).toBe('outcome=success')
    expect(graph.edges[1].attrs.weight).toBe(10)
  })

  it('parses chained edges (A -> B -> C produces 2 edge objects)', () => {
    const graph = parseDot(`
      digraph chained {
        start [shape=Mdiamond]
        A [shape=box]
        exit [shape=Msquare]
        start -> A -> exit
      }
    `)
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges[0].from).toBe('start')
    expect(graph.edges[0].to).toBe('A')
    expect(graph.edges[1].from).toBe('A')
    expect(graph.edges[1].to).toBe('exit')
  })

  it('applies shared attributes from chained edge to all produced edges', () => {
    const graph = parseDot(`
      digraph chainedattrs {
        start [shape=Mdiamond]
        A [shape=box]
        exit [shape=Msquare]
        start -> A -> exit [label="flow"]
      }
    `)
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges[0].attrs.label).toBe('flow')
    expect(graph.edges[1].attrs.label).toBe('flow')
  })

  it('parses multi-line string attributes (prompt with \\n)', () => {
    const graph = parseDot(`
      digraph multiline {
        start [shape=Mdiamond]
        work [shape=box, prompt="Line one\\nLine two\\nLine three"]
        exit [shape=Msquare]
        start -> work -> exit
      }
    `)
    const work = graph.nodes.get('work')!
    expect(work.attrs.prompt).toBe('Line one\nLine two\nLine three')
  })

  it('parses node default blocks', () => {
    const graph = parseDot(`
      digraph nodedefaults {
        node [shape=box]
        start [shape=Mdiamond]
        A
        B
        exit [shape=Msquare]
        start -> A -> B -> exit
      }
    `)
    expect(graph.nodes.get('A')!.attrs.shape).toBe('box')
    expect(graph.nodes.get('B')!.attrs.shape).toBe('box')
    // Explicit shape overrides the default
    expect(graph.nodes.get('start')!.attrs.shape).toBe('Mdiamond')
    expect(graph.nodes.get('exit')!.attrs.shape).toBe('Msquare')
  })

  it('parses edge default blocks', () => {
    const graph = parseDot(`
      digraph edgedefaults {
        edge [weight=5]
        start [shape=Mdiamond]
        A [shape=box]
        exit [shape=Msquare]
        start -> A
        A -> exit
      }
    `)
    expect(graph.edges[0].attrs.weight).toBe(5)
    expect(graph.edges[1].attrs.weight).toBe(5)
  })

  it('parses quoted and unquoted attribute values', () => {
    const graph = parseDot(`
      digraph quoting {
        start [shape=Mdiamond]
        A [shape=box, label="Quoted Label", prompt=bare_value]
        exit [shape=Msquare]
        start -> A -> exit
      }
    `)
    const a = graph.nodes.get('A')!
    expect(a.attrs.label).toBe('Quoted Label')
    expect(a.attrs.prompt).toBe('bare_value')
  })

  it('strips line comments (//) before parsing', () => {
    const graph = parseDot(`
      digraph comments {
        // This is a comment
        start [shape=Mdiamond] // inline comment
        exit [shape=Msquare]
        start -> exit
      }
    `)
    expect(graph.nodes.size).toBe(2)
    expect(graph.edges).toHaveLength(1)
  })

  it('strips block comments (/* */) before parsing', () => {
    const graph = parseDot(`
      digraph blockcomments {
        /* This is a
           multi-line block comment */
        start [shape=Mdiamond]
        exit [shape=Msquare]
        start -> exit
      }
    `)
    expect(graph.nodes.size).toBe(2)
    expect(graph.edges).toHaveLength(1)
  })

  it('preserves strings inside comments (does not strip quoted content)', () => {
    const graph = parseDot(`
      digraph preserved {
        start [shape=Mdiamond]
        A [shape=box, label="has // slashes and /* stars */"]
        exit [shape=Msquare]
        start -> A -> exit
      }
    `)
    const a = graph.nodes.get('A')!
    expect(a.attrs.label).toBe('has // slashes and /* stars */')
  })

  it('flattens subgraph contents (nodes and edges kept, wrapper removed)', () => {
    const graph = parseDot(`
      digraph subgraphs {
        start [shape=Mdiamond]
        exit [shape=Msquare]

        subgraph cluster_work {
          label = "Work Phase"
          A [shape=box]
          B [shape=box]
          A -> B
        }

        start -> A
        B -> exit
      }
    `)
    // Nodes from subgraph are in the top-level graph
    expect(graph.nodes.has('A')).toBe(true)
    expect(graph.nodes.has('B')).toBe(true)
    // Edges from subgraph are present
    const abEdge = graph.edges.find(e => e.from === 'A' && e.to === 'B')
    expect(abEdge).toBeDefined()
  })

  it('derives class from subgraph label and applies to contained nodes', () => {
    const graph = parseDot(`
      digraph subclass {
        start [shape=Mdiamond]
        exit [shape=Msquare]

        subgraph cluster_critical {
          label = "Critical Phase"
          A [shape=box]
        }

        start -> A -> exit
      }
    `)
    const a = graph.nodes.get('A')!
    // "Critical Phase" -> "critical-phase"
    expect(a.attrs.class).toContain('critical-phase')
  })

  it('parses boolean attribute values (true/false)', () => {
    const graph = parseDot(`
      digraph booleans {
        start [shape=Mdiamond]
        work [shape=box, goal_gate=true, auto_status=false]
        exit [shape=Msquare]
        start -> work -> exit
      }
    `)
    const work = graph.nodes.get('work')!
    expect(work.attrs.goal_gate).toBe(true)
    expect(work.attrs.auto_status).toBe(false)
  })

  it('throws a parse error on invalid syntax (missing digraph keyword)', () => {
    expect(() => parseDot(`graph invalid { A -> B }`)).toThrow(/Parse error/)
  })

  it('parses default_max_retries as a number', () => {
    const graph = parseDot(`
      digraph retries {
        graph [default_max_retries=3]
        start [shape=Mdiamond]
        exit [shape=Msquare]
        start -> exit
      }
    `)
    expect(graph.attrs.default_max_retries).toBe(3)
  })

  it('auto-creates nodes referenced in edges but not explicitly declared', () => {
    const graph = parseDot(`
      digraph implicit {
        start -> middle -> exit
      }
    `)
    expect(graph.nodes.has('start')).toBe(true)
    expect(graph.nodes.has('middle')).toBe(true)
    expect(graph.nodes.has('exit')).toBe(true)
  })
})
