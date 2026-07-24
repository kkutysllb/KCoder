# KWorks 引擎核心代码移植设计

- **日期**: 2026-07-24
- **状态**: 待审阅
- **来源项目**: `/Users/libing/kk_Projects/KWorks`（qiongqi 引擎）
- **目标项目**: `/Users/libing/kk_Projects/KCoder`（当前项目）

## 1. 背景与目标

KCoder 定位为 **"Agent-driven coding desktop app powered by QiongQi engine"**，是一个纯 coding 应用。其引擎 `@qiongqi/*` 包体系与 KWorks 的 qiongqi 引擎同源——KCoder 已经迁移了约 60% 的引擎机制（evented_v2 运行时状态机、工作模式、多 agent 存储、rollout 逻辑、worker CLI、delegation 层等）。

本次任务：**把 KWorks 编码模式中缺失的"编排执行层"忠实移植到 KCoder**，并对接本项目设计的功能点。移植完成后，KCoder 将具备两种编排模式（标准/团队）、10 个 KCoder 原生 specialist、场景化工作流提示词、以及统一的执行投影。

## 2. 精确差距分析

逐文件对比 KWorks 与 KCoder 实际代码后的差距清单：

### 2.1 Contracts（契约层）缺失 — `engine/packages/foundation/contracts/src/`

| 缺失项 | 位置 | 说明 |
|---|---|---|
| `ManagerRouteDecisionSchema` / `AgentGraphSnapshotSchema` | `multi-agent-runtime.ts` | 多 agent 编排核心数据结构。KCoder 有 `AgentGraph`，缺不可变 `AgentGraphSnapshot` 和 manager 路由决策 |
| `TurnSchema` 字段：`runtimeDecision`、`eventedV2RunId`、`runtimeCapabilitySnapshot`、`nextExecutionSequence`、`orchestrationPreference`、`collaborationPolicy` | `turns.ts` | 编排决策记录挂在 Turn 上 |
| `RuntimeDecisionSchema` / `RuntimeCapabilitySnapshotSchema` / `OrchestrationPreference` | `turns.ts`（新建） | 编排模式切换的决策记录类型 |
| `AgentRunSchema` 字段：`publicKey`、`sequence`、`role`、`phase`、`transcriptRef`、`attempt`、`required` | `multi-agent-runtime.ts` | manager-specialist 图所需字段 |
| `MultiAgentRunSchema` 字段：`graphSnapshot`、`agentRuns`、`routeDecision`、`activeNodeIds`、`warnings` | `multi-agent-runtime.ts` | 运行状态机字段 |
| `turn-execution.ts`（整个文件） | 新建 | `TurnExecutionView` 联合类型（kernel_v3/evented_v2/classic/unavailable）+ `AgentExecutionView`/`ToolRunView`/`ChildRunRecord` 等 |

### 2.2 Ports（端口层）缺失 — `engine/packages/ports-layer/ports/src/`

| 缺失项 | 说明 |
|---|---|
| `AgentTranscriptStore` | agent 对话记录加载（执行投影用） |
| `DelegationRunStore` | 子 agent 委派记录（执行投影用） |

> 已存在：`MultiAgentRunStore`、`MailboxStore`、`EventedV2WorkerRegistryStore`、`ThreadStore`、`IdGenerator`、`Clock`。

### 2.3 Engine/loop 缺失 — `engine/packages/engine/loop/src/`

| 缺失文件 | 说明 |
|---|---|
| `specialist-registry.ts` | 专家注册表机制（**移植机制，agent 重新设计**） |
| `agent-node-executor.ts` | 单个 agent 节点执行器 + `ManagerRouteController` + `route_specialists` 工具 |
| `evented-v2-graph-template.ts` | `materializeTeamGraph` 构建 manager→specialist→join→synthesis DAG |
| `evented-v2-turn-runner.ts` | 多 agent turn 运行器 |
| **升级** `evented-v2-multi-agent-runtime.ts` | 从 `AgentGraph` 模型升级到 `AgentGraphSnapshot` 模型（现有 39KB 文件是较早演化阶段） |

### 2.4 Engine/services 缺失 — `engine/packages/engine/services/src/`

