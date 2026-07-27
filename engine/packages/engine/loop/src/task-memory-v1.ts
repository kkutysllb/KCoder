import {
  TaskCheckpointV1Schema,
  TaskSharedMemoryKindSchema,
  type CheckpointProvenance,
  type DurableReference,
  type MemoryRecord,
  type TaskCheckpointV1,
  type TaskSharedMemoryKind
} from '@qiongqi/contracts'
import type { MemoryStore } from '@qiongqi/memory'

export interface PublishTaskMemoryInput {
  store: Pick<MemoryStore, 'publishTaskShared'>
  checkpoint: TaskCheckpointV1
  kind: TaskSharedMemoryKind
  content: string
  provenance: CheckpointProvenance
  evidenceRefs?: readonly DurableReference[]
  tags?: readonly string[]
  confidence?: number
  nowIso: () => string
}

const publishFields = new Set([
  'store', 'checkpoint', 'kind', 'content', 'provenance', 'evidenceRefs', 'tags', 'confidence', 'nowIso'
])
const factualKinds = new Set<TaskSharedMemoryKind>(['committed_decision', 'evidence', 'artifact'])

export async function publishTaskMemory(input: PublishTaskMemoryInput): Promise<MemoryRecord> {
  assertKnownFields(input)
  const checkpoint = TaskCheckpointV1Schema.parse(input.checkpoint)
  const kind = TaskSharedMemoryKindSchema.safeParse(input.kind)
  if (!kind.success) throw new Error(`memory kind is not publishable to task_shared: ${String(input.kind)}`)
  const evidenceRefs = [...(input.evidenceRefs ?? [])]
  if (factualKinds.has(kind.data) && evidenceRefs.length === 0) {
    throw new Error(`task_shared ${kind.data} publication requires an evidence reference`)
  }
  return input.store.publishTaskShared({
    scope: 'task_shared',
    taskScope: checkpoint.scope,
    checkpointRevision: checkpoint.revision,
    kind: kind.data,
    content: input.content,
    provenance: input.provenance,
    evidenceRefs,
    retention: 'task',
    publishedAt: input.nowIso(),
    tags: [...(input.tags ?? [])],
    confidence: input.confidence ?? 1
  })
}

function assertKnownFields(input: object): void {
  for (const key of Object.keys(input)) {
    if (!publishFields.has(key)) throw new Error(`unsupported task memory publication field: ${key}`)
  }
}
