import { describe, expect, it } from 'vitest'
import { InMemoryMailboxStore, InMemoryMultiAgentRunStore } from '@qiongqi/adapter-storage'
import type { AgentExecutionInput, AgentExecutor } from '@qiongqi/loop'
import { EventedV2MultiAgentRuntime } from '@qiongqi/loop'

const graph = {
  version: 1 as const,
  graphId: 'maker-checker',
  startNodeId: 'implementer',
  nodes: [
    { id: 'implementer', kind: 'agent' as const, agentId: 'implementer' },
    { id: 'checker', kind: 'judge' as const, policy: 'evidence_required' },
    { id: 'accepted', kind: 'terminate' as const },
    { id: 'rejected', kind: 'terminate' as const }
  ],
  edges: [
    { from: 'implementer', to: 'checker', condition: 'completed' },
    { from: 'checker', to: 'accepted', condition: 'accepted' },
    { from: 'checker', to: 'rejected', condition: 'rejected' }
  ]
}

describe('maker/checker isolation', () => {
  it('rejects without shared evidence and does not start a judge Kernel', async () => {
    const executor = capturingExecutor()
    const runtime = createRuntime(executor)
    const run = await startAndEnterJudge(runtime)

    const rejected = await runtime.dispatchActiveAgent({
      runId: run.runId,
      scope: { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' },
      prompt: 'Judge the work.',
      requestedBudget: zeroBudget(),
      sharedEvidenceRefs: []
    })

    expect(rejected).toMatchObject({ status: 'completed', activeNodeId: 'rejected' })
    expect(executor.inputs).toHaveLength(0)
  })

  it('starts the judge with a distinct AgentRun and only shared evidence', async () => {
    const executor = capturingExecutor()
    const runtime = createRuntime(executor)
    const run = await startAndEnterJudge(runtime)
    const implementerRunId = run.agentRuns[0]!.agentRunId

    await runtime.dispatchActiveAgent({
      runId: run.runId,
      scope: { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' },
      prompt: 'Judge the work.',
      requestedBudget: zeroBudget(),
      sharedEvidenceRefs: ['artifact-1']
    })

    expect(executor.inputs).toMatchObject([{
      role: 'judge',
      sharedEvidenceRefs: ['artifact-1'],
      agentId: 'judge:checker'
    }])
    expect(executor.inputs[0]!.agentRunId).not.toBe(implementerRunId)
    expect(executor.inputs[0]).not.toHaveProperty('agentPrivateMemory')
  })
})

async function startAndEnterJudge(runtime: EventedV2MultiAgentRuntime) {
  const started = await runtime.start({
    threadId: 'thread-1', turnId: 'turn-1', workspaceKey: 'workspace-1', prompt: 'Implement.'
  })
  return runtime.completeAgentTask({ runId: started.runId, agentId: 'implementer', condition: 'completed' })
}

function createRuntime(executor: ReturnType<typeof capturingExecutor>) {
  return new EventedV2MultiAgentRuntime({
    runs: new InMemoryMultiAgentRunStore(),
    mailbox: new InMemoryMailboxStore(),
    graph,
    ids: nextId(),
    nowIso: () => '2026-07-26T00:00:00.000Z',
    agentExecutor: executor
  })
}

function capturingExecutor(): AgentExecutor & { inputs: AgentExecutionInput[] } {
  const inputs: AgentExecutionInput[] = []
  return {
    inputs,
    execute: async (input) => {
      inputs.push(input)
      return {
        executionRef: {
          scope: input.scope,
          parentKind: 'agent',
          multiAgentRunId: input.multiAgentRunId,
          agentRunId: input.agentRunId,
          parentRunId: input.agentRunId,
          kernelRunId: `kernel:${input.agentRunId}`
        }
      }
    },
    resume: async () => undefined,
    cancel: async () => undefined
  }
}

function nextId() {
  let value = 0
  return (prefix: string) => `${prefix}-${++value}`
}

function zeroBudget() {
  return { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
}
