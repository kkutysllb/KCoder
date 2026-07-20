import { randomUUID } from 'node:crypto'
import { TaskStateV1Schema, type RunIdentity, type TaskStateV1 } from '@qiongqi/contracts'
import type {
  TaskStateMigrationRecord,
  TaskStatePreparedRevision,
  TaskStateStore
} from '@qiongqi/ports'
import { runtimeScopeDigest } from './runtime-store-utils.js'

type PreparedEntry = {
  prepared: TaskStatePreparedRevision
  state: TaskStateV1
}

export class InMemoryTaskStateStore implements TaskStateStore {
  private readonly active = new Map<string, TaskStateV1>()
  private readonly prepared = new Map<string, PreparedEntry>()
  private readonly migrations: TaskStateMigrationRecord[] = []

  async load(identity: RunIdentity): Promise<TaskStateV1 | undefined> {
    return this.active.get(runtimeScopeDigest(identity))
  }

  async prepare(state: TaskStateV1, expectedRevision: number): Promise<TaskStatePreparedRevision> {
    const parsed = TaskStateV1Schema.parse(state)
    const scopeDigest = runtimeScopeDigest(parsed.identity)
    const activeRevision = this.active.get(scopeDigest)?.revision ?? 0
    if (activeRevision !== expectedRevision || parsed.revision !== expectedRevision + 1) {
      throw revisionConflict(expectedRevision, activeRevision, parsed.revision)
    }
    const prepared: TaskStatePreparedRevision = {
      identity: parsed.identity,
      revision: parsed.revision,
      expectedRevision,
      token: randomUUID(),
      scopeDigest
    }
    this.prepared.set(preparedKey(prepared), { prepared, state: parsed })
    return prepared
  }

  async commit(prepared: TaskStatePreparedRevision): Promise<void> {
    const key = preparedKey(prepared)
    const entry = this.prepared.get(key)
    if (!entry) throw new Error('prepared task revision not found')
    const activeRevision = this.active.get(prepared.scopeDigest)?.revision ?? 0
    if (activeRevision !== prepared.expectedRevision) {
      throw revisionConflict(prepared.expectedRevision, activeRevision, prepared.revision)
    }
    this.active.set(prepared.scopeDigest, entry.state)
    this.prepared.delete(key)
  }

  async abort(prepared: TaskStatePreparedRevision): Promise<void> {
    this.prepared.delete(preparedKey(prepared))
  }

  async listForThread(
    scope: Pick<RunIdentity, 'ownerUserId' | 'workspaceKey' | 'threadId'>
  ): Promise<TaskStateV1[]> {
    return [...this.active.values()].filter((state) =>
      state.identity.ownerUserId === scope.ownerUserId &&
      state.identity.workspaceKey === scope.workspaceKey &&
      state.identity.threadId === scope.threadId
    )
  }

  async appendMigrationRecord(record: TaskStateMigrationRecord): Promise<void> {
    this.migrations.push(structuredClone(record))
  }
}

function preparedKey(prepared: TaskStatePreparedRevision): string {
  return `${prepared.scopeDigest}:${prepared.revision}:${prepared.token}`
}

function revisionConflict(expected: number, active: number, next: number): Error {
  return new Error(`task revision conflict: expected active ${expected}, found ${active}, next ${next}`)
}
