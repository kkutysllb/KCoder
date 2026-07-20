import type {
  ToolHost,
  ToolHostContext,
  ToolHostResult,
  ToolHostPreparation,
  ToolCallLike,
  ToolExecutionUpdate
} from '@qiongqi/ports'
import type { ApprovalRequest } from '@qiongqi/domain'
import { createApprovalRequest } from '@qiongqi/domain'
import type { TurnItem } from '@qiongqi/contracts'
import { makeToolResultItem, makeApprovalItem } from '@qiongqi/domain'
import { buildBuiltinLocalTools } from './builtin-tools.js'
import { CapabilityRegistry } from './capability-registry.js'
import {
  applyPostToolHookResults,
  applyPreToolHookResults,
  runToolHooks,
  type ResolvedToolHook
} from './tool-hooks.js'
import {
  applyToolResultBudget,
  normalizeRateLimitedToolOutput
} from '@qiongqi/tool-infra'
import {
  normalizeReadTrackerOptions,
  ReadTracker,
  type ReadTrackerOptions
} from './read-tracker.js'

/**
 * A single registered tool. Tools are pure functions that observe the
 * abort signal and may be guarded by an approval policy.
 */
export type LocalTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  toolKind: 'tool_call' | 'command_execution' | 'file_change'
  /**
   * Tool policy. `auto` runs the tool without asking. `on-request` and
   * `suggest` always ask the user. `never` blocks the tool. `untrusted`
   * prompts unless the call is in an allow-list.
   */
  policy: 'auto' | 'on-request' | 'suggest' | 'never' | 'untrusted'
  /**
   * Optional gating predicate. When present, the tool is only listed
   * and only executed when `shouldAdvertise` returns true for the
   * active turn context. Use this for mode/plan-only tools such as
   * `create_plan`.
   */
  shouldAdvertise?: (context: ToolHostContext) => boolean
  /** Provider-neutral capability used when the executor does not supply richer semantics. */
  capabilityClass?: string
  semantic?: (
    args: Record<string, unknown>,
    context: ToolHostContext,
    result: { output: unknown; isError?: boolean },
    call: ToolCallLike
  ) => ToolHostResult['semantic'] | undefined
  execute: (
    args: Record<string, unknown>,
    context: ToolHostContext,
    onUpdate?: (update: ToolExecutionUpdate) => Promise<void> | void
  ) => Promise<{ output: unknown; isError?: boolean; semantic?: ToolHostResult['semantic'] }>
}

export type LocalToolHostOptions = {
  tools?: LocalTool[]
  registry?: CapabilityRegistry
  /** Allow-list for `untrusted` policy. Tools outside the list always prompt. */
  allowList?: string[]
  /** Optional PreToolUse/PostToolUse hooks. */
  hooks?: readonly ResolvedToolHook[]
  /** Runtime read-before-edit guard. Disabled by default for direct unit use. */
  readTracker?: boolean | ReadTrackerOptions
}

/**
 * Default tool host. Runs tools in-process with abort-signal support
 * and approval gating through the `ToolHostContext.awaitApproval`
 * callback. The host is approval-aware at two layers:
 *
 * 1. A tool with `policy: 'never'` is rejected up front.
 * 2. A tool with `policy: 'on-request' | 'suggest' | 'untrusted'`
 *    always asks before running when the runtime approval policy
 *    permits tool execution.
 *
 * Tools that declare a `shouldAdvertise` predicate are also gated at
 * the listing layer and the execution layer. This is how `create_plan`
 * stays scoped to GUI plan/refine turns.
 */
export class LocalToolHost implements ToolHost {
  readonly id = 'local'
  private readonly registry: CapabilityRegistry
  private readonly allowList: Set<string>
  private readonly hooks: readonly ResolvedToolHook[]
  private readonly readTracker: ReadTracker

  constructor(options: LocalToolHostOptions) {
    this.registry = options.registry ?? CapabilityRegistry.fromLocalTools(options.tools ?? [])
    this.allowList = new Set(options.allowList ?? [])
    this.hooks = options.hooks ?? []
    this.readTracker = new ReadTracker(normalizeReadTrackerOptions(options.readTracker))
  }

