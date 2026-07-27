import { describe, expect, it } from 'vitest'
import { InMemoryMailboxStore, InMemoryMultiAgentRunStore } from '@qiongqi/adapter-storage'
import type { AgentGraph } from '@qiongqi/contracts'
import { EventedV2MultiAgentRuntime } from '@qiongqi/loop'

describe('evented_v2 parallel external branches', () => {
  it('completes independent external branch cursors out of order before one deterministic join', async () => {
    const graph = parallelExternalGraph()
    let id = 0
    const runtime = new EventedV2MultiAgentRuntime({
      runs: new InMemoryMultiAgentRunStore(),
      mailbox: new InMemoryMailboxStore(),
      graph,
      ids: (prefix) => `${prefix}-${++id}`,
      nowIso: () => '2026-07-27T00:00:00.000Z'
    })
    const started = await runtime.start({
      threadId: 'thread', turnId: 'turn', workspaceKey: 'workspace', prompt: 'Run external branches.'
    })
    const parallel = await runtime.completeAgentTask({
      runId: started.runId, agentId: 'manager', condition: 'completed'
    })
    const model = parallel.agentRuns.find((agentRun) => agentRun.branchId === 'model')!
    await runtime.completeAgentTask({
      runId: started.runId,
      branchId: 'model',
      agentRunId: model.agentRunId,
      agentId: model.agentId,
      condition: 'completed',
      usageRefs: [],
      artifactRefs: []
    })
    await runtime.completeExternalNode({
      runId: started.runId,
      branchId: 'signal',
      nodeId: 'signal',
      condition: 'received',
      payload: { signal: 'ready' }
    })
    const completed = await runtime.completeExternalNode({
      runId: started.runId,
      branchId: 'tool',
      nodeId: 'tool',
      condition: 'completed',
      payload: { artifactRef: 'artifact:tool' }
    })

    expect(completed).toMatchObject({ status: 'completed', activeNodeId: 'done' })
    expect(completed.branches).toMatchObject({
      model: { status: 'completed' },
      signal: { status: 'completed', output: { signal: 'ready' } },
      tool: { status: 'completed', output: { artifactRef: 'artifact:tool' } }
    })
    expect(completed.events.filter((event) => event.type === 'join_completed')).toHaveLength(1)
  })
})

function parallelExternalGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'parallel_external',
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: 'manager' },
      {
        id: 'fan_out', kind: 'parallel', joinNodeId: 'join_all', failurePolicy: 'wait_all',
        branches: [
          { branchId: 'tool', startNodeId: 'tool' },
          { branchId: 'signal', startNodeId: 'signal' },
          { branchId: 'model', startNodeId: 'model' }
        ]
      },
      { id: 'tool', kind: 'tool', toolName: 'compile' },
      { id: 'signal', kind: 'wait', waitFor: 'external_event' },
      { id: 'model', kind: 'agent', agentId: 'model' },
      {
        id: 'join_all', kind: 'join', sourceParallelNodeId: 'fan_out',
        requiredBranchIds: ['tool', 'signal', 'model'], outputPolicy: 'all'
      },
      { id: 'done', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: 'fan_out', condition: 'completed' },
      { from: 'tool', to: 'join_all', condition: 'completed' },
      { from: 'signal', to: 'join_all', condition: 'received' },
      { from: 'model', to: 'join_all', condition: 'completed' },
      { from: 'join_all', to: 'done', condition: 'completed' }
    ]
  }
}
