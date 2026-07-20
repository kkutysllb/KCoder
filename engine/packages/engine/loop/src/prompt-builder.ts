/**
 * PromptBuilder assembles the `ModelRequest` for a single step: it loads and
 * heals history, resolves the turn model (including auto-routing), resolves
 * attachments / skills / memories, detects tool-catalog drift, runs context
 * compaction, applies token-economy and history-hygiene transforms, and
 * records the `input_*` / `pre_send` / `post_send` pipeline stages.
 *
 * It owns three pieces of cross-step state that previously lived on the
 * monolithic `AgentLoop`: the auto-model-route cache, the prompt-token
 * pressure signal (produced by ModelStepRunner, consumed here), and the
 * tool-catalog fingerprint snapshots. Behaviour is preserved verbatim.
 */

import type {
  ModelClient,
  ModelRequest,
  ModelToolSpec,
  ModelInputAttachment,
  ModelTextAttachmentFallback
} from '@qiongqi/ports'
import type {
  ToolHost,
  ToolHostContext,
  GuiPlanContext,
  ToolProviderKind
} from '@qiongqi/ports'
import type { ThreadStore } from '@qiongqi/ports'
import type { SessionStore } from '@qiongqi/ports'
import type { TaskStateStore } from '@qiongqi/ports'
import type { UsageService } from '@qiongqi/services'
import type { TurnService } from '@qiongqi/services'
import type { RuntimeEventRecorder } from '@qiongqi/services'
import type { IdGenerator } from '@qiongqi/ports'
import type { ApprovalPolicy } from '@qiongqi/contracts'
import type { ModelCapabilityMetadata } from '@qiongqi/contracts'
import type { TurnItem } from '@qiongqi/contracts'
import type { ImmutablePrefix } from '@qiongqi/cache'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { ContextCompactor } from './context-compactor.js'
import type { ContextCompactionConfig } from './model-context-profile.js'
import { modelCapabilitiesForModel } from './model-context-profile.js'
import type { SkillRuntime } from '@qiongqi/skills'
import type { SkillPluginHost, WorkModeInfo } from '@qiongqi/skills'
import type { AttachmentStore, AttachmentContent } from '@qiongqi/attachments'
import type { MemoryStore } from '@qiongqi/memory'
import type { UserInputResolution } from '@qiongqi/ports'
import {
  shouldVerifyImmutablePrefix,
  verifyImmutablePrefix
} from '@qiongqi/cache'
import { detectVolatilePrefixContent } from '@qiongqi/cache'
import { buildToolCatalogFingerprint } from '@qiongqi/cache'
import { repairModelHistoryItems } from '@qiongqi/domain'
import { healLoadedHistoryItems } from './history-healing.js'
import { makeUserItem, makeErrorItem } from '@qiongqi/domain'
import { touchThread } from '@qiongqi/domain'
import {
  applyTokenEconomyToRequest,
  normalizeTokenEconomyConfig,
  type TokenEconomyConfig
} from './token-economy.js'
import { applyRequestHistoryHygiene } from './request-history-hygiene.js'
import { applyModelRequestInputBudget } from './model-request-budget.js'
import { estimateModelRequestInputTokens } from './model-request-estimator.js'
import {
  recentAutoRouterContext,
  resolveAutoModelRoute,
  type AutoModelRouteSelection
} from './auto-model-router.js'
import { CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'
import { shellRuntimeInstruction } from '@qiongqi/adapter-tools'
import {
  PLAN_MODE_INSTRUCTION,
  goalContinuationInstruction,
  todoContinuationInstruction,
  hasSuccessfulCreatePlanResult,
  allowedToolNamesWithGuiStateTools,
  normalizeApprovalPolicy,
  isAdditiveToolCatalogChange,
  buildToolCatalogDriftMessage,
  buildTextAttachmentFallback,
  attachmentRequestPipelineDetails,
  buildModelCompactionPrompt,
  effectiveHistoryAfterLatestCompaction,
  resolveModelMode,
  normalizeRequestedReasoningEffort,
  memoryInstructions,
  prefixVolatilityStageDetails,
  type ToolCatalogSnapshot,
  type ToolCatalogDrift,
  DEFAULT_COMPACTION_SUMMARY_TIMEOUT_MS,
  DEFAULT_COMPACTION_SUMMARY_MAX_TOKENS,
  DEFAULT_COMPACTION_SUMMARY_INPUT_MAX_BYTES
} from './loop-helpers.js'
import {
  recordPipelineStage,
  recordTokenEconomySavings,
  recordToolCatalogDrift
} from './loop-events.js'
import { CompactionTransaction } from './compaction-transaction.js'
import { CompactionGovernor, type CompactionGovernorState } from './compaction-governor.js'

type ThreadRecord = Awaited<ReturnType<ThreadStore['get']>>
type TurnRecord = Awaited<ReturnType<TurnService['getTurn']>>
type PromptRuntimeScope = {
  ownerUserId: string
  workspaceKey: string
  threadId: string
  turnId: string
}

function isImageMimeType(mimeType: string | undefined): boolean {
  return Boolean(mimeType && mimeType.toLowerCase().startsWith('image/'))
}

function promptRuntimeScope(
  thread: ThreadRecord,
  threadId: string,
  turnId: string
): PromptRuntimeScope {
  return {
    ownerUserId: thread?.ownerUserId ?? 'local-default-owner',
    workspaceKey: thread?.workspace ?? 'local-default-workspace',
    threadId,
    turnId
  }
}

function promptScopeKey(scope: PromptRuntimeScope): string {
  return JSON.stringify(scope)
}

function parsePromptScopeKey(key: string): PromptRuntimeScope | undefined {
  try {
    const value = JSON.parse(key) as Partial<PromptRuntimeScope>
    if (
      typeof value.ownerUserId !== 'string'
      || typeof value.workspaceKey !== 'string'
      || typeof value.threadId !== 'string'
      || typeof value.turnId !== 'string'
    ) return undefined
    return value as PromptRuntimeScope
  } catch {
    return undefined
  }
}

function parseCompactionGovernorState(value: unknown): CompactionGovernorState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<CompactionGovernorState>
  const step = candidate.step
  const lastCompactionStep = candidate.lastCompactionStep
  if (candidate.version !== 1 || typeof step !== 'number' || !Number.isSafeInteger(step) || step < 0) return undefined
  if (typeof lastCompactionStep !== 'number' || !Number.isSafeInteger(lastCompactionStep)) return undefined
  return {
    version: 1,
    step,
    lastCompactionStep,
    ...(typeof candidate.lastSummaryDigest === 'string' ? { lastSummaryDigest: candidate.lastSummaryDigest } : {})
  }
}

