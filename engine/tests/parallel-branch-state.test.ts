import { describe, expect, it } from 'vitest'
import { MultiAgentRunSchema, type JoinNode, type MultiAgentRun, type ParallelNode } from '@qiongqi/contracts'
import {
  abortOpenBranches,
  advanceBranch,
  buildJoinResult,
  joinReadiness,
  projectActiveNodeIds,
  projectBranchStatus,
  settleBranch,
  spawnParallelBranches
} from '@qiongqi/loop'

const now = '2026-07-27T00:00:00.000Z'

const parallel: ParallelNode = {
  id: 'fan_out',
  kind: 'parallel',
  branches: [
    { branchId: 'research', startNodeId: 'researcher' },
    { branchId: 'draft', startNodeId: 'writer' },
    { branchId: 'review', startNodeId: 'reviewer' }
  ],
  joinNodeId: 'join_all',
  failurePolicy: 'wait_all'
}

const join: JoinNode = {
  id: 'join_all',
  kind: 'join',
  sourceParallelNodeId: 'fan_out',
  requiredBranchIds: ['research', 'draft', 'review'],
  outputPolicy: 'all'
}

function rootRun(): MultiAgentRun {
  return MultiAgentRunSchema.parse({
    version: 1,
    runId: 'run_parallel',
    threadId: 'thread',
    turnId: 'turn',
    workspaceKey: 'workspace',
    status: 'running',
    graphId: 'graph',
    activeNodeId: 'fan_out',
    activeAgentStack: [],
    branchStatus: {},
    branches: {},
    agentRuns: [],
    events: [],
    outbox: [],
    retryCounters: {},
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    createdAt: now,
    updatedAt: now
  })
}

function spawned(): MultiAgentRun {
  return spawnParallelBranches(rootRun(), parallel, now)
}

function completeInOrder(order: readonly string[]): MultiAgentRun {
  let run = spawned()
  for (const branchId of order) {
    run = settleBranch(run, {
      branchId,
      status: 'completed',
      output: { branchId },
      usageRefs: [`usage:${branchId}`],
      artifactRefs: [`artifact:${branchId}`],
      nowIso: now
    })
  }
  return run
}

describe('durable parallel branch state', () => {
  it('spawns stable independent cursors and parks the coordinator at join', () => {
    const run = spawned()

    expect(run.activeNodeId).toBe('join_all')
    expect(Object.keys(run.branches)).toEqual(['draft', 'research', 'review'])
    expect(run.branches).toMatchObject({
      draft: { status: 'queued', activeNodeId: 'writer' },
      research: { status: 'queued', activeNodeId: 'researcher' },
      review: { status: 'queued', activeNodeId: 'reviewer' }
    })
    expect(run.branchStatus).toEqual({ draft: 'queued', research: 'queued', review: 'queued' })
  })

  it('advances one branch without changing sibling or coordinator cursors', () => {
    const run = advanceBranch(spawned(), 'review', 'review_wait', now, 'suspended')

    expect(run.activeNodeId).toBe('join_all')
    expect(run.branches.review).toMatchObject({ activeNodeId: 'review_wait', status: 'suspended' })
    expect(run.branches.research).toMatchObject({ activeNodeId: 'researcher', status: 'queued' })
    expect(projectBranchStatus(run.branches)).toEqual({ draft: 'queued', research: 'queued', review: 'running' })
    expect(projectActiveNodeIds(run)).toEqual(['join_all', 'writer', 'researcher', 'review_wait'])
  })

  it('makes terminal settlement idempotent and rejects a conflicting late result', () => {
    const settled = settleBranch(spawned(), {
      branchId: 'research', status: 'completed', output: { answer: 42 },
      usageRefs: ['usage:research'], artifactRefs: [], nowIso: now
    })
    const duplicate = settleBranch(settled, {
      branchId: 'research', status: 'completed', output: { answer: 42 },
      usageRefs: ['usage:research'], artifactRefs: [], nowIso: now
    })

    expect(duplicate).toEqual(settled)
    expect(() => settleBranch(settled, {
      branchId: 'research', status: 'completed', output: { answer: 43 },
      usageRefs: ['usage:research'], artifactRefs: [], nowIso: now
    })).toThrow('Durable branch terminal result conflicts: research')
  })

  it('builds byte-equivalent non-empty join output for different completion orders', () => {
    const first = buildJoinResult(completeInOrder(['research', 'draft', 'review']), join)
    const second = buildJoinResult(completeInOrder(['review', 'research', 'draft']), join)

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(Object.keys(first.branches)).toEqual(['draft', 'research', 'review'])
    expect(first.branches.review?.output).toEqual({ branchId: 'review' })
  })

  it('waits for all terminal branches and distinguishes failure', () => {
    const running = settleBranch(spawned(), {
      branchId: 'research', status: 'completed', output: 'facts', usageRefs: [], artifactRefs: [], nowIso: now
    })
    expect(joinReadiness(running, join)).toBe('waiting')

    let failed = settleBranch(running, {
      branchId: 'draft', status: 'failed', error: 'model failed', usageRefs: [], artifactRefs: [], nowIso: now
    })
    failed = settleBranch(failed, {
      branchId: 'review', status: 'completed', output: 'review', usageRefs: [], artifactRefs: [], nowIso: now
    })
    expect(joinReadiness(failed, join)).toBe('failed')
  })

  it('aborts only open branches', () => {
    const completed = settleBranch(spawned(), {
      branchId: 'research', status: 'completed', output: 'facts', usageRefs: [], artifactRefs: [], nowIso: now
    })
    const aborted = abortOpenBranches(completed, 'fan_out', now)

    expect(aborted.branches.research?.status).toBe('completed')
    expect(aborted.branches.draft?.status).toBe('aborted')
    expect(aborted.branches.review?.status).toBe('aborted')
  })
})
