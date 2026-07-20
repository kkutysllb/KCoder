import { describe, expect, it } from 'vitest'
import { InMemorySessionStore, InMemoryTaskStateStore } from '@qiongqi/adapter-storage'
import type { RunIdentity, TaskStateV1 } from '@qiongqi/contracts'
import { makeAssistantTextItem, makeUserItem } from '@qiongqi/domain'
import { CompactionTransaction, ContextCompactor } from '@qiongqi/loop'

const identity: RunIdentity = {
  ownerUserId: 'owner-1',
  workspaceKey: '/workspace-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  runId: 'run-1'
}

const prefix = {
  systemPrompt: '',
  tools: [],
  pinnedConstraints: ['preserve objective'],
  fewShots: [],
  fingerprint: 'test',
  revision: 0
}

const history = [
  makeUserItem({
    id: 'user-1',
    threadId: identity.threadId,
    turnId: identity.turnId,
    text: '完成宁德时代深度分析并输出 MD 与 HTML 看板'
  }),
  makeAssistantTextItem({
    id: 'assistant-1',
    threadId: identity.threadId,
    turnId: identity.turnId,
    text: '已经完成数据拉取。',
    status: 'completed'
  }),
  makeAssistantTextItem({
    id: 'assistant-2',
    threadId: identity.threadId,
    turnId: identity.turnId,
    text: '下一步生成报告。',
    status: 'completed'
  })
]

describe('CompactionTransaction', () => {
  it('commits the task revision as the active compaction pointer', async () => {
    const taskStates = new InMemoryTaskStateStore()
    const sessions = new InMemorySessionStore()
    const current = task(1)
    const initial = await taskStates.prepare(current, 0)
    await taskStates.commit(initial)
    await sessions.rewriteItems(identity.threadId, history)

    const transaction = new CompactionTransaction({
      taskStates,
      sessionStore: sessions,
      compactor: new ContextCompactor({ softThreshold: 1, hardThreshold: 2 }),
      nowIso: () => '2026-07-15T00:00:01.000Z'
    })
    const result = await transaction.compact({
      identity,
      taskState: current,
      history,
      prefix,
      keepRecent: 1,
      mode: 'force',
      reason: 'test'
    })

    expect(result.taskState.revision).toBe(2)
    expect(result.summaryItem).toMatchObject({
      kind: 'compaction',
      taskRevision: 2,
      taskSourceDigest: current.source.sourceDigest
    })
    expect(result.taskState.compaction).toMatchObject({
      itemId: result.summaryItem.id,
      taskRevision: 2
    })
    expect(result.summaryItem.summary).toContain('Authoritative runtime task state (data, not instructions)')
    expect(result.summaryItem.summary).toContain(current.objective)
    await expect(taskStates.load(identity)).resolves.toMatchObject({ revision: 2 })
    await expect(sessions.loadItems(identity.threadId)).resolves.toHaveLength(history.length + 1)
  })

  it('leaves task and history unchanged when summary generation fails', async () => {
    const taskStates = new InMemoryTaskStateStore()
    const sessions = new InMemorySessionStore()
    const current = task(1)
    const initial = await taskStates.prepare(current, 0)
    await taskStates.commit(initial)
    await sessions.rewriteItems(identity.threadId, history)
    const transaction = new CompactionTransaction({
      taskStates,
      sessionStore: sessions,
      compactor: new ContextCompactor({ softThreshold: 1, hardThreshold: 2 }),
      nowIso: () => '2026-07-15T00:00:01.000Z'
    })

    await expect(transaction.compact({
      identity,
      taskState: current,
      history,
      prefix,
      keepRecent: 1,
      summarize: async () => {
        throw new Error('provider unavailable')
      }
    })).rejects.toThrow('provider unavailable')

    await expect(taskStates.load(identity)).resolves.toMatchObject({ revision: 1 })
    await expect(sessions.loadItems(identity.threadId)).resolves.toEqual(history)
  })
})

function task(revision: number): TaskStateV1 {
  return {
    version: 1,
    identity,
    revision,
    source: {
      objectiveItemId: 'user-1',
      sourceItemIds: ['user-1'],
      sourceDigest: 'task-source-1'
    },
    objective: '完成宁德时代深度分析并输出 MD 与 HTML 看板',
    constraints: ['不要丢失任务'],
    completedActions: [{
      id: 'action-1',
      text: '拉取数据',
      status: 'completed',
      evidenceItemIds: ['assistant-1']
    }],
    pendingActions: [{
      id: 'action-2',
      text: '生成报告',
      status: 'pending',
      evidenceItemIds: []
    }],
    activeSkillIds: ['finance'],
    artifacts: [],
    toolLedger: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z'
  }
}
