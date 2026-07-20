import { expect, it } from 'vitest'
import { EffectCommitCoordinator } from '@qiongqi/loop'
import { InMemoryEffectResultStore, InMemoryRunEventStore } from '@qiongqi/adapter-storage'
import type { RunIdentity, RunStateV3 } from '@qiongqi/contracts'

const identity: RunIdentity = { ownerUserId: 'u1', workspaceKey: 'w1', threadId: 't1', turnId: 'tu1', runId: 'r1' }
const state: RunStateV3 = { version: 3, graphVersion: 'g1', runtimeMode: 'kernel_v3', ...identity, status: 'running', cursor: { stepIndex: 1, nodeId: 'tool', attempt: 0, checkpointSeq: 0 }, budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, recovery: { attempts: 0, maxAttempts: 1 }, middleware: {}, pendingEffects: [], committedEffects: [], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' }

it('prepares and commits an effect exactly once', async () => {
  const effects = new EffectCommitCoordinator({ events: new InMemoryRunEventStore(), results: new InMemoryEffectResultStore(), nowIso: () => '2026-07-15T00:00:00.000Z' })
  const prepared = effects.prepare(state, identity, { callId: 'c1', target: 'write', arguments: { path: 'a' } }, { effect: 'idempotent-write', replay: 'verify-first' })
  const first = await effects.commit(identity, prepared.state, prepared.intent, { ok: true })
  const second = await effects.commit(identity, first.state, prepared.intent, { ok: true })
  expect(first.state.committedEffects).toHaveLength(1)
  expect(second.state.committedEffects).toHaveLength(1)
})
