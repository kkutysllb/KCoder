import {
  TurnExecutionViewSchema,
  redactSecretText,
  type AgentExecutionView,
  type AgentTranscript,
  type TurnExecutionView,
  type UserFacingErrorView
} from '@qiongqi/contracts'

export type TurnExecutionSanitizerOptions = {
  maxInlineToolResultBytes: number
  redactPatterns: RegExp[]
}

const DEFAULT_OPTIONS: TurnExecutionSanitizerOptions = {
  maxInlineToolResultBytes: 64 * 1024,
  redactPatterns: []
}

const INTERNAL_FIELD_PATTERN = /^(?:api[-_]?key|authorization|bearer|cookie|client[-_]?secret|password|secret|token|workspacePath|runtimeStorePath|systemPrompt|managerPrompt|mailboxPayload|outboxPayload|lease|leaseToken|fence|fenceToken|workerAddress|runId|agentRunId|nodeId|graphId|transcriptRef)$/i
const PUBLIC_ERROR_CODES = new Set([
  'execution_data_pending',
  'execution_failed',
  'execution_aborted',
  'tool_failed',
  'rate_limited',
  'budget_exhausted',
  'service_unavailable'
])

export function sanitizeTranscript(
  transcript: AgentTranscript,
  options: TurnExecutionSanitizerOptions
): Pick<AgentExecutionView, 'messages' | 'reasoning' | 'toolRuns'> {
  const normalized = normalizeOptions(options)
  return {
    messages: transcript.messages.map((message) => ({
      key: message.key,
      sourceRef: message.sourceRef,
      role: message.role,
      content: sanitizeText(message.content, normalized.redactPatterns),
      createdAt: message.createdAt,
      artifactKeys: safeArtifactKeys(message.artifactRefs)
    })),
    reasoning: transcript.reasoning
      .filter((entry) => entry.userVisible)
      .map((entry) => ({
        key: entry.key,
        text: sanitizeText(entry.text, normalized.redactPatterns),
        createdAt: entry.createdAt
      })),
    toolRuns: transcript.toolRuns.map((toolRun) => {
      const artifactKeys = safeArtifactKeys(toolRun.artifactRefs)
      const input = sanitizePublicValue(toolRun.publicInput, toolRun.secretKeys, normalized)
      let result = sanitizePublicValue(toolRun.publicResult, toolRun.secretKeys, normalized)
      if (result !== undefined && serializedBytes(result) > normalized.maxInlineToolResultBytes) {
        result = {
          truncated: true,
          ...(artifactKeys[0] ? { artifactKey: artifactKeys[0] } : {})
        }
      }
      return {
        key: toolRun.key,
        toolName: toolRun.toolName,
        status: toolRun.status,
        ...(input !== undefined ? { input } : {}),
        ...(result !== undefined ? { result } : {}),
        artifactKeys
      }
    })
  }
}

export function sanitizeUserFacingError(error: unknown): UserFacingErrorView {
  const record = asRecord(error)
  const code = typeof record?.code === 'string' && PUBLIC_ERROR_CODES.has(record.code)
    ? record.code
    : 'execution_failed'
  if (code === 'execution_failed' && record?.code !== 'execution_failed') {
    return { code, message: '执行失败' }
  }
  const fallback = code === 'execution_data_pending'
    ? '执行详情仍在同步'
    : code === 'execution_aborted'
      ? '执行已取消'
      : '执行失败'
  return {
    code,
    message: typeof record?.message === 'string'
      ? sanitizeText(record.message, [])
      : fallback
  }
}