| 缺失文件 | 说明 |
|---|---|
| `turn-runtime-decision-service.ts` | 编排决策服务（**两种模式切换的核心**） |
| `turn-execution-projection-service.ts` | 执行投影服务（按 `effectiveMode` 选适配器） |
| `kernel-v3-execution-adapter.ts` | kernel_v3 执行投影适配器 |
| `evented-v2-execution-adapter.ts` | evented_v2 执行投影适配器 |
| `turn-execution-sanitizer.ts` | 投影数据脱敏（剥离 systemPrompt/transcriptRef/lease 等内部字段） |
| `execution-revision-notifier.ts` | 投影修订通知（dedupe） |

### 2.5 HTTP / runtime-factory 缺失 — `engine/packages/http-layer/http/src/runtime-factory.ts`

| 缺失项 | 说明 |
|---|---|
| `createPersistedDecisionTurnRouter` | 持久化决策路由器（读 turn → 决策 → 选 runner） |
| `runtimeServerOverride` | 服务端 override 解析 |
| capability snapshot 构造 | `RuntimeCapabilitySnapshot` 生成（`cap_<sha256_16hex>`） |

> 已存在：`loopForOrchestrationMode`、`orchestrationModeForRuntimeOptions`、`eventedV2RolloutDecisionForRuntimeOptions`、`eventedV2AgentGraphForRuntimeOptions`。

### 2.6 TurnService 缺失方法 — `engine/packages/engine/services/src/turn-service.ts`

| 缺失方法 | 说明 |
|---|---|
| `linkEventedV2Run` | 把 `eventedV2RunId` 持久化到 turn |
| `allocateExecutionSequence` | 分配执行序号 |

> 已存在：`finishTurn`、`applyItemOnce`、`getAbortController`、`startTurn`。

### 2.7 提示词 / 场景缺失

| 缺失项 | 现状 | 目标 |
|---|---|---|
| `coding-system-prompt.ts` | 60 行（被截断） | 补全到 84 行：加 Scenario orchestration + Recursive analysis 块，技能名替换为 KCoder 真实存在的 |
| delivery stages | 完全缺失 | 5 阶段（需求→规划→实现→审查→交付）+ 类型 + HTTP handler + 持久化 |

### 2.8 残留清理（office/finance）

KCoder 是纯 coding 应用，但 contracts 还残留 KWorks 遗留的 office/finance 模式。**本次清理**：
- `capabilities.ts`：删除 `DEFAULT_WORK_MODES` 中 office、finance 两个模式定义
- 删除 finance 模式的 30 个 `kk-*` / `chart-visualization` / `analysis-report` / `a-stock-screener` 技能引用
- 删除 finance 模式内嵌的"小s"金融分析师系统提示词（约 100 行）
- `DEFAULT_LOCKED_SKILL_IDS`：删除不存在的 `bootstrap`、`skill-manage`
- HTTP 路由：删除 `/api/finance/credentials` 等 finance 相关路由
- `finance-credentials.ts`：删除

## 3. 核心设计决策

### 3.1 Specialist（专家 agent）设计 — 10 个细粒度 specialist

基于 KCoder 实际加载的 73 技能库，每个 specialist 绑定**真实存在**的技能，按 coding 全生命周期细粒度划分。全部 `workModeId: 'coding'`，全部为中文命名。

| # | id | name | 绑定技能（真实存在） | 职责 | defaultRequired | allowSubagents |
|---|---|---|---|---|---|---|
| 1 | `planning` | 规划分析师 | brainstorming, planning, writing-plans, planning-with-files, goal, todo | 需求澄清、方案设计、任务分解、风险评估 | false | false |
| 2 | `backend` | 后端逻辑工程师 | systematic-debugging, debugging, bug-hunt, tdd, test-driven-development, refactoring, claude-api | 核心业务逻辑、API、调试、重构、单元测试 | true | true |
| 3 | `frontend` | 前端 UI 工程师 | frontend-design, frontend-polish, web-artifacts-builder, web-design-guidelines, vercel-react-best-practices, vercel-composition-patterns, vercel-react-view-transitions | UI 实现、样式、组件、视图转场、可访问性 | true | true |
| 4 | `testing` | 测试验证工程师 | tdd, test-driven-development, webapp-testing, verification-before-completion, verification, bug-hunt | 测试编写、E2E 验证、回归测试、完成度核验 | false | false |
| 5 | `review` | 代码审查员 | code-review, review, receiving-code-review, requesting-code-review, verification-before-completion | 多维度审查（正确性/可维护性）、PR review、验证 | false | false |
| 6 | `security` | 安全工程师 | security-review, bug-hunt, systematic-debugging | 安全审查、漏洞定位、输入验证、密钥处理 | false | false |
| 7 | `devops` | DevOps 工程师 | deploy, deploy-to-vercel, vercel-cli-with-tokens, executing-plans, finishing-a-development-branch, release-notes | 部署、CI/CD、发布、分支管理、发布说明 | false | true |
| 8 | `docs` | 文档工程师 | doc-coauthoring, internal-comms, release-notes, slidev | 技术文档、API 文档、内部沟通、演示 | false | false |
| 9 | `frontend-native` | 移动端工程师 | vercel-react-native-skills, remotion-best-practices, web-artifacts-builder | React Native/Expo、Remotion 视频、跨端 | false | true |
| 10 | `tooling` | 工具集成工程师 | mcp-builder, skill-creator, writing-skills, git-worktrees, using-git-worktrees, dispatching-parallel-agents, subagent-driven-development, find-skills, using-superpowers | MCP/技能扩展、git worktree、并行调度、子 agent | false | true |