  listTools(context?: ToolHostContext) {
    return Promise.resolve(this.registry.listTools(context))
  }

  diagnostics() {
    return this.registry.diagnostics()
  }

  async prepare(call: ToolCallLike, context: ToolHostContext): Promise<ToolHostPreparation> {
    if (context.abortSignal.aborted) throw new Error('tool call aborted before start')
    const { tool } = this.registry.resolveTool(call.toolName, context, call.providerId)
    if (tool.policy === 'never') throw new Error(`tool ${call.toolName} is disabled by policy`)
    let preHookResults
    try {
      preHookResults = await runToolHooks({
        hooks: this.hooks,
        invocation: { phase: 'PreToolUse', call, context: hookContext(context) }
      })
    } catch (error) {
      return {
        call,
        result: this.resultWithSemantic(
          this.errorToolResult(context, call, tool, hookErrorMessage(error), 'hook_failed'),
          false,
          tool,
          call,
          context
        ),
        state: { tool }
      }
    }
    const decision = applyPreToolHookResults(call, preHookResults)
    if (decision.denied) {
      return {
        call: decision.call,
        result: this.resultWithSemantic(
          this.errorToolResult(context, decision.call, tool, decision.denied, 'hook_denied'),
          false,
          tool,
          decision.call,
          context
        ),
        state: { tool }
      }
    }
    return { call: decision.call, state: { tool } }
  }

  async execute(
    call: ToolCallLike,
    context: ToolHostContext,
    onUpdate?: (item: TurnItem) => Promise<void> | void,
    preparation?: ToolHostPreparation
  ): Promise<ToolHostResult> {
    const prepared = preparation ?? await this.prepare(call, context)
    if (prepared.result) return prepared.result
    const activeCall = prepared.call
    const preparedState = prepared.state as { tool?: LocalTool } | undefined
    const tool = preparedState?.tool
      ?? this.registry.resolveTool(activeCall.toolName, context, activeCall.providerId).tool
    const readValidation = this.readTracker.validateBeforeTool({ context, call: activeCall })
    if (!readValidation.ok) {
      return {
        item: this.errorToolResult(context, activeCall, tool, readValidation.message, 'read_before_edit_required'),
        approved: false
      }
    }
    if (this.isBlockedByRuntimePolicy(tool, activeCall, context)) {
      return {
        item: this.errorToolResult(
          context,
          activeCall,
          tool,
          `tool ${activeCall.toolName} is disabled by runtime approval policy`,
          'approval_policy_blocked'
        ),
        approved: false
      }
    }
    const needsApproval = this.requiresApproval(tool, activeCall, context)
    if (needsApproval) {
      const approvalId = `appr_${activeCall.callId}`
      const approval: ApprovalRequest = createApprovalRequest({
        id: approvalId,
        threadId: context.threadId,
        turnId: context.turnId,
        toolName: activeCall.toolName,
        summary: this.buildApprovalSummary(activeCall)
      })
      const decision = await context.awaitApproval(approval)
      if (decision !== 'allow') {
        const item = makeApprovalItem({
          id: `item_${approvalId}`,
          turnId: context.turnId,
          threadId: context.threadId,
          approvalId,
          toolName: activeCall.toolName,
          summary: approval.summary
        })
        return { item, approved: false }
      }
    }
    if (context.abortSignal.aborted) {
      throw new Error('tool call aborted while waiting for approval')
    }
    const result = await tool.execute(activeCall.arguments, context, async (update) => {
      if (!onUpdate) return
      const partialItem = makeToolResultItem({
        id: `item_${activeCall.callId}`,
        turnId: context.turnId,
        threadId: context.threadId,
        callId: activeCall.callId,
        toolName: activeCall.toolName,
        toolKind: activeCall.toolKind ?? tool.toolKind,
        output: update.output,
        isError: update.isError,
        status: 'running'
      })
      await onUpdate(partialItem)
    })
    let lastOutput: unknown
    try {
      lastOutput = result.output
    } catch {
      lastOutput = undefined
    }
    try {
      const postHookResults = await runToolHooks({
        hooks: this.hooks,
        invocation: {
          phase: 'PostToolUse',
          call: activeCall,
          context: hookContext(context),
          result
        }
      })
      const hookedResult = applyPostToolHookResults(result, postHookResults)
      lastOutput = hookedResult.output
      const rateLimited = normalizeRateLimitedToolOutput(hookedResult.output)
      const rawOutput = rateLimited.rateLimited ? rateLimited.output : hookedResult.output
      const isError = hookedResult.isError || rateLimited.isError
      const output = await this.applyOutputBudget(activeCall.toolName, rawOutput, context)
      lastOutput = output
      this.readTracker.observeToolResult({ context, call: activeCall, output, isError })
      const item = makeToolResultItem({
        id: `item_${activeCall.callId}`,
        turnId: context.turnId,
        threadId: context.threadId,
        callId: activeCall.callId,
        toolName: activeCall.toolName,
        toolKind: activeCall.toolKind ?? tool.toolKind,
        output,
        isError
      })
      let semantic: ToolHostResult['semantic']
      try {
        semantic = result.semantic
      } catch {
        semantic = undefined
      }
      if (!semantic && tool.semantic) {
        try {
          semantic = tool.semantic(activeCall.arguments, context, { output, isError }, activeCall)
        } catch {
          semantic = undefined
        }
      }
      semantic ??= { capabilityClass: tool.capabilityClass ?? tool.name, resourceKeys: [] }
      return { item, approved: !needsApproval, semantic }
    } catch {
      return this.resultWithSemantic(
        this.postprocessErrorToolResult(
          context,
          activeCall,
          tool,
          cloneIfSafe(lastOutput)
        ),
        !needsApproval,
        tool,
        activeCall,
        context
      )
    }
  }

