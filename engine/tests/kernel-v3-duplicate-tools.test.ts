import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore, InMemoryEffectResultStore, InMemoryRunEventStore } from '@qiongqi/adapter-storage'
import { CapabilityRegistry } from '@qiongqi/adapter-tools'
import { makeToolResultItem } from '@qiongqi/domain'
import {
  EffectCommitCoordinator,
  ExecutionLedgerService,
  ToolRuntimeV3,
  toolExactFingerprint
} from '@qiongqi/loop'
import type { RunIdentity, RunStateV3, TaskScope, ToolExecutionLedgerEntry } from '@qiongqi/contracts'
import type {
  ToolCallLike,
  ToolHost,
  ToolHostContext,
  ToolReplayDescriptor
} from '@qiongqi/ports'
import semanticFixture from './fixtures/kernel-governance/duplicate-semantic-tools.json'

const identity: RunIdentity = {
  ownerUserId: 'owner-1', workspaceKey: 'workspace-1', threadId: 'thread-1', turnId: 'turn-1', runId: 'run-1'
}
const scope: TaskScope = { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' }
const state: RunStateV3 = {
  version: 3,
  graphVersion: 'graph-1',
  runtimeMode: 'kernel_v3',
  ...identity,
  status: 'running',
  cursor: { stepIndex: 1, nodeId: 'commit-tools', attempt: 0, checkpointSeq: 0 },
  budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  recovery: { attempts: 0, maxAttempts: 3 },
  middleware: {},
  pendingEffects: [],
  committedEffects: [],
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z'
}
const context = {
  threadId: identity.threadId,
  turnId: identity.turnId,
  workspace: identity.workspaceKey,
  ownerUserId: identity.ownerUserId,
  taskScope: scope,
  approvalPolicy: 'trusted',
  abortSignal: new AbortController().signal,
  awaitApproval: async () => 'allow' as const
} as ToolHostContext

type ReplayMode = 'exact-read' | 'semantic-read' | 'verified-write'

class CountingReplayHost implements ToolHost {
  readonly id = 'counting'
  physicalExecutions = 0
  verifications = 0

  constructor(private readonly mode: ReplayMode) {}

  async listTools() {
    return [{ name: 'resource', description: 'resource', inputSchema: {} }]
  }

  async describeReplay(call: ToolCallLike): Promise<ToolReplayDescriptor> {
    const exactFingerprint = toolExactFingerprint({
      scope,
      call,
      resourceVersions: { resource: 'version-1' }
    })
    if (this.mode === 'semantic-read') {
      return {
        effectPolicy: 'safe',
        exactFingerprint,
        semanticKey: semanticFixture.semanticKey,
        preconditionVersions: { resource: semanticFixture.resourceVersion }
      }
    }
    if (this.mode === 'verified-write') {
      return {
        effectPolicy: 'verify-before-replay',
        exactFingerprint,
        semanticKey: 'resource:verified-write',
        preconditionVersions: { resource: 'version-1' }
      }
    }
    return {
      effectPolicy: 'safe',
      exactFingerprint,
      semanticKey: exactFingerprint,
      preconditionVersions: { resource: 'version-1' }
    }
  }

  async verifyReplay(input: { previous: ToolExecutionLedgerEntry }) {
    this.verifications += 1
    return {
      valid: this.mode === 'verified-write',
      observedPostconditions: this.mode === 'verified-write'
        ? { resource: 'committed-version-1' }
        : input.previous.observedPostconditions
    }
  }

  async execute(call: ToolCallLike): Promise<ReturnType<ToolHost['execute']> extends Promise<infer T> ? T : never> {
    this.physicalExecutions += 1
    return {
      approved: true,
      item: makeToolResultItem({
        id: `item-${call.callId}`,
        threadId: identity.threadId,
        turnId: identity.turnId,
        callId: call.callId,
        toolName: call.toolName,
        output: { ok: true, execution: this.physicalExecutions }
      })
    }
  }
}

function runtime(host: ToolHost) {
  const store = new InMemoryDurableEngineStore()
  return {
    store,
    runtime: new ToolRuntimeV3({
      toolHost: host,
      effects: new EffectCommitCoordinator({
        events: new InMemoryRunEventStore(),
        results: new InMemoryEffectResultStore(),
        nowIso: () => '2026-07-26T00:00:00.000Z'
      }),
      ledger: new ExecutionLedgerService({ store, nowIso: () => '2026-07-26T00:00:00.000Z' })
    })
  }
}

async function executeTwice(mode: ReplayMode, calls: [ToolCallLike, ToolCallLike]) {
  const host = new CountingReplayHost(mode)
  const harness = runtime(host)
  const durable = { scope, kernelRunId: 'kernel-run-1', taskRevision: 0 }
  const first = await harness.runtime.execute({
    identity, state, call: calls[0], context, policy: { effect: 'read', replay: 'safe' }, durable
  })
  const second = await harness.runtime.execute({
    identity,
    state: first.state,
    call: calls[1],
    context,
    policy: mode === 'verified-write'
      ? { effect: 'non-idempotent-write', replay: 'verify-first' }
      : { effect: 'read', replay: 'safe' },
    durable
  })
  return { ...harness, host, first, second }
}

describe('Kernel v3 durable duplicate tools', () => {
  it('executes exact arguments once even when the model emits a new callId', async () => {
    const harness = await executeTwice('exact-read', [
      { callId: 'call-1', toolName: 'resource', arguments: { path: 'a', line: 2 } },
      { callId: 'call-2', toolName: 'resource', arguments: { line: 2, path: 'a' } }
    ])

    expect(harness.host.physicalExecutions).toBe(1)
    expect(harness.second.replayed).toBe(true)
    expect(harness.second.observation).toMatchObject({ callId: 'call-2', replayed: true })
    await expect(harness.store.findLedger({ scope, kind: 'tool', status: 'replayed' })).resolves.toHaveLength(1)
  })

  it('suppresses adapter-declared equivalent reads while resource versions are unchanged', async () => {
    const harness = await executeTwice('semantic-read', [
      { ...semanticFixture.calls[0]!, toolName: 'resource' },
      { ...semanticFixture.calls[1]!, toolName: 'resource' }
    ])

    expect(harness.host.physicalExecutions).toBe(1)
    expect(harness.second.observation?.replayed).toBe(true)
    await expect(harness.store.findLedger({ scope, kind: 'tool', status: 'suppressed' })).resolves.toHaveLength(1)
  })

  it('suppresses a repeated write only after verifyReplay confirms its postcondition', async () => {
    const harness = await executeTwice('verified-write', [
      { callId: 'call-1', toolName: 'resource', arguments: { value: 'desired' } },
      { callId: 'call-2', toolName: 'resource', arguments: { value: 'desired' } }
    ])

    expect(harness.host.physicalExecutions).toBe(1)
    expect(harness.host.verifications).toBeGreaterThan(0)
    expect(harness.second.observation?.replayed).toBe(true)
    await expect(harness.store.findLedger({ scope, kind: 'tool', status: 'suppressed' })).resolves.toHaveLength(1)
  })

  it('rejects a registered tool without replay metadata', () => {
    expect(() => new CapabilityRegistry([{
      id: 'unsafe-provider',
      kind: 'mcp',
      enabled: true,
      available: true,
      tools: [{
        name: 'unsafe', description: 'unsafe', inputSchema: {}, toolKind: 'tool_call', policy: 'auto',
        execute: async () => ({ output: {} })
      } as never]
    }])).toThrow(/tool_replay_policy_missing/)
  })
})
