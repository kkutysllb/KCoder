import type { TurnItem } from '@qiongqi/contracts'
import type { ImmutablePrefix } from '@qiongqi/cache'
import { makeCompactionItem } from '@qiongqi/domain'
import { ContextEstimator } from './context-estimator.js'
import {
  compactedItemsDigestSource,
  computeShortHash,
  createToolDigestMarker
} from './compaction-marker.js'
import {
  DEFAULT_CONTEXT_THRESHOLDS,
  contextThresholdsForModel,
  modelContextProfilesFromConfig,
  type ContextCompactionConfig,
  type ModelConfig,
  type ModelContextProfile,
  type ModelContextThresholds
} from './model-context-profile.js'
import { renderDurableTaskCapsule, type DurableTaskCapsule } from './durable-task-capsule.js'

export type CompactionMode = 'normal' | 'aggressive' | 'force'

export type CompactionPlan = {
  mode: CompactionMode
  keepRecent: number
  reason: string
}

/**
 * ContextCompactor folds long histories into a single compaction item
 * while preserving pinned user, project, and skill constraints from
 * the immutable prefix. Compaction is triggered by either an explicit
 * `compact()` call or a heuristic on estimated prompt tokens.
 */
export class ContextCompactor {
  private readonly estimator: ContextEstimator
  private readonly softThreshold: number
  private readonly hardThreshold: number
  private readonly modelProfiles: readonly ModelContextProfile[]

  constructor(options?: {
    estimator?: ContextEstimator
    softThreshold?: number
    hardThreshold?: number
    contextCompaction?: ContextCompactionConfig
    models?: ModelConfig
  }) {
    const contextCompaction = options?.contextCompaction
    this.estimator = options?.estimator ?? new ContextEstimator()
    this.softThreshold =
      options?.softThreshold ??
      contextCompaction?.defaultSoftThreshold ??
      DEFAULT_CONTEXT_THRESHOLDS.softThreshold
    this.hardThreshold =
      options?.hardThreshold ??
      contextCompaction?.defaultHardThreshold ??
      DEFAULT_CONTEXT_THRESHOLDS.hardThreshold
    this.modelProfiles = modelContextProfilesFromConfig({
      contextCompaction,
      models: options?.models
    })
  }

  estimate(items: TurnItem[]): number {
    return this.estimator.estimateItems(items)
  }

  shouldCompact(items: TurnItem[], options?: { model?: string; promptTokens?: number; frozenMessageCount?: number }): boolean {
    return this.planCompaction(items, options) !== null
  }

  planCompaction(items: TurnItem[], options?: { model?: string; promptTokens?: number; frozenMessageCount?: number }): CompactionPlan | null {
    const thresholds = this.thresholds(options?.model)
    const frozenMessageCount = normalizeFrozenMessageCount(options?.frozenMessageCount, items.length)
    const compactableItems = frozenMessageCount > 0 ? items.slice(frozenMessageCount) : items
    const estimatedTokens = this.estimate(compactableItems)
    const promptTokens = typeof options?.promptTokens === 'number' ? options.promptTokens : undefined
    const tokens = Math.max(estimatedTokens, promptTokens ?? 0)
    if (tokens < thresholds.softThreshold) return null
    const aggressiveThreshold = aggressiveCompactionThreshold(thresholds)
    const mode: CompactionMode =
      tokens >= thresholds.hardThreshold
        ? 'force'
        : tokens >= aggressiveThreshold
          ? 'aggressive'
          : 'normal'
    const source = promptTokens !== undefined && promptTokens >= estimatedTokens ? 'usage prompt_tokens' : 'estimated prompt tokens'
    const keepRecent = mode === 'force' ? 1 : mode === 'aggressive' ? 2 : 4
    return {
      mode,
      keepRecent,
      reason: `${source} ${tokens} reached ${mode} compaction threshold`
    }
  }