  clearReadTracker(threadId?: string): void {
    this.readTracker.clear(threadId)
  }

  private isBlockedByRuntimePolicy(
    tool: LocalTool,
    call: ToolCallLike,
    context: ToolHostContext
  ): boolean {
    if (this.isInteractiveGuiGateTool(call.toolName)) return false
    if (context.approvalPolicy !== 'never') return false
    return tool.policy !== 'never'
  }

  private requiresApproval(tool: LocalTool, call: ToolCallLike, context: ToolHostContext): boolean {
    if (this.isInteractiveGuiGateTool(call.toolName)) return false
    if (tool.policy === 'never' || context.approvalPolicy === 'never') return false
    switch (context.approvalPolicy) {
      case 'auto':
        return false
      case 'on-request':
      case 'suggest':
        return tool.policy !== 'auto'
      case 'untrusted':
        if (tool.policy === 'auto') return !this.allowList.has(call.toolName)
        return true
    }
  }

  private isInteractiveGuiGateTool(toolName: string): boolean {
    return toolName === 'user_input' || toolName === 'request_user_input'
  }

  private buildApprovalSummary(call: ToolCallLike): string {
    const args = Object.entries(call.arguments)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(', ')
    return `Run ${call.toolName}(${args})`
  }

  private async applyOutputBudget(
    toolName: string,
    output: unknown,
    context: ToolHostContext
  ): Promise<unknown> {
    if (!context.outputBudget) return output
    const content = outputToBudgetableText(output)
    if (content === null) return output
    const budgeted = await applyToolResultBudget({
      toolName,
      content,
      outputDir: context.outputBudget.outputDir,
      maxInlineBytes: context.outputBudget.maxInlineBytes,
      previewHeadBytes: context.outputBudget.previewHeadBytes,
      previewTailBytes: context.outputBudget.previewTailBytes
    })
    if (!budgeted.externalized) return output
    return {
      externalized: true,
      toolName,
      modelVisibleText: budgeted.modelVisibleText,
      originalBytes: budgeted.originalBytes,
      omittedBytes: budgeted.omittedBytes,
      ...(budgeted.persistedPath ? { persistedPath: budgeted.persistedPath } : {})
    }
  }

