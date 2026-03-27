# Attractor

DOT-based pipeline runner for multi-stage AI workflows.

This repository contains [NLSpecs](#terminology) to build your own version of Attractor to create your own software factory.

Although bringing your own agentic loop and unified LLM SDK is not required to build your own Attractor, we highly recommend controlling the stack so you have a strong foundation.

## Prerequisites

- Node.js >= 18
- One or more coding agent CLIs installed and on your PATH:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`) — Anthropic models
  - [Codex](https://github.com/openai/codex) (`codex`) — OpenAI models
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`) — Google models

## Install

```bash
git clone git@github.com:curiosity26/ai-attractor.git
cd ai-attractor
npm install
npm run build
```

### Global command (optional)

After building, link the `attractor` command globally:

```bash
npm link
```

This makes `attractor` available anywhere on your system. To unlink later: `npm unlink -g attractor`.

## Usage

If linked globally:

```bash
attractor run <pipeline.dot> [options]
attractor validate <pipeline.dot>
attractor inspect <pipeline.dot>
```

Without linking, use tsx directly:

```bash
npm run run -- <pipeline.dot> [options]
npm run validate -- <pipeline.dot>
```

### Options

| Flag | Description |
|------|-------------|
| `--resume` | Resume from last checkpoint |
| `--dry-run` | Validate and print execution plan without running |
| `--verbose` | Show detailed output |

### Example

```bash
attractor run test-pipelines/01-sequential.dot --verbose
```

## Supported Providers

Pipelines can target different LLM providers per node using the `llm_provider` and `llm_model` attributes:

| Provider value | CLI used | Example models |
|----------------|----------|----------------|
| `anthropic` (default) | `claude` | `claude-sonnet-4-6`, `claude-opus-4-6` |
| `openai` | `codex` | `gpt-4o`, `gpt-5.4`, `o3` |
| `gemini` or `google` | `gemini` | `gemini-2.5-pro`, `gemini-3.1-pro-preview-customtools` |

If `llm_provider` is omitted, the provider is auto-detected from the model name. If both are omitted, it defaults to Anthropic.

## Testing

```bash
npm test
```

## Build

```bash
npm run build
```

Compiles TypeScript to `dist/`. The compiled CLI is at `dist/cli.js`.

## Specs

- [Attractor Specification](./attractor-spec.md)
- [Coding Agent Loop Specification](./coding-agent-loop-spec.md)
- [Unified LLM Client Specification](./unified-llm-spec.md)

## Terminology

- **NLSpec** (Natural Language Spec): a human-readable spec intended to be directly usable by coding agents to implement/validate behavior.
