import { InMemoryApprovalGate } from '@qiongqi/adapter-storage'
import { InMemoryEventBus } from '@qiongqi/adapter-storage'
import { InMemorySessionStore } from '@qiongqi/adapter-storage'
import { InMemoryThreadStore } from '@qiongqi/adapter-storage'
import { InMemoryUserInputGate } from '@qiongqi/adapter-storage'
import type { ImmutablePrefix } from '@qiongqi/cache'
import type { ModelCapabilityMetadata } from '@qiongqi/contracts'
import type { TurnItem } from '@qiongqi/contracts'
import type { ApprovalPolicy, SandboxMode } from '@qiongqi/contracts'
import type { RuntimeTuningConfig } from '@qiongqi/contracts'
import { TurnOrchestrator } from '@qiongqi/loop'
import type { ContextCompactionConfig, ModelConfig } from '@qiongqi/loop'
import { ContextCompactor } from '@qiongqi/loop'
import { InflightTracker } from '@qiongqi/loop'
import { SteeringQueue } from '@qiongqi/loop'
import type { TokenEconomyConfig } from '@qiongqi/loop'
import type { MemoryStore } from '@qiongqi/memory'
import type { ModelClient } from '@qiongqi/ports'
import { RandomIdGenerator } from '@qiongqi/ports'
import type { ToolHost } from '@qiongqi/ports'
import type { SkillRuntime } from '@qiongqi/skills'
import type { SkillPluginHost } from '@qiongqi/skills'
import { RuntimeEventRecorder } from '@qiongqi/services'
import { ThreadService } from '@qiongqi/services'
import { TurnService } from '@qiongqi/services'
import { UsageService } from '@qiongqi/services'
import type { ChildRunExecutor } from './delegation-runtime.js'

export type ChildAgentExecutorOptions = {
  model: ModelClient
  toolHost: ToolHost
  prefix: ImmutablePrefix
  defaultModel: string
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  tokenEconomy?: TokenEconomyConfig
  runtime?: RuntimeTuningConfig
  nowIso?: () => string
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  skillRuntime?: SkillRuntime
  skillPluginHost?: SkillPluginHost
  memoryStore?: MemoryStore
}

export function createChildAgentExecutor(options: ChildAgentExecutorOptions): ChildRunExecutor {
  return async (input) => {
    const nowIso = options.nowIso ?? (() => new Date().toISOString())
    const eventBus = new InMemoryEventBus()
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const usage = new UsageService()
    const ids = new RandomIdGenerator()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const compactor = new ContextCompactor({
      contextCompaction: options.contextCompaction,
      models: options.models
    })
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
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
    const threads = new ThreadService({
      threadStore,
      sessionStore,
      events,
      ids,
      nowIso
    })
    const loop = new TurnOrchestrator({
      threadStore,
      sessionStore,
      approvalGate: new InMemoryApprovalGate(),
      userInputGate: new InMemoryUserInputGate(),
      model: options.model,
      toolHost: options.toolHost,
      usage,
      events,
      turns,
      inflight,
      steering,
      compactor,
      prefix: options.prefix,
      ids,
      nowIso,
      ...(options.modelCapabilities ? { modelCapabilities: options.modelCapabilities } : {}),
      ...(options.skillRuntime ? { skillRuntime: options.skillRuntime } : {}),
      ...(options.skillPluginHost ? { skillPluginHost: options.skillPluginHost } : {}),
      ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
      ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
      ...(options.tokenEconomy ? { tokenEconomy: options.tokenEconomy } : {}),
      ...(options.runtime?.toolStorm ? { toolStorm: options.runtime.toolStorm } : {}),
      ...(options.runtime?.toolArgumentRepair ? { toolArgumentRepair: options.runtime.toolArgumentRepair } : {})
    })

    const model = input.model?.trim() || options.defaultModel
    const thread = await threads.create({
      title: childThreadTitle(input.childId, input.label),
      workspace: input.workspace?.trim() || '~',
      model,
      mode: 'agent',
      approvalPolicy: options.approvalPolicy ?? 'auto',
      ...(options.sandboxMode ? { sandboxMode: options.sandboxMode } : {})
    }, {
      id: input.childId,
      title: childThreadTitle(input.childId, input.label)
    })
    const started = await turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: input.prompt,
        model,
        mode: 'agent'
      }
    })
    const status = await loop.runTurn(thread.id, started.turnId)
    const runtimeError = (await sessionStore.loadEventsSince(thread.id, 0))
      .find((event) => event.kind === 'error' && event.turnId === started.turnId)
    if (runtimeError?.kind === 'error') {
      throw new Error(runtimeError.message)
    }
    const items = await sessionStore.loadItems(thread.id)
    const summary = summarizeChildTurn(items, started.turnId, status)
    if (status !== 'completed') {
      throw new Error(summary || `child agent ${status}`)
    }
    return {
      summary,
      usage: usage.forThread(thread.id)
    }
  }
}

function childThreadTitle(childId: string, label?: string): string {
  const suffix = label?.trim() || childId
  return `Child agent: ${suffix}`
}

function summarizeChildTurn(
  items: readonly TurnItem[],
  turnId: string,
  status: 'completed' | 'failed' | 'aborted'
): string {
  const turnItems = items.filter((item) => item.turnId === turnId)
  const assistantText = turnItems
    .filter((item): item is Extract<TurnItem, { kind: 'assistant_text' }> => item.kind === 'assistant_text')
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
  if (assistantText) return assistantText
  const errors = turnItems
    .filter((item): item is Extract<TurnItem, { kind: 'error' }> => item.kind === 'error')
    .map((item) => item.message.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  if (errors) return errors
  const toolResult = [...turnItems]
    .reverse()
    .find((item): item is Extract<TurnItem, { kind: 'tool_result' }> => item.kind === 'tool_result')
  if (toolResult) return stringifySummary(toolResult.output)
  return status === 'completed'
    ? 'Child agent completed without a text response.'
    : `Child agent ${status}.`
}

function stringifySummary(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