const TOOL_OUTPUT_MAX_INLINE_BYTES = 64 * 1024
const TOOL_OUTPUT_PREVIEW_HEAD_BYTES = 4 * 1024
const TOOL_OUTPUT_PREVIEW_TAIL_BYTES = 4 * 1024

export type BuildContext = {
  request: ModelRequest
  model: string
  modelCapabilities: ModelCapabilityMetadata
  reasoningEffort?: string
  thread: ThreadRecord
  turn: TurnRecord
  healedItems: readonly TurnItem[]
  activePlanContext: GuiPlanContext | undefined
  workModeId: string | undefined
  effectiveMode: 'agent' | 'plan' | undefined
  approvalPolicy: ApprovalPolicy
  planTurnActive: boolean
  allowedToolNames: readonly string[] | undefined
  activeSkillIds: readonly string[]
  activeGoalInstruction: string | null
  toolSpecs: ModelToolSpec[]
  toolProviderMetadata: Map<string, { providerId?: string; providerKind?: ToolProviderKind }>
  toolProviderKinds: Map<string, ToolProviderKind | undefined>
  toolKinds: Map<string, 'tool_call' | 'command_execution' | 'file_change' | undefined>
  toolCatalogDrift: ToolCatalogDrift
  attachments: { imageAttachments: ModelInputAttachment[]; textFallbacks: ModelTextAttachmentFallback[] }
  compactionGovernorState: CompactionGovernorState
}

export type BuildResult =
  | { kind: 'aborted' }
  | { kind: 'stop' }
  | { kind: 'built'; ctx: BuildContext }

export type PromptBuilderDeps = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  taskStates?: TaskStateStore
  events: RuntimeEventRecorder
  turns: TurnService
  usage: UsageService
  model: ModelClient
  toolHost: ToolHost
  compactor: ContextCompactor
  prefix: ImmutablePrefix
  ids: IdGenerator
  nowIso: () => string
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  skillRuntime?: SkillRuntime
  /**
   * v1 plugin host. When present, turn resolution (activation, instruction
   * injection, allowedToolNames, and permission enforcement) runs through it;
   * `skillRuntime` is kept as a legacy fallback. Both share the same
   * SkillTurnResolution shape.
   */
  skillPluginHost?: SkillPluginHost
  attachmentStore?: AttachmentStore
  runtimeDataDir?: string
  memoryStore?: MemoryStore
  tokenEconomy?: TokenEconomyConfig
  contextCompaction?: ContextCompactionConfig
  activePlanContext?: GuiPlanContext
  onActivePlanContextChange?: (context: GuiPlanContext | undefined) => void
  awaitUserInput: (
    threadId: string,
    turnId: string,
    input: {
      id: string
      itemId: string
      prompt: string
      questions: Array<{
        header: string
        id: string
        question: string
        options: Array<{ label: string; description: string }>
      }>
    },
    signal: AbortSignal
  ) => Promise<UserInputResolution>
}

export class PromptBuilder {
  private readonly autoModelRoutes = new Map<string, AutoModelRouteSelection>()
  private readonly promptTokenPressure = new Map<string, { model: string; promptTokens: number }>()
  private readonly toolCatalogSnapshots = new Map<string, ToolCatalogSnapshot>()
  // Classic-loop callers do not have RunStateV3; retain their cooldown locally.
  // Kernel v3 always supplies persisted middleware state and does not use this map.
  private readonly classicCompactionGovernors = new Map<string, { governor: CompactionGovernor; step: number }>()

  constructor(private readonly deps: PromptBuilderDeps) {}

  /** Called by ModelStepRunner when a usage chunk reports prompt tokens. */
  recordPromptPressure(scope: PromptRuntimeScope, model: string, promptTokens: number): void {
    if (!scope.threadId || promptTokens <= 0) return
    const key = promptScopeKey(scope)
    const current = this.promptTokenPressure.get(key)
    if (current && current.promptTokens >= promptTokens) return
    this.promptTokenPressure.set(key, { model, promptTokens })
  }