  /**
   * Compact the given history in place. Returns a new item list where
   * older items are replaced by a single `compaction` summary item.
   * The summary always lists the pinned constraints so they survive
   * even when the original text is removed.
   */
  compact(input: {
    threadId: string
    turnId: string
    history: TurnItem[]
    prefix: ImmutablePrefix
    budgetTokens?: number
    keepRecent?: number
    mode?: CompactionMode
    reason?: string
    summaryOverride?: string
    frozenMessageCount?: number
    capsule?: DurableTaskCapsule
  }): {
    next: TurnItem[]
    summaryItem: TurnItem
    replacedTokens: number
  } {
    const frozenMessageCount = normalizeFrozenMessageCount(
      input.frozenMessageCount,
      input.history.length
    )
    const frozen = frozenMessageCount > 0 ? input.history.slice(0, frozenMessageCount) : []
    const history = trimTrailingToolCalls(input.history.slice(frozenMessageCount))
    const requestedKeepRecent = Math.max(0, input.keepRecent ?? 4)
    const keepRecent =
      history.length <= 1 ? history.length : Math.min(requestedKeepRecent, history.length - 1)
    if (history.length <= 1 || history.length - keepRecent <= 0) {
      return {
        next: [...frozen, ...history],
        summaryItem: makeCompactionItem({
          id: `compaction_${input.turnId}_noop`,
          turnId: input.turnId,
          threadId: input.threadId,
          summary: 'no compaction needed',
          replacedTokens: 0,
          pinnedConstraints: input.prefix.pinnedConstraints
        }),
        replacedTokens: 0
      }
    }
    const head = keepRecent === 0 ? history : history.slice(0, history.length - keepRecent)
    const tail = keepRecent === 0 ? [] : history.slice(-keepRecent)
    const replacedTokens = this.estimator.estimateItems(head)
    const sourceDigest = computeShortHash(compactedItemsDigestSource(head))
    const digestMarker = createToolDigestMarker(sourceDigest)
    const summaryBase = input.summaryOverride?.trim() || buildCompactionSummary({
      history,
      head,
      tail,
      prefix: input.prefix,
      reason: input.reason,
      mode: input.mode,
      budgetTokens: input.budgetTokens
    })
    const resumableSummary = ensureTaskResumptionState(summaryBase, { history, prefix: input.prefix })
    const summary = appendDigestMarker(
      input.capsule ? `${resumableSummary}\n\n${renderDurableTaskCapsule(input.capsule)}` : resumableSummary,
      digestMarker
    )
    const summaryItem = makeCompactionItem({
      id: `compaction_${input.turnId}_${Date.now()}`,
      turnId: input.turnId,
      threadId: input.threadId,
      summary,
      replacedTokens,
      pinnedConstraints: input.prefix.pinnedConstraints,
      sourceDigest,
      digestMarker,
      sourceItemIds: head.map((item) => item.id)
    })
    return { next: [...frozen, summaryItem, ...tail], summaryItem, replacedTokens }
  }

  /** Hard cap used by the loop to enforce an upper bound on the conversation. */
  hardCap(model?: string): number {
    return this.thresholds(model).hardThreshold
  }

  thresholds(model?: string): ModelContextThresholds {
    return contextThresholdsForModel(model, {
      softThreshold: this.softThreshold,
      hardThreshold: this.hardThreshold
    }, this.modelProfiles)
  }
}

export function trimTrailingToolCalls(history: TurnItem[]): TurnItem[] {
  let end = history.length
  while (end > 0) {
    const item = history[end - 1]
    if (item.kind !== 'tool_call') break
    end -= 1
  }
  return end === history.length ? history : history.slice(0, end)
}

function aggressiveCompactionThreshold(thresholds: ModelContextThresholds): number {
  const span = Math.max(0, thresholds.hardThreshold - thresholds.softThreshold)
  return thresholds.softThreshold + Math.floor(span * 0.6)
}

function normalizeFrozenMessageCount(value: number | undefined, historyLength: number): number {
  if (value === undefined) return 0
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(historyLength, Math.floor(value)))
}

function appendDigestMarker(summary: string, digestMarker: string): string {
  const trimmed = summary.trim()
  if (trimmed.includes(digestMarker)) return trimmed
  return `${trimmed}\n\nCompaction digest marker: ${digestMarker}`
}

function buildCompactionSummary(input: {
  history: TurnItem[]
  head: TurnItem[]
  tail: TurnItem[]
  prefix: ImmutablePrefix
  reason?: string
  mode?: CompactionMode
  budgetTokens?: number
}): string {
  const contentBudget = summaryCharBudget(input.budgetTokens)
  const lines: string[] = []
  if (input.reason) {
    lines.push(`Reason: ${input.reason}`)
  }
  if (input.mode) {
    lines.push(`Mode: ${input.mode}`)
  }
  if (input.budgetTokens !== undefined) {
    lines.push(`Budget: ${input.budgetTokens} tokens`)
  }
  lines.push('Pinned constraints (preserved across compaction):')
  if (input.prefix.pinnedConstraints.length === 0) {
    lines.push('- (none)')
  } else {
    for (const pinned of input.prefix.pinnedConstraints) {
      lines.push(`- ${pinned}`)
    }
  }
  const skillPins = extractSkillPins(input.history)
  if (skillPins.length > 0) {
    lines.push('Pinned skills (preserved across compaction):')
    for (const skillPin of skillPins) {
      lines.push(`- ${skillPin}`)
    }
    lines.push('')
  }
  lines.push('')
  lines.push(
    `Summarized ${input.history.length} item(s); ${input.tail.length} recent item(s) are also kept verbatim for the current request.`
  )
  lines.push('Conversation and work summary:')
  const summaryLines = fitLinesToBudget(
    selectSummaryLines(buildSummaryLinesWithRecentTools(input.history, input.head)),
    contentBudget
  )
  if (summaryLines.length === 0) {
    lines.push('- No user-visible content before compaction.')
  } else {
    lines.push(...summaryLines)
  }
  appendTaskResumptionState(lines, input.history, input.prefix)
  return lines.join('\n')
}

