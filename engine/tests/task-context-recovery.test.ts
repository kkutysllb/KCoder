import { describe, expect, it } from 'vitest'
import type { RecoveryState, TaskStateV1 } from '@qiongqi/contracts'
import { contextRecoveryMiddleware, renderRecoveryContinuationEntry, transitionContextRecovery } from '@qiongqi/loop'

describe('task context recovery', () => {
  it('lets the production evaluator own structured context recovery routing', async () => {
    const middleware = contextRecoveryMiddleware()
    const result = await middleware.handle(
      {
        identity: task.identity,
        state: {} as never,
        node: { id: 'account-model', kind: 'account_model', effect: 'state' },
        hook: 'afterNode',
        facts: { proposalClass: 'context_discontinuity' },
        commands: []
      },
      async () => ({ value: 'next' })
    )

    expect(result).toMatchObject({ value: 'next' })
  })

  it('never commits repeated context discontinuity as final text', () => {
    const first = transitionContextRecovery({
      task,
      proposalClass: 'context_discontinuity',
      recovery: recovery(0)
    })
    const second = transitionContextRecovery({
      task,
      proposalClass: 'context_discontinuity',
      recovery: first.recovery
    })

    expect(first.action).toBe('recover')
    expect(first.commitAssistantText).toBe(false)
    expect(second.action).toBe('degrade')
    expect(second.outcome).toMatchObject({
      status: 'degraded',
      reason: 'context_recovery_exhausted',
      retryable: true
    })
    expect(second.commitAssistantText).toBe(false)
  })

  it('renders exactly one immediate pending action from authoritative state', () => {
    const entry = renderRecoveryContinuationEntry(task)
    expect(entry).toContain('Revision: 3')
    expect(entry).toContain('Objective: 完成宁德时代深度分析')
    expect(entry).toContain('Immediate next action: 生成 MD 报告')
    expect(entry).not.toContain('随后生成 HTML 看板')
    expect(entry).toContain('/outputs/data.json')
  })

  it('accepts a genuine user-input clarification', () => {
    const result = transitionContextRecovery({
      task,
      proposalClass: 'final_text',
      recovery: recovery(0)
    })
    expect(result).toMatchObject({ action: 'accept', commitAssistantText: true })
  })
})

function recovery(attempts: number): RecoveryState {
  return { attempts, maxAttempts: 1 }
}

const task: TaskStateV1 = {
  version: 1,
  identity: {
    ownerUserId: 'owner-1',
    workspaceKey: '/workspace-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    runId: 'run-1'
  },
  revision: 3,
  source: {
    objectiveItemId: 'user-1',
    sourceItemIds: ['user-1'],
    sourceDigest: 'source-1'
  },
  objective: '完成宁德时代深度分析',
  constraints: [],
  completedActions: [{
    id: 'done-1',
    text: '拉取财务数据',
    status: 'completed',
    evidenceItemIds: []
  }],
  pendingActions: [
    { id: 'next-1', text: '生成 MD 报告', status: 'in_progress', evidenceItemIds: [] },
    { id: 'next-2', text: '随后生成 HTML 看板', status: 'pending', evidenceItemIds: [] }
  ],
  activeSkillIds: ['finance'],
  artifacts: [{ path: '/outputs/data.json', kind: 'artifact' }],
  toolLedger: [],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z'
}