**allowedTools 映射原则**：
- 规划/审查/文档/安全 → 只读工具集 `read,ls,find,grep,bash` + 少量写
- backend/frontend/native/tooling → 完整读写编辑 `read,ls,find,grep,bash,write,edit` + `web_fetch`
- 可委派的（allowSubagents=true）加 `delegate_task`
- planning 阶段的 manager 持有 `route_specialists` 工具

**设计要点**：
- 技能可被多个 specialist 引用（如 bug-hunt 在 backend/security/testing 都有），但 allowedTools 交集设计保证职责清晰
- backend/frontend 是核心，defaultRequired=true；其余按需激活
- office/finance 不做 specialist（纯 coding 应用）

### 3.2 Manager 职责 — 路由 + 可处理简单任务

Manager 节点两阶段，偏离 KWorks 纯路由模型：

1. **`manager_planning`**：读 turn prompt → 调用 `route_specialists` 工具
   - 任务复杂 → 输出 `ManagerRouteDecision{ specialists[], task[], dependsOn[] }`，激活 specialist 子图
   - **任务简单**（manager 判断无需 specialist）→ 输出 `specialists: []` 空路由，graph 直接 `manager_planning → join → manager_synthesis`，由 manager 在 planning 节点直接生成答案
2. **`manager_synthesis`**：汇总所有 specialist 结果 + manager 自身产出 → 生成最终用户可见回答

**实现差异（vs KWorks）**：
- `manager_planning` 的 `allowedTools` 包含**完整读写工具集**（不只读 + route_specialists），让 manager 能直接干活
- `materializeTeamGraph` 中 `specialists: []` 时 `manager_planning` 直接连 `join`（已有此分支，保留）
- 简单任务 manager 单节点搞定（仍走 evented_v2 统一视图），复杂任务路由到 specialist 团队并行。**统一执行路径，简化前端投影**。

### 3.3 编排模式默认值与展示

- **默认 = kernel_v3**（标准模式），但**启用 subagent**（`subagents.enabled = true` 默认配置）。kernel_v3 通过 `delegate_task` 工具实现单 agent 主导 + 按需派生子任务。
- **evented_v2**（团队模式）opt-in，通过 `orchestrationPreference: 'team'` 激活。manager-specialist 图实现团队并行。
- **展示标识**：kernel_v3 → "标准"；evented_v2 → "团队"。
- **保底 fallback**：evented_v2 preflight 失败（agentGraph 未启用或 specialist 注册表空）时自动 fallback 到 kernel_v3。

> KCoder 已有的 delegation 层（`DelegationRuntime`、`child-agent-executor`、`buildDelegationToolProviders`）和 `SubagentsCapabilityConfig` 完全支持 kernel_v3 + subagent 设计，无需额外移植。

## 4. 分阶段移植计划

每阶段独立可测、可提交。kernel_v3 全程保底。

### 阶段 1：Contracts + Ports 扩展（基础层）

**改动**：
- `multi-agent-runtime.ts`：补 `ManagerRouteDecisionSchema`、`AgentGraphSnapshotSchema`；扩展 `AgentRunSchema`（+publicKey,sequence,role,phase,transcriptRef,attempt,required）、`MultiAgentRunSchema`（+graphSnapshot,agentRuns,routeDecision,activeNodeIds,warnings）
- 新建 `turn-execution.ts`：`TurnExecutionView` 联合类型 + `AgentExecutionView`/`ToolRunView`/`ChildRunRecord` 等
- `turns.ts`：新建 `RuntimeDecisionSchema`/`RuntimeCapabilitySnapshotSchema`/`OrchestrationPreference`；`TurnSchema` 补 6 字段；`StartTurnRequest` 补 `orchestrationPreference`/`collaborationPolicy` + cross-field superRefine 校验
- `ports`：补 `AgentTranscriptStore`、`DelegationRunStore` 接口
- **清理**：`capabilities.ts` 删 office/finance 模式，只留 coding；删 `DEFAULT_LOCKED_SKILL_IDS` 中不存在的 bootstrap/skill-manage

