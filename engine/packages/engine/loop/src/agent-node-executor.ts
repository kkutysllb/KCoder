import {
  AgentTranscriptSchema,
  type AgentMessageCompletedEvent,
  type AgentMessageDeltaEvent,
  type AgentRun,
  type AgentTranscriptReasoning,
  type AgentTranscriptToolRun,
  type ChildRunRecord,
  type DelegationScope,
  type ManagerRouteDecision,
  type UsageSnapshot
} from '@qiongqi/contracts'
import type { AgentTranscriptStore } from '@qiongqi/ports'
import type { SpecialistDefinition } from './specialist-registry.js'

export type SpecialistRouteProfile = {
  id: string
  name: string
  capabilities: readonly string[]
}

export interface ManagerRouteController {
  readonly toolName: 'route_specialists'
  submit(decision: ManagerRouteDecision): ManagerRouteDecision
  getDecision(): ManagerRouteDecision | undefined
  requireDecision(): ManagerRouteDecision
}

export interface NodeDelegator {
  runChild(input: {
    parentThreadId: string
    parentTurnId: string
    scope: DelegationScope
    prompt: string
    label?: string
    model?: string
    signal: AbortSignal
  }): Promise<ChildRunRecord>
}

export interface GraphBudgetLedger {
  beforeEffect(input: { kind: 'agent_node'; agentPublicKey: string }): Promise<void> | void
  recordUsage(usage: UsageSnapshot): Promise<void> | void
}

export type ScopedNodeDelegator = {
  runChild(input: {
    prompt: string
    label?: string
    model?: string
  }): Promise<ChildRunRecord>
}

export type AgentNodeKernelExecutionInput = {
  threadId: string
  turnId: string
  runId: string
  graphPublicKey: string
  agentRun: AgentRun
  phase: NonNullable<AgentRun['phase']>
  specialist?: SpecialistDefinition
  dependencyResults: ReadonlyMap<string, string>
  allowedToolNames: readonly string[]
  routeTool?: ManagerRouteController
  routePolicy?: {
    specialistIds: readonly string[]
    maxActivatedSpecialists: number
    specialists?: readonly SpecialistRouteProfile[]
  }
  delegation?: ScopedNodeDelegator
  stream?: AgentNodeStreamingCallbacks
  signal: AbortSignal
}

export type AgentNodeStreamingCallbacks = {
  assistantTextDelta(input: {
    sourceRef: string
    delta: string
  }): Promise<{ messageKey: string; content: string }> | { messageKey: string; content: string }
}

export type AgentMessageRuntimeEvent =
  | Omit<AgentMessageDeltaEvent, 'seq' | 'timestamp'>
  | Omit<AgentMessageCompletedEvent, 'seq' | 'timestamp'>

export type AgentNodeKernelExecutionResult = {
  summary: string
  usage?: UsageSnapshot
  userVisibleMessages: Array<{
    role: 'assistant'
    text: string
    sourceRef: string
    artifactRefs?: string[]
  }>
  reasoning?: Array<Omit<AgentTranscriptReasoning, 'key' | 'createdAt'>>
  toolRuns?: Array<Omit<AgentTranscriptToolRun, 'key'>>
}

export type AgentNodeExecutionInput = {
  threadId: string
  turnId: string
  runId: string
  graphPublicKey: string
  agentRun: AgentRun
  specialist?: SpecialistDefinition
  dependencyResults: ReadonlyMap<string, string>
  routeTool?: ManagerRouteController
  routePolicy?: {
    specialistIds: readonly string[]
    maxActivatedSpecialists: number
    specialists?: readonly SpecialistRouteProfile[]
  }
  delegation?: NodeDelegator
  graphBudget: GraphBudgetLedger
  signal: AbortSignal
}

export type AgentNodeExecutionResult = {
  summary: string
  transcriptRef: string
  usage?: UsageSnapshot
  routeDecision?: ManagerRouteDecision
  childRuns: ChildRunRecord[]
  userVisibleMessages: Array<{ role: 'assistant'; text: string }>
}

export class AgentNodeExecutor {
  constructor(private readonly options: {
    transcripts: AgentTranscriptStore
    executeNode: (input: AgentNodeKernelExecutionInput) => Promise<AgentNodeKernelExecutionResult>
    ids: (prefix: string) => string
    nowIso: () => string
    recordAgentMessageEvent?: (event: AgentMessageRuntimeEvent) => Promise<void> | void
  }) {}

