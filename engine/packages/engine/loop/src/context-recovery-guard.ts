import type { TurnItem } from '@qiongqi/contracts'
import type { BuildContext } from './prompt-builder.js'

export function looksLikeContextLossClarification(text: string): boolean {
  const compact = text.replace(/\s+/g, '').toLowerCase()
  if (!compact) return false
  const mentionsContextLoss =
    /(?:上下文|对话|历史|conversation|context|history).*(?:压缩|丢失|遗失|无法还原|无法恢复|不记得|compressed|lost|missing|forgot|cannotrecover|unabletorecover)/i.test(compact) ||
    /(?:无法还原|无法恢复|不记得).*(?:请求|任务|原文|需求|request|task)/i.test(compact)
  if (!mentionsContextLoss) return false
  return /(?:请问|告诉我|重述|重新说明|想做什么|怎么继续|如何继续|what.*do|what.*next|restate|repeat|clarify)/i.test(compact)
}

export function hasRecoverableTaskState(ctx: BuildContext): boolean {
  if (ctx.activeGoalInstruction?.trim()) return true
  return ctx.healedItems.some(hasRecoverableCompactionState)
}

function hasRecoverableCompactionState(item: TurnItem): boolean {
  if (item.kind !== 'compaction' || item.replacedTokens <= 0) return false
  const summary = item.summary.trim()
  if (!summary) return false
  if (/Task resumption state:/i.test(summary) && /Active objective:/i.test(summary)) return true
  return /(?:latest unresolved|active objective|当前任务|下一步|next actions?)/i.test(summary)
}
