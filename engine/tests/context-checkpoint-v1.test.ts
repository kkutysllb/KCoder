import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import {
  ContextCheckpointService,
  buildPromptLayers,
  createTaskCheckpoint,
  renderRecoveryContinuationEntry
} from '@qiongqi/loop'
import type { TaskScope } from '@qiongqi/contracts'

const scope: TaskScope = { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' }
const now = '2026-07-26T00:00:00.000Z'

describe('ContextCheckpointV1 service', () => {
  it('reuses deterministic identity without calling the summary model twice', async () => {
    const store = new InMemoryDurableEngineStore()
    let summaries = 0
    const service = new ContextCheckpointService({ store, nowIso: () => now })
    const taskCheckpoint = checkpoint()
    await store.commit({
      scope,
      runId: 'kernel-1',
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      taskCheckpointMutation: { type: 'put', record: taskCheckpoint }
    })
    const input = {
      scope,
      runId: 'kernel-1',
      sourceHistoryDigest: 'history-digest-1',
      coveredItems: [
        { id: 'user-1', digest: 'user-digest' },
        { id: 'tool-1', digest: 'tool-digest' }
      ],
      taskCheckpoint,
      memoryRevision: 3,
      ledgerHighWater: 7,
      policyVersion: 'policy-v1',
      contextCursor: 'item:tool-1',
      summarize: async () => {
        summaries += 1
        return 'bounded derived summary'
      }
    }

    const [first, concurrent] = await Promise.all([
      service.getOrCreate(input),
      service.getOrCreate(input)
    ])
    const second = await service.getOrCreate(input)

    expect(concurrent).toEqual(first)
    expect(second).toEqual(first)
    expect(summaries).toBe(1)
    expect(first).toMatchObject({
      scope,
      taskRevision: taskCheckpoint.revision,
      memoryRevision: 3,
      ledgerHighWater: 7,
      cursor: 'item:tool-1',
      coveredItemIds: ['user-1', 'tool-1'],
      summary: 'bounded derived summary'
    })
  })

  it('keeps structured recovery authoritative when prose summary is empty or corrupt', async () => {
    const taskCheckpoint = checkpoint()
    const layers = buildPromptLayers({
      immutableSystemPrefix: 'immutable engine policy',
      taskCheckpoint,
      taskSharedMemory: ['published decision'],
      agentPrivateMemory: ['private working note'],
      recentInteractions: ['latest user input'],
      derivedSummary: '',
      duplicateCorrectionFacts: ['operation tool-1 was replayed']
    })

    expect(layers.map((layer) => layer.kind)).toEqual([
      'immutable_system_prefix',
      'task_checkpoint',
      'task_shared_memory',
      'agent_private_memory',
      'recent_interactions',
      'derived_summary',
      'evidence_artifact_references',
      'duplicate_correction_facts'
    ])
    expect(layers[0]).toMatchObject({ trust: 'system' })
    expect(layers.slice(1).every((layer) => layer.trust === 'runtime_data')).toBe(true)
    const recovery = renderRecoveryContinuationEntry(taskCheckpoint)
    expect(recovery).toContain('Ship Engine v1')
    expect(recovery).toContain('Never repeat physical model calls')
    expect(recovery).toContain('Use caller-authorized profiles')
    expect(recovery).toContain('Continue Task 8')
  })

  it('commits a structured checkpoint without fabricated summary facts after summary failure', async () => {
    const store = new InMemoryDurableEngineStore()
    const taskCheckpoint = checkpoint()
    await store.commit({
      scope,
      runId: 'kernel-1',
      expectedRunVersion: 0,
      expectedTaskRevision: 0,
      taskCheckpointMutation: { type: 'put', record: taskCheckpoint }
    })
    const service = new ContextCheckpointService({ store, nowIso: () => now })
    const context = await service.getOrCreate({
      scope,
      runId: 'kernel-1',
      sourceHistoryDigest: 'history-digest-failed-summary',
      coveredItems: [{ id: 'user-1', digest: 'user-digest' }],
      taskCheckpoint,
      memoryRevision: 0,
      ledgerHighWater: 0,
      policyVersion: 'policy-v1',
      contextCursor: 'item:user-1',
      summarize: async () => { throw new Error('summary provider unavailable') }
    })

    expect(context.summary).toBeUndefined()
    await expect(store.loadContext(scope, context.contextId)).resolves.toEqual(context)
  })
})

function checkpoint() {
  return createTaskCheckpoint({
    scope,
    objective: 'Ship Engine v1',
    constraints: ['Never repeat physical model calls'],
    decisionUpdates: [{
      decisionId: 'model-neutrality',
      digest: 'caller-authorized',
      summary: 'Use caller-authorized profiles'
    }],
    evidenceUpdates: [{
      ref: 'result://tests', digest: 'tests-digest', mediaType: 'application/json',
      provenance: { source: 'kernel:test', digest: 'test-run', recordedAt: now }
    }],
    nextAction: { actionId: 'task-8', description: 'Continue Task 8', status: 'running' },
    provenance: [{ source: 'user:objective', digest: 'objective', recordedAt: now }],
    nowIso: () => now
  })
}
