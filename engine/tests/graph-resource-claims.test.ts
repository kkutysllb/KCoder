import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { GraphGovernor, compileAgentGraph } from '@qiongqi/loop'
import type { GraphRunRecord, TaskScope } from '@qiongqi/contracts'

const scope: TaskScope = { ownerId: 'owner-resource', workspaceId: 'workspace-resource', taskId: 'task-resource' }
const timestamp = '2026-07-26T00:00:00.000Z'

describe('fenced graph resource claims', () => {
  it.each(['wait', 'skip', 'escalate'] as const)('returns the configured %s decision on conflict', async (strategy) => {
    const { store, governor } = await fixture()
    const held = await governor.claimResource({
      runId: 'graph-resource-run',
      claimId: 'claim-held',
      resourceKey: 'repository:main',
      mode: 'write',
      conflictStrategy: 'wait',
      ttlMs: 60_000
    })
    expect(held).toMatchObject({ status: 'claimed', claim: { lease: { fence: 1 } } })

    const conflict = await governor.claimResource({
      runId: 'graph-resource-run',
      claimId: `claim-${strategy}`,
      resourceKey: 'repository:main',
      mode: 'read',
      conflictStrategy: strategy,
      ttlMs: 60_000
    })
    expect(conflict).toEqual({ status: strategy })
    await expect(store.listResourceClaims('repository:main')).resolves.toHaveLength(1)
  })

  it('renews and releases only the active token and fence', async () => {
    const { store, governor } = await fixture()
    const result = await governor.claimResource({
      runId: 'graph-resource-run',
      claimId: 'claim-reused',
      resourceKey: 'repository:main',
      mode: 'write',
      conflictStrategy: 'wait',
      ttlMs: 60_000
    })
    if (result.status !== 'claimed') throw new Error('expected resource claim')
    const first = result.claim
    const renewed = await governor.renewResourceClaim(first, 120_000)
    expect(renewed).toMatchObject({ claimId: first.claimId, lease: { token: first.lease.token, fence: 1 } })
    expect(Date.parse(renewed!.lease.expiresAt)).toBeGreaterThanOrEqual(Date.parse(first.lease.expiresAt))
    await governor.releaseResourceClaim(renewed!)
    await expect(store.listResourceClaims('repository:main')).resolves.toMatchObject([{ status: 'released' }])

    const replacement = await governor.claimResource({
      runId: 'graph-resource-run',
      claimId: 'claim-reused',
      resourceKey: 'repository:main',
      mode: 'write',
      conflictStrategy: 'wait',
      ttlMs: 60_000
    })
    if (replacement.status !== 'claimed') throw new Error('expected replacement resource claim')
    expect(replacement.claim.lease.fence).toBe(2)
    await expect(governor.releaseResourceClaim(first)).rejects.toThrow(/stale|active owner|fence/)
    await expect(store.listResourceClaims('repository:main')).resolves.toMatchObject([{
      status: 'active', lease: { fence: 2 }
    }])
  })
})

async function fixture() {
  const store = new InMemoryDurableEngineStore()
  const revision = compileAgentGraph({
    version: 1,
    graphId: 'resource-graph',
    startNodeId: 'agent',
    nodes: [{ id: 'agent', kind: 'agent', agentId: 'agent' }],
    edges: []
  }, { revision: 1, publishedAt: timestamp })
  const run: GraphRunRecord = {
    schemaVersion: 1,
    scope,
    runId: 'graph-resource-run',
    threadId: 'thread-resource',
    turnId: 'turn-resource',
    workspaceKey: 'workspace-resource',
    graphId: revision.graphId,
    graphRevision: revision.revision,
    graphDigest: revision.graphDigest,
    version: 1,
    status: 'running',
    circuitState: 'running',
    activeNodeIds: ['agent'],
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    createdAt: timestamp,
    updatedAt: timestamp
  }
  await store.commit({
    scope,
    runId: run.runId,
    expectedRunVersion: 0,
    expectedTaskRevision: 0,
    graphRevisionMutations: [{ type: 'put', record: revision }],
    graphRunMutation: { type: 'put', record: run }
  })
  return {
    store,
    governor: new GraphGovernor({ store, graphRevision: revision, ids: nextId(), nowIso: () => timestamp })
  }
}

function nextId(): (prefix: string) => string {
  let value = 0
  return (prefix) => `${prefix}-${++value}`
}
