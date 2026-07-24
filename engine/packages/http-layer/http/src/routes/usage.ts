import type { UsageService } from '@qiongqi/services'
import {
  buildDailyUsageResponse,
  buildModelUsageResponse,
  buildThreadUsageResponse,
  parseDailyUsageQuery,
  parseModelUsageQuery,
  UsageValidationError,
  type ThreadUsageRecord
} from '@qiongqi/services'
import {
  emptyUsageSnapshot,
  type UsageSnapshot
} from '@qiongqi/contracts'
import type { UsageEvent } from '@qiongqi/contracts'
import type { ServerRuntime } from './server-runtime.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { AuthActor } from '../auth-service.js'
import type { UserUsageEventRecord } from '../user-data-store.js'

/**
 * Usage endpoint response shape. The `total` field mirrors the
 * per-thread cumulative usage snapshot; `perThread` exposes a list
 * of per-thread usage values for the GUI's connection status.
 */
export type UsageEndpointResponse = {
  total: ReturnType<UsageService['total']>
  perThread: Array<{ threadId: string; usage: ReturnType<UsageService['forThread']> }>
}

export async function buildUsageResponse(runtime: ServerRuntime, actor?: AuthActor): Promise<UsageEndpointResponse> {
  const threads = await runtime.threadService.list({ ownerUserId: actor?.userId })
  return {
    total: actor ? mergeUsageSnapshots(threads.map((thread) => runtime.usageService.forThread(thread.id))) : runtime.usageService.total(),
    perThread: threads.map((thread) => ({
      threadId: thread.id,
      usage: runtime.usageService.forThread(thread.id)
    }))
  }
}

export async function usageJsonResponse(
  request: Request,
  runtime: ServerRuntime,
  actor?: AuthActor,
  options?: { defaultWindow?: string }
): Promise<JsonResponse> {
  const query = queryRecord(request)
  applyDefaultUsageWindow(query, options?.defaultWindow)
  const groupBy = stringParam(query, 'group_by') ?? 'runtime'
  if (groupBy === 'thread') {
    return jsonResponse(buildThreadUsageResponse(await usageRecords(runtime, actor)))
  }
  if (groupBy === 'day') {
    try {
      return jsonResponse(
        buildDailyUsageResponse(await usageRecords(runtime, actor), parseDailyUsageQuery(query))
      )
    } catch (error) {
      if (error instanceof UsageValidationError) {
        return jsonResponse({ code: error.code, message: error.message }, 400)
      }
      throw error
    }
  }
  if (groupBy === 'model') {
    try {
      return jsonResponse(
        buildModelUsageResponse(await usageRecords(runtime, actor), parseModelUsageQuery(query))
      )
    } catch (error) {
      if (error instanceof UsageValidationError) {
        return jsonResponse({ code: error.code, message: error.message }, 400)
      }
      throw error
    }
  }
  if (groupBy !== 'runtime') {
    return jsonResponse({ code: 'validation_error', message: `unsupported usage grouping: ${groupBy}` }, 400)
  }
  return jsonResponse(await buildUsageResponse(runtime, actor))
}

function queryRecord(request: Request): Record<string, string> {
  const url = new URL(request.url)
  const record: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    record[key] = value
  }
  return record
}

