# KWorks 引擎移植 — Phase 1: Contracts + Ports 扩展

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展 KCoder 的契约层（contracts）和端口层（ports），补齐多 agent 编排所需的全部数据结构，为后续阶段（specialist registry / turn runner / 决策服务 / 执行投影）奠定基础。

**Architecture:** 忠实移植 KWorks qiongqi 的 contracts/ports 定义到 KCoder 对应位置。契约层保持零依赖（仅 zod），端口层保持纯接口。同时清理 office/finance 残留模式。本阶段是纯数据结构层，不涉及运行时逻辑。

**Tech Stack:** TypeScript 5.x, Zod 3.x, Vitest 3.2.x, pnpm workspace（monorepo）

**参考设计文档:** `docs/superpowers/specs/2026-07-24-kworks-engine-migration-design.md`

**来源映射:** KWorks 路径 = `/Users/libing/kk_Projects/KWorks/qiongqi/packages/...`；KCoder 路径 = `engine/packages/...`

**全局验证命令:**
- 契约单测: `cd engine && pnpm test:unit`
- 递归类型检查: `cd engine && pnpm typecheck`

---

## 文件结构总览

本阶段创建/修改的文件（按依赖顺序）：

| 动作 | 文件 | 职责 |
|---|---|---|
| 修改 | `engine/packages/foundation/contracts/src/usage.ts` | 确认 `UsageSnapshotSchema` 已存在（AgentRunSchema 依赖） |
| 修改 | `engine/packages/foundation/contracts/src/capabilities.ts` | 补 `AgentGraphCapabilityConfig`、`RuntimeCapabilitySnapshotSchema`；清理 office/finance 模式；清理 locked skill ids |
| 修改 | `engine/packages/foundation/contracts/src/multi-agent-runtime.ts` | 补 `ManagerRouteDecisionSchema`、`AgentGraphSnapshotSchema`；扩展 `AgentRunSchema`、`MultiAgentRunSchema` |
| 修改 | `engine/packages/foundation/contracts/src/turns.ts` | 补 `OrchestrationPreference`、`CollaborationPolicy`、`RuntimeDecisionSchema`；扩展 `TurnSchema`、`StartTurnRequest` |
| 创建 | `engine/packages/foundation/contracts/src/turn-execution.ts` | `TurnExecutionView` 联合类型 + 相关视图类型 |
| 修改 | `engine/packages/foundation/contracts/src/index.ts` | barrel 导出 `turn-execution.js` |
| 创建 | `engine/packages/ports-layer/ports/src/agent-transcript-store.ts` | `AgentTranscriptStore` 接口 |
| 创建 | `engine/packages/ports-layer/ports/src/delegation-run-store.ts` | `DelegationRunStore` 接口 |
| 修改 | `engine/packages/ports-layer/ports/src/index.ts` | barrel 导出两个新端口 |
| 创建 | `engine/tests/phase1-contracts-ports.test.ts` | 契约/端口的 round-trip 单测 |

**关键依赖链（必须按此顺序）:**
1. `capabilities.ts`（`AgentGraphCapabilityConfig` + `RuntimeCapabilitySnapshotSchema`）先于 `turns.ts`
2. `turns.ts` 的 `RuntimeDecisionSchema` 依赖 `capabilities.ts` 的 `RuntimeCapabilitySnapshotSchema` 和自身的 `OrchestrationPreference`
3. `multi-agent-runtime.ts` 的 `AgentGraphSnapshotSchema` 依赖 `ManagerRouteDecisionSchema`（同文件内，顺序定义）
4. `turn-execution.ts` 无外部依赖（仅 zod + 本文件内类型）

---

## Task 1: 扩展 capabilities.ts — 补 AgentGraphCapabilityConfig 与 RuntimeCapabilitySnapshotSchema

**Files:**
- Modify: `engine/packages/foundation/contracts/src/capabilities.ts`（在 `SubagentsCapabilityConfig` 定义之后，约 line 470-496 区域）

KCoder 已有 `SubagentsCapabilityConfig`（line 462-470），但缺 `AgentGraphCapabilityConfig` 和 `RuntimeCapabilitySnapshotSchema`。这两个类型是 `TurnSchema.runtimeCapabilitySnapshot` 和编排决策服务的依赖。

- [ ] **Step 1: 写失败测试 — 验证 RuntimeCapabilitySnapshotSchema 和 AgentGraphCapabilityConfig 可导入且可 parse**

在 `engine/tests/phase1-contracts-ports.test.ts` 顶部追加（若文件不存在则创建）：

```ts
import { describe, expect, it } from 'vitest'
import {
  AgentGraphCapabilityConfig,
  RuntimeCapabilitySnapshotSchema,
  SubagentsCapabilityConfig
} from '@qiongqi/contracts'

describe('capabilities: agent graph + runtime snapshot', () => {
  it('AgentGraphCapabilityConfig parses a valid enabled config', () => {
    const parsed = AgentGraphCapabilityConfig.parse({
      enabled: true,
      reason: 'agent graph available'
    })
    expect(parsed.enabled).toBe(true)
  })

  it('RuntimeCapabilitySnapshotSchema parses with subagents + agentGraph', () => {
    const parsed = RuntimeCapabilitySnapshotSchema.parse({
      revision: 'cap_abc123',
      subagents: { enabled: true, maxParallel: 4, maxChildRuns: 16 },
      agentGraph: { enabled: true, maxParallelNodes: 4, maxActivatedSpecialists: 10, maxRetriesPerNode: 2, maxDurationMs: 600000 }
    })
    expect(parsed.revision).toBe('cap_abc123')
    expect(parsed.agentGraph.enabled).toBe(true)
  })

  it('SubagentsCapabilityConfig still parses (unchanged)', () => {
    const parsed = SubagentsCapabilityConfig.parse({ enabled: true, maxParallel: 2, maxChildRuns: 8 })
    expect(parsed.enabled).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: FAIL — `AgentGraphCapabilityConfig` 和 `RuntimeCapabilitySnapshotSchema` 未导出（import 报错）

- [ ] **Step 3: 实现 — 在 capabilities.ts 中补两个定义**

先 Read 文件确认 `SubagentsCapabilityConfig` 之后的精确内容（line 462-496 区域），然后在 `SubagentsCapabilityConfig` 定义之后、`AttachmentsCapabilityConfig` 之前，插入：

```ts
export const AgentGraphCapabilityConfig = CapabilityToggleConfig.extend({
  /** 并行执行的 agent 节点上限。 */
  maxParallelNodes: z.number().int().positive().default(4),
  /** 单次路由可激活的 specialist 数量上限。 */
  maxActivatedSpecialists: z.number().int().nonnegative().default(10),
  /** 每个节点的最大重试次数。 */
  maxRetriesPerNode: z.number().int().nonnegative().default(2),
  /** 单次运行的最大时长（毫秒）。 */
  maxDurationMs: z.number().int().positive().default(600000)
})
export type AgentGraphCapabilityConfig = z.output<typeof AgentGraphCapabilityConfig>

/**
 * 运行时能力快照 — 决策服务在决定编排模式时读取，并持久化到 Turn 上。
 * revision 是内容哈希前缀（cap_<sha256_16hex>），用于幂等校验。
 */
