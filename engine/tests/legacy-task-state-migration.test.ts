import { describe, expect, it } from 'vitest'
import type { RunIdentity, ThreadRecord, TurnItem } from '@qiongqi/contracts'
import { InMemoryTaskStateStore } from '@qiongqi/adapter-storage'
import { createThreadRecord, makeAssistantTextItem, makeCompactionItem, makeUserItem } from '@qiongqi/domain'
import { migrateLegacyTaskState } from '@qiongqi/loop'

const identity: RunIdentity = {
  ownerUserId: 'owner-1',
  workspaceKey: '/workspace',
  threadId: 'thread-1',
  turnId: 'turn-2',
  runId: 'run-2'
}

describe('migrateLegacyTaskState', () => {
  it('migrates the latest trusted substantive user objective exactly once', async () => {
    const store = new InMemoryTaskStateStore()
    const items = [
      user('user-1', 'turn-1', '完成宁德时代深度分析'),
      assistant('assistant-1', 'turn-1', '下一步执行股指期货分析'),
      user('user-2', 'turn-2', '继续')
    ]

    const first = await migrateLegacyTaskState({
      identity,
      thread: thread(),
      items,
      store,
      nowIso: () => 'now'
    })
    const second = await migrateLegacyTaskState({
      identity,
      thread: thread(),
      items,
      store,
      nowIso: () => 'later'
    })

    expect(first.kind).toBe('created')
    expect(first.state.objective).toContain('宁德时代')
    expect(first.state.objective).not.toContain('股指期货')
    expect(first.state.migration).toMatchObject({ source: 'legacy_thread', confidence: 'high' })
    expect(second.kind).toBe('existing')
    expect(second.state.revision).toBe(1)
  })

  it('does not use an unverifiable compaction summary as the objective', async () => {
    const store = new InMemoryTaskStateStore()
    const result = await migrateLegacyTaskState({
      identity,
      thread: thread(),
      items: [makeCompactionItem({
        id: 'compaction-1',
        threadId: identity.threadId,
        turnId: identity.turnId,
        summary: 'Active objective: 错误的股指期货任务',
        replacedTokens: 100,
        pinnedConstraints: []
      })],
      store,
      nowIso: () => 'now'
    })

    expect(result.kind).toBe('insufficient_trusted_source')
    expect(await store.load(identity)).toBeUndefined()
  })

  it('rejects owner and workspace mismatches without writing state', async () => {
    for (const badThread of [
      thread({ ownerUserId: 'owner-2' }),
      thread({ workspace: '/other-workspace' })
    ]) {
      const store = new InMemoryTaskStateStore()
      const result = await migrateLegacyTaskState({
        identity,
        thread: badThread,
        items: [user('user-1', 'turn-1', '可信任务')],
        store,
        nowIso: () => 'now'
      })

      expect(result.kind).toBe('scope_violation')
      expect(await store.load(identity)).toBeUndefined()
    }
  })
})

function thread(input: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    ...createThreadRecord({
      id: identity.threadId,
      ownerUserId: identity.ownerUserId,
      title: 'Legacy task',
      workspace: identity.workspaceKey,
      model: 'test'
    }),
    ...input
  }
}

function user(id: string, turnId: string, text: string): TurnItem {
  return makeUserItem({ id, threadId: identity.threadId, turnId, text })
}

function assistant(id: string, turnId: string, text: string): TurnItem {
  return makeAssistantTextItem({
    id,
    threadId: identity.threadId,
    turnId,
    text,
    status: 'completed'
  })
}
