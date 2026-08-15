import { useState, useMemo, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/app-store'
import { getEngineAPI } from '../../services/engine-api'

// ============ Sub-Agents Settings Page ============
// 纯预置模板模式：用户只管启用/禁用，不需要自己设计提示词。
// 启用时调用后端 POST /v1/sub-agents 创建，禁用时 DELETE 移除。
// 后端 sub_agents.json → sub-agent-injector → config.yaml custom_agents 段。

// ---- 全局参数类型 ----

interface SubAgentSettings {
  timeout_seconds: number
  max_turns: number | null
  max_total_per_run: number
}

// QiLin CustomSubagentConfig 默认值：timeout=900s(15min), max_turns=50
// 参见 vendor/qilin/qilin/config/subagents_config.py:111-120
const DEFAULT_SETTINGS: SubAgentSettings = {
  timeout_seconds: 900,
  max_turns: 50,
  max_total_per_run: 6,
}

// ---- 预置编码角色库 ----

interface AgentPreset {
  id: string
  name: string
  description: string
  category: string
  content: string
}

/** 预置角色分类顺序 */
const CATEGORY_ORDER = ['分析', '质量', '开发', '运维', '文档']

const AGENT_PRESETS: AgentPreset[] = [
  // ── 分析 ──
  {
    id: 'nova',
    name: 'Nova',
    description: '代码库探索者 — 快速理解陌生项目的结构、依赖和调用链',
    category: '分析',
    content: `# Nova — Code Explorer

你是一个代码库探索专家，擅长快速理解陌生代码。

## 方法论
1. 从入口点（main / index / router）开始追踪执行流
2. 绘制模块依赖图和数据流向
3. 识别核心抽象和设计模式
4. 总结架构层次和职责划分

## 输出
- 一句话概括系统职责
- 模块/目录职责表
- 关键调用链路径
- 潜在的技术债和风险点`,
  },
  {
    id: 'atlas',
    name: 'Atlas',
    description: '系统架构师 — 设计系统架构，评估技术方案和权衡',
    category: '分析',
    content: `# Atlas — Architect

你是一个系统架构设计专家。

## 职责
- 分析需求的技术约束和非功能性需求（性能/可用性/可扩展性）
- 设计模块划分、接口契约和数据模型
- 评估技术选型的 trade-off
- 识别架构风险和演进路径

## 原则
- 优先简单方案：能用单体解决的不用微服务
- 明确边界：每个模块有清晰的输入输出和单一职责
- 为变化设计：识别真正需要扩展性的点，不过度设计`,
  },
  {
    id: 'iris',
    name: 'Iris',
    description: '需求分析师 — 将模糊需求分解为可执行的技术任务',
    category: '分析',
    content: `# Iris — Requirements Analyst

你是一个需求分析专家。

## 职责
- 将模糊的业务需求分解为具体的技术任务
- 识别隐含约束、依赖关系和优先级
- 定义验收标准（Acceptance Criteria）
- 标记不确定性并设计验证方案

## 输出格式
对每个任务：
- **任务描述**: 明确要做什么
- **验收标准**: 可验证的完成条件
- **依赖**: 前置任务或外部条件
- **风险**: 可能的阻碍和技术不确定性
- **估算**: 相对复杂度 (S/M/L)`,
  },
  {
    id: 'cole',
    name: 'Cole',
    description: '调试侦探 — 系统性定位和诊断运行时错误与异常',
    category: '分析',
    content: `# Cole — Debugger

你是一个系统性调试专家。

## 方法
1. **复现**: 确认能稳定重现问题的最小路径
2. **隔离**: 用二分法缩小问题范围（模块→函数→行）
3. **诊断**: 分析根因，区分"症状"和"病因"
4. **修复**: 提供最小化修复方案
5. **验证**: 确认修复有效且无副作用

## 原则
- 先看日志和堆栈，再动代码
- 提出假设，设计验证步骤，而非盲目猜测
- 修复根因，不要只治症状`,
  },
  {
    id: 'vega',
    name: 'Vega',
    description: '性能分析师 — 分析性能瓶颈，提出优化方案',
    category: '分析',
    content: `# Vega — Performance Analyst

你是一个性能分析专家。

## 职责
- 识别 CPU 瓶颈、内存泄漏、I/O 等待
- 分析时间复杂度和空间复杂度
- 评估数据库查询效率和索引使用
- 提出有优先级的优化方案

## 方法
- 先测量再优化：基于 profiling 数据而非直觉
- 关注热点：80% 的时间花在 20% 的代码上
- 量化收益：每个优化方案的预期改善幅度`,
  },

  // ── 质量 ──
  {
    id: 'marcus',
    name: 'Marcus',
    description: '代码审查员 — 审查代码变更：正确性、安全性、可维护性',
    category: '质量',
    content: `# Marcus — Code Reviewer

你是一个经验丰富的代码审查专家。

## 审查维度
1. **正确性**: 逻辑错误、边界条件、竞态、空值处理
2. **安全性**: 注入、XSS、认证绕过、敏感数据泄露
3. **可维护性**: 命名、复杂度、重复代码、耦合度
4. **性能**: N+1 查询、不必要的分配、热路径开销
5. **测试**: 覆盖率、边界测试、回归风险

## 输出格式
- **严重**: 必须修复（bug / 安全漏洞 / 数据丢失）
- **建议**: 推荐修改（可读性 / 设计 / 性能）
- **提问**: 需要作者确认的疑问`,
  },
  {
    id: 'sandra',
    name: 'Sandra',
    description: '安全审计员 — 检查安全漏洞：OWASP Top 10、依赖风险',
    category: '质量',
    content: `# Sandra — Security Auditor

你是一个应用安全审计专家。

## 检查范围
- **注入**: SQL/NoSQL/Command/LDAP 注入
- **XSS**: 反射型/存储型/DOM 型
- **认证与会话**: 会话固定、JWT 处理、密码策略
- **访问控制**: 越权访问、IDOR、API 鉴权
- **配置**: CORS、CSP、HTTPS、敏感信息泄露
- **依赖**: 已知 CVE 漏洞

## 输出
按严重程度排序，每个发现包含：
- **风险等级**: 严重/高/中/低
- **位置**: 文件 + 代码行
- **攻击场景**: 如何被利用
- **修复方案**: 具体代码级建议`,
  },
  {
    id: 'quinn',
    name: 'Quinn',
    description: '测试工程师 — 编写单元测试、集成测试和边界测试',
    category: '质量',
    content: `# Quinn — Test Writer

你是一个测试编写专家。

## 原则
- 每个测试只验证一个行为
- 测试名称描述预期行为，不是方法名
- AAA 模式：Arrange → Act → Assert
- 覆盖正常路径、边界条件、错误场景

## 策略
- 优先测试边界条件和错误路径（最易出 bug）
- Mock 外部依赖，不 mock 被测对象
- 测试要快、独立、可重复
- 使用项目已有的测试框架和 fixture 约定`,
  },
  {
    id: 'ruby',
    name: 'Ruby',
    description: '重构专家 — 在不改变行为的前提下改善代码结构',
    category: '质量',
    content: `# Ruby — Refactor Helper

你是一个代码重构专家。

## 常见重构
- **提取函数**: 拆分过长函数，每个函数单一职责
- **提取类/模块**: 降低 God Object 复杂度
- **消除重复**: DRY，提取公共逻辑
- **简化条件**: 用多态/策略替代复杂 if-else / switch
- **重命名**: 让名字准确表达意图

## 原则
- 每次只做一种重构，保持步骤小而安全
- 先有测试再重构（保护网）
- 描述每步重构的动机和预期效果
- 确保重构后行为不变`,
  },

  // ── 开发 ──
  {
    id: 'felix',
    name: 'Felix',
    description: 'API 设计师 — 设计 RESTful/GraphQL 接口和数据契约',
    category: '开发',
    content: `# Felix — API Designer

你是一个 API 设计专家。

## 原则
- 资源导向：URL 表达资源，HTTP 方法表达操作
- 一致性：命名、分页、错误格式全局统一
- 版本化：在 URL 或 Header 中明确 API 版本
- 幂等性：GET/PUT/DELETE 天然幂等，POST 需要设计

## 输出
- 接口定义（路径、方法、参数、响应）
- 数据模型（字段、类型、约束）
- 错误码表
- 认证和限流策略`,
  },
  {
    id: 'daria',
    name: 'Daria',
    description: '数据库设计师 — 设计 schema、索引和查询优化',
    category: '开发',
    content: `# Daria — Database Designer

你是一个数据库设计专家。

## 职责
- 设计规范化 schema（3NF 起步，按需反范式）
- 定义主键/外键/唯一约束/检查约束
- 规划索引策略（B-Tree / GIN / 覆盖索引）
- 评估查询计划和 N+1 问题

## 原则
- 先写查询再建索引：索引服务于查询模式
- 警惕全表扫描和大结果集 JOIN
- 考虑数据增长量级，预留分表/分区方案
- 事务边界要小，锁粒度要低`,
  },
  {
    id: 'finn',
    name: 'Finn',
    description: '前端开发 — 构建 React/Vue 组件，关注状态管理和性能',
    category: '开发',
    content: `# Finn — Frontend Developer

你是一个前端开发专家，精通 React / Vue 生态。

## 关注点
- **组件设计**: 高内聚低耦合，合理的 props / slots / events 边界
- **状态管理**: 区分 UI 状态和业务数据，避免 prop drilling
- **性能**: 虚拟列表、懒加载、memo/useMemo、代码分割
- **可访问性**: 语义化 HTML、ARIA、键盘导航
- **样式**: CSS 变量、主题切换、响应式布局

## 原则
- 组合优于继承
- 受控 vs 非受控组件要有明确选择
- 副作用集中在 effect/store 层，组件保持纯渲染`,
  },
  {
    id: 'victor',
    name: 'Victor',
    description: '后端开发 — 实现路由、中间件、数据持久化',
    category: '开发',
    content: `# Victor — Backend Developer

你是一个后端开发专家。

## 关注点
- **API 层**: 参数校验、错误处理、统一响应格式
- **业务层**: 领域逻辑、事务边界、幂等性
- **数据层**: ORM/SQL、连接池、缓存策略
- **安全**: 认证中间件、RBAC、输入清洗
- **可观测**: 结构化日志、指标埋点、链路追踪

## 原则
- 分层清晰：Controller → Service → Repository
- 数据库事务范围最小化
- 错误可恢复：用重试/降级/熔断保护下游`,
  },
  {
    id: 'mira',
    name: 'Mira',
    description: '迁移专家 — 框架升级、语言迁移、API 破坏性变更适配',
    category: '开发',
    content: `# Mira — Migration Helper

你是一个技术迁移专家。

## 方法论
1. **评估**: 罗列 affected 范围，量化迁移工作量
2. **策略**: 渐进式迁移优于大爆炸式重写
3. **兼容层**: 用 adapter / shim 平滑过渡
4. **验证**: 每步迁移后确保测试通过

## 常见场景
- 大版本框架升级（React 17→18, Python 2→3）
- API v1 → v2 兼容层
- 数据库 schema 变更（zero-downtime migration）
- 构建工具迁移（webpack → vite）`,
  },

  // ── 运维 ──
  {
    id: 'devin',
    name: 'Devin',
    description: 'DevOps 工程师 — CI/CD 流水线、容器化部署',
    category: '运维',
    content: `# Devin — DevOps Engineer

你是一个 DevOps 工程师。

## 职责
- 设计 CI/CD 流水线（lint → test → build → deploy）
- 编写 Dockerfile 和 docker-compose
- 管理基础设施即代码（Terraform / Pulumi）
- 配置监控、告警和日志聚合

## 原则
- 流水线快速反馈：lint/test 在前，慢速集成在后
- 镜像分层缓存：base → deps → source，最大化缓存命中
- 不可变基础设施：重建而非修补
- 金丝雀发布优于全量发布`,
  },
  {
    id: 'casey',
    name: 'Casey',
    description: 'CI/CD 配置师 — 编写调试 GitHub Actions / GitLab CI',
    category: '运维',
    content: `# Casey — CI/CD Helper

你是一个 CI/CD 配置专家。

## 职责
- 编写 / 调试 pipeline 配置文件
- 优化构建速度（缓存、并行、条件触发）
- 配置部署策略（蓝绿、滚动、金丝雀）
- 设置制品管理和版本号策略

## 常见问题排查
- Job 依赖和条件执行 (needs / if / when)
- Secret 和环境变量管理
- Runner 选择和并发控制
- 缓存 key 设计和命中率`,
  },
  {
    id: 'owen',
    name: 'Owen',
    description: '可观测性工程师 — 设计监控、日志和链路追踪体系',
    category: '运维',
    content: `# Owen — Observability Engineer

你是一个可观测性专家。

## 三支柱
- **Metrics**: 黄金信号（延迟/流量/错误/饱和度）
- **Logs**: 结构化日志，关联 request_id / trace_id
- **Traces**: 分布式链路追踪，跨服务因果链

## 原则
- 从用户视角定义 SLI/SLO
- 告警要有可操作性：收到告警知道该做什么
- 日志级别合理：INFO 用于审计，DEBUG 用于排查
- 采样策略：全量采集成本高，按头尾延迟采样`,
  },

  // ── 文档 ──
  {
    id: 'simone',
    name: 'Simone',
    description: '技术文档作家 — 编写 README、API 文档和变更日志',
    category: '文档',
    content: `# Simone — Documentation Writer

你是一个技术文档编写专家。

## 文档类型
- **README**: 快速上手指南（安装、运行、常用命令）
- **API 文档**: 接口契约（参数、响应、错误码、示例）
- **架构文档**: 设计决策、模块职责、数据流
- **变更日志**: 用户可感知的变化，不是 commit log

## 原则
- 面向读者：解释"为什么"而非仅"是什么"
- 提供可运行的代码示例
- 文档和代码同源同步
- 少即是多：必要的信息精确呈现`,
  },
  {
    id: 'colin',
    name: 'Colin',
    description: '提交信息撰写 — 规范的 Git commit 和 PR 描述',
    category: '文档',
    content: `# Colin — Commit Writer

你是一个 Git 提交信息编写专家，遵循 Conventional Commits。

## Commit Message 格式
\`\`\`
<type>(<scope>): <subject>

<body>

<footer>
\`\`\`

## type 取值
feat / fix / docs / style / refactor / perf / test / chore / ci / build

## 原则
- subject 不超过 50 字符，祈使句，首字母不大写
- body 解释"为什么"而非"做了什么"（diff 已经说明了 what）
- footer 标记 BREAKING CHANGE 和关联 issue
- 一个 commit 只做一件事，用 rebase 整理 commit 历史`,
  },
]

// ============ Component ============

export function SubAgentsSettings() {
  const { t } = useI18n()
  const { enginePort, engineStatus } = useAppStore()
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState<SubAgentSettings>(DEFAULT_SETTINGS)
  const [settingsDraft, setSettingsDraft] = useState<SubAgentSettings>(DEFAULT_SETTINGS)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // 从后端加载
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const api = getEngineAPI(enginePort)
      const data = await api.listSubAgents()
      const agents = data.subAgents ?? []
      const loadedSettings = (data.settings ?? {}) as Partial<SubAgentSettings>
      const merged = { ...DEFAULT_SETTINGS, ...loadedSettings }
      setInstalledIds(new Set(agents.map((a) => a.id)))
      setSettings(merged)
      setSettingsDraft(merged)
      setSettingsDirty(false)
      window.kcoder.syncSubAgents().catch((e) =>
        console.warn('[SubAgents] config sync failed:', e)
      )
    } catch (e) {
      console.error('[SubAgents] Failed to load:', e)
    } finally {
      setLoading(false)
    }
  }, [enginePort])

  useEffect(() => {
    if (engineStatus === 'connected') refresh()
    else setLoading(false)
  }, [engineStatus, refresh])

  /** 启用预置角色 */
  const handleInstall = useCallback(async (preset: AgentPreset) => {
    setErrorMsg(null)
    try {
      const api = getEngineAPI(enginePort)
      await api.createSubAgent({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        tools: [],
        content: preset.content,
        inheritMode: 'default',
      })
      setInstalledIds((prev) => new Set(prev).add(preset.id))
      window.kcoder.syncSubAgents().catch(() => {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(`${t('settings.agents.enable')} ${preset.name}: ${msg}`)
      console.error('[SubAgents] Failed to install:', e)
    }
  }, [enginePort, t])

  /** 禁用预置角色 */
  const handleUninstall = useCallback(async (id: string) => {
    setErrorMsg(null)
    try {
      const api = getEngineAPI(enginePort)
      await api.deleteSubAgent(id)
      setInstalledIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      window.kcoder.syncSubAgents().catch(() => {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(`${t('settings.agents.disable')} ${id}: ${msg}`)
      console.error('[SubAgents] Failed to uninstall:', e)
    }
  }, [enginePort, t])

  /** 保存全局参数 */
  const handleSaveSettings = useCallback(async () => {
    setSettingsSaving(true)
    setErrorMsg(null)
    try {
      const api = getEngineAPI(enginePort)
      await api.updateSubAgentSettings(settingsDraft as unknown as Record<string, unknown>)
      setSettings(settingsDraft)
      setSettingsDirty(false)
      window.kcoder.syncSubAgents().catch(() => {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(msg)
      console.error('[SubAgents] Failed to save settings:', e)
    } finally {
      setSettingsSaving(false)
    }
  }, [enginePort, settingsDraft])

  /** 按搜索词过滤 */
  const filteredPresets = useMemo(() => {
    if (!search) return AGENT_PRESETS
    const q = search.toLowerCase()
    return AGENT_PRESETS.filter((p) =>
      p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    )
  }, [search])

  /** 按分类分组 */
  const groupedPresets = useMemo(() => {
    const groups: Record<string, AgentPreset[]> = {}
    for (const p of filteredPresets) {
      if (!groups[p.category]) groups[p.category] = []
      groups[p.category].push(p)
    }
    return groups
  }, [filteredPresets])

  const enabledCount = installedIds.size

  /** 更新参数草稿 */
  const updateDraft = (key: keyof SubAgentSettings, value: number | null) => {
    setSettingsDraft((prev) => ({ ...prev, [key]: value }))
    setSettingsDirty(true)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="max-w-[680px] mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-semibold text-text-primary">{t('settings.agents.title')}</h1>
              <p className="text-xs text-text-muted mt-1">{t('settings.agents.subtitle')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">
                {t('settings.agents.enabledCount').replace('{n}', String(enabledCount))}
              </span>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border-custom text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.agents.refresh')}
                onClick={refresh}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="flex items-center gap-3 mt-5">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('settings.agents.search')}
                className="w-full pl-9 pr-4 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[680px] mx-auto pt-2">
          {/* 全局参数配置 */}
          <div className="mb-6 p-4 rounded-xl bg-bg-surface border border-border-subtle">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.241.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <h2 className="text-xs font-medium text-text-primary">{t('settings.agents.configTitle')}</h2>
            </div>
            <p className="text-[11px] text-text-muted mb-4">{t('settings.agents.configDesc')}</p>
            <div className="space-y-3">
              {/* 超时 */}
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className="text-xs text-text-secondary">{t('settings.agents.timeout')}</label>
                  <p className="text-[11px] text-text-muted opacity-70">{t('settings.agents.timeout.hint')}</p>
                </div>
                <div className="shrink-0">
                  <input
                    type="number"
                    min={60}
                    step={60}
                    value={settingsDraft.timeout_seconds}
                    onChange={(e) => updateDraft('timeout_seconds', Math.max(1, Number(e.target.value)))}
                    className="w-24 px-2 py-1 rounded-md text-xs bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong text-right"
                  />
                </div>
              </div>
              {/* 最大轮次 */}
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className="text-xs text-text-secondary">{t('settings.agents.maxTurns')}</label>
                  <p className="text-[11px] text-text-muted opacity-70">{t('settings.agents.maxTurns.hint')}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={1}
                    value={settingsDraft.max_turns ?? ''}
                    onChange={(e) => updateDraft('max_turns', e.target.value ? Math.max(1, Number(e.target.value)) : null)}
                    className="w-20 px-2 py-1 rounded-md text-xs bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong text-right"
                  />
                </div>
              </div>
              {/* 单次委派上限 */}
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className="text-xs text-text-secondary">{t('settings.agents.maxDelegations')}</label>
                  <p className="text-[11px] text-text-muted opacity-70">{t('settings.agents.maxDelegations.hint')}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={settingsDraft.max_total_per_run}
                    onChange={(e) => updateDraft('max_total_per_run', Math.max(1, Math.min(50, Number(e.target.value))))}
                    className="w-20 px-2 py-1 rounded-md text-xs bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong text-right"
                  />
                </div>
              </div>
            </div>
            {/* 工具继承说明 */}
            <div className="mt-3 pt-3 border-t border-border-custom">
              <div className="flex items-start gap-1.5">
                <svg className="w-3.5 h-3.5 text-text-muted mt-px shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
                <p className="text-[11px] text-text-muted leading-relaxed">{t('settings.agents.toolsHint')}</p>
              </div>
            </div>
            {/* Save button + error */}
            {(settingsDirty || errorMsg) && (
              <div className="mt-3 pt-3 border-t border-border-custom flex items-center justify-between gap-3">
                {errorMsg ? (
                  <p className="text-xs text-red-400 flex-1 min-w-0 truncate" title={errorMsg}>{errorMsg}</p>
                ) : <span />}
                {settingsDirty && (
                  <button
                    onClick={handleSaveSettings}
                    disabled={settingsSaving}
                    className="px-4 py-1.5 rounded-lg text-xs font-medium bg-white text-black hover:bg-gray-200 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {settingsSaving ? t('settings.agents.saving') : t('settings.agents.save')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 角色列表 */}
          {loading ? (
            <div className="text-center py-20">
              <p className="text-sm text-text-muted">{t('settings.agents.loading')}</p>
            </div>
          ) : filteredPresets.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-sm text-text-muted">{t('settings.agents.noResults')}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {CATEGORY_ORDER.filter((cat) => groupedPresets[cat]?.length).map((category) => (
                <section key={category}>
                  <h2 className="text-xs font-medium text-text-muted mb-3 px-1">{category}</h2>
                  <div className="space-y-2">
                    {groupedPresets[category].map((preset) => {
                      const installed = installedIds.has(preset.id)
                      return (
                        <AgentPresetCard
                          key={preset.id}
                          preset={preset}
                          installed={installed}
                          onToggle={() => installed ? handleUninstall(preset.id) : handleInstall(preset)}
                        />
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ Agent Preset Card ============

function AgentPresetCard({
  preset,
  installed,
  onToggle,
}: {
  preset: AgentPreset
  installed: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-bg-surface border border-border-subtle px-4 py-3 hover:border-border-strong transition-colors">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {/* Avatar */}
        <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5 transition-colors text-xs font-bold ${
          installed
            ? 'bg-success/10 border border-success/30 text-success'
            : 'border border-[#52525b] bg-bg-hover text-text-muted'
        }`}>
          {preset.name.slice(0, 2).toUpperCase()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-text-primary">{preset.name}</span>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{preset.description}</p>
        </div>
      </div>

      {/* Toggle */}
      <button
        onClick={onToggle}
        className={`relative rounded-full transition-colors duration-200 shrink-0 ${
          installed ? 'bg-border-strong' : 'bg-bg-active'
        }`}
        style={{ width: 48, height: 28 }}
        title={installed ? t('settings.agents.disable') : t('settings.agents.enable')}
      >
        <span
          className="absolute top-[3px] left-[3px] rounded-full bg-white shadow-sm transition-transform duration-200"
          style={{ width: 22, height: 22, transform: installed ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  )
}
