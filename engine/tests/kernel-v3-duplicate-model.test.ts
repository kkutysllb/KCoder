import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore, InMemoryEffectResultStore } from '@qiongqi/adapter-storage'
import {
  ExecutionLedgerService,
  ModelProposalRunner,
  ModelResolutionRequiredError
} from '@qiongqi/loop'
import type { ModelClient, ModelRequest } from '@qiongqi/ports'
import type { RunIdentity, TaskScope } from '@qiongqi/contracts'
import fixture from './fixtures/kernel-governance/duplicate-model-request.json'

const identity: RunIdentity = {
  ownerUserId: 'owner-1', workspaceKey: 'workspace-1', threadId: 'thread-1', turnId: 'turn-1', runId: 'run-1'
}
const scope: TaskScope = { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' }
const request = {
  threadId: identity.threadId,
  turnId: identity.turnId,
  model: fixture.model,
  prefix: [],
  history: [],
  tools: [],
  abortSignal: new AbortController().signal
} as ModelRequest

class CountingModel implements ModelClient {
  readonly provider = 'fixture-provider'
  readonly model = fixture.model
  physicalRequests = 0
  fail = false

  async *stream() {
    this.physicalRequests += 1
    if (this.fail) throw new Error('connection lost after provider acceptance')
    yield { kind: 'assistant_text_delta' as const, text: fixture.text }
    yield { kind: 'completed' as const, stopReason: 'stop' as const }
  }
}

function attempt(operationId: string) {
  return {
    identity,
    scope,
    kernelRunId: 'kernel-run-1',
    taskRevision: 0,
    contextRevision: 0,
    strategyRevision: 1,
    strategyDigest: 'strategy-1',
    profileRef: { profileId: fixture.profileId, revision: fixture.revision },
    operationId
  }
}

function harness(model: CountingModel) {
  const store = new InMemoryDurableEngineStore()
  const results = new InMemoryEffectResultStore()
  const ledger = new ExecutionLedgerService({ store, nowIso: () => '2026-07-26T00:00:00.000Z' })
  return {
    store,
    runner: new ModelProposalRunner({ client: model, ledger, results })
  }
}

describe('Kernel v3 durable model attempts', () => {
  it('physically sends one request for the same logical task/context/strategy', async () => {
    const model = new CountingModel()
    const { runner, store } = harness(model)
    const original = await runner.run({ request, attempt: attempt('model-operation-1') })
    const replayed = await runner.run({ request, attempt: attempt('model-operation-2') })

    expect(model.physicalRequests).toBe(1)
    expect(replayed.proposalId).toBe(original.proposalId)
    expect(original.proposalId).toBe('model-operation-1')
    await expect(store.findLedger({ scope, kind: 'model', status: 'replayed' })).resolves.toHaveLength(1)
  })

  it('does not resend an uncertain attempt when the provider cannot query operation state', async () => {
    const model = new CountingModel()
    model.fail = true
    const { runner, store } = harness(model)

    await expect(runner.run({ request, attempt: attempt('model-operation-uncertain') }))
      .rejects.toThrow('connection lost after provider acceptance')
    model.fail = false
    await expect(runner.run({ request, attempt: attempt('model-operation-retry') }))
      .rejects.toBeInstanceOf(ModelResolutionRequiredError)

    expect(model.physicalRequests).toBe(1)
    await expect(store.findLedger({ scope, kind: 'model', status: 'uncertain' })).resolves.toHaveLength(1)
  })
})
