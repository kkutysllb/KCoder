import { describe, expect, it } from 'vitest'
import { GraphRunRecordSchema } from '@qiongqi/contracts'
import { createThreadRecord } from '@qiongqi/domain'
import { buildRouter, dispatchRequest, type ServerRuntime } from '@qiongqi/http'
import { compileAgentGraph } from '@qiongqi/loop'
import { buildHarness, readJson } from './http-server-test-harness.js'

const auth = { authorization: 'Bearer tok-1', 'content-type': 'application/json' }
const timestamp = '2026-07-28T00:00:00.000Z'
const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'task-http' }

describe('governed DurableEngine HTTP facade', () => {
  it('returns 503 without a complete governed engine binding and 401 without auth', async () => {
    const h = buildHarness()
    const unavailable = await dispatchRequest(h.router, new Request('http://localhost/v1/engine/runs/run-1', {
      headers: auth
    }))
    expect(unavailable.status).toBe(503)

    const bound = governedHarness()
    const unauthorized = await dispatchRequest(bound.router, new Request('http://localhost/v1/engine/runs/run-1'))
    expect(unauthorized.status).toBe(401)
  })

  it('delegates the public graph and run lifecycle without exposing store mutation', async () => {
    const h = governedHarness()
    const revision = compileAgentGraph({
      version: 1,
      graphId: 'http-flow',
      startNodeId: 'agent',
      nodes: [{ id: 'agent', kind: 'agent', agentId: 'writer' }],
      edges: []
    }, { revision: 1, publishedAt: timestamp })
    h.engine.runs.set('run-1', graphRun('run-1', 'turn-1'))

    expect((await request(h, 'POST', '/v1/engine/graphs', revision)).status).toBe(201)
    expect((await request(h, 'GET', '/v1/engine/runs/run-1')).status).toBe(200)
    expect((await request(h, 'POST', '/v1/engine/runs/run-1/dispatch/serial', {
      multiAgentRunId: 'run-1', prompt: 'continue', requestedBudget: budget()
    })).status).toBe(200)
    expect((await request(h, 'POST', '/v1/engine/runs/run-1/dispatch/parallel', {
      multiAgentRunId: 'run-1', prompt: 'parallel', requestedBudgets: { left: budget(), right: budget() }
    })).status).toBe(200)
    expect((await request(h, 'POST', '/v1/engine/runs/run-1/completions', {
      multiAgentRunId: 'run-1',
      completion: {
        executionRef: {
          scope, parentKind: 'agent', multiAgentRunId: 'run-1', agentRunId: 'agent-1',
          parentRunId: 'agent-1', kernelRunId: 'kernel-1'
        },
        outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
        usageRefs: [], artifactRefs: []
      }
    })).status).toBe(200)
    expect((await request(h, 'POST', '/v1/engine/runs/run-1/kernel/resume', {
      executionRef: {
        scope, parentKind: 'agent', multiAgentRunId: 'run-1', agentRunId: 'agent-1',
        parentRunId: 'agent-1', kernelRunId: 'kernel-1'
      },
      resolution: { token: 'resume-token', revision: 1 }
    })).status).toBe(200)
    expect((await request(h, 'POST', '/v1/engine/runs/run-1/cancel', {
      multiAgentRunId: 'run-1'
    })).status).toBe(200)

    expect(h.engine.calls.map((call) => call.kind)).toEqual([
      'publish', 'inspect', 'serial', 'inspect', 'parallel', 'inspect',
      'completion', 'inspect', 'resume', 'inspect', 'cancel', 'inspect'
    ])
  })

  it('rejects path/body execution identity contradictions', async () => {
    const h = governedHarness()
    h.engine.runs.set('run-1', graphRun('run-1', 'turn-1'))
    const response = await request(h, 'POST', '/v1/engine/runs/run-1/dispatch/serial', {
      multiAgentRunId: 'run-forged', prompt: 'continue', requestedBudget: budget()
    })
    expect(response.status).toBe(409)
    expect(h.engine.calls).toEqual([])
  })

  it('starts governed Turns through DurableEngine and cancels the engine before aborting the Turn', async () => {
    const h = governedHarness()
    await h.base.threadStore.upsert(createThreadRecord({
      id: 'thread-governed', title: 'Governed', workspace: '/workspace', model: 'model-a', createdAt: timestamp
    }))
    const startedResponse = await request(h, 'POST', '/v1/threads/thread-governed/turns', {
      prompt: 'build governed report',
      governedExecution: {
        scope,
        graphRef: { graphId: 'http-flow', revision: 1 },
        budgetLimits: budget(),
        modelPolicy: { authorizedProfileIds: ['model-a'] }
      }
    })
    expect(startedResponse.status).toBe(202)
    const started = await readJson(startedResponse) as { turnId: string }
    await waitFor(async () => Boolean((await h.base.turnService.getTurn('thread-governed', started.turnId))?.governedBinding))

    h.engine.onCancel = async () => {
      expect((await h.base.turnService.getTurn('thread-governed', started.turnId))?.status).toBe('running')
    }
    const interrupted = await request(h, 'POST', `/v1/threads/thread-governed/turns/${started.turnId}/interrupt`, {})
    expect(interrupted.status).toBe(200)
    expect((await h.base.turnService.getTurn('thread-governed', started.turnId))?.status).toBe('aborted')
    expect(h.engine.calls.some((call) => call.kind === 'cancel')).toBe(true)
  })
})