  async execute(input: AgentNodeExecutionInput): Promise<AgentNodeExecutionResult> {
    const agentPublicKey = requiredMetadata(input.agentRun.publicKey, 'publicKey')
    const transcriptRef = requiredMetadata(input.agentRun.transcriptRef, 'transcriptRef')
    const phase = requiredMetadata(input.agentRun.phase, 'phase')
    if (phase === 'planning' && !input.routeTool) {
      throw new Error('Manager Planning requires route_specialists')
    }
    await input.graphBudget.beforeEffect({ kind: 'agent_node', agentPublicKey })
    await this.ensureTranscript({
      transcriptRef,
      threadId: input.threadId,
      turnId: input.turnId,
      ownerPublicKey: agentPublicKey
    })

    const childRuns: ChildRunRecord[] = []
    const delegation = input.specialist?.allowSubagents && input.delegation
      ? this.scopedDelegator(input, agentPublicKey, childRuns)
      : undefined
    const allowedToolNames = toolNamesForNode({
      phase,
      specialist: input.specialist,
      routeTool: input.routeTool,
      delegationAvailable: Boolean(delegation)
    })
    const kernelResult = await this.options.executeNode({
      threadId: input.threadId,
      turnId: input.turnId,
      runId: input.runId,
      graphPublicKey: input.graphPublicKey,
      agentRun: input.agentRun,
      phase,
      ...(input.specialist ? { specialist: input.specialist } : {}),
      dependencyResults: input.dependencyResults,
      allowedToolNames,
      ...(phase === 'planning' && input.routeTool ? { routeTool: input.routeTool } : {}),
      ...(input.routePolicy ? { routePolicy: input.routePolicy } : {}),
      ...(delegation ? { delegation } : {}),
      stream: this.streamingCallbacks({
        transcriptRef,
        threadId: input.threadId,
        turnId: input.turnId,
        agentPublicKey
      }),
      signal: input.signal
    })
    if (kernelResult.usage) await input.graphBudget.recordUsage(kernelResult.usage)
    const routeDecision = phase === 'planning' ? input.routeTool?.requireDecision() : undefined
    await this.appendTranscriptResult(transcriptRef, kernelResult)

    return {
      summary: kernelResult.summary,
      transcriptRef,
      ...(kernelResult.usage ? { usage: kernelResult.usage } : {}),
      ...(routeDecision ? { routeDecision } : {}),
      childRuns,
      userVisibleMessages: kernelResult.userVisibleMessages.map((message) => ({
        role: message.role,
        text: message.text
      }))
    }
  }

  private scopedDelegator(
    input: AgentNodeExecutionInput,
    ownerAgentPublicKey: string,
    childRuns: ChildRunRecord[]
  ): ScopedNodeDelegator {
    return {
      runChild: async (child) => {
        const record = await input.delegation!.runChild({
          parentThreadId: input.threadId,
          parentTurnId: input.turnId,
          scope: {
            kind: 'graph_node',
            graphPublicKey: input.graphPublicKey,
            ownerAgentPublicKey,
            depth: 1
          },
          prompt: child.prompt,
          ...(child.label ? { label: child.label } : {}),
          ...(child.model ? { model: child.model } : {}),
          signal: input.signal
        })
        childRuns.push(record)
        return record
      }
    }
  }

  private async ensureTranscript(input: {
    transcriptRef: string
    threadId: string
    turnId: string
    ownerPublicKey: string
  }): Promise<void> {
    const existing = await this.options.transcripts.load(input.transcriptRef)
    if (existing) {
      if (existing.threadId !== input.threadId || existing.turnId !== input.turnId || existing.ownerPublicKey !== input.ownerPublicKey) {
        throw new Error(`Agent transcript ownership mismatch: ${input.transcriptRef}`)
      }
      return
    }
    await this.options.transcripts.save(AgentTranscriptSchema.parse({
      version: 1,
      ...input,
      messages: [],
      reasoning: [],
      toolRuns: [],
      revision: 0,
      updatedAt: this.options.nowIso()
    }))
  }

