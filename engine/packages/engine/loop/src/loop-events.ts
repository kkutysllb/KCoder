/**
 * Event-recording helpers shared across the loop collaborators.
 *
 * Extracted from the legacy monolithic `AgentLoop` to break the dependency
 * that would otherwise form between the orchestrator, the prompt builder,
 * and the model-step runner. Behaviour is preserved verbatim.
 */

import type { PipelineStage } from '@qiongqi/contracts'
import type { RuntimeEventRecorder } from '@qiongqi/services'
import type { TurnService } from '@qiongqi/services'
import type { UsageService } from '@qiongqi/services'
import { estimateDeepseekInputTokenCost } from '@qiongqi/adapter-model'

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  setup: 'Setup',
  pre_start: 'Pre-Start',
  post_start: 'Post-Start',
  input_received: 'Input Received',
  input_cached: 'Input Cached',
  input_routed: 'Input Routed',
  input_compressed: 'Input Compressed',
  input_remembered: 'Input Remembered',
  pre_send: 'Pre-Send',
  post_send: 'Post-Send',
  response_received: 'Response Received'
}

export async function recordPipelineStage(
  events: RuntimeEventRecorder,
  input: {
    threadId: string
    turnId: string
    stage: PipelineStage
    details?: Record<string, unknown>
  }
): Promise<void> {
  await events.record({
    kind: 'pipeline_stage',
    threadId: input.threadId,
    turnId: input.turnId,
    stage: input.stage,
    label: PIPELINE_STAGE_LABELS[input.stage],
    ...(input.details && Object.keys(input.details).length > 0 ? { details: input.details } : {})
  })
}

export async function recordTokenEconomySavings(
  usage: UsageService,
  events: RuntimeEventRecorder,
  input: {
    threadId: string
    turnId: string
    model: string
    rawInputTokens: number
    sentInputTokens: number
  }
): Promise<void> {
  const savedTokens = Math.max(0, Math.floor(input.rawInputTokens - input.sentInputTokens))
  if (savedTokens <= 0) return
  const estimatedCost = estimateDeepseekInputTokenCost({
    model: input.model,
    inputTokens: savedTokens
  })
  const usageRecord = usage.recordTokenEconomySavings(input.threadId, {
    tokenEconomySavingsTokens: savedTokens,
    ...(estimatedCost ? { tokenEconomySavingsUsd: estimatedCost.costUsd } : {}),
    ...(estimatedCost ? { tokenEconomySavingsCny: estimatedCost.costCny } : {})
  })
  await events.record({
    kind: 'usage',
    threadId: input.threadId,
    turnId: input.turnId,
    model: input.model,
    usage: usageRecord
  })
}

export async function recordToolCatalogDrift(
  turns: TurnService,
  events: RuntimeEventRecorder,
  input: {
    threadId: string
    turnId: string
    fingerprint: string
    toolCount: number
    toolNames: string[]
    changeKind: 'additive' | 'breaking'
    message: string
  }
): Promise<void> {
  void turns
  await events.record({
    kind: 'tool_catalog_changed',
    threadId: input.threadId,
    turnId: input.turnId,
    fingerprint: input.fingerprint,
    toolCount: input.toolCount,
    changeKind: input.changeKind,
    toolNames: input.toolNames.slice(0, 50),
    message: input.message
  })
}
