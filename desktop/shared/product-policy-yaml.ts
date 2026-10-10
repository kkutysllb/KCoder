/**
 * KCoder 产品策略层内容（纯数据，无依赖）。
 *
 * 单独成模块的原因：scripts/check-session-preset-migration.mjs 要在**系统
 * node**（无 electron）下导入本表做结构不变量断言——product-policy.ts 拽着
 * dsh-contract（electron 链），不能被脚本导入。行为半区（幂等物化、--patch
 * 参数、版本门）在 desktop/main/product-policy.ts；本模块只有内容。
 *
 * 逐条决策的完整注释见下方 YAML 内注释与 product-policy.ts 文件头。
 *
 * @module desktop/shared/product-policy-yaml
 */

/** 产品策略层内容（宿主自动生成，勿手改——每次启动按代码重写）。 */
export const POLICY_YAML = `# KCoder 产品策略层（宿主自动生成，勿手改——每次启动按代码重写）
#
# 由宿主以 \`dsh web --patch <本文件>\` 引入；上游补丁层序为
# bundle → profile → home → overlay（overlay 最后应用），故可稳定覆写
# 上游 bundle 行的 config（整份替换语义）。
#
# 会话日志不上传（产品决策 D2）：上游 0.1.6-alpha.1 起
# session-log-deepseek 的 enabled 默认 true，会把完整未接受会话日志后缀
# （消息正文、工具参数与结果、工作区路径、反馈）随 DeepSeek 请求上报。
# KCoder 不参与该贡献，显式关闭。
- id: session-log-deepseek
  config:
    enabled: false
#
# 原生右侧栏终端 tab：**2026-10-09 起解除禁用**（原两行 id: ui-sidebar-terminal /
# disabled: true 于此撤销）。原意是防与 dsh-coding-sidebar 的终端双入口；
# 该插件整线退役、右侧工作台交回上游原生后，终端 tab 一并交回（产品拍板）。
# ⚠ 宿主 api-terminal-controller **始终不可禁用**——packages/api/remotes 静态
# import 并 $mount 它的 remote，禁用会让 api-remotes 挂载失败（主对话链全挂）；
# 当年被禁的也只是 UI 面。
#
# 内置浏览器（产品决策 2026-09-22）：上游 bundle 行用 !!js 按 profile 名
# 判定（非 desktop 即禁用），而 KCoder 桌面壳的 profile 名是 web →
# 会被误关。此处以同 id 行覆盖 disabled 字段放开（bundle base 行保留，
# 只看最终解析值）。见文件头第三条决策。
- id: ui-sidebar-browser
  disabled: false
#
# 原生 changed-files 尾卡**恢复开启**（2026-10-04）：file-review 退役后本行
# 是该审查行的唯一渲染者。历史（2026-09-19 → 2026-10-04）：当时关闭（fork
# d3cc056ee6 的 tailCard 配置闸门）是因为 file-review 增强卡按三层互让接管
# 该行——list 语义下原生条目无法被抢占，不关即同一 turn 双行。但该卡认领的是
# produced 与 presented **两张脸**（见其 cordis.patch.yml），所以退役时**必须**
# 把本开关恢复：否则不只变更行没了，「present」交付卡也会一起失去行。
# deliverables 数据定义与其余注册始终保留（下游探测的输入源）。
- id: ui-deliverables
  config:
    tailCard: true
#
# Session Log 上传开关整行禁用（D2.1，2026-09-29）：上游 0.2.0-rc.1 新增
# 「设置 → 通用 → 在使用官方模型 API 时上传 Session Log」开关。本层在最后一层
# 整份替换 config，用户写进 profile 的 enabled 会被上面的 session-log-deepseek
# 关闭项永久盖掉——开关点了不生效。既然 D2 决定强制关闭，就整行禁用该设置页
# 条目，不留误导性控件。
- id: ui-settings-session-log
  disabled: true
#
# 桌面遥测显式关闭（D3，2026-09-29）：两行上游以 !!js 按 profile 名判定
# （非 desktop 即关）。KCoder 的 profile 名是 web，当下不会启用，但那是靠名字
# 巧合的隔离；显式禁用可防上游改默认值或我方改名导致的静默开启。
- id: desktop-product-telemetry
  disabled: true
- id: product-analytics
  disabled: true
#
# ── Agent 预设收缩为单一 PTC 模式（产品决策 2026-10-10，D4）──────────
# 上游四个预设（standard/ptc/minimal/cordis）裁剪为一个：PTC 吸收创造模式
# 的能力后成为产品唯一预设。三处落点：
# 1) 其余三行禁用——行仍在 web-app bundle（insert 而来），disabled 即 roster
#    不出现、组合不挂载；本层按 id 定向，上游增删预设文件不影响这几行。
- id: preset-standard
  disabled: true
- id: preset-minimal
  disabled: true
- id: preset-cordis
  disabled: true
# 2) 合并预设：以 ptc 行为基底**整份替换 config**（补丁语义：config 键整份
#    替换而非深合并，见 vendor/include applyEntryPatches）。相对上游 ptc 行的
#    三处增量，全部来自 cordis 行：tool-cordis（运行时自省）、skill-filesystem
#    的 customSkillDirs（预设自带 4 个创作技能，追加语义不挤掉默认技能目录）、
#    tool-plugin-manager 从硬禁改为「有 profile 上下文即启用」（KCoder 桌面壳
#    恒有 ⇒ 启用；与 cordis 用户原有语义一致）。workflow 两行**保持禁用**
#    （产品拍板 a：尊重上游 PTC 纪律——模型编排面统一走 run_code，不并存
#    第二个模型可写的编排工具；subagent/fork 编排仍可在程序内派发）。
#    id 保持 'ptc' 不改：存量会话迁移映射（session-preset-migration.ts）与
#    引擎会话兼容都锚定该 id；mode: ptc 依赖的 ptcRuntime 由 dsh-base bundle
#    常备挂载（packages/bundle/base/cordis.patch.yml），组合不会因缺运行时
#    mount 失败。上游对四份预设文件做同步调优时，本快照需随升级对账
#    （scripts/check-session-preset-migration.mjs 钉了结构不变量）。
- id: preset-ptc
  config:
    id: ptc
    order: 1
    plugins:
      - id: persona
        name: '@deepseek-ai/dsh-persona'
        config:
          prefix: You are a coding agent powered by the {{model}} model.
      - id: agent-instructions
        name: '@deepseek-ai/dsh-agent-instructions'
        config:
          maxBytes: 65536
      - id: time-context
        name: '@deepseek-ai/dsh-time-context'
      - id: tool-bash
        name: '@deepseek-ai/dsh-tool-bash'
        disabled: !!js process.platform === 'win32'
      - id: tool-pwsh
        name: '@deepseek-ai/dsh-tool-pwsh'
        disabled: !!js process.platform !== 'win32'
      - id: tool-fs
        name: '@deepseek-ai/dsh-tool-fs'
      - id: tool-fs-search
        name: '@deepseek-ai/dsh-tool-fs-search'
        config:
          sampleOverCapGlobResults: false
      - id: tool-jobs
        name: '@deepseek-ai/dsh-tool-jobs'
      - id: tool-schedule
        name: '@deepseek-ai/dsh-tool-schedule'
      - id: tool-cordis
        name: '@deepseek-ai/dsh-tool-cordis'
      - id: skill-filesystem
        name: '@deepseek-ai/dsh-skill-filesystem'
        config:
          customSkillDirs:
            - !!js process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('@deepseek-ai/dsh-agent-preset/package.json')), 'skills')
      - id: tool-skill
        name: '@deepseek-ai/dsh-tool-skill'
      - id: command-goal
        name: '@deepseek-ai/dsh-command-goal'
      - id: tool-goal
        name: '@deepseek-ai/dsh-tool-goal'
      - id: planning
        name: cordis:group
        group: true
        isolate:
          planMode: true
        config:
          - id: plan-mode
            name: '@deepseek-ai/dsh-plan-mode'
            config:
              section: |
                You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

                Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

                The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

                Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

                Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

                When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.
      - id: compaction
        name: cordis:group
        group: true
        isolate:
          compaction: true
          toolResultPruner: true
        config:
          - id: compaction-basic
            name: '@deepseek-ai/dsh-compaction-basic'
          - id: command-compact
            name: '@deepseek-ai/dsh-command-compact'
          - id: tool-result-pruner
            name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
            config:
              thresholdChars: 8192
              headChars: 4096
              tailChars: 1024
      - id: delegation
        name: cordis:group
        group: true
        isolate:
          workflowEngine: true
        config:
          - id: tool-subagent-control
            name: '@deepseek-ai/dsh-tool-subagent-control'
          - id: tool-subagent-list-agents
            name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
          - id: tool-subagent
            name: '@deepseek-ai/dsh-tool-subagent'
            config:
              provider: spawn
              toolName: subagent
              modelSelectionSettings: true
              toolFilter:
                deny:
                  - schedule_create
                  - schedule_delete
                  - schedule_list
                  - schedule_update
          - id: tool-subagent-fork
            name: '@deepseek-ai/dsh-tool-subagent'
            config:
              provider: fork
              toolName: subagent_fork
              toolFilter:
                deny:
                  - schedule_create
                  - schedule_delete
                  - schedule_list
                  - schedule_update
          - id: workflow-ptc
            name: '@deepseek-ai/dsh-workflow-ptc'
            disabled: true
            config:
              provider: spawn
          - id: tool-workflow
            name: '@deepseek-ai/dsh-tool-workflow'
            disabled: true
      - id: tool-ask-user
        name: '@deepseek-ai/dsh-tool-ask-user'
      - id: tool-todo
        name: '@deepseek-ai/dsh-tool-todo'
        config:
          allowParallelInProgress: true
      - id: tool-web
        name: '@deepseek-ai/dsh-tool-web'
        config:
          fetch: true
          searchTimeoutMs: 60000
      - id: tool-presentation
        name: '@deepseek-ai/dsh-agent-tool-presentation'
        config:
          mode: ptc
      - id: present
        name: '@deepseek-ai/dsh-tool-present'
      - id: tool-plugin-manager
        name: '@deepseek-ai/dsh-plugin-manager/tools'
        disabled: !!js "!ctx.get('profileContext')"
# 3) 默认预设钉到 ptc：本层在用户 profile 层之后应用、config 整份替换，
#    用户手写的 agent-preset-registry 行（default: standard）被此行覆盖。
#    selectedDefault 是 volatile 值，随启动复位到该钉值，运行期无 UI 可改
#    （ui-agent-preset 整行禁用，见下）——新会话永远解析到 ptc。
- id: agent-preset-registry
  config:
    default: ptc
    selectedDefault: ptc
#
# 预设 GUI 面**整行禁用**（产品决策：前端零预设面——ptc 是产品默认、后台
# 运行、不显性展示）。该客户端行挂四个面：设置区（roster 管理）、新任务
# 英雄条 chip、会话头预设徽章、「让 Agent 创建插件」菜单项，禁用即四处全部
# 消失（槽位是「声明+授权」模式，无注册者渲染空，不响亮失败）。⚠ 引擎侧
# agent-preset-registry 行（会话组合/resume/select remote/设置命名空间）
# 不受影响，上面那条覆写的就是它。KCoder 标题栏的几何收纳对缺席座位已
# 兜底（workspace-header 的簇宽度计算），无需壳侧改动。
- id: ui-agent-preset
  disabled: true

`
