import { z } from 'zod'
import { TurnItem } from './items.js'
import { isGuiPlanRelativePath } from './gui-plan.js'
import { ApprovalPolicySchema, SandboxModeSchema } from './policy.js'
import { RuntimeCapabilitySnapshotSchema } from './capabilities.js'

/**
 * Mode enum, inlined here (instead of importing `ThreadMode` from
 * `threads.js`) to avoid a `threads <-> turns` module init cycle:
 * `threads.ts` already imports `TurnSchema` from this file. The two
 * literals must stay in sync with `ThreadMode` in `threads.ts`.
 */
const TurnModeSchema = z.enum(['agent', 'plan'])

/**
 * 每回合协作策略。驱动运行时编排模式选择：
 * - `single` — 稳定的单 agent 基线（kernel_v3）。
 * - `auto`   — 声明式多 agent 编排（evented_v2），manager 可调度 specialist。
 * 来源：KWorks turns.ts（CollaborationPolicySchema）。
 */
export const CollaborationPolicySchema = z.enum(['single', 'auto'])
export type CollaborationPolicy = z.infer<typeof CollaborationPolicySchema>

/**
 * 编排偏好（新 API）：standard = 单 agent 标准模式，team = 多 agent 团队模式。
 * 来源：KWorks turns.ts（OrchestrationPreferenceSchema）。
 */
export const OrchestrationPreferenceSchema = z.enum(['standard', 'team'])
export type OrchestrationPreference = z.infer<typeof OrchestrationPreferenceSchema>

/**
 * 运行时编排决策 — 决策服务决定每个 turn 的编排模式后持久化到此结构。
 * 不可变：一旦持久化到 Turn.runtimeDecision，后续 runTurn 重新调用 decide() 命中幂等门直接返回。
 * 来源：KWorks turns.ts（RuntimeDecisionSchema）。
 */
export const RuntimeDecisionSchema = z.object({
  preferredMode: z.enum(['kernel_v3', 'evented_v2']),
  effectiveMode: z.enum(['classic', 'kernel_v3', 'evented_v2']),
  preference: OrchestrationPreferenceSchema,
  source: z.enum(['turn', 'default', 'legacy', 'server_override']),
  reasonCode: z.string().min(1),
  reason: z.string().min(1),
  fallbackReasonCode: z.string().min(1).optional(),
  fallbackReason: z.string().min(1).optional(),
  rolloutStage: z.enum(['off', 'shadow', 'canary', 'default']),
  capabilityRevision: z.string().min(1).optional(),
  decidedAt: z.string().min(1)
}).strict()
export type RuntimeDecision = z.infer<typeof RuntimeDecisionSchema>

export const TurnReasoningEffortSchema = z.enum(['auto', 'off', 'low', 'medium', 'high', 'max'])
export type TurnReasoningEffort = z.infer<typeof TurnReasoningEffortSchema>

/**
 * Plan operation kinds the renderer can advertise on a plan turn.
 * Mirrors the shared renderer contract so request metadata stays
 * stable across reconnects and replays.
 */
export const GuiPlanOperationSchema = z.enum(['draft', 'refine'])
export type GuiPlanOperationJson = z.infer<typeof GuiPlanOperationSchema>

/**
 * Plan context the renderer can attach to a `StartTurnRequest`. The
 * thread mode is carried on the thread record; this struct adds the
 * reserved path and source request needed to scope `create_plan`.
 */
export const GuiPlanContextSchema = z.object({
  operation: GuiPlanOperationSchema,
  workspaceRoot: z.string().min(1),
  relativePath: z
    .string()
    .min(1)
    .refine(isGuiPlanRelativePath, {
      message: 'relativePath must be a direct Markdown file under .qiongqisdd/plan'
    }),
  planId: z.string().min(1),
  sourceRequest: z.string().optional(),
  title: z.string().optional()
})
export type GuiPlanContextJson = z.infer<typeof GuiPlanContextSchema>

export const TurnStatus = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'aborted'
])
export type TurnStatus = z.infer<typeof TurnStatus>

