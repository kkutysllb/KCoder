/**
 * LoopPolicy: pure decision function deciding whether a turn step should
 * stop, continue, fail, dispatch tool calls, or materialise a plan.
 *
 * Logic migrated verbatim from continuation-policy.ts decideContinuation.
 * Zero side effects. Side effects (applyItem/dispatch/record) live in LoopRunner.
 */

import type { ToolCallLike } from '@qiongqi/ports'
import type { IdGenerator } from '@qiongqi/ports'
import type { TurnItem } from '@qiongqi/contracts'
import { makeToolCallItem } from '@qiongqi/domain'
import { CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'
import { latestUserMessageText } from './loop-helpers.js'
import type { BuildContext } from './prompt-builder.js'
import type { StepResult } from './model-step-runner.js'
import { hasRecoverableTaskState, looksLikeContextLossClarification } from './context-recovery-guard.js'

export interface LoopPolicyInput {
  stepResult: Extract<StepResult, { kind: 'ran' }>
  ctx: BuildContext
  ids: IdGenerator
  threadId: string
  turnId: string
}

export type LoopDecision =
  | { action: 'stop' }
  | { action: 'continue' }
  | { action: 'failed' }
  | { action: 'failed_with_error'; errorMessage: string; errorCode: string }
  | { action: 'materialize_plan'; planCall: ToolCallLike; planToolCallItem: TurnItem }
  | { action: 'dispatch' }

export function decideLoopContinuation(input: LoopPolicyInput): LoopDecision {
  const { stepResult, ctx, ids, threadId, turnId } = input
  const request = ctx.request

  if (stepResult.stopReason === 'error') {
    return { action: 'failed' }
  }

  if (stepResult.completedToolCalls.length === 0) {
    if (request.requiredToolName) {
      if (
        request.requiredToolName === CREATE_PLAN_TOOL_NAME &&
        stepResult.text.trim()
      ) {
        const callId = ids.next('call_plan')
        const provider = ctx.toolProviderMetadata.get(CREATE_PLAN_TOOL_NAME)
        const toolKind = ctx.toolKinds.get(CREATE_PLAN_TOOL_NAME)
        const sourceRequest = ctx.activePlanContext?.sourceRequest ||
          latestUserMessageText(ctx.healedItems, turnId) ||
          ctx.turn?.prompt ||
          ''
        const argumentsForFallback: Record<string, unknown> = ctx.activePlanContext
          ? {
              markdown: stepResult.text.trim(),
              operation: ctx.activePlanContext.operation,
              plan_id: ctx.activePlanContext.planId,
              plan_relative_path: ctx.activePlanContext.relativePath,
              ...(sourceRequest ? { source_request: sourceRequest } : {}),
              ...(ctx.activePlanContext.title ? { title: ctx.activePlanContext.title } : {})
            }
          : {
              markdown: stepResult.text.trim(),
              operation: 'draft',
              ...(sourceRequest ? { source_request: sourceRequest } : {})
            }
        const planCall: ToolCallLike = {
          callId,
          toolName: CREATE_PLAN_TOOL_NAME,
          ...(provider?.providerId ? { providerId: provider.providerId } : {}),
          toolKind,
          arguments: argumentsForFallback
        }
        const itemId = `item_tool_${turnId}_${callId}`
        const planToolCallItem = makeToolCallItem({
          id: itemId,
          turnId,
          threadId,
          callId,
          toolName: CREATE_PLAN_TOOL_NAME,
          toolKind,
          arguments: argumentsForFallback,
          summary: 'Materialized assistant plan text into the required GUI plan.'
        })
        return { action: 'materialize_plan', planCall, planToolCallItem }
      }
      const message = `Model did not call the required \`${request.requiredToolName}\` tool for this GUI plan turn.`
      return { action: 'failed_with_error', errorMessage: message, errorCode: 'required_tool_missing' }
    }
    if (stepResult.stopReason === 'stop' && ctx.activeGoalInstruction) {
      return { action: 'continue' }
    }
    if (shouldContinueAfterNonTerminalStop(stepResult, ctx)) {
      return { action: 'continue' }
    }
    return { action: 'stop' }
  }

  return { action: 'dispatch' }
}

function shouldContinueAfterNonTerminalStop(
  stepResult: Extract<StepResult, { kind: 'ran' }>,
  ctx: BuildContext
): boolean {
  if (stepResult.stopReason !== 'stop') return false
  if (stepResult.completedToolCalls.length > 0) return false
  if ((ctx.toolSpecs?.length ?? 0) === 0) return false
  const text = stepResult.text.trim()
  if (!text) return false
  if (looksLikeContextLossClarification(text) && hasRecoverableTaskState(ctx)) return false
  if (looksTerminal(text)) return false
  return looksLikeActionPreamble(text)
}

function looksTerminal(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  return /(?:分析完成|任务完成|已完成|修复完成|生成完成|处理完成|结论|总结|根因|最终答案|finalanswer|allcomplete|alltaskscomplete|taskcomplete|everythingdone|workcomplete|conclusion|inconclusion|tosummarize|resolved|fixed|nothingelse|nothingmore|nofurtheraction|completed|done|hereis|result|summary)/i.test(compact)
}

/**
 * Detect text that sounds like the model is about to take action but
 * didn't produce tool calls (e.g. a preamble that was cut short, or a
 * provider that stopped prematurely after describing its intent).
 *
 * Patterns are matched against the text with all whitespace removed.
 * The regex uses the case-insensitive flag so both Chinese and English
 * models are covered.
 */
function looksLikeActionPreamble(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  return /(?:我将|我会|我先|我现在|让我|让我来|马上开始|准备开始|开始执行|先读取|先检查|先分析|先查看|先搜索|先了解|先确认|现在开始|接下来|下一步|继续分析|继续执行|继续完成|继续往下|接着往下|立刻继续|往下推进|需要先|letme|let's|lets|i'mgoing|i'mabout|i'mstarting|i'm|startby|firsti|firstlet|beginby|proceedto|goingto|aboutto|lookinto|lookatthe|movingon|myapproach|myplanis|i(?:'ll|will|willbe|needto|should|shall)|nexti|nowi)/i.test(compact)
}
