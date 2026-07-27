import { describe, expect, it } from 'vitest'
import {
  createTaskCheckpoint,
  detectProgress,
  projectTaskCheckpoint,
  projectTaskCheckpointProgress,
  renderTaskCheckpointData
} from '@qiongqi/loop'
import type { CheckpointProvenance, DurableReference, TaskScope } from '@qiongqi/contracts'

const scope: TaskScope = { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' }
const firstTime = '2026-07-26T00:00:00.000Z'
const secondTime = '2026-07-26T00:01:00.000Z'
const provenance: CheckpointProvenance = {
  source: 'user:objective',
  digest: 'objective-digest',
  recordedAt: firstTime
}
const evidence: DurableReference = {
  ref: 'result://evidence-1',
  digest: 'evidence-digest-1',
  mediaType: 'application/json',
  provenance: { source: 'tool:read', digest: 'tool-call-digest', recordedAt: secondTime }
}

describe('TaskCheckpointV1 projection', () => {
  it('creates task-scoped authority without a run identity', () => {
    const checkpoint = createTaskCheckpoint({
      scope,
      objective: 'Upgrade the durable engine',
      constraints: ['Do not repeat physical effects'],
      provenance: [provenance],
      nowIso: () => firstTime
    })

    expect(checkpoint).toMatchObject({
      version: 1,
      scope,
      revision: 1,
      objective: 'Upgrade the durable engine',
      constraints: ['Do not repeat physical effects']
    })
    expect(checkpoint).not.toHaveProperty('identity')
    expect(JSON.stringify(checkpoint)).not.toContain('runId')
  })

  it('upserts durable task facts and increments only for structural changes', () => {
    const initial = createTaskCheckpoint({
      scope,
      objective: 'Upgrade the durable engine',
      constraints: ['Do not repeat physical effects'],
      provenance: [provenance],
      nowIso: () => firstTime
    })
    const update = {
      constraintUpdates: ['Keep model selection caller-controlled'],
      actionUpdates: [{ actionId: 'action-1', description: 'Journal model attempts', status: 'completed' as const }],
      nextAction: { actionId: 'action-2', description: 'Persist task checkpoint', status: 'running' as const },
      decisionUpdates: [{ decisionId: 'decision-1', digest: 'decision-digest', summary: 'Use TaskScope as authority' }],
      evidenceUpdates: [evidence],
      artifactUpdates: [{
        ref: 'artifact://report', digest: 'artifact-digest', mediaType: 'text/markdown',
        provenance: { source: 'tool:write', digest: 'write-digest', recordedAt: secondTime }
      }],
      resourceVersionUpdates: { repository: 'commit-1' },
      strategyUpdates: [{ strategyId: 'strategy-1', digest: 'strategy-digest', revision: 1 }],
      executionLedgerHighWater: 4,
      provenanceUpdates: [{ source: 'kernel:turn-b', digest: 'turn-b-digest', recordedAt: secondTime }],
      nowIso: () => secondTime
    }

    const projected = projectTaskCheckpoint(initial, update)
    const repeated = projectTaskCheckpoint(projected, update)

    expect(projected).toMatchObject({
      revision: 2,
      constraints: ['Do not repeat physical effects', 'Keep model selection caller-controlled'],
      actions: [{ actionId: 'action-1', status: 'completed' }],
      nextAction: { actionId: 'action-2', status: 'running' },
      committedDecisions: [{ decisionId: 'decision-1' }],
      evidenceRefs: [evidence],
      resourceVersions: { repository: 'commit-1' },
      attemptedStrategies: [{ strategyId: 'strategy-1', revision: 1 }],
      executionLedgerHighWater: 4,
      updatedAt: secondTime
    })
    expect(repeated).toEqual(projected)
    expect(detectProgress(initial, projected)).toMatchObject({ changed: true, level: 'strong' })
    expect(detectProgress(projected, repeated)).toMatchObject({ changed: false, level: 'none' })
  })

  it('rejects raw reasoning and full tool output fields', () => {
    const checkpoint = createTaskCheckpoint({
      scope,
      objective: 'Upgrade the durable engine',
      provenance: [provenance],
      nowIso: () => firstTime
    })

    expect(() => projectTaskCheckpoint(checkpoint, {
      rawReasoning: 'private chain of thought',
      nowIso: () => secondTime
    } as never)).toThrow(/unsupported task checkpoint update field: rawReasoning/)
    expect(() => projectTaskCheckpoint(checkpoint, {
      toolOutput: { full: 'unbounded output' },
      nowIso: () => secondTime
    } as never)).toThrow(/unsupported task checkpoint update field: toolOutput/)

    const rendered = renderTaskCheckpointData(checkpoint)
    expect(rendered).toContain('Authoritative TaskCheckpointV1 data')
    expect(rendered).not.toContain('private chain of thought')
    expect(rendered).not.toContain('unbounded output')
  })

  it('projects typed progress references and ignores replayed evidence', () => {
    const checkpoint = createTaskCheckpoint({
      scope,
      objective: 'Upgrade the durable engine',
      provenance: [provenance],
      nowIso: () => firstTime
    })
    const observation = {
      callId: 'call-1',
      toolName: 'read',
      effect: 'read' as const,
      capabilityClass: 'filesystem.read',
      resourceKeys: ['workspace://repo'],
      canonicalArgumentsDigest: 'arguments-digest',
      resultDigest: 'stable-result-digest',
      resultItemId: 'result-item-1',
      artifactRefs: [{ path: 'reports/status.md', kind: 'report' as const }],
      failed: false,
      replayed: false
    }
    const replayOnly = projectTaskCheckpointProgress(checkpoint, {
      observations: [{ ...observation, replayed: true }],
      kernelRunId: 'kernel-run-1',
      nowIso: () => secondTime
    })
    const projected = projectTaskCheckpointProgress(checkpoint, {
      todos: [{ id: 'action-1', content: 'Verify checkpoint', status: 'completed' }],
      observations: [observation],
      kernelRunId: 'kernel-run-1',
      nowIso: () => secondTime
    })
    const replayed = projectTaskCheckpointProgress(projected, {
      observations: [{ ...observation, callId: 'call-2', resultItemId: 'result-item-2', replayed: true }],
      kernelRunId: 'kernel-run-1',
      nowIso: () => '2026-07-26T00:02:00.000Z'
    })

    expect(replayOnly).toEqual(checkpoint)
    expect(projected).toMatchObject({
      revision: 2,
      actions: [{ actionId: 'action-1', status: 'completed' }],
      evidenceRefs: [{ ref: 'result://stable-result-digest', digest: 'stable-result-digest' }],
      artifactRefs: [{ ref: 'reports/status.md' }]
    })
    expect(replayed).toEqual(projected)
  })

  it('records attempted strategies without claiming task progress', () => {
    const checkpoint = createTaskCheckpoint({
      scope,
      objective: 'Upgrade the durable engine',
      provenance: [provenance],
      nowIso: () => firstTime
    })
    const projected = projectTaskCheckpoint(checkpoint, {
      strategyUpdates: [{ strategyId: 'retry-1', digest: 'changed-strategy', revision: 1 }],
      provenanceUpdates: [{ source: 'kernel:retry', digest: 'retry-digest', recordedAt: secondTime }],
      executionLedgerHighWater: 1,
      nowIso: () => secondTime
    })

    expect(projected.revision).toBe(2)
    expect(detectProgress(checkpoint, projected)).toMatchObject({ changed: true, level: 'none' })
  })
})