export const RuntimeCapabilitySnapshotSchema = z.object({
  revision: z.string().min(1),
  subagents: SubagentsCapabilityConfig,
  agentGraph: AgentGraphCapabilityConfig
}).strict()
export type RuntimeCapabilitySnapshot = z.infer<typeof RuntimeCapabilitySnapshotSchema>
```

> 来源: KWorks `capabilities.ts` line 479-503。字段语义注释用中文（对齐 KCoder 中文项目定位）。`CapabilityToggleConfig` 已存在于 KCoder（line 36），提供 `enabled` + `reason` 字段。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: PASS — 3 个测试全过

- [ ] **Step 5: 提交**

```bash
git add engine/packages/foundation/contracts/src/capabilities.ts engine/tests/phase1-contracts-ports.test.ts
git commit -m "feat(contracts): 补 AgentGraphCapabilityConfig 与 RuntimeCapabilitySnapshotSchema

为编排模式决策提供能力快照数据结构（来源 KWorks capabilities.ts）"
```

---

## Task 2: 扩展 multi-agent-runtime.ts — 补 ManagerRouteDecision 与 AgentGraphSnapshot

**Files:**
- Modify: `engine/packages/foundation/contracts/src/multi-agent-runtime.ts`（在 `AgentGraphSchema` 之后、`TaskEnvelopeSchema` 之前，约 line 84-86 区域）

KCoder 有 `AgentGraph`（line 77-84），但缺 `ManagerRouteDecisionSchema`（manager 路由决策）和 `AgentGraphSnapshotSchema`（不可变快照）。这两个是多 agent 编排的核心数据结构。

- [ ] **Step 1: 写失败测试 — 验证两个新 schema 可导入且 round-trip**

在 `phase1-contracts-ports.test.ts` 追加 describe 块：

```ts
import {
  ManagerRouteDecisionSchema,
  AgentGraphSnapshotSchema
} from '@qiongqi/contracts'

