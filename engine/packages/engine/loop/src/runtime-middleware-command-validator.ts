import {
  CommittedEffectRefSchema,
  EffectIntentSchema,
  RecoveryStateSchema,
  RunOutcomeSchema,
  type BudgetState
} from '@qiongqi/contracts'
import type { MiddlewareCommand } from './runtime-middleware.js'

const budgetKeys = [
  'stepsUsed',
  'toolCallsUsed',
  'inputTokens',
  'outputTokens',
  'costUsd'
] as const

type BudgetKey = typeof budgetKeys[number]

export function canonicalizeMiddlewareCommands(value: unknown): MiddlewareCommand[] {
  if (!Array.isArray(value)) {
    throw new Error('invalid middleware commands: expected an array')
  }
  return value.map((command, index) => {
    const rawType = commandTypeLabel(command)
    try {
      return parseMiddlewareCommand(canonicalizeJson(command, 'middleware command'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`invalid middleware command at index ${index} (${rawType}): ${message}`)
    }
  })
}

function parseMiddlewareCommand(value: unknown): MiddlewareCommand {
  const record = requireRecord(value, 'command')
  const rawType = requireNonEmptyString(record.type, 'command type')
  const type = rawType as MiddlewareCommand['type']

  switch (type) {
    case 'set-middleware-state': {
      assertOnlyKeys(record, ['type', 'id', 'state'])
      const state = requireRecord(record.state, 'middleware state')
      assertOnlyKeys(state, ['version', 'data'])
      if (!hasOwn(state, 'data')) throw new Error('middleware state data is required')
      return {
        type,
        id: requireNonEmptyString(record.id, 'middleware id'),
        state: {
          version: requirePositiveSafeInteger(state.version, 'middleware state version'),
          data: state.data
        }
      }
    }
    case 'set-budget': {
      assertOnlyKeys(record, ['type', 'key', 'value'])
      const key = requireBudgetKey(record.key, 'budget key')
      return { type, key, value: requireBudgetValue(key, record.value) }
    }
    case 'add-budget': {
      assertOnlyKeys(record, ['type', 'delta', 'usageId'])
      const usageId = record.usageId === undefined
        ? undefined
        : requireNonEmptyString(record.usageId, 'budget usage id')
      return {
        type,
        delta: parseBudgetDelta(record.delta),
        ...(usageId === undefined ? {} : { usageId })
      }
    }
    case 'set-node-data':
      assertOnlyKeys(record, ['type', 'nodeId', 'value'])
      if (!hasOwn(record, 'value')) throw new Error('node data value is required')
      return {
        type,
        nodeId: requireNonEmptyString(record.nodeId, 'node data id'),
        value: record.value
      }
    case 'set-task-revision':
      assertOnlyKeys(record, ['type', 'revision'])
      return {
        type,
        revision: requireNonNegativeSafeInteger(record.revision, 'task revision')
      }
    case 'set-recovery':
      assertOnlyKeys(record, ['type', 'recovery'])
      return { type, recovery: RecoveryStateSchema.parse(record.recovery) }
    case 'set-effects':
      assertOnlyKeys(record, ['type', 'pendingEffects', 'committedEffects'])
      return {
        type,
        pendingEffects: EffectIntentSchema.array().parse(record.pendingEffects),
        committedEffects: CommittedEffectRefSchema.array().parse(record.committedEffects)
      }
    case 'jump':
      assertOnlyKeys(record, ['type', 'nodeId', 'condition', 'reason'])
      return {
        type,
        nodeId: requireNonEmptyString(record.nodeId, 'jump node id'),
        condition: requireNonEmptyString(record.condition, 'jump condition'),
        reason: requireNonEmptyString(record.reason, 'jump reason')
      }
    case 'terminate': {
      assertOnlyKeys(record, ['type', 'outcome'])
      const outcome = RunOutcomeSchema.parse(record.outcome)
      if (outcome.status === 'suspended') {
        throw new Error('terminate outcome must not be suspended')
      }
      return { type, outcome }
    }
    case 'suspend': {
      assertOnlyKeys(record, ['type', 'outcome'])
      const outcome = RunOutcomeSchema.parse(record.outcome)
      if (outcome.status !== 'suspended') {
        throw new Error('suspend outcome must be suspended')
      }
      return { type, outcome }
    }
    case 'retry':
      assertOnlyKeys(record, ['type', 'reason'])
      return { type, reason: requireNonEmptyString(record.reason, 'retry reason') }
    case 'repair-history':
      assertOnlyKeys(record, ['type', 'items'])
      if (!Array.isArray(record.items)) throw new Error('history repair items must be an array')
      return { type, items: record.items }
    case 'record-warning':
      assertOnlyKeys(record, ['type', 'code', 'message'])
      return {
        type,
        code: requireNonEmptyString(record.code, 'warning code'),
        message: requireNonEmptyString(record.message, 'warning message')
      }
    default:
      return rejectUnknownCommand(type, rawType)
  }
}

function parseBudgetDelta(value: unknown): Partial<BudgetState> {
  try {
    const record = requireRecord(value, 'budget delta')
    const delta: Partial<Record<BudgetKey, number>> = {}
    for (const [rawKey, rawValue] of Object.entries(record)) {
      const key = requireBudgetKey(rawKey, 'budget delta key')
      delta[key] = requireBudgetValue(key, rawValue)
    }
    return delta
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid budget delta: ${message}`)
  }
}

function requireBudgetKey(value: unknown, label: string): BudgetKey {
  if (typeof value !== 'string' || !budgetKeys.includes(value as BudgetKey)) {
    throw new Error(`${label} is invalid: ${String(value)}`)
  }
  return value as BudgetKey
}

function requireBudgetValue(key: BudgetKey, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`budget value is invalid: ${key}`)
  }
  if (key !== 'costUsd' && !Number.isSafeInteger(value)) {
    throw new Error(`budget value must be a safe integer: ${key}`)
  }
  return value
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive safe integer`)
  }
  return value as number
}

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`)
  }
  return value as number
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a nonempty string`)
  }
  return value
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new Error(`unexpected command field: ${key}`)
  }
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function canonicalizeJson(value: unknown, label: string): unknown {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error(`${label} must be JSON serializable`)
  }
  if (serialized === undefined) throw new Error(`${label} must be JSON serializable`)
  return JSON.parse(serialized) as unknown
}

function commandTypeLabel(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown'
  const type = (value as Record<string, unknown>).type
  return typeof type === 'string' && type ? type : 'unknown'
}

function rejectUnknownCommand(type: never, rawType: string): never {
  void type
  throw new Error(`unknown middleware command type: ${rawType}`)
}