**验证**：契约层 `tsc --noEmit` 通过；zod schema round-trip 单元测试

### 阶段 2：Specialist Registry + Graph Template

**改动**：
- 移植 `specialist-registry.ts`（`SpecialistDefinition`/`SpecialistRegistryContract`/`validateRoute`/`createDefaultSpecialistRegistry`），**填入第 3.1 节的 10 个 KCoder specialist 定义**
- 移植 `evented-v2-graph-template.ts`（`materializeTeamGraph` + `TEAM_GRAPH_TEMPLATE_ID = 'manager-specialists-v1'`）
- `engine/loop/src/index.ts` barrel 导出新增模块

**验证**：
- 注册表单测：`get`/`listEnabled`/`validateRoute`（环检测、数量上限）
- `materializeTeamGraph` 对空路由（manager 自答）和非空路由（多 specialist）都能产出合法 `AgentGraphSnapshot`

### 阶段 3：Agent Node Executor + Turn Runner + 现有 Runtime 升级

**改动**：
- 移植 `agent-node-executor.ts`（`AgentNodeExecutor` + `ManagerRouteController` + `route_specialists` 工具实现 + `NodeDelegator` + `GraphBudgetLedger`）
- 移植 `evented-v2-turn-runner.ts`（`runTurn`：loadOrStartRun → manager_planning → specialist 并行循环 → manager_synthesis → finishTurn）
- **升级**现有 `evented-v2-multi-agent-runtime.ts`：从 `AgentGraph` 模型升级到 `AgentGraphSnapshot` 模型
  - 补 `applyRouteDecision`、`completeAgentTask`、`activeNodeIds` 计算、`agentRuns` 管理
  - 保留现有的 mailbox/outbox/lease/worker registry 机制（不重写）
- `engine/loop/src/index.ts` barrel 补导出

**验证**：mock kernel 下，两条路径端到端跑通：
- 空路由（manager 自答）：manager_planning 直接产出 → synthesis 透传
- 非空路由（2 specialist 并行）：route_specialists → materializeTeamGraph → 并行执行 → join → synthesis 汇总

### 阶段 4：编排决策服务 + 执行投影 + 路由器

**改动**：
- 移植 `turn-runtime-decision-service.ts`（`TurnRuntimeDecisionService.decide()`：idempotent gate + 持久化到 turn + preflight fallback）
- 移植 `turn-execution-projection-service.ts` + `kernel-v3-execution-adapter.ts` + `evented-v2-execution-adapter.ts` + `turn-execution-sanitizer.ts` + `execution-revision-notifier.ts`
- `runtime-factory.ts`：
  - 补 `createPersistedDecisionTurnRouter`、`runtimeServerOverride`、capability snapshot 构造
  - 把三个 runner（classic/eventedV2/kernelV3）挂到 router 后面
  - `TurnExecutionProjectionService` 注入 HTTP route（`GET /v1/turns/:id/execution`）
- `TurnService`：补 `linkEventedV2Run`、`allocateExecutionSequence`
- `engine/services/src/index.ts` barrel 补导出

**验证**：
- `POST /v1/threads/:id/turns` 携带 `orchestrationPreference:'team'` → 决策 evented_v2 → 执行 → `GET /v1/turns/:id/execution` 返回 evented_v2 视图
- preflight 失败（agentGraph disabled）时自动 fallback kernel_v3，投影返回 kernel_v3 视图
- kernel_v3 路径（默认）完全无回归

### 阶段 5：场景化提示词 + Delivery Stages

**改动**：
- 补全 `coding-system-prompt.ts`（+Scenario orchestration + Recursive analysis 块，技能名替换为 KCoder 真实存在的）
- 移植 delivery stages：
  - `CODING_DELIVERY_STAGES`（5 阶段：需求→规划→实现→审查→交付，字段中文化）
  - `DeliveryStage`/`ProjectStageState`/`StageHistoryEntry`/`StageSuggestion` 类型
  - 5 个 HTTP handler：`GET/POST /api/coding/delivery-stages`、`GET/POST /api/coding/stage`、`POST /api/coding/stage/suggestion/accept|dismiss`
  - `projectStageForActor`/`saveProjectStageForActor` 持久化
