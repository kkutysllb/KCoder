import { describe, expect, it } from 'vitest'
import { InMemoryRunEventStore, InMemoryRunStateStore } from '@qiongqi/adapter-storage'
import { RuntimeKernel } from '@qiongqi/loop'
import type { RunIdentity, RunOutcome } from '@qiongqi/contracts'

const baseIdentity: RunIdentity = {
  ownerUserId: 'owner-1', workspaceKey: 'workspace-1', threadId: 'thread-1', turnId: 'turn-1', runId: 'run-1'
}

const waitingCases: Array<{
  status: string
  outcome: RunOutcome
}> = [
  { status: 'waiting_input', outcome: { status: 'suspended', reason: 'awaiting_user_input', retryable: true } },
  {
    status: 'waiting_approval',
    outcome: { status: 'suspended', reason: 'required_action_missing', retryable: true, details: { code: 'approval_required' } }
  },
  {
    status: 'waiting_effect_verification',
    outcome: { status: 'suspended', reason: 'required_action_missing', retryable: true, details: { code: 'effect_requires_verification' } }
  },
  {
    status: 'waiting_model_resolution',
    outcome: { status: 'suspended', reason: 'runtime_error', retryable: true, details: { code: 'model_resolution_required' } }
  }
]

describe('RuntimeKernel explicit resume', () => {
  it.each(waitingCases)('keeps $status nonterminal and consumes its resume token once', async ({ status, outcome }) => {
    const snapshots = new InMemoryRunStateStore()
    const identity = { ...baseIdentity, runId: `run-${status}` }
    let attempts = 0
    const kernel = new RuntimeKernel({
      graph: {
        version: 'resume-v1', startNodeId: 'wait', predicates: ['next'],
        nodes: [{ id: 'wait', kind: 'wait', effect: 'state', terminal: true, checkpoint: 'after' }], edges: []
      },
      snapshots,
      events: new InMemoryRunEventStore(),
      leases: snapshots,
      holderId: `holder-${status}`,
      nodes: {
        wait: () => attempts++ === 0
          ? { outcome }
          : { outcome: { status: 'completed', reason: 'normal_stop', retryable: false } }
      }
    })

    const suspended = await kernel.run(identity)
    expect(suspended).toMatchObject({
      status: 'suspended',
      details: { suspensionToken: expect.any(String), suspensionRevision: expect.any(Number) }
    })
    await expect(snapshots.load(identity)).resolves.toMatchObject({ status })
    await expect(kernel.run(identity)).resolves.toEqual(suspended)
    expect(attempts).toBe(1)

    const details = suspended.details as { suspensionToken: string; suspensionRevision: number }
    await expect(kernel.resume(identity, {
      token: 'wrong-token', revision: details.suspensionRevision, resolution: { approved: true }
    })).rejects.toThrow(/token/)
    await expect(kernel.resume(identity, {
      token: details.suspensionToken, revision: details.suspensionRevision + 1, resolution: { approved: true }
    })).rejects.toThrow(/revision/)
    await expect(kernel.resume(identity, {
      token: details.suspensionToken, revision: details.suspensionRevision, resolution: { approved: true }
    })).resolves.toMatchObject({ status: 'completed' })
    await expect(kernel.resume(identity, {
      token: details.suspensionToken, revision: details.suspensionRevision, resolution: { approved: true }
    })).rejects.toThrow(/not waiting|consumed/)
  })
})
