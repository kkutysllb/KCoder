import type { RuntimeEvent } from '@qiongqi/contracts'
import type { TurnItem } from '@qiongqi/contracts'
import type { AgentSession } from '@qiongqi/domain'
import type { SessionStore } from '@qiongqi/ports'
import { FileSessionStore } from './file-session-store.js'
import type { HybridThreadStore } from './hybrid-thread-store.js'

/**
 * JSONL session store with a post-write SQLite index hook. The body
 * remains owned by FileSessionStore; the index is updated only after
 * the append/rewrite has succeeded.
 */
export class HybridSessionStore implements SessionStore {
  private readonly delegate: FileSessionStore
  private readonly index: HybridThreadStore

  constructor(options: {
    dataDir: string
    index: HybridThreadStore
    usageEventCompaction?: ConstructorParameters<typeof FileSessionStore>[0]['usageEventCompaction']
  }) {
    this.delegate = new FileSessionStore({
      dataDir: options.dataDir,
      usageEventCompaction: options.usageEventCompaction
    })
    this.index = options.index
  }

  async appendEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    await this.delegate.appendEvent(threadId, event)
    await this.index.noteEventSeq(threadId, event.seq)
  }

  async appendItem(threadId: string, item: TurnItem): Promise<void> {
    await this.delegate.appendItem(threadId, item)
  }

  async appendItemOnce(
    threadId: string,
    item: TurnItem
  ): Promise<{ item: TurnItem; created: boolean }> {
    return this.delegate.appendItemOnce(threadId, item)
  }

  async rewriteItems(threadId: string, items: TurnItem[]): Promise<void> {
    await this.delegate.rewriteItems(threadId, items)
  }

  async updateItem(threadId: string, itemId: string, patch: Partial<TurnItem>): Promise<TurnItem | null> {
    return this.delegate.updateItem(threadId, itemId, patch)
  }

  async updateItemOnce(
    threadId: string,
    itemId: string,
    patch: Partial<TurnItem>
  ): Promise<{ item: TurnItem; updated: boolean } | null> {
    return this.delegate.updateItemOnce(threadId, itemId, patch)
  }

  async loadEventsSince(threadId: string, sinceSeq: number): Promise<RuntimeEvent[]> {
    return this.delegate.loadEventsSince(threadId, sinceSeq)
  }

  async loadItems(threadId: string): Promise<TurnItem[]> {
    return this.delegate.loadItems(threadId)
  }

  async loadSession(threadId: string): Promise<AgentSession | null> {
    return this.delegate.loadSession(threadId)
  }

  async upsertSession(session: AgentSession): Promise<void> {
    await this.delegate.upsertSession(session)
  }

  async highestSeq(threadId: string): Promise<number> {
    return this.delegate.highestSeq(threadId)
  }

  async resetMemory(): Promise<void> {
    await this.delegate.resetMemory()
  }
}
