import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  saveCheckpoint,
  loadCheckpoint,
  writeStagePrompt,
  writeStageResponse,
  saveManifest,
} from './checkpoint.js'
import { Context } from './context.js'
import { Outcome } from './types.js'

describe('checkpoint', () => {
  const tmpDirs: string[] = []

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'attractor-test-'))
    tmpDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
    tmpDirs.length = 0
  })

  it('saveCheckpoint creates a checkpoint.json file', () => {
    const logsRoot = makeTmpDir()
    const ctx = new Context()
    ctx.set('key', 'value')
    ctx.appendLog('step 1 complete')

    const outcome: Outcome = { status: 'success' }

    saveCheckpoint(
      logsRoot,
      'nodeB',
      ['nodeA'],
      { nodeA: 1 },
      { nodeA: outcome },
      ctx,
    )

    const checkpointPath = join(logsRoot, 'checkpoint.json')
    expect(existsSync(checkpointPath)).toBe(true)

    const data = JSON.parse(readFileSync(checkpointPath, 'utf-8'))
    expect(data.current_node).toBe('nodeB')
    expect(data.completed_nodes).toEqual(['nodeA'])
    expect(data.node_retries).toEqual({ nodeA: 1 })
    expect(data.context).toEqual({ key: 'value' })
    expect(data.logs).toEqual(['step 1 complete'])
    expect(typeof data.timestamp).toBe('string')
  })

  it('loadCheckpoint reads it back correctly', () => {
    const logsRoot = makeTmpDir()
    const ctx = new Context()
    ctx.set('alpha', 42)
    ctx.set('beta', 'hello')
    ctx.appendLog('log1')
    ctx.appendLog('log2')

    const outcomes: Record<string, Outcome> = {
      step1: { status: 'success', notes: 'all good' },
    }

    saveCheckpoint(logsRoot, 'step2', ['step1'], { step1: 0 }, outcomes, ctx)

    const loaded = loadCheckpoint(logsRoot)
    expect(loaded).not.toBeNull()
    expect(loaded!.current_node).toBe('step2')
    expect(loaded!.completed_nodes).toEqual(['step1'])
    expect(loaded!.node_retries).toEqual({ step1: 0 })
    expect(loaded!.node_outcomes.step1.status).toBe('success')
    expect(loaded!.context).toEqual({ alpha: 42, beta: 'hello' })
    expect(loaded!.logs).toEqual(['log1', 'log2'])
  })

  it('loadCheckpoint returns null when no checkpoint exists', () => {
    const logsRoot = makeTmpDir()
    expect(loadCheckpoint(logsRoot)).toBeNull()
  })

  it('writeStagePrompt creates a prompt.md file', () => {
    const logsRoot = makeTmpDir()
    const prompt = '# Plan\n\nCreate a hello world script.'

    writeStagePrompt(logsRoot, 'plan', prompt)

    const promptPath = join(logsRoot, 'plan', 'prompt.md')
    expect(existsSync(promptPath)).toBe(true)
    expect(readFileSync(promptPath, 'utf-8')).toBe(prompt)
  })

  it('writeStageResponse creates a response.md file', () => {
    const logsRoot = makeTmpDir()
    const response = '```python\nprint("Hello, world!")\n```'

    writeStageResponse(logsRoot, 'implement', response)

    const responsePath = join(logsRoot, 'implement', 'response.md')
    expect(existsSync(responsePath)).toBe(true)
    expect(readFileSync(responsePath, 'utf-8')).toBe(response)
  })

  it('saveManifest creates a manifest.json with pipeline name and goal', () => {
    const logsRoot = makeTmpDir()

    saveManifest(logsRoot, 'my_pipeline', 'Build something great')

    const manifestPath = join(logsRoot, 'manifest.json')
    expect(existsSync(manifestPath)).toBe(true)

    const data = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    expect(data.name).toBe('my_pipeline')
    expect(data.goal).toBe('Build something great')
    expect(typeof data.started_at).toBe('string')
  })
})
