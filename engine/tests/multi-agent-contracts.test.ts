import { describe, expect, it } from 'vitest'
import {
  AgentGraphSchema,
  KernelDispatchPayloadSchema,
  MailboxMessageSchema,
  MultiAgentOutboxIntentSchema,
  MultiAgentRunSchema,
  TaskEnvelopeSchema
} from '@qiongqi/contracts'

describe('multi-agent runtime contracts', () => {
  it('parses a policy-safe prepared Kernel dispatch and rejects raw input', () => {
    const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'task' }
    const dispatch = {
      schemaVersion: 1,
      identity: {
        scope,
        multiAgentRunId: 'root-1',
        parentRunId: 'root-1',
        agentRunId: 'agent-1',
        agentId: 'writer',
        nodeId: 'write',
        executionRef: {
          scope,
          parentKind: 'agent',
          multiAgentRunId: 'root-1',
          agentRunId: 'agent-1',
          parentRunId: 'agent-1',
          kernelRunId: 'kernel-1'
        }
      },
      reservationId: 'reservation:kernel-1',
      requestedBudget: {
        stepsUsed: 1,
        toolCallsUsed: 1,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.1
      },
      role: 'agent',
      inputRef: 'graph-run://root-1/events/start-1/prompt'
    } as const

    const parsed = KernelDispatchPayloadSchema.parse(dispatch)
    expect(parsed.identity.executionRef.kernelRunId).toBe('kernel-1')
    expect(() => KernelDispatchPayloadSchema.parse({ ...dispatch, prompt: 'raw secret' })).toThrow()
    expect(() => KernelDispatchPayloadSchema.parse({ ...dispatch, credentialRef: 'secret://model' })).toThrow()
  })

  it('reads legacy dispatches and pins complete execution context in schema v3', () => {
    const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'task' }
    const base = {
      identity: {
        scope,
        multiAgentRunId: 'root-2',
        parentRunId: 'root-2',
        agentRunId: 'agent-2',
        agentId: 'writer',
        nodeId: 'write',
        executionRef: {
          scope,
          parentKind: 'agent' as const,
          multiAgentRunId: 'root-2',
          agentRunId: 'agent-2',
          parentRunId: 'agent-2',
          kernelRunId: 'kernel-2'
        }
      },
      reservationId: 'reservation:kernel-2',
      requestedBudget: {
        stepsUsed: 1,
        toolCallsUsed: 1,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.1
      },
      role: 'agent' as const,
      inputRef: 'graph-run://root-2/events/start-2/prompt'
    }

    expect(KernelDispatchPayloadSchema.parse({ schemaVersion: 1, ...base }).schemaVersion).toBe(1)
    expect(KernelDispatchPayloadSchema.parse({
      schemaVersion: 2,
      ...base,
      executionPolicyRef: {
        policyId: 'product.agent.writer',
        revision: 4,
        digest: 'b'.repeat(64)
      }
    })).toMatchObject({
      schemaVersion: 2,
      executionPolicyRef: {
        policyId: 'product.agent.writer',
        revision: 4,
        digest: 'b'.repeat(64)
      }
    })
    expect(KernelDispatchPayloadSchema.parse({
      schemaVersion: 3,
      ...base,
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceKey: '/workspace',
      nodePolicyRef: { policyId: 'writer-policy', revision: 2 }
    })).toMatchObject({
      schemaVersion: 3,
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceKey: '/workspace',
      nodePolicyRef: { policyId: 'writer-policy', revision: 2 }
    })
  })

  it('parses a manager-to-specialist graph', () => {
    const graph = AgentGraphSchema.parse({
      version: 1,
      graphId: 'graph_default',
      startNodeId: 'manager',
      nodes: [
        {
          id: 'manager', kind: 'agent', agentId: 'manager', label: 'Manager',
          executionPolicyRef: {
            policyId: 'product.agent.manager', revision: 2, digest: 'a'.repeat(64)
          }
        },
        { id: 'handoff_research', kind: 'handoff', targetAgentId: 'researcher' },
        { id: 'researcher', kind: 'agent', agentId: 'researcher', label: 'Researcher' },
        { id: 'done', kind: 'terminate' }
      ],
      edges: [
        { from: 'manager', to: 'handoff_research', condition: 'handoff' },
        { from: 'handoff_research', to: 'researcher', condition: 'accepted' },
        { from: 'researcher', to: 'done', condition: 'completed' }
      ]
    })

    expect(graph.nodes.map((node) => node.kind)).toEqual(['agent', 'handoff', 'agent', 'terminate'])
    expect(graph.nodes[0]).toMatchObject({
      executionPolicyRef: { policyId: 'product.agent.manager', revision: 2, digest: 'a'.repeat(64) }
    })
  })

  it('parses durable independent branch cursors and derives a non-empty join result', () => {
    const run = MultiAgentRunSchema.parse({
      version: 1,
      runId: 'mar_parallel',
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      status: 'running',
      graphId: 'parallel_graph',
      activeNodeId: 'join_all',
      activeAgentStack: [],
      branchStatus: { research: 'running', draft: 'running', review: 'running' },
      branches: {
        research: {
          branchId: 'research', parallelNodeId: 'fan_out', joinNodeId: 'join_all',
          status: 'running', activeNodeId: 'researcher', agentRunIds: [], usageRefs: [], artifactRefs: [],
          updatedAt: '2026-07-27T00:00:00.000Z'
        },
        draft: {
          branchId: 'draft', parallelNodeId: 'fan_out', joinNodeId: 'join_all',
          status: 'suspended', activeNodeId: 'writer_wait', agentRunIds: [], usageRefs: [], artifactRefs: [],
          updatedAt: '2026-07-27T00:00:00.000Z'
        },
        review: {
          branchId: 'review', parallelNodeId: 'fan_out', joinNodeId: 'join_all',
          status: 'completed', activeNodeId: 'join_all', agentRunIds: ['agent_review'],
          output: { text: 'approved' }, usageRefs: ['usage_review'], artifactRefs: ['artifact_review'],
          completedAt: '2026-07-27T00:00:01.000Z', updatedAt: '2026-07-27T00:00:01.000Z'
        }
      },
      agentRuns: [],
      events: [],
      outbox: [],
      retryCounters: {},
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:01.000Z'
    })

    expect(run.branches.draft?.status).toBe('suspended')
    expect(run.branches.review?.output).toEqual({ text: 'approved' })
  })

  it('parses a typed handoff task envelope', () => {
    const envelope = TaskEnvelopeSchema.parse({
      envelopeId: 'env_1',
      kind: 'handoff',
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      threadId: 'thread_1',
      turnId: 'turn_1',
      parentRunId: 'run_parent',
      payload: { prompt: 'Research durable multi-agent orchestration.' },
      createdAt: '2026-07-21T00:00:00.000Z'
    })

    expect(envelope.kind).toBe('handoff')
    expect(envelope.payload.prompt).toContain('Research')
  })

  it('parses a durable multi-agent run with agent sub-runs', () => {
    const run = MultiAgentRunSchema.parse({
      version: 1,
      runId: 'mar_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      status: 'running',
      graphId: 'graph_default',
      activeNodeId: 'manager',
      activeAgentStack: ['manager'],
      branchStatus: {},
      agentRuns: [{
        agentRunId: 'agent_run_1',
        agentId: 'manager',
        nodeId: 'manager',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z'
      }],
      events: [],
      outbox: [],
      retryCounters: {},
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z'
    })

    expect(run.agentRuns[0]?.agentId).toBe('manager')
  })

  it('parses a pending mailbox enqueue outbox intent for recovery', () => {
    const intent = MultiAgentOutboxIntentSchema.parse({
      outboxId: 'outbox_1',
      kind: 'mailbox_enqueue',
      status: 'pending',
      message: {
        messageId: 'msg_1',
        envelopeId: 'env_1',
        runId: 'mar_1',
        fromAgentId: 'manager',
        toAgentId: 'researcher',
        status: 'queued',
        payload: { prompt: 'Summarize existing runtime modes.' },
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z'
      },
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z'
    })

    expect(intent.kind).toBe('mailbox_enqueue')
    expect(intent.status).toBe('pending')
  })

  it('parses a pending mailbox completion outbox intent for recovery', () => {
    const intent = MultiAgentOutboxIntentSchema.parse({
      outboxId: 'outbox_complete_1',
      kind: 'mailbox_complete',
      status: 'pending',
      messageId: 'msg_1',
      mailboxStatus: 'failed',
      claimLease: {
        holderId: 'worker_a',
        expiresAt: '2026-07-21T00:01:00.000Z',
        epoch: 1,
        token: 'claim_token_1'
      },
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z'
    })

    expect(intent.kind).toBe('mailbox_complete')
    expect(intent.status).toBe('pending')
  })

  it('parses a mailbox message correlated to an envelope', () => {
    const message = MailboxMessageSchema.parse({
      messageId: 'msg_1',
      envelopeId: 'env_1',
      runId: 'mar_1',
      fromAgentId: 'manager',
      toAgentId: 'researcher',
      status: 'queued',
      payload: { prompt: 'Summarize existing runtime modes.' },
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z'
    })

    expect(message.status).toBe('queued')
  })
})
