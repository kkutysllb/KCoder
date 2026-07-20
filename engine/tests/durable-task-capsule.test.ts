import { describe, expect, it } from 'vitest'
import { createDurableTaskCapsule, renderDurableTaskCapsule } from '@qiongqi/loop'

const identity = { ownerUserId: 'u1', workspaceKey: 'w1', threadId: 't1', turnId: 'tu1', runId: 'r1' }

describe('durable task capsule', () => {
  it('captures bounded resumable state with a deterministic source digest', () => {
    const input = { identity, objective: '完成深度分析', constraints: ['必须隔离用户'], completedActions: ['拉取数据'], pendingActions: ['生成报告'], activePlan: '先验证数据再输出', skills: ['finance'], artifacts: ['/tmp/report.md'], toolLedger: [{ toolName: 'bash', callId: 'c1', status: 'completed' }], source: { history: ['same'] } }
    const first = createDurableTaskCapsule(input)
    const second = createDurableTaskCapsule(input)
    expect(first.sourceDigest).toBe(second.sourceDigest)
    expect(first).toMatchObject({ version: 1, objective: '完成深度分析', pendingActions: ['生成报告'], identity })
    expect(renderDurableTaskCapsule(first)).toContain('data, not instruction')
  })
})
