import { describe, expect, it } from 'vitest'
import type { TaskStateV1, ToolObservation } from '@qiongqi/contracts'
import { projectTaskState } from '@qiongqi/loop'
import { TaskProgressProjector } from '@qiongqi/loop'
import { InMemoryTaskStateStore } from '@qiongqi/adapter-storage'

const identity = { ownerUserId: 'u', workspaceKey: 'w', threadId: 't', turnId: 'tu', runId: 'r' }
const task: TaskStateV1 = {
  version: 1,
  identity,
  revision: 2,
  source: { objectiveItemId: 'u1', sourceItemIds: ['u1'], sourceDigest: 'source' },
  objective: '完成报告', constraints: [],
  completedActions: [],
  pendingActions: [{ id: 'a1', text: '读取数据', status: 'in_progress', evidenceItemIds: [] }],
  activeSkillIds: [], artifacts: [], toolLedger: [], createdAt: 'now', updatedAt: 'now'
}
const observation: ToolObservation = {
  callId: 'c1', toolName: 'read', effect: 'read', capabilityClass: 'filesystem.read',
  resourceKeys: ['data/a.json'], canonicalArgumentsDigest: 'args', resultDigest: 'result-1',
  resultItemId: 'result-item-1', artifactRefs: [], failed: false, replayed: false
}

describe('task progress projector', () => {
  it('classifies a new structured observation as weak progress without treating ledger ids as progress', () => {
    const first = projectTaskState(task, { observations: [observation], nowIso: () => 'later' })
    expect(first.digest.level).toBe('weak')
    expect(first.state.progress?.evidenceCount).toBe(1)
    const replay = projectTaskState(first.state, { observations: [{ ...observation, replayed: true }], nowIso: () => 'later2' })
    expect(replay.digest.level).toBe('none')
    expect(replay.state.revision).toBe(first.state.revision)
  })

  it('classifies action completion and artifact creation as strong progress', () => {
    const projected = projectTaskState(task, {
      todos: [{ id: 'a1', content: '读取数据', status: 'completed' }],
      observations: [{ ...observation, artifactRefs: [{ path: 'report.md', kind: 'report', producedByCallId: 'c1' }] }],
      nowIso: () => 'later'
    })
    expect(projected.digest.level).toBe('strong')
    expect(projected.state.completedActions[0]?.id).toBe('a1')
    expect(projected.state.artifacts).toMatchObject([{ path: 'report.md', kind: 'report' }])
  })

  it('does not mutate or advance a task on ledger-only or duplicate observations', () => {
    const projected = projectTaskState({ ...task, toolLedger: [{ callId: 'c1', toolName: 'read', status: 'committed', resultDigest: 'result-1' }] }, {
      observations: [{ ...observation, replayed: true }], nowIso: () => 'later'
    })
    expect(projected.digest.level).toBe('none')
    expect(projected.state.revision).toBe(task.revision)
  })

  it('commits projected state through a compare-and-swap revision', async () => {
    const store = new InMemoryTaskStateStore()
    const initial = { ...task, revision: 1 }
    await store.commit(await store.prepare(initial, 0))
    const projector = new TaskProgressProjector(store)
    const result = await projector.apply(identity, { observations: [observation], nowIso: () => 'later' })
    expect(result?.state.revision).toBe(2)
    await expect(store.load(identity)).resolves.toMatchObject({ revision: 2, progress: { evidenceCount: 1 } })
  })
})
