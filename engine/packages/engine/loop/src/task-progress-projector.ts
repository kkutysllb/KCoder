import { createHash } from 'node:crypto'
import type { TaskArtifactRef, TaskStateV1, ToolObservation } from '@qiongqi/contracts'
import { TaskStateV1Schema } from '@qiongqi/contracts'
import type { TaskStateStore } from '@qiongqi/ports'
import type { RunIdentity } from '@qiongqi/contracts'

export type TaskTodoProjection = {
  id: string
  content: string
  status: TaskStateV1['pendingActions'][number]['status']
}

export type TaskProgressDigest = {
  level: 'strong' | 'weak' | 'none'
  value: string
  reasons: string[]
}

export type TaskProgressProjection = {
  state: TaskStateV1
  digest: TaskProgressDigest
}

export class TaskProgressProjector {
  constructor(private readonly store: TaskStateStore) {}

  async apply(
    identity: RunIdentity,
    input: { todos?: readonly TaskTodoProjection[]; observations?: readonly ToolObservation[]; nowIso: () => string }
  ): Promise<TaskProgressProjection | undefined> {
    const current = await this.store.load(identity)
    if (!current) return undefined
    const projection = projectTaskState(current, input)
    if (projection.digest.level === 'none') return projection
    const prepared = await this.store.prepare(projection.state, current.revision)
    try {
      await this.store.commit(prepared)
      return projection
    } catch (error) {
      await this.store.abort(prepared).catch(() => undefined)
      throw error
    }
  }
}

export function projectTaskState(
  current: TaskStateV1,
  input: { todos?: readonly TaskTodoProjection[]; observations?: readonly ToolObservation[]; nowIso: () => string }
): TaskProgressProjection {
  const observations = (input.observations ?? []).filter((observation) => !observation.failed)
  const previousDigests = new Set(current.progress?.lastObservationDigests ?? [])
  const freshObservations = observations.filter((observation) => !observation.replayed && !previousDigests.has(observation.resultDigest))
  const nextDigests = [...new Set([
    ...(current.progress?.lastObservationDigests ?? []),
    ...freshObservations.map((observation) => observation.resultDigest)
  ])].slice(-64)

  let completedActions = current.completedActions
  let pendingActions = current.pendingActions
  let strong = false
  const reasons: string[] = []
  if (input.todos) {
    const currentActions = new Map([...current.completedActions, ...current.pendingActions].map((action) => [action.id, action]))
    const nextCompleted: TaskStateV1['completedActions'] = []
    const nextPending: TaskStateV1['pendingActions'] = []
    for (const todo of input.todos) {
      const previous = currentActions.get(todo.id)
      const action = {
        id: todo.id,
        text: todo.content,
        status: todo.status,
        evidenceItemIds: previous?.evidenceItemIds ?? []
      }
      if (todo.status === 'completed') nextCompleted.push(action)
      else nextPending.push(action)
      if (previous?.status !== todo.status) {
        strong = true
        reasons.push(`action:${todo.id}:${todo.status}`)
      }
    }
    completedActions = nextCompleted
    pendingActions = nextPending
  }

  const artifactMap = new Map(current.artifacts.map((artifact) => [artifactKey(artifact), artifact]))
  for (const observation of freshObservations) {
    for (const artifact of observation.artifactRefs) {
      const key = artifactKey(artifact)
      if (!artifactMap.has(key)) {
        artifactMap.set(key, artifact)
        strong = true
        reasons.push(`artifact:${artifact.path}`)
      }
    }
  }
  if (freshObservations.length > 0) reasons.push(`evidence:${freshObservations.length}`)

  const nextProgress = {
    ...(current.progress?.strongDigest ? { strongDigest: current.progress.strongDigest } : {}),
    ...(current.progress?.weakDigest ? { weakDigest: current.progress.weakDigest } : {}),
    evidenceCount: (current.progress?.evidenceCount ?? 0) + freshObservations.length,
    artifactCount: artifactMap.size,
    lastObservationDigests: nextDigests
  }
  const changed = strong || freshObservations.length > 0 || !sameActions(current.completedActions, completedActions) || !sameActions(current.pendingActions, pendingActions) || artifactMap.size !== current.artifacts.length
  const level = strong ? 'strong' : freshObservations.length > 0 ? 'weak' : 'none'
  const value = digest({
    completedActions,
    pendingActions,
    artifacts: [...artifactMap.values()],
    observations: nextDigests
  })
  if (level === 'strong') nextProgress.strongDigest = value
  else if (level === 'weak') nextProgress.weakDigest = value
  const state = changed
    ? TaskStateV1Schema.parse({
        ...current,
        revision: current.revision + 1,
        completedActions,
        pendingActions,
        artifacts: [...artifactMap.values()],
        progress: nextProgress,
        updatedAt: input.nowIso()
      })
    : current
  return { state, digest: { level, value, reasons } }
}

function sameActions(a: readonly TaskStateV1['pendingActions'][number][], b: readonly TaskStateV1['pendingActions'][number][]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function artifactKey(artifact: TaskArtifactRef): string {
  return `${artifact.kind}:${artifact.path}:${artifact.producedByCallId ?? ''}`
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
