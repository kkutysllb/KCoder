import type { TurnItem } from '@qiongqi/contracts'
import type { ModelRequest } from '@qiongqi/ports'
import { repairModelHistoryItems } from '@qiongqi/domain'
import { ContextEstimator } from './context-estimator.js'
import { estimateModelRequestInputTokens } from './model-request-estimator.js'

const CHARS_PER_TOKEN = 4
const CLIP_SAFETY_RATIO = 0.85
const MIN_CLIPPED_ITEM_TOKENS = 24

const estimator = new ContextEstimator(CHARS_PER_TOKEN)

export function applyModelRequestInputBudget(
  request: ModelRequest,
  options: { maxInputTokens: number }
): ModelRequest {
  const maxInputTokens = Math.floor(options.maxInputTokens)
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= 0) return request
  if (estimateModelRequestInputTokens(request) <= maxInputTokens) return request

  const fixedTokens = estimateModelRequestInputTokens({ ...request, history: [] })
  const historyBudget = Math.max(0, maxInputTokens - fixedTokens)
  if (historyBudget <= 0) return { ...request, history: [] }

  let history = repairModelHistoryItems(fitHistoryToBudget(request.history, historyBudget))
  let next: ModelRequest = { ...request, history }
  let estimate = estimateModelRequestInputTokens(next)
  for (let attempts = 0; estimate > maxInputTokens && history.length > 0 && attempts < 4; attempts += 1) {
    const ratio = Math.max(0.1, maxInputTokens / Math.max(estimate, 1))
    const nextBudget = Math.max(1, Math.floor(historyBudget * ratio * CLIP_SAFETY_RATIO))
    history = repairModelHistoryItems(fitHistoryToBudget(request.history, nextBudget))
    next = { ...request, history }
    estimate = estimateModelRequestInputTokens(next)
  }
  if (estimate <= maxInputTokens) return next
  return { ...request, history: [] }
}

function fitHistoryToBudget(history: TurnItem[], budgetTokens: number): TurnItem[] {
  const selected: TurnItem[] = []
  let used = 0
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (!item) continue
    const remaining = budgetTokens - used
    if (remaining <= 0) break
    const itemTokens = estimateItemTokens(item)
    if (itemTokens <= remaining) {
      selected.push(item)
      used += itemTokens
      continue
    }
    const clipped = clipItemForBudget(item, remaining)
    if (clipped) selected.push(clipped)
    break
  }
  return selected.reverse()
}

function estimateItemTokens(item: TurnItem): number {
  return estimator.estimateItem(item)
}

function clipItemForBudget(item: TurnItem, budgetTokens: number): TurnItem | null {
  const safeBudget = Math.floor(budgetTokens * CLIP_SAFETY_RATIO)
  if (safeBudget < MIN_CLIPPED_ITEM_TOKENS) return null
  switch (item.kind) {
    case 'user_message':
    case 'assistant_text':
    case 'assistant_reasoning':
      return {
        ...item,
        text: clipTextForBudget(item.text, safeBudget)
      }
    case 'tool_call':
      return {
        ...item,
        arguments: {
          qiongqi_model_input_budget:
            `Tool arguments truncated for model input budget; original approx ${estimateItemTokens(item)} token(s).`
        }
      }
    case 'tool_result':
      return {
        ...item,
        output: clipTextForBudget(stringifyForBudget(item.output), safeBudget)
      }
    case 'compaction':
      return {
        ...item,
        summary: clipTextForBudget(item.summary, safeBudget)
      }
    case 'review':
      return {
        ...item,
        reviewText: clipTextForBudget(item.reviewText ?? stringifyForBudget(item.output), safeBudget),
        output: undefined
      }
    case 'runtime_progress':
      return item
    case 'approval':
      return {
        ...item,
        summary: clipTextForBudget(item.summary, safeBudget)
      }
    case 'user_input':
      return {
        ...item,
        prompt: clipTextForBudget(item.prompt, safeBudget),
        questions: []
      }
    case 'error':
      return {
        ...item,
        message: clipTextForBudget(item.message, safeBudget),
        details: undefined
      }
  }
}

function clipTextForBudget(text: string, budgetTokens: number): string {
  const marker = '\n[truncated for model input budget]\n'
  const maxChars = Math.max(0, budgetTokens * CHARS_PER_TOKEN - marker.length)
  if (text.length <= maxChars) return text
  if (maxChars <= 0) return marker.trim()
  const headChars = Math.max(0, Math.floor(maxChars * 0.6))
  const tailChars = Math.max(0, maxChars - headChars)
  const head = text.slice(0, headChars).trimEnd()
  const tail = text.slice(Math.max(0, text.length - tailChars)).trimStart()
  return `${head}${marker}${tail}`
}

function stringifyForBudget(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
