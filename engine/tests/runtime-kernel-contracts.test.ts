import { describe, expect, it } from 'vitest'
import {
  makeRunIdentity,
  makeRunOutcome,
  RunIdentitySchema,
  RunStateV3Schema
} from '@qiongqi/contracts'

describe('runtime kernel contracts', () => {
  it('requires a complete run identity', () => {
    expect(makeRunIdentity({
      ownerUserId: 'u1', threadId: 't1', turnId: 'tu1', runId: 'r1', workspaceKey: 'w1'
    })).toMatchObject({ ownerUserId: 'u1', runId: 'r1' })
    expect(() => makeRunIdentity({
      ownerUserId: '', threadId: 't1', turnId: 'tu1', runId: 'r1', workspaceKey: 'w1'
    })).toThrow()
    expect(() => RunIdentitySchema.parse({
      ownerUserId: 'u1', threadId: 't1', turnId: 'tu1', runId: 'r1'
    })).toThrow()
  })

  it('keeps terminal reasons structured', () => {
    expect(makeRunOutcome({
      status: 'degraded', reason: 'loop_capped', retryable: false, details: { count: 5 }
    })).toMatchObject({ status: 'degraded', reason: 'loop_capped', retryable: false })
  })

  it('accepts a complete version three run state', () => {
    const state = RunStateV3Schema.parse({
      version: 3, graphVersion: 'kernel-v3-default', runtimeMode: 'kernel_v3',
      ownerUserId: 'u1', threadId: 't1', turnId: 'tu1', runId: 'r1', workspaceKey: 'w1',
      status: 'created', cursor: { stepIndex: 0, nodeId: 'prepare', attempt: 0, checkpointSeq: 0 },
      budgets: { stepsUsed: 0, toolCallsUsed: 0 }, recovery: { attempts: 0, maxAttempts: 1 },
      middleware: {}, pendingEffects: [], committedEffects: [],
      createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z'
    })
    expect(state.version).toBe(3)
  })
})
