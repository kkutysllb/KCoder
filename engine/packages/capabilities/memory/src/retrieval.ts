import type { MemoryRecord } from '@qiongqi/contracts'

export type RankMemoryRecordsInput = {
  query: string
  records: MemoryRecord[]
  workspace?: string
  threadId?: string
  ownerUserId?: string
  limit: number
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'when', 'what', 'how', 'are', 'this', 'that', 'use', '用户'
])

export function tokenizeMemoryText(text: string): string[] {
  const tokens = new Set<string>()
  const lower = text.toLowerCase()
  for (const match of lower.matchAll(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/g)) {
    const token = match[0]
    addToken(tokens, token)
    for (const part of token.split(/[-_.]+/)) addToken(tokens, part)
  }
  const cjkRuns = lower.match(/[\u3400-\u9fff]+/g) ?? []
  for (const run of cjkRuns) {
    for (const char of run) addToken(tokens, char)
    for (let size = 2; size <= 3; size += 1) {
      for (let index = 0; index <= run.length - size; index += 1) {
        addToken(tokens, run.slice(index, index + size))
      }
    }
  }
  return [...tokens]
}

export function rankMemoryRecords(input: RankMemoryRecordsInput): MemoryRecord[] {
  const queryTokens = new Set(tokenizeMemoryText(input.query))
  if (queryTokens.size === 0) return []
  const allowCurrentTaskCarryover = isContinuationQuery(input.query)
  return input.records
    .filter((record) => !record.deletedAt && !record.disabledAt)
    .filter((record) => inActiveScope(record, input.workspace, input.threadId, input.ownerUserId))
    .map((record) => {
      const lexicalScore = scoreRecord(record, queryTokens)
      const currentTaskCarryover =
        allowCurrentTaskCarryover &&
        isCurrentThreadProjectMemory(record, input.workspace, input.threadId)
      return {
        record,
        score: lexicalScore > 0 ? lexicalScore : currentTaskCarryover ? 0.1 : 0
      }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      b.record.confidence - a.record.confidence ||
      b.record.updatedAt.localeCompare(a.record.updatedAt) ||
      a.record.id.localeCompare(b.record.id)
    )
    .slice(0, Math.max(0, input.limit))
    .map((entry) => entry.record)
}

function isContinuationQuery(text: string): boolean {
  const compact = text
    .replace(/[。.!！?？\s]+/g, '')
    .trim()
    .toLowerCase()
  return /^(继续|接着|继续推进|继续做|全部做|都做|开始吧|执行|接着来|goon|continue|proceed|doit|doall)$/.test(compact)
}

function isCurrentThreadProjectMemory(
  record: MemoryRecord,
  workspace: string | undefined,
  threadId: string | undefined
): boolean {
  return Boolean(
    threadId &&
    record.scope === 'project' &&
    workspace &&
    record.workspace === workspace &&
    record.sourceThreadId === threadId
  )
}

function scoreRecord(record: MemoryRecord, queryTokens: Set<string>): number {
  const recordTokens = new Set(tokenizeMemoryText(`${record.content} ${record.tags.join(' ')}`))
  let overlap = 0
  let technicalExact = 0
  for (const token of queryTokens) {
    if (!recordTokens.has(token)) continue
    overlap += token.length > 1 ? 1 : 0.25
    if (/^[a-z0-9]+[-_.][a-z0-9]+/.test(token) || /^[a-z]+\d+$/.test(token)) technicalExact += 1
  }
  return (overlap + technicalExact * 2) * Math.max(record.confidence, 0)
}

function inActiveScope(record: MemoryRecord, workspace: string | undefined, threadId: string | undefined, ownerUserId?: string): boolean {
  if (ownerUserId && record.ownerUserId !== ownerUserId) return false
  if (record.scope === 'user') return true
  if (record.scope === 'workspace') return Boolean(workspace && record.workspace === workspace)
  if (record.scope === 'project') {
    return Boolean(
      workspace &&
      record.workspace === workspace &&
      (!threadId || record.sourceThreadId === threadId)
    )
  }
  return false
}

function addToken(tokens: Set<string>, token: string): void {
  const normalized = token.trim().toLowerCase()
  if (normalized.length === 0) return
  if (STOPWORDS.has(normalized)) return
  tokens.add(normalized)
}
