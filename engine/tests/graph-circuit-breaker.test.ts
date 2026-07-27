import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import {
  GraphGovernor,
  compileAgentGraph,
  evaluateGraphCircuit
} from '@qiongqi/loop'
import type { GraphCircuitPolicy, GraphRunRecord, TaskScope } from '@qiongqi/contracts'

const scope: TaskScope = { ownerId: 'owner-circuit', workspaceId: 'workspace-circuit', taskId: 'task-circuit' }
const timestamp = '2026-07-26T00:00:00.000Z'
const policy: GraphCircuitPolicy = {
  policyId: 'production-circuit',
  revision: 1,
  reportOnlyBudgetRatio: 0.8,
  pauseDuplicateRatio: 0.4,
  retireFailureCount: 5,
  maxOutboxAgeMs: 30_000
}

describe('graph circuit breaker', () => {
  it('degrades to report_only at the configured budget threshold', () => {
    expect(evaluateGraphCircuit(policy, {
      budgetRatio: 0.8, duplicateRatio: 0.1, failureCount: 0, outboxAgeMs: 0
    })).toMatchObject({ state: 'report_only', reason: 'budget_ratio' })
  })

  it('applies retired then paused then report_only threshold precedence', () => {
    expect(evaluateGraphCircuit(policy, {
      budgetRatio: 1, duplicateRatio: 1, failureCount: 5, outboxAgeMs: 60_000
    })).toMatchObject({ state: 'retired' })
    expect(evaluateGraphCircuit(policy, {
      budgetRatio: 1, duplicateRatio: 0.4, failureCount: 4, outboxAgeMs: 0
    })).toMatchObject({ state: 'paused', reason: 'duplicate_ratio' })
    expect(evaluateGraphCircuit(policy, {
      budgetRatio: 0.1, duplicateRatio: 0.1, failureCount: 0, outboxAgeMs: 30_000
    })).toMatchObject({ state: 'paused', reason: 'outbox_age' })
  })

  it('persists degradation and blocks write claims while allowing reads in report_only', async () => {
    const { store, governor } = await fixture()
    const degraded = await governor.evaluateCircuit('graph-circuit-run', policy, {
      budgetRatio: 0.9, duplicateRatio: 0, failureCount: 0, outboxAgeMs: 0
    })
    expect(degraded).toMatchObject({ circuitState: 'report_only', version: 2 })
    await expect(store.listWorkGraphEvents('graph-circuit-run', 0, 20)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'circuit_degraded', payload: expect.objectContaining({ reason: 'budget_ratio' }) })
    ]))

    await expect(governor.claimResource({
      runId: 'graph-circuit-run', claimId: 'write-claim', resourceKey: 'repository:main', mode: 'write',
      conflictStrategy: 'wait', ttlMs: 60_000
    })).rejects.toThrow(/report_only|write/)
    await expect(governor.claimResource({
      runId: 'graph-circuit-run', claimId: 'read-claim', resourceKey: 'repository:main', mode: 'read',
      conflictStrategy: 'wait', ttlMs: 60_000
    })).resolves.toMatchObject({ status: 'claimed' })
  })
})

async function fixture() {
  const store = new InMemoryDurableEngineStore()
  const revision = compileAgentGraph({
    version: 1,
    graphId: 'circuit-graph',
    startNodeId: 'agent',
    nodes: [{ id: 'agent', kind: 'agent', agentId: 'agent' }],
    edges: []
  }, { revision: 1, publishedAt: timestamp })
  const run: GraphRunRecord = {
    schemaVersion: 1, scope, runId: 'graph-circuit-run', threadId: 'thread-circuit', turnId: 'turn-circuit',
    workspaceKey: 'workspace-circuit', graphId: revision.graphId, graphRevision: revision.revision,
    graphDigest: revision.graphDigest, version: 1, status: 'running', circuitState: 'running', activeNodeIds: ['agent'],
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    createdAt: timestamp, updatedAt: timestamp
  }
  await store.commit({
    scope, runId: run.runId, expectedRunVersion: 0, expectedTaskRevision: 0,
    graphRevisionMutations: [{ type: 'put', record: revision }], graphRunMutation: { type: 'put', record: run }
  })
  return { store, governor: new GraphGovernor({ store, graphRevision: revision, ids: nextId(), nowIso: () => timestamp }) }
}

function nextId(): (prefix: string) => string {
  let value = 0
  return (prefix) => `${prefix}-${++value}`
}