  private errorToolResult(
    context: ToolHostContext,
    call: ToolCallLike,
    tool: LocalTool,
    message: string,
    code: string
  ): TurnItem {
    return makeToolResultItem({
      id: `item_${call.callId}`,
      turnId: context.turnId,
      threadId: context.threadId,
      callId: call.callId,
      toolName: call.toolName,
      toolKind: call.toolKind ?? tool.toolKind,
      output: { code, error: message },
      isError: true
    })
  }

  private resultWithSemantic(
    item: TurnItem,
    approved: boolean,
    tool: LocalTool,
    call: ToolCallLike,
    context: ToolHostContext
  ): ToolHostResult {
    if (item.kind !== 'tool_result') return { item, approved }
    let semantic: ToolHostResult['semantic']
    try {
      semantic = tool.semantic?.(call.arguments, context, { output: item.output, isError: item.isError }, call)
    } catch {
      semantic = undefined
    }
    return {
      item,
      approved,
      semantic: semantic ?? { capabilityClass: tool.capabilityClass ?? tool.name, resourceKeys: [] }
    }
  }

  private postprocessErrorToolResult(
    context: ToolHostContext,
    call: ToolCallLike,
    tool: LocalTool,
    preservedOutput: unknown
  ): TurnItem {
    return makeToolResultItem({
      id: `item_${call.callId}`,
      turnId: context.turnId,
      threadId: context.threadId,
      callId: call.callId,
      toolName: call.toolName,
      toolKind: call.toolKind ?? tool.toolKind,
      output: {
        code: 'tool_postprocess_failed',
        error: 'tool result post-processing failed',
        ...(preservedOutput === undefined ? {} : { result: preservedOutput })
      },
      isError: true
    })
  }

  /** Tool builder helper for tests and feature scripts. */
  static defineTool(
    tool: Omit<LocalTool, 'policy' | 'toolKind'> & {
      policy?: LocalTool['policy']
      toolKind?: LocalTool['toolKind']
    }
  ): LocalTool {
    return {
      policy: tool.policy ?? 'on-request',
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      toolKind: tool.toolKind ?? 'tool_call',
      execute: tool.execute,
      ...(tool.capabilityClass ? { capabilityClass: tool.capabilityClass } : {}),
      ...(tool.semantic ? { semantic: tool.semantic } : {}),
      ...(tool.shouldAdvertise ? { shouldAdvertise: tool.shouldAdvertise } : {})
    }
  }
}

function hookContext(
  context: ToolHostContext
): Pick<ToolHostContext, 'threadId' | 'turnId' | 'workspace' | 'threadMode' | 'approvalPolicy'> {
  return {
    threadId: context.threadId,
    turnId: context.turnId,
    workspace: context.workspace,
    approvalPolicy: context.approvalPolicy,
    ...(context.threadMode ? { threadMode: context.threadMode } : {})
  }
}

function hookErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `tool hook failed: ${message}`
}

function outputToBudgetableText(output: unknown): string | null {
  if (typeof output === 'string') return output
  if (Buffer.isBuffer(output)) return output.toString('utf8')
  if (output === null || output === undefined) return null
  if (typeof output !== 'object') return String(output)
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return null
  }
}

function cloneIfSafe(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    return structuredClone(value)
  } catch {
    return undefined
  }
}

/**
 * Tiny default tool used by smoke tests: echoes its argument so the
 * rest of the loop has a tool to call when the GUI hasn't provided any.
 */
export const echoTool: LocalTool = LocalToolHost.defineTool({
  name: 'echo',
  description: 'Echo the input argument back to the model.',
  toolKind: 'tool_call',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text']
  },
  policy: 'auto',
  execute: async (args) => ({ output: { echoed: args.text ?? '' } })
})

