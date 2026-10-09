/**
 * KCoder 自有 dsh bundle 的物化与注册（out-of-tree bundle 随桌面端分发）。
 *
 * 当前三个 bundle（权威清单是下方 `BUNDLES` 常量；本节只记形态与历史，
 * dsh-shell-prefs / dsh-ssh-remote 见各自常量的 JSDoc。2026-09-01 起全部
 * dsh 标准命名，开发真源在各自独立仓 → dsh-plugins 镜像 →
 * sync-bundles.mjs 同步进 bundle/）：
 * - dsh-skills-bundle（bundle/dsh-skills-bundle）：方法论技能包（适配自
 *   KSkills 仓库），激活时注册 runtime skill；
 * - ~~dsh-terminal~~（**2026-10-09 退役**，见 RETIRED_PLUGINS）：侧边栏嵌入式
 *   终端（npm 包名 @kkutysllb/dsh-terminal）。退役理由：终端交回上游原生右侧栏
 *   终端 tab（ui-sidebar-terminal 上一步已解除禁用），产品不再自持底部终端面板。
 * - ~~dsh-file-review-kcoder~~（**2026-10-04 退役**，见 RETIRED_PLUGINS）：
 *   改动审查（增强审查卡 hunks/统计/撤销 + 侧边栏审查 tab）。它曾与
 *   coding-sidebar 同期 un-retire（2026-09-19 @1.0.5），本次按产品决策
 *   整线退役——真源仓与 npm 包保留，KCoder 不再内置。**包型**产物形态由
 *   下面的 dsh-ssh-remote 承接：保留 pnpm 布局（main=lib/index.js +
 *   cordis.patch.yml 补丁清单 + dsh.client 段），没有 entry.js 四件套里
 *   的那个 entry.js——物化门按各自的 entry 字段判存在性，漏配会让自动
 *   物化永远跳过（0.5.0 接线教训：手动 cp 掩盖了断链，换机/重建 profile
 *   即缺插件）。
 * - ~~dsh-coding-sidebar~~（**2026-10-09 退役**，见 RETIRED_PLUGINS）：侧边栏
 *   工作台自立包产物（fork 自 DSH-better-sidebar 0.17.2，同属**包型**产物；
 *   真源 kkutysllb/dsh-coding-sidebar，两级镜像 dsh-plugins → 本 bundle）。
 *   它曾是**唯一**一条非 entry.js 四件套之外的物化面，也是 preset-plugins
 *   的**唯一**一条正式声明——退役后「预置第三方插件」这条通道整体空转
 *   （MANAGED_PROFILE_DEPS / needInstall 逻辑保留，只是无条目可管）。
 *   退役理由与产品决策：上游原生右侧栏已覆盖产品所需能力，右侧工作台交回
 *   上游（docs/ARCHITECTURE.md §12 铁律 1，2026-10-09 翻转）。
 *
 * 前身 @kcoder/* 五包 + @kcoder/file-review（2026-08 内置命名）已于
 * 2026-09-01 全部改名自立并发布 npm（1.0.0 起步）；旧名全部列入
 * RETIRED_PLUGINS 自愈三清（旧物化目录与 bundles 层叠残留）。
 * dsh-git-panel 亦于 2026-09-14 退役（能力被侧边栏 Git 面板覆盖，见
 * RETIRED_PLUGINS）。
 *
 * 本模块在 dsh 启动前把各 bundle 幂等物化进 web profile：
 *
 * - 文件：`<bundle 源> → $DSH_HOME/profiles/web/node_modules/<包名>`
 *   （物化让位：随包版本 ≥ 实装版本才落盘——实装是用户从 registry 更新
 *   出的更高版本时保留不降级，见 materialize；pnpm 布局下真实目录同样
 *   可被 Node 父链 resolve）
 * - 注册：profile package.json 的 `dsh.profile.bundles` 数组插入
 *   （紧跟 dsh-web-app 之后）。上游 loadProfile
 *   只在清单不存在时写模板（packages/boot/app-boot profile.ts initProfile），
 *   预写/改写清单不会被模板覆盖；层叠顺序中我们的 patch 行最后应用。
 *
 * 源目录：开发态 `PROJECT_ROOT/bundle/<dir>`；打包态
 * `resources/<dir>`（electron-builder extraResources 物化）。
 *
 * @module desktop/main/kcoder-skills-bundle
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gt, valid } from 'semver'
import { PROJECT_ROOT, WEB_PROFILE, dshHome } from './dsh-contract'
import { parse as parseYaml } from 'yaml'

/** bundle 包名（profile bundles 数组与 node_modules 目录名）。 */
export const DSH_SKILLS_BUNDLE = 'dsh-skills-bundle'

