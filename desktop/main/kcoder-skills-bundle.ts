/**
 * KCoder 自有 dsh bundle 的物化与注册（out-of-tree bundle 随桌面端分发）。
 *
 * 当前七个 bundle（2026-09-01 起全部 dsh 标准命名，开发真源在各自独立仓 →
 * dsh-plugins 镜像 → sync-bundles.mjs 同步进 bundle/）：
 * - dsh-skills-bundle（bundle/dsh-skills-bundle）：方法论技能包（适配自
 *   KSkills 仓库），激活时注册 runtime skill；
 * - dsh-language-bundle（bundle/dsh-language-bundle）：「强制中文回答」
 *   system-prompt section 插件，默认 disabled，由 language-settings.ts
 *   在 home patch 层热切换；
 * - dsh-git-panel（bundle/dsh-git-panel）：独立 git 工作区面板
 *   （server 只读快照 RPC + client 页面内浮动面板）。2026-08 起整体替代
 *   已退役的 Electron 宿主 git-panel.ts（旧 IPC/视图/让位协议已摘除）。
 *   npm 包名 @kkutysllb/dsh-git-panel（无 scope 名被社区第三方占用；
 *   @dsh-external org 被 npm 注册政策拦截，定稿用户名 scope）。
 * - dsh-terminal（bundle/dsh-terminal）：侧边栏嵌入式终端。npm 包名
 *   @kkutysllb/dsh-terminal（同上）。
 * - dsh-file-review-kcoder（bundle/dsh-file-review-kcoder）：改动审查
 *   （完全自立维护，不再以 fork 形态延续；血缘 left0ver/dsh-file-review）。
 *   **包型**产物（保留 pnpm 布局：main=lib/index.js + dsh.bundle.patch
 *   补丁清单 + dsh.client 段），没有 entry.js 四件套里的那个 entry.js
 *   ——物化门按各自的 entry 字段判存在性，漏配会让自动物化永远跳过
 *   （0.5.0 接线教训：手动 cp 掩盖了断链，换机/重建 profile 即缺插件）。
 * - dsh-coding-sidebar（bundle/dsh-coding-sidebar）：侧边栏工作台
 *   自立包产物（fork 自 DSH-better-sidebar 0.17.2，底面板移除；真源
 *   kkutysllb/dsh-coding-sidebar，两级镜像 dsh-plugins → 本 bundle），
 *   第二个**包型**产物。收编线的 npm 上游版本漂移病（0.17.1 坏版启动崩）
 *   随独立发布线（1.0.0 起，版本常量构建期注入）根治——PRESET deps 的
 *   ^1.0.0 只负责牵引依赖树（pnpm install 把 codemirror/ws/node-pty 等
 *   hoist 到 profile 顶层）+ bundles 注册，实体由本模块覆盖为终态；
 *   满足 ^1.0.0 的安装实体不会被 pnpm 回滚，index.ts 在
 *   ensurePresetPlugins（install 可能重建实体）之后二调本模块兑现纠偏。
 *
 * 前身 @kcoder/* 五包 + @kcoder/file-review（2026-08 内置命名）已于
 * 2026-09-01 全部改名自立并发布 npm（1.0.0 起步）；旧名全部列入
 * RETIRED_PLUGINS 自愈三清（旧物化目录与 bundles 层叠残留）。
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

/** bundle 包名（profile bundles 数组与 node_modules 目录名）。 */
export const DSH_SKILLS_BUNDLE = 'dsh-skills-bundle'

/** 语言指令 bundle 包名（开关热切换见 language-settings.ts）。 */
export const DSH_LANGUAGE_BUNDLE = 'dsh-language-bundle'

/** git 工作区面板 bundle 包名（npm 无 scope 名被社区占用；@dsh-external
 * org 被 npm 注册政策拦截，定稿用户名 scope；bundle/ 目录名保持平铺）。 */
export const DSH_GIT_PANEL_BUNDLE = '@kkutysllb/dsh-git-panel'

/** 会话统计图表面板 bundle 包名（独立插件，见 bundle/dsh-stats-panel）。 */
export const DSH_STATS_PANEL_BUNDLE = 'dsh-stats-panel'

/** 嵌入式终端 bundle 包名（scope 定稿理由同 git-panel，见其常量注释）。 */
export const DSH_TERMINAL_BUNDLE = '@kkutysllb/dsh-terminal'