export function sanitizeTurnExecution(
  input: unknown,
  options: TurnExecutionSanitizerOptions = DEFAULT_OPTIONS
): TurnExecutionView {
  const source = requireRecord(input, 'turn execution')
  if (source.available === false) {
    return TurnExecutionViewSchema.parse({
      version: source.version,
      available: false,
      revision: source.revision,
      reason: source.reason
    })
  }

  const mode = source.mode
  const base = {
    version: source.version,
    available: true as const,
    revision: source.revision,
    mode,
    status: source.status,
    decision: sanitizeRuntimeDecision(source.decision),
    agents: asArray(source.agents).map((agent) => sanitizeAgent(agent, options))
  }

  if (mode === 'kernel_v3') {
    const delegation = requireRecord(source.delegation, 'delegation')
    return TurnExecutionViewSchema.parse({
      ...base,
      mode,
      delegation: {
        roots: asArray(delegation.roots),
        edges: asArray(delegation.edges).map((edge) => {
          const value = requireRecord(edge, 'delegation edge')
          return { from: value.from, to: value.to }
        })
      }
    })
  }

  if (mode === 'evented_v2') {
    const graph = requireRecord(source.graph, 'agent graph')
    return TurnExecutionViewSchema.parse({
      ...base,
      mode,
      graph: {
        key: graph.key,
        templateId: graph.templateId,
        nodes: asArray(graph.nodes).map(sanitizeGraphNode),
        edges: asArray(graph.edges).map((edge) => {
          const value = requireRecord(edge, 'graph edge')
          return {
            from: value.from,
            to: value.to,
            ...(value.condition !== undefined ? { condition: value.condition } : {})
          }
        }),
        handoffs: asArray(graph.handoffs).map((handoff) => {
          const value = requireRecord(handoff, 'graph handoff')
          return { from: value.from, to: value.to, status: value.status }
        }),
        activeAgentKeys: asArray(graph.activeAgentKeys),
        warnings: asArray(graph.warnings).map((warning) =>
          typeof warning === 'string' ? sanitizeText(warning, options.redactPatterns) : warning)
      }
    })
  }

  if (mode === 'classic') {
    const compatibility = requireRecord(source.compatibility, 'compatibility')
    return TurnExecutionViewSchema.parse({
      ...base,
      mode,
      compatibility: {
        reason: typeof compatibility.reason === 'string'
          ? sanitizeText(compatibility.reason, options.redactPatterns)
          : compatibility.reason
      }
    })
  }

  return TurnExecutionViewSchema.parse(base)
}

function sanitizeAgent(input: unknown, options: TurnExecutionSanitizerOptions): unknown {
  const agent = requireRecord(input, 'agent execution')
  return {
    key: agent.key,
    ...(agent.parentKey !== undefined ? { parentKey: agent.parentKey } : {}),
    sequence: agent.sequence,
    role: agent.role,
    ...(agent.phase !== undefined ? { phase: agent.phase } : {}),
    name: agent.name,
    ...(agent.task !== undefined ? { task: sanitizeMaybeText(agent.task, options) } : {}),
    status: agent.status,
    ...(agent.startedAt !== undefined ? { startedAt: agent.startedAt } : {}),
    ...(agent.completedAt !== undefined ? { completedAt: agent.completedAt } : {}),
    ...(agent.durationMs !== undefined ? { durationMs: agent.durationMs } : {}),
    ...(agent.usage !== undefined ? { usage: sanitizeUsage(agent.usage) } : {}),
    messages: asArray(agent.messages).map((message) => {
      const value = requireRecord(message, 'agent message')
      return {
        key: value.key,
        sourceRef: value.sourceRef,
        role: value.role,
        content: sanitizeMaybeText(value.content, options),
        createdAt: value.createdAt,
        artifactKeys: safeArtifactKeys(asStringArray(value.artifactKeys))
      }
    }),
    reasoning: asArray(agent.reasoning).map((reasoning) => {
      const value = requireRecord(reasoning, 'reasoning')
      return {
        key: value.key,
        text: sanitizeMaybeText(value.text, options),
        createdAt: value.createdAt
      }
    }),
    toolRuns: asArray(agent.toolRuns).map((toolRun) => sanitizeProjectedToolRun(toolRun, options)),
    ...(agent.summary !== undefined ? { summary: sanitizeMaybeText(agent.summary, options) } : {}),
    ...(agent.error !== undefined ? { error: sanitizeUserFacingError(agent.error) } : {}),
    retries: asArray(agent.retries).map((retry) => {
      const value = requireRecord(retry, 'retry')
      return {
        attempt: value.attempt,
        status: value.status,
        ...(value.startedAt !== undefined ? { startedAt: value.startedAt } : {}),
        ...(value.completedAt !== undefined ? { completedAt: value.completedAt } : {}),
        ...(value.error !== undefined ? { error: sanitizeUserFacingError(value.error) } : {})
      }
    })
  }
}

