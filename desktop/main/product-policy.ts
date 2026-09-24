/**
 * KCoder 产品策略补丁层（`dsh web --patch` overlay）。
 *
 * 与 profile 用户补丁（`$DSH_HOME/profiles/web/cordis.patch.yml`）和 home
 * 补丁（`$DSH_HOME/cordis.patch.yml`）不同，本层是**产品自己的**策略：随
 * KCoder 代码走、由宿主每次启动重写、独占 `$DSH_HOME/cordis.patch.kcoder.yml`
 * 一个文件名，永不与用户手写内容互相覆盖。
 *
 * 为什么用 CLI overlay 而不是写进用户的补丁文件：
 * - 上游补丁层序是 bundle → profile → home → **overlay**
 *   （apps/cli/src/profile-boot.ts 的 composeEntries），--patch 是最外一层，
 *   覆写上游 bundle 行的 `config` 最稳（applyEntryPatches 对同名 key 直接赋值，
 *   即整份替换而非深合并）；
 * - `$DSH_HOME/profiles/web/cordis.patch.yml` 会被 mcp-store 整份 YAML
 *   重新序列化（注释不保），托管块放进去会被反复抹掉；
 * - 不污染 dsh CLI 自己在共享 `~/.dsh` 里读写的 home 补丁文件。
 *
 * 版本门：--patch 自 0.1.0-rc.8 前即存在（rc.7 亦有），但 DSH_BIN 可指向
 * 任意旧版，未知版本保守不传（与 webNoOpen 同款策略，见 dsh-contract）。
 *
 * @module desktop/main/product-policy
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { dshHome } from './dsh-contract'

/** 产品策略层文件名（`$DSH_HOME` 下，KCoder 独占）。 */
const POLICY_FILENAME = 'cordis.patch.kcoder.yml'

/**
 * 产品策略层内容，两条产品决策：
 * - **会话日志不上传**（D2，2026-09-15）：上游 0.1.6-alpha.1 起
 *   `session-log-deepseek.Config.enabled` 默认 true——每次 DeepSeek 请求会把
 *   完整未接受的会话日志后缀（消息正文、工具参数与结果、工作区路径、反馈）
 *   上报到所连端点/网关。KCoder 不参与该贡献。
 * - **原生右侧栏终端 tab 禁用**（2026-09-15 D1a 补强，2026-09-18 恢复）：
 *   终端由内置 `@kkutysllb/dsh-terminal` 承担；右侧栏外壳已回归原生，但
 *   原生终端 tab 与自研终端并存即双入口，此行继续摘掉原生 tab。
 * - **内置浏览器按「桌面壳 = Electron」放开**（2026-09-22，上游 0.1.7-alpha.1
 *   起 ui-sidebar-browser 的默认值按 profile 名判定：`profileContext?.name
 *   !== 'desktop'` 即禁用。KCoder 桌面壳跑的是 `web` profile，故上游默认把
 *   内置浏览器关掉——与「Web 默认关 / Electron 默认开」的上游产品语义相悖。
 *   KCoder 只有 Electron 一种宿主，故显式放开该行；聊天链接的打开位置仍由
 *   chat 设置 `linkOpening` 决定（默认 sidebar = 内置浏览器 tab）。
 * - **定时任务与时间上下文默认开启**（2026-09-24，上游 0.1.7-rc.2）：上游
 *   在 web-app 层把三行以 `disabled: true` 出厂（说明文案「Web 和桌面端默认
 *   关闭…需要时可手动启用」），但**界面上不存在启用入口**——承载它们的
 *   `@deepseek-ai/dsh-web-app` 被插件管理页按设计排除
 *   （`ui-plugin-manager/README.zh.md`：「页面从卡片与数量中排除内置 profile
 *   组合包，**即使 profile 将它们列为依赖**」），官方指定路径是让 agent 装
 *   一个覆盖该行的工作区 bundle。KCoder 直接在产品策略层放开，开箱即用。
 *   三行是一个整体：`schedule` = Host 任务服务与到点投递、`ui-schedule` =
 *   任务管理与运行记录（浏览器半）、`time-context` = 当前时间/时区/已用时长
 *   ——模型解析「明天九点」这类未限定时间所必需（上游同版删除的
 *   `apps/cli/config/examples/schedule/cordis.yml` 就是这三行一起开）。
 *
 * 历史行（已移除）：`file-review-tab` 禁用（2026-09-18）——file-review
 * 插件整体退役（typert 产物过不了 alpha.2 typert-loader 校验，曾拖垮全部
 * 远端定义注册，见 docs/upstream-0.1.6-alpha.2-analysis.md §9），行随插件
 * 退役失去意义。
 */
