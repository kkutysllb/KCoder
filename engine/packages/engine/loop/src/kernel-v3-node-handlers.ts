import type {
  ModelProposal,
  RunOutcome,
  TaskStateV1,
  TaskToolLedgerEntry,
  ToolObservation,
  ToolEffectPolicy,
  TurnItem
} from '@qiongqi/contracts'
import { ModelProposalSchema } from '@qiongqi/contracts'
import { makeAssistantReasoningItem, makeAssistantTextItem, makeToolCallItem, makeToolResultItem } from '@qiongqi/domain'
import type {
  IdGenerator,
  SessionStore,
  TaskStateStore,
  ThreadStore,
  ToolCallLike,
  ToolHostContext
} from '@qiongqi/ports'
import type { TurnService } from '@qiongqi/services'
import type { ModelProposalRunner } from './model-proposal-runner.js'
import type { PromptBuilder } from './prompt-builder.js'
import type { RuntimeNodeHandler } from './runtime-kernel-context.js'
import type { ToolRuntimeV3 } from './tool-runtime-v3.js'
import { classifyProposal, type ProposalClass } from './proposal-classifier.js'
import { materializableProposalContent } from './proposal-materializer.js'
import { renderRecoveryContinuationEntry, transitionContextRecovery } from './context-recovery.js'
import { migrateLegacyTaskState } from './legacy-task-state-migrator.js'
import { digestValue } from './effect-commit.js'
import { projectTaskState } from './task-progress-projector.js'
import { isRecoverableToolDispatchError } from './tool-dispatch-errors.js'
import { observeTool } from './tool-observation.js'

export type KernelV3NodeDependencies = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  taskStates: TaskStateStore
  turns: Pick<
    TurnService,
    | 'getTurn'
    | 'getAbortController'
    | 'applyItem'
    | 'applyItemOnce'
    | 'updateItem'
    | 'updateItemOnce'
  >
  promptBuilder: Pick<PromptBuilder, 'build'>
  proposalRunner: Pick<ModelProposalRunner, 'run'>
  toolRuntime: Pick<ToolRuntimeV3, 'execute'>
  createToolContext: (
    identity: Parameters<RuntimeNodeHandler>[0]['identity'],
    state: Parameters<RuntimeNodeHandler>[0]['state']
  ) => Promise<ToolHostContext> | ToolHostContext
  ids: Pick<IdGenerator, 'next'>
  nowIso: () => string
  emitRuntimeProgress?: boolean
}

type StoredRequest = Omit<Parameters<ModelProposalRunner['run']>[0], 'abortSignal'>