function ensureTaskResumptionState(
  summary: string,
  input: { history: TurnItem[]; prefix: ImmutablePrefix }
): string {
  if (/^Task resumption state:/im.test(summary)) return summary
  const lines = [summary.trimEnd()]
  appendTaskResumptionState(lines, input.history, input.prefix)
  return lines.join('\n')
}

function appendTaskResumptionState(
  lines: string[],
  history: TurnItem[],
  prefix: ImmutablePrefix
): void {
  lines.push('')
  lines.push('Task resumption state:')
  lines.push(`- Active objective: ${activeObjectiveFromHistory(history)}`)
  lines.push(`- Current state: ${currentStateFromHistory(history)}`)
  lines.push('- Next actions:')
  for (const action of nextActionsFromHistory(history, prefix)) {
    lines.push(`  - ${action}`)
  }
  lines.push(
    '- Do not ask the user what to do unless this summary explicitly says user input is required or the next action is blocked.'
  )
}

function activeObjectiveFromHistory(history: TurnItem[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (item.kind === 'user_message' && item.text.trim()) {
      if (isContinuationOnlyMessage(item.text)) continue
      return clipText(item.text, 600)
    }
  }
  return 'Continue the latest unresolved user request from the conversation summary above.'
}

function currentStateFromHistory(history: TurnItem[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (item.kind === 'assistant_text' && item.text.trim()) {
      return clipText(item.text, 600)
    }
    if (item.kind === 'tool_result') {
      return `Latest tool result from ${item.toolName}: ${clipText(stringifyCompact(item.output), 600)}`
    }
    if (item.kind === 'tool_call') {
      return `Latest tool call was ${item.toolName}: ${clipText(item.summary || stringifyCompact(item.arguments), 600)}`
    }
  }
  return 'Use the preserved summary and recent verbatim turns as the source of truth.'
}

function nextActionsFromHistory(history: TurnItem[], prefix: ImmutablePrefix): string[] {
  const actions: string[] = []
  for (let index = history.length - 1; index >= 0 && actions.length < 3; index -= 1) {
    const item = history[index]
    const text = item.kind === 'assistant_text' ? item.text : item.kind === 'user_message' ? item.text : ''
    if (!text.trim()) continue
    for (const sentence of splitActionSentences(text)) {
      if (actions.length >= 3) break
      if (isContinuationOnlyMessage(sentence)) continue
      if (looksLikeNextAction(sentence)) actions.push(clipText(sentence, 500))
    }
  }
  for (const pinned of prefix.pinnedConstraints) {
    if (/同步|sync|upstream|上游|QiongQi/i.test(pinned) && !actions.some((action) => action.includes(pinned))) {
      actions.push(clipText(pinned, 500))
      break
    }
  }
  if (actions.length === 0) {
    actions.push('Continue with the latest unresolved next step from the summary above.')
  }
  return [...new Set(actions)]
}

