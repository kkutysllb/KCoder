import { describe, expect, it } from 'vitest'
import {
  CostEntrySchema,
  GraphRevisionSchema,
  GraphRunRecordSchema,
  HumanCheckpointSchema,
  TaskCheckpointV1Schema,
  ValueEventSchema,
  deriveContextId,
  type ContextCheckpointV1,
  type EngineStreamEvent,
  type ExecutionLedgerEntry,
  type TaskCheckpointV1,
  type TaskScope
} from '@qiongqi/contracts'
import {
  EngineStoreConflictError,
  type DurableEngineStore,
  type EngineCommit,
  type EngineRunRecord
} from '@qiongqi/ports'

const timestamp = '2026-07-26T00:00:00.000Z'
const scope: TaskScope = { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' }

function runRecord(version = 1): EngineRunRecord {
  return {
    runId: 'run-1',
    scope,
    multiAgentRunId: 'multi-1',
    agentRunId: 'agent-run-1',
    kernelRunId: 'kernel-run-1',
    version,
    status: 'running',
    desiredState: 'running',
    cursor: { nodeId: 'build-context', stepIndex: 0, checkpointSeq: 0 },
    parentRef: { kind: 'agent', runId: 'agent-run-1' },
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function taskCheckpoint(revision = 1): TaskCheckpointV1 {
  return TaskCheckpointV1Schema.parse({
    version: 1,
    scope,
    revision,
    status: 'running',
    objective: 'ship durable engine v1',
    constraints: [],
    actions: [],
    committedDecisions: [],
    evidenceRefs: [],
    artifactRefs: [],
    resourceVersions: {},
    attemptedStrategies: [],
    executionLedgerHighWater: 0,
    provenance: [],
    createdAt: timestamp,
    updatedAt: timestamp
  })
}

function contextCheckpoint(): ContextCheckpointV1 {
  const components = {
    scope,
    sourceHistoryDigest: 'history-1',
    taskRevision: 1,
    memoryRevision: 0,
    ledgerHighWater: 0,
    policyVersion: 'policy-1'
  }
  return {
    version: 1,
    contextId: deriveContextId(components),
    ...components,
    revision: 1,
    coveredItemIds: ['item-1'],
    coveredItemsDigest: 'items-1',
    cursor: 'cursor-1',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function ledgerEntry(operationId = 'operation-1'): ExecutionLedgerEntry {
  return {
    kind: 'tool',
    operationId,
    scope,
    kernelRunId: 'kernel-run-1',
    exactFingerprint: `exact-${operationId}`,
    semanticKey: `semantic-${operationId}`,
    preconditionVersions: {},
    observedPostconditions: {},
    effectPolicy: 'safe',
    replayValidity: 'valid',
    status: 'completed',
    resultRef: `result://${operationId}`,
    noProgressCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function streamEvent(kind: string): Omit<EngineStreamEvent, 'seq'> {
  return {
    streamId: 'stream-1',
    timestamp,
    scope,
    multiAgentRunId: 'multi-1',
    agentRunId: 'agent-run-1',
    kernelRunId: 'kernel-run-1',
    channel: 'public',
    kind,
    payload: {}
  }
}

function atomicCommit(): EngineCommit {
  return {
    scope,
    runId: 'run-1',
    expectedRunVersion: 0,
    expectedTaskRevision: 0,
    runMutation: { type: 'put', record: runRecord() },
    taskCheckpointMutation: { type: 'put', record: taskCheckpoint() },
    contextCheckpointMutation: { type: 'put', record: contextCheckpoint() },
    ledgerMutations: [{ type: 'append', record: ledgerEntry() }],
    events: [{
      type: 'append',
      record: { eventId: 'event-1', runId: 'run-1', scope, kind: 'run.started', payload: {}, timestamp }
    }],
    streamEvents: [{ type: 'append', record: streamEvent('run.started') }],
    outboxIntents: [{
      type: 'put',
      record: {
        workId: 'work-1', scope, kind: 'agent_execution_completed', payloadRef: 'outbox://work-1',
        status: 'pending', availableAt: timestamp, createdAt: timestamp, updatedAt: timestamp
      }
    }],
    costMutations: [{
      type: 'append',
      record: CostEntrySchema.parse({
        costId: 'cost-1', scope, amount: 1, currency: 'USD', source: 'model', incurredAt: timestamp
      })
    }],
    valueMutations: [{
      type: 'append',
      record: ValueEventSchema.parse({
        valueId: 'value-1', scope, amount: 3, currency: 'USD', source: 'caller',
        confidence: 1, evidenceRefs: [], recordedAt: timestamp
      })
    }]
  }
}

function graphCommit(): EngineCommit {
  const graphRevision = GraphRevisionSchema.parse({
    schemaVersion: 1,
    graphId: 'graph-1',
    revision: 1,
    graphDigest: 'a'.repeat(64),
    startNodeId: 'agent',
    nodes: [{ id: 'agent', kind: 'agent', agentId: 'agent' }],
    edges: [],
    publishedAt: timestamp,
    diagnostics: []
  })
  const graphRun = GraphRunRecordSchema.parse({
    schemaVersion: 1,
    scope,
    runId: 'graph-run-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspaceKey: 'workspace-1',
    graphId: 'graph-1',
    graphRevision: 1,
    graphDigest: graphRevision.graphDigest,
    version: 1,
    status: 'running',
    circuitState: 'running',
    activeNodeIds: ['agent'],
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    createdAt: timestamp,
    updatedAt: timestamp
  })
  const checkpoint = HumanCheckpointSchema.parse({
    checkpointId: 'checkpoint-1', scope, runId: 'graph-run-1', graphId: 'graph-1', graphRevision: 1,
    nodeId: 'agent', policyRevision: 1, evidenceRefs: [], approvalScope: ['write'],
    resumeEdgeId: 'edge-approved', resolutionToken: 'token-1', status: 'pending',
    expiresAt: '2026-07-26T01:00:00.000Z', createdAt: timestamp, updatedAt: timestamp
  })
  return {
    scope,
    runId: 'graph-run-1',
    expectedRunVersion: 0,
    expectedTaskRevision: 0,
    expectedModelPolicyRevision: 0,
    graphRevisionMutations: [{ type: 'put', record: graphRevision }],
    graphRunMutation: { type: 'put', record: graphRun },
    workGraphEvents: [{ type: 'append', record: {
      eventId: 'work-event-1', scope, runId: 'graph-run-1', graphId: 'graph-1', graphRevision: 1,
      nodeId: 'agent', attemptId: 'attempt-1', kind: 'run_started', payload: {}, timestamp
    } }],
    taskModelPolicyMutation: { type: 'put', record: {
      scope, revision: 1, policy: { authorizedProfileIds: ['profile-1'] },
      validatedProfileRefs: [{ profileId: 'profile-1', revision: 1 }],
      createdAt: timestamp, updatedAt: timestamp
    } },
    humanCheckpointMutations: [{ type: 'put', record: checkpoint }]
  }
}

function rootAggregateCommit(multiAgentRunId = 'graph-run-1'): EngineCommit {
  const commit = graphCommit()
  return {
    ...commit,
    aggregateKind: 'governed_root',
    runMutation: {
      type: 'put',
      record: {
        runId: 'graph-run-1',
        scope,
        multiAgentRunId,
        graph: {
          graphId: 'graph-1',
          graphRevision: 1,
          graphDigest: 'a'.repeat(64),
          nodeId: 'agent',
          attemptId: 'graph-run-1',
          callerId: scope.ownerId,
          policyRevision: 1
        },
        version: 1,
        status: 'running',
        desiredState: 'running',
        cursor: { nodeId: 'agent', stepIndex: 0, checkpointSeq: 0 },
        budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 1_000, outputTokens: 1_000, costUsd: 10 },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    }
  }
}

export function durableEngineStoreConformance(factory: () => DurableEngineStore | Promise<DurableEngineStore>): void {
  describe('DurableEngineStore conformance', () => {
    it('counts settled actual plus active requested usage before reserving another child', async () => {
      const store = await factory()
      const parent: EngineRunRecord = {
        runId: 'budget-root', scope, multiAgentRunId: 'budget-root', version: 1,
        status: 'running', desiredState: 'running',
        cursor: { nodeId: 'dispatch', stepIndex: 0, checkpointSeq: 0 },
        budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 100, outputTokens: 100, costUsd: 10 },
        createdAt: timestamp, updatedAt: timestamp
      }
      await store.commit({
        scope, runId: parent.runId, expectedRunVersion: 0, expectedTaskRevision: 0,
        runMutation: { type: 'put', record: parent }
      })
      const reservation = (reservationId: string, childRunId: string, stepsUsed: number) => ({
        reservationId, scope, parentRunId: parent.runId, childRunId, status: 'reserved' as const,
        reserved: { stepsUsed, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        createdAt: timestamp, updatedAt: timestamp
      })
      await store.commit({
        scope, runId: parent.runId, expectedRunVersion: 1, expectedTaskRevision: 0,
        budgetReservationMutations: [{ type: 'reserve', record: reservation('reservation-1', 'child-1', 8) }]
      })
      await store.commit({
        scope, runId: parent.runId, expectedRunVersion: 1, expectedTaskRevision: 0,
        budgetReservationMutations: [{
          type: 'settle', recordId: 'reservation-1',
          actual: { stepsUsed: 6, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
          updatedAt: timestamp
        }]
      })
      await expect(store.commit({
        scope, runId: parent.runId, expectedRunVersion: 1, expectedTaskRevision: 0,
        budgetReservationMutations: [{
          type: 'settle', recordId: 'reservation-1',
          actual: { stepsUsed: 6, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
          updatedAt: timestamp
        }]
      })).resolves.toBeDefined()
      await expect(store.commit({
        scope, runId: parent.runId, expectedRunVersion: 1, expectedTaskRevision: 0,
        budgetReservationMutations: [{
          type: 'settle', recordId: 'reservation-1',
          actual: { stepsUsed: 7, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
          updatedAt: timestamp
        }]
      })).rejects.toThrow(/settled|different/i)

      await expect(store.commit({
        scope, runId: parent.runId, expectedRunVersion: 1, expectedTaskRevision: 0,
        budgetReservationMutations: [{ type: 'reserve', record: reservation('reservation-2', 'child-2', 5) }]
      })).rejects.toThrow(/budget/i)
      await expect(store.commit({
        scope, runId: parent.runId, expectedRunVersion: 1, expectedTaskRevision: 0,
        budgetReservationMutations: [{ type: 'reserve', record: reservation('reservation-2', 'child-2', 4) }]
      })).resolves.toBeDefined()
    })

    it('does not count released reservations against the root budget', async () => {
      const store = await factory()
      const parent: EngineRunRecord = {
        runId: 'released-budget-root', scope, multiAgentRunId: 'released-budget-root', version: 1,
        status: 'running', desiredState: 'running',
        cursor: { nodeId: 'dispatch', stepIndex: 0, checkpointSeq: 0 },
        budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        budgetLimits: { stepsUsed: 10, toolCallsUsed: 10, inputTokens: 100, outputTokens: 100, costUsd: 10 },
        createdAt: timestamp, updatedAt: timestamp
      }
      const record = (reservationId: string, childRunId: string) => ({
        reservationId, scope, parentRunId: parent.runId, childRunId, status: 'reserved' as const,
        reserved: { stepsUsed: 10, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        createdAt: timestamp, updatedAt: timestamp
      })
      await store.commit({
        scope, runId: parent.runId, expectedRunVersion: 0, expectedTaskRevision: 0,
        runMutation: { type: 'put', record: parent },
        budgetReservationMutations: [{ type: 'reserve', record: record('released-1', 'released-child-1') }]
      })
      await store.commit({
        scope, runId: parent.runId, expectedRunVersion: 1, expectedTaskRevision: 0,
        budgetReservationMutations: [{ type: 'release', recordId: 'released-1', updatedAt: timestamp }]
      })
      await expect(store.commit({
        scope, runId: parent.runId, expectedRunVersion: 1, expectedTaskRevision: 0,
        budgetReservationMutations: [{ type: 'reserve', record: record('released-2', 'released-child-2') }]
      })).resolves.toBeDefined()
    })

    it('atomically rejects incompatible governed root projection identity', async () => {
      const store = await factory()

      await expect(store.commit(rootAggregateCommit('another-root')))
        .rejects.toBeInstanceOf(EngineStoreConflictError)
      await expect(store.loadGraphRun('graph-run-1')).resolves.toBeUndefined()
      await expect(store.loadRun('graph-run-1')).resolves.toBeUndefined()
      await expect(store.loadGraphRevision('graph-1', 1)).resolves.toBeUndefined()
    })

    it('atomically commits graph revision, run, work event, model policy, and checkpoint', async () => {
      const store = await factory()
      await store.commit(graphCommit())

      await expect(store.loadGraphRevision('graph-1', 1)).resolves.toMatchObject({ graphDigest: 'a'.repeat(64) })
      await expect(store.loadGraphRun('graph-run-1')).resolves.toMatchObject({ graphRevision: 1, version: 1 })
      await expect(store.listGraphRuns(scope)).resolves.toMatchObject([{ runId: 'graph-run-1', graphRevision: 1 }])
      await expect(store.listWorkGraphEvents('graph-run-1', 0, 20)).resolves.toMatchObject([
        { seq: 1, kind: 'run_started', attemptId: 'attempt-1' }
      ])
      await expect(store.loadTaskModelPolicy(scope)).resolves.toMatchObject({ revision: 1 })
      await expect(store.loadHumanCheckpoint('checkpoint-1')).resolves.toMatchObject({ status: 'pending' })
    })

    it('atomically resolves a checkpoint token with its graph run transition exactly once', async () => {
      const store = await factory()
      await store.commit(graphCommit())
      const current = (await store.loadGraphRun('graph-run-1'))!
      const advanced = { ...current, version: 2, activeNodeIds: ['done'], updatedAt: timestamp }

      await expect(store.commit({
        scope,
        runId: current.runId,
        expectedRunVersion: current.version,
        expectedTaskRevision: 0,
        graphRunMutation: { type: 'put', record: advanced },
        humanCheckpointMutations: [{
          type: 'resolve',
          recordId: 'checkpoint-1',
          resolutionToken: 'wrong-token',
          graphRevision: 1,
          status: 'allowed',
          resolvedAt: timestamp,
          updatedAt: timestamp
        }]
      })).rejects.toThrow(/token/)
      await expect(store.loadGraphRun(current.runId)).resolves.toMatchObject({ version: 1, activeNodeIds: ['agent'] })
      await expect(store.loadHumanCheckpoint('checkpoint-1')).resolves.toMatchObject({ status: 'pending' })

      await store.commit({
        scope,
        runId: current.runId,
        expectedRunVersion: current.version,
        expectedTaskRevision: 0,
        graphRunMutation: { type: 'put', record: advanced },
        humanCheckpointMutations: [{
          type: 'resolve',
          recordId: 'checkpoint-1',
          resolutionToken: 'token-1',
          graphRevision: 1,
          status: 'allowed',
          resolvedAt: timestamp,
          updatedAt: timestamp
        }]
      })
      await expect(store.loadGraphRun(current.runId)).resolves.toMatchObject({ version: 2, activeNodeIds: ['done'] })
      await expect(store.loadHumanCheckpoint('checkpoint-1')).resolves.toMatchObject({ status: 'allowed' })

      await expect(store.commit({
        scope,
        runId: current.runId,
        expectedRunVersion: 2,
        expectedTaskRevision: 0,
        graphRunMutation: { type: 'put', record: { ...advanced, version: 3 } },
        humanCheckpointMutations: [{
          type: 'resolve',
          recordId: 'checkpoint-1',
          resolutionToken: 'token-1',
          graphRevision: 1,
          status: 'allowed',
          resolvedAt: timestamp,
          updatedAt: timestamp
        }]
      })).rejects.toThrow(/consumed|pending/)
      await expect(store.loadGraphRun(current.runId)).resolves.toMatchObject({ version: 2 })
    })

    it.each([
      ['read', 'read', true],
      ['read', 'write', false],
      ['write', 'read', false],
      ['write', 'write', false]
    ] as const)('enforces resource compatibility for %s then %s as %s', async (held, requested, allowed) => {
      const store = await factory()
      const first = await store.claimResource({
        claimId: `claim-${held}-1`,
        scope,
        resourceKey: 'workspace:file:shared',
        mode: held,
        holderId: 'run-1',
        conflictStrategy: 'wait',
        ttlMs: 60_000
      })
      expect(first).toMatchObject({ status: 'active', mode: held, lease: { fence: 1 } })

      const second = await store.claimResource({
        claimId: `claim-${requested}-2`,
        scope,
        resourceKey: 'workspace:file:shared',
        mode: requested,
        holderId: 'run-2',
        conflictStrategy: 'wait',
        ttlMs: 60_000
      })
      expect(Boolean(second)).toBe(allowed)
      if (allowed) expect(second).toMatchObject({ lease: { fence: 2 } })
    })

    it('grants exactly one of two concurrent write claims for the same resource', async () => {
      const store = await factory()
      const results = await Promise.all([
        store.claimResource({
          claimId: 'claim-concurrent-a', scope, resourceKey: 'workspace:file:race', mode: 'write',
          holderId: 'run-a', conflictStrategy: 'wait', ttlMs: 60_000
        }),
        store.claimResource({
          claimId: 'claim-concurrent-b', scope, resourceKey: 'workspace:file:race', mode: 'write',
          holderId: 'run-b', conflictStrategy: 'wait', ttlMs: 60_000
        })
      ])
      expect(results.filter(Boolean)).toHaveLength(1)
      await expect(store.listResourceClaims('workspace:file:race')).resolves.toHaveLength(1)
    })

    it('rejects a stale fence after a released claim id is reused', async () => {
      const store = await factory()
      const first = await store.claimResource({
        claimId: 'claim-reused', scope, resourceKey: 'workspace:file:reused', mode: 'write',
        holderId: 'run-a', conflictStrategy: 'wait', ttlMs: 60_000
      })
      expect(first).toBeDefined()
      await store.releaseResourceClaim(first!)
      const replacement = await store.claimResource({
        claimId: 'claim-reused', scope, resourceKey: 'workspace:file:reused', mode: 'write',
        holderId: 'run-b', conflictStrategy: 'wait', ttlMs: 60_000
      })
      expect(replacement).toMatchObject({ status: 'active', lease: { fence: 2 } })

      await expect(store.releaseResourceClaim(first!)).rejects.toThrow(/stale|fence/)
      await expect(store.listResourceClaims('workspace:file:reused')).resolves.toMatchObject([{
        status: 'active', holderId: 'run-b', lease: { fence: 2 }
      }])
    })

    it('persists outbox claim state and rejects stale completion fences', async () => {
      const store = await factory()
      await store.commit({
        scope,
        runId: 'mailbox-work-1',
        expectedRunVersion: 0,
        expectedTaskRevision: 0,
        outboxIntents: [{
          type: 'put',
          record: {
            workId: 'mailbox-work-1',
            scope,
            kind: 'evented_v2_mailbox:researcher',
            payloadRef: 'mailbox://message-1',
            status: 'pending',
            availableAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
            payload: { messageId: 'message-1', status: 'queued' }
          }
        }]
      })

      const claim = await store.claimWork('worker-1', ['evented_v2_mailbox:researcher'], 30_000)
      expect(claim).toBeDefined()
      await expect(store.loadOutboxIntent('mailbox-work-1')).resolves.toMatchObject({
        status: 'claimed', claim: { holderId: 'worker-1', fence: 1 }
      })
      await expect(store.listOutboxIntents(scope)).resolves.toHaveLength(1)

      await expect(store.commit({
        scope,
        runId: 'mailbox-work-1',
        expectedRunVersion: 0,
        expectedTaskRevision: 0,
        outboxIntents: [{
          type: 'complete',
          recordId: 'mailbox-work-1',
          claim: { ...claim!.lease, token: 'stale-token' },
          payload: { messageId: 'message-1', status: 'completed' }
        }]
      })).rejects.toBeInstanceOf(EngineStoreConflictError)

      await store.commit({
        scope,
        runId: 'mailbox-work-1',
        expectedRunVersion: 0,
        expectedTaskRevision: 0,
        outboxIntents: [{
          type: 'complete',
          recordId: 'mailbox-work-1',
          claim: claim!.lease,
          payload: { messageId: 'message-1', status: 'completed' }
        }]
      })
      await expect(store.loadOutboxIntent('mailbox-work-1')).resolves.toMatchObject({
        status: 'completed', payload: { messageId: 'message-1', status: 'completed' }
      })
    })

    it('renews only the current durable work claim', async () => {
      const store = await factory()
      await store.commit({
        scope,
        runId: 'renew-work-1',
        expectedRunVersion: 0,
        expectedTaskRevision: 0,
        outboxIntents: [{
          type: 'put',
          record: {
            workId: 'renew-work-1',
            scope,
            kind: 'agent_execution_requested',
            payloadRef: 'engine://dispatch/renew-work-1',
            status: 'pending',
            availableAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        }]
      })
      const claim = await store.claimWork('worker-renew', ['agent_execution_requested'], 30_000)
      expect(claim).toBeDefined()

      const renewed = await store.renewWorkClaim('renew-work-1', claim!.lease, 60_000)
      expect(renewed).toMatchObject({
        runId: claim!.lease.runId,
        holderId: claim!.lease.holderId,
        fence: claim!.lease.fence,
        token: claim!.lease.token
      })
      expect(Date.parse(renewed!.expiresAt)).toBeGreaterThanOrEqual(Date.parse(claim!.lease.expiresAt))
      await expect(store.loadOutboxIntent('renew-work-1')).resolves.toMatchObject({
        status: 'claimed',
        claim: { expiresAt: renewed!.expiresAt }
      })
      await expect(store.renewWorkClaim(
        'renew-work-1',
        { ...renewed!, token: 'stale-token' },
        60_000
      )).resolves.toBeUndefined()
    })

    it('rolls back graph state when an immutable revision conflicts', async () => {
      const store = await factory()
      await store.commit(graphCommit())
      const conflicting = graphCommit()
      conflicting.expectedRunVersion = 1
      conflicting.expectedModelPolicyRevision = 1
      conflicting.graphRevisionMutations = [{
        type: 'put',
        record: { ...conflicting.graphRevisionMutations![0]!.record, graphDigest: 'b'.repeat(64) }
      }]
      conflicting.graphRunMutation = {
        type: 'put',
        record: { ...conflicting.graphRunMutation!.record, version: 2, graphDigest: 'b'.repeat(64) }
      }
      conflicting.taskModelPolicyMutation = {
        type: 'put',
        record: { ...conflicting.taskModelPolicyMutation!.record, revision: 2 }
      }

      await expect(store.commit(conflicting)).rejects.toBeInstanceOf(EngineStoreConflictError)
      await expect(store.loadGraphRun('graph-run-1')).resolves.toMatchObject({ version: 1, graphDigest: 'a'.repeat(64) })
      await expect(store.listWorkGraphEvents('graph-run-1', 0, 20)).resolves.toHaveLength(1)
      await expect(store.loadTaskModelPolicy(scope)).resolves.toMatchObject({ revision: 1 })
    })

    it('atomically commits run, task, context, ledger, event, stream, outbox, cost, and value records', async () => {
      const store = await factory()
      const result = await store.commit(atomicCommit())

      expect(result).toEqual({ runVersion: 1, taskRevision: 1, eventHighWater: 1, streamHighWater: 1 })
      await expect(store.loadRun('run-1')).resolves.toMatchObject({ version: 1, status: 'running' })
      await expect(store.loadTask(scope)).resolves.toMatchObject({ revision: 1, objective: 'ship durable engine v1' })
      await expect(store.loadContext(scope, contextCheckpoint().contextId)).resolves.toMatchObject({ revision: 1 })
      await expect(store.findLedger({ scope, operationId: 'operation-1' })).resolves.toHaveLength(1)
      await expect(store.readStream('stream-1', 0, 10)).resolves.toMatchObject([{ seq: 1, kind: 'run.started' }])
      await expect(store.claimWork('worker-1', ['agent_execution_completed'], 10_000)).resolves.toMatchObject({
        workId: 'work-1', kind: 'agent_execution_completed', payloadRef: 'outbox://work-1'
      })
    })

    it('rolls back every mutation when the task revision CAS fails', async () => {
      const store = await factory()
      await store.commit(atomicCommit())
      const rejected: EngineCommit = {
        ...atomicCommit(),
        expectedRunVersion: 1,
        expectedTaskRevision: 99,
        runMutation: { type: 'put', record: runRecord(2) },
        taskCheckpointMutation: { type: 'put', record: taskCheckpoint(2) },
        ledgerMutations: [{ type: 'append', record: ledgerEntry('operation-rollback') }],
        events: [{
          type: 'append',
          record: { eventId: 'event-rollback', runId: 'run-1', scope, kind: 'rollback', payload: {}, timestamp }
        }],
        streamEvents: [{ type: 'append', record: streamEvent('rollback') }],
        outboxIntents: [],
        costMutations: [],
        valueMutations: []
      }

      await expect(store.commit(rejected)).rejects.toBeInstanceOf(EngineStoreConflictError)
      await expect(store.loadRun('run-1')).resolves.toMatchObject({ version: 1 })
      await expect(store.loadTask(scope)).resolves.toMatchObject({ revision: 1 })
      await expect(store.findLedger({ scope, operationId: 'operation-rollback' })).resolves.toEqual([])
      await expect(store.readStream('stream-1', 0, 10)).resolves.toHaveLength(1)
    })

    it('rejects a stale lease fence', async () => {
      const store = await factory()
      const first = await store.acquireLease('run-1', 'holder-1', 10_000)
      expect(first).toBeDefined()
      await store.releaseLease('run-1', first!)
      const second = await store.acquireLease('run-1', 'holder-2', 10_000)
      expect(second!.fence).toBeGreaterThan(first!.fence)

      await expect(store.commit({
        scope,
        runId: 'run-1',
        expectedRunVersion: 0,
        expectedTaskRevision: 0,
        leaseFence: first!.fence
      })).rejects.toBeInstanceOf(EngineStoreConflictError)
    })

    it('assigns monotonic event and stream sequences in the commit critical section', async () => {
      const store = await factory()
      const first = await store.commit({
        scope,
        runId: 'run-1',
        expectedRunVersion: 0,
        expectedTaskRevision: 0,
        events: [
          { type: 'append', record: { eventId: 'event-1', runId: 'run-1', scope, kind: 'one', payload: {}, timestamp } },
          { type: 'append', record: { eventId: 'event-2', runId: 'run-1', scope, kind: 'two', payload: {}, timestamp } }
        ],
        streamEvents: [
          { type: 'append', record: streamEvent('one') },
          { type: 'append', record: streamEvent('two') }
        ]
      })
      const second = await store.commit({
        scope,
        runId: 'run-1',
        expectedRunVersion: 0,
        expectedTaskRevision: 0,
        events: [{ type: 'append', record: { eventId: 'event-3', runId: 'run-1', scope, kind: 'three', payload: {}, timestamp } }],
        streamEvents: [{ type: 'append', record: streamEvent('three') }]
      })

      expect(first).toMatchObject({ eventHighWater: 2, streamHighWater: 2 })
      expect(second).toMatchObject({ eventHighWater: 3, streamHighWater: 3 })
      await expect(store.readStream('stream-1', 0, 10)).resolves.toMatchObject([
        { seq: 1, kind: 'one' }, { seq: 2, kind: 'two' }, { seq: 3, kind: 'three' }
      ])
    })

    it('treats an identical duplicate operation ID as an idempotent append', async () => {
      const store = await factory()
      const mutation = { type: 'append' as const, record: ledgerEntry() }
      await store.commit({ scope, runId: 'run-1', expectedRunVersion: 0, expectedTaskRevision: 0, ledgerMutations: [mutation] })
      await store.commit({ scope, runId: 'run-1', expectedRunVersion: 0, expectedTaskRevision: 0, ledgerMutations: [mutation] })

      await expect(store.findLedger({ scope, operationId: 'operation-1' })).resolves.toHaveLength(1)
    })

    it('maintains monotonic acknowledgements independently for each subscriber', async () => {
      const store = await factory()
      await store.commit({
        scope,
        runId: 'run-1',
        expectedRunVersion: 0,
        expectedTaskRevision: 0,
        streamEvents: [
          { type: 'append', record: streamEvent('one') },
          { type: 'append', record: streamEvent('two') }
        ]
      })

      await expect(store.ackStream('stream-1', 'subscriber-a', 2)).resolves.toBeUndefined()
      await expect(store.ackStream('stream-1', 'subscriber-b', 1)).resolves.toBeUndefined()
      await expect(store.ackStream('stream-1', 'subscriber-a', 1)).rejects.toBeInstanceOf(EngineStoreConflictError)
    })

    it('claims each unit of work atomically at most once', async () => {
      const store = await factory()
      await store.commit({
        scope,
        runId: 'run-1',
        expectedRunVersion: 0,
        expectedTaskRevision: 0,
        outboxIntents: [{
          type: 'put',
          record: {
            workId: 'work-1', scope, kind: 'job', payloadRef: 'outbox://work-1', status: 'pending',
            availableAt: timestamp, createdAt: timestamp, updatedAt: timestamp
          }
        }]
      })

      const claims = await Promise.all([
        store.claimWork('worker-a', ['job'], 10_000),
        store.claimWork('worker-b', ['job'], 10_000)
      ])
      expect(claims.filter(Boolean)).toHaveLength(1)
      expect(claims.filter(Boolean)[0]).toMatchObject({ workId: 'work-1' })
    })
  })
}
