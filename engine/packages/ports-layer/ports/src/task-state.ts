import type { RunIdentity, TaskStateV1 } from '@qiongqi/contracts'

export type TaskStatePreparedRevision = {
  identity: RunIdentity
  revision: number
  expectedRevision: number
  token: string
  scopeDigest: string
}

export type TaskStateMigrationRecord = {
  identity: RunIdentity
  sourceDigest: string
  taskRevision: number
  migratedAt: string
}

export interface TaskStateStore {
  load(identity: RunIdentity): Promise<TaskStateV1 | undefined>
  prepare(state: TaskStateV1, expectedRevision: number): Promise<TaskStatePreparedRevision>
  commit(prepared: TaskStatePreparedRevision): Promise<void>
  abort(prepared: TaskStatePreparedRevision): Promise<void>
  listForThread(
    scope: Pick<RunIdentity, 'ownerUserId' | 'workspaceKey' | 'threadId'>
  ): Promise<TaskStateV1[]>
  appendMigrationRecord(record: TaskStateMigrationRecord): Promise<void>
}