function splitActionSentences(text: string): string[] {
  return text
    .split(/(?<=[。.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function looksLikeNextAction(text: string): boolean {
  return /(?:下一步|继续|修复|同步|验证|测试|实现|next|continue|fix|sync|verify|test|implement)/i.test(text)
}

function isContinuationOnlyMessage(text: string): boolean {
  const compact = text
    .replace(/[。.!！?？\s]+/g, '')
    .trim()
    .toLowerCase()
  if (!compact) return true
  return /^(继续|接着|继续推进|继续做|全部做|都做|开始吧|执行|接着来|goon|continue|proceed|doit|doall)$/.test(compact)
}

function extractSkillPins(history: TurnItem[]): string[] {
  const pins = new Set<string>()
  for (const item of history) {
    if (item.kind !== 'assistant_text' && item.kind !== 'user_message' && item.kind !== 'compaction') continue
    const text = item.kind === 'compaction' ? item.summary : item.text
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (/^(Active Skill:|Skill Pin:|Pinned Skill:)/i.test(trimmed)) {
        pins.add(clipText(trimmed, 600))
      }
    }
  }
  return [...pins]
}

function summaryCharBudget(budgetTokens: number | undefined): number {
  if (budgetTokens === undefined) return 4_000
  return Math.max(1_200, Math.min(12_000, budgetTokens * 4))
}

/**
 * Number of most-recent tool call/result pairs whose output is preserved
 * at full fidelity (up to RECENT_TOOL_RESULT_MAX_CHARS) in the compaction
 * summary, so the model retains actionable context after compaction.
 */
const RECENT_TOOL_RESULTS_KEEP = 3
const RECENT_TOOL_RESULT_MAX_CHARS = 2_000

/**
 * Build summary lines from history, preserving the most recent N tool
 * results at higher fidelity than older items.
 */
function buildSummaryLinesWithRecentTools(history: TurnItem[], head: TurnItem[]): string[] {
  // Identify the indices of the last N tool_result items in the head
  // (the portion being compacted). These get expanded summaries.
  const recentToolResultIds = new Set<string>()
  let found = 0
  for (let i = head.length - 1; i >= 0 && found < RECENT_TOOL_RESULTS_KEEP; i -= 1) {
    const item = head[i]
    if (item.kind === 'tool_result') {
      recentToolResultIds.add(item.id)
      found += 1
    }
  }
  // Also include the tool_call immediately preceding each preserved result.
  const recentToolCallIds = new Set<string>()
  for (let i = 0; i < head.length; i += 1) {
    const item = head[i]
    if (item.kind === 'tool_call' && i + 1 < head.length) {
      const next = head[i + 1]
      if (next.kind === 'tool_result' && recentToolResultIds.has(next.id)) {
        recentToolCallIds.add(item.id)
      }
    }
  }
  return history
    .map((item) => {
      if (recentToolResultIds.has(item.id) && item.kind === 'tool_result') {
        const output = stringifyCompact(item.output)
        return `- Tool result ${item.toolName}${item.isError ? ' error' : ''}: ${clipText(output, RECENT_TOOL_RESULT_MAX_CHARS)}`
      }
      if (recentToolCallIds.has(item.id) && item.kind === 'tool_call') {
        const args = item.summary || stringifyCompact(item.arguments)
        return `- Tool call ${item.toolName}: ${clipText(args, RECENT_TOOL_RESULT_MAX_CHARS)}`
      }
      return summarizeItem(item)
    })
    .filter((line) => line.length > 0)
}

function summarizeItem(item: TurnItem): string {
  switch (item.kind) {
    case 'user_message':
      return `- User: ${clipText(item.text)}`
    case 'assistant_text':
      return `- Assistant: ${clipText(item.text)}`
    case 'assistant_reasoning':
      return ''
    case 'tool_call':
      return `- Tool call ${item.toolName}: ${clipText(item.summary || stringifyCompact(item.arguments))}`
    case 'tool_result':
      return `- Tool result ${item.toolName}${item.isError ? ' error' : ''}: ${clipText(stringifyCompact(item.output))}`
    case 'approval':
      return `- Approval ${item.status} for ${item.toolName}: ${clipText(item.summary)}`
    case 'user_input':
      return `- User input ${item.status}: ${clipText(item.prompt)}`
    case 'compaction':
      return item.replacedTokens > 0
        ? `- Earlier compaction summary: ${clipText(item.summary, 600)}`
        : ''
    case 'review':
      return `- Review ${item.title}: ${clipText(item.reviewText || stringifyCompact(item.output))}`
    case 'runtime_progress':
      return ''
    case 'error':
      return `- Error${item.code ? ` ${item.code}` : ''}: ${clipText(item.message)}`
  }
}

function selectSummaryLines(lines: string[]): string[] {
  if (lines.length <= 20) return lines
  const start = lines.slice(0, 4)
  const end = lines.slice(-14)
  return [
    ...start,
    `- ${lines.length - start.length - end.length} middle item(s) omitted from this compact summary.`,
    ...end
  ]
}

function fitLinesToBudget(lines: string[], budget: number): string[] {
  const out: string[] = []
  let used = 0
  for (const line of lines) {
    const nextCost = line.length + 1
    if (used + nextCost <= budget) {
      out.push(line)
      used += nextCost
      continue
    }
    const remaining = budget - used
    if (remaining > 80) out.push(clipText(line, remaining))
    break
  }
  return out
}

function stringifyCompact(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function clipText(text: string, max = 360): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 3)).trim()}...`
}
