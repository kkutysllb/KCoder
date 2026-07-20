import { createHash } from 'node:crypto'
import { posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  TaskArtifactRefSchema,
  ToolObservationSchema,
  TurnItem as TurnItemSchema,
  type ToolEffectPolicy,
  type ToolObservation
} from '@qiongqi/contracts'
import type { ToolCallLike, ToolHostContext, ToolHostResult } from '@qiongqi/ports'

const ToolHostSemanticSchema = z.object({
  capabilityClass: z.string().trim().min(1),
  resourceKeys: z.array(z.string()),
  artifactRefs: z.array(TaskArtifactRefSchema).optional()
}).strict()

export const NormalizedToolHostResultSchema = z.object({
  item: TurnItemSchema,
  approved: z.boolean(),
  semantic: ToolHostSemanticSchema.optional()
}).strict()

export type ObserveToolInput = {
  call: ToolCallLike
  result: ToolHostResult
  context: Pick<ToolHostContext, 'workspace' | 'threadId' | 'turnId'>
  policy: ToolEffectPolicy
  replayed: boolean
}

export function normalizeToolCall(call: ToolCallLike): ToolCallLike {
  const canonicalArguments = canonicalArgumentValue(call.arguments)
  if (!canonicalArguments || typeof canonicalArguments !== 'object' || Array.isArray(canonicalArguments)) {
    throw new TypeError('tool arguments must be a JSON object')
  }
  if (call.toolKind && !['tool_call', 'command_execution', 'file_change'].includes(call.toolKind)) {
    throw new TypeError('tool kind is invalid')
  }
  return {
    callId: requireNonEmptyString(call.callId, 'tool call id'),
    toolName: requireNonEmptyString(call.toolName, 'tool name'),
    ...(call.providerId ? { providerId: requireNonEmptyString(call.providerId, 'provider id') } : {}),
    ...(call.toolKind ? { toolKind: call.toolKind } : {}),
    arguments: canonicalArguments as Record<string, unknown>,
    ...(call.effectPolicy ? { effectPolicy: call.effectPolicy } : {})
  }
}

export function canonicalToolDigest(call: ToolCallLike): string {
  const normalized = normalizeToolCall(call)
  return digest('tool-arguments:v1', {
    toolName: normalized.toolName,
    providerId: normalized.providerId ?? null,
    toolKind: normalized.toolKind ?? null,
    arguments: normalized.arguments
  })
}

export function normalizeToolHostResult(
  result: ToolHostResult,
  call: ToolCallLike,
  context: Pick<ToolHostContext, 'threadId' | 'turnId'>
): ToolHostResult {
  let rawItem: unknown
  try {
    rawItem = result.item
  } catch {
    rawItem = undefined
  }
  let item: ToolHostResult['item']
  let normalizationFailed = false
  try {
    const normalizedItem = canonicalResultValue(rawItem)
    item = TurnItemSchema.parse(normalizedItem)
  } catch (error) {
    normalizationFailed = true
    item = normalizationFailureItem(rawItem, call, context, error)
  }
  let approved = false
  try {
    approved = result.approved === true
  } catch {
    approved = false
  }
  let rawSemantic: ToolHostResult['semantic']
  try {
    rawSemantic = result.semantic
  } catch {
    rawSemantic = undefined
  }
  const semantic = normalizationFailed ? undefined : normalizeSemantic(rawSemantic, call.toolName)
  return NormalizedToolHostResultSchema.parse({
    item,
    approved,
    ...(semantic ? { semantic } : {})
  })
}

export function observeTool(input: ObserveToolInput): ToolObservation {
  const call = normalizeToolCall(input.call)
  const result = normalizeToolHostResult(input.result, call, input.context)
  return observeNormalizedTool({ ...input, call, result })
}

export function observeNormalizedTool(input: ObserveToolInput): ToolObservation {
  const call = input.call
  const result = NormalizedToolHostResultSchema.parse(input.result)
  const item = result.item
  const failed = item.kind === 'tool_result'
    ? item.isError || item.status === 'failed' || item.status === 'aborted'
    : item.status === 'failed' || item.status === 'aborted'
  const resultContent = item.kind === 'tool_result'
    ? {
        kind: item.kind,
        toolName: item.toolName,
        toolKind: item.toolKind,
        output: item.output,
        isError: item.isError,
        status: item.status
      }
    : { kind: item.kind, status: item.status }
  return ToolObservationSchema.parse({
    callId: call.callId,
    toolName: call.toolName,
    effect: input.policy.effect,
    capabilityClass: result.semantic?.capabilityClass ?? call.toolName,
    resourceKeys: normalizeResourceKeys(result.semantic?.resourceKeys ?? [], input.context.workspace),
    canonicalArgumentsDigest: canonicalToolDigest(call),
    resultDigest: digest('tool-result:v1', resultContent),
    resultItemId: item.id,
    artifactRefs: failed
      ? []
      : normalizeArtifactRefs(result.semantic?.artifactRefs ?? [], input.context.workspace),
    failed,
    replayed: input.replayed
  })
}

