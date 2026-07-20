import { expect, it } from 'vitest'
import { InMemoryEffectResultStore, InMemoryRunEventStore } from '@qiongqi/adapter-storage'
import { EffectCommitCoordinator, InflightTracker, ToolCallCoordinator, ToolRuntimeV3 } from '@qiongqi/loop'
import type { RunStateV3 } from '@qiongqi/contracts'
import type { ToolCallLike, ToolHost, ToolHostContext } from '@qiongqi/ports'

it('routes coordinator tool execution through ToolRuntimeV3 when configured', async () => {
  const events = new InMemoryRunEventStore()
  let executions = 0
  const host: ToolHost = { id: 'host', async listTools() { return [] }, async execute() { executions += 1; return { item: {} as never, approved: true } } }
  const runtime = new ToolRuntimeV3({ toolHost: host, effects: new EffectCommitCoordinator({ events, results: new InMemoryEffectResultStore() }) })
  const identity = { ownerUserId: 'u', workspaceKey: 'w', threadId: 't', turnId: 'tu', runId: 'r' }
  const state: RunStateV3 = { version: 3, graphVersion: 'g', runtimeMode: 'kernel_v3', ...identity, status: 'running', cursor: { stepIndex: 0, nodeId: 'tool', attempt: 0, checkpointSeq: 0 }, budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, recovery: { attempts: 0, maxAttempts: 1 }, middleware: {}, pendingEffects: [], committedEffects: [], createdAt: 'now', updatedAt: 'now' }
  let latestState = state
  const coordinator = new ToolCallCoordinator({ toolHost: host, toolRuntime: runtime, approvalGate: {} as never, userInputGate: {} as never, inflight: new InflightTracker(), events: {} as never, turns: {} as never, ids: {} as never, nowIso: () => 'now', memoryStoreEnabled: false })
  const context = { threadId: 't', turnId: 'tu', workspace: 'w', approvalPolicy: 'trusted', abortSignal: new AbortController().signal, awaitApproval: async () => 'allow', runtimeIdentity: identity, runtimeState: state, runtimeStateSink: (next: RunStateV3) => { latestState = next } } as ToolHostContext
  const call: ToolCallLike = { callId: 'c1', toolName: 'read', arguments: {} }
  await coordinator.executeToolCall({ threadId: 't', turnId: 'tu', call, context })
  expect(executions).toBe(1)
  expect(latestState.committedEffects).toHaveLength(1)
  expect(await events.listAfter(identity, 0)).toHaveLength(2)
})
