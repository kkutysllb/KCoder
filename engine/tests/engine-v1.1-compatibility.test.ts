import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore, InMemoryMailboxStore, InMemoryMultiAgentRunStore } from '@qiongqi/adapter-storage'
import {
  compileAgentGraph,
  createEngine,
  EventedV2MultiAgentRuntime,
  KernelAgentExecutor,
  ModelProfileRegistry
} from '@qiongqi/loop'
import type { AgentGraph, ModelSelectionPolicy } from '@qiongqi/contracts'
import type { ModelProvider } from '@qiongqi/ports'

const scope = { ownerId: 'owner-compat', workspaceId: 'workspace-compat', taskId: 'task-compat' }
const graph: AgentGraph = {
  version: 1, graphId: 'compat-graph', startNodeId: 'agent',
  nodes: [{ id: 'agent', kind: 'agent', agentId: 'agent' }], edges: []
}
const capabilities = {
  streaming: true, toolCalling: true, structuredOutput: true, reasoning: false,
  inputModalities: ['text'], outputModalities: ['text']
}
const provider: ModelProvider = {
  providerId: 'provider', capabilities: () => capabilities,
  async *stream() { yield { kind: 'completed', stopReason: 'stop' } }
}
const policy: ModelSelectionPolicy = { authorizedProfileIds: ['model-a'] }
const budgetLimits = { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 }

describe('engine v1.1 compatibility', () => {
  it('keeps the v1.0 start shape valid when graphRef is omitted', async () => {
    const { engine } = fixture(new InMemoryDurableEngineStore())
    const started = await engine.start({
      scope, threadId: 'legacy-thread', turnId: 'legacy-turn', workspaceKey: 'workspace',
      prompt: 'legacy start', modelPolicy: policy
    })
    expect(started.streamId).toBe(`stream:${started.multiAgentRunId}`)
  })

  it('inspects a governed run after reconstructing the facade', async () => {
    const store = new InMemoryDurableEngineStore()
    const first = fixture(store)
    const revision = compileAgentGraph(graph, { revision: 1, publishedAt: '2026-07-26T00:00:00.000Z' })
    await first.engine.publishGraph(revision)
    const started = await first.engine.start({
      scope, threadId: 'durable-thread', turnId: 'durable-turn', workspaceKey: 'workspace',
      prompt: 'durable start', modelPolicy: policy,
      graphRef: { graphId: revision.graphId, revision: revision.revision },
      budgetLimits
    })

    const restarted = fixture(store)
    await expect(restarted.engine.inspect(started.multiAgentRunId)).resolves.toMatchObject({
      status: 'running', graphRevision: 1, graphDigest: revision.graphDigest
    })
  })
})

function fixture(store: InMemoryDurableEngineStore) {
  const registry = new ModelProfileRegistry()
  registry.register({
    profileId: 'model-a', revision: 1, providerId: 'provider', modelId: 'a',
    endpointFormat: 'chat_completions', capabilities
  }, provider)
  const kernelExecutor = new KernelAgentExecutor({
    store, ids: (prefix) => `${prefix}-kernel`,
    startKernel: async () => ({
      outcome: { status: 'completed', reason: 'normal_stop', retryable: false },
      usage: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      usageRefs: [], artifactRefs: []
    })
  })
  const orchestrator = new EventedV2MultiAgentRuntime({
    runs: new InMemoryMultiAgentRunStore(), mailbox: new InMemoryMailboxStore(), graph,
    ids: (prefix) => `${prefix}-legacy`, nowIso: () => '2026-07-26T00:00:00.000Z'
  })
  let nextId = 0
  return { engine: createEngine({
    store, modelRegistry: registry, kernelExecutor, orchestrator,
    ids: (prefix) => `${prefix}-${++nextId}`,
    nowIso: () => '2026-07-26T00:00:00.000Z'
  }) }
}
