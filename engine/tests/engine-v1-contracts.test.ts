import { describe, expect, it } from 'vitest'
import {
  AgentRunIdentitySchema,
  CostEntrySchema,
  ContextCheckpointV1Schema,
  DurableReferenceSchema,
  EngineStreamEventSchema,
  ExecutionLedgerEntrySchema,
  KernelRunIdentitySchema,
  ModelOperationIdentitySchema,
  MultiAgentRunIdentitySchema,
  ProgressCheckpointSchema,
  IsoTimestampSchema,
  RunOutcomeReasonSchema,
  RunOutcomeSchema,
  RunStatusSchema,
  TaskCheckpointV1Schema,
  TaskScopeSchema,
  ToolOperationIdentitySchema,
  ValueEventSchema,
  WaitingStateSchema,
  deriveContextId,
  encodeAgentRunIdentity,
  encodeKernelRunIdentity,
  encodeModelOperationIdentity,
  encodeMultiAgentRunIdentity,
  encodeToolOperationIdentity,
  encodeTaskScope
} from '@qiongqi/contracts'

const timestamp = '2026-07-26T00:00:00.000Z'
const scope = { ownerId: 'u1', workspaceId: 'w1', taskId: 't1' }

describe('durable engine v1 contracts', () => {
  it('keeps task scope independent from turn and run identity', () => {
    expect(TaskScopeSchema.parse(scope)).toEqual(scope)
    expect(encodeTaskScope(scope)).toBe('ownerId=u1|workspaceId=w1|taskId=t1')
    expect(() => TaskScopeSchema.parse({ ...scope, turnId: 'turn1' })).toThrow()
  })

  it('rejects whitespace-normalized task, run, and operation identities', () => {
    expect(() => TaskScopeSchema.parse({ ...scope, taskId: ' t1 ' })).toThrow()
    expect(() => encodeTaskScope({ ...scope, taskId: ' t1 ' })).toThrow()
    const multiAgentRun = { scope, multiAgentRunId: ' mar1 ' }
    const kernelRun = {
      scope, parentKind: 'multi_agent', multiAgentRunId: 'mar1',
      parentRunId: ' mar1 ', kernelRunId: ' kr1 '
    } as const
    const modelOperation = {
      kind: 'model', scope, kernelRunId: ' kr1 ', parentRunId: ' kr1 ', operationId: ' op1 '
    } as const
    const toolOperation = {
      kind: 'tool', scope, kernelRunId: ' kr1 ', parentRunId: ' kr1 ', operationId: ' op2 '
    } as const

    expect(() => MultiAgentRunIdentitySchema.parse(multiAgentRun)).toThrow()
    expect(() => encodeMultiAgentRunIdentity(multiAgentRun)).toThrow()
    expect(() => KernelRunIdentitySchema.parse(kernelRun)).toThrow()
    expect(() => encodeKernelRunIdentity(kernelRun)).toThrow()
    expect(() => ModelOperationIdentitySchema.parse(modelOperation)).toThrow()
    expect(() => encodeModelOperationIdentity(modelOperation)).toThrow()
    expect(() => ToolOperationIdentitySchema.parse(toolOperation)).toThrow()
    expect(() => encodeToolOperationIdentity(toolOperation)).toThrow()
  })

  it('parses a stable model execution ledger entry', () => {
    expect(ExecutionLedgerEntrySchema.parse({
      kind: 'model', operationId: 'op1', scope, kernelRunId: 'kr1',
      logicalRequestKey: 'lr1', requestFingerprint: 'rf1', taskRevision: 3,
      contextRevision: 2, strategyRevision: 1, strategyDigest: 'sd1',
      profileRef: { profileId: 'primary', revision: 4 }, capabilities: ['tools', 'vision'],
      pricing: { currency: 'USD', inputPerMillion: 1.25, outputPerMillion: 5 },
      routeReason: ' matched durable model policy ', status: 'completed', resultRef: 'result://model/op1',
      usage: {
        promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 4,
        cacheHitTokens: 3, cacheMissTokens: 7, cacheHitRate: 0.3, turns: 1,
        costUsd: 0.0000375, costCny: 0.00027, cacheSavingsUsd: 0.000003,
        cacheSavingsCny: 0.0000216, tokenEconomySavingsTokens: 2,
        tokenEconomySavingsUsd: 0.0000025, tokenEconomySavingsCny: 0.000018,
        hasError: false
      },
      createdAt: timestamp, updatedAt: timestamp
    })).toMatchObject({
      kind: 'model', scope, profileRef: { revision: 4 }, capabilities: ['tools', 'vision'],
      pricing: { currency: 'USD' }, routeReason: 'matched durable model policy',
      resultRef: 'result://model/op1', usage: { totalTokens: 15, hasError: false }
    })
  })

  it('rejects unknown durable model usage keys', () => {
    expect(() => ExecutionLedgerEntrySchema.parse({
      kind: 'model', operationId: 'op1', scope, kernelRunId: 'kr1',
      logicalRequestKey: 'lr1', requestFingerprint: 'rf1', taskRevision: 3,
      contextRevision: 2, strategyRevision: 1, strategyDigest: 'sd1',
      profileRef: { profileId: 'primary', revision: 4 }, status: 'completed',
      usage: {
        promptTokens: 10, completionTokens: 5, totalTokens: 15,
        cacheHitRate: null, turns: 1, unknownCounter: 1
      },
      createdAt: timestamp, updatedAt: timestamp
    })).toThrow()
  })

  it('rejects invalid durable waiting timestamps', () => {
    expect(() => WaitingStateSchema.parse({
      status: 'waiting_input', reason: 'need user input', requestedAt: 'not-a-timestamp'
    })).toThrow()
  })

  it('parses task state without the legacy kernel run identity', () => {
    const checkpoint = TaskCheckpointV1Schema.parse({
      version: 1, scope, revision: 1, status: 'running', objective: 'ship v1',
      constraints: ['no duplicate effects'], actions: [], committedDecisions: [],
      evidenceRefs: [], artifactRefs: [], resourceVersions: {}, attemptedStrategies: [],
      executionLedgerHighWater: 0, provenance: [], createdAt: timestamp, updatedAt: timestamp
    })

    expect(checkpoint.scope).toEqual(scope)
    expect(() => TaskCheckpointV1Schema.parse({ ...checkpoint, identity: { runId: 'legacy' } })).toThrow()
  })

  it('parses a stable engine stream envelope', () => {
    expect(EngineStreamEventSchema.parse({
      streamId: 'stream1', seq: 1, timestamp, scope,
      multiAgentRunId: 'mar1', agentRunId: 'ar1', kernelRunId: 'kr1',
      channel: 'public', kind: 'run.started', payload: {}
    })).toMatchObject({ streamId: 'stream1', seq: 1, scope })
  })

  it('accepts concrete waiting statuses while outcomes retain suspended projection', () => {
    for (const status of [
      'waiting_approval',
      'waiting_input',
      'waiting_effect_verification',
      'waiting_model_resolution'
    ]) {
      expect(RunStatusSchema.parse(status)).toBe(status)
    }
    expect(() => RunStatusSchema.parse('suspended')).toThrow()
    expect(RunOutcomeReasonSchema.parse('no_progress')).toBe('no_progress')
    expect(RunOutcomeSchema.parse({
      status: 'suspended', reason: 'no_progress', retryable: true
    })).toMatchObject({ status: 'suspended', reason: 'no_progress' })
  })

  it('rejects unknown durable-record keys and uses one context revision field per concern', () => {
    expect(() => ExecutionLedgerEntrySchema.parse({
      kind: 'model', operationId: 'op1', scope, kernelRunId: 'kr1',
      logicalRequestKey: 'lr1', requestFingerprint: 'rf1', taskRevision: 3,
      contextRevision: 2, strategyRevision: 1, strategyDigest: 'sd1',
      profileRef: { profileId: 'primary', revision: 4 }, status: 'prepared',
      createdAt: timestamp, updatedAt: timestamp, extra: true
    })).toThrow()

    const contextIdentity = {
      scope, sourceHistoryDigest: 'history1', taskRevision: 3, memoryRevision: 4,
      ledgerHighWater: 5, policyVersion: 'policy1'
    }
    const contextId = deriveContextId(contextIdentity)
    expect(ContextCheckpointV1Schema.parse({
      version: 1, contextId, scope, revision: 2,
      sourceHistoryDigest: 'history1', taskRevision: 3, memoryRevision: 4,
      ledgerHighWater: 5, policyVersion: 'policy1', coveredItemIds: ['item1'],
      coveredItemsDigest: 'covered1', cursor: 'cursor1', createdAt: timestamp, updatedAt: timestamp
    })).toMatchObject({ taskRevision: 3, ledgerHighWater: 5 })
    expect(() => ContextCheckpointV1Schema.parse({
      version: 1, contextId, scope, revision: 2,
      sourceHistoryDigest: 'history1', taskRevision: 3, memoryRevision: 4,
      ledgerHighWater: 5, policyVersion: 'policy1', coveredItemIds: ['item1'],
      coveredItemsDigest: 'covered1', cursor: 'cursor1', createdAt: timestamp, updatedAt: timestamp,
      extra: true
    })).toThrow()
  })

  it('keeps parent and child run identities complete and deterministically encoded', () => {
    const multiAgentRun = MultiAgentRunIdentitySchema.parse({ scope, multiAgentRunId: 'mar1' })
    const agentRun = AgentRunIdentitySchema.parse({
      scope, multiAgentRunId: 'mar1', agentRunId: 'ar1', agentId: 'planner', nodeId: 'plan',
      parentRunId: 'mar1',
      executionRef: {
        scope, parentKind: 'agent', multiAgentRunId: 'mar1', agentRunId: 'ar1',
        parentRunId: 'ar1', kernelRunId: 'kr1'
      },
      previousAttempt: { agentRunId: 'ar0', kernelRunId: 'kr0' }
    })
    const kernelRun = KernelRunIdentitySchema.parse({
      scope, parentKind: 'agent', multiAgentRunId: 'mar1', agentRunId: 'ar1',
      parentRunId: 'ar1', kernelRunId: 'kr1'
    })
    const operation = ModelOperationIdentitySchema.parse({
      kind: 'model', scope, kernelRunId: 'kr1', parentRunId: 'kr1', operationId: 'op1'
    })
    const toolOperation = ToolOperationIdentitySchema.parse({
      kind: 'tool', scope, kernelRunId: 'kr1', parentRunId: 'kr1', operationId: 'op2'
    })

    expect(encodeMultiAgentRunIdentity(multiAgentRun)).toBe(
      'ownerId=u1|workspaceId=w1|taskId=t1|multiAgentRunId=mar1'
    )
    expect(encodeAgentRunIdentity(agentRun)).toBe(
      'ownerId=u1|workspaceId=w1|taskId=t1|multiAgentRunId=mar1|parentRunId=mar1|agentRunId=ar1|agentId=planner|nodeId=plan|previousAgentRunId=ar0|previousKernelRunId=kr0|executionRef=ownerId%3Du1%7CworkspaceId%3Dw1%7CtaskId%3Dt1%7CparentKind%3Dagent%7CmultiAgentRunId%3Dmar1%7CagentRunId%3Dar1%7CparentRunId%3Dar1%7CkernelRunId%3Dkr1'
    )
    expect(encodeKernelRunIdentity(kernelRun)).toBe(
      'ownerId=u1|workspaceId=w1|taskId=t1|parentKind=agent|multiAgentRunId=mar1|agentRunId=ar1|parentRunId=ar1|kernelRunId=kr1'
    )
    expect(encodeModelOperationIdentity(operation)).toBe(
      'ownerId=u1|workspaceId=w1|taskId=t1|kind=model|parentRunId=kr1|kernelRunId=kr1|operationId=op1'
    )
    expect(encodeToolOperationIdentity(toolOperation)).toBe(
      'ownerId=u1|workspaceId=w1|taskId=t1|kind=tool|parentRunId=kr1|kernelRunId=kr1|operationId=op2'
    )
    expect(() => KernelRunIdentitySchema.parse({
      scope, parentKind: 'agent', agentRunId: 'ar1', parentRunId: 'ar1', kernelRunId: 'kr1'
    })).toThrow()
    expect(() => ToolOperationIdentitySchema.parse({
      kind: 'tool', scope, kernelRunId: 'kr1', operationId: 'op1', parentRunId: 'other'
    })).toThrow()
    expect(encodeAgentRunIdentity({ ...agentRun, agentId: 'reviewer' })).not.toBe(encodeAgentRunIdentity(agentRun))
    expect(encodeAgentRunIdentity({ ...agentRun, nodeId: 'review' })).not.toBe(encodeAgentRunIdentity(agentRun))
    expect(encodeKernelRunIdentity({
      ...kernelRun, previousAttempt: { kernelRunId: 'kr0' }
    })).not.toBe(encodeKernelRunIdentity(kernelRun))
    expect(() => AgentRunIdentitySchema.parse({
      ...agentRun,
      executionRef: { ...agentRun.executionRef, agentRunId: 'other', parentRunId: 'other' }
    })).toThrow()
  })

  it('derives context identity from every stable context component', () => {
    const components = {
      scope, sourceHistoryDigest: 'history1', taskRevision: 3, memoryRevision: 4,
      ledgerHighWater: 5, policyVersion: 'policy1'
    }
    const contextId = deriveContextId(components)

    expect(deriveContextId(components)).toBe(contextId)
    for (const changed of [
      { ...components, scope: { ...scope, taskId: 't2' } },
      { ...components, sourceHistoryDigest: 'history2' },
      { ...components, taskRevision: 4 },
      { ...components, memoryRevision: 5 },
      { ...components, ledgerHighWater: 6 },
      { ...components, policyVersion: 'policy2' }
    ]) {
      expect(deriveContextId(changed)).not.toBe(contextId)
    }
    expect(() => ContextCheckpointV1Schema.parse({
      version: 1, contextId: 'not-derived', scope, revision: 2,
      sourceHistoryDigest: 'history1', taskRevision: 3, memoryRevision: 4,
      ledgerHighWater: 5, policyVersion: 'policy1', coveredItemIds: ['item1'],
      coveredItemsDigest: 'covered1', cursor: 'cursor1', createdAt: timestamp, updatedAt: timestamp
    })).toThrow()
  })

  it('parses strict tool, cost, value, and typed checkpoint records', () => {
    const evidenceRef = DurableReferenceSchema.parse({
      ref: 'evidence://1', digest: 'e1', mediaType: 'text/plain',
      provenance: { source: 'tool', digest: 'p1', recordedAt: timestamp }
    })
    expect(ExecutionLedgerEntrySchema.parse({
      kind: 'tool', operationId: 'op2', scope, kernelRunId: 'kr1', exactFingerprint: 'ef1',
      semanticKey: 'sk1', preconditionVersions: { repository: 'r1' },
      observedPostconditions: { repository: 'r2' }, effectPolicy: 'verify-before-replay',
      replayValidity: 'unknown', status: 'uncertain', noProgressCount: 1,
      createdAt: timestamp, updatedAt: timestamp
    })).toMatchObject({ kind: 'tool', effectPolicy: 'verify-before-replay' })
    expect(CostEntrySchema.parse({
      costId: 'cost1', scope, profileRef: { profileId: 'primary', revision: 4 },
      amount: 1.25, currency: 'USD', source: 'model', incurredAt: timestamp
    })).toMatchObject({ costId: 'cost1' })
    expect(ValueEventSchema.parse({
      valueId: 'value1', scope, amount: 10, currency: 'USD', source: 'evaluation',
      confidence: 0.9, evidenceRefs: [evidenceRef], recordedAt: timestamp
    })).toMatchObject({ evidenceRefs: [evidenceRef] })
    expect(TaskCheckpointV1Schema.parse({
      version: 1, scope, revision: 1, status: 'waiting_approval', objective: 'ship v1',
      constraints: [], actions: [{ actionId: 'a1', description: 'review', status: 'pending' }],
      activePlan: { planId: 'p1', digest: 'pd1', actionIds: ['a1'] },
      nextAction: { actionId: 'a1', description: 'review', status: 'pending' },
      committedDecisions: [{ decisionId: 'd1', digest: 'd1', summary: 'use strict schemas' }],
      evidenceRefs: [evidenceRef], artifactRefs: [evidenceRef], resourceVersions: { repo: 'r1' },
      attemptedStrategies: [{ strategyId: 's1', digest: 's1', revision: 1 }],
      executionLedgerHighWater: 1,
      waitingState: { status: 'waiting_approval', reason: 'approval required', requestedAt: timestamp },
      provenance: [{ source: 'engine', digest: 'p2', recordedAt: timestamp }],
      createdAt: timestamp, updatedAt: timestamp
    })).toMatchObject({ status: 'waiting_approval', evidenceRefs: [evidenceRef] })
  })

  it('keeps checkpoint waiting state consistent with its durable status', () => {
    const base = {
      version: 1 as const, scope, revision: 1, objective: 'ship v1', constraints: [], actions: [],
      committedDecisions: [], evidenceRefs: [], artifactRefs: [], resourceVersions: {}, attemptedStrategies: [],
      executionLedgerHighWater: 0, provenance: [], createdAt: timestamp, updatedAt: timestamp
    }
    const waitingStatuses = [
      'waiting_approval',
      'waiting_input',
      'waiting_effect_verification',
      'waiting_model_resolution'
    ] as const
    for (const [index, status] of waitingStatuses.entries()) {
      const mismatch = waitingStatuses[(index + 1) % waitingStatuses.length]!
      expect(() => TaskCheckpointV1Schema.parse({ ...base, status })).toThrow()
      expect(() => TaskCheckpointV1Schema.parse({
        ...base, status,
        waitingState: { status: mismatch, reason: 'waiting', requestedAt: timestamp }
      })).toThrow()
      expect(TaskCheckpointV1Schema.parse({
        ...base, status,
        waitingState: { status, reason: 'waiting', requestedAt: timestamp }
      })).toMatchObject({ status, waitingState: { status } })
    }
    for (const status of ['running', 'completed', 'degraded', 'failed', 'aborted', 'corrupt'] as const) {
      expect(() => TaskCheckpointV1Schema.parse({
        ...base, status,
        waitingState: { status: 'waiting_input', reason: 'waiting', requestedAt: timestamp }
      })).toThrow()
    }
  })

  it('rejects noncanonical durable record keys and invalid ISO timestamps', () => {
    expect(() => IsoTimestampSchema.parse('2026-99-26T00:00:00.000Z')).toThrow()
    expect(() => EngineStreamEventSchema.parse({
      streamId: 'stream1', seq: 1, timestamp: 'invalid', scope, channel: 'public', kind: 'run.started', payload: {}
    })).toThrow()
    expect(() => ExecutionLedgerEntrySchema.parse({
      kind: 'tool', operationId: 'op2', scope, kernelRunId: 'kr1', exactFingerprint: 'ef1', semanticKey: 'sk1',
      preconditionVersions: { repo: 'r1', ' repo ': 'r2' }, observedPostconditions: {}, effectPolicy: 'safe',
      replayValidity: 'valid', status: 'completed', noProgressCount: 0, createdAt: timestamp, updatedAt: timestamp
    })).toThrow()
    expect(() => ProgressCheckpointSchema.parse({
      taskRevision: 1, progressFingerprint: 'progress1', evidenceDigests: [], artifactDigests: [], decisionDigests: [],
      resourceDigests: { repo: 'r1', ' repo ': 'r2' }, attemptedStrategyDigests: [], noProgressCount: 0
    })).toThrow()
    expect(() => TaskCheckpointV1Schema.parse({
      version: 1, scope, revision: 1, status: 'running', objective: 'ship v1', constraints: [], actions: [],
      committedDecisions: [], evidenceRefs: [], artifactRefs: [], resourceVersions: { repo: 'r1', ' repo ': 'r2' },
      attemptedStrategies: [], executionLedgerHighWater: 0, provenance: [], createdAt: timestamp, updatedAt: timestamp
    })).toThrow()
  })

  it('requires complete stream run-id hierarchy', () => {
    expect(() => EngineStreamEventSchema.parse({
      streamId: 'stream1', seq: 1, timestamp, scope, agentRunId: 'ar1',
      channel: 'public', kind: 'run.started', payload: {}
    })).toThrow()
    expect(() => EngineStreamEventSchema.parse({
      streamId: 'stream1', seq: 1, timestamp, scope, multiAgentRunId: 'mar1', kernelRunId: 'kr1',
      channel: 'public', kind: 'run.started', payload: {}
    })).toThrow()
  })

  it('rejects unknown keys for every new durable record', () => {
    expect(() => MultiAgentRunIdentitySchema.parse({
      scope, multiAgentRunId: 'mar1', extra: true
    })).toThrow()
    expect(() => EngineStreamEventSchema.parse({
      streamId: 'stream1', seq: 1, timestamp, scope, channel: 'public', kind: 'run.started', payload: {}, extra: true
    })).toThrow()
    expect(() => ExecutionLedgerEntrySchema.parse({
      kind: 'tool', operationId: 'op2', scope, kernelRunId: 'kr1', exactFingerprint: 'ef1',
      semanticKey: 'sk1', preconditionVersions: {}, observedPostconditions: {}, effectPolicy: 'safe',
      replayValidity: 'valid', status: 'completed', noProgressCount: 0,
      createdAt: timestamp, updatedAt: timestamp, extra: true
    })).toThrow()
    expect(() => ProgressCheckpointSchema.parse({
      taskRevision: 1, progressFingerprint: 'progress1', evidenceDigests: [], artifactDigests: [],
      decisionDigests: [], resourceDigests: {}, attemptedStrategyDigests: [], noProgressCount: 0, extra: true
    })).toThrow()
    expect(() => DurableReferenceSchema.parse({
      ref: 'evidence://1', digest: 'e1', mediaType: 'text/plain',
      provenance: { source: 'tool', digest: 'p1', recordedAt: timestamp }, extra: true
    })).toThrow()
    expect(() => CostEntrySchema.parse({
      costId: 'cost1', scope, amount: 1.25, currency: 'USD', source: 'model', incurredAt: timestamp, extra: true
    })).toThrow()
    expect(() => ValueEventSchema.parse({
      valueId: 'value1', scope, amount: 10, currency: 'USD', source: 'evaluation',
      confidence: 0.9, evidenceRefs: [], recordedAt: timestamp, extra: true
    })).toThrow()
  })
})