export function createKernelV3NodeHandlers(
  deps: KernelV3NodeDependencies
): Record<string, RuntimeNodeHandler> {
  const materializeProposal = async (
    identity: Parameters<RuntimeNodeHandler>[0]['identity'],
    proposal: ModelProposal
  ): Promise<void> => {
    const content = materializableProposalContent(proposal)
    if (content.reasoning) {
      await deps.turns.applyItemOnce(identity.threadId, makeAssistantReasoningItem({
        id: `item_kernel_reasoning_${proposal.proposalId}`,
        threadId: identity.threadId,
        turnId: identity.turnId,
        text: content.reasoning,
        status: 'completed'
      }))
    }
    if (content.text) {
      await deps.turns.applyItemOnce(identity.threadId, makeAssistantTextItem({
        id: `item_kernel_text_${proposal.proposalId}`,
        threadId: identity.threadId,
        turnId: identity.turnId,
        text: content.text,
        status: 'completed'
      }))
    }
  }

  return {
    'prepare-turn': async ({ identity }) => {
      const [thread, turn] = await Promise.all([
        deps.threadStore.get(identity.threadId),
        deps.turns.getTurn(identity.threadId, identity.turnId)
      ])
      if (!thread || !turn) {
        return { outcome: failedOutcome('turn or thread not found') }
      }
      await emitProgress(deps, identity, {
        phase: 'preparing', summary: 'Preparing the task state and execution context.', modelSteps: 0, toolCalls: 0,
        evidenceCount: 0, artifactCount: 0
      })
      const owner = thread.ownerUserId ?? 'local-default-owner'
      if (
        owner !== identity.ownerUserId
        || thread.workspace !== identity.workspaceKey
        || turn.threadId !== identity.threadId
      ) {
        return { outcome: failedOutcome('turn scope mismatch') }
      }
      const signal = deps.turns.getAbortController(identity.turnId)
      if (signal?.aborted) {
        return { outcome: { status: 'aborted', reason: 'user_aborted', retryable: false } }
      }
      return {
        condition: 'next',
        value: {
          ownerUserId: owner,
          workspace: thread.workspace,
          turnStatus: turn.status
        }
      }
    },

    'restore-task': async ({ identity }) => {
      let task = await deps.taskStates.load(identity)
      if (!task) {
        const [thread, items] = await Promise.all([
          deps.threadStore.get(identity.threadId),
          deps.sessionStore.loadItems(identity.threadId)
        ])
        if (!thread) return { outcome: failedOutcome('thread not found during task restore') }
        const migrated = await migrateLegacyTaskState({
          identity,
          thread,
          items,
          store: deps.taskStates,
          nowIso: deps.nowIso
        })
        if (migrated.kind !== 'created' && migrated.kind !== 'existing') {
          return {
            outcome: {
              status: 'failed',
              reason: 'required_action_missing',
              retryable: false,
              details: { code: migrated.kind, reason: migrated.reason }
            }
          }
        }
        task = migrated.state
      }
      return {
        condition: 'next',
        value: task,
        commands: [{ type: 'set-task-revision', revision: task.revision }]
      }
    },

    'build-context': async ({ identity, state }) => {
      const signal = deps.turns.getAbortController(identity.turnId)
      if (!signal || signal.aborted) {
        return { outcome: { status: 'aborted', reason: 'user_aborted', retryable: false } }
      }
      const built = await deps.promptBuilder.build({
        threadId: identity.threadId,
        turnId: identity.turnId,
        signal,
        stepIndex: state.cursor.stepIndex,
        compactionGovernorState: state.middleware['compaction-governor']?.data,
        forceCompaction: nodeValue<boolean>(state, 'force-context-compaction') === true
      })
      if (built.kind === 'aborted') {
        return { outcome: { status: 'aborted', reason: 'user_aborted', retryable: false } }
      }
      if (built.kind !== 'built') return { outcome: failedOutcome('prompt build stopped') }
      const { abortSignal: _abortSignal, ...request } = built.ctx.request
      const recovery = nodeValue<{ entry?: string }>(state, 'recover-context')
      const storedRequest: StoredRequest = recovery?.entry
        ? {
            ...request,
            contextInstructions: [
              ...(request.contextInstructions ?? []),
              recovery.entry
            ]
          }
        : request
      const toolPolicies = Object.fromEntries(
        (built.ctx.request.tools as Array<Record<string, unknown>>).map((tool) => [
          String(tool.name),
          isToolEffectPolicy(tool.effectPolicy) ? tool.effectPolicy : undefined
        ])
      )
      return {
        condition: 'next',
        value: {
          request: storedRequest,
          toolPolicies,
          runtimeContext: {
            activeSkillIds: built.ctx.activeSkillIds,
            allowedToolNames: built.ctx.allowedToolNames,
            modelCapabilities: built.ctx.modelCapabilities,
            approvalPolicy: built.ctx.approvalPolicy,
            threadMode: built.ctx.effectiveMode,
            workModeId: built.ctx.workModeId,
            guiPlan: built.ctx.activePlanContext
          }
        },
        commands: [
          ...(built.ctx.compactionGovernorState
            ? [{
                type: 'set-middleware-state' as const,
                id: 'compaction-governor',
                state: { version: 1, data: built.ctx.compactionGovernorState }
              }]
            : []),
          ...(nodeValue<boolean>(state, 'force-context-compaction') === true
            ? [{ type: 'set-node-data' as const, nodeId: 'force-context-compaction', value: false }]
            : [])
        ]
      }
    },

    'invoke-model': async ({ identity, state }) => {
      const built = requireNodeValue<{ request: StoredRequest }>(state, 'build-context')
      const signal = deps.turns.getAbortController(identity.turnId)
      if (!signal || signal.aborted) {
        return { outcome: { status: 'aborted', reason: 'user_aborted', retryable: false } }
      }
      let proposal: ModelProposal
      try {
        proposal = await deps.proposalRunner.run({ ...built.request, abortSignal: signal })
      } catch (error) {
        if (signal.aborted) {
          return { outcome: { status: 'aborted', reason: 'user_aborted', retryable: false } }
        }
        if (state.recovery.attempts < state.recovery.maxAttempts) {
          return {
            condition: 'recover',
            commands: [{
              type: 'set-recovery',
              recovery: {
                ...state.recovery,
                attempts: state.recovery.attempts + 1,
                lastReason: 'model_stream_error'
              }
            }]
          }
        }
        return {
          outcome: failedOutcome(
            `model invocation failed: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      if (isContextCapacityProposal(proposal)) {
        if (state.recovery.attempts < state.recovery.maxAttempts) {
          return {
            condition: 'recover',
            value: proposal,
            commands: [{
              type: 'set-recovery',
              recovery: {
                ...state.recovery,
                attempts: state.recovery.attempts + 1,
                lastReason: 'context_capacity_exceeded'
              }
            }, {
              type: 'set-node-data',
              nodeId: 'force-context-compaction',
              value: true
            }]
          }
        }
        await emitProgress(deps, identity, {
          phase: 'terminated',
          summary: 'The model context capacity was reached; the run stopped after preserving the current task state.',
          modelSteps: state.budgets.stepsUsed,
          toolCalls: state.budgets.toolCallsUsed,
          reason: 'context_capacity_exceeded'
        })
        return {
          outcome: {
            status: 'degraded',
            reason: 'context_capacity_exceeded',
            retryable: true,
            details: { providerReason: proposal.providerReason }
          }
        }
      }
      return { condition: 'next', value: proposal }
    },

    'normalize-proposal': ({ state }) => ({
      condition: 'next',
      value: ModelProposalSchema.parse(requireNodeValue(state, 'invoke-model'))
    }),

    'account-model': ({ state }) => {
      const task = requireNodeValue<TaskStateV1>(state, 'restore-task')
      const proposal = ModelProposalSchema.parse(requireNodeValue(state, 'normalize-proposal'))
      const proposalClass = classifyProposal({ proposal, task })
      const inputTokens = proposal.usage?.promptTokens ?? 0
      const outputTokens = proposal.usage?.completionTokens ?? 0
      const costUsd = proposal.usage?.costUsd ?? 0
      const v2Migration = nodeValue<{
        resumeNodeId: string
        consumed: boolean
      }>(state, 'v2-accounting-migration')
      const v1Migration = nodeValue<{
        resumeNodeId: string
        consumed: boolean
      }>(state, 'v1-accounting-migration')
      const migration = v2Migration && !v2Migration.consumed
        ? { nodeId: 'v2-accounting-migration', value: v2Migration }
        : v1Migration && !v1Migration.consumed
          ? { nodeId: 'v1-accounting-migration', value: v1Migration }
          : undefined
      const migrationCommands = migration
        ? [
            {
              type: 'set-node-data' as const,
              nodeId: migration.nodeId,
              value: { ...migration.value, consumed: true }
            },
            {
              type: 'jump' as const,
              nodeId: migration.value.resumeNodeId,
              condition: 'next',
              reason: 'resume migrated production graph after model accounting'
            }
          ]
        : []
      return {
        condition: 'next',
        commands: [
          {
            type: 'add-budget',
            usageId: `model:${proposal.proposalId}`,
            delta: { stepsUsed: 1, inputTokens, outputTokens, costUsd }
          },
          ...migrationCommands
        ],
        facts: {
          proposalClass,
          stopClass: proposal.stopClass,
          ...(proposal.providerReason ? { providerReason: proposal.providerReason } : {}),
          inputTokens,
          outputTokens,
          costUsd,
          proposalHasText: proposal.text.trim().length > 0,
          hadToolResult: task.toolLedger.length > 0
        }
      }
    },

    evaluate: async ({ identity, state }) => {
      const task = requireNodeValue<TaskStateV1>(state, 'restore-task')
      const proposal = ModelProposalSchema.parse(requireNodeValue(state, 'normalize-proposal'))
      const proposalClass = classifyProposal({ proposal, task })
      const migration = nodeValue<{
        sourceNodeId: string
        preparedCallIds: string[]
        reconciled: boolean
        abortFinishedAt: string
      }>(state, 'v1-proposal-migration')
      const migrationCommands = migration && !migration.reconciled
        ? [{
            type: 'set-node-data' as const,
            nodeId: 'v1-proposal-migration',
            value: { ...migration, reconciled: true }
          }]
        : []
      if (migration && !migration.reconciled && proposalClass !== 'tool_intents') {
        for (const callId of migration.preparedCallIds) {
          await deps.turns.updateItemOnce(
            identity.threadId,
            `item_tool_${identity.turnId}_${callId}`,
            { status: 'aborted', finishedAt: migration.abortFinishedAt }
          )
        }
      }
      if (proposalClass === 'tool_intents') {
        return {
          condition: 'tools',
          value: { proposalClass, action: 'tools' },
          commands: migrationCommands
        }
      }
      if (
        proposalClass === 'context_discontinuity'
        || proposalClass === 'nonterminal_action'
        || proposalClass === 'empty'
        || proposalClass === 'length_limited'
        || proposalClass === 'protocol_error'
      ) {
        const transition = transitionContextRecovery({
          task,
          recovery: state.recovery,
          proposalClass
        })
        if (transition.action === 'degrade') {
          return {
            value: { proposalClass, action: 'degrade' },
            outcome: transition.outcome,
            commands: [
              ...migrationCommands,
              { type: 'set-recovery', recovery: transition.recovery } as const
            ]
          }
        }
        return {
          condition: 'recover',
          value: { proposalClass, action: 'recover' },
          commands: [
            ...migrationCommands,
            { type: 'set-recovery', recovery: transition.recovery } as const
          ]
        }
      }
      if (proposalClass === 'safety_or_refusal') {
        return {
          condition: 'fatal',
          value: { proposalClass, action: 'fatal' },
          commands: migrationCommands
        }
      }
      return {
        condition: 'final',
        value: { proposalClass, action: 'final' },
        commands: migrationCommands
      }
    },

    'commit-assistant': async ({ identity, state }) => {
      const proposal = ModelProposalSchema.parse(requireNodeValue(state, 'normalize-proposal'))
      await materializeProposal(identity, proposal)
      await emitProgress(deps, identity, {
        phase: 'terminated', summary: 'Task response completed.', modelSteps: state.budgets.stepsUsed, toolCalls: state.budgets.toolCallsUsed,
        reason: 'normal_stop'
      })
      return {
        value: { proposalId: proposal.proposalId },
        outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
      }
    },

    'materialize-proposal': async ({ identity, state }) => {
      const proposal = ModelProposalSchema.parse(requireNodeValue(state, 'normalize-proposal'))
      await materializeProposal(identity, proposal)
      return { condition: 'next', value: { proposalId: proposal.proposalId } }
    },

    'prepare-tools': async ({ identity, state }) => {
      const proposal = ModelProposalSchema.parse(requireNodeValue(state, 'normalize-proposal'))
      const task = requireNodeValue<TaskStateV1>(state, 'restore-task')
      const ledgerCallIds = new Set(task.toolLedger.map((entry) => entry.callId))
      const calls: ToolCallLike[] = proposal.toolIntents.map((intent) => ({
        callId: intent.callId,
        toolName: intent.toolName,
        arguments: intent.arguments
      }))
      for (const call of calls) {
        await deps.turns.applyItemOnce(identity.threadId, makeToolCallItem({
          id: `item_tool_${identity.turnId}_${call.callId}`,
          threadId: identity.threadId,
          turnId: identity.turnId,
          callId: call.callId,
          toolName: call.toolName,
          arguments: call.arguments,
          status: 'running'
        }))
      }
      const unledgeredCallIds = calls
        .filter((call) => !ledgerCallIds.has(call.callId))
        .map((call) => call.callId)
      return {
        condition: 'next',
        value: { calls },
        commands: unledgeredCallIds.length > 0
          ? [{
              type: 'add-budget' as const,
              usageId: `tools:${digestValue({
                proposalId: proposal.proposalId,
                callIds: unledgeredCallIds
              })}`,
              delta: { toolCallsUsed: unledgeredCallIds.length }
            }]
          : []
      }
    },

    'commit-tools': async ({ identity, state, leaseFence }) => {
      const prepared = requireNodeValue<{ calls: ToolCallLike[] }>(state, 'prepare-tools')
      const built = requireNodeValue<{
        toolPolicies?: Record<string, ToolEffectPolicy | undefined>
      }>(state, 'build-context')
      let runtimeState = state
      const ledger: TaskToolLedgerEntry[] = []
      const observations: ToolObservation[] = []
      const toolContext = await deps.createToolContext(identity, state)
      for (const call of prepared.calls) {
        let execution: Awaited<ReturnType<ToolRuntimeV3['execute']>>
        try {
          execution = await deps.toolRuntime.execute({
            identity,
            state: runtimeState,
            call,
            context: {
              ...toolContext,
              runtimeIdentity: identity,
              runtimeState,
              runtimeStateSink: (next) => { runtimeState = next }
            },
            policy: built.toolPolicies?.[call.toolName] ?? defaultEffectPolicy(call),
            leaseFence
          })
        } catch (error) {
          if (!isRecoverableToolDispatchError(error)) throw error
          const message = error instanceof Error ? error.message : String(error)
          const policy = built.toolPolicies?.[call.toolName] ?? defaultEffectPolicy(call)
          const item = makeToolResultItem({
            id: `item_${call.callId}`,
            turnId: identity.turnId,
            threadId: identity.threadId,
            callId: call.callId,
            toolName: call.toolName,
            toolKind: call.toolKind,
            output: {
              code: 'tool_dispatch_rejected',
              error: message,
              guidance: 'Use only tools advertised in the current turn context.'
            },
            isError: true,
            status: 'failed',
            finishedAt: deps.nowIso()
          })
          await deps.turns.updateItem(identity.threadId, `item_tool_${identity.turnId}_${call.callId}`, {
            status: 'failed',
            finishedAt: deps.nowIso()
          } as Partial<TurnItem>)
          await deps.turns.applyItem(identity.threadId, item)
          observations.push(observeTool({
            call,
            result: { item, approved: false },
            context: toolContext,
            policy,
            replayed: false
          }))
          ledger.push({
            callId: call.callId,
            toolName: call.toolName,
            status: 'failed',
            resultDigest: digestValue(item.kind === 'tool_result' ? item.output : item)
          })
          continue
        }
        runtimeState = execution.state
        if (execution.outcome) return { outcome: execution.outcome }
        if (!execution.result) return { outcome: failedOutcome(`tool result missing: ${call.callId}`) }
        if (execution.observation) observations.push(execution.observation)
        await deps.turns.updateItem(identity.threadId, `item_tool_${identity.turnId}_${call.callId}`, {
          status: execution.result.item.kind === 'tool_result' && execution.result.item.isError
            ? 'failed'
            : 'completed',
          finishedAt: deps.nowIso()
        } as Partial<TurnItem>)
        await deps.turns.applyItem(identity.threadId, execution.result.item)
        const failed = execution.result.item.kind === 'tool_result' && execution.result.item.isError
        ledger.push({
          callId: call.callId,
          toolName: call.toolName,
          status: failed ? 'failed' : 'committed',
          resultDigest: digestValue(
            execution.result.item.kind === 'tool_result'
              ? execution.result.item.output
              : execution.result.item
          )
        })
      }

      const current = await deps.taskStates.load(identity)
      if (!current) return { outcome: failedOutcome('task state missing after tools') }
      const nextTask = updateTaskLedger(current, ledger, deps.nowIso())
      const revision = await deps.taskStates.prepare(nextTask, current.revision)
      await deps.taskStates.commit(revision)
      return {
        condition: 'tools_committed',
        value: { callIds: ledger.map((entry) => entry.callId), taskRevision: nextTask.revision, observations },
        commands: [
          { type: 'set-task-revision', revision: nextTask.revision },
          { type: 'set-node-data', nodeId: 'restore-task', value: nextTask },
          {
            type: 'set-effects',
            pendingEffects: runtimeState.pendingEffects,
            committedEffects: runtimeState.committedEffects
          }
        ]
      }
    },

    'project-progress': async ({ identity, state }) => {
      const task = requireNodeValue<TaskStateV1>(state, 'restore-task')
      const commit = requireNodeValue<{ observations?: ToolObservation[] }>(state, 'commit-tools')
      const thread = await deps.threadStore.get(identity.threadId)
      const projection = projectTaskState(task, {
        todos: thread?.todos?.items?.map((todo) => ({ id: todo.id, content: todo.content, status: todo.status })),
        observations: commit.observations ?? [],
        nowIso: deps.nowIso
      })
      await emitProgress(deps, identity, {
        phase: 'executing',
        summary: projection.digest.level === 'none' ? 'Executing the next task action.' : 'New evidence or task progress recorded.',
        modelSteps: state.budgets.stepsUsed,
        toolCalls: state.budgets.toolCallsUsed,
        evidenceCount: projection.state.progress?.evidenceCount ?? 0,
        artifactCount: projection.state.artifacts.length
      })
      if (projection.digest.level !== 'none') {
        const prepared = await deps.taskStates.prepare(projection.state, task.revision)
        try {
          await deps.taskStates.commit(prepared)
        } catch (error) {
          await deps.taskStates.abort(prepared).catch(() => undefined)
          throw error
        }
      }
      return {
        condition: 'next',
        value: projection.state,
        facts: {
          observations: commit.observations ?? [],
          progressLevel: projection.digest.level,
          progressDigest: projection.digest.value,
          evidenceCount: projection.state.progress?.evidenceCount ?? 0,
          artifactCount: projection.state.artifacts.length
        },
        commands: projection.digest.level === 'none'
          ? []
          : [
              { type: 'set-task-revision' as const, revision: projection.state.revision },
              { type: 'set-node-data' as const, nodeId: 'restore-task', value: projection.state }
            ]
      }
    },

    'govern-progress': () => ({ condition: 'progress_checked', value: { checked: true } }),

    'progress-checkpoint': async ({ identity, state }) => {
      await emitProgress(deps, identity, {
        phase: 'checkpoint',
        summary: 'A progress checkpoint was reached; the next model step must summarize existing evidence or finish.',
        modelSteps: state.budgets.stepsUsed,
        toolCalls: state.budgets.toolCallsUsed,
        reason: 'no_progress_window'
      })
      return {
        condition: 'checkpointed',
        value: {
          taskRevision: requireNodeValue<TaskStateV1>(state, 'restore-task').revision,
          message: 'Checkpointed after a no-progress window; summarize existing evidence before taking another action.'
        },
        facts: { checkpointCompleted: true }
      }
    },

    'recover-context': ({ state }) => {
      const task = requireNodeValue<TaskStateV1>(state, 'restore-task')
      return {
        condition: 'recovered',
        value: { entry: renderRecoveryContinuationEntry(task) }
      }
    },

    'wait-user': () => ({
      outcome: {
        status: 'suspended',
        reason: 'awaiting_user_input',
        retryable: true
      }
    }),

    fail: ({ state }) => {
      const evaluation = nodeValue<{ proposalClass?: ProposalClass }>(state, 'evaluate')
      const safety = evaluation?.proposalClass === 'safety_or_refusal'
      return {
        outcome: {
          status: 'failed',
          reason: safety ? 'provider_safety_stop' : 'provider_protocol_error',
          retryable: !safety
        }
      }
    }
  }
}

function nodeValue<T>(state: { nodeData: Record<string, unknown> }, nodeId: string): T | undefined {
  return state.nodeData[nodeId] as T | undefined
}

function requireNodeValue<T>(state: { nodeData: Record<string, unknown> }, nodeId: string): T {
  const value = nodeValue<T>(state, nodeId)
  if (value === undefined) throw new Error(`kernel node data missing: ${nodeId}`)
  return value
}

function failedOutcome(message: string): RunOutcome {
  return {
    status: 'failed',
    reason: 'runtime_error',
    retryable: true,
    details: { message }
  }
}

function isContextCapacityProposal(proposal: ModelProposal): boolean {
  if (proposal.stopClass !== 'transport_error' && proposal.stopClass !== 'protocol_error') return false
  const metadata = proposal.rawMetadata
  const metadataRecord = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : undefined
  const nestedError = metadataRecord?.error && typeof metadataRecord.error === 'object'
    ? metadataRecord.error as Record<string, unknown>
    : undefined
  const codes = [
    proposal.providerReason,
    metadataRecord?.code,
    metadataRecord?.type,
    nestedError?.code,
    nestedError?.type
  ].filter((value): value is string => typeof value === 'string')
  return codes.some((code) => {
    const normalized = code.trim().toLowerCase().replace(/[\s_-]+/g, '_')
    if ([
      'context_length_exceeded',
      'max_context_length',
      'context_window_exceeded',
      'input_too_long'
    ].includes(normalized)) return true
    return /(?:context|prompt|input).*(?:length|window|token|limit|long|exceed)|(?:maximum|max|exceed|too_long).*(?:context|prompt|input|token)/i.test(normalized)
  })
}

function isToolEffectPolicy(value: unknown): value is ToolEffectPolicy {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return ['read', 'idempotent-write', 'non-idempotent-write'].includes(String(record.effect))
    && ['safe', 'verify-first', 'never'].includes(String(record.replay))
}

function defaultEffectPolicy(call: ToolCallLike): ToolEffectPolicy {
  if (call.toolKind === 'file_change') {
    return { effect: 'non-idempotent-write', replay: 'never' }
  }
  return { effect: 'read', replay: 'safe' }
}

function updateTaskLedger(
  current: TaskStateV1,
  entries: readonly TaskToolLedgerEntry[],
  updatedAt: string
): TaskStateV1 {
  const byCall = new Map(current.toolLedger.map((entry) => [entry.callId, entry]))
  for (const entry of entries) byCall.set(entry.callId, entry)
  return {
    ...current,
    revision: current.revision + 1,
    toolLedger: [...byCall.values()],
    updatedAt
  }
}

async function emitProgress(
  deps: KernelV3NodeDependencies,
  identity: Parameters<RuntimeNodeHandler>[0]['identity'],
  input: {
    phase: 'preparing' | 'executing' | 'checkpoint' | 'summarizing' | 'terminated'
    summary: string
    modelSteps: number
    toolCalls: number
    evidenceCount?: number
    artifactCount?: number
    reason?: string
  }
): Promise<void> {
  if (!deps.emitRuntimeProgress) return
  const id = `item_kernel_progress_${identity.runId}`
  await deps.turns.applyItemOnce(identity.threadId, {
    id,
    turnId: identity.turnId,
    threadId: identity.threadId,
    role: 'system',
    status: 'running',
    kind: 'runtime_progress',
    createdAt: deps.nowIso(),
    phase: input.phase,
    summary: input.summary,
    modelSteps: input.modelSteps,
    toolCalls: input.toolCalls,
    evidenceCount: input.evidenceCount ?? 0,
    artifactCount: input.artifactCount ?? 0,
    ...(input.reason ? { reason: input.reason } : {})
  })
  await deps.turns.updateItemOnce(identity.threadId, id, {
    status: input.phase === 'terminated' ? 'completed' : 'running',
    phase: input.phase,
    summary: input.summary,
    modelSteps: input.modelSteps,
    toolCalls: input.toolCalls,
    evidenceCount: input.evidenceCount ?? 0,
    artifactCount: input.artifactCount ?? 0,
    ...(input.reason ? { reason: input.reason } : {})
  } as never)
}