export const TurnSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  status: TurnStatus,
  prompt: z.string(),
  model: z.string().optional(),
  reasoningEffort: TurnReasoningEffortSchema.optional(),
  /** Steered text queued by the user mid-turn. Cleared on completion. */
  steering: z.array(z.string()).default([]),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  items: z.array(TurnItem).default([]),
  attachmentIds: z.array(z.string().min(1)).default([]),
  workModeId: z.string().min(1).optional(),
  activeSkillIds: z.array(z.string().min(1)).default([]),
  explicitSkillIds: z.array(z.string().min(1)).default([]),
  injectedMemoryIds: z.array(z.string().min(1)).default([]),
  skillInjectionBytes: z.number().int().nonnegative().optional(),
  toolCatalogFingerprint: z.string().optional(),
  toolCatalogToolCount: z.number().int().nonnegative().optional(),
  toolCatalogDrift: z.boolean().optional(),
  guiPlan: GuiPlanContextSchema.optional(),
  /**
   * Optional per-turn mode override. When set, it takes precedence over
   * the thread mode for this turn (e.g. a Plan-mode turn inside an
   * otherwise agent thread, or a Build turn that runs as agent).
   */
  mode: TurnModeSchema.optional(),
  /** 每回合协作策略（遗留字段，single=kernel_v3, auto=evented_v2）。优先级低于 orchestrationPreference。 */
  collaborationPolicy: CollaborationPolicySchema.optional(),
  /** 编排偏好（新 API）：standard（标准/单 agent）或 team（团队/多 agent）。 */
  orchestrationPreference: OrchestrationPreferenceSchema.optional(),
  /** 编排决策记录（决策服务持久化，不可变）。 */
  runtimeDecision: RuntimeDecisionSchema.optional(),
  /** 决策时的能力快照（与 runtimeDecision 配套持久化）。 */
  runtimeCapabilitySnapshot: RuntimeCapabilitySnapshotSchema.optional(),
  /** 下一个 agent 执行序号（递增分配，投影排序用）。 */
  nextExecutionSequence: z.number().int().positive().optional(),
  /** evented_v2 多 agent 运行的 id（链接 Turn ↔ MultiAgentRun）。 */
  eventedV2RunId: z.string().min(1).optional(),
  error: z.string().optional()
})
export type Turn = z.infer<typeof TurnSchema>

export const StartTurnRequest = z.object({
  prompt: z.string().min(1),
  displayText: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: TurnReasoningEffortSchema.optional(),
  approvalPolicy: ApprovalPolicySchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  workModeId: z.string().min(1).optional(),
  /**
   * Optional per-turn mode. Overrides the thread mode for this turn so
   * the GUI can toggle Plan/agent without recreating the thread. In Plan
   * mode Qiongqi advertises `create_plan` for the whole conversation.
   */
  mode: TurnModeSchema.optional(),
  /** 每回合协作策略（遗留字段，single=kernel_v3, auto=evented_v2）。 */
  collaborationPolicy: CollaborationPolicySchema.optional(),
  /** 编排偏好（新 API）：standard 或 team。与 collaborationPolicy 同时设置时不能冲突。 */
  orchestrationPreference: OrchestrationPreferenceSchema.optional(),
  attachments: z
    .array(
      z.object({
        path: z.string().min(1),
        name: z.string().min(1)
      })
    )
    .optional(),
  attachmentIds: z.array(z.string().min(1)).default([]),
  /**
   * Optional GUI plan context. When set, Qiongqi advertises the
   * `create_plan` tool for the turn and writes only to the reserved
   * path advertised in the context.
   */
  guiPlan: GuiPlanContextSchema.optional()
}).superRefine((request, ctx) => {
  if (!request.orchestrationPreference || !request.collaborationPolicy) return
  // auto 等价 team，single 等价 standard；两者同时设置时不能冲突。
  const legacyPreference = request.collaborationPolicy === 'auto' ? 'team' : 'standard'
  if (request.orchestrationPreference !== legacyPreference) {
    ctx.addIssue({
      code: 'custom',
      path: ['collaborationPolicy'],
      message: 'collaborationPolicy conflicts with orchestrationPreference'
    })
  }
})
export type StartTurnRequest = z.input<typeof StartTurnRequest>

export const StartTurnResponse = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  userMessageItemId: z.string().min(1)
})
export type StartTurnResponse = z.infer<typeof StartTurnResponse>

export const SteerTurnRequest = z.object({
  text: z.string().min(1)
})
export type SteerTurnRequest = z.infer<typeof SteerTurnRequest>

export const InterruptTurnRequest = z.object({
  /**
   * When true, discard generated items from the interrupted turn while
   * preserving the user's prompt. Omitted/false keeps the aborted items
   * visible for inspection.
   */
  discard: z.boolean().optional()
})
export type InterruptTurnRequest = z.infer<typeof InterruptTurnRequest>

export const InterruptTurnResponse = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  status: TurnStatus
})
export type InterruptTurnResponse = z.infer<typeof InterruptTurnResponse>

export const CompactRequest = z.object({
  reason: z.string().optional(),
  /** Optional explicit token budget. */
  budgetTokens: z.number().int().positive().optional()
})
export type CompactRequest = z.infer<typeof CompactRequest>

export const CompactResponse = z.object({
  threadId: z.string().min(1),
  replacedTokens: z.number().int().nonnegative(),
  summary: z.string(),
  pinnedConstraints: z.array(z.string()),
  sourceDigest: z.string().min(1).optional(),
  digestMarker: z.string().min(1).optional(),
  sourceItemIds: z.array(z.string().min(1)).optional()
})
export type CompactResponse = z.infer<typeof CompactResponse>
