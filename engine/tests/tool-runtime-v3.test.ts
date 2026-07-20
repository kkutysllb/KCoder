import { describe, expect, it } from 'vitest'
import { EffectCommitCoordinator, ToolRuntimeV3 } from '@qiongqi/loop'
import { InMemoryEffectResultStore, InMemoryRunEventStore } from '@qiongqi/adapter-storage'
import type { RunIdentity, RunStateV3 } from '@qiongqi/contracts'
import type { ToolHost, ToolHostContext } from '@qiongqi/ports'

const identity: RunIdentity = { ownerUserId: 'u1', workspaceKey: 'w1', threadId: 't1', turnId: 'tu1', runId: 'r1' }
const state: RunStateV3 = { version: 3, graphVersion: 'g1', runtimeMode: 'kernel_v3', ...identity, status: 'running', cursor: { stepIndex: 1, nodeId: 'tool', attempt: 0, checkpointSeq: 0 }, budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, recovery: { attempts: 0, maxAttempts: 1 }, middleware: {}, pendingEffects: [], committedEffects: [], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' }
const context = { threadId: 't1', turnId: 'tu1', workspace: '/tmp', approvalPolicy: 'trusted', abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' as const } as ToolHostContext

function host(counter: { value: number }): ToolHost {
  return { id: 'test', async listTools() { return [] }, async execute() { counter.value += 1; return { item: {} as never, approved: true } } }
}

describe('ToolRuntimeV3', () => {
  it('replays idempotent writes without executing twice', async () => {
    const counter = { value: 0 }
    const runtime = new ToolRuntimeV3({ toolHost: host(counter), effects: new EffectCommitCoordinator({ events: new InMemoryRunEventStore(), results: new InMemoryEffectResultStore() }) })
    const input = { identity, state, call: { callId: 'c1', toolName: 'write', arguments: {} }, context, policy: { effect: 'idempotent-write' as const, replay: 'verify-first' as const } }
    const first = await runtime.execute(input)
    const second = await runtime.execute({ ...input, state: first.state })
    expect(counter.value).toBe(1)
    expect(second.replayed).toBe(true)
  })

  it('suspends after a crash between non-idempotent execution and commit', async () => {
    const counter = { value: 0 }
    const runtime = new ToolRuntimeV3({ toolHost: host(counter), effects: new EffectCommitCoordinator({ events: new InMemoryRunEventStore(), results: new InMemoryEffectResultStore() }) })
    const result = await runtime.execute({ identity, state, call: { callId: 'c2', toolName: 'delete', arguments: {} }, context, policy: { effect: 'non-idempotent-write', replay: 'never' }, crashAfterExecute: true })
    expect(counter.value).toBe(1)
    expect(result.outcome).toMatchObject({ status: 'suspended' })
    expect(result.state.pendingEffects).toHaveLength(1)
  })
})