- 清理 finance 相关路由（`/api/finance/credentials` 等）和 `finance-credentials.ts`

**验证**：
- delivery stages API 可用（GET 返回 5 阶段，POST 切换阶段持久化）
- 提示词注入后的 turn 正常执行（manager 能识别 stage context 推荐技能）

## 5. 架构不变性原则

1. **kernel_v3 全程保底**：任何 evented_v2 失败（preflight/runtime/投影）都 fallback 到 kernel_v3，单 agent 路径不受影响
2. **决策不可变且持久化**：`RuntimeDecision` 在 turn 上持久化一次，后续 `runTurn` 重新调用 `decide()` 命中 idempotent gate 直接返回
3. **统一执行视图**：`TurnExecutionView` 联合类型让前端用同一套投影结构渲染两种模式
4. **契约先行**：所有跨包通信走 `@qiongqi/contracts` 的 zod schema，不直接传递内部类型
5. **脱敏边界**：执行投影必须经 `sanitizeTurnExecution`，剥离 systemPrompt/transcriptRef/lease/apiKey 等内部字段（`INTERNAL_FIELD_PATTERN` 原样移植）
6. **KCoder 原生**：specialist 定义基于 KCoder 真实技能库，不引用缺失技能；office/finance 模式清理

## 6. 不在本次范围

- 桌面渲染器 UI（app/renderer）：工作模式切换器、编排模式开关、Coding Workbench 界面 —— 由团队后续根据 KCoder 功能定位自行完成
- office/finance 模式的 specialist —— 本次清理，不做
- KWorks 的 24 个 finance specialist —— 不移植
- skills 目录补全（coding 模式引用但缺失的 57 个技能）—— 独立任务，本次只保证 specialist 绑定已存在的技能

## 7. 关键移植来源映射

| KCoder 目标 | KWorks 来源 |
|---|---|
| `contracts/multi-agent-runtime.ts` 扩展 | `qiongqi/packages/foundation/contracts/src/multi-agent-runtime.ts` |
| `contracts/turn-execution.ts`（新） | `qiongqi/packages/foundation/contracts/src/turn-execution.ts` |
| `contracts/turns.ts` 扩展 | `qiongqi/packages/foundation/contracts/src/turns.ts` |
| `ports/multi-agent-runtime.ts` 扩展 | `qiongqi/packages/ports-layer/ports/src/multi-agent-runtime.ts` |
| `engine/loop/specialist-registry.ts`（新） | `qiongqi/packages/engine/loop/src/specialist-registry.ts`（机制移植，agent 重设计） |
| `engine/loop/agent-node-executor.ts`（新） | `qiongqi/packages/engine/loop/src/agent-node-executor.ts` |
| `engine/loop/evented-v2-graph-template.ts`（新） | `qiongqi/packages/engine/loop/src/evented-v2-graph-template.ts` |
| `engine/loop/evented-v2-turn-runner.ts`（新） | `qiongqi/packages/engine/loop/src/evented-v2-turn-runner.ts` |
| `engine/loop/evented-v2-multi-agent-runtime.ts`（升级） | `qiongqi/packages/engine/loop/src/evented-v2-multi-agent-runtime.ts` |
| `engine/services/turn-runtime-decision-service.ts`（新） | `qiongqi/packages/engine/services/src/turn-runtime-decision-service.ts` |
| `engine/services/turn-execution-projection-service.ts`（新） | `qiongqi/packages/engine/services/src/turn-execution-projection-service.ts` |
| `engine/services/{kernel-v3,evented-v2}-execution-adapter.ts`（新） | 同名 KWorks 文件 |
| `engine/services/{turn-execution-sanitizer,execution-revision-notifier}.ts`（新） | 同名 KWorks 文件 |
| `http/runtime-factory.ts` 扩展 | `qiongqi/packages/http-layer/http/src/runtime-factory.ts`（L337-408, L1842-2056） |
| `presets/preset-coding/coding-system-prompt.ts` 补全 | `qiongqi/packages/presets/preset-coding/src/coding-system-prompt.ts` |
| delivery stages | `qiongqi/packages/http-layer/http/src/routes/kworks-compat.ts`（L170-218, L1130-1210） |