/**
 * 上游偏好桥 bundle 包名（语言/主题对桌面壳的窄接口）。
 *
 * 存在理由：账号菜单是桌面壳注入的自绘 DOM，注入脚本没有 window 级服务桥
 * 可触达上游 locale/theme 服务；此 bundle 的 client 半在 client 插件上下文
 * 注入这两个服务并发布窄接口，使菜单能走上游唯一写入口（详见 bundle 内注释）。
 */
export const DSH_SHELL_PREFS_BUNDLE = 'dsh-shell-prefs'

/**
 * SSH 远程运维/开发套件包名（真源 kkutysllb/dsh-kylin-ssh-tunnel，
 * sync-bundles 经 dsh-plugins 镜像同步运行时面）。
 *
 * 两类职责，都在这一条内置线里：
 * - **工具面**：11 个 `ssh_*` 工具 + 设置页主机管理 + 会话头状态胶囊；
 * - **引导面**（2026-09-26 起，B-β 执行世界）：把「只有密码」的主机升级为
 *   「有公钥 + 有 Node + 有 helper + 有 ssh 别名」的可无人值守主机，并产出
 *   逐主机的 profile overlay。运行期世界由上游 dsh-ssh 家族承担，
 *   那四个 provider **随引擎分发**（`scripts/materialize-peers.mjs` 供给，
 *   2026-09-30 从 profile 依赖迁回）——它们不是插件，故既不进插件管理页的
 *   内置清单，也不再出现在「已安装」里。
 */
export const DSH_SSH_REMOTE_BUNDLE = 'dsh-ssh-remote'

/** 上游 web 模板的 bundles 前缀（预写骨架时对齐官方层叠顺序）。 */
const TEMPLATE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
/**
 * 上游 `app-boot` 的 `OPTIONAL_BUNDLES`（`packages/boot/app-boot/src/profile.ts`，
 * 2026-10-04 对 `0.2.1-alpha.1` 同步）：引擎**安装随附**、默认不选中、由插件
 * 管理页提供开启的组合包。语义见上游文档头——"each a runtime dependency of
 * the installation"。
 *
 * 为什么必须显式列进 `managed`（2026-10-04 修，S4 真机暴露）：它们的实体来自
 * **引擎安装树**，不进 profile 的 `dependencies`。而孤儿判据是「注册在
 * bundles、不在 managed、也不在 dependencies」⇒ 「引擎提供但未写进 profile
 * deps」恰好等于孤儿，每次启动删一遍，用户开启的可选能力（协作团队 / 语音
 * 输入 / 自动评审 / 检查器）静默消失。
 *
 * 与本模块的 `TEMPLATE_BUNDLES` 同一形态：**本地镜像上游名单**。上游本次把
 * `schedule-bundle` 移出该集、新增 `inspector-profile`（见 §F28）。
 */
const UPSTREAM_OPTIONAL_BUNDLES = [
  '@deepseek-ai/dsh-experimental-agent-team-profile',
  '@deepseek-ai/dsh-experimental-voice-input-bundle',
  '@deepseek-ai/dsh-experimental-auto-review',
  '@deepseek-ai/dsh-experimental-inspector-profile',
]

