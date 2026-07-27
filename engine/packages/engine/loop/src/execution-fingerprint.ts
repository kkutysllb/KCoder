import { createHash } from 'node:crypto'
import {
  ImmutableProfileRefSchema,
  TaskScopeSchema,
  type ImmutableProfileRef,
  type TaskScope
} from '@qiongqi/contracts'
import type { ToolCallLike } from '@qiongqi/ports'

export interface ToolExactFingerprintInput {
  scope: TaskScope
  call: ToolCallLike
  resourceVersions: Readonly<Record<string, string>>
}

export interface ModelLogicalRequestKeyInput {
  scope: TaskScope
  kernelRunId: string
  taskRevision: number
  contextRevision: number
  strategyDigest: string
}

export interface ModelRequestFingerprintInput {
  logical: ModelLogicalRequestKeyInput
  profileRef: ImmutableProfileRef
  request: unknown
}

export interface ProgressFingerprintInput {
  taskRevision: number
  evidenceDigests: readonly string[]
  artifactDigests: readonly string[]
  decisionDigests: readonly string[]
  resourceDigests: Readonly<Record<string, string>>
  attemptedStrategyDigests: readonly string[]
}

export interface StrategyDigestInput {
  strategy: unknown
  correctionFacts: readonly unknown[]
}

export function canonicalDigest(value: unknown): string {
  const canonical = canonicalize(value, '$')
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function toolExactFingerprint(input: ToolExactFingerprintInput): string {
  const scope = TaskScopeSchema.parse(input.scope)
  if (!input.call.toolName?.trim()) throw new TypeError('toolName must be non-empty')
  return canonicalDigest({
    kind: 'tool_exact_v1',
    scope,
    toolName: input.call.toolName,
    arguments: input.call.arguments,
    resourceVersions: input.resourceVersions
  })
}

export function modelLogicalRequestKey(input: ModelLogicalRequestKeyInput): string {
  return canonicalDigest({
    kind: 'model_logical_request_v1',
    scope: TaskScopeSchema.parse(input.scope),
    kernelRunId: requireNonEmpty(input.kernelRunId, 'kernelRunId'),
    taskRevision: requireRevision(input.taskRevision, 'taskRevision'),
    contextRevision: requireRevision(input.contextRevision, 'contextRevision'),
    strategyDigest: requireNonEmpty(input.strategyDigest, 'strategyDigest')
  })
}

export function modelRequestFingerprint(input: ModelRequestFingerprintInput): string {
  return canonicalDigest({
    kind: 'model_request_v1',
    logicalRequestKey: modelLogicalRequestKey(input.logical),
    profileRef: ImmutableProfileRefSchema.parse(input.profileRef),
    request: input.request
  })
}

export function progressFingerprint(input: ProgressFingerprintInput): string {
  return canonicalDigest({
    kind: 'progress_v1',
    taskRevision: requireRevision(input.taskRevision, 'taskRevision'),
    evidenceDigests: input.evidenceDigests,
    artifactDigests: input.artifactDigests,
    decisionDigests: input.decisionDigests,
    resourceDigests: input.resourceDigests,
    attemptedStrategyDigests: input.attemptedStrategyDigests
  })
}

export function strategyDigest(input: StrategyDigestInput): string {
  return canonicalDigest({
    kind: 'strategy_v1',
    strategy: input.strategy,
    correctionFacts: input.correctionFacts
  })
}

function canonicalize(value: unknown, path: string): unknown {
  if (value === undefined) throw new TypeError(`undefined is not allowed in canonical input at ${path}`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`non-finite number is not allowed at ${path}`)
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (!(index in value)) throw new TypeError(`sparse arrays are not allowed at ${path}[${index}]`)
      return canonicalize(entry, `${path}[${index}]`)
    })
  }
  if (typeof value !== 'object') throw new TypeError(`unsupported canonical value at ${path}`)

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`only plain objects are allowed at ${path}`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`symbol keys are not allowed at ${path}`)
  }

  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    output[key] = canonicalize((value as Record<string, unknown>)[key], `${path}.${key}`)
  }
  return output
}

function requireRevision(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name} must be a nonnegative integer`)
  return value
}

function requireNonEmpty(value: string, name: string): string {
  if (value.length === 0 || value !== value.trim()) throw new TypeError(`${name} must be a canonical non-empty string`)
  return value
}
