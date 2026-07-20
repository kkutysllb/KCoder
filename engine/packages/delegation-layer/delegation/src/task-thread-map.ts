import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * # TaskThreadMap — engine-level orchestrator task memory
 *
 * Records the mapping between orchestrator threads and sub-agent threads
 * so that follow-up queries can resume within the same sub-agent thread
 * (preserving conversation history via QiongQi's built-in JSONL persistence).
 *
 * All orchestrator agents (KStock, KMedical, KLegal, ...) share this
 * single engine-level component.
 */

export interface SubTaskEntry {
  /** The agent card id that executed this sub-task. */
  agentId: string
  /** The thread id on the sub-agent where the task was executed. */
  threadId: string
  /** The original prompt sent to the sub-agent. */
  prompt: string
  /** Task status (completed/failed/aborted). */
  status: string
}

export interface OrchestratorTaskEntry {
  /** Tasks dispatched to sub-agents for this orchestrator thread. */
  subTasks: SubTaskEntry[]
}

export class TaskThreadMap {
  private readonly map = new Map<string, OrchestratorTaskEntry>()

  /**
   * Record a sub-agent thread against the orchestrator's thread.
   *
   * @param orchThreadId  The orchestrator's own thread id (user-facing session).
   * @param agentId       The sub-agent's card id.
   * @param threadId      The sub-agent's internal thread id.
   * @param prompt        The original prompt sent to the sub-agent.
   */
  record(orchThreadId: string, agentId: string, threadId: string, prompt: string): void {
    const entry = this.map.get(orchThreadId) ?? { subTasks: [] }
    // Avoid duplicates — update if same agent+thread combo exists
    const existing = entry.subTasks.find(t => t.agentId === agentId && t.threadId === threadId)
    if (existing) {
      existing.prompt = prompt
      return
    }
    entry.subTasks.push({ agentId, threadId, prompt, status: 'pending' })
    this.map.set(orchThreadId, entry)
  }

  /** Update the status of a sub-task. */
  updateStatus(orchThreadId: string, agentId: string, threadId: string, status: string): void {
    const entry = this.map.get(orchThreadId)
    if (!entry) return
    const task = entry.subTasks.find(t => t.agentId === agentId && t.threadId === threadId)
    if (task) task.status = status
  }

  /** Get all sub-tasks for an orchestrator thread. */
  getSubTasks(orchThreadId: string): SubTaskEntry[] {
    return this.map.get(orchThreadId)?.subTasks ?? []
  }

  /** Get all threads a specific agent participated in. */
  getAgentThreads(agentId: string): SubTaskEntry[] {
    const result: SubTaskEntry[] = []
    for (const entry of this.map.values()) {
      for (const task of entry.subTasks) {
        if (task.agentId === agentId) result.push(task)
      }
    }
    return result
  }

  /** Clear all records for an orchestrator thread. */
  clearThread(orchThreadId: string): void {
    this.map.delete(orchThreadId)
  }

  /** Number of tracked orchestrator threads. */
  get size(): number { return this.map.size }

  // ------------ persistence ------------

  /**
   * Persist the current map to `<dataDir>/task-thread-map.json`.
   */
  async persist(dataDir: string): Promise<void> {
    await mkdir(dataDir, { recursive: true })
    const obj: Record<string, OrchestratorTaskEntry> = {}
    for (const [k, v] of this.map) {
      obj[k] = v
    }
    await writeFile(join(dataDir, 'task-thread-map.json'), JSON.stringify(obj, null, 2), 'utf8')
  }

  /**
   * Restore from `<dataDir>/task-thread-map.json`. Returns the number of
   * restored entries (0 if the file does not exist or is corrupt).
   */
  async load(dataDir: string): Promise<number> {
    const path = join(dataDir, 'task-thread-map.json')
    if (!existsSync(path)) return 0
    try {
      const text = await readFile(path, 'utf8')
      const obj = JSON.parse(text) as Record<string, OrchestratorTaskEntry>
      let count = 0
      for (const [k, v] of Object.entries(obj)) {
        if (v && Array.isArray(v.subTasks)) {
          this.map.set(k, { subTasks: v.subTasks })
          count++
        }
      }
      return count
    } catch {
      return 0
    }
  }
}