const POLICY_YAML = `# KCoder 产品策略层（宿主自动生成，勿手改——每次启动按代码重写）
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
# 原生右侧栏的终端 tab：终端由内置 @kkutysllb/dsh-terminal 承担，
# 原生终端 UI 整行禁用防双入口。宿主 api-terminal-controller 必须保留
# ——packages/api/remotes 静态 import 并 $mount 它的 remote，禁用会让
# api-remotes 挂载失败（主对话链全挂）。
- id: ui-sidebar-terminal
  disabled: true
#
# 内置浏览器（产品决策 2026-09-22）：上游 bundle 行用 !!js 按 profile 名
# 判定（非 desktop 即禁用），而 KCoder 桌面壳的 profile 名是 web →
# 会被误关。此处以同 id 行覆盖 disabled 字段放开（bundle base 行保留，
# 只看最终解析值）。见文件头第三条决策。
- id: ui-sidebar-browser
  disabled: false
#
# 原生 changed-files 尾卡关闭（2026-09-19，fork d3cc056ee6 的 tailCard
# 配置闸门）：file-review 增强卡（hunks/统计/撤销 + 产物与交付两段）
# 已按三层互让接管该行（changes 公告 turn 由其渲染）；list 语义下原生
# 条目无法被抢占，不关则同一 turn 双行。deliverables 数据定义与其余
# 注册全部保留（下游探测的输入源）。
- id: ui-deliverables
  config:
    tailCard: false
#
# 定时任务 / 时间上下文默认开启（产品决策 2026-09-24，上游 0.1.7-rc.2）：
# 三行在上游 web-app 层以 disabled: true 出厂，且**界面无启用入口**（承载它们
# 的 @deepseek-ai/dsh-web-app 被插件管理页按设计排除，官方路径是让 agent 装
# 覆盖用的工作区 bundle）。产品策略层直接放开，用户开箱即用。
# 最小写法只给 id + disabled：上游按 id 定位行、按字段覆写，name 由 bundle 层
# 保留（已用 --dump-config 实测三行 name 均在位）。
# 注意 overlay 在最后一层 ⇒ 会盖掉用户对这三行的手动关闭；若将来要「只在新建
# profile 播种、尊重用户选择」，须改走 profile 层而非本层。
- id: time-context
  disabled: false
- id: schedule
  disabled: false
- id: ui-schedule
  disabled: false
`

/** 产品策略层的绝对路径。 */
export function productPolicyPath(): string {
  return join(dshHome(), POLICY_FILENAME)
}

/**
 * 幂等物化产品策略层（dsh 启动前调用）。内容未变则不写盘，避免无谓的
 * mtime 变动（上游 app-boot 对补丁文件有精确监视）。任何失败只记日志，
 * 不阻断启动——层缺席时 dsh 仍能正常启动（只是策略不生效）。
 */
export function ensureProductPolicy(): void {
  const path = productPolicyPath()
  try {
    // 硬性自检：overlay 层必须是合法顶层数组，否则 dsh 组合树解析即崩
    //（0.5.9 教训：无守卫的补丁写入曾把整份文档写成空壳，引擎起不来）
    const parsed: unknown = parseYaml(POLICY_YAML)
    if (!Array.isArray(parsed)) {
      console.error('[product-policy] 层内容不是顶层数组，拒绝写盘')
      return
    }
    let current: string | null = null
    try {
      current = readFileSync(path, 'utf8')
    } catch {
      // 首次物化
    }
    if (current === POLICY_YAML) return
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, POLICY_YAML, 'utf8')
    console.log('[product-policy] 已物化产品策略层:', path)
  } catch (error) {
    console.error('[product-policy] 物化失败:', error)
  }
}

/**
 * `dsh web` 的 overlay 参数；层文件缺席时返回空数组（不传即不生效）。
 *
 * ⚠️ 调用方必须把本结果排在 web-app 选项（--port / --no-open）**之前**：
 * web 子命令启用 passThroughOptions，第一个 app 选项之后的参数全部透传给
 * web app，顺序反了会以 "error: unknown option '--patch'" 退出。
 */
export function productPolicyArgs(): string[] {
  const path = productPolicyPath()
  return existsSync(path) ? ['--patch', path] : []
}
