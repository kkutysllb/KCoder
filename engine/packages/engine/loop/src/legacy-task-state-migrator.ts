import type { RunIdentity, TaskStateV1, ThreadRecord, Turn, TurnItem } from '@qiongqi/contracts'
import type { TaskStateStore } from '@qiongqi/ports'
import { buildTaskState, isContinuationOnlyTaskMessage } from './task-state-builder.js'

export type LegacyMigrationResult =
  | { kind: 'created'; state: TaskStateV1 }
  | { kind: 'existing'; state: TaskStateV1 }
  | { kind: 'insufficient_trusted_source'; reason: string }
  | { kind: 'scope_violation'; reason: string }

export async function migrateLegacyTaskState(input: {
  identity: RunIdentity
  thread: ThreadRecord
  items: readonly TurnItem[]
  store: TaskStateStore
  nowIso: () => string
}): Promise<LegacyMigrationResult> {
  const owner = input.thread.ownerUserId ?? 'local-default-owner'
  if (
    owner !== input.identity.ownerUserId ||
    input.thread.id !== input.identity.threadId ||
    input.thread.workspace !== input.identity.workspaceKey
  ) {
    return { kind: 'scope_violation', reason: 'legacy thread identity does not match run scope' }
  }

  const existing = await input.store.load(input.identity)
  if (existing) return { kind: 'existing', state: existing }

  const trustedUserItems = input.items.filter(
    (item): item is Extract<TurnItem, { kind: 'user_message' }> => item.kind === 'user_message'
  )
  const hasSubstantiveUserSource = trustedUserItems.some((item) =>
    !isContinuationOnlyTaskMessage(item.displayText?.trim() || item.text)
  )
  const hasActiveGoal = input.thread.goal?.status === 'active' && Boolean(input.thread.goal.objective.trim())
  if (!hasSubstantiveUserSource && !hasActiveGoal) {
    return {
      kind: 'insufficient_trusted_source',
      reason: 'legacy history has no trusted user objective or active goal'
    }
  }

  const turn = resolveTurn(input.thread, input.identity, trustedUserItems)
  let state: TaskStateV1
  try {
    const built = buildTaskState({
      identity: input.identity,
      thread: input.thread,
      turn,
      items: input.items,
      activeSkillIds: turn.activeSkillIds,
      nowIso: input.nowIso
    })
    state = {
      ...built,
      migration: {
        source: 'legacy_thread',
        sourceDigest: built.source.sourceDigest,
        confidence: 'high'
      }
    }
  } catch (error) {
    return {
      kind: 'insufficient_trusted_source',
      reason: error instanceof Error ? error.message : String(error)
    }
  }

  try {
    const prepared = await input.store.prepare(state, 0)
    await input.store.commit(prepared)
  } catch (error) {
    const raced = await input.store.load(input.identity)
    if (raced) return { kind: 'existing', state: raced }
    throw error
  }
  await input.store.appendMigrationRecord({
    identity: input.identity,
    sourceDigest: state.source.sourceDigest,
    taskRevision: state.revision,
    migratedAt: input.nowIso()
  })
  return { kind: 'created', state }
}

function resolveTurn(
  thread: ThreadRecord,
  identity: RunIdentity,
  userItems: readonly Extract<TurnItem, { kind: 'user_message' }>[]
): Turn {
  const persisted = thread.turns.find((turn) => turn.id === identity.turnId)
  if (persisted) return persisted
  const currentUser = [...userItems].reverse().find((item) => item.turnId === identity.turnId)
  return {
    id: identity.turnId,
    threadId: identity.threadId,
    status: 'running',
    prompt: currentUser?.text ?? '',
    steering: [],
    items: [],
    attachmentIds: [],
    activeSkillIds: [],
    explicitSkillIds: [],
    injectedMemoryIds: [],
    createdAt: currentUser?.createdAt ?? 'legacy'
  }
}