function createUserInputTool(name: string): LocalTool {
  const optionSchema = {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          label: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['label']
      }
    ]
  }
  return LocalToolHost.defineTool({
    name,
    description: 'Ask the GUI user a structured question and wait for the answer.',
    toolKind: 'tool_call',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        question: { type: 'string' },
        message: { type: 'string' },
        options: {
          type: 'array',
          description: 'Optional answer choices for a single question. Use strings or {label, description} objects.',
          items: optionSchema
        },
        questions: {
          type: 'array',
          description: 'One to three structured questions. Each question may include answer options.',
          items: {
            type: 'object',
            properties: {
              header: { type: 'string' },
              id: { type: 'string' },
              question: { type: 'string' },
              options: {
                type: 'array',
                items: optionSchema
              }
            },
            required: ['question']
          }
        }
      },
      required: []
    },
    policy: 'auto',
    execute: async (args, context) => {
      if (!context.awaitUserInput) {
        return {
          output: { error: 'GUI user input is not available in this runtime context' },
          isError: true
        }
      }
      const inputId = `in_${Math.random().toString(36).slice(2, 10)}`
      const itemId = `item_${inputId}`
      const prompt = String(args.prompt ?? args.question ?? args.message ?? 'Input requested')
      const questions = normalizeUserInputQuestions(args, inputId, prompt)
      const resolution = await context.awaitUserInput({ id: inputId, itemId, prompt, questions })
      return {
        output: resolution,
        isError: resolution.status === 'cancelled'
      }
    }
  })
}

export const userInputTool: LocalTool = createUserInputTool('user_input')
export const requestUserInputTool: LocalTool = createUserInputTool('request_user_input')

export function getDefaultLocalTools(): LocalTool[] {
  return [
    ...buildBuiltinLocalTools(),
    echoTool,
    userInputTool,
    requestUserInputTool
  ]
}

function normalizeUserInputQuestions(
  args: Record<string, unknown>,
  fallbackId: string,
  fallbackPrompt: string
): Array<{
  header: string
  id: string
  question: string
  options: Array<{ label: string; description: string }>
}> {
  const rawQuestions = Array.isArray(args.questions) ? args.questions : null
  if (rawQuestions && rawQuestions.length > 0) {
    const questions = rawQuestions
      .map((question, index) => normalizeUserInputQuestion(question, index, fallbackId))
      .filter((question) => question !== null)
    if (questions.length > 0) return questions
  }
  const options = Array.isArray(args.options)
    ? args.options
        .map((option) => normalizeUserInputOption(option))
        .filter((option) => option !== null)
    : []
  return [
    {
      header: 'Input',
      id: String(args.id ?? fallbackId),
      question: fallbackPrompt,
      options
    }
  ]
}

function normalizeUserInputQuestion(
  value: unknown,
  index: number,
  fallbackId: string
): {
  header: string
  id: string
  question: string
  options: Array<{ label: string; description: string }>
} | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const question = typeof raw.question === 'string' && raw.question.trim()
    ? raw.question.trim()
    : null
  if (!question) return null
  const options = Array.isArray(raw.options)
    ? raw.options
        .map((option) => normalizeUserInputOption(option))
        .filter((option) => option !== null)
    : []
  return {
    header: typeof raw.header === 'string' && raw.header.trim() ? raw.header.trim() : `Question ${index + 1}`,
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${fallbackId}_${index + 1}`,
    question,
    options
  }
}

function normalizeUserInputOption(
  value: unknown
): { label: string; description: string } | null {
  if (typeof value === 'string' && value.trim()) {
    return {
      label: value.trim(),
      description: ''
    }
  }
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null
  if (!label) return null
  return {
    label,
    description: typeof raw.description === 'string' ? raw.description : ''
  }
}

import { createCreatePlanTool, type CreatePlanAdapterOptions } from './create-plan-tool.js'

/**
 * Build the default tool list including the `create_plan` tool. The
 * `create_plan` tool is gated to plan/refine turns via its
 * `shouldAdvertise` predicate, so it is safe to ship with the
 * default set: non-plan turns never see it in the model tool list.
 */
export function buildDefaultLocalTools(planOptions: CreatePlanAdapterOptions = {}): LocalTool[] {
  return [...getDefaultLocalTools(), createCreatePlanTool(planOptions)]
}
