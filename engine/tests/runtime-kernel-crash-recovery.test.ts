import { expect, it } from 'vitest'
import { EffectCommitCoordinator, ToolRuntimeV3 } from '@qiongqi/loop'
import { InMemoryEffectResultStore, InMemoryRunEventStore } from '@qiongqi/adapter-storage'

it('uses a stable idempotency key across retries', () => {
  const coordinator = new EffectCommitCoordinator({ events: new InMemoryRunEventStore(), results: new InMemoryEffectResultStore() })
  const identity = { ownerUserId: 'u', workspaceKey: 'w', threadId: 't', turnId: 'tu', runId: 'r' }
  expect(coordinator.idempotencyKey(identity, 'call-1')).toBe('u:w:r:call-1')
})

it('exposes deterministic crash injection points around effect commit', async () => {
  const points: string[] = []
  const runtime = new ToolRuntimeV3({
    toolHost: { id: 'test', async listTools() { return [] }, async execute() { return { item: {} as never, approved: true } } },
    effects: new EffectCommitCoordinator({ events: new InMemoryRunEventStore(), results: new InMemoryEffectResultStore() }),
    crashPoint: (point) => points.push(point)
  })
  const identity = { ownerUserId: 'u', workspaceKey: 'w', threadId: 't', turnId: 'tu', runId: 'r' }
  const state = { version: 3, graphVersion: 'g1', runtimeMode: 'kernel_v3' as const, ...identity, status: 'running' as const, cursor: { stepIndex: 1, nodeId: 'tool', attempt: 0, checkpointSeq: 0 }, budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, recovery: { attempts: 0, maxAttempts: 1 }, middleware: {}, pendingEffects: [], committedEffects: [], createdAt: 'now', updatedAt: 'now' }
  await runtime.execute({ identity, state, call: { callId: 'c', toolName: 'read', arguments: {} }, policy: { effect: 'read', replay: 'safe' }, context: { threadId: 't', turnId: 'tu', workspace: '/tmp', approvalPolicy: 'trusted', abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' } })
  expect(points).toEqual(['prepare', 'after_tool_execute', 'before_commit', 'after_commit'])
})