  private async appendTranscriptResult(
    transcriptRef: string,
    result: AgentNodeKernelExecutionResult
  ): Promise<void> {
    const now = this.options.nowIso()
    const completedEvents: AgentMessageRuntimeEvent[] = []
    await this.options.transcripts.update(transcriptRef, (current) => {
      const seenSourceRefs = new Set(current.messages.map((message) => message.sourceRef))
      const existingMessageBySourceRef = new Map(current.messages.map((message) => [message.sourceRef, message]))
      const messages = [...current.messages]
      for (const message of result.userVisibleMessages) {
        const existing = existingMessageBySourceRef.get(message.sourceRef)
        if (existing) {
          const index = messages.findIndex((candidate) => candidate.key === existing.key)
          if (index >= 0) {
            messages[index] = {
              ...messages[index]!,
              content: message.text,
              artifactRefs: message.artifactRefs ?? messages[index]!.artifactRefs
            }
            completedEvents.push({
              kind: 'agent_message_completed',
              threadId: current.threadId,
              turnId: current.turnId,
              agentKey: current.ownerPublicKey,
              messageKey: messages[index]!.key,
              sourceRef: message.sourceRef,
              role: message.role,
              content: message.text,
              artifactKeys: message.artifactRefs ?? messages[index]!.artifactRefs
            })
          }
          continue
        }
        if (seenSourceRefs.has(message.sourceRef)) continue
        seenSourceRefs.add(message.sourceRef)
        const next = {
          key: this.options.ids('transcript_message'),
          sourceRef: message.sourceRef,
          role: message.role,
          content: message.text,
          createdAt: now,
          artifactRefs: message.artifactRefs ?? []
        }
        messages.push(next)
        completedEvents.push({
          kind: 'agent_message_completed',
          threadId: current.threadId,
          turnId: current.turnId,
          agentKey: current.ownerPublicKey,
          messageKey: next.key,
          sourceRef: next.sourceRef,
          role: next.role,
          content: next.content,
          artifactKeys: next.artifactRefs
        })
      }
      return AgentTranscriptSchema.parse({
        ...current,
        messages,
        reasoning: [
          ...current.reasoning,
          ...(result.reasoning ?? []).map((reasoning) => ({
            ...reasoning,
            key: this.options.ids('transcript_reasoning'),
            createdAt: now
          }))
        ],
        toolRuns: [
          ...current.toolRuns,
          ...(result.toolRuns ?? []).map((toolRun) => ({
            ...toolRun,
            key: this.options.ids('transcript_tool')
          }))
        ],
        revision: current.revision + 1,
        updatedAt: now
      })
    })
    for (const event of completedEvents) {
      await this.options.recordAgentMessageEvent?.(event)
    }
  }

  private streamingCallbacks(input: {
    transcriptRef: string
    threadId: string
    turnId: string
    agentPublicKey: string
  }): AgentNodeStreamingCallbacks {
    return {
      assistantTextDelta: async ({ sourceRef, delta }) => {
        const now = this.options.nowIso()
        let emitted: Omit<AgentMessageDeltaEvent, 'seq' | 'timestamp'> | undefined
        const updated = await this.options.transcripts.update(input.transcriptRef, (current) => {
          const existingIndex = current.messages.findIndex((message) => message.sourceRef === sourceRef)
          const messages = [...current.messages]
          if (existingIndex >= 0) {
            const currentMessage = messages[existingIndex]!
            const nextContent = `${currentMessage.content}${delta}`
            messages[existingIndex] = {
              ...currentMessage,
              content: nextContent
            }
            emitted = {
              kind: 'agent_message_delta',
              threadId: input.threadId,
              turnId: input.turnId,
              agentKey: input.agentPublicKey,
              messageKey: currentMessage.key,
              sourceRef,
              role: 'assistant',
              delta,
              content: nextContent
            }
          } else {
            const nextMessage = {
              key: this.options.ids('transcript_message'),
              sourceRef,
              role: 'assistant' as const,
              content: delta,
              createdAt: now,
              artifactRefs: []
            }
            messages.push(nextMessage)
            emitted = {
              kind: 'agent_message_delta',
              threadId: input.threadId,
              turnId: input.turnId,
              agentKey: input.agentPublicKey,
              messageKey: nextMessage.key,
              sourceRef,
              role: 'assistant',
              delta,
              content: delta
            }
          }
          return AgentTranscriptSchema.parse({
            ...current,
            messages,
            revision: current.revision + 1,
            updatedAt: now
          })
        })
        if (emitted) await this.options.recordAgentMessageEvent?.(emitted)
        const message = updated.messages.find((candidate) => candidate.sourceRef === sourceRef)
        if (!message) throw new Error(`streamed Agent transcript message missing: ${sourceRef}`)
        return { messageKey: message.key, content: message.content }
      }
    }
  }
}

const MANAGER_PLANNING_INSPECTION_TOOLS = [
  'read',
  'ls',
  'find',
  'grep',
  'bash'
] as const

function toolNamesForNode(input: {
  phase: NonNullable<AgentRun['phase']>
  specialist?: SpecialistDefinition
  routeTool?: ManagerRouteController
  delegationAvailable: boolean
}): string[] {
  if (input.phase === 'planning') {
    return input.routeTool
      ? [...MANAGER_PLANNING_INSPECTION_TOOLS, input.routeTool.toolName]
      : [...MANAGER_PLANNING_INSPECTION_TOOLS]
  }
  if (input.phase === 'synthesis') return []
  const tools = input.specialist?.allowedTools ?? []
  return tools.filter((toolName) => toolName !== 'route_specialists' && (
    toolName !== 'delegate_task' || input.delegationAvailable
  ))
}

function requiredMetadata<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`AgentRun ${field} is required for node execution`)
  return value
}
