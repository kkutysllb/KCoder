import { describe, expect, it } from 'vitest'
import { makeTaskState, TaskStateV1Schema } from '@qiongqi/contracts'

const identity = {
  ownerUserId: 'u1',
  workspaceKey: '/w1',
  threadId: 't1',
  turnId: 'tu1',
  runId: 'r1'
}

describe('TaskStateV1', () => {
  it('requires full run identity and a source objective item', () => {
    const task = makeTaskState({
      identity,
      revision: 1,
      source: {
        objectiveItemId: 'item-user-1',
        sourceItemIds: ['item-user-1'],
        sourceDigest: 'digest-1'
      },
      objective: '完成宁德时代深度分析',
      constraints: [],
      completedActions: [],
      pendingActions: [],
      activeSkillIds: ['kk-stock-analysis'],
      artifacts: [],
      toolLedger: [],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z'
    })

    expect(task.identity).toEqual(identity)
    expect(task.revision).toBe(1)
  })

  it('rejects an empty objective', () => {
    const value = validTaskValue()
    expect(TaskStateV1Schema.safeParse({ ...value, objective: '' }).success).toBe(false)
  })

  it('rejects duplicate action and tool call ids', () => {
    const value = validTaskValue()
    expect(TaskStateV1Schema.safeParse({
      ...value,
      completedActions: [
        { id: 'a1', text: 'done', status: 'completed', evidenceItemIds: [] },
        { id: 'a1', text: 'again', status: 'completed', evidenceItemIds: [] }
      ]
    }).success).toBe(false)
    expect(TaskStateV1Schema.safeParse({
      ...value,
      toolLedger: [
        { callId: 'c1', toolName: 'bash', status: 'committed' },
        { callId: 'c1', toolName: 'read', status: 'committed' }
      ]
    }).success).toBe(false)
  })
})

function validTaskValue(): Record<string, unknown> {
  return {
    version: 1,
    identity,
    revision: 1,
    source: {
      objectiveItemId: 'item-user-1',
      sourceItemIds: ['item-user-1'],
      sourceDigest: 'digest-1'
    },
    objective: '完成任务',
    constraints: [],
    completedActions: [],
    pendingActions: [],
    activeSkillIds: [],
    artifacts: [],
    toolLedger: [],
    createdAt: 'now',
    updatedAt: 'now'
  }
}