describe('multi-agent-runtime: route decision + graph snapshot', () => {
  it('ManagerRouteDecisionSchema parses empty specialists (manager 自答)', () => {
    const parsed = ManagerRouteDecisionSchema.parse({
      summary: '简单任务，manager 直接处理',
      specialists: []
    })
    expect(parsed.specialists).toHaveLength(0)
  })

  it('ManagerRouteDecisionSchema parses routed specialists with dependencies', () => {
    const parsed = ManagerRouteDecisionSchema.parse({
      summary: '全栈功能开发',
      specialists: [
        { specialistId: 'backend', task: '实现 API', dependsOn: [], required: true },
        { specialistId: 'frontend', task: '实现 UI', dependsOn: ['backend'], required: true }
      ]
    })
    expect(parsed.specialists).toHaveLength(2)
    expect(parsed.specialists[1].dependsOn).toEqual(['backend'])
  })

  it('AgentGraphSnapshotSchema parses a valid team graph', () => {
    const parsed = AgentGraphSnapshotSchema.parse({
      version: 1,
      publicKey: 'graph_abc',
      templateId: 'manager-specialists-v1',
      registryRevision: 'reg_v1',
      startNodeId: 'manager_planning',
      nodes: [
        { id: 'manager_planning', kind: 'agent', agentId: 'manager', capabilities: ['routing'] },
        { id: 'join', kind: 'join', requiredBranchIds: [] },
        { id: 'manager_synthesis', kind: 'agent', agentId: 'manager', capabilities: ['synthesis'] }
      ],
      edges: [
        { from: 'manager_planning', to: 'join', condition: 'planned' },
        { from: 'join', to: 'manager_synthesis', condition: 'joined' }
      ],
      budgets: {
        maxParallelNodes: 4,
        maxActivatedSpecialists: 10,
        maxRetriesPerNode: 2,
        maxDurationMs: 600000
      }
    })
    expect(parsed.templateId).toBe('manager-specialists-v1')
    expect(parsed.nodes).toHaveLength(3)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: FAIL — `ManagerRouteDecisionSchema` / `AgentGraphSnapshotSchema` 未导出

- [ ] **Step 3: 实现 — 在 multi-agent-runtime.ts 的 `AgentGraphSchema` 之后插入两个定义**

在 `export type AgentGraph = ...`（约 line 84）之后、`export const TaskEnvelopeSchema`（约 line 86）之前，插入：

```ts
/**
 * Manager 路由决策 — manager_planning 节点调用 route_specialists 工具的输出。
 * specialists 为空数组时表示简单任务，由 manager 直接处理（空路由路径）。
 */
export const ManagerRouteDecisionSchema = z.object({
  summary: z.string(),
  specialists: z.array(z.object({
    specialistId: NonEmptyString,
    task: NonEmptyString,
    dependsOn: z.array(NonEmptyString).default([]),
    required: z.boolean()
  }).strict()).default([])
}).strict()
export type ManagerRouteDecision = z.infer<typeof ManagerRouteDecisionSchema>

/**
 * Agent 图快照 — 不可变，按 publicKey 寻址。team 模式下 materializeTeamGraph 产出此结构。
 * 与 AgentGraph 的区别：snapshot 携带 budgets 和 registryRevision，是不可变执行蓝图。
 */
export const AgentGraphSnapshotSchema = z.object({
  version: z.literal(1),
  publicKey: NonEmptyString,
  templateId: NonEmptyString,
  registryRevision: NonEmptyString,
  startNodeId: NonEmptyString,
  nodes: z.array(AgentGraphNodeSchema).min(1),
  edges: z.array(AgentGraphEdgeSchema).default([]),
  budgets: z.object({
    maxParallelNodes: z.number().int().positive(),
    maxActivatedSpecialists: z.number().int().nonnegative(),
    maxRetriesPerNode: z.number().int().nonnegative(),
    maxDurationMs: z.number().int().positive()
  }).strict()
}).strict()
export type AgentGraphSnapshot = z.infer<typeof AgentGraphSnapshotSchema>
```

> 来源: KWorks `multi-agent-runtime.ts` line 87-113。字段名、类型、`.strict()` 全部对齐。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: PASS — 3 个新测试全过

- [ ] **Step 5: 提交**

```bash
git add engine/packages/foundation/contracts/src/multi-agent-runtime.ts engine/tests/phase1-contracts-ports.test.ts
git commit -m "feat(contracts): 补 ManagerRouteDecisionSchema 与 AgentGraphSnapshotSchema

多 agent 编排核心数据结构（来源 KWorks multi-agent-runtime.ts）"
```

---

## Task 3: 扩展 multi-agent-runtime.ts — 扩展 AgentRunSchema 与 MultiAgentRunSchema

**Files:**
- Modify: `engine/packages/foundation/contracts/src/multi-agent-runtime.ts`

KCoder 的 `AgentRunSchema`（line 99-111）缺 `publicKey/sequence/role/phase/transcriptRef/usage/attempt/task/required`。`MultiAgentRunSchema`（line 200-222）缺 `graphSnapshot/routeDecision/activeNodeIds/runnableNodeIds/nextPublicSequence/warnings`。这些字段是 manager-specialist 编排所需的。

- [ ] **Step 1: 先在文件顶部补 UsageSnapshotSchema 导入**

Read `multi-agent-runtime.ts` 顶部 import 区（line 1-4），当前是：

```ts
import { z } from 'zod'
import { BudgetStateSchema } from './runtime-kernel.js'
import { PeerArtifactSchema } from './agent-identity.js'
```

补一行导入：

```ts
import { UsageSnapshotSchema } from './usage.js'
```

- [ ] **Step 2: 写失败测试 — 验证扩展后的 AgentRun 和 MultiAgentRun 字段**

在 `phase1-contracts-ports.test.ts` 追加 describe 块：

```ts
import { AgentRunSchema, MultiAgentRunSchema } from '@qiongqi/contracts'

describe('multi-agent-runtime: extended AgentRun + MultiAgentRun', () => {
  it('AgentRunSchema accepts manager planning run with new fields', () => {
    const parsed = AgentRunSchema.parse({
      agentRunId: 'run_1',
      agentId: 'manager',
      nodeId: 'manager_planning',
      publicKey: 'pub_1',
      sequence: 1,
      role: 'manager',
      phase: 'planning',
      transcriptRef: 'transcript_1',
      attempt: 1,
      required: true,
      status: 'running',
      startedAt: '2026-07-24T00:00:00Z',
      updatedAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.role).toBe('manager')
    expect(parsed.phase).toBe('planning')
    expect(parsed.attempt).toBe(1)
  })

  it('AgentRunSchema still accepts minimal run (backward compat)', () => {
    const parsed = AgentRunSchema.parse({
      agentRunId: 'run_2',
      agentId: 'specialist_backend',
      nodeId: 'specialist:backend',
      status: 'queued',
      startedAt: '2026-07-24T00:00:00Z',
      updatedAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.attempt).toBe(1) // default
    expect(parsed.role).toBeUndefined()
  })

  it('MultiAgentRunSchema accepts run with graphSnapshot and routeDecision', () => {
    const parsed = MultiAgentRunSchema.parse({
      version: 1,
      runId: 'mar_1',
      threadId: 'th_1',
      turnId: 'turn_1',
      workspaceKey: 'ws_1',
      status: 'running',
      graphId: 'graph_1',
      activeNodeId: 'manager_planning',
      activeNodeIds: ['manager_planning'],
      runnableNodeIds: ['manager_planning'],
      graphSnapshot: {
        version: 1,
        publicKey: 'graph_1',
        templateId: 'manager-specialists-v1',
        registryRevision: 'reg_v1',
        startNodeId: 'manager_planning',
        nodes: [{ id: 'manager_planning', kind: 'agent', agentId: 'manager', capabilities: ['routing'] }],
        edges: [],
        budgets: { maxParallelNodes: 4, maxActivatedSpecialists: 10, maxRetriesPerNode: 2, maxDurationMs: 600000 }
      },
      routeDecision: { summary: '测试', specialists: [] },
      nextPublicSequence: 2,
      warnings: [],
      budgets: { inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCalls: 0, steps: 0 },
      createdAt: '2026-07-24T00:00:00Z',
      updatedAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.graphSnapshot?.templateId).toBe('manager-specialists-v1')
    expect(parsed.routeDecision?.specialists).toHaveLength(0)
    expect(parsed.activeNodeIds).toEqual(['manager_planning'])
  })
})
```

> **注意**: `budgets` 字段的精确结构需匹配 KCoder 现有 `BudgetStateSchema`。Step 3 实现前先 Read `runtime-kernel.ts` 确认 `BudgetStateSchema` 的字段（测试中的 `inputTokens/outputTokens/totalTokens/toolCalls/steps` 是猜测值，实际按 schema 调整）。

- [ ] **Step 3: 运行测试确认失败**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: FAIL — `publicKey/sequence/role/phase` 等字段不被 `AgentRunSchema` 接受；`graphSnapshot/routeDecision` 等不被 `MultiAgentRunSchema` 接受

- [ ] **Step 4: 实现 — 替换 AgentRunSchema 和 MultiAgentRunSchema**

用 Edit 工具替换现有 `AgentRunSchema`（line 99-111 的整个 `z.object({...}).strict()`）。新内容：

```ts
export const AgentRunSchema = z.object({
  agentRunId: NonEmptyString,
  agentId: NonEmptyString,
  nodeId: NonEmptyString,
  /** 公钥寻址键（graph 节点的稳定标识，区别于会变的 agentRunId）。 */
  publicKey: NonEmptyString.optional(),
  /** 执行序号，用于投影排序。 */
  sequence: z.number().int().positive().optional(),
  /** 角色：manager（路由/综合）或 specialist（执行）。 */
  role: z.enum(['manager', 'specialist']).optional(),
  /** 阶段：planning（规划）/ execution（执行）/ synthesis（综合）。 */
  phase: z.enum(['planning', 'execution', 'synthesis']).optional(),
  /** 对话记录引用（AgentTranscriptStore.load 的 key）。 */
  transcriptRef: NonEmptyString.optional(),
  usage: UsageSnapshotSchema.optional(),
  /** 尝试次数（重试计数，从 1 开始）。 */
  attempt: z.number().int().positive().default(1),
  task: z.string().optional(),
  required: z.boolean().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'aborted', 'suspended']),
  startedAt: NonEmptyString,
  updatedAt: NonEmptyString,
  completedAt: NonEmptyString.optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
  peerArtifact: PeerArtifactSchema.optional()
}).strict()
export type AgentRun = z.infer<typeof AgentRunSchema>
```

用 Edit 工具替换现有 `MultiAgentRunSchema`（line 200-222 的整个 `z.object({...}).strict()`）。新内容：

```ts
export const MultiAgentRunSchema = z.object({
  version: z.literal(1),
  runId: NonEmptyString,
  threadId: NonEmptyString,
  turnId: NonEmptyString,
  workspaceKey: NonEmptyString,
  status: z.enum(['created', 'running', 'suspended', 'completed', 'failed', 'aborted']),
  graphId: NonEmptyString,
  /** 不可变图快照（materializeTeamGraph 产出后挂载）。 */
  graphSnapshot: AgentGraphSnapshotSchema.optional(),
  /** manager 路由决策（manager_planning 完成后挂载）。 */
  routeDecision: ManagerRouteDecisionSchema.optional(),
  activeNodeId: NonEmptyString,
  /** 当前可激活的节点 id 列表。 */
  activeNodeIds: z.array(NonEmptyString).default([]),
  /** 当前可运行的节点 id 列表。 */
  runnableNodeIds: z.array(NonEmptyString).default([]),
  activeAgentStack: z.array(NonEmptyString).default([]),
  branchStatus: z.record(
    NonEmptyString,
    z.enum(['queued', 'running', 'completed', 'failed', 'aborted'])
  ).default({}),
  agentRuns: z.array(AgentRunSchema).default([]),
  events: z.array(MultiAgentEventSchema).default([]),
  outbox: z.array(MultiAgentOutboxIntentSchema).default([]),
  retryCounters: z.record(NonEmptyString, z.number().int().nonnegative()).default({}),
  /** 下一个 agent 的公开序号（递增分配）。 */
  nextPublicSequence: z.number().int().positive().default(1),
  /** 运行级警告（如 budget 不足、节点超时）。 */
  warnings: z.array(z.string()).default([]),
  budgets: BudgetStateSchema,
  createdAt: NonEmptyString,
  updatedAt: NonEmptyString
}).strict()
export type MultiAgentRun = z.infer<typeof MultiAgentRunSchema>
```

> 来源: KWorks `multi-agent-runtime.ts`。KCoder 新增字段全部为 `.optional()` 或 `.default()`，保证向后兼容（现有不携带这些字段的 run 仍可 parse）。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: PASS — 若 budgets 字段不匹配，按 `runtime-kernel.ts` 实际 `BudgetStateSchema` 调整测试 fixture

- [ ] **Step 6: 提交**

```bash
git add engine/packages/foundation/contracts/src/multi-agent-runtime.ts engine/tests/phase1-contracts-ports.test.ts
git commit -m "feat(contracts): 扩展 AgentRun/MultiAgentRun 支持 manager-specialist 编排

新增 publicKey/sequence/role/phase/transcriptRef/attempt/required 字段（AgentRun）
新增 graphSnapshot/routeDecision/activeNodeIds/runnableNodeIds/nextPublicSequence/warnings（MultiAgentRun）
所有新字段 optional/default，向后兼容"
```

---

## Task 4: 扩展 turns.ts — 补 OrchestrationPreference / CollaborationPolicy / RuntimeDecisionSchema，扩展 TurnSchema 与 StartTurnRequest

**Files:**
- Modify: `engine/packages/foundation/contracts/src/turns.ts`

KCoder 的 `turns.ts`（163 行）缺编排模式切换所需的全部类型。需补：`OrchestrationPreferenceSchema`、`CollaborationPolicySchema`、`RuntimeDecisionSchema`，并扩展 `TurnSchema`（+6 字段）和 `StartTurnRequest`（+2 字段 + superRefine 校验）。

- [ ] **Step 1: 补 import — 导入 RuntimeCapabilitySnapshotSchema**

Read `turns.ts` 顶部 import 区（line 1-4），当前是：

```ts
import { z } from 'zod'
import { TurnItem } from './items.js'
import { isGuiPlanRelativePath } from './gui-plan.js'
import { ApprovalPolicySchema, SandboxModeSchema } from './policy.js'
```

补一行：

```ts
import { RuntimeCapabilitySnapshotSchema } from './capabilities.js'
```

- [ ] **Step 2: 写失败测试 — 验证编排类型和扩展后的 Turn/StartTurnRequest**

在 `phase1-contracts-ports.test.ts` 追加 describe 块：

```ts
import {
  OrchestrationPreferenceSchema,
  CollaborationPolicySchema,
  RuntimeDecisionSchema,
  TurnSchema,
  StartTurnRequest
} from '@qiongqi/contracts'

describe('turns: orchestration types + extended Turn/StartTurnRequest', () => {
  it('OrchestrationPreference accepts standard and team', () => {
    expect(OrchestrationPreferenceSchema.parse('standard')).toBe('standard')
    expect(OrchestrationPreferenceSchema.parse('team')).toBe('team')
  })

  it('CollaborationPolicy accepts single and auto', () => {
    expect(CollaborationPolicySchema.parse('single')).toBe('single')
    expect(CollaborationPolicySchema.parse('auto')).toBe('auto')
  })

  it('RuntimeDecisionSchema parses a kernel_v3 decision', () => {
    const parsed = RuntimeDecisionSchema.parse({
      preferredMode: 'kernel_v3',
      effectiveMode: 'kernel_v3',
      preference: 'standard',
      source: 'default',
      reasonCode: 'standard_execution',
      reason: '默认单 agent 模式',
      rolloutStage: 'default',
      decidedAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.effectiveMode).toBe('kernel_v3')
  })

  it('RuntimeDecisionSchema parses an evented_v2 decision with fallback', () => {
    const parsed = RuntimeDecisionSchema.parse({
      preferredMode: 'evented_v2',
      effectiveMode: 'evented_v2',
      preference: 'team',
      source: 'turn',
      reasonCode: 'explicit_team',
      reason: '用户显式选择团队模式',
      rolloutStage: 'default',
      decidedAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.effectiveMode).toBe('evented_v2')
  })

  it('TurnSchema accepts turn with orchestration fields', () => {
    const parsed = TurnSchema.parse({
      id: 'turn_1',
      threadId: 'th_1',
      status: 'running',
      prompt: '实现一个登录接口',
      orchestrationPreference: 'team',
      runtimeDecision: {
        preferredMode: 'evented_v2',
        effectiveMode: 'evented_v2',
        preference: 'team',
        source: 'turn',
        reasonCode: 'explicit_team',
        reason: '用户选择团队',
        rolloutStage: 'default',
        decidedAt: '2026-07-24T00:00:00Z'
      },
      nextExecutionSequence: 3,
      eventedV2RunId: 'mar_1',
      createdAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.orchestrationPreference).toBe('team')
    expect(parsed.eventedV2RunId).toBe('mar_1')
  })

  it('TurnSchema still accepts minimal turn (backward compat)', () => {
    const parsed = TurnSchema.parse({
      id: 'turn_2',
      threadId: 'th_1',
      status: 'queued',
      prompt: '你好',
      createdAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.orchestrationPreference).toBeUndefined()
    expect(parsed.runtimeDecision).toBeUndefined()
  })

  it('StartTurnRequest accepts orchestrationPreference team', () => {
    const parsed = StartTurnRequest.parse({
      prompt: '实现全栈功能',
      orchestrationPreference: 'team'
    })
    expect(parsed.orchestrationPreference).toBe('team')
  })

  it('StartTurnRequest rejects conflicting orchestrationPreference + collaborationPolicy', () => {
    const result = StartTurnRequest.safeParse({
      prompt: 'test',
      orchestrationPreference: 'standard',
      collaborationPolicy: 'auto' // auto → team, conflicts with standard
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: FAIL — `OrchestrationPreferenceSchema` 等未导出；`TurnSchema` 不接受 `orchestrationPreference` 等字段

- [ ] **Step 4: 实现 — 补类型定义**

在 `turns.ts` 的 `TurnReasoningEffortSchema` 定义（约 line 14）之前，插入协作/编排类型：

```ts
/**
 * 每回合协作策略。驱动运行时编排模式选择：
 * - `single` — 稳定的单 agent 基线（kernel_v3）。
 * - `auto`   — 声明式多 agent 编排（evented_v2），manager 可调度 specialist。
 */
export const CollaborationPolicySchema = z.enum(['single', 'auto'])
export type CollaborationPolicy = z.infer<typeof CollaborationPolicySchema>

/**
 * 编排偏好（新 API）：standard = 单 agent 标准模式，team = 多 agent 团队模式。
 */
export const OrchestrationPreferenceSchema = z.enum(['standard', 'team'])
export type OrchestrationPreference = z.infer<typeof OrchestrationPreferenceSchema>

/**
 * 运行时编排决策 — 决策服务决定每个 turn 的编排模式后持久化到此结构。
 * 不可变：一旦持久化到 Turn.runtimeDecision，后续 runTurn 重新调用 decide() 命中幂等门直接返回。
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
```

> 来源: KWorks `turns.ts` line 16-43。注释用中文。

- [ ] **Step 5: 实现 — 扩展 TurnSchema**

用 Edit 工具，在 `TurnSchema` 的 `mode: TurnModeSchema.optional(),` 之后、`error: z.string().optional()` 之前，插入 6 个新字段：

```ts
  mode: TurnModeSchema.optional(),
  /** 每回合协作策略（single=kernel_v3, auto=evented_v2）。遗留字段，优先级低于 orchestrationPreference。 */
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
```

- [ ] **Step 6: 实现 — 扩展 StartTurnRequest 并加 superRefine**

用 Edit 工具，在 `StartTurnRequest` 的 `mode: TurnModeSchema.optional(),` 之后插入两个新字段：

```ts
  mode: TurnModeSchema.optional(),
  /** 每回合协作策略（遗留字段，single=kernel_v3, auto=evented_v2）。 */
  collaborationPolicy: CollaborationPolicySchema.optional(),
  /** 编排偏好（新 API）：standard 或 team。与 collaborationPolicy 同时设置时不能冲突。 */
  orchestrationPreference: OrchestrationPreferenceSchema.optional(),
  attachments: z
```

然后在 `StartTurnRequest` 的 `.superRefine` 之前（或 `guiPlan` 字段之后），把对象的结尾 `})` 改为带 superRefine 的形式。若 KCoder 当前 `StartTurnRequest` 没有 superRefine，在 `}).superRefine(...)` 追加（替换结尾的 `})`）：

```ts
}).superRefine((request, ctx) => {
  if (!request.orchestrationPreference || !request.collaborationPolicy) return
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
```

> 来源: KWorks `turns.ts` line 147-163 的 superRefine。逻辑：collaborationPolicy `auto` 等价 `team`，`single` 等价 `standard`；若两个字段同时设置且不等价，报校验错误。

- [ ] **Step 7: 运行测试确认通过**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: PASS — 8 个新测试全过（含冲突校验拒绝的测试）

- [ ] **Step 8: 提交**

```bash
git add engine/packages/foundation/contracts/src/turns.ts engine/tests/phase1-contracts-ports.test.ts
git commit -m "feat(contracts): 补编排模式类型并扩展 Turn/StartTurnRequest

新增 OrchestrationPreference/CollaborationPolicy/RuntimeDecisionSchema
TurnSchema +6 字段（runtimeDecision/eventedV2RunId/...）
StartTurnRequest +orchestrationPreference/collaborationPolicy + cross-field superRefine 校验"
```

---

## Task 5: 创建 turn-execution.ts — TurnExecutionView 联合类型

**Files:**
- Create: `engine/packages/foundation/contracts/src/turn-execution.ts`
- Modify: `engine/packages/foundation/contracts/src/index.ts`（barrel 导出）

执行投影服务把不同编排模式的内部状态投影成统一的 `TurnExecutionView`，供前端渲染。本文件定义这个联合类型及其所有子类型。

- [ ] **Step 1: 写失败测试 — 验证 TurnExecutionView 各变体可 parse**

在 `phase1-contracts-ports.test.ts` 追加 describe 块：

```ts
import {
  TurnExecutionViewSchema,
  KernelV3TurnExecutionViewSchema,
  EventedV2TurnExecutionViewSchema,
  UnavailableTurnExecutionViewSchema
} from '@qiongqi/contracts'

const baseDecision = {
  preferredMode: 'kernel_v3' as const,
  effectiveMode: 'kernel_v3' as const,
  preference: 'standard' as const,
  source: 'default' as const,
  reasonCode: 'standard_execution',
  reason: '默认模式',
  rolloutStage: 'default' as const,
  decidedAt: '2026-07-24T00:00:00Z'
}

describe('turn-execution: TurnExecutionView variants', () => {
  it('KernelV3TurnExecutionView parses', () => {
    const parsed = KernelV3TurnExecutionViewSchema.parse({
      version: 1,
      available: true,
      revision: 'sha256:abc',
      status: 'completed',
      decision: baseDecision,
      agents: [],
      mode: 'kernel_v3',
      delegation: { roots: ['root'], edges: [] }
    })
    expect(parsed.mode).toBe('kernel_v3')
  })

  it('EventedV2TurnExecutionView parses with graph', () => {
    const parsed = EventedV2TurnExecutionViewSchema.parse({
      version: 1,
      available: true,
      revision: 'sha256:def',
      status: 'running',
      decision: { ...baseDecision, effectiveMode: 'evented_v2', preference: 'team' },
      agents: [],
      mode: 'evented_v2',
      graph: {
        key: 'graph_1',
        templateId: 'manager-specialists-v1',
        nodes: [],
        edges: [],
        handoffs: [],
        activeAgentKeys: [],
        warnings: []
      }
    })
    expect(parsed.mode).toBe('evented_v2')
    expect(parsed.graph.templateId).toBe('manager-specialists-v1')
  })

  it('UnavailableTurnExecutionView parses with reason', () => {
    const parsed = UnavailableTurnExecutionViewSchema.parse({
      version: 1,
      available: false,
      revision: 'legacy:0',
      reason: 'legacy_turn'
    })
    expect(parsed.available).toBe(false)
  })

  it('TurnExecutionViewSchema union accepts all variants', () => {
    const kernel = TurnExecutionViewSchema.parse({
      version: 1, available: true, revision: 'sha256:1', status: 'completed',
      decision: baseDecision, agents: [], mode: 'kernel_v3',
      delegation: { roots: [], edges: [] }
    })
    const unavailable = TurnExecutionViewSchema.parse({
      version: 1, available: false, revision: 'legacy:0', reason: 'not_recorded'
    })
    expect(kernel.available).toBe(true)
    expect(unavailable.available).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: FAIL — `@qiongqi/contracts` 不导出 `TurnExecutionViewSchema` 等

- [ ] **Step 3: 实现 — 创建 turn-execution.ts**

创建 `engine/packages/foundation/contracts/src/turn-execution.ts`，完整内容：

```ts
import { z } from 'zod'

const NonEmptyString = z.string().trim().min(1)

export const ExecutionStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'aborted'
])
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>

export const UserFacingUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
  costCny: z.number().nonnegative().optional()
}).strict()
export type UserFacingUsage = z.infer<typeof UserFacingUsageSchema>

export const AgentMessageViewSchema = z.object({
  key: NonEmptyString,
  sourceRef: NonEmptyString,
  role: z.enum(['assistant', 'user', 'tool']),
  content: z.string(),
  createdAt: z.string(),
  artifactKeys: z.array(NonEmptyString).default([])
}).strict()
export type AgentMessageView = z.infer<typeof AgentMessageViewSchema>

export const UserVisibleReasoningViewSchema = z.object({
  key: NonEmptyString,
  text: z.string(),
  createdAt: z.string()
}).strict()
export type UserVisibleReasoningView = z.infer<typeof UserVisibleReasoningViewSchema>

export const ToolRunViewSchema = z.object({
  key: NonEmptyString,
  toolName: NonEmptyString,
  status: ExecutionStatusSchema,
  input: z.unknown().optional(),
  result: z.unknown().optional(),
  artifactKeys: z.array(NonEmptyString).default([])
}).strict()
export type ToolRunView = z.infer<typeof ToolRunViewSchema>

export const UserFacingErrorViewSchema = z.object({
  code: NonEmptyString,
  message: z.string()
}).strict()
export type UserFacingErrorView = z.infer<typeof UserFacingErrorViewSchema>

export const RetryViewSchema = z.object({
  attempt: z.number().int().positive(),
  status: ExecutionStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: UserFacingErrorViewSchema.optional()
}).strict()
export type RetryView = z.infer<typeof RetryViewSchema>

export const AgentExecutionViewSchema = z.object({
  key: NonEmptyString,
  parentKey: NonEmptyString.optional(),
  sequence: z.number().int().positive(),
  role: z.enum(['root', 'child', 'manager', 'specialist']),
  phase: z.enum(['planning', 'execution', 'synthesis']).optional(),
  name: NonEmptyString,
  task: z.string().optional(),
  status: ExecutionStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  usage: UserFacingUsageSchema.optional(),
  messages: z.array(AgentMessageViewSchema),
  reasoning: z.array(UserVisibleReasoningViewSchema),
  toolRuns: z.array(ToolRunViewSchema),
  summary: z.string().optional(),
  error: UserFacingErrorViewSchema.optional(),
  retries: z.array(RetryViewSchema)
}).strict()
export type AgentExecutionView = z.infer<typeof AgentExecutionViewSchema>

export const RuntimeDecisionViewSchema = z.object({
  preferredMode: z.enum(['kernel_v3', 'evented_v2']),
  effectiveMode: z.enum(['classic', 'kernel_v3', 'evented_v2']),
  preference: z.enum(['standard', 'team']),
  source: z.enum(['turn', 'default', 'legacy', 'server_override']),
  reasonCode: NonEmptyString,
  reason: NonEmptyString,
  fallbackReasonCode: NonEmptyString.optional(),
  fallbackReason: NonEmptyString.optional(),
  rolloutStage: z.enum(['off', 'shadow', 'canary', 'default']),
  decidedAt: NonEmptyString
}).strict()
export type RuntimeDecisionView = z.infer<typeof RuntimeDecisionViewSchema>

export const DelegationEdgeViewSchema = z.object({
  from: NonEmptyString,
  to: NonEmptyString
}).strict()
export type DelegationEdgeView = z.infer<typeof DelegationEdgeViewSchema>

export const DelegationTreeViewSchema = z.object({
  roots: z.array(NonEmptyString),
  edges: z.array(DelegationEdgeViewSchema)
}).strict()
export type DelegationTreeView = z.infer<typeof DelegationTreeViewSchema>

export const AgentGraphNodeViewSchema = z.object({
  key: NonEmptyString,
  agentKey: NonEmptyString,
  role: z.enum(['manager', 'specialist']),
  phase: z.enum(['planning', 'execution', 'synthesis']).optional(),
  name: NonEmptyString,
  status: ExecutionStatusSchema,
  required: z.boolean(),
  childAgentKeys: z.array(NonEmptyString),
  parallelGroup: NonEmptyString.optional()
}).strict()
export type AgentGraphNodeView = z.infer<typeof AgentGraphNodeViewSchema>

export const AgentGraphEdgeViewSchema = z.object({
  from: NonEmptyString,
  to: NonEmptyString,
  condition: z.string().optional()
}).strict()
export type AgentGraphEdgeView = z.infer<typeof AgentGraphEdgeViewSchema>

export const AgentGraphHandoffViewSchema = z.object({
  from: NonEmptyString,
  to: NonEmptyString,
  status: ExecutionStatusSchema
}).strict()
export type AgentGraphHandoffView = z.infer<typeof AgentGraphHandoffViewSchema>

export const AgentGraphExecutionViewSchema = z.object({
  key: NonEmptyString,
  templateId: NonEmptyString,
  nodes: z.array(AgentGraphNodeViewSchema),
  edges: z.array(AgentGraphEdgeViewSchema),
  handoffs: z.array(AgentGraphHandoffViewSchema),
  activeAgentKeys: z.array(NonEmptyString),
  warnings: z.array(z.string())
}).strict()
export type AgentGraphExecutionView = z.infer<typeof AgentGraphExecutionViewSchema>

const AvailableTurnExecutionViewBaseSchema = z.object({
  version: z.literal(1),
  available: z.literal(true),
  revision: z.string().startsWith('sha256:'),
  status: ExecutionStatusSchema,
  decision: RuntimeDecisionViewSchema,
  agents: z.array(AgentExecutionViewSchema)
}).strict()

export const KernelV3TurnExecutionViewSchema = AvailableTurnExecutionViewBaseSchema.extend({
  mode: z.literal('kernel_v3'),
  delegation: DelegationTreeViewSchema
}).strict()
export type KernelV3TurnExecutionView = z.infer<typeof KernelV3TurnExecutionViewSchema>

export const EventedV2TurnExecutionViewSchema = AvailableTurnExecutionViewBaseSchema.extend({
  mode: z.literal('evented_v2'),
  graph: AgentGraphExecutionViewSchema
}).strict()
export type EventedV2TurnExecutionView = z.infer<typeof EventedV2TurnExecutionViewSchema>

export const ClassicTurnExecutionViewSchema = AvailableTurnExecutionViewBaseSchema.extend({
  mode: z.literal('classic'),
  compatibility: z.object({ reason: NonEmptyString }).strict()
}).strict()
export type ClassicTurnExecutionView = z.infer<typeof ClassicTurnExecutionViewSchema>

export const UnavailableTurnExecutionViewSchema = z.object({
  version: z.literal(1),
  available: z.literal(false),
  revision: z.literal('legacy:0'),
  reason: z.enum(['legacy_turn', 'not_recorded', 'legacy_mode'])
}).strict()
export type UnavailableTurnExecutionView = z.infer<typeof UnavailableTurnExecutionViewSchema>

export const TurnExecutionViewSchema = z.union([
  KernelV3TurnExecutionViewSchema,
  EventedV2TurnExecutionViewSchema,
  ClassicTurnExecutionViewSchema,
  UnavailableTurnExecutionViewSchema
])
export type TurnExecutionView = z.infer<typeof TurnExecutionViewSchema>
```

> 来源: KWorks `turn-execution.ts` 全文，逐行忠实移植。零外部依赖（仅 zod）。

- [ ] **Step 4: 实现 — 在 index.ts barrel 补导出**

用 Edit 工具，在 `engine/packages/foundation/contracts/src/index.ts` 的 `export * from './turns.js'` 之后插入：

```ts
export * from './turns.js'
export * from './turn-execution.js'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: PASS — 4 个新测试全过

- [ ] **Step 6: 提交**

```bash
git add engine/packages/foundation/contracts/src/turn-execution.ts \
        engine/packages/foundation/contracts/src/index.ts \
        engine/tests/phase1-contracts-ports.test.ts
git commit -m "feat(contracts): 新建 turn-execution.ts 统一执行视图

TurnExecutionView 联合类型（kernel_v3/evented_v2/classic/unavailable）
+ AgentExecutionView/ToolRunView/AgentGraphExecutionView 等子类型
（来源 KWorks turn-execution.ts 全文）"
```

---

## Task 6: 创建两个端口接口 — AgentTranscriptStore 与 DelegationRunStore

**Files:**
- Create: `engine/packages/ports-layer/ports/src/agent-transcript-store.ts`
- Create: `engine/packages/ports-layer/ports/src/delegation-run-store.ts`
- Modify: `engine/packages/ports-layer/ports/src/index.ts`（barrel 导出）

执行投影适配器需要加载 agent 对话记录（`AgentTranscriptStore`）和子 agent 委派记录（`DelegationRunStore`）。这两个接口在 KWorks 是独立文件，KCoder 缺失。

- [ ] **Step 1: 确认依赖类型存在**

KCoder `@qiongqi/contracts` 是否已导出 `AgentTranscript` 和 `ChildRunRecord`？运行：

```bash
cd engine && grep -rnE "AgentTranscript|ChildRunRecord" packages/foundation/contracts/src/ | head
```

- 若 `AgentTranscript` 不存在：需先在 contracts 层定义（参考 KWorks）。先暂停本 Task，补一个前置 Task 定义 `AgentTranscriptSchema`（对话记录：messages/reasoning/toolRuns + revision）。
- 若 `ChildRunRecord` 不存在：同样需前置定义（委派记录：parentThreadId/parentTurnId/scope/publicKey/sequence/status）。
- 若两者都存在：继续 Step 2。

> **执行者注意**: 这两个类型在 KWorks 的 `contracts/` 里。若 KCoder 缺失，这是一个阻塞性依赖，必须先补。检查后若缺失，在本 Task 之前插入 Task 6.0 定义它们，测试同 Task 1-5 的风格。

- [ ] **Step 2: 写失败测试 — 验证端口接口可导入且类型正确**

在 `phase1-contracts-ports.test.ts` 追加 describe 块：

```ts
import type {
  AgentTranscriptStore,
  DelegationRunStore
} from '@qiongqi/ports'

describe('ports: AgentTranscriptStore + DelegationRunStore', () => {
  it('AgentTranscriptStore interface has required methods', () => {
    // 类型级测试：构造一个最小实现，编译通过即说明接口正确
    const store: AgentTranscriptStore = {
      load: async () => undefined,
      save: async () => {},
      update: async (ref, mutate) => ({}) as never // mutate 签名匹配即可
    }
    expect(store.load).toBeDefined()
    expect(store.save).toBeDefined()
    expect(store.update).toBeDefined()
  })

  it('DelegationRunStore interface has required methods', () => {
    const store: DelegationRunStore = {
      upsert: async () => {},
      list: async () => [],
      deleteByThread: async () => {}
    }
    expect(store.upsert).toBeDefined()
    expect(store.list).toBeDefined()
    expect(store.deleteByThread).toBeDefined()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: FAIL — `@qiongqi/ports` 不导出这两个接口

- [ ] **Step 4: 实现 — 创建两个端口文件**

创建 `engine/packages/ports-layer/ports/src/agent-transcript-store.ts`：

```ts
import type { AgentTranscript } from '@qiongqi/contracts'

/**
 * Agent 对话记录存储端口。
 * 执行投影适配器通过 transcriptRef 加载 agent 的完整对话历史。
 */
export interface AgentTranscriptStore {
  load(transcriptRef: string): Promise<AgentTranscript | undefined>
  save(transcript: AgentTranscript): Promise<void>
  update(
    transcriptRef: string,
    mutate: (current: AgentTranscript) => AgentTranscript | Promise<AgentTranscript>
  ): Promise<AgentTranscript>
}
```

创建 `engine/packages/ports-layer/ports/src/delegation-run-store.ts`：

```ts
import type { ChildRunRecord } from '@qiongqi/contracts'

/**
 * 子 agent 委派记录存储端口。
 * 执行投影适配器通过 parentThreadId 列出子 agent 运行，构建委派树。
 */
export interface DelegationRunStore {
  upsert(record: ChildRunRecord): Promise<void>
  list(parentThreadId?: string): Promise<ChildRunRecord[]>
  deleteByThread(threadId: string): Promise<void>
}
```

> 来源: KWorks `agent-transcript-store.ts` + `delegation-run-store.ts` 全文。仅类型导入，零运行时依赖。

- [ ] **Step 5: 实现 — 在 ports/index.ts barrel 补导出**

用 Edit 工具，在 `engine/packages/ports-layer/ports/src/index.ts` 末尾追加两行：

```ts
export * from './multi-agent-runtime.js'
export * from './delegation-run-store.js'
export * from './agent-transcript-store.js'
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: PASS — 2 个新测试全过

- [ ] **Step 7: 提交**

```bash
git add engine/packages/ports-layer/ports/src/agent-transcript-store.ts \
        engine/packages/ports-layer/ports/src/delegation-run-store.ts \
        engine/packages/ports-layer/ports/src/index.ts \
        engine/tests/phase1-contracts-ports.test.ts
git commit -m "feat(ports): 新建 AgentTranscriptStore 与 DelegationRunStore 端口

执行投影适配器所需的对话记录/委派记录存储接口
（来源 KWorks ports-layer 同名文件）"
```

---

## Task 7: 清理 office/finance 残留模式 — 只保留 coding

**Files:**
- Modify: `engine/packages/foundation/contracts/src/capabilities.ts`

KCoder 是纯 coding 应用，但 `DEFAULT_WORK_MODES` 还残留 office/finance 模式（含 finance 的 30 个 kk-* 技能引用和约 100 行"小s"系统提示词）。同时 `DEFAULT_LOCKED_SKILL_IDS` 含不存在的 `bootstrap`/`skill-manage`。清理它们。

- [ ] **Step 1: 写失败测试 — 验证清理后只有 coding 模式**

在 `phase1-contracts-ports.test.ts` 追加 describe 块：

```ts
import { DEFAULT_WORK_MODES, DEFAULT_LOCKED_SKILL_IDS } from '@qiongqi/contracts'

describe('capabilities: office/finance 残留清理', () => {
  it('DEFAULT_WORK_MODES 只含 coding 模式', () => {
    const modeIds = Object.keys(DEFAULT_WORK_MODES)
    expect(modeIds).toEqual(['coding'])
  })

  it('coding 模式定义完整', () => {
    expect(DEFAULT_WORK_MODES.coding.id).toBe('coding')
    expect(DEFAULT_WORK_MODES.coding.builtin).toBe(true)
    expect(DEFAULT_WORK_MODES.coding.defaultSkillIds.length).toBeGreaterThan(0)
  })

  it('DEFAULT_LOCKED_SKILL_IDS 不含 bootstrap/skill-manage（不存在的技能）', () => {
    expect(DEFAULT_LOCKED_SKILL_IDS).not.toContain('bootstrap')
    expect(DEFAULT_LOCKED_SKILL_IDS).not.toContain('skill-manage')
  })

  it('DEFAULT_LOCKED_SKILL_IDS 保留存在的技能', () => {
    // 这些技能在 engine/skills/ 下实际存在
    expect(DEFAULT_LOCKED_SKILL_IDS).toContain('find-skills')
    expect(DEFAULT_LOCKED_SKILL_IDS).toContain('goal')
    expect(DEFAULT_LOCKED_SKILL_IDS).toContain('todo')
    expect(DEFAULT_LOCKED_SKILL_IDS).toContain('web')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: FAIL — `Object.keys(DEFAULT_WORK_MODES)` 返回 `['office', 'coding', 'finance']` 而非 `['coding']`

- [ ] **Step 3: 实现 — 删除 office/finance 模式定义**

Read `capabilities.ts` 的 `DEFAULT_WORK_MODES` 定义（约 line 188-437）。用 Edit 工具：

1. 删除整个 `office: { id: 'office', ... }` 块（约 line 189-210）
2. 删除整个 `finance: { id: 'finance', ... }` 块（约 line 218-437，含内嵌的"小s"提示词和 kk-* 技能数组）
3. 保留 `coding: { id: 'coding', ... }` 块

清理后的 `DEFAULT_WORK_MODES` 应形如：

```ts
export const DEFAULT_WORK_MODES = {
  coding: {
    id: 'coding',
    name: 'Coding 模式',
    description: 'Full-cycle software engineering ...',
    builtin: true,
    editable: true,
    defaultSkillIds: [
      // ... 保留现有 coding 技能列表（即使部分技能目录不存在，由 skill 加载层跳过）
    ]
  }
} satisfies Record<string, WorkModeConfig>
```

> **注意**: coding 模式的 `defaultSkillIds` 中有 57 个引用了不存在的技能目录。本次**保留**这些引用不变（skill 加载层会跳过不存在的）。清理范围仅限删除 office/finance 两个模式块。

- [ ] **Step 4: 实现 — 更新 WorkModesConfig 的 defaultModeId**

`WorkModesConfig` 当前 `defaultModeId: SkillId.default('office')`（约 line 440）。改为：

```ts
export const WorkModesConfig = z.object({
  defaultModeId: SkillId.default('coding'),
  modes: z.record(SkillId, WorkModeConfig).default(() => DEFAULT_WORK_MODES)
}).strict()
```

- [ ] **Step 5: 实现 — 清理 DEFAULT_LOCKED_SKILL_IDS**

用 Edit 工具，把：

```ts
export const DEFAULT_LOCKED_SKILL_IDS = [
  'bootstrap',
  'find-skills',
  'goal',
  'skill-creator',
  'skill-manage',
  'todo',
  'web'
] as const
```

改为（删除 `bootstrap` 和 `skill-manage`）：

```ts
export const DEFAULT_LOCKED_SKILL_IDS = [
  'find-skills',
  'goal',
  'skill-creator',
  'todo',
  'web'
] as const
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd engine && pnpm test:unit -- phase1-contracts-ports`
Expected: PASS — 4 个新测试全过

- [ ] **Step 7: 全量类型检查确认无回归**

Run: `cd engine && pnpm typecheck`
Expected: PASS — 删除 office/finance 后，引用它们的代码会报错。逐一修复：
- 搜索 `grep -rnE "office|finance" engine/packages/ --include=*.ts | grep -v node_modules | grep -v test`
- 修复引用了 `DEFAULT_WORK_MODES.office` 或 `.finance` 的地方（多数是 runtime-factory 的 `ensureBuiltinWorkModes`、`normalizeLegacyTaskSkills` 等 helper，需移除 office/finance 分支）

> **执行者注意**: 这一步可能暴露多处引用。逐个修复，保证 typecheck 全绿。若某处引用复杂（如 finance-credentials 路由），记录到 Task 8。

- [ ] **Step 8: 提交**

```bash
git add engine/packages/foundation/contracts/src/capabilities.ts \
        $(git diff --name-only -- 'engine/packages/**/*.ts')
git commit -m "refactor(contracts): 清理 office/finance 残留模式，KCoder 只保留 coding

删除 DEFAULT_WORK_MODES 中 office/finance 两个模式定义（含 finance 的 kk-* 技能引用和小s提示词）
defaultModeId 从 office 改为 coding
DEFAULT_LOCKED_SKILL_IDS 删除不存在的 bootstrap/skill-manage
修复所有引用清理后模式的代码"
```

---

## Task 8: 全量验证 + 清理 finance 相关 HTTP 路由

**Files:**
- Modify: `engine/packages/http-layer/http/src/routes/index.ts`（移除 finance 路由注册）
- Modify: `engine/packages/http-layer/http/src/routes/compat.ts`（移除 finance handler）
- Delete: `engine/packages/http-layer/http/src/finance-credentials.ts`（若存在且仅服务 finance 模式）

清理 finance 模式残留的 HTTP 路由（`/api/finance/credentials` 等）。

- [ ] **Step 1: 定位 finance 相关代码**

```bash
cd engine && grep -rnE "finance|kk-|小s|/api/finance" packages/ --include=*.ts | grep -v node_modules | grep -v test
```

记录所有命中点。

- [ ] **Step 2: 移除 finance HTTP 路由**

Read `routes/index.ts`，找到注册 `/api/finance/credentials` 等 finance 路由的行，用 Edit 删除这些 `router.add(...)` 调用。

Read `routes/compat.ts`，找到 finance 相关 handler 函数（如 `kworksFinanceCredentials` 等），删除这些函数定义和它们在 `buildRouter` 中的引用。

- [ ] **Step 3: 删除 finance-credentials.ts（若仅服务 finance）**

```bash
# 先确认该文件是否被非 finance 代码引用
cd engine && grep -rn "finance-credentials" packages/ --include=*.ts | grep -v node_modules
```

若仅 finance 路由引用，删除：

```bash
rm engine/packages/http-layer/http/src/finance-credentials.ts
```

若被其他代码引用，保留但移除 finance 专属逻辑。

- [ ] **Step 4: 全量类型检查 + 单测**

Run: `cd engine && pnpm typecheck && pnpm test:unit`
Expected: PASS — 无 finance 相关类型错误；契约/端口单测全过

- [ ] **Step 5: 提交**

```bash
git add -A engine/packages/http-layer/
git commit -m "refactor(http): 移除 finance 相关 HTTP 路由和凭证服务

KCoder 定位纯 coding，删除 /api/finance/credentials 路由、finance handler、finance-credentials.ts"
```

---

## Phase 1 完成验证

执行以下全部检查，全部 PASS 后 Phase 1 完成：

- [ ] **V1: 全部单测通过**
  Run: `cd engine && pnpm test:unit`
  Expected: PASS — phase1-contracts-ports.test.ts 全部用例 + 现有契约测试无回归

- [ ] **V2: 全量类型检查通过**
  Run: `cd engine && pnpm typecheck`
  Expected: PASS — 所有包类型检查无错误

- [ ] **V3: 全量测试通过（含集成测试）**
  Run: `cd engine && pnpm test`
  Expected: PASS — 若有因 office/finance 清理导致的集成测试失败，修复测试或移除测试中引用已删模式的断言

- [ ] **V4: git 历史干净**
  Run: `git log --oneline feat/kworks-engine-migration..HEAD`（或当前分支）
  Expected: 8 个 commit（Task 1-8 各一），每个 commit 信息清晰

- [ ] **V5: 引擎可正常启动（冒烟测试）**
  Run: `cd engine && pnpm build && timeout 5 node packages/cli-layer/cli/src/index.js serve --help 2>&1 || true`
  Expected: serve 命令帮助正常输出，无模块解析错误

**Phase 1 完成后，进入 Phase 2（Specialist Registry + Graph Template）。** Phase 2 的实现计划将在 Phase 1 验证通过后，基于本阶段产出的精确契约类型编写。

---

## 附录：KCoder 与 KWorks 关键差异备忘

执行本计划时需注意的 KCoder 特有情况（区别于 KWorks 原始代码）：

1. **import 路径后缀**: KCoder 使用 `.js` 后缀（ESM），如 `import { X } from './multi-agent-runtime.js'`。KWorks 同样如此，保持一致。
2. **BudgetStateSchema**: KCoder 的 `runtime-kernel.ts` 中 `BudgetStateSchema` 的精确字段需在 Task 3 实现前 Read 确认（测试 fixture 据此调整）。
3. **package.json 名称**: contracts 包名 `@qiongqi/contracts`，ports 包名 `@qiongqi/ports`（非 `@kworks/*`）。
4. **vitest 配置**: `globals: true`，测试可省略 import（但推荐显式 import `describe/expect/it`，与现有测试风格一致）。
5. **`.strict()` 惯例**: 所有 zod object schema 用 `.strict()`，拒绝未知字段（与 KWorks 一致）。
6. **中文注释**: 新增注释用中文（对齐 KCoder 中文项目定位），保留 KWorks 英文注释的核心技术说明。
