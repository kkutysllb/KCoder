import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { A2ATaskRecord, type A2ATaskRecord as A2ATaskRecordType } from './a2a-task-model.js'

/**
 * Stage 4: file-based store for A2A task records.
 *
 * Each task is persisted as `<rootDir>/<taskId>.json` so the
 * `GET /a2a/tasks/{id}` endpoint can return status even after
 * the submitting HTTP connection has closed.
 */
export class FileA2ATaskStore {
  constructor(private readonly rootDir: string) {}

  async upsert(record: A2ATaskRecordType): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    const parsed = A2ATaskRecord.parse(record)
    const existing = await this.get(parsed.id)
    const next = existing ? preserveTerminal(existing, parsed) : parsed
    await writeFile(
      join(this.rootDir, `${next.id}.json`),
      JSON.stringify(next, null, 2),
      'utf8'
    )
  }

  async get(id: string): Promise<A2ATaskRecordType | undefined> {
    try {
      const text = await readFile(join(this.rootDir, `${id}.json`), 'utf8')
      return A2ATaskRecord.parse(JSON.parse(text))
    } catch {
      return undefined
    }
  }

  async list(): Promise<A2ATaskRecordType[]> {
    try {
      const entries = await readdir(this.rootDir)
      const records: A2ATaskRecordType[] = []
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue
        try {
          const text = await readFile(join(this.rootDir, entry), 'utf8')
          const parsed = A2ATaskRecord.safeParse(JSON.parse(text))
          if (parsed.success) records.push(parsed.data)
        } catch { /* skip corrupt files */ }
      }
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    } catch {
      return []
    }
  }
}

function preserveTerminal(current: A2ATaskRecordType, next: A2ATaskRecordType): A2ATaskRecordType {
  if (!isTerminal(current.status)) return next
  if (current.status === next.status) return next
  return current
}

function isTerminal(status: A2ATaskRecordType['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}
