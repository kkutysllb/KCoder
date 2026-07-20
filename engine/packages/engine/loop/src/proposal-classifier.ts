import type { ModelProposal, TaskStateV1 } from '@qiongqi/contracts'

export type ProposalClass =
  | 'final_text'
  | 'tool_intents'
  | 'empty'
  | 'length_limited'
  | 'safety_or_refusal'
  | 'protocol_error'
  | 'context_discontinuity'
  | 'nonterminal_action'

export function classifyProposal(input: {
  proposal: ModelProposal
  task: TaskStateV1
  providerSignals?: readonly string[]
}): ProposalClass {
  const { proposal } = input
  if (
    (proposal.integrity.leakedProtocolText && proposal.toolIntents.length === 0)
    || proposal.integrity.malformedToolCall
    || !proposal.integrity.completeToolCalls
    || proposal.stopClass === 'protocol_error'
    || proposal.stopClass === 'transport_error'
    || proposal.stopClass === 'unknown'
  ) {
    return 'protocol_error'
  }
  if (proposal.stopClass === 'safety' || proposal.stopClass === 'refusal') {
    return 'safety_or_refusal'
  }
  const signals = [proposal.text, proposal.reasoning, ...(input.providerSignals ?? [])]
  if (signals.some(isContextDiscontinuityText)) return 'context_discontinuity'
  if (proposal.toolIntents.length > 0) return 'tool_intents'
  if (proposal.stopClass === 'length') return 'length_limited'
  if (!proposal.text.trim() && !proposal.reasoning.trim()) return 'empty'
  // Only classify as nonterminal_action when the response is a short planning
  // stub with no tool calls. Substantial narrative responses are treated as
  // final_text to avoid false-positive recovery loops on models that naturally
  // include planning language in their output.
  if (
    proposal.text.trim().length < NONTERMINAL_MAX_TEXT_LENGTH
    && signals.some((text) => isNonterminalActionText(text, input.task))
  ) {
    return 'nonterminal_action'
  }
  return 'final_text'
}

function isContextDiscontinuityText(text: string): boolean {
  const normalized = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
  if (!normalized) return false

  const asksForTask = includesAny(normalized, [
    '请重新描述',
    '请告诉我下一步',
    '请告诉我如何继续',
    '请问接下来想做什么',
    '应该继续什么',
    '应该做什么',
    'whatshouldicontinuewith',
    'tellmewhattocontinuewith',
    'tellmewhatishouldcontinuewith',
    'tellmewhattodonext',
    'whatshouldidonext',
    'restateyourtask',
    'repeattherequest'
  ])
  const statesDiscontinuity = includesAny(normalized, [
    '上下文',
    '上下文切换',
    '切换上下文',
    '任务切换',
    '任务已切换上下文',
    '误以为任务已切换上下文',
    '对话内容',
    '之前的任务',
    '之前的请求',
    '无法接续',
    '无法还原',
    '无法恢复',
    '不在我的可见范围',
    '看不到先前',
    'cannotseetheearlier',
    'cannotseetheprevious',
    'nolongerhavetheprior',
    'lostthecontext',
    'contextisnotavailable',
    'earliertaskanymore',
    'contextswitch',
    'switchedcontext'
  ])
  const promisesResume = includesAny(normalized, [
    '继续',
    '接着',
    '往下推进',
    '继续往下',
    'resume',
    'continue',
    'proceed'
  ])
  if (statesDiscontinuity && (asksForTask || promisesResume) && !looksTerminal(normalized)) return true

  // A bare continuation question is discontinuity-specific. Domain
  // clarifications ask for a concrete field, entity, or time range instead.
  return normalized === 'whatshouldicontinuewith'
    || normalized === '请告诉我下一步应该做什么'
    || normalized === '我应该继续什么'
}

/**
 * Maximum visible text length for a response to be considered a
 * nonterminal planning stub. Responses longer than this are assumed
 * to be substantive output even if they contain planning keywords.
 */
const NONTERMINAL_MAX_TEXT_LENGTH = 300

function isNonterminalActionText(text: string, task: TaskStateV1): boolean {
  if (!hasPendingWork(task)) return false
  const normalized = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
  if (!normalized || looksTerminal(normalized)) return false
  // A very long normalized text is likely a full explanation, not a stub.
  if (normalized.length > 200) return false
  return includesAny(normalized, [
    '我将',
    '我会',
    '我先',
    '我现在',
    '让我',
    '让我来',
    '马上开始',
    '准备开始',
    '开始执行',
    '先读取',
    '先检查',
    '先分析',
    '先查看',
    '先搜索',
    '先了解',
    '先确认',
    '现在开始',
    '接下来',
    '下一步',
    '继续分析',
    '继续执行',
    '继续完成',
    '继续往下',
    '接着往下',
    '立刻继续',
    '往下推进',
    '需要先',
    'letme',
    'lets',
    'im',
    'imgoing',
    'imabout',
    'imstarting',
    'iwill',
    'ill',
    'illbe',
    'ineedto',
    'ishould',
    'ishall',
    'nexti',
    'nowi',
    'startby',
    'firsti',
    'firstlet',
    'beginby',
    'proceedto',
    'goingto',
    'aboutto',
    'lookinto',
    'lookatthe',
    'movingon',
    'myapproach',
    'myplanis'
  ])
}

function hasPendingWork(task: TaskStateV1): boolean {
  return task.pendingActions.some((action) => action.status === 'pending' || action.status === 'in_progress')
}

function looksTerminal(normalized: string): boolean {
  return /(?:分析完成|任务完成|已完成|修复完成|生成完成|处理完成|结论|总结|根因|最终答案|finalanswer|allcomplete|alltaskscomplete|taskcomplete|everythingdone|workcomplete|conclusion|inconclusion|tosummarize|resolved|fixed|nothingelse|nothingmore|nofurtheraction|completed|done|hereis|result|summary)/i.test(normalized)
}

function includesAny(text: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate))
}