/** 一个内置 bundle 的物化描述。 */
interface BundledPlugin {
  /** 包名（bundles 注册与 node_modules 目录名）。 */
  pkg: string
  /** 源目录名（开发态 bundle/ 下；打包态 resources/ 下同名）。 */
  dir: string
  /** 源存在性判定与物化后完整性检查共用的入口文件（相对包根）。 */
  entry: string
  /** entry 之外参与完整性检查的相对路径。 */
  intactFiles: string[]
}

/** 全部内置 bundle（物化顺序即注册顺序）。 */
const BUNDLES: BundledPlugin[] = [
  { pkg: DSH_SKILLS_BUNDLE, dir: 'dsh-skills-bundle', entry: 'entry.js', intactFiles: [join('skills', 'manifest.json')] },
  { pkg: DSH_SHELL_PREFS_BUNDLE, dir: 'dsh-shell-prefs', entry: 'entry.js', intactFiles: ['client.js'] },
  // dsh-coding-sidebar 曾在此（2026-09-19 un-retire @1.0.18 → **2026-10-09
  // 退役**），条目移入下方 RETIRED_PLUGINS
  // dsh-file-review-kcoder 曾在此（2026-09-19 un-retire @1.0.5 →
  // 2026-10-04 退役），条目移入下方 RETIRED_PLUGINS
  // dsh-ssh-remote（2026-09-26 内置化）：包型产物（main=lib/index.js +
  // cordis.patch.yml 补丁清单 + dsh.client 段），不是 entry.js 四件套——
  // 物化门按各自的 entry 字段判存在性，entry 用 lib/index.js，
  // 客户端交付物在 client/index.js（dsh.client 段声明）。
  // 运行前提：4 个 @deepseek-ai/dsh-*-ssh 随引擎分发（见脚本
  // materialize-peers.mjs 的 PROVIDER_PACKAGES），由安装锚点解析；
  // 早期版本走 profile 依赖，2026-09-30 起改回随包（见 preset-plugins.ts
  // 的 RUNTIME_PROVIDED_PACKAGES：旧 profile 的残留由那里的自愈清掉）。
  { pkg: DSH_SSH_REMOTE_BUNDLE, dir: 'dsh-ssh-remote', entry: join('lib', 'index.js'), intactFiles: [join('client', 'index.js')] },
]

/** 物化 bundle 包名清单（plugins 页内置清单与更新选路共用）。 */
export const MATERIALIZED_BUNDLES: string[] = BUNDLES.map((b) => b.pkg)

/**
 * 退役插件包名：不再内置、不再维护，也不留在用户 profile——曾物化过的
 * 目录自愈移除，目录一并删除，禁止 loader 再加载任何副本。
 *
 * - @kcoder/flowglass：旧收编物化目录；上游 npm 包 dsh-flowglass
 *   不封禁：2026-08-30 曾因上游只发产物无源码、host/client 双侧 inject
 *   声明缺失（alpha.1 严格解析下无法安全补丁维护）决定不内置，但当时误
 *   把它列入本清单把「用户按需安装」路径也一并封死；上游已迭代到 0.4.x
 *   （声明面已补齐 peer），2026-08-31 起放开——不预置、不禁装。
 * - @kcoder/skills-bundle、@kcoder/language-bundle、@kcoder/git-panel、
 *   @kcoder/stats-panel、@kcoder/terminal、@kcoder/file-review
 *   （2026-09-01）：全部改名自立并发布 npm（dsh-skills-bundle /
 *   dsh-git-panel / dsh-terminal /
 *   dsh-file-review-kcoder，1.0.0 起步），旧名物化目录与 bundles 层叠
 *   残留自愈三清（file-review 曾被钉 deps "0.4.1" 一并摘除）。
 */
