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
# 原生 changed-files 尾卡关闭（2026-09-19，fork d3cc056ee6 的 tailCard
# 配置闸门）：file-review 增强卡（hunks/统计/撤销 + 产物与交付两段）
# 已按三层互让接管该行（changes 公告 turn 由其渲染）；list 语义下原生
# 条目无法被抢占，不关则同一 turn 双行。deliverables 数据定义与其余
# 注册全部保留（下游探测的输入源）。
- id: ui-deliverables
  config:
    tailCard: false
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
