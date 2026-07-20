import { describe, expect, it, vi } from 'vitest'
import { InMemoryRunEventStore, InMemoryRunStateStore } from '@qiongqi/adapter-storage'
import type { RunIdentity, RunStateV3 } from '@qiongqi/contracts'
import { RuntimeKernel, type ExecutionGraph } from '@qiongqi/loop'

const identity: RunIdentity = {
  ownerUserId: 'owner-1',
  workspaceKey: 'workspace-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  runId: 'run-1'
}

const graph: ExecutionGraph = {
  version: 'replay-v1',
  startNodeId: 'model',
  predicates: ['next'],
  nodes: [
    { id: 'model', kind: 'model', effect: 'model', checkpoint: 'both' },
    { id: 'evaluate', kind: 'evaluate', effect: 'pure', checkpoint: 'both' },
    { id: 'complete', kind: 'complete', effect: 'state', terminal: true, checkpoint: 'after' }
  ],
  edges: [
    { from: 'model', to: 'evaluate', when: 'next' },
    { from: 'evaluate', to: 'complete', when: 'next' }
  ]
}

function checkpointedState(): RunStateV3 {
  return {
    version: 3,
    graphVersion: graph.version,
    runtimeMode: 'kernel_v3',
    ...identity,
    status: 'running',
    cursor: { stepIndex: 0, nodeId: 'model', attempt: 0, checkpointSeq: 1 },
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    recovery: { attempts: 0, maxAttempts: 1 },
    middleware: {},
    nodeData: {},
    taskRevision: 0,
    pendingEffects: [],
    committedEffects: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z'
  }
}

describe('RuntimeKernel event replay', () => {
  it('reduces completed events after the checkpoint before executing the next node', async () => {
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    await snapshots.save(checkpointedState())
    await events.append({
      eventId: 'event-2',
      seq: 2,
      ...identity,
      stepId: 'model',
      nodeAttemptId: 'model:0',
      eventType: 'node.completed',
      payload: {
        nodeId: 'model',
        stepIndex: 0,
        condition: 'next',
        value: { proposalId: 'proposal-1' },
        commands: [{ type: 'set-task-revision', revision: 4 }]
      },
      timestamp: '2026-07-15T00:00:01.000Z'
    })
    const model = vi.fn(() => {
      throw new Error('completed model node must not run again')
    })
    const evaluate = vi.fn(() => ({ condition: 'next' }))
    const kernel = new RuntimeKernel({
      graph,
      snapshots,
      events,
      leases: snapshots,
      holderId: 'replay-holder',
      nowIso: () => '2026-07-15T00:00:02.000Z',
      nodes: {
        model,
        evaluate,
        complete: () => ({
          outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
        })
      }
    })

    await expect(kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })
    expect(model).not.toHaveBeenCalled()
    expect(evaluate).toHaveBeenCalledOnce()
    const restored = await snapshots.load(identity)
    expect(restored?.nodeData.model).toEqual({ proposalId: 'proposal-1' })
    expect(restored?.taskRevision).toBe(4)
    expect(restored?.status).toBe('completed')
  })
})