const RETIRED_PLUGINS = [
  '@kcoder/flowglass',
  '@kcoder/skills-bundle',
  '@kcoder/language-bundle',
  '@kcoder/git-panel',
  '@kcoder/stats-panel',
  '@kcoder/terminal',
  '@kcoder/file-review',
  // 2026-09-01 改名中间态×3：dsh-git-panel/dsh-terminal 曾以无 scope 名
  // 短暂物化/注册（npm 与社区第三方同名 E403）；改 @dsh-external scope 后
  // org 名又被 npm 注册政策拦截，定稿 @kkutysllb——两轮中间态全部退役，
  // 残留自愈清理（scope 形态的空壳清理逻辑同样生效）
  'dsh-git-panel',
  'dsh-terminal',
  '@dsh-external/dsh-git-panel',
  '@dsh-external/dsh-terminal',
  // @kkutysllb/dsh-terminal（**2026-10-09 退役**）：上列三条是改名中间态，本条是
  // **现行名**。退役理由：终端交回上游原生右侧栏终端 tab（第一步已解除
  // ui-sidebar-terminal 禁用），产品不再自持底部终端面板；连带 node-pty /
  // @xterm/* 宿主依赖、自绘标题栏终端按钮、菜单「切换内嵌终端」与 panel-buttons
  // 让位模块一并拆除。真源仓 kkutysllb/dsh-terminal 与 npm 包保留（用户仍可经
  // 插件管理页自装，但按产品级退役口径，下次启动三清会再洗）。
  '@kkutysllb/dsh-terminal',
  // 2026-09-11 退役：dsh-language-bundle（强制中文回答指令包）——产品
  // 决策移除该能力；配套的「回答语言」通用设置行/patch 托管块/契约
  // 类型一并退役，用户 profile 残留的托管块由启动自愈剥离（见
  // stripRetiredLanguagePatch，块引用已退役插件会导致引擎解析失败）
  'dsh-language-bundle',
  // 2026-09-11 退役：当前基线（0.1.5-rc.2）composer dock 已原生挂载
  // StatsPills 会话统计（gauge/database 双 pill：轮次/步数+输出速度、
  // 总 token+缓存命中，点击开时间速度与 token 用量对话框，projection
  // 一等数据源），内置 dsh-stats-panel 的 DOM 文本解析方案被原生完整
  // 覆盖，整线退役三清（旧物化目录与 bundles 层叠残留自愈移除）
  'dsh-stats-panel',
  // 2026-09-05 退役：当前基线（0.1.3-alpha.1）composer 已原生集成附件
  // 上传入口（引擎 web-app bundle 注册的 ui-attachment + file-upload
  // 链路），内置 dsh-file-attach 能力被原生覆盖，整线退役三清。退役
  // 同时即修复：该插件 0.5.1 起漏配随包资源映射（安装包无实体），引用
  // 它的 profile 引擎启动解析失败即崩，本清单自愈摘除层叠注册后不再
  // 触达 resolve
  '@kkutysllb/dsh-file-attach',
  // 2026-09-14 退役：侧边栏 dsh-coding-sidebar 的 Git 面板已完整覆盖
  // 变更/暂存/提交/分支/worktree/历史操作（Git/会话双视角），内置
  // dsh-git-panel 能力被覆盖，整线退役三清；推送/GitHub 管理（gh
  // PR/Issue）/比较外链/任务计划由侧边栏后续版本承接
  '@kkutysllb/dsh-git-panel',
  // 2026-09-19 决策修订：dsh-file-review-kcoder / dsh-coding-sidebar
  // 已 un-retire（@1.0.5 / 1.0.19，alpha.2 适配在各自真源仓完成，见
  // 升级文档 §9.9），从本清单移除。
  //
  // 2026-10-04 再退役（产品决策）：dsh-file-review-kcoder 整线退役——增强
  // 审查卡（hunks/统计/撤销）与侧边栏审查 tab 一并下线。它是
  // dsh-coding-sidebar 的**衍生插件**（peer 硬声明 `dsh-coding-sidebar
  // >=0.12.0`，故 web boot 里它 pending 等 betterSidebar），而**依赖方向
  // 单向**：侧栏不反向依赖它，源码里只有结构性探测（`hasFileReviewData`，
  // 缺数据即让位），因此退役**不动侧栏一个字节**。真源仓
  // kkutysllb/dsh-file-review-kcoder 与 npm 包保留，用户仍可经插件管理页
  // 自装——但按「产品级不再提供」口径（同 dsh-context），下次启动的三清
  // 会再洗一遍。
  //
  // 本次为**双账本 + 四名单**退役，缺一处即互搏或残留（教训见下）：
  // ① 本清单（物化实体 + bundles 层叠项）；② preset-plugins 的
  // RETIRED_PRESETS（deps 声明 + 三清）；③ product-policy 的
  // ui-deliverables.tailCard 由 false 改回 true（本插件曾同时认领 produced
  // 与 presented 两张脸，原生卡不恢复则带 changes 公告的回合行与 present
  // 交付卡一起消失）；④ sync-bundles 映射 + electron-builder
  // extraResources 登记（漏摘则下次 sync 把产物拉回来 / 打包版多带死重量）；
  // ⑤ remote-server 的 PROFILE_BUNDLES 与 remote-connections 的
  // REMOTE_BUNDLES（漏摘则远端世界的安装名单指向已删目录）。
  'dsh-file-review-kcoder',
  //
  // dsh-coding-sidebar（**2026-10-09 退役**）：产品负责人拍板——上游新版
  // 的原生右侧栏（`ui-sidebar-right` + files / documentpreview / terminal /
  // browser tab）已覆盖产品所需能力，KCoder 不再自持右侧工作台，**正式翻转
  // 「产品铁律 1」**（docs/ARCHITECTURE.md §12；2026-09-19 定，2026-10-09
  // 翻转，理由与日期见该节）。本次退役面比前例 dsh-file-review-kcoder 宽：
  // 除双账本 + 四名单外，宿主侧铁律执行族同批拆除（style-overlay 的
  // NATIVE_SIDEBAR_CSS 压制、sidebar-toggle 的第三轨归零、sidebar-cluster
  // 代理、panel-buttons 的让位项、product-policy 的原生终端 tab 禁用行）。
  // 真源仓 kkutysllb/dsh-coding-sidebar 与 npm 包保留（它同时是 QiLin 的
  // 第一方内置工作台，退役只发生在 KCoder 消费侧）；用户仍可经插件管理页
  // 自装，但按「产品级不再提供」口径（同 file-review/dsh-context），下次
  // 启动的三清会再洗一遍。
  'dsh-coding-sidebar',
  //
  // ⚠️ 教训（2026-09-19 dev 现场实证）：un-retire 恢复 BUNDLES/PRESET/
  // 映射时**必须同步移除本清单的同名条目**——清单成员会被启动清理当
  // 退役货反复洗掉（摘 bundles 层叠 + 删 node_modules），与注册面互搏，
  // 多轮交错后层叠缺项；现场表现为 coding-sidebar 被洗出层叠 → 引擎不
  // 加载 → file-review 等 betterSidebar 服务永远 pending。反向（退役）同理：
  // ⑤处名单漏摘不会当场报错，只在下一次同步或远端连接时暴露。
]

