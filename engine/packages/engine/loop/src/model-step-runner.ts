/**
 * ModelStepRunner owns the streaming model request: it consumes the
 * `model.stream(request)` async iterable, accumulates assistant text and
 * reasoning deltas (persisting them for SSE replay), materialises
 * `tool_call_complete` chunks into tool_call items, folds usage telemetry,
 * and records the `response_received` pipeline stage.
 *
 * It returns a structured `StepResult` and performs NO continuation
 * decisions. Extracted verbatim from the legacy monolithic `AgentLoop`.
 */

import type { ModelClient, ModelRequest } from '@qiongqi/ports'
import type { ToolCallLike, ToolProviderKind } from '@qiongqi/ports'
import type { RuntimeEventRecorder } from '@qiongqi/services'
import type { TurnService } from '@qiongqi/services'
import type { UsageService } from '@qiongqi/services'
import type { IdGenerator } from '@qiongqi/ports'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeToolCallItem
} from '@qiongqi/domain'
import { repairDispatchToolCall } from './tool-call-repair.js'
import { recordPipelineStage } from './loop-events.js'

type StopReason = 'stop' | 'tool_calls' | 'length' | 'error'

export type StepResult =
  | { kind: 'aborted' }
  | {
      kind: 'ran'
      text: string
      textItemId: string
      reasoning: string
      reasoningItemId: string
      completedToolCalls: ToolCallLike[]
      stopReason: StopReason
    }

export type ModelStepRunnerDeps = {
  model: ModelClient
  events: RuntimeEventRecorder
  turns: TurnService
  usage: UsageService
  ids: IdGenerator
  toolArgumentRepair?: {
    maxStringBytes?: number
  }
}

export class ModelStepRunner {
  constructor(private readonly deps: ModelStepRunnerDeps) {}

  async run(input: {
    request: ModelRequest
    threadId: string
    turnId: string
    signal: AbortSignal
    toolProviderMetadata: ReadonlyMap<string, { providerId?: string; providerKind?: ToolProviderKind }>
    toolKinds: ReadonlyMap<string, 'tool_call' | 'command_execution' | 'file_change' | undefined>
    recordPromptPressure: (threadId: string, model: string, promptTokens: number) => void
  }): Promise<StepResult> {
    const { request, threadId, turnId, signal } = input
    const textAccumulator: { value: string } = { value: '' }
    const reasoningAccumulator: { value: string } = { value: '' }
    let textItemId = ''
    let reasoningItemId = ''
    let reasoningSignature = ''
    const completedToolCalls: ToolCallLike[] = []
    let stopReason: StopReason = 'stop'

    for await (const chunk of this.deps.model.stream(request)) {
      if (signal.aborted) return { kind: 'aborted' }
      switch (chunk.kind) {
        case 'assistant_text_delta':
          textItemId ||= this.deps.ids.next('item_text')
          textAccumulator.value += chunk.text
          await this.deps.events.record({
            kind: 'assistant_text_delta',
            threadId,
            turnId,
            itemId: textItemId,
            item: makeAssistantTextItem({
              id: textItemId,
              turnId,
              threadId,
              text: chunk.text,
              status: 'running'
            })
          })
          break
        case 'assistant_reasoning_delta':
          reasoningItemId ||= this.deps.ids.next('item_reasoning')
          reasoningAccumulator.value += chunk.text
          if (chunk.signature) reasoningSignature = chunk.signature
          await this.deps.events.record({
            kind: 'assistant_reasoning_delta',
            threadId,
            turnId,
            itemId: reasoningItemId,
            item: makeAssistantReasoningItem({
              id: reasoningItemId,
              turnId,
              threadId,
              text: chunk.text,
              ...(chunk.signature ? { signature: chunk.signature } : {}),
              status: 'running'
            })
          })
          break
        case 'tool_call_delta':
          break
        case 'tool_call_complete': {
          const provider = input.toolProviderMetadata.get(chunk.toolName)
          const toolKind = input.toolKinds.get(chunk.toolName)
          const repaired = repairDispatchToolCall({
            callId: chunk.callId,
            toolName: chunk.toolName,
            ...(provider?.providerId ? { providerId: provider.providerId } : {}),
            toolKind,
            arguments: chunk.arguments
          }, {
            toolName: chunk.toolName,
            ...(toolKind ? { toolKind } : {}),
            ...(this.deps.toolArgumentRepair?.maxStringBytes !== undefined
              ? { maxStringBytes: this.deps.toolArgumentRepair.maxStringBytes }
              : {})
          })
          completedToolCalls.push(repaired.call)
          const itemId = `item_tool_${turnId}_${chunk.callId}`
          await this.deps.turns.applyItem(
            threadId,
            makeToolCallItem({
              id: itemId,
              turnId,
              threadId,
              callId: repaired.call.callId,
              toolName: repaired.call.toolName,
              toolKind: repaired.call.toolKind ?? toolKind,
              arguments: repaired.call.arguments,
              ...(repaired.notes.length
                ? { summary: `Repaired tool call: ${repaired.notes.join('; ')}` }
                : {})
            })
          )
          await this.deps.events.record({
            kind: 'tool_call_ready',
            threadId,
            turnId,
            itemId,
            callId: repaired.call.callId,
            toolName: repaired.call.toolName,
            readyCount: completedToolCalls.length
          })
          break
        }
        case 'usage': {
          input.recordPromptPressure(threadId, request.model, chunk.usage.promptTokens)
          const usage = this.deps.usage.record(threadId, chunk.usage)
          await this.deps.events.record({
            kind: 'usage',
            threadId,
            turnId,
            model: request.model,
            usage
          })
          break
        }
        case 'completed':
          stopReason = chunk.stopReason
          break
        case 'error':
          await this.deps.events.record({
            kind: 'error',
            threadId,
            turnId,
            message: chunk.message,
            code: chunk.code
          })
          stopReason = 'error'
          break
      }
    }
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'response_received',
      details: {
        stopReason,
        toolCallCount: completedToolCalls.length
      }
    })
    if (reasoningAccumulator.value || reasoningSignature) {
      const itemId = reasoningItemId || this.deps.ids.next('item_reasoning')
      await this.deps.turns.applyItem(
        threadId,
        makeAssistantReasoningItem({
          id: itemId,
          turnId,
          threadId,
          text: reasoningAccumulator.value,
          ...(reasoningSignature ? { signature: reasoningSignature } : {}),
          status: 'completed'
        })
      )
      reasoningItemId = itemId
    }
    if (textAccumulator.value) {
      const itemId = textItemId || this.deps.ids.next('item_text')
      await this.deps.turns.applyItem(
        threadId,
        makeAssistantTextItem({
          id: itemId,
          turnId,
          threadId,
          text: textAccumulator.value,
          status: 'completed'
        })
      )
      textItemId = itemId
    }
    return {
      kind: 'ran',
      text: textAccumulator.value,
      textItemId,
      reasoning: reasoningAccumulator.value,
      reasoningItemId,
      completedToolCalls,
      stopReason
    }
  }
}