  /** Called by the orchestrator when a turn ends. */
  clearTurnAutoRoute(threadId: string, turnId: string): void {
    for (const key of this.autoModelRoutes.keys()) {
      const scope = parsePromptScopeKey(key)
      if (scope?.threadId === threadId && scope.turnId === turnId) {
        this.autoModelRoutes.delete(key)
        this.classicCompactionGovernors.delete(key)
      }
    }
  }

  async build(input: {
    threadId: string
    turnId: string
    signal: AbortSignal
    stepIndex: number
    compactionGovernorState?: unknown
    forceCompaction?: boolean
  }): Promise<BuildResult> {
    const { threadId, turnId, signal, stepIndex, forceCompaction = false } = input
    if (shouldVerifyImmutablePrefix()) {
      verifyImmutablePrefix(this.deps.prefix)
    }
    const [thread, turn] = await Promise.all([
      this.deps.threadStore.get(threadId),
      this.deps.turns.getTurn(threadId, turnId)
    ])
    const runtimeScope = promptRuntimeScope(thread, threadId, turnId)
    await recordPipelineStage(this.deps.events, { threadId, turnId, stage: 'input_received', details: { stepIndex } })
    const activePlanContext = turn?.guiPlan
      ? { ...turn.guiPlan, turnId }
      : this.deps.activePlanContext
    const budgetGate = await this.checkBudgetGate(thread, threadId, turnId)
    if (budgetGate === 'blocked') return { kind: 'stop' }
    const loadedItems = await this.deps.sessionStore.loadItems(threadId)
    const healed = healLoadedHistoryItems(loadedItems)
    if (healed.changed) {
      await this.deps.sessionStore.rewriteItems(threadId, healed.items)
    }
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'input_cached',
      details: prefixVolatilityStageDetails(detectVolatilePrefixContent(this.deps.prefix))
    })
    if (stepIndex > 0) {
      const toolResultCount = healed.items.filter(
        (item) => item.turnId === turnId && item.kind === 'tool_result'
      ).length
      await this.deps.events.record({
        kind: 'tool_result_upload_wait',
        threadId,
        turnId,
        status: 'waiting',
        toolResultCount
      })
    }
    const items = repairModelHistoryItems(
      effectiveHistoryAfterLatestCompaction(healed.items)
    )
    const approvalPolicy = normalizeApprovalPolicy(thread?.approvalPolicy)
    const effectiveMode = turn?.mode ?? thread?.mode
    const modelRoute = await this.resolveTurnModel({
      scope: runtimeScope,
      threadId,
      turnId,
      latestRequest: turn?.prompt ?? '',
      items,
      signal,
      reasoningEffort: turn?.reasoningEffort,
      candidates: [turn?.model, thread?.model, this.deps.model.model]
    })
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'input_routed',
      details: {
        model: modelRoute.model,
        ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {})
      }
    })
    const model = modelRoute.model
    const modelCapabilities = this.deps.modelCapabilities?.(model) ?? modelCapabilitiesForModel(model)
    const attachments = await this.resolveAttachments({
      attachmentIds: turn?.attachmentIds ?? [],
      threadId,
      workspace: thread?.workspace ?? '',
      modelCapabilities
    })
    const workModeId = turn?.workModeId ?? thread?.workModeId
    const workModeInstruction = currentWorkModeInstruction(
      this.deps.skillPluginHost?.workModeInfo(workModeId) ?? fallbackWorkModeInfo(workModeId)
    )
    const effectiveSkillIds = this.deps.skillPluginHost?.effectiveSkillIds(workModeId)
    const explicitSkillIds = turn?.explicitSkillIds ?? []
    const skillResolution = this.deps.skillPluginHost?.resolveTurn({
      prompt: turn?.prompt ?? '',
      workspace: thread?.workspace ?? '',
      threadId,
      ownerUserId: thread?.ownerUserId,
      workModeId,
      effectiveSkillIds,
      forcedSkillIds: explicitSkillIds
    }) ?? this.deps.skillRuntime?.resolveTurn({
      prompt: turn?.prompt ?? '',
      workspace: thread?.workspace ?? ''
    }) ?? {
      activeSkillIds: [],
      activations: [],
      instructions: [],
      injectedBytes: 0
    }
    const memories = await this.retrieveMemories({
      prompt: turn?.prompt ?? '',
      workspace: thread?.workspace ?? '',
      threadId,
      ownerUserId: thread?.ownerUserId
    })
    const planTurnActive = effectiveMode === 'plan' || Boolean(activePlanContext)
    const activeGoalInstruction = planTurnActive
      ? null
      : goalContinuationInstruction(thread?.goal)
    const activeTodoInstruction = todoContinuationInstruction(thread?.todos)
    const allowedToolNames = allowedToolNamesWithGuiStateTools(
      skillResolution.allowedToolNames,
      activeGoalInstruction !== null
    )
    const toolContext: ToolHostContext = {
      threadId,
      turnId,
      workspace: thread?.workspace ?? '',
      ...(workModeId ? { workModeId } : {}),
      ...(thread?.ownerUserId ? { ownerUserId: thread.ownerUserId } : {}),
      threadMode: effectiveMode,
      ...(activePlanContext ? { guiPlan: activePlanContext } : {}),
      model: modelCapabilities,
      activeSkillIds: skillResolution.activeSkillIds,
      memoryPolicy: { enabled: Boolean(this.deps.memoryStore) },
      delegationPolicy: { enabled: false },
      ...(this.deps.runtimeDataDir
        ? {
            outputBudget: {
              outputDir: join(this.deps.runtimeDataDir, 'threads', threadId, 'tool-output'),
              maxInlineBytes: TOOL_OUTPUT_MAX_INLINE_BYTES,
              previewHeadBytes: TOOL_OUTPUT_PREVIEW_HEAD_BYTES,
              previewTailBytes: TOOL_OUTPUT_PREVIEW_TAIL_BYTES
            }
          }
        : {}),
      ...(allowedToolNames ? { allowedToolNames } : {}),
      approvalPolicy,
      abortSignal: signal,
      awaitApproval: async () => 'allow',
      awaitUserInput: (userInput) => this.deps.awaitUserInput(threadId, turnId, userInput, signal)
    }
    const tools = await this.deps.toolHost.listTools(toolContext)
    const toolSpecs: ModelToolSpec[] = tools
    const toolProviderMetadata = new Map(
      tools.map((tool) => [tool.name, { providerId: tool.providerId, providerKind: tool.providerKind }])
    )
    const toolCatalog = buildToolCatalogFingerprint(toolSpecs)
    const toolCatalogDrift = this.recordToolCatalogFingerprint({
      ownerUserId: runtimeScope.ownerUserId,
      threadId,
      workspace: thread?.workspace ?? '',
      mode: effectiveMode ?? 'agent',
      model: modelCapabilities.id,
      activeSkillIds: skillResolution.activeSkillIds,
      allowedToolNames,
      fingerprint: toolCatalog.fingerprint,
      toolNames: toolCatalog.toolNames,
      toolHashes: toolCatalog.toolHashes
    })
    const toolCatalogDriftMessage = toolCatalogDrift.kind !== 'none'
      ? buildToolCatalogDriftMessage(toolCatalog, toolCatalogDrift.kind)
      : undefined
    if (toolCatalogDrift.kind !== 'none' && toolCatalogDriftMessage) {
      await recordToolCatalogDrift(this.deps.turns, this.deps.events, {
        threadId,
        turnId,
        fingerprint: toolCatalog.fingerprint,
        toolCount: toolCatalog.toolCount,
        toolNames: toolCatalog.toolNames,
        changeKind: toolCatalogDrift.kind,
        message: toolCatalogDriftMessage
      })
    }
    if (turn) {
      await this.deps.turns.updateTurnMetadata(threadId, turnId, {
        activeSkillIds: skillResolution.activeSkillIds,
        skillInjectionBytes: skillResolution.injectedBytes,
        injectedMemoryIds: memories.map((memory) => memory.id),
        toolCatalogFingerprint: toolCatalog.fingerprint,
        toolCatalogToolCount: toolCatalog.toolCount,
        toolCatalogDrift: toolCatalogDrift.kind !== 'none'
      })
    }
    if (toolCatalogDrift.kind === 'breaking') return { kind: 'stop' }
    const toolKinds = new Map(toolSpecs.map((tool) => [tool.name, tool.toolKind]))
    const runtimeCatalogQuestion = isRuntimeCatalogQuestion(turn?.prompt ?? '')
    const planArtifactRequired = planTurnActive && !runtimeCatalogQuestion
    const createPlanSatisfied = planArtifactRequired
      ? hasSuccessfulCreatePlanResult(healed.items, turnId)
      : false
    const requiredToolName =
      planArtifactRequired &&
      !createPlanSatisfied &&
      toolSpecs.some((tool) => tool.name === CREATE_PLAN_TOOL_NAME)
        ? CREATE_PLAN_TOOL_NAME
        : undefined
    const compacted = await this.compactIfNeeded(
      items,
      model,
      signal,
      runtimeScope,
      input.compactionGovernorState,
      forceCompaction
    )
    if (signal.aborted) return { kind: 'aborted' }
    const history = compacted.items
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'input_compressed',
      details: { historyItems: history.length }
    })
    const contextInstructions = [
      ...(activeGoalInstruction ? [activeGoalInstruction] : []),
      ...(activeTodoInstruction ? [activeTodoInstruction] : []),
      ...memoryInstructions(memories),
      ...skillResolution.instructions,
      ...(workModeInstruction ? [workModeInstruction] : []),
      ...(toolSpecs.some((tool) => tool.name === 'bash') ? [shellRuntimeInstruction()] : []),
      ...(toolCatalogDriftMessage ? [toolCatalogDriftMessage] : [])
    ]
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'input_remembered',
      details: {
        memoryCount: memories.length,
        contextInstructionCount: contextInstructions.length
      }
    })
    const tokenEconomy = normalizeTokenEconomyConfig(this.deps.tokenEconomy)
    const baseRequest: ModelRequest = {
      threadId,
      turnId,
      model,
      systemPrompt: this.deps.prefix.systemPrompt,
      ...(planTurnActive ? { modeInstruction: PLAN_MODE_INSTRUCTION } : {}),
      ...(contextInstructions.length ? { contextInstructions } : {}),
      prefix: this.deps.prefix.fewShots,
      history,
      ...(attachments.imageAttachments.length ? { attachments: attachments.imageAttachments } : {}),
      ...(attachments.textFallbacks.length ? { attachmentTextFallbacks: attachments.textFallbacks } : {}),
      tools: toolSpecs,
      ...(requiredToolName ? { requiredToolName } : {}),
      ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {}),
      abortSignal: signal
    }
    const rawInputTokens = tokenEconomy.enabled
      ? estimateModelRequestInputTokens(baseRequest)
      : 0
    const economyRequest = applyTokenEconomyToRequest(baseRequest, tokenEconomy)
    const hygienicRequest: ModelRequest = {
      ...economyRequest,
      history: applyRequestHistoryHygiene(economyRequest.history, tokenEconomy.historyHygiene)
    }
    const request = applyModelRequestInputBudget(hygienicRequest, {
      maxInputTokens: this.deps.compactor.hardCap(model)
    })
    if (tokenEconomy.enabled) {
      await recordTokenEconomySavings(this.deps.usage, this.deps.events, {
        threadId,
        turnId,
        model,
        rawInputTokens,
        sentInputTokens: estimateModelRequestInputTokens(request)
      })
    }
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'pre_send',
      details: {
        model: request.model,
        historyItems: request.history.length,
        toolCount: request.tools.length,
        ...(request.requiredToolName ? { requiredToolName: request.requiredToolName } : {}),
        ...attachmentRequestPipelineDetails({
          attachmentIds: turn?.attachmentIds ?? [],
          imageAttachments: attachments.imageAttachments,
          textFallbacks: attachments.textFallbacks,
          modelCapabilities
        })
      }
    })
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'post_send',
      details: { model: request.model }
    })

    const ctx: BuildContext = {
      request,
      model,
      modelCapabilities,
      ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {}),
      thread,
      turn,
      healedItems: healed.items,
      activePlanContext,
      workModeId,
      effectiveMode,
      approvalPolicy,
      planTurnActive,
      allowedToolNames,
      activeSkillIds: skillResolution.activeSkillIds,
      activeGoalInstruction,
      toolSpecs,
      toolProviderMetadata,
      toolProviderKinds: new Map(tools.map((tool) => [tool.name, tool.providerKind])),
      toolKinds,
      toolCatalogDrift,
      attachments,
      compactionGovernorState: compacted.state
    }
    return { kind: 'built', ctx }
  }

  private async resolveTurnModel(input: {
    scope: PromptRuntimeScope
    threadId: string
    turnId: string
    latestRequest: string
    items: readonly TurnItem[]
    signal: AbortSignal
    reasoningEffort?: string
    candidates: Array<string | undefined>
  }): Promise<{ model: string; reasoningEffort?: string }> {
    const requestedReasoningEffort = normalizeRequestedReasoningEffort(input.reasoningEffort)
    const resolved = resolveModelMode(...input.candidates)
    if (resolved.kind === 'fixed') {
      return {
        model: resolved.model,
        ...(requestedReasoningEffort ? { reasoningEffort: requestedReasoningEffort } : {})
      }
    }
    const key = promptScopeKey(input.scope)
    const cached = this.autoModelRoutes.get(key)
    if (cached) {
      return {
        model: cached.model,
        reasoningEffort: requestedReasoningEffort ?? cached.reasoningEffort
      }
    }
    const route = await resolveAutoModelRoute({
      modelClient: this.deps.model,
      threadId: input.threadId,
      turnId: input.turnId,
      latestRequest: input.latestRequest,
      recentContext: recentAutoRouterContext(input.items, input.turnId),
      selectedModelMode: 'auto',
      abortSignal: input.signal
    })
    this.autoModelRoutes.set(key, route)
    return {
      model: route.model,
      reasoningEffort: requestedReasoningEffort ?? route.reasoningEffort
    }
  }

  private async resolveAttachments(input: {
    attachmentIds: readonly string[]
    threadId: string
    workspace: string
    modelCapabilities: ModelCapabilityMetadata
  }): Promise<{ imageAttachments: ModelInputAttachment[]; textFallbacks: ModelTextAttachmentFallback[] }> {
    if (input.attachmentIds.length === 0) return { imageAttachments: [], textFallbacks: [] }
    const supportsImageInput = input.modelCapabilities.inputModalities.includes('image')
    const textFallbackPolicy = this.deps.attachmentStore?.textFallbackPolicy() ?? {
      textFallbackMaxBase64Bytes: 524_288,
      textFallbackMaxImageDimension: 1280,
      textFallbackPreferredMimeType: 'image/webp'
    }
    const imageAttachments: ModelInputAttachment[] = []
    const textFallbacks: ModelTextAttachmentFallback[] = []
    for (const id of input.attachmentIds) {
      const attachment = await this.resolveAttachmentContent(id, {
        threadId: input.threadId,
        workspace: input.workspace
      })
      // Only genuine images can be sent as image_url parts. Non-image files
      // (PDF/ZIP/text/Office/...) are always routed to the text-fallback path,
      // even when the model supports image input — providers reject non-image
      // bytes in image_url slots.
      if (supportsImageInput && isImageMimeType(attachment.mimeType)) {
        imageAttachments.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataBase64: attachment.data.toString('base64'),
          ...(attachment.width ? { width: attachment.width } : {}),
          ...(attachment.height ? { height: attachment.height } : {})
        })
        continue
      }
      textFallbacks.push(buildTextAttachmentFallback(
        attachment,
        textFallbackPolicy.textFallbackMaxBase64Bytes
      ))
    }
    return { imageAttachments, textFallbacks }
  }

  private async resolveAttachmentContent(
    id: string,
    scope: { threadId: string; workspace: string }
  ): Promise<AttachmentContent> {
    const legacyUpload = await this.resolveLegacyThreadUpload(id, scope.threadId)
    if (legacyUpload) return legacyUpload
    if (this.deps.attachmentStore) {
      return this.deps.attachmentStore.resolveContent(id, {
        threadId: scope.threadId,
        workspace: scope.workspace
      })
    }
    throw new Error('attachment store is unavailable')
  }

  private async resolveLegacyThreadUpload(
    id: string,
    threadId: string
  ): Promise<AttachmentContent | null> {
    if (!this.deps.runtimeDataDir) return null
    if (!id.startsWith('/mnt/qiongqi/uploads/')) return null
    const requestedName = id.slice('/mnt/qiongqi/uploads/'.length)
    const filename = basename(requestedName)
    if (!filename || filename !== requestedName) return null
    const absolutePath = join(this.deps.runtimeDataDir, 'threads', threadId, 'uploads', filename)
    const fileStat = await stat(absolutePath).catch(() => null)
    if (!fileStat?.isFile()) return null
    const data = await readFile(absolutePath)
    const now = this.deps.nowIso()
    return {
      id,
      name: filename,
      mimeType: mimeTypeForUpload(filename),
      byteSize: fileStat.size,
      hash: id,
      threadIds: [threadId],
      workspaces: [],
      createdAt: now,
      updatedAt: now,
      data
    }
  }

  private async retrieveMemories(input: {
    prompt: string
    workspace: string
    threadId: string
    ownerUserId?: string
  }) {
    if (!this.deps.memoryStore) return []
    const memories = await this.deps.memoryStore.retrieve({
      query: input.prompt,
      workspace: input.workspace,
      threadId: input.threadId,
      ownerUserId: input.ownerUserId,
      limit: 8
    })
    this.deps.memoryStore.setLastInjected(memories.map((memory) => memory.id))
    return memories
  }

  private recordToolCatalogFingerprint(input: {
    ownerUserId: string
    threadId: string
    workspace: string
    mode: string
    model: string
    activeSkillIds: readonly string[]
    allowedToolNames?: readonly string[]
    fingerprint: string
    toolNames: string[]
    toolHashes: Record<string, string>
  }): ToolCatalogDrift {
    const key = JSON.stringify({
      ownerUserId: input.ownerUserId,
      threadId: input.threadId,
      workspace: input.workspace,
      mode: input.mode,
      model: input.model,
      activeSkillIds: [...input.activeSkillIds].sort(),
      allowedToolNames: input.allowedToolNames ? [...input.allowedToolNames].sort() : []
    })
    const current: ToolCatalogSnapshot = {
      fingerprint: input.fingerprint,
      toolNames: input.toolNames,
      toolHashes: input.toolHashes
    }
    const previous = this.toolCatalogSnapshots.get(key)
    this.toolCatalogSnapshots.set(key, current)
    if (!previous || previous.fingerprint === input.fingerprint) return { kind: 'none' }
    return isAdditiveToolCatalogChange(previous, current)
      ? { kind: 'additive', previous }
      : { kind: 'breaking', previous }
  }

  private async checkBudgetGate(
    thread: ThreadRecord,
    threadId: string,
    turnId: string
  ): Promise<'allow' | 'blocked'> {
    if (!thread) return 'allow'
    const budget = thread.costBudgetUsd
    if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) return 'allow'
    const spent = this.deps.usage.forThread(threadId).costUsd ?? 0
    if (spent >= budget) {
      const message = `Cost budget exhausted for this thread: $${spent.toFixed(4)} used of $${budget.toFixed(4)}.`
      await this.deps.turns.applyItem(threadId, makeErrorItem({
        id: `item_${turnId}_budget_limited`,
        threadId,
        turnId,
        message,
        code: 'budget_limited'
      }))
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'budget_limited'
      })
      return 'blocked'
    }
    if (spent >= budget * 0.8 && thread.costBudgetWarningSent !== true) {
      const message = `Cost budget warning: $${spent.toFixed(4)} used of $${budget.toFixed(4)}.`
      await this.deps.threadStore.upsert({
        ...thread,
        costBudgetWarningSent: true,
        updatedAt: this.deps.nowIso()
      })
      await this.deps.turns.applyItem(threadId, makeErrorItem({
        id: `item_${turnId}_budget_warning`,
        threadId,
        turnId,
        message,
        code: 'budget_warning',
        severity: 'warning'
      }))
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'budget_warning',
        severity: 'warning'
      })
    }
    return 'allow'
  }

  private consumePromptPressure(
    scope: PromptRuntimeScope,
    model: string
  ): { model: string; promptTokens: number } | undefined {
    const key = promptScopeKey(scope)
    const pressure = this.promptTokenPressure.get(key)
    if (!pressure) return undefined
    this.promptTokenPressure.delete(key)
    return {
      model: pressure.model || model,
      promptTokens: pressure.promptTokens
    }
  }

  private async compactIfNeeded(
    items: TurnItem[],
    model: string,
    signal: AbortSignal,
    context: PromptRuntimeScope,
    persistedState?: unknown,
    forceCompaction = false
  ): Promise<{ items: TurnItem[]; state: CompactionGovernorState }> {
    const restoredState = parseCompactionGovernorState(persistedState)
    const pressure = this.consumePromptPressure(context, model)
    const thresholdModel = pressure?.model || model
    const plan = forceCompaction
      ? {
          mode: 'force' as const,
          keepRecent: 1,
          reason: 'provider context capacity exceeded; forced history compaction'
        }
      : this.deps.compactor.planCompaction(items, { model: thresholdModel, promptTokens: pressure?.promptTokens })
    if (!plan) return { items, state: restoredState ?? new CompactionGovernor().snapshot() }
    const key = promptScopeKey(context)
    const local = persistedState === undefined
      ? (this.classicCompactionGovernors.get(key) ?? { governor: new CompactionGovernor(), step: 0 })
      : undefined
    const governor = local?.governor ?? new CompactionGovernor({}, restoredState)
    const step = local ? ++local.step : governor.nextStep()
    if (local) this.classicCompactionGovernors.set(key, local)
    const compactableTokens = this.deps.compactor.estimate(items)
    const summaryTokens = Math.max(64, Math.floor(compactableTokens * 0.25))
    const decision = governor.decide({
      step,
      fixedTokens: Math.max((pressure?.promptTokens ?? 0) - compactableTokens, 0),
      compactableTokens,
      summaryTokens,
      historyItems: items.length,
      summaryOnly: items.length > 0 && items.every((item) => item.kind === 'compaction')
    })
    if (decision.action === 'skip') return { items, state: governor.snapshot() }
    const threadId = context.threadId
    const turnId = context.turnId
    if (this.deps.taskStates) {
      const thread = await this.deps.threadStore.get(threadId)
      const identity = thread ? {
        ownerUserId: thread.ownerUserId ?? 'local-default-owner',
        workspaceKey: thread.workspace,
        threadId,
        turnId,
        runId: `run_${threadId}_${turnId}`
      } : undefined
      const taskState = identity
        ? await this.deps.taskStates.load(identity)
        : undefined
      if (identity && taskState) {
        const transaction = new CompactionTransaction({
          taskStates: this.deps.taskStates,
          sessionStore: this.deps.sessionStore,
          compactor: this.deps.compactor,
          nowIso: this.deps.nowIso
        })
        const result = await transaction.compact({
          identity,
          taskState,
          history: items,
          prefix: this.deps.prefix,
          reason: plan.reason,
          mode: plan.mode,
          keepRecent: plan.keepRecent,
          ...(this.deps.contextCompaction?.summaryMode === 'model'
            ? {
                summarize: (heuristicSummary: string) => this.summarizeCompactionWithModel({
                  threadId,
                  turnId,
                  model,
                  items,
                  heuristicSummary,
                  signal
                })
              }
            : {})
        })
        if (signal.aborted) return { items, state: governor.snapshot() }
        if (result.replacedTokens > 0) {
          governor.commit({ step, summaryDigest: result.summaryItem.id })
          this.deps.toolHost.clearReadTracker?.(threadId)
          await this.recordCompactionCompleted(threadId, turnId, result)
        }
        return { items: result.next, state: governor.snapshot() }
      }
    }
    let result = this.deps.compactor.compact({
      threadId,
      turnId,
      history: items,
      prefix: this.deps.prefix,
      reason: plan.reason,
      mode: plan.mode,
      keepRecent: plan.keepRecent
    })
    if (result.replacedTokens > 0 && this.deps.contextCompaction?.summaryMode === 'model') {
      const modelSummary = await this.summarizeCompactionWithModel({
        threadId,
        turnId,
        model,
        items,
        heuristicSummary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
        signal
      })
      if (signal.aborted) return { items, state: governor.snapshot() }
      if (modelSummary) {
        result = this.deps.compactor.compact({
          threadId,
          turnId,
          history: items,
          prefix: this.deps.prefix,
          reason: plan.reason,
          mode: plan.mode,
          keepRecent: plan.keepRecent,
          summaryOverride: modelSummary
        })
      }
    }
    if (result.replacedTokens > 0) {
      governor.commit({ step, summaryDigest: result.summaryItem.id })
      this.deps.toolHost.clearReadTracker?.(threadId)
      await this.deps.sessionStore.appendItem(threadId, result.summaryItem)
      await this.recordCompactionCompleted(threadId, turnId, result)
    }
    return { items: result.next, state: governor.snapshot() }
  }

  private async recordCompactionCompleted(
    threadId: string,
    turnId: string,
    result: {
      summaryItem: TurnItem
      replacedTokens: number
    }
  ): Promise<void> {
    await this.deps.events.record({
      kind: 'compaction_completed',
      threadId,
      turnId,
      itemId: result.summaryItem.id,
      summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
      replacedTokens: result.replacedTokens,
      pinnedConstraints: this.deps.prefix.pinnedConstraints,
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceDigest
        ? { sourceDigest: result.summaryItem.sourceDigest }
        : {}),
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.digestMarker
        ? { digestMarker: result.summaryItem.digestMarker }
        : {}),
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceItemIds
        ? { sourceItemIds: result.summaryItem.sourceItemIds }
        : {})
    })
  }

  private async summarizeCompactionWithModel(input: {
    threadId: string
    turnId: string
    model: string
    items: TurnItem[]
    heuristicSummary: string
    signal: AbortSignal
  }): Promise<string | undefined> {
    if (input.signal.aborted) return undefined
    const timeoutMs = Math.max(
      1,
      Math.floor(this.deps.contextCompaction?.summaryTimeoutMs ?? DEFAULT_COMPACTION_SUMMARY_TIMEOUT_MS)
    )
    const controller = new AbortController()
    const onAbort = (): void => controller.abort()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    input.signal.addEventListener('abort', onAbort, { once: true })
    let fallbackRecorded = false
    const recordFallback = async (message: string): Promise<void> => {
      if (fallbackRecorded || input.signal.aborted) return
      fallbackRecorded = true
      await this.deps.events.record({
        kind: 'error',
        threadId: input.threadId,
        turnId: input.turnId,
        message,
        code: 'compaction_summary_fallback',
        severity: 'warning'
      })
    }
    try {
      const requestItem = makeUserItem({
        id: `item_${input.turnId}_compaction_summary_request`,
        turnId: input.turnId,
        threadId: input.threadId,
        text: buildModelCompactionPrompt({
          items: input.items,
          heuristicSummary: input.heuristicSummary,
          maxBytes: this.deps.contextCompaction?.summaryInputMaxBytes ?? DEFAULT_COMPACTION_SUMMARY_INPUT_MAX_BYTES
        })
      })
      let text = ''
      for await (const chunk of this.deps.model.stream({
        threadId: input.threadId,
        turnId: input.turnId,
        model: input.model,
        systemPrompt: this.deps.prefix.systemPrompt,
        contextInstructions: [
          'Summarize context for a history fold. Preserve durable task state and omit transient chatter.'
        ],
        prefix: this.deps.prefix.fewShots,
        history: [requestItem],
        tools: [],
        stream: true,
        maxTokens: Math.max(
          1,
          Math.floor(this.deps.contextCompaction?.summaryMaxTokens ?? DEFAULT_COMPACTION_SUMMARY_MAX_TOKENS)
        ),
        temperature: 0,
        reasoningEffort: 'off',
        abortSignal: controller.signal
      })) {
        if (input.signal.aborted) return undefined
        if (controller.signal.aborted) {
          await recordFallback(
            `Model compaction summary timed out after ${timeoutMs}ms; using heuristic summary.`
          )
          return undefined
        }
        if (chunk.kind === 'assistant_text_delta') text += chunk.text
        if (chunk.kind === 'usage') {
          const usage = this.deps.usage.record(input.threadId, chunk.usage)
          await this.deps.events.record({
            kind: 'usage',
            threadId: input.threadId,
            turnId: input.turnId,
            model: input.model,
            usage
          })
        }
        if (chunk.kind === 'error') {
          await recordFallback(
            `Model compaction summary failed${chunk.code ? ` (${chunk.code})` : ''}: ${chunk.message}. Using heuristic summary.`
          )
          return undefined
        }
      }
      const summary = text.trim()
      if (!summary) {
        await recordFallback('Model compaction summary returned empty text; using heuristic summary.')
        return undefined
      }
      return summary ? summary : undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const reason = controller.signal.aborted && !input.signal.aborted
        ? `Model compaction summary timed out after ${timeoutMs}ms`
        : `Model compaction summary threw: ${message}`
      await recordFallback(`${reason}; using heuristic summary.`)
      return undefined
    } finally {
      clearTimeout(timeout)
      input.signal.removeEventListener('abort', onAbort)
    }
  }
}

