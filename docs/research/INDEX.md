# Research — Semantic Index

> **2W:** AI workflow orchestration
> **4W:** Multi-stage AI pipeline runner specs
> **8W:** Specifications for building a DOT-based AI workflow orchestrator with pluggable agent loops
> **16W:** Complete natural language specifications for implementing Attractor (a DOT-based pipeline runner), a coding agent loop with provider-aligned toolsets, a unified LLM client across providers, and factory techniques for agent knowledge management

---

## Documents

| File | 2W | 4W | Size | When to Read |
|------|-----|-----|------|-------------|
| [attractor-spec.md](attractor-spec.md) | Pipeline runner | DOT-based workflow orchestrator | ~48 KB | Implementing or extending the attractor engine — node handlers, execution loop, edge selection, parallel fan-out, checkpoints |
| [attractor-README.md](attractor-README.md) | Project overview | How to build Attractor | ~1 KB | Quick orientation — what Attractor is, how to build it, terminology |
| [coding-agent-loop-spec.md](coding-agent-loop-spec.md) | Agent loop | Autonomous coding agent library | ~42 KB | Building the coding agent that runs inside attractor nodes — agentic loop, tool execution, subagents, context management |
| [unified-llm-spec.md](unified-llm-spec.md) | LLM client | Multi-provider unified LLM SDK | ~38 KB | Building the LLM client layer that the agent loop calls — provider adapters, streaming, tool calling, error handling |
| [factory-techniques.md](factory-techniques.md) | Knowledge patterns | Pyramid summaries + filesystem index | ~0.5 KB | Structuring agent knowledge — compression at multiple zoom levels, filesystem as semantic index, genrefying |

---

## Dependency Graph

```
factory-techniques (knowledge patterns)
        ↓ informs
unified-llm-spec (LLM client)
        ↓ consumed by
coding-agent-loop-spec (agent loop)
        ↓ executed by
attractor-spec (pipeline runner)
```

The stack builds bottom-up:
1. **Unified LLM Client** — single interface across OpenAI, Anthropic, Google
2. **Coding Agent Loop** — agentic loop using the LLM client, with provider-aligned tools
3. **Attractor** — orchestrates multiple agent loop instances as a DAG pipeline

Factory techniques apply at every level for managing context and knowledge.

---

## Reading Orders

**"I want to build Attractor from scratch":**
1. `attractor-README.md` → orientation (1 min)
2. `unified-llm-spec.md` → build the LLM layer first (1 hr)
3. `coding-agent-loop-spec.md` → build the agent loop on top (1 hr)
4. `attractor-spec.md` → build the pipeline runner (2 hr)

**"I want to understand the architecture":**
1. `attractor-README.md` → what and why (1 min)
2. `attractor-spec.md` §1-3 → pipeline model, DOT DSL, execution engine (20 min)
3. `coding-agent-loop-spec.md` §1-2 → agent loop overview (10 min)
4. `unified-llm-spec.md` §1-2 → LLM client architecture (10 min)

**"I want to write a pipeline (.dot file)":**
1. `attractor-spec.md` §2 → DOT DSL schema (node shapes, edge conditions, attributes)
2. `attractor-spec.md` §4 → node handlers (codergen, parallel, fan-in, human, conditional)
3. `attractor-spec.md` §8 → model stylesheet (assign models to nodes by class/shape)
4. `SEED-TEMPLATE.md` (in project root) → generalized pipeline template

**"I want to extend the engine":**
1. `attractor-spec.md` §4 → handler interface and existing handlers
2. `attractor-spec.md` §9 → transforms and extensibility
3. `attractor-spec.md` §3 → execution engine internals (edge selection, retry, checkpoints)

---

## Key Concepts by Document

### attractor-spec.md
- **DOT DSL**: Graphviz directed graphs as workflow definitions
- **Node shapes**: Mdiamond (start), Msquare (exit), box (codergen), component (parallel), tripleoctagon (fan-in), diamond (conditional), hexagon (human)
- **Edge selection**: 5-step priority algorithm (condition → label → suggested IDs → weight → lexical)
- **Model stylesheet**: CSS-like selector system for assigning LLM models to nodes
- **CONTEXT_SET**: LLM output directive for setting context variables
- **Goal gates**: Nodes that must succeed before the pipeline can exit
- **Checkpoint/resume**: Crash recovery via serialized state after each node

### coding-agent-loop-spec.md
- **Agentic loop**: Submit → LLM → tool calls → execute → repeat until done
- **Provider-aligned toolsets**: Each model family gets its native tool interface
- **Tool execution environment**: Swappable (local, Docker, K8s, SSH, WASM)
- **Subagents**: Parallel child agents sharing filesystem but independent history
- **Context management**: Truncation, steering, loop detection

### unified-llm-spec.md
- **Provider adapters**: OpenAI, Anthropic, Gemini behind one interface
- **Model string routing**: `"claude-opus-4-6"` → Anthropic adapter automatically
- **Streaming**: First-class streaming with start/delta/end events
- **Tool calling**: Unified tool definition format across providers
- **Middleware**: Composable logging, retry, caching layers

### factory-techniques.md
- **Pyramid summaries**: 2W → 4W → 8W → 16W → FULL reversible compression
- **Filesystem as semantic index**: Directories as hierarchies, markdown as catalogs
- **Genrefying**: Restructuring information to optimize future retrieval
