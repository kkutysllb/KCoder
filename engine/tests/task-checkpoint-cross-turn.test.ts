import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore, InMemoryTaskStateStore } from '@qiongqi/adapter-storage'
import { makeUserItem } from '@qiongqi/domain'
import { createKernelV3NodeHandlers, createTaskCheckpoint, projectTaskCheckpoint } from '@qiongqi/loop'
import type { RunIdentity, RunStateV3, TaskScope } from '@qiongqi/contracts'

const scope: TaskScope = { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'durable-task-1' }
const otherScope: TaskScope = { ...scope, taskId: 'durable-task-2' }
const turnA: RunIdentity = {
  ownerUserId: 'owner-1', workspaceKey: 'workspace-1', threadId: 'thread-a', turnId: 'turn-a', runId: 'kernel-a'
}
const turnB: RunIdentity = {
  ownerUserId: 'owner-1', workspaceKey: 'workspace-1', threadId: 'thread-b', turnId: 'turn-b', runId: 'kernel-b'
}
const firstTime = '2026-07-26T00:00:00.000Z'
const secondTime = '2026-07-26T00:05:00.000Z'

describe('TaskCheckpointV1 cross-turn continuity', () => {
  it('survives different turn and Kernel identities while remaining task-isolated', async () => {
    const store = new InMemoryDurableEngineStore()
    const initial = createTaskCheckpoint({
      scope,
      objective: 'Deliver engine v1',
      constraints: ['Never bind the engine to one model'],
      actionUpdates: [{ actionId: 'task-6', description: 'Persist long-task state', status: 'running' }],
      nextAction: { actionId: 'task-6', description: 'Persist long-task state', status: 'running' },
      provenance: [{ source: `kernel:${turnA.runId}`, digest: 'turn-a-digest', recordedAt: firstTime }],
      nowIso: () => firstTime
    })
    await store.commit({
      scope,
      runId: turnA.runId,
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      taskCheckpointMutation: { type: 'put', record: initial }
    })

    const restoredInTurnB = await store.loadTask(scope)
    expect(restoredInTurnB).toBeDefined()
    const projected = projectTaskCheckpoint(restoredInTurnB!, {
      actionUpdates: [{ actionId: 'task-6', description: 'Persist long-task state', status: 'completed' }],
      nextAction: { actionId: 'task-7', description: 'Isolate task memory', status: 'pending' },
      decisionUpdates: [{ decisionId: 'model-policy', digest: 'caller-controlled', summary: 'Caller selects candidates' }],
      evidenceUpdates: [{
        ref: 'result://task-6-tests', digest: 'tests-green', mediaType: 'application/json',
        provenance: { source: `kernel:${turnB.runId}`, digest: 'test-run-digest', recordedAt: secondTime }
      }],
      artifactUpdates: [{
        ref: 'artifact://checkpoint', digest: 'checkpoint-digest', mediaType: 'application/json',
        provenance: { source: `kernel:${turnB.runId}`, digest: 'artifact-source', recordedAt: secondTime }
      }],
      strategyUpdates: [{ strategyId: 'inline-tdd', digest: 'red-green', revision: 1 }],
      provenanceUpdates: [{ source: `kernel:${turnB.runId}`, digest: 'turn-b-digest', recordedAt: secondTime }],
      nowIso: () => secondTime
    })
    await store.commit({
      scope,
      runId: turnB.runId,
      expectedRunVersion: 0,
      expectedTaskRevision: restoredInTurnB!.revision,
      taskCheckpointMutation: { type: 'put', record: projected }
    })

    await expect(store.loadTask(scope)).resolves.toMatchObject({
      scope,
      revision: 2,
      objective: 'Deliver engine v1',
      constraints: ['Never bind the engine to one model'],
      actions: [{ actionId: 'task-6', status: 'completed' }],
      nextAction: { actionId: 'task-7', status: 'pending' },
      committedDecisions: [{ decisionId: 'model-policy' }],
      evidenceRefs: [{ ref: 'result://task-6-tests' }],
      artifactRefs: [{ ref: 'artifact://checkpoint' }],
      attemptedStrategies: [{ strategyId: 'inline-tdd' }]
    })
    await expect(store.loadTask(otherScope)).resolves.toBeUndefined()
    expect(JSON.stringify(await store.loadTask(scope))).not.toContain('thread-a')
    expect(JSON.stringify(await store.loadTask(scope))).not.toContain('thread-b')
  })

  it('makes the Kernel restore node prefer TaskScope authority over run-bound legacy state', async () => {
    const store = new InMemoryDurableEngineStore()
    const checkpoint = createTaskCheckpoint({
      scope,
      objective: 'Authoritative cross-turn objective',
      constraints: ['Preserve negative constraints'],
      actionUpdates: [{ actionId: 'next', description: 'Continue from checkpoint', status: 'running' }],
      nextAction: { actionId: 'next', description: 'Continue from checkpoint', status: 'running' },
      provenance: [{ source: `kernel:${turnA.runId}`, digest: 'source-a', recordedAt: firstTime }],
      nowIso: () => firstTime
    })
    await store.commit({
      scope,
      runId: turnA.runId,
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      taskCheckpointMutation: { type: 'put', record: checkpoint }
    })

    const legacyTasks = new InMemoryTaskStateStore()
    const thread = {
      id: turnB.threadId,
      ownerUserId: turnB.ownerUserId,
      workspace: turnB.workspaceKey,
      title: 'legacy',
      status: 'running',
      turns: [],
      createdAt: secondTime,
      updatedAt: secondTime
    }
    const handlers = createKernelV3NodeHandlers({
      threadStore: { get: async () => thread },
      sessionStore: { loadItems: async () => [makeUserItem({
        id: 'legacy-user', threadId: turnB.threadId, turnId: turnB.turnId,
        text: 'Wrong run-bound objective'
      })] },
      taskStates: legacyTasks,
      taskCheckpoints: { store, resolveScope: () => scope },
      turns: {},
      promptBuilder: {},
      proposalRunner: {},
      toolRuntime: {},
      createToolContext: async () => ({}),
      ids: { next: (prefix: string) => `${prefix}-1` },
      nowIso: () => secondTime
    } as never)
    const state: RunStateV3 = {
      version: 3, graphVersion: 'test', runtimeMode: 'kernel_v3', ...turnB, status: 'running',
      cursor: { stepIndex: 1, nodeId: 'restore-task', attempt: 0, checkpointSeq: 0 },
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      recovery: { attempts: 0, maxAttempts: 1 }, middleware: {}, nodeData: {}, taskRevision: 0,
      pendingEffects: [], committedEffects: [], createdAt: secondTime, updatedAt: secondTime
    }

    const result = await handlers['restore-task']!({
      identity: turnB,
      state,
      node: { id: 'restore-task', kind: 'restore_task', effect: 'state' },
      hook: 'beforeNode'
    })

    expect(result?.value).toMatchObject({
      identity: turnB,
      objective: 'Authoritative cross-turn objective',
      constraints: ['Preserve negative constraints']
    })
    expect(result?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'set-task-revision', revision: checkpoint.revision }),
      expect.objectContaining({ type: 'set-node-data', nodeId: 'task-checkpoint', value: checkpoint })
    ]))
  })
})
