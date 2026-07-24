import { z } from 'zod'

const NonEmptyString = z.string().trim().min(1)

export const ChildRunUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  cachedTokens: z.number().int().nonnegative().optional(),
  cacheHitTokens: z.number().int().nonnegative().optional(),
  cacheMissTokens: z.number().int().nonnegative().optional(),
  cacheHitRate: z.number().min(0).max(1).nullable().optional(),
  turns: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  costCny: z.number().nonnegative().optional(),
  cacheSavingsUsd: z.number().nonnegative().optional(),
  cacheSavingsCny: z.number().nonnegative().optional(),
  tokenEconomySavingsTokens: z.number().int().nonnegative().optional(),
  tokenEconomySavingsUsd: z.number().nonnegative().optional(),
  tokenEconomySavingsCny: z.number().nonnegative().optional()
}).strict()
export type ChildRunUsage = z.infer<typeof ChildRunUsageSchema>

/**
 * 委派作用域 — 区分子 agent 的来源：
 * - `root_turn`：kernel_v3 路径下从主 turn 委派的子任务。
 * - `graph_node`：evented_v2 路径下从图节点委派的子任务。
 * 来源：KWorks delegation.ts（DelegationScopeSchema）。
 */
export const DelegationScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('root_turn') }).strict(),
  z.object({
    kind: z.literal('graph_node'),
    graphPublicKey: NonEmptyString,
    ownerAgentPublicKey: NonEmptyString,
    depth: z.literal(1)
  }).strict()
])
export type DelegationScope = z.infer<typeof DelegationScopeSchema>

/**
 * 子 agent 运行记录 — 委派运行时持久化，执行投影适配器读取以构建委派树。
 * 来源：KWorks delegation.ts（ChildRunRecordSchema）。
 */
export const ChildRunRecordSchema = z.object({
  id: NonEmptyString,
  parentThreadId: NonEmptyString,
  parentTurnId: NonEmptyString,
  publicKey: NonEmptyString.optional(),
  sequence: z.number().int().positive().optional(),
  scope: DelegationScopeSchema.default({ kind: 'root_turn' }),
  transcriptRef: NonEmptyString.optional(),
  label: z.string().optional(),
  prompt: NonEmptyString,
  workspace: z.string().optional(),
  model: z.string().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'aborted']),
  summary: z.string().optional(),
  error: z.string().optional(),
  usage: ChildRunUsageSchema.default({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
export type ChildRunRecord = z.infer<typeof ChildRunRecordSchema>