/** 分发的 bundle 源目录（开发态仓库内；打包态 extraResources）。 */
export function bundleSource(dir: string): string {
  const packaged = join(process.resourcesPath ?? PROJECT_ROOT, dir)
  if (existsSync(packaged)) return packaged
  return join(PROJECT_ROOT, 'bundle', dir)
}

/** 读取 JSON；失败返回 null（调用方决定重建）。 */
function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** profile package.json 的 dsh.profile.bundles（缺失段视为空数组）。 */
function bundlesOf(manifest: Record<string, unknown>): string[] {
  const dsh = manifest['dsh'] as { profile?: { bundles?: unknown } } | undefined
  const list = dsh?.profile?.bundles
  return Array.isArray(list) ? (list as string[]) : []
}

/**
 * 幂等物化 + 注册全部内置 bundle（dsh 启动前调用）。任何失败只记
 * 日志不抛——bundle 缺席时 dsh 仍可正常启动，桌面端功能不受影响。
 */
export function ensureKcoderBundles(): void {
  const profileDir = join(dshHome(), 'profiles', WEB_PROFILE)
  for (const b of BUNDLES) {
    try {
      materialize(profileDir, b)
    } catch (error) {
      console.error(`[kcoder-bundle] ${b.pkg} 物化失败:`, error)
    }
  }
}

