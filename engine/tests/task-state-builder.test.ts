import { describe, expect, it } from 'vitest'
import type { RunIdentity, ThreadRecord, Turn, TurnItem } from '@qiongqi/contracts'
import {
  createThreadRecord,
  createTurnRecord,
  makeAssistantTextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserItem
} from '@qiongqi/domain'
import { buildTaskState } from '@qiongqi/loop'

const identity: RunIdentity = {
  ownerUserId: 'owner-1',
  workspaceKey: '/workspace',
  threadId: 'thread-1',
  turnId: 'turn-2',
  runId: 'run-2'
}

describe('buildTaskState', () => {
  it('keeps the latest substantive user task instead of continue or assistant text', () => {
    const items = [
      user('user-1', 'turn-1', '分析宁德时代并输出 MD 和 HTML'),
      assistant('assistant-1', 'turn-1', '下一步分析股指期货'),
      user('user-2', 'turn-2', '继续')
    ]
    const state = buildTaskState({
      identity,
      thread: thread(),
      turn: turn('继续'),
      items,
      nowIso: () => '2026-07-15T00:00:00.000Z'
    })

    expect(state.objective).toContain('宁德时代')
    expect(state.objective).not.toContain('股指期货')
    expect(state.source.objectiveItemId).toBe('user-1')
  })

  it('prefers a substantive current turn request over an older active goal', () => {
    const state = buildTaskState({
      identity,
      thread: thread({
        goal: {
          threadId: identity.threadId,
          objective: '旧目标：分析光模块',
          status: 'active',
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 'before',
          updatedAt: 'before'
        }
      }),
      turn: turn('新任务：分析宁德时代'),
      items: [user('user-current', 'turn-2', '新任务：分析宁德时代')],
      nowIso: () => 'now'
    })

    expect(state.objective).toBe('新任务：分析宁德时代')
  })

  it('uses the active goal when the current request only continues', () => {
    const state = buildTaskState({
      identity,
      thread: thread({
        goal: {
          threadId: identity.threadId,
          objective: '完成 QiongQi Kernel v3 重构',
          status: 'active',
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 'before',
          updatedAt: 'before'
        }
      }),
      turn: turn('继续'),
      items: [user('user-current', 'turn-2', '继续')],
      nowIso: () => 'now'
    })

    expect(state.objective).toBe('完成 QiongQi Kernel v3 重构')
    expect(state.source.objectiveItemId).toContain('goal:thread-1')
  })

  it('derives actions from explicit todos and committed tool results', () => {
    const currentThread = thread()
    currentThread.todos = {
      threadId: identity.threadId,
      updatedAt: 'now',
      items: [
        { id: 'todo-1', content: '读取代码', status: 'completed', createdAt: 'now', updatedAt: 'now' },
        { id: 'todo-2', content: '实现修复', status: 'in_progress', createdAt: 'now', updatedAt: 'now' }
      ]
    }
    const items = [
      user('user-current', 'turn-2', '修复上下文恢复'),
      makeToolCallItem({
        id: 'call-item',
        threadId: identity.threadId,
        turnId: identity.turnId,
        callId: 'call-1',
        toolName: 'read',
        arguments: { path: 'a.ts' },
        status: 'completed'
      }),
      makeToolResultItem({
        id: 'result-item',
        threadId: identity.threadId,
        turnId: identity.turnId,
        callId: 'call-1',
        toolName: 'read',
        output: { ok: true }
      })
    ]

    const state = buildTaskState({
      identity,
      thread: currentThread,
      turn: turn('修复上下文恢复'),
      items,
      activeSkillIds: ['coding'],
      nowIso: () => 'now'
    })

    expect(state.completedActions).toMatchObject([{ id: 'todo-1', status: 'completed' }])
    expect(state.pendingActions).toMatchObject([{ id: 'todo-2', status: 'in_progress' }])
    expect(state.toolLedger).toMatchObject([{ callId: 'call-1', toolName: 'read', status: 'committed' }])
    expect(state.activeSkillIds).toEqual(['coding'])
  })
})

function thread(input: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    ...createThreadRecord({
      id: identity.threadId,
      ownerUserId: identity.ownerUserId,
      title: 'Task',
      workspace: identity.workspaceKey,
      model: 'test'
    }),
    ...input
  }
}

function turn(prompt: string): Turn {
  return createTurnRecord({
    id: identity.turnId,
    threadId: identity.threadId,
    prompt,
    status: 'running'
  })
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