function governedHarness() {
  const base = buildHarness()
  const engine = fakeEngine()
  base.runtime.governedEngine = { engine: engine as never, store: {
    listGraphRuns: async () => [...engine.runs.values()]
  } as never }
  base.runtime.durableEngineStore = base.runtime.governedEngine.store
  return { base, engine, router: buildRouter(base.runtime) }
}

function fakeEngine() {
  const runs = new Map<string, ReturnType<typeof graphRun>>()
  const calls: Array<{ kind: string; value?: unknown }> = []
  return {
    runs,
    calls,
    onCancel: undefined as (() => Promise<void>) | undefined,
    async start(input: { threadId: string; turnId: string }) {
      calls.push({ kind: 'start', value: input })
      const runId = `run:${input.turnId}`
      runs.set(runId, graphRun(runId, input.turnId, input.threadId))
      return { multiAgentRunId: runId, streamId: `stream:${runId}` }
    },
    async publishGraph(value: unknown) { calls.push({ kind: 'publish', value }) },
    async inspect(runId: string) {
      calls.push({ kind: 'inspect', value: runId })
      const run = runs.get(runId)
      if (!run) throw new Error(`GraphRun not found: ${runId}`)
      return { ...run, workEvents: [] }
    },
    async dispatchActiveAgent(value: unknown) { calls.push({ kind: 'serial', value }); return { status: 'running' } },
    async dispatchParallelAgents(value: unknown) { calls.push({ kind: 'parallel', value }); return { status: 'running' } },
    async consumeKernelCompletion(value: unknown) { calls.push({ kind: 'completion', value }); return { status: 'running' } },
    async resume(value: unknown, resolution: unknown) { calls.push({ kind: 'resume', value: { value, resolution } }) },
    async cancel(runId: string) {
      calls.push({ kind: 'cancel', value: runId })
      await this.onCancel?.()
      const run = runs.get(runId)
      if (run) runs.set(runId, { ...run, status: 'aborted' })
    }
  }
}

async function request(h: { router: ReturnType<typeof buildRouter> }, method: string, path: string, body?: unknown) {
  return dispatchRequest(h.router, new Request(`http://localhost${path}`, {
    method,
    headers: auth,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }))
}

function graphRun(runId: string, turnId: string, threadId = 'thread-1') {
  return GraphRunRecordSchema.parse({
    schemaVersion: 1, scope, runId, threadId, turnId, workspaceKey: '/workspace',
    graphId: 'http-flow', graphRevision: 1, graphDigest: 'a'.repeat(64), version: 1,
    status: 'running', circuitState: 'running', activeNodeIds: ['agent'], budgets: budget(),
    createdAt: timestamp, updatedAt: timestamp
  })
}

function budget() {
  return { stepsUsed: 10, toolCallsUsed: 5, inputTokens: 10_000, outputTokens: 2_000, costUsd: 1 }
}

async function waitFor(predicate: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('condition not reached')
}