function sanitizeProjectedToolRun(input: unknown, options: TurnExecutionSanitizerOptions): unknown {
  const toolRun = requireRecord(input, 'tool run')
  const artifactKeys = safeArtifactKeys(asStringArray(toolRun.artifactKeys))
  const sanitizedInput = sanitizePublicValue(toolRun.input, [], options)
  let sanitizedResult = sanitizePublicValue(toolRun.result, [], options)
  if (sanitizedResult !== undefined && serializedBytes(sanitizedResult) > options.maxInlineToolResultBytes) {
    sanitizedResult = {
      truncated: true,
      ...(artifactKeys[0] ? { artifactKey: artifactKeys[0] } : {})
    }
  }
  return {
    key: toolRun.key,
    toolName: toolRun.toolName,
    status: toolRun.status,
    ...(sanitizedInput !== undefined ? { input: sanitizedInput } : {}),
    ...(sanitizedResult !== undefined ? { result: sanitizedResult } : {}),
    artifactKeys
  }
}

function sanitizeRuntimeDecision(input: unknown): unknown {
  const decision = requireRecord(input, 'runtime decision')
  return {
    preferredMode: decision.preferredMode,
    effectiveMode: decision.effectiveMode,
    preference: decision.preference,
    source: decision.source,
    reasonCode: decision.reasonCode,
    reason: decision.reason,
    ...(decision.fallbackReasonCode !== undefined
      ? { fallbackReasonCode: decision.fallbackReasonCode }
      : {}),
    ...(decision.fallbackReason !== undefined ? { fallbackReason: decision.fallbackReason } : {}),
    rolloutStage: decision.rolloutStage,
    decidedAt: decision.decidedAt
  }
}

function sanitizeGraphNode(input: unknown): unknown {
  const node = requireRecord(input, 'graph node')
  return {
    key: node.key,
    agentKey: node.agentKey,
    role: node.role,
    ...(node.phase !== undefined ? { phase: node.phase } : {}),
    name: node.name,
    status: node.status,
    required: node.required,
    childAgentKeys: asArray(node.childAgentKeys),
    ...(node.parallelGroup !== undefined ? { parallelGroup: node.parallelGroup } : {})
  }
}

function sanitizeUsage(input: unknown): unknown {
  const usage = requireRecord(input, 'usage')
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    ...(usage.costCny !== undefined ? { costCny: usage.costCny } : {})
  }
}

function sanitizePublicValue(
  value: unknown,
  secretKeys: readonly string[],
  options: TurnExecutionSanitizerOptions
): unknown {
  const denied = new Set(secretKeys.map((key) => key.toLowerCase()))
  return sanitizeValue(value, denied, options.redactPatterns)
}

function sanitizeValue(value: unknown, denied: ReadonlySet<string>, patterns: RegExp[]): unknown {
  if (typeof value === 'string') return sanitizeText(value, patterns)
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, denied, patterns))
  if (!value || typeof value !== 'object') return value

  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (denied.has(key.toLowerCase()) || INTERNAL_FIELD_PATTERN.test(key)) continue
    output[key] = sanitizeValue(child, denied, patterns)
  }
  return output
}

function sanitizeText(value: string, patterns: readonly RegExp[]): string {
  return patterns.reduce((current, pattern) => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    return current.replace(new RegExp(pattern.source, flags), '<redacted>')
  }, redactSecretText(value))
}

function sanitizeMaybeText(value: unknown, options: TurnExecutionSanitizerOptions): unknown {
  return typeof value === 'string' ? sanitizeText(value, options.redactPatterns) : value
}

function safeArtifactKeys(refs: readonly string[]): string[] {
  return refs.filter((ref) => {
    const value = ref.trim()
    return value.length > 0 &&
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').includes('..') &&
      !/^[a-z][a-z\d+.-]*:/i.test(value)
  })
}

function serializedBytes(value: unknown): number {
  const serialized = JSON.stringify(value)
  return Buffer.byteLength(serialized ?? '', 'utf8')
}

function normalizeOptions(options: TurnExecutionSanitizerOptions): TurnExecutionSanitizerOptions {
  return {
    maxInlineToolResultBytes: Math.max(0, Math.floor(options.maxInlineToolResultBytes)),
    redactPatterns: options.redactPatterns
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value)
  if (!record) throw new Error(`Invalid ${label}`)
  return record
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}