export function normalizeResourceKeys(resourceKeys: readonly string[], workspace: string): string[] {
  const normalized = resourceKeys
    .filter((key): key is string => typeof key === 'string')
    .map((key) => normalizeResourceKey(key, workspace))
    .filter((key): key is string => key !== null)
  return [...new Set(normalized)].sort()
}

function normalizeArtifactRefs(
  artifactRefs: readonly z.infer<typeof TaskArtifactRefSchema>[],
  workspace: string
): z.infer<typeof TaskArtifactRefSchema>[] {
  const normalized: z.infer<typeof TaskArtifactRefSchema>[] = []
  for (const artifact of artifactRefs) {
    const path = workspaceRelativePath(artifact.path, workspace)
    if (!path) continue
    normalized.push({ ...artifact, path })
  }
  return normalized
}

function normalizeResourceKey(resourceKey: string, workspace: string): string | null {
  const trimmed = resourceKey.trim()
  if (!trimmed) return null
  if (isWindowsPathLike(trimmed)) {
    if (!isWindowsAbsolute(trimmed)) return externalResourceKey(trimmed)
    return workspaceRelativePath(trimmed, workspace) ?? externalResourceKey(trimmed)
  }
  if (/^file:/i.test(trimmed)) {
    try {
      const filePath = crossPlatformFileUrlPath(trimmed, workspace)
      return workspaceRelativePath(filePath, workspace) ?? externalResourceKey(filePath)
    } catch {
      return externalResourceKey(trimmed)
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed
  return workspaceRelativePath(trimmed, workspace) ?? externalResourceKey(trimmed)
}

function crossPlatformFileUrlPath(value: string, workspace: string): string {
  const url = new URL(value)
  if (url.protocol.toLowerCase() !== 'file:') throw new TypeError('resource is not a file URL')
  if (/%(?:2f|5c)/i.test(url.pathname)) throw new TypeError('encoded file URL separators are invalid')
  const pathname = decodeURIComponent(url.pathname)
  const drivePath = /^\/([a-z]:)(\/.*)?$/i.exec(pathname)
  if (drivePath) return `${drivePath[1]}${drivePath[2] ?? '\\'}`.replace(/\//g, '\\')
  if (url.hostname) return `\\\\${url.hostname}${pathname.replace(/\//g, '\\')}`
  if (isWindowsAbsolute(workspace)) {
    const root = win32.parse(workspace).root
    return win32.resolve(root, pathname.replace(/^\/+/, ''))
  }
  return fileURLToPath(url)
}

function workspaceRelativePath(candidate: string, workspace: string): string | null {
  const windowsWorkspace = isWindowsAbsolute(workspace)
  const windowsCandidate = isWindowsAbsolute(candidate)
  if (windowsWorkspace || windowsCandidate) {
    if (!windowsWorkspace) return null
    const root = win32.resolve(workspace)
    const absolute = windowsCandidate ? win32.resolve(candidate) : win32.resolve(root, candidate)
    const relative = win32.relative(root, absolute)
    if (isOutsideRelative(relative, win32.isAbsolute(relative))) return null
    return toPosixPath(relative || '.')
  }
  const root = posix.resolve(toPosixPath(workspace))
  const normalizedCandidate = toPosixPath(candidate)
  const absolute = posix.isAbsolute(normalizedCandidate)
    ? posix.resolve(normalizedCandidate)
    : posix.resolve(root, normalizedCandidate)
  const relative = posix.relative(root, absolute)
  if (isOutsideRelative(relative, posix.isAbsolute(relative))) return null
  return relative || '.'
}

function isOutsideRelative(relative: string, absolute: boolean): boolean {
  return absolute || relative === '..' || relative.startsWith('../') || relative.startsWith('..\\')
}

function isWindowsAbsolute(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(value)
}

function isWindowsPathLike(value: string): boolean {
  return /^[a-z]:/i.test(value) || /^(?:\\\\|\/\/)/.test(value)
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}

function externalResourceKey(value: string): string {
  return `external:sha256:${digest('tool-resource:v1', toPosixPath(value))}`
}

function digest(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain)
    .update('\0')
    .update(JSON.stringify(value))
    .digest('hex')
}

function canonicalArgumentValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('tool arguments must contain JSON values')
    return value
  }
  if (typeof value !== 'object') throw new TypeError('tool arguments must contain JSON values')
  if (seen.has(value)) throw new TypeError('tool arguments must contain acyclic JSON values')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => {
        if (!(index in value)) throw new TypeError('tool arguments must not contain sparse arrays')
        return canonicalArgumentValue(value[index], seen)
      })
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('tool arguments must contain JSON objects')
    }
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonicalArgumentValue(record[key], seen)])
    )
  } finally {
    seen.delete(value)
  }
}

function canonicalResultValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === undefined) throw new ResultNormalizationError('undefined')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return 0
    if (Number.isNaN(value)) throw new ResultNormalizationError('number:NaN')
    if (value === Number.POSITIVE_INFINITY) throw new ResultNormalizationError('number:Infinity')
    if (value === Number.NEGATIVE_INFINITY) throw new ResultNormalizationError('number:-Infinity')
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new ResultNormalizationError('number:unsafe-integer')
    }
    return value
  }
  if (typeof value === 'bigint') throw new ResultNormalizationError('bigint')
  if (typeof value === 'function') throw new ResultNormalizationError('function')
  if (typeof value === 'symbol') throw new ResultNormalizationError('symbol')
  if (seen.has(value)) throw new ResultNormalizationError('circular-reference')
  seen.add(value)
  try {
    if (value instanceof Date) throw new ResultNormalizationError('Date')
    if (Buffer.isBuffer(value)) throw new ResultNormalizationError('Buffer')
    if (value instanceof Map) throw new ResultNormalizationError('Map')
    if (value instanceof Set) throw new ResultNormalizationError('Set')
    if (value instanceof RegExp) throw new ResultNormalizationError('RegExp')
    if (ArrayBuffer.isView(value)) {
      throw new ResultNormalizationError(value.constructor?.name || 'typed-array')
    }
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => {
        if (!Object.hasOwn(value, index)) throw new ResultNormalizationError('sparse-array')
        return canonicalResultValue(readResultProperty(value, index), seen)
      })
    }
    const prototype = readResultPrototype(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ResultNormalizationError('custom-prototype')
    }
    const record = value as Record<string, unknown>
    const keys = readResultKeys(record)
    return Object.fromEntries(keys.sort().map((key) => [
      key,
      canonicalResultValue(readResultProperty(record, key), seen)
    ]))
  } catch (error) {
    if (error instanceof ResultNormalizationError) throw error
    throw new ResultNormalizationError('property-access-failed')
  } finally {
    seen.delete(value)
  }
}

function readResultKeys(value: object): string[] {
  try {
    return Object.keys(value)
  } catch {
    throw new ResultNormalizationError('property-access-failed')
  }
}

function readResultPrototype(value: object): object | null {
  try {
    return Object.getPrototypeOf(value)
  } catch {
    throw new ResultNormalizationError('property-access-failed')
  }
}

function readResultProperty(value: object, key: PropertyKey): unknown {
  try {
    return (value as Record<PropertyKey, unknown>)[key]
  } catch {
    throw new ResultNormalizationError('property-access-failed')
  }
}

function normalizeSemantic(
  semantic: ToolHostResult['semantic'],
  fallbackCapabilityClass: string
): ToolHostResult['semantic'] {
  try {
    const parsed = ToolHostSemanticSchema.safeParse(semantic)
    if (parsed.success) return parsed.data
  } catch {
    // Host metadata is advisory and must never strand an executed effect.
  }
  return { capabilityClass: fallbackCapabilityClass, resourceKeys: [] }
}

function normalizationFailureItem(
  rawItem: unknown,
  call: ToolCallLike,
  context: Pick<ToolHostContext, 'threadId' | 'turnId'>,
  error: unknown
): ToolHostResult['item'] {
  const source = rawItem && typeof rawItem === 'object' ? rawItem as Record<string, unknown> : {}
  const type = error instanceof ResultNormalizationError ? error.type : 'invalid-tool-result'
  return TurnItemSchema.parse({
    id: safeStringProperty(source, 'id') ?? `item_${call.callId}`,
    turnId: safeStringProperty(source, 'turnId') ?? nonEmptyOrFallback(context.turnId, 'unknown-turn'),
    threadId: safeStringProperty(source, 'threadId') ?? nonEmptyOrFallback(context.threadId, 'unknown-thread'),
    role: 'tool',
    status: 'failed',
    createdAt: safeStringProperty(source, 'createdAt') ?? '1970-01-01T00:00:00.000Z',
    finishedAt: safeStringProperty(source, 'finishedAt') ?? '1970-01-01T00:00:00.000Z',
    kind: 'tool_result',
    toolName: call.toolName,
    callId: call.callId,
    toolKind: call.toolKind ?? 'tool_call',
    output: {
      code: 'tool_result_not_strict_json',
      error: 'tool result was not strict JSON',
      type
    },
    isError: true
  })
}

function safeStringProperty(source: Record<string, unknown>, key: string): string | undefined {
  try {
    const value = source[key]
    return typeof value === 'string' && value ? value : undefined
  } catch {
    return undefined
  }
}

function requireNonEmptyString(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} must be nonempty`)
  return value
}

function nonEmptyOrFallback(value: string, fallback: string): string {
  return value.trim() ? value : fallback
}

class ResultNormalizationError extends Error {
  constructor(readonly type: string) {
    super(type)
  }
}
