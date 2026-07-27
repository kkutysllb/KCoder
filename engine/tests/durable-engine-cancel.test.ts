import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import {
  compileAgentGraph,
  createEngine,
  DurableKernelLifecycle,
  ModelProfileRegistry
} from '@qiongqi/loop'
import type { AgentGraph } from '@qiongqi/contracts'
import type { EngineRunRecord } from '@qiongqi/ports'
import type { ModelProvider } from '@qiongqi/ports'

const scope = { ownerId: 'owner-cancel', workspaceId: 'workspace-cancel', taskId: 'task-cancel' }
const timestamp = '2026-07-26T00:00:00.000Z'

function childRun(): EngineRunRecord {
  return {
    runId: 'kernel-cancel', scope, multiAgentRunId: 'multi-cancel', agentRunId: 'agent-cancel',
    kernelRunId: 'kernel-cancel', version: 1, status: 'running', desiredState: 'running',
    cursor: { nodeId: 'model', stepIndex: 1, checkpointSeq: 2 },
    parentRef: { kind: 'agent', runId: 'agent-cancel' },
    budgets: { stepsUsed: 1, toolCallsUsed: 0, inputTokens: 10, outputTokens: 0, costUsd: 0 },
    createdAt: timestamp, updatedAt: timestamp
  }
}

describe('durable cancellation', () => {
  it('cancels a governed root before propagating to its prepared child', async () => {
    const store = new InMemoryDurableEngineStore()
    const graph: AgentGraph = {
      version: 1,
      graphId: 'cancel-root-graph',
      startNodeId: 'agent',
      nodes: [{ id: 'agent', kind: 'agent', agentId: 'writer' }],
      edges: []
    }
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: timestamp })
    const capabilities = {
      streaming: true, toolCalling: true, structuredOutput: true, reasoning: false,
      inputModalities: ['text'], outputModalities: ['text']
    }
    const provider: ModelProvider = {
      providerId: 'provider',
      capabilities: () => capabilities,
      async *stream() { yield { kind: 'completed', stopReason: 'stop' } }
    }
    const registry = new ModelProfileRegistry()
    registry.register({
      profileId: 'model-a', revision: 1, providerId: 'provider', modelId: 'caller-model',
      endpointFormat: 'chat_completions', capabilities
    }, provider)
    const cancelled: string[] = []
    const engine = createEngine({
      store,
      modelRegistry: registry,
      kernelExecutor: {
        async execute() { return new Promise(() => undefined) },
        async resume() {},
        async cancel(executionRef) { cancelled.push(executionRef.kernelRunId) }
      },
      ids: (prefix) => `${prefix}-cancel-root`,
      nowIso: () => timestamp
    })
    await engine.publishGraph(revision)
    const started = await engine.start({
      scope,
      threadId: 'thread-cancel-root',
      turnId: 'turn-cancel-root',
      workspaceKey: 'workspace-cancel',
      prompt: 'run until cancelled',
      modelPolicy: { authorizedProfileIds: ['model-a'] },
      graphRef: { graphId: revision.graphId, revision: revision.revision },
      budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 }
    })

    await engine.cancel(started.multiAgentRunId)

    const graphRun = await store.loadGraphRun(started.multiAgentRunId)
    const root = await store.loadRun(started.multiAgentRunId)
    expect(graphRun).toMatchObject({ status: 'aborted' })
    expect(root).toMatchObject({ status: 'aborted', desiredState: 'cancelled' })
    expect(root?.version).toBe(graphRun?.version)
    expect(cancelled).toHaveLength(1)
  })

  it('keeps a requested cancellation authoritative over a late completed result', async () => {
    const store = new InMemoryDurableEngineStore()
    await store.commit({
      scope, runId: 'kernel-cancel', expectedRunVersion: 0, expectedTaskRevision: 0,
      runMutation: { type: 'put', record: childRun() }
    })
    const lifecycle = new DurableKernelLifecycle({ store, nowIso: () => timestamp })

    await lifecycle.requestCancel('kernel-cancel')
    await expect(lifecycle.checkCancellation('kernel-cancel')).resolves.toMatchObject({
      status: 'aborted', reason: 'user_aborted'
    })
    await lifecycle.completeKernelRun({
      scope,
      runId: 'kernel-cancel',
      executionRef: {
        scope, parentKind: 'agent', multiAgentRunId: 'multi-cancel', agentRunId: 'agent-cancel',
        parentRunId: 'agent-cancel', kernelRunId: 'kernel-cancel'
      },
      outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
      usage: { stepsUsed: 1, toolCallsUsed: 0, inputTokens: 10, outputTokens: 3, costUsd: 0.01 },
      usageRefs: ['usage-cancel'],
      artifactRefs: []
    })

    await expect(store.loadRun('kernel-cancel')).resolves.toMatchObject({
      status: 'aborted', desiredState: 'cancelled'
    })
    const claim = await store.claimWork('worker-cancel', ['agent_execution_completed'], 10_000)
    expect(claim?.payload).toMatchObject({ outcome: { status: 'aborted', reason: 'user_aborted' } })
  })
})
