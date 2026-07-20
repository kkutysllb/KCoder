import { z } from 'zod'
import { ToolEffectPolicySchema, ToolObservationSchema, type RunIdentity, type RunOutcome, type RunStateV3, type ToolEffectPolicy, type ToolObservation } from '@qiongqi/contracts'
import type { LeaseFence, ToolCallLike, ToolHost, ToolHostContext, ToolHostPreparation, ToolHostResult } from '@qiongqi/ports'
import { EffectCommitCoordinator } from './effect-commit.js'
import { NormalizedToolHostResultSchema, normalizeToolCall, normalizeToolHostResult, observeNormalizedTool } from './tool-observation.js'

export type CrashPoint = 'prepare' | 'after_tool_execute' | 'before_commit' | 'after_commit'
export type ToolRuntimeV3Options = { toolHost: ToolHost; effects: EffectCommitCoordinator; crashPoint?: (point: CrashPoint) => void }
export type ToolRuntimeV3Input = { identity: RunIdentity; state: RunStateV3; call: ToolCallLike; context: ToolHostContext; policy: ToolEffectPolicy; crashAfterExecute?: boolean; leaseFence?: LeaseFence }
export type ToolRuntimeV3Result = { state: RunStateV3; result?: ToolHostResult; observation?: ToolObservation; replayed: boolean; outcome?: RunOutcome }

type StoredToolRuntimeV3Result = {
  kind: 'tool_runtime_v3_result'
  version: 2
  result: ToolHostResult
  observation?: ToolObservation
}

const StoredToolRuntimeV3ResultSchema = z.object({
  kind: z.literal('tool_runtime_v3_result'),
  version: z.literal(2),
  result: NormalizedToolHostResultSchema,
  observation: ToolObservationSchema.optional()
}).strict()

export class ToolRuntimeV3 {
  // This only coalesces duplicate effects within one ToolRuntimeV3 instance.
  // RuntimeKernel's durable run lease is the cross-instance serialization boundary.
  private readonly inFlight = new Map<string, Promise<ToolRuntimeV3Result>>()

  constructor(private readonly options: ToolRuntimeV3Options) {}

  async execute(input: ToolRuntimeV3Input): Promise<ToolRuntimeV3Result> {
    const policy = ToolEffectPolicySchema.parse(input.policy)
    const call = normalizeToolCall(input.call)
    const key = this.options.effects.idempotencyKey(input.identity, call.callId)
    const running = this.inFlight.get(key)
    if (running) return running
    const promise = this.executeSingle({ ...input, call, policy }, key)
    this.inFlight.set(key, promise)
    try {
      return await promise
    } finally {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key)
    }
  }

  private async executeSingle(
    input: ToolRuntimeV3Input,
    key: string
  ): Promise<ToolRuntimeV3Result> {
    const call = input.call
    const committed = input.state.committedEffects.find((effect) => effect.idempotencyKey === key)
    if (committed) {
      const stored = await this.options.effects.storedResult(input.identity, key)
      if (stored) {
        if (!isStoredToolRuntimeV3ResultCandidate(stored)) {
          return {
            state: input.state,
            result: NormalizedToolHostResultSchema.parse(stored),
            replayed: true
          }
        }
        if (!('version' in stored)) {
          return {
            state: input.state,
            result: NormalizedToolHostResultSchema.parse(stored.result),
            replayed: true
          }
        }
        const parsed = StoredToolRuntimeV3ResultSchema.safeParse(stored)
        if (!parsed.success) throw new Error(`invalid stored tool runtime result: ${parsed.error.message}`)
        const persisted = parsed.data
        return {
          state: input.state,
          result: persisted.result,
          observation: persisted.observation
            ? { ...persisted.observation, replayed: true }
            : undefined,
          replayed: true
        }
      }
      if (input.policy.replay !== 'safe') {
        return { state: input.state, replayed: true, outcome: { status: 'suspended', reason: 'required_action_missing', retryable: true, details: { code: 'effect_requires_verification', idempotencyKey: key } } }
      }
    }
    const pending = input.state.pendingEffects.find((effect) => effect.idempotencyKey === key)
    if (pending && input.policy.replay !== 'safe') {
      return { state: input.state, replayed: true, outcome: { status: 'suspended', reason: 'required_action_missing', retryable: true, details: { code: 'effect_requires_verification', idempotencyKey: key } } }
    }
    const hostPreparation = this.options.toolHost.prepare
      ? await this.options.toolHost.prepare(call, input.context)
      : ({ call } satisfies ToolHostPreparation)
    const effectiveCall = normalizeToolCall(hostPreparation.call)
    if (effectiveCall.callId !== call.callId) throw new Error('tool host preparation changed callId')
    const prepared = this.options.effects.prepare(input.state, input.identity, { callId: effectiveCall.callId, target: effectiveCall.toolName, arguments: effectiveCall.arguments }, input.policy)
    this.options.crashPoint?.('prepare')
    await this.options.effects.recordPrepared(input.identity, prepared.state, prepared.intent, input.leaseFence)
    const rawResult = hostPreparation.result
      ?? await this.options.toolHost.execute(effectiveCall, input.context, undefined, hostPreparation)
    const result = normalizeToolHostResult(
      rawResult,
      effectiveCall,
      input.context
    )
    this.options.crashPoint?.('after_tool_execute')
    if (input.crashAfterExecute) return { state: prepared.state, replayed: false, outcome: { status: 'suspended', reason: 'runtime_error', retryable: true, details: { code: 'crash_between_execute_and_commit', idempotencyKey: key } } }
    this.options.crashPoint?.('before_commit')
    const observation = result.item.kind === 'tool_result'
      ? observeNormalizedTool({ ...input, call: effectiveCall, result, replayed: false })
      : undefined
    const stored = StoredToolRuntimeV3ResultSchema.parse({
      kind: 'tool_runtime_v3_result',
      version: 2,
      result,
      ...(observation ? { observation } : {})
    })
    const committedResult = await this.options.effects.commit(input.identity, prepared.state, prepared.intent, stored, input.leaseFence)
    this.options.crashPoint?.('after_commit')
    return {
      state: committedResult.state,
      result,
      observation,
      replayed: false
    }
  }
}

function isStoredToolRuntimeV3ResultCandidate(value: unknown): value is Record<string, unknown> & { kind: 'tool_runtime_v3_result' } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.kind === 'tool_runtime_v3_result'
}
