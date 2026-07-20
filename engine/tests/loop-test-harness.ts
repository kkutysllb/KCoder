import { TurnOrchestrator } from '@qiongqi/loop'
import { InMemoryEventBus } from '@qiongqi/adapter-storage'
import { InMemoryApprovalGate } from '@qiongqi/adapter-storage'
import { InMemoryUserInputGate } from '@qiongqi/adapter-storage'
import { InMemoryThreadStore } from '@qiongqi/adapter-storage'
import { InMemorySessionStore } from '@qiongqi/adapter-storage'
import { LocalToolHost, getDefaultLocalTools, type LocalTool } from '@qiongqi/adapter-tools'
import { TurnService } from '@qiongqi/services'
import { ThreadService } from '@qiongqi/services'
import { UsageService } from '@qiongqi/services'
import { RuntimeEventRecorder } from '@qiongqi/services'
import { InflightTracker } from '@qiongqi/loop'
import { SteeringQueue } from '@qiongqi/loop'
import { ContextCompactor } from '@qiongqi/loop'
import { SequentialIdGenerator } from '@qiongqi/ports'
import { createThreadRecord } from '@qiongqi/domain'
import { createImmutablePrefix } from '@qiongqi/cache'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '@qiongqi/ports'
import type { SkillPluginHost, SkillRuntime } from '@qiongqi/skills'
import type { AttachmentStore } from '@qiongqi/attachments'
import type { ModelCapabilityMetadata } from '@qiongqi/contracts'
import type { MemoryStore } from '@qiongqi/memory'
import type { TokenEconomyConfig } from '@qiongqi/loop'
import type { ToolStormBreakerOptions } from '@qiongqi/loop'
import type { ContextCompactionConfig } from '@qiongqi/loop'

export type Harness = {
  threadId: string
  turnId: string
  bus: InMemoryEventBus
  approvalGate: InMemoryApprovalGate
  userInputGate: InMemoryUserInputGate
  inflight: InflightTracker
  steering: SteeringQueue
  compactor: ContextCompactor
  toolHost: LocalToolHost
  turns: TurnService
  threads: ThreadService
  usage: UsageService
  loop: TurnOrchestrator
  prefix: ReturnType<typeof createImmutablePrefix>
  threadStore: InMemoryThreadStore
  sessionStore: InMemorySessionStore
  allocateSeq: (threadId: string) => number
  nowIso: () => string
  nowMs: () => number
  events: RuntimeEventRecorder
  ids: SequentialIdGenerator
}

export function makeFakeModel(chunks: ModelStreamChunk[]): ModelClient {
  return {
    provider: 'fake',
    model: 'fake',
    async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      for (const chunk of chunks) yield chunk
    }
  }
}

export function makeSilentModel(): ModelClient {
  return {
    provider: 'silent',
    model: 'silent',
    async *stream(): AsyncIterable<ModelStreamChunk> {
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }
}

export function makeHarness(
  model: ModelClient,
  options: {
    compactor?: ContextCompactor
    tools?: LocalTool[]
    skillRuntime?: SkillRuntime
    skillPluginHost?: SkillPluginHost
    attachmentStore?: AttachmentStore
    runtimeDataDir?: string
    memoryStore?: MemoryStore
    modelCapabilities?: (model: string) => ModelCapabilityMetadata
    tokenEconomy?: TokenEconomyConfig
    contextCompaction?: ContextCompactionConfig
    toolStorm?: ToolStormBreakerOptions & { enabled?: boolean }
    loopBudget?: {
      maxSteps?: number
    }
    nowMs?: () => number
    toolArgumentRepair?: {
      maxStringBytes?: number
    }
  } = {}
): Harness {
  const bus = new InMemoryEventBus()
  const approvalGate = new InMemoryApprovalGate()
  const userInputGate = new InMemoryUserInputGate()
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const compactor = options.compactor ?? new ContextCompactor({ softThreshold: 64, hardThreshold: 128 })
  const toolHost = new LocalToolHost({ tools: options.tools ?? getDefaultLocalTools() })
  const usage = new UsageService()
  const nowIso = () => new Date().toISOString()
  const nowMs = options.nowMs ?? (() => Date.now())
  const allocateSeq = (threadId: string) => bus.allocateSeq(threadId)
  const events = new RuntimeEventRecorder({ eventBus: bus, sessionStore, allocateSeq, nowIso })
  const ids = new SequentialIdGenerator()
  const prefix = createImmutablePrefix({ systemPrompt: 'be brief' })
  const turns = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight,
    steering,
    compactor,
    ids,
    nowIso
  })
  const threads = new ThreadService({ threadStore, sessionStore, events, ids, nowIso })
  const loop = new TurnOrchestrator({
    threadStore,
    sessionStore,
    approvalGate,
    userInputGate,
    model,
    toolHost,
    usage,
    events,
    turns,
    inflight,
    steering,
    compactor,
    prefix,
    ids,
    nowIso,
    nowMs,
    ...(options.skillRuntime ? { skillRuntime: options.skillRuntime } : {}),
    ...(options.skillPluginHost ? { skillPluginHost: options.skillPluginHost } : {}),
    ...(options.attachmentStore ? { attachmentStore: options.attachmentStore } : {}),
    ...(options.runtimeDataDir ? { runtimeDataDir: options.runtimeDataDir } : {}),
    ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
    ...(options.modelCapabilities ? { modelCapabilities: options.modelCapabilities } : {}),
    ...(options.tokenEconomy ? { tokenEconomy: options.tokenEconomy } : {}),
    ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
    ...(options.toolStorm ? { toolStorm: options.toolStorm } : {}),
    ...(options.loopBudget ? { loopBudget: options.loopBudget } : {}),
    ...(options.toolArgumentRepair ? { toolArgumentRepair: options.toolArgumentRepair } : {})
  })

  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    bus,
    approvalGate,
    userInputGate,
    inflight,
    steering,
    compactor,
    toolHost,
    turns,
    threads,
    usage,
    loop,
    prefix,
    threadStore,
    sessionStore,
    allocateSeq,
    nowIso,
    nowMs,
    events,
    ids
  }
}

export async function bootstrapThread(
  h: Harness,
  options: {
    threadId?: string
    workspace?: string
    thread?: Partial<Parameters<typeof createThreadRecord>[0]>
    request?: Parameters<TurnService['startTurn']>[0]['request']
  } = {}
): Promise<void> {
  const threadId = options.threadId ?? h.threadId
  h.threadId = threadId
  await h.threadStore.upsert(
    createThreadRecord({
      id: threadId,
      title: 'demo',
      workspace: options.workspace ?? '/tmp',
      model: 'fake',
      ...options.thread
    })
  )
  const response = await h.turns.startTurn({
    threadId,
    request: options.request ?? { prompt: 'hello' }
  })
  h.turnId = response.turnId
}

export async function resolveNextUserInput(
  h: Harness,
  answers: Array<{ id: string; label: string; value: string }>
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pending = h.userInputGate.pending(h.threadId)[0]
    if (pending) {
      h.userInputGate.resolve(pending.id, { status: 'submitted', answers })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for user input')
}
