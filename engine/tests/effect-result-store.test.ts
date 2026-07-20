import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FileEffectResultStore,
  InMemoryEffectResultStore,
  InMemoryRunEventStore
} from '@qiongqi/adapter-storage'
import type { RunIdentity } from '@qiongqi/contracts'
import { digestValue, EffectCommitCoordinator, ToolRuntimeV3 } from '@qiongqi/loop'
import type { ToolHost, ToolHostContext } from '@qiongqi/ports'

const identity: RunIdentity = {
  ownerUserId: 'owner-1',
  workspaceKey: '/workspace-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  runId: 'run-1'
}

describe('EffectResultStore', () => {
  it('replays a committed result after the coordinator process is replaced', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-effect-results-'))
    const results = new FileEffectResultStore(root)
    const events = new InMemoryRunEventStore()
    const counter = { value: 0 }
    const firstRuntime = new ToolRuntimeV3({
      toolHost: host(counter),
      effects: new EffectCommitCoordinator({ events, results })
    })
    const first = await firstRuntime.execute({
      identity,
      state: state(),
      call: { callId: 'call-1', toolName: 'write', arguments: { value: 1 } },
      context,
      policy: { effect: 'idempotent-write', replay: 'verify-first' }
    })

    const secondRuntime = new ToolRuntimeV3({
      toolHost: host(counter),
      effects: new EffectCommitCoordinator({ events, results: new FileEffectResultStore(root) })
    })
    const second = await secondRuntime.execute({
      identity,
      state: first.state,
      call: { callId: 'call-1', toolName: 'write', arguments: { value: 1 } },
      context,
      policy: { effect: 'idempotent-write', replay: 'verify-first' }
    })

    expect(counter.value).toBe(1)
    expect(second.replayed).toBe(true)
    expect(second.result).toEqual(first.result)
  })

  it('isolates equal idempotency keys by full run identity', async () => {
    const store = new InMemoryEffectResultStore()
    await store.save(identity, 'same-key', digestValue({ ok: true }), { ok: true })
    await expect(store.load({ ...identity, ownerUserId: 'owner-2' }, 'same-key')).resolves.toBeUndefined()
    await expect(store.load({ ...identity, workspaceKey: '/workspace-2' }, 'same-key')).resolves.toBeUndefined()
  })

  it('rejects a file whose persisted result no longer matches its digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-effect-tamper-'))
    const store = new FileEffectResultStore(root)
    const digest = digestValue({ ok: true })
    await store.save(identity, 'call-key', digest, { ok: true })
    await writeFile(store.resultPath(identity, 'call-key'), JSON.stringify({ resultDigest: digest, result: { ok: false } }), 'utf8')
    await expect(store.load(identity, 'call-key')).rejects.toThrow('effect result digest mismatch')
  })
})

const context = {
  threadId: identity.threadId,
  turnId: identity.turnId,
  workspace: identity.workspaceKey,
  approvalPolicy: 'trusted',
  abortSignal: new AbortController().signal,
  awaitApproval: async () => 'allow'
} as ToolHostContext

function host(counter: { value: number }): ToolHost {
  return {
    id: 'test',
    async listTools() { return [] },
    async execute(call) {
      counter.value += 1
      return {
        approved: true,
        item: {
          id: `result-${call.callId}`,
          threadId: identity.threadId,
          turnId: identity.turnId,
          role: 'tool',
          status: 'completed',
          createdAt: 'now',
          kind: 'tool_result',
          toolName: call.toolName,
          callId: call.callId,
          toolKind: 'tool_call',
          output: { count: counter.value },
          isError: false
        }
      }
    }
  }
}

function state() {
  return {
    version: 3 as const,
    graphVersion: 'test',
    runtimeMode: 'kernel_v3' as const,
    ...identity,
    status: 'running' as const,
    cursor: { stepIndex: 0, nodeId: 'tool', attempt: 0, checkpointSeq: 0 },
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    recovery: { attempts: 0, maxAttempts: 1 },
    middleware: {},
    nodeData: {},
    taskRevision: 0,
    pendingEffects: [],
    committedEffects: [],
    createdAt: 'now',
    updatedAt: 'now'
  }
}
