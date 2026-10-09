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
 * 产品策略层内容（逐条决策）：
 * - **会话日志不上传**（D2，2026-09-15）：上游 0.1.6-alpha.1 起
 *   `session-log-deepseek.Config.enabled` 默认 true——每次 DeepSeek 请求会把
 *   完整未接受的会话日志后缀（消息正文、工具参数与结果、工作区路径、反馈）
 *   上报到所连端点/网关。KCoder 不参与该贡献。
 * - ~~**原生右侧栏终端 tab 禁用**~~（2026-09-15 加 → 2026-09-18 恢复 →
 *   **2026-10-09 撤销**）：原意是防「插件终端 + 原生终端」双入口。插件
 *   `dsh-coding-sidebar` 整线退役、右侧工作台交回上游原生后，产品负责人拍板
 *   把终端 tab 一并交回上游（铁律 1 翻转，见 docs/ARCHITECTURE.md §12），
 *   本层不再持有 `ui-sidebar-terminal` 行。⚠ 宿主 api-terminal-controller
 *   **始终不可禁用**（packages/api/remotes 静态 import 并 $mount 它的 remote，
 *   禁用会让 api-remotes 挂载失败 → 主对话链全挂）；本层当年只关 UI 面。
 * - **内置浏览器按「桌面壳 = Electron」放开**（2026-09-22，上游 0.1.7-alpha.1
 *   起 ui-sidebar-browser 的默认值按 profile 名判定：`profileContext?.name
 *   !== 'desktop'` 即禁用。KCoder 桌面壳跑的是 `web` profile，故上游默认把
 *   内置浏览器关掉——与「Web 默认关 / Electron 默认开」的上游产品语义相悖。
 *   KCoder 只有 Electron 一种宿主，故显式放开该行；聊天链接的打开位置仍由
 *   chat 设置 `linkOpening` 决定（默认 sidebar = 内置浏览器 tab）。
 * - **定时任务与时间上下文改由可选 bundle 提供**（2026-09-29，上游 0.2.0-rc.1）：
 *   上游把 `time-context` / `schedule` / `ui-schedule` 三行**从 web-app 组合
 *   整段迁出**，改由可选包 `@deepseek-ai/dsh-experimental-schedule-bundle` 的
 *   `cordis.patch.yml` 以 `- insert:` 插入（该包已登记进 app-boot 的
 *   `OPTIONAL_BUNDLES`）。因此**不能再对本层做 id 定向覆写**——补丁语义是
 *   「id 不存在 → warn 后跳过」，旧的 `- id: schedule / disabled: false`
 *   三行会静默失效（不报错、功能直接消失，0.2.0 升级现场）。启用路径改为在
 *   profile 的 `dsh.profile.bundles` 中选中该 bundle（见 preset-plugins.ts），
 *   策略层不再持有这三行。
 *   **2026-10-04 更新（dsh 0.2.1-alpha.1）**：上游把 `schedule` /
 *   `ui-schedule` / `time-context` **内置进了 `dsh-web-app` 组合**，并整包删除
 *   了那个可选 bundle（连目录一并删除；新增 `schedule/tool-schedule`）。
 *   ⇒ 结论不变且更强：策略层**继续不持有这三行**（内置行随 web-app 层自动
 *   在位，另有上游新增的 `RETIRED_BUNDLES` 机制持续摘除旧的组合包名），
 *   也不需要任何「选回可选包」的动作。启用路径一栏随之作废，
 *   见 preset-plugins.ts 的同段历史记录。
 * - **会话日志开关隐藏**（2026-09-29，D2.1）：0.2.0-rc.1 新增客户端包
 *   `ui-settings-session-log`，在「设置 → 通用」放了一个上传 Session Log 的
 *   开关（`session-log-deepseek.enabled` 改为 Volatile、逐请求读取）。但本层是
 *   CLI overlay，按上文层级序排在 profile 之后并**整份替换 config** ⇒ 用户写进
 *   profile 的 `enabled` 永远被本层的 `enabled: false` 盖掉：开关「写入成功」
 *   却不生效，UI 还可能显示已开而运行时是关。既然决定强制关闭，就把该开关行
 *   一并 disabled，不给用户留下点了没用的控件。
 * - **桌面遥测显式关闭**（2026-09-29，D3）：0.2.0-rc.1 的 web-app 组合新增
 *   `desktop-product-telemetry` 与 `product-analytics` 两行，以
 *   `profileContext?.name !== 'desktop'` 为闸。KCoder 桌面壳的 profile 名是
 *   `web`，当下确实不会启用——但那是「靠名字巧合」的隔离：上游改默认值或我方
 *   改用 desktop profile 名都会让它静默开启。此处显式禁用钉死。
 *
 * 历史行（已移除）：`file-review-tab` 禁用（2026-09-18）——file-review
 * 插件当时整体退役（typert 产物过不了 alpha.2 typert-loader 校验，曾拖垮全部
 * 远端定义注册，见 docs/upstream-0.1.6-alpha.2-analysis.md §9），行随插件
 * 退役失去意义。该插件 2026-09-19 曾 un-retire 回来，2026-10-04 再由产品决策
 * 整线退役（见 kcoder-skills-bundle 的 RETIRED_PLUGINS）；此后本文件不再需要
 * 它的任何行。
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