function stringParam(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function applyDefaultUsageWindow(query: Record<string, string>, defaultWindow?: string): void {
  if (!defaultWindow) return
  const groupBy = stringParam(query, 'group_by')
  if (groupBy !== 'day' && groupBy !== 'model') return
  if (stringParam(query, 'from') || stringParam(query, 'to') || stringParam(query, 'window')) return
  query.window = defaultWindow
}

async function usageRecords(runtime: ServerRuntime, actor?: AuthActor): Promise<ThreadUsageRecord[]> {
  const ledgerRecords = await usageRecordsFromLedger(runtime, actor?.userId)
  const ledgerThreadIds = new Set(ledgerRecords.map((record) => record.threadId))

  const records: ThreadUsageRecord[] = []
  const threadSummaries = await runtime.threadService.list({ ownerUserId: actor?.userId })
  for (const threadSummary of threadSummaries) {
    if (ledgerThreadIds.has(threadSummary.id)) continue
    const thread = await runtime.threadService.get(threadSummary.id) ?? { ...threadSummary, turns: [] }
    let latestPersisted = emptyUsageSnapshot()
    const events = await runtime.sessionStore.loadEventsSince(thread.id, 0)
    const usageEvents = events
      .filter((event): event is UsageEvent => event.kind === 'usage')
      .sort((a, b) => a.seq - b.seq)

    for (const event of usageEvents) {
      const delta = diffUsage(event.usage, latestPersisted)
      latestPersisted = event.usage
      if (hasUsage(delta)) {
        records.push({
          threadId: thread.id,
          model: usageRecordModel(thread, event),
          completedAt: event.timestamp,
          usage: delta
        })
      }
    }

    const liveRemainder = diffUsage(runtime.usageService.forThread(thread.id), latestPersisted)
    if (hasUsage(liveRemainder)) {
      records.push({
        threadId: thread.id,
        model: usageRecordModel(thread, { turnId: thread.turns?.at(-1)?.id }),
        completedAt: thread.updatedAt || runtime.nowIso(),
        usage: liveRemainder
      })
    }
  }
  return [...ledgerRecords, ...records]
}

async function usageRecordsFromLedger(runtime: ServerRuntime, userId?: string): Promise<ThreadUsageRecord[]> {
  const store = runtime.userDataStore
  if (!store?.listUsageEvents) return []
  const events = await store.listUsageEvents(userId)
  return usageLedgerEventsToRecords(events)
}

function usageLedgerEventsToRecords(events: UserUsageEventRecord[]): ThreadUsageRecord[] {
  const records: ThreadUsageRecord[] = []
  let currentThreadId = ''
  let latestPersisted = emptyUsageSnapshot()
  for (const event of [...events].sort(compareUsageLedgerEvents)) {
    if (event.threadId !== currentThreadId) {
      currentThreadId = event.threadId
      latestPersisted = emptyUsageSnapshot()
    }
    const delta = diffUsage(event.usage, latestPersisted)
    latestPersisted = event.usage
    if (!hasUsage(delta)) continue
    records.push({
      threadId: event.threadId,
      model: event.model?.trim() || 'unknown',
      completedAt: event.timestamp,
      usage: delta
    })
  }
  return records
}

function compareUsageLedgerEvents(a: UserUsageEventRecord, b: UserUsageEventRecord): number {
  return a.threadId.localeCompare(b.threadId) || a.seq - b.seq
}

function mergeUsageSnapshots(snapshots: UsageSnapshot[]): UsageSnapshot {
  const total = emptyUsageSnapshot()
  for (const usage of snapshots) {
    total.promptTokens += usage.promptTokens
    total.completionTokens += usage.completionTokens
    total.totalTokens += usage.totalTokens
    total.cachedTokens = (total.cachedTokens ?? 0) + (usage.cachedTokens ?? 0)
    total.cacheHitTokens = (total.cacheHitTokens ?? 0) + (usage.cacheHitTokens ?? 0)
    total.cacheMissTokens = (total.cacheMissTokens ?? 0) + (usage.cacheMissTokens ?? 0)
    total.turns += usage.turns
    if (usage.costUsd !== undefined) total.costUsd = (total.costUsd ?? 0) + usage.costUsd
    if (usage.costCny !== undefined) total.costCny = (total.costCny ?? 0) + usage.costCny
    if (usage.cacheSavingsUsd !== undefined) total.cacheSavingsUsd = (total.cacheSavingsUsd ?? 0) + usage.cacheSavingsUsd
    if (usage.cacheSavingsCny !== undefined) total.cacheSavingsCny = (total.cacheSavingsCny ?? 0) + usage.cacheSavingsCny
    if (usage.tokenEconomySavingsTokens !== undefined) {
      total.tokenEconomySavingsTokens = (total.tokenEconomySavingsTokens ?? 0) + usage.tokenEconomySavingsTokens
    }
    if (usage.tokenEconomySavingsUsd !== undefined) {
      total.tokenEconomySavingsUsd = (total.tokenEconomySavingsUsd ?? 0) + usage.tokenEconomySavingsUsd
    }
    if (usage.tokenEconomySavingsCny !== undefined) {
      total.tokenEconomySavingsCny = (total.tokenEconomySavingsCny ?? 0) + usage.tokenEconomySavingsCny
    }
    total.hasError ||= usage.hasError
  }
  total.cacheHitRate = total.promptTokens > 0 ? (total.cacheHitTokens ?? 0) / total.promptTokens : null
  return total
}

function usageRecordModel(
  thread: {
    model?: string
    turns?: Array<{ id: string; model?: string }>
  },
  event?: Pick<UsageEvent, 'model' | 'turnId'>
): string {
  const eventModel = event?.model?.trim()
  if (eventModel) return eventModel

  const trimmedTurnId = event?.turnId?.trim() ?? ''
  if (trimmedTurnId) {
    const turnModel = thread.turns?.find((turn) => turn.id === trimmedTurnId)?.model?.trim()
    if (turnModel) return turnModel
  }
  const latestTurnModel = [...(thread.turns ?? [])]
    .reverse()
    .find((turn) => turn.model?.trim())
    ?.model?.trim()
  return latestTurnModel || thread.model?.trim() || 'unknown'
}

function diffUsage(current: UsageSnapshot, previous: UsageSnapshot): UsageSnapshot {
  const promptTokens = diffNumber(current.promptTokens, previous.promptTokens)
  const completionTokens = diffNumber(current.completionTokens, previous.completionTokens)
  const reportedTotal = diffNumber(current.totalTokens, previous.totalTokens)
  const totalTokens = reportedTotal || promptTokens + completionTokens
  const cachedTokens = diffOptionalNumber(current.cachedTokens, previous.cachedTokens)
  const cacheHitTokens = diffOptionalNumber(current.cacheHitTokens, previous.cacheHitTokens)
  const cacheMissTokens = diffOptionalNumber(current.cacheMissTokens, previous.cacheMissTokens)
  const cacheTotal = (cacheHitTokens ?? 0) + (cacheMissTokens ?? 0)
  const cacheHitRate = cacheHitTokens !== undefined && cacheTotal > 0
    ? cacheHitTokens / cacheTotal
    : null
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
    ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
    cacheHitRate,
    turns: diffNumber(current.turns, previous.turns),
    ...(current.costUsd !== undefined || previous.costUsd !== undefined
      ? { costUsd: diffNumber(current.costUsd ?? 0, previous.costUsd ?? 0) }
      : {}),
    ...(current.costCny !== undefined || previous.costCny !== undefined
      ? { costCny: diffNumber(current.costCny ?? 0, previous.costCny ?? 0) }
      : {}),
    ...(current.cacheSavingsUsd !== undefined || previous.cacheSavingsUsd !== undefined
      ? { cacheSavingsUsd: diffNumber(current.cacheSavingsUsd ?? 0, previous.cacheSavingsUsd ?? 0) }
      : {}),
    ...(current.cacheSavingsCny !== undefined || previous.cacheSavingsCny !== undefined
      ? { cacheSavingsCny: diffNumber(current.cacheSavingsCny ?? 0, previous.cacheSavingsCny ?? 0) }
      : {}),
    ...(current.tokenEconomySavingsTokens !== undefined || previous.tokenEconomySavingsTokens !== undefined
      ? {
          tokenEconomySavingsTokens: diffNumber(
            current.tokenEconomySavingsTokens ?? 0,
            previous.tokenEconomySavingsTokens ?? 0
          )
        }
      : {}),
    ...(current.tokenEconomySavingsUsd !== undefined || previous.tokenEconomySavingsUsd !== undefined
      ? {
          tokenEconomySavingsUsd: diffNumber(
            current.tokenEconomySavingsUsd ?? 0,
            previous.tokenEconomySavingsUsd ?? 0
          )
        }
      : {}),
    ...(current.tokenEconomySavingsCny !== undefined || previous.tokenEconomySavingsCny !== undefined
      ? {
          tokenEconomySavingsCny: diffNumber(
            current.tokenEconomySavingsCny ?? 0,
            previous.tokenEconomySavingsCny ?? 0
          )
        }
      : {}),
    ...(current.hasError ? { hasError: true } : {})
  }
}

function diffNumber(current: number, previous: number): number {
  return Math.max(0, current - previous)
}

function diffOptionalNumber(current?: number, previous?: number): number | undefined {
  if (current === undefined && previous === undefined) return undefined
  return Math.max(0, (current ?? 0) - (previous ?? 0))
}

function hasUsage(usage: UsageSnapshot): boolean {
  return usage.promptTokens > 0
    || usage.completionTokens > 0
    || usage.totalTokens > 0
    || (usage.cachedTokens ?? 0) > 0
    || (usage.cacheHitTokens ?? 0) > 0
    || (usage.cacheMissTokens ?? 0) > 0
    || usage.turns > 0
    || (usage.costUsd ?? 0) > 0
    || (usage.costCny ?? 0) > 0
    || (usage.cacheSavingsUsd ?? 0) > 0
    || (usage.cacheSavingsCny ?? 0) > 0
    || (usage.tokenEconomySavingsTokens ?? 0) > 0
    || (usage.tokenEconomySavingsUsd ?? 0) > 0
    || (usage.tokenEconomySavingsCny ?? 0) > 0
}