/** 文件/文件夹附件 bundle 包名（scope 定稿理由同 git-panel，见其常量注释；
 * 真源同名独立仓，sync-bundles 经 dsh-plugins 镜像同步产物）。 */
export const DSH_FILE_ATTACH_BUNDLE = '@kkutysllb/dsh-file-attach'

/** 改动审查 bundle 包名（独立自立插件 dsh-file-review-kcoder；真源在同名独立仓，sync-bundles.mjs 同步产物）。 */
export const DSH_FILE_REVIEW_BUNDLE = 'dsh-file-review-kcoder'

/**
 * 侧边栏工作台自立包包名（fork 自 DSH-better-sidebar 0.17.2，独立
 * 发布线；真源 kkutysllb/dsh-coding-sidebar，sync-bundles 经 dsh-plugins
 * 镜像同步产物）。实体以本 bundle 物化为终态；profile deps 里的同名
 * 声明是依赖树牵引，不是残留接线（见 materialize 的 removable 过滤例外）。
 */
export const DSH_CODING_SIDEBAR = 'dsh-coding-sidebar'

/** 上游 web 模板的 bundles 前缀（预写骨架时对齐官方层叠顺序）。 */
const TEMPLATE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

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
  { pkg: DSH_LANGUAGE_BUNDLE, dir: 'dsh-language-bundle', entry: 'entry.js', intactFiles: [] },
  { pkg: DSH_GIT_PANEL_BUNDLE, dir: 'dsh-git-panel', entry: 'entry.js', intactFiles: ['client.js'] },
  { pkg: DSH_STATS_PANEL_BUNDLE, dir: 'dsh-stats-panel', entry: 'entry.js', intactFiles: ['client.js'] },
  { pkg: DSH_TERMINAL_BUNDLE, dir: 'dsh-terminal', entry: 'entry.js', intactFiles: ['client.js'] },
  { pkg: DSH_FILE_ATTACH_BUNDLE, dir: 'dsh-file-attach', entry: 'entry.js', intactFiles: ['client.js'] },
  { pkg: DSH_FILE_REVIEW_BUNDLE, dir: 'dsh-file-review-kcoder', entry: join('lib', 'index.js'), intactFiles: [join('lib', 'client.js')] },
  { pkg: DSH_CODING_SIDEBAR, dir: 'dsh-coding-sidebar', entry: join('lib', 'index.js'), intactFiles: [join('lib', 'client.js')] },
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
 *   dsh-language-bundle / dsh-git-panel / dsh-stats-panel / dsh-terminal /
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
    // scope 父目录按包名动态建（@kcoder/* 与非 scope 的
    // dsh-coding-sidebar 共用此物化路径）
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
  // dsh-coding-sidebar 例外：deps 声明是依赖树牵引（pnpm 图 hoist
  // node-pty/ws/codemirror；见文件头），不是残留接线，不清除
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
  const removable = [...BUNDLES.map((x) => x.pkg), ...RETIRED_PLUGINS]
    .filter((x) => x !== DSH_CODING_SIDEBAR)
  const staleDeps = removable.filter((x) => x in dependencies && !registryNewer(x))
  const staleBundles = RETIRED_PLUGINS.filter((x) => bundlesOf(manifest).includes(x))
  if (staleDeps.length > 0 || staleBundles.length > 0) {
    for (const pkg of staleDeps) delete dependencies[pkg]
    manifest['dependencies'] = dependencies
    if (staleBundles.length > 0) {
      const bundles = bundlesOf(manifest).filter((x) => !RETIRED_PLUGINS.includes(x))
      const dsh = (manifest['dsh'] ?? {}) as { profile?: Record<string, unknown> }
      const profile = (dsh.profile ?? {}) as Record<string, unknown>
      manifest['dsh'] = { ...dsh, profile: { ...profile, bundles } }
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    console.log(
      `[kcoder-bundle] 清除 profile 退役插件残留: deps=[${staleDeps.join(', ')}] bundles=[${staleBundles.join(', ')}]`,
    )
  }
  // 退役插件的 node_modules 目录（曾物化的 @kcoder/* 与曾 pnpm 安装的副本）
  // 直接删除：不在 bundles 层叠里本就不会被加载，删掉是让用户插件的插件
  // 列表里不再出现这些包。
  for (const pkg of RETIRED_PLUGINS) {
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
