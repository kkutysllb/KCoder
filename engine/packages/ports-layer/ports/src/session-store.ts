import type { AgentSession } from '@qiongqi/domain'
import type { RuntimeEvent } from '@qiongqi/contracts'
import type { TurnItem } from '@qiongqi/contracts'

/**
 * Port for persisted per-thread activity.
 *
 * The store keeps three streams: the ordered runtime event log
 * (used by SSE replay), the turn item history (used to rebuild chat
 * blocks), and the full session projection. Implementations append to
 * JSONL and keep a small in-memory window for fast access.
 */
export interface SessionStore {
  appendEvent(threadId: string, event: RuntimeEvent): Promise<void>
  appendItem(threadId: string, item: TurnItem): Promise<void>
  /** Return the canonical durable item, appending it only when the stable id is absent. */
  appendItemOnce(
    threadId: string,
    item: TurnItem
  ): Promise<{ item: TurnItem; created: boolean }>
  /**
   * Replace the canonical item stream for a thread. File-backed stores
   * should write atomically because this is used by load-time healing
   * and explicit discard flows.
   */
  rewriteItems(threadId: string, items: TurnItem[]): Promise<void>
  updateItem(threadId: string, itemId: string, patch: Partial<TurnItem>): Promise<TurnItem | null>
  /** Apply a deterministic target patch only when it changes the latest durable revision. */
  updateItemOnce(
    threadId: string,
    itemId: string,
    patch: Partial<TurnItem>
  ): Promise<{ item: TurnItem; updated: boolean } | null>
  loadEventsSince(threadId: string, sinceSeq: number): Promise<RuntimeEvent[]>
  loadItems(threadId: string): Promise<TurnItem[]>
  loadSession(threadId: string): Promise<AgentSession | null>
  upsertSession(session: AgentSession): Promise<void>
  /** Highest known per-thread `seq`. Returns 0 when no events have been recorded. */
  highestSeq(threadId: string): Promise<number>
  /** Forget the per-thread in-memory state without touching disk. */
  resetMemory(): Promise<void>
}