function fallbackWorkModeInfo(workModeId: string | undefined): WorkModeInfo | undefined {
  if (!workModeId) return undefined
  return { id: workModeId, name: workModeId }
}

function mimeTypeForUpload(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case '.txt':
      return 'text/plain'
    case '.md':
    case '.markdown':
      return 'text/markdown'
    case '.csv':
      return 'text/csv'
    case '.html':
    case '.htm':
      return 'text/html'
    case '.json':
      return 'application/json'
    case '.pdf':
      return 'application/pdf'
    case '.zip':
      return 'application/zip'
    case '.doc':
      return 'application/msword'
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.xls':
      return 'application/vnd.ms-excel'
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case '.ppt':
      return 'application/vnd.ms-powerpoint'
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function currentWorkModeInstruction(workMode: WorkModeInfo | undefined): string | undefined {
  if (!workMode) return undefined
  return [
    'Current Work Mode:',
    `- id: ${workMode.id}`,
    `- name: ${workMode.name}`,
    ...(workMode.description ? [`- description: ${workMode.description}`] : []),
    'Treat this as the user-selected work mode and single-agent runtime for this turn. Its bound skills and task orchestration define how this qiongqi classic-mode step should run. If asked about the current work mode, answer from this runtime context instead of searching workspace files.'
  ].join('\n')
}

function isRuntimeCatalogQuestion(prompt: string): boolean {
  const text = prompt.trim().toLowerCase()
  if (!text) return false
  const compact = text.replace(/\s+/g, '')
  const asksWorkMode =
    (/\bwork\s*mode\b/.test(text) &&
      /\b(what|which|current|selected|using|am i|where)\b/.test(text)) ||
    (/工作模式|当前模式|运行模式/.test(compact) &&
      /当前|现在|哪种|哪个|什么|处于|使用|所在/.test(compact))
  const asksSkills =
    (/\bskills?\b/.test(text) &&
      /\b(what|which|available|installed|enabled|call|use|using|can)\b/.test(text)) ||
    (/技能/.test(compact) && /有哪些|可用|安装|启用|调用|使用|能用|识别/.test(compact))
  const asksTools =
    (/\btools?\b/.test(text) &&
      /\b(what|which|available|enabled|call|use|using|can)\b/.test(text)) ||
    (/工具/.test(compact) && /有哪些|可用|启用|调用|使用|能用|识别/.test(compact))
  return asksWorkMode || asksSkills || asksTools
}