/** 单个 bundle 的物化与 bundles 注册（失败由调用方捕获）。 */
function materialize(profileDir: string, b: BundledPlugin): void {
  const source = bundleSource(b.dir)
  if (!existsSync(join(source, b.entry))) {
    console.warn(`[kcoder-bundle] ${b.pkg} 源缺失，跳过物化:`, source)
    return
  }
  const target = join(profileDir, 'node_modules', b.pkg)

  // 1) 文件物化：入口齐全且实装不落后于随包版本时跳过。物化让位
  //    （2026-09-02）：实装已是更高的 registry 版本（用户经插件管理页 /
  //    `dsh plugin add` 更新过）时保留本机副本——旧规则「版本不一致即
  //    覆盖」会把用户装上的新版在下一次启动打回随包旧版，内置插件等于
  //    永远无法更新；随包版本更高（应用发版携带新版）仍照常覆盖升级，
  //    实体缺失/损坏（intact 门）与版本不可读照常重建
  const srcVersion = (readJson(join(source, 'package.json'))?.['version'] as string) ?? ''
  const dstVersion = (readJson(join(target, 'package.json'))?.['version'] as string) ?? ''
  const intact = existsSync(join(target, b.entry))
    && b.intactFiles.every((f) => existsSync(join(target, f)))
  const staleTarget = !intact
    || valid(dstVersion) === null
    || (valid(srcVersion) !== null && gt(srcVersion, dstVersion))
  if (staleTarget) {
    // scope 父目录按包名动态建（@kcoder/* 与非 scope 包共用此物化路径）
    const scope = b.pkg.startsWith('@') ? b.pkg.split('/')[0] : ''
    if (scope !== '') mkdirSync(join(profileDir, 'node_modules', scope), { recursive: true })
    rmSync(target, { recursive: true, force: true })
    cpSync(source, target, { recursive: true })
    console.log(`[kcoder-bundle] 物化 ${b.pkg} ${srcVersion}: ${target}`)
  }

  // 2) bundles 注册：清单不存在则预写骨架（上游模板只在缺失时初始化，
  //    不会覆盖）；存在则插入（已注册时保持用户可能调整过的位置）
  const manifestPath = join(profileDir, 'package.json')
  let manifest = readJson(manifestPath)
  if (manifest === null) {
    manifest = {
      name: `dsh-profile-${WEB_PROFILE}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...TEMPLATE_BUNDLES, ...BUNDLES.map((x) => x.pkg)] } },
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    console.log('[kcoder-bundle] 预写 profile 清单并注册 bundles')
    return
  }
  // @kcoder/* 全部是物化直写目录，不经 registry/pnpm 安装（上游 plugin.ts 亦
  // 明确 bundles 不进 dependencies）。dependencies 里若有历史接线或已退役
  // 插件的残留声明（file-review 曾被钉 "0.4.1"），pnpm 在 profile 跑
  // install/update 时要么去 registry 拉 404 挡死全部更新，要么与内置副本
  // 双跑。注册 bundles 时顺手拔除；退役插件的 bundles 层叠项与物化/安装
  // 目录一并移除，只留内置 bundle 这一条加载面。
  const dependencies = (manifest['dependencies'] ?? {}) as Record<string, unknown>
  // 牵引包白名单（2026-10-04 S4 修 → **2026-10-09 随 dsh-coding-sidebar 整线
  // 退役撤销**）：当时唯一成员就是它——它的 deps 声明是依赖树牵引（pnpm 图
  // hoist node-pty/ws/codemirror；见文件头），不是残留接线，故无条件保留。
  // 退役后该声明回归普通退役处理（下方 staleDeps 摘除 + preset 三清），白名单
  // 随之删除。**判据与教训留档**（后续再出现同类内置包时按此恢复）：白名单成员
  // 的判据不看版本——此处曾借下面的 registryNewer(live > shipped) 兼作例外，是
  // 错的口径（那是「实体已被 registry 顶替」的判据，与牵引无关）：S2.2 把随包
  // 版本对齐后判据翻 false ⇒ 声明被误摘（dev 真机现场
  // `deps=[dsh-coding-sidebar]`），随后任何 pnpm install 都会把实体当 extraneous
  // 剪掉（2026-10-03/10-04 事故同形，见 dsh-manager 注释）。
  // registry 顶替例外（2026-09-02）：实体已被用户更新出的更高 registry
  // 版本顶替的 bundle，其 deps 声明保留——实体已归 pnpm 图管，摘声明会
  // 造成图与磁盘漂移，后续 pnpm install 可能把实体当 extraneous 清掉
  // （终端/面板类内置件缺实体即崩）。仍 ≤ 随包版本的（本模块自管实体）
  // 照旧摘除
  const registryNewer = (pkg: string): boolean => {
    const b = BUNDLES.find((x) => x.pkg === pkg)
    if (b === undefined) return false
    const shipped = (readJson(join(bundleSource(b.dir), 'package.json'))?.['version'] as string) ?? ''
    const live = (readJson(join(profileDir, 'node_modules', pkg, 'package.json'))?.['version'] as string) ?? ''
    return valid(live) !== null && valid(shipped) !== null && gt(live, shipped)
  }
  // 退役 / 孤儿的 bundles 层叠项（本函数内两处消费：清单摘除与实体目录
  // 清理，故在补丁剥离前一次算清）。
  //
  // 孤儿判据（2026-09-18 现场）：bundles 里注册、却既不在内置清单、也不
  // 在退役清单、更不在 dependencies 的条目。pnpm 安装半途失败时会产生这
  // 种态（bundle 声明入栈、实体未落地），而上游 reconcile 只遍历
  // dependencies、退役清理只认名单，两条路都够不着——孤儿声明永远存活，
  // 且启动时 resolveBundleDir 解析不到实体会挡死整个 profile。
  //
  // 用「dependencies 声明」而非包名通配作判据：上游 0.1.6 的 contained-
  // group 隔离下，bundles 层叠项的实体有**三个**合法来源——pnpm（dsh plugin
  // add 落 dependencies）、KCoder 物化直写（在 BUNDLES 清单里）、或**引擎安装
  // 随附**（上游 OPTIONAL_BUNDLES，见 UPSTREAM_OPTIONAL_BUNDLES）。三者都无
  // 归属的层叠项，加载器必然解析失败，摘除只可能是修复。模板层
  // （@deepseek-ai/dsh-base / dsh-web-app）、退役名单与上游可选集各自单列，
  // 均不参与孤儿的「无来源」判定。
  const managed = new Set([
    ...TEMPLATE_BUNDLES,
    ...BUNDLES.map((x) => x.pkg),
    ...RETIRED_PLUGINS,
    ...UPSTREAM_OPTIONAL_BUNDLES,
  ])
  const orphanBundles = bundlesOf(manifest).filter(
    (x) => !managed.has(x) && !(x in dependencies),
  )
  const staleBundles = [...new Set([...RETIRED_PLUGINS, ...orphanBundles])]
    .filter((x) => bundlesOf(manifest).includes(x))
  // dsh-language-bundle 退役（2026-09-11）：剥离用户 profile home patch
  // 层的 kcoder-language 托管块——块内容 disabled:false 引用已退役插件,
  // 不剥离则引擎启动解析失败（file-attach 同款教训）。幂等:无块即空转
  try {
    const patchPath = join(dshHome(), 'cordis.patch.yml')
    if (existsSync(patchPath)) {
      const text = readFileSync(patchPath, 'utf8')
      const begin = text.indexOf('# ---- kcoder-language BEGIN')
      if (begin !== -1) {
        const endMark = '# ---- kcoder-language END ----'
        const end = text.indexOf(endMark, begin)
        const stripped = (end === -1 ? text.slice(0, begin) : text.slice(0, begin) + text.slice(end + endMark.length))
        // 硬性自检:剥离结果必须是合法顶层数组,否则拒绝写盘保留原文件
        // （0.5.9 现场教训:无守卫的剥离曾把整份补丁写成空文档,引擎启动即崩）
        const parsed = parseYaml(stripped === '' || !stripped.endsWith('\n') ? stripped + '\n' : stripped)
        if (!Array.isArray(parsed)) {
          console.error('[kcoder-bundle] 语言 patch 块剥离结果非顶层数组,放弃写盘保留原文件')
          return
        }
        writeFileSync(patchPath, stripped.endsWith('\n') || stripped === '' ? stripped : stripped + '\n', 'utf8')
        console.log('[kcoder-bundle] 已剥离退役语言插件的 patch 托管块')
      }
    }
  } catch (error) {
    console.error('[kcoder-bundle] 语言 patch 块剥离失败:', error)
  }

  const removable = [...BUNDLES.map((x) => x.pkg), ...RETIRED_PLUGINS]
  const staleDeps = removable.filter((x) => x in dependencies && !registryNewer(x))
  if (staleDeps.length > 0 || staleBundles.length > 0) {
    for (const pkg of staleDeps) delete dependencies[pkg]
    manifest['dependencies'] = dependencies
    if (staleBundles.length > 0) {
      const bundles = bundlesOf(manifest).filter((x) => !staleBundles.includes(x))
      const dsh = (manifest['dsh'] ?? {}) as { profile?: Record<string, unknown> }
      const profile = (dsh.profile ?? {}) as Record<string, unknown>
      manifest['dsh'] = { ...dsh, profile: { ...profile, bundles } }
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    console.log(
      `[kcoder-bundle] 清除 profile 退役/孤儿插件残留: deps=[${staleDeps.join(', ')}] bundles=[${staleBundles.join(', ')}]`
      + (orphanBundles.length > 0 ? `（孤儿=${orphanBundles.join(', ')}）` : ''),
    )
  }
  // 退役 / 孤儿插件的 node_modules 目录（曾物化的 @kcoder/* 与曾 pnpm 安装
  // 的副本）直接删除：不在 bundles 层叠里本就不会被加载，删掉是让用户插件
  // 的插件列表里不再出现这些包。走 staleBundles 而非 RETIRED_PLUGINS——孤儿
  // 条目（注册了却无 dependencies 声明）的实体同样是死重量：解析必然失败，
  // 留着只会让“插件列表出现装不上的条目 + 每次启动重试解析”。
  for (const pkg of staleBundles) {
    rmSync(join(profileDir, 'node_modules', pkg), { recursive: true, force: true })
  }
  const bundles = bundlesOf(manifest)
  if (bundles.includes(b.pkg)) return
  const anchor = bundles.indexOf(TEMPLATE_BUNDLES[1])
  bundles.splice(anchor === -1 ? bundles.length : anchor + 1, 0, b.pkg)
  const dsh = (manifest['dsh'] ?? {}) as { profile?: Record<string, unknown> }
  const profile = (dsh.profile ?? {}) as Record<string, unknown>
  manifest['dsh'] = { ...dsh, profile: { ...profile, bundles } }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  console.log(`[kcoder-bundle] 已注册 ${b.pkg} 进 profile bundles 层叠`)
}
