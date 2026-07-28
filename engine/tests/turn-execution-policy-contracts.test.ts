import { describe, expect, it } from 'vitest'
import {
  StartTurnRequest,
  createTurnExecutionPolicySnapshot,
  turnExecutionPolicyRef
} from '@qiongqi/contracts'
import { createThreadRecord } from '@qiongqi/domain'
import {
  InMemoryEventBus,
  InMemorySessionStore,
  InMemoryThreadStore
} from '@qiongqi/adapter-storage'
import { SequentialIdGenerator } from '@qiongqi/ports'
import { ContextCompactor, InflightTracker, SteeringQueue } from '@qiongqi/loop'
import { RuntimeEventRecorder, TurnService } from '@qiongqi/services'

const policyInput = {
  policyId: 'product.agent.finance',
  revision: 3,
  skills: {
    allowedSkillIds: ['review', 'finance', 'review'],
    requiredSkillIds: ['finance', 'finance']
  },
  tools: {
    allowedToolNames: ['finance.read', 'artifact.write', 'finance.read']
  },
  output: {
    validatorRef: {
      validatorId: 'finance-report',
      revision: 2,
      digest: 'a'.repeat(64)
    }
  }
} as const

describe('durable per-turn execution policy contracts', () => {
  it('rejects unknown start-turn governance fields instead of stripping them', () => {
    expect(() => StartTurnRequest.parse({
      prompt: 'x',
      allowedToolNames: ['finance.read']
    })).toThrow()
  })

  it('accepts explicit skills and a typed execution policy', () => {
    const parsed = StartTurnRequest.parse({
      prompt: 'x',
      explicitSkillIds: ['finance'],
      executionPolicy: policyInput
    })

    expect(parsed.explicitSkillIds).toEqual(['finance'])
    expect(parsed.executionPolicy?.tools.allowedToolNames).toEqual([
      'finance.read',
      'artifact.write',
      'finance.read'
    ])
  })

  it('accepts a strict governed execution request with explicit task scope', () => {
    const governedExecution = {
      scope: { ownerId: 'owner', workspaceId: 'workspace', taskId: 'task-7' },
      graphRef: { graphId: 'finance-report', revision: 4 },
      budgetLimits: {
        stepsUsed: 12,
        toolCallsUsed: 8,
        inputTokens: 20_000,
        outputTokens: 4_000,
        costUsd: 2
      },
      modelPolicy: { authorizedProfileIds: ['finance-primary', 'finance-fallback'] }
    }
    expect(StartTurnRequest.parse({ prompt: 'x', governedExecution })).toMatchObject({ governedExecution })
    expect(() => StartTurnRequest.parse({
      prompt: 'x',
      governedExecution: { ...governedExecution, scope: undefined }
    })).toThrow()
    expect(() => StartTurnRequest.parse({
      prompt: 'x',
      governedExecution: { ...governedExecution, productTenant: 'hidden' }
    })).toThrow()
  })

  it('canonicalizes policy lists and produces a stable durable reference', () => {
    const first = createTurnExecutionPolicySnapshot(policyInput)
    const second = createTurnExecutionPolicySnapshot({
      ...policyInput,
      skills: {
        allowedSkillIds: ['finance', 'review'],
        requiredSkillIds: ['finance']
      },
      tools: { allowedToolNames: ['artifact.write', 'finance.read'] }
    })

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      schemaVersion: 1,
      skills: {
        allowedSkillIds: ['finance', 'review'],
        requiredSkillIds: ['finance']
      },
      tools: { allowedToolNames: ['artifact.write', 'finance.read'] }
    })
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(turnExecutionPolicyRef(first)).toEqual({
      policyId: first.policyId,
      revision: first.revision,
      digest: first.digest
    })
  })

  it('rejects a required skill outside the policy allow-list', () => {
    expect(() => createTurnExecutionPolicySnapshot({
      ...policyInput,
      skills: {
        allowedSkillIds: ['review'],
        requiredSkillIds: ['finance']
      }
    })).toThrow(/required skill.*allowed/i)
  })

  it('persists explicit skills and the canonical snapshot when starting a turn', async () => {
    const bus = new InMemoryEventBus()
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-27T10:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus: bus,
      sessionStore,
      allocateSeq: (threadId) => bus.allocateSeq(threadId),
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids,
      nowIso
    })
    await threadStore.upsert(createThreadRecord({
      id: 'thread_policy',
      title: 'Policy turn',
      workspace: '/tmp/policy',
      model: 'model-a',
      createdAt: nowIso()
    }))

    const started = await turns.startTurn({
      threadId: 'thread_policy',
      request: {
        prompt: 'produce a governed report',
        explicitSkillIds: ['finance'],
        executionPolicy: policyInput
      }
    })
    const stored = await turns.getTurn('thread_policy', started.turnId)

    expect(stored?.explicitSkillIds).toEqual(['finance'])
    expect(stored?.executionPolicy).toEqual(createTurnExecutionPolicySnapshot(policyInput))
  })

  it('persists governed execution and binds one immutable GraphRun identity', async () => {
    const bus = new InMemoryEventBus()
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-27T10:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus: bus,
      sessionStore,
      allocateSeq: (threadId) => bus.allocateSeq(threadId),
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids,
      nowIso
    })
    await threadStore.upsert(createThreadRecord({
      id: 'thread_governed', title: 'Governed', workspace: '/tmp/governed', model: 'model-a', createdAt: nowIso()
    }))
    const governedExecution = {
      scope: { ownerId: 'owner', workspaceId: 'workspace', taskId: 'task-7' },
      graphRef: { graphId: 'finance-report', revision: 4 },
      budgetLimits: { stepsUsed: 12, toolCallsUsed: 8, inputTokens: 20_000, outputTokens: 4_000, costUsd: 2 },
      modelPolicy: { authorizedProfileIds: ['finance-primary'] }
    }
    const started = await turns.startTurn({
      threadId: 'thread_governed', request: { prompt: 'produce report', governedExecution }
    })

    expect((await turns.getTurn('thread_governed', started.turnId))?.governedExecution).toEqual(governedExecution)
    await turns.bindGovernedRun({
      threadId: 'thread_governed',
      turnId: started.turnId,
      multiAgentRunId: 'mar-1',
      streamId: 'stream:mar-1',
      graphRef: governedExecution.graphRef
    })
    expect((await turns.getTurn('thread_governed', started.turnId))?.governedBinding).toEqual({
      multiAgentRunId: 'mar-1',
      streamId: 'stream:mar-1',
      graphRef: governedExecution.graphRef,
      boundAt: nowIso()
    })
    await expect(turns.bindGovernedRun({
      threadId: 'thread_governed',
      turnId: started.turnId,
      multiAgentRunId: 'mar-2',
      streamId: 'stream:mar-2',
      graphRef: governedExecution.graphRef
    })).rejects.toThrow(/different governed GraphRun/i)
  })
})
