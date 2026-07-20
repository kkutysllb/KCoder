import { createHash } from 'node:crypto'
import type {
  RunIdentity,
  TaskAction,
  TaskStateV1,
  TaskToolLedgerEntry,
  ThreadRecord,
  Turn,
  TurnItem
} from '@qiongqi/contracts'
import { makeTaskState } from '@qiongqi/contracts'

export type BuildTaskStateInput = {
  identity: RunIdentity
  thread: ThreadRecord
  turn: Turn
  items: readonly TurnItem[]
  activeSkillIds?: readonly string[]
  nowIso: () => string
}

type ObjectiveSource = {
  id: string
  text: string
}

export function buildTaskState(input: BuildTaskStateInput): TaskStateV1 {
  assertTaskInputScope(input)
  const objective = resolveObjective(input)
  if (!objective) throw new Error('task objective source unavailable')

  const completedActions: TaskAction[] = []
  const pendingActions: TaskAction[] = []
  for (const todo of input.thread.todos?.items ?? []) {
    const action: TaskAction = {
      id: todo.id,
      text: todo.content,
      status: todo.status,
      evidenceItemIds: []
    }
    if (todo.status === 'completed') completedActions.push(action)
    else pendingActions.push(action)
  }

  const toolLedger = buildToolLedger(input.items)
  const sourceItemIds = unique([
    objective.id,
    ...(input.thread.todos?.items.map((todo) => `todo:${todo.id}`) ?? []),
    ...toolLedger.map((entry) => `tool:${entry.callId}`)
  ])
  const now = input.nowIso()
  const activePlan = activePlanFromInput(input)

  return makeTaskState({
    identity: input.identity,
    revision: 1,
    source: {
      objectiveItemId: objective.id,
      sourceItemIds,
      sourceDigest: digestValue({
        identity: input.identity,
        objective,
        todos: input.thread.todos?.items ?? [],
        toolLedger
      })
    },
    objective: objective.text,
    constraints: [],
    completedActions,
    pendingActions,
    ...(activePlan ? { activePlan } : {}),
    activeSkillIds: unique(input.activeSkillIds ?? input.turn.activeSkillIds),
    artifacts: [],
    toolLedger,
    createdAt: now,
    updatedAt: now
  })
}

export function isContinuationOnlyTaskMessage(text: string): boolean {
  const compact = text
    .replace(/[。.!！?？,，;；:\s]+/g, '')
    .trim()
    .toLowerCase()
  if (!compact) return true
  return /^(继续|接着|继续推进|继续做|全部做|都做|开始吧|执行|接着来|往下做|goon|continue|proceed|doit|doall)$/.test(compact)
}

function assertTaskInputScope(input: BuildTaskStateInput): void {
  const owner = input.thread.ownerUserId ?? 'local-default-owner'
  if (
    owner !== input.identity.ownerUserId ||
    input.thread.id !== input.identity.threadId ||
    input.thread.workspace !== input.identity.workspaceKey ||
    input.turn.id !== input.identity.turnId ||
    input.turn.threadId !== input.identity.threadId
  ) {
    throw new Error('task state input scope mismatch')
  }
}

function resolveObjective(input: BuildTaskStateInput): ObjectiveSource | undefined {
  const currentItems = input.items.filter(
    (item): item is Extract<TurnItem, { kind: 'user_message' }> =>
      item.kind === 'user_message' && item.turnId === input.turn.id
  )
  for (let index = currentItems.length - 1; index >= 0; index -= 1) {
    const item = currentItems[index]!
    const text = userItemTaskText(item)
    if (text && !isContinuationOnlyTaskMessage(text)) return { id: item.id, text }
  }

  const prompt = input.turn.prompt.trim()
  if (prompt && !isContinuationOnlyTaskMessage(prompt)) {
    return { id: `turn:${input.turn.id}:prompt`, text: prompt }
  }

  if (input.thread.goal?.status === 'active' && input.thread.goal.objective.trim()) {
    return {
      id: `goal:${input.thread.id}:${input.thread.goal.createdAt}`,
      text: input.thread.goal.objective.trim()
    }
  }

  for (let index = input.items.length - 1; index >= 0; index -= 1) {
    const item = input.items[index]
    if (item?.kind !== 'user_message') continue
    const text = userItemTaskText(item)
    if (text && !isContinuationOnlyTaskMessage(text)) return { id: item.id, text }
  }
  return undefined
}

function userItemTaskText(item: Extract<TurnItem, { kind: 'user_message' }>): string {
  return (item.displayText?.trim() || item.text.trim())
}

function buildToolLedger(items: readonly TurnItem[]): TaskToolLedgerEntry[] {
  const calls = new Map<string, Extract<TurnItem, { kind: 'tool_call' }>>()
  const results = new Map<string, Extract<TurnItem, { kind: 'tool_result' }>>()
  for (const item of items) {
    if (item.kind === 'tool_call') calls.set(item.callId, item)
    if (item.kind === 'tool_result') results.set(item.callId, item)
  }

  const ledger: TaskToolLedgerEntry[] = []
  for (const [callId, call] of calls) {
    const result = results.get(callId)
    if (!result) {
      ledger.push({
        callId,
        toolName: call.toolName,
        status: call.status === 'failed' ? 'failed' : 'prepared'
      })
      continue
    }
    const failed = result.isError || result.status === 'failed' || result.status === 'aborted'
    ledger.push({
      callId,
      toolName: call.toolName,
      status: failed ? 'failed' : 'committed',
      resultDigest: digestValue(result.output)
    })
  }
  return ledger
}

function activePlanFromInput(input: BuildTaskStateInput): TaskStateV1['activePlan'] {
  if (input.turn.guiPlan) {
    return {
      planId: input.turn.guiPlan.planId,
      relativePath: input.turn.guiPlan.relativePath
    }
  }
  const source = input.thread.todos?.items.find((todo) => todo.source)?.source
  return source ? { planId: source.planId, relativePath: source.relativePath } : undefined
}

function digestValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]))
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))]
}
