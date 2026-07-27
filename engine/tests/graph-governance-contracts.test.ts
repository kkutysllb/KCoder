import { describe, expect, it } from 'vitest'
import { HumanCheckpointSchema, ResourceClaimSchema } from '@qiongqi/contracts'

const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'task' }
const timestamp = '2026-07-26T00:00:00.000Z'

describe('graph governance contracts', () => {
  it('accepts a revision-bound human checkpoint with one resume edge', () => {
    expect(HumanCheckpointSchema.parse({
      checkpointId: 'checkpoint', scope, runId: 'run', graphId: 'graph', graphRevision: 1,
      nodeId: 'approval', policyRevision: 1, evidenceRefs: ['evidence:1'], approvalScope: ['deploy'],
      resumeEdgeId: 'approved-edge', resolutionToken: 'single-use-token', status: 'pending',
      expiresAt: timestamp, createdAt: timestamp, updatedAt: timestamp
    })).toMatchObject({ resumeEdgeId: 'approved-edge', status: 'pending' })
  })

  it('binds a parallel-branch checkpoint to its durable branch identity', () => {
    expect(HumanCheckpointSchema.parse({
      checkpointId: 'checkpoint-branch', scope, runId: 'run', graphId: 'graph', graphRevision: 1,
      nodeId: 'approval', branchId: 'review', policyRevision: 1, evidenceRefs: ['evidence:1'],
      approvalScope: ['publish'], resumeEdgeId: 'approved-edge', resolutionToken: 'single-use-token',
      status: 'pending', expiresAt: timestamp, createdAt: timestamp, updatedAt: timestamp
    })).toMatchObject({ nodeId: 'approval', branchId: 'review' })
  })

  it('requires one resume edge and a single-use token for a human checkpoint', () => {
    expect(() => HumanCheckpointSchema.parse({
      checkpointId: 'checkpoint', scope, runId: 'run', graphId: 'graph', graphRevision: 1,
      nodeId: 'approval', policyRevision: 1, evidenceRefs: [], approvalScope: ['deploy'],
      resumeEdgeId: '', resolutionToken: '', status: 'pending', expiresAt: timestamp,
      createdAt: timestamp, updatedAt: timestamp
    })).toThrow()
  })

  it('rejects write claims without a fence', () => {
    expect(() => ResourceClaimSchema.parse({
      claimId: 'claim', scope, resourceKey: 'workspace:file', mode: 'write',
      holderId: 'run', conflictStrategy: 'wait', status: 'active',
      lease: { token: 'lease', expiresAt: timestamp }, createdAt: timestamp, updatedAt: timestamp
    })).toThrow('write resource claims require a fence')
  })

  it('accepts an engine-neutral read claim', () => {
    expect(ResourceClaimSchema.parse({
      claimId: 'claim', scope, resourceKey: 'database:record:1', mode: 'read',
      holderId: 'run', conflictStrategy: 'skip', status: 'active',
      lease: { token: 'lease', expiresAt: timestamp }, createdAt: timestamp, updatedAt: timestamp
    })).toMatchObject({ mode: 'read', conflictStrategy: 'skip' })
  })
})
