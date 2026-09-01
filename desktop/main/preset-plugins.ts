/**
 * 预置第三方插件（dsh-context / dsh-coding-sidebar /
 * drag-to-attachment）的开箱物化。
 *
 * 这两个插件是 KCoder 发行物的一部分：Windows 全新安装后 profile 是
 * 上游空模板（只有 dsh-base / dsh-web-app 内置层），第三方插件不会自动
 * 出现（mac 开发机上它们存在于用户 profile，属用户数据不随包分发）。
 * 本模块在 dsh 启动前幂等物化：
 *
 * - profile 清单（package.json）不存在时预写完整骨架（对齐上游
 *   initProfile 模板：package.json + pnpm-workspace.yaml + cordis.patch.yml；
 *   上游只在清单缺失时写模板，预写不会被覆盖）
 * - dependencies 补写缺失条目（可先行——dsh 只消费 bundles 层叠，不查
 *   dependencies）
 * - 安装经 dsh-contract.runPnpm（vendor 实体优先，普通用户机器无 pnpm）
 *
 * 原子性（v0.1.7 Windows 引擎起不来的教训）：dsh 启动对
 * dsh.profile.bundles 逐项 resolveBundleDir，声明了而 node_modules 缺包
 * 即崩溃。因此 bundles 声明严格跟随安装实态对账——装上才补声明，
 * 装不上摘除幽灵声明（含旧版写入的坏状态自愈），dsh 裸起（无预置
 * 插件但不崩），下次启动幂等重试。
 *
 * 版本策略：预置 spec 锁定开箱已验证 patch 兼容的版本线（^ 对 0.x 仅
 * patch 级跟随，minor 升级不自动跟进）；用户主动“更新”经插件管理
 * update --latest 升线。破坏性敏感的包装层插件用锁定形态（如
 * drag-to-attachment 的 github tag）。
 *
 * 预置冻结（2026-08-30）：第三方插件不再新增预置——用户按需经插件
 * 管理页自装（github 源一键安装）。现有两个维持现状（含缺陷补丁与
 * 版本锁）；退役走 RETIRED_PRESETS 三清自愈（见 dsh-vision-router、
 * dsh-better-sidebar、@tt-a1i/archify-dsh）。
 *
 * dsh-coding-sidebar（2026-08-20 以 dsh-better-sidebar 预置，2026-09-01
 *   切换自立包）：侧边栏工作台底座（文件树/CM6 编辑器/图片·MD 预览/
 *   终端/Git/子代理，服务化扩展点）。fork 自 DSH-better-sidebar 0.17.2
 *   的独立发布线（1.0.0 起，底面板源码级移除，版本常量构建期注入），
 *   收编线的上游版本漂移病（0.17.1 settingsNamespace 坏版启动崩）随之
 *   终结；实体由 bundle/dsh-coding-sidebar 物化覆盖为终态（见
 *   kcoder-skills-bundle.ts）——本清单的 ^1.0.0 仅牵引依赖树
 *   （codemirror/ws/node-pty 等 hoist 到 profile 顶层）；两项额外物化：
 * - pnpm 构建脚本门：白名单（onlyBuiltDependencies: [node-pty,
 *   dsh-better-sidebar]）路线已证伪，现由 dangerouslyAllowAllBuilds
 *   放行（见 ensurePnpmBuildsAllowed）；
 * - $DSH_HOME/settings.yaml 补写 dsh-coding-sidebar.titleBarCompat:
 *   true + titleBarStripPx——面板顶部让位 KCoder 自绘状态栏（键名
 *   跟随新包 SIDEBAR_PREFS_NS；插件自动探测只认 win32 advanced 标题栏，
 *   mac 需手动开；实测 2026-08-20）。开关簇不下移：由 sidebar-cluster.ts
 *   注入器隐藏并在状态栏代理接管（代理一枚 right 12 + 自研终端 44 +
 *   上下文 76；旧收编线底面板已在 fork 源码级移除，热补丁/挤压垫片
 *   随终端回归自研而拆除）。
 *
 * @tt-a1i/archify-dsh（2026-08-20 预置 → 2026-09-01 退役）：架构图
 * agent skill——把代码库/系统描述变成自包含交互 HTML 技术图（架构/
 * 工作流/时序/数据流/生命周期五型）。退役理由：架构图能力已由自有
 * 插件 dsh-super-ppts 覆盖，后续 dsh-animation 插件同样具备该能力，
 * 第三方重复能力不再预置（按需可经插件管理页自装，纯技能包装零
 * 迁移）。
 *
 * @dsh-external/dsh-drag-to-attachment（2026-08-20 预置）：附件上传
 * 宿主插件——输入框 📎 按钮由它注入 conversation.input.left 槽位，
 * attach-picker.ts 把其模式切换按钮改造成原生文件选择入口（点击开
 * 对话框→合成 drop→fast path 入队）。原为用户态安装：2026-08-20
 * 用户数据目录统一 ~/.dsh 后 profile 全新物化，用户态安装不随迁，
 * 附件按钮作为输入框产品功能随之消失（实测）——收归预置根治。
 * GitHub 源无 semver，锁 tag v1.0.3（与 profile-patches.ts 的
 * rc.8 return 补丁三层链精确对齐）；升级走显式改预置。无额外物化
 * 项（补丁链由 ensureProfilePatches 按需自愈）。
 *
 * dsh-vision-router（2026-08-30 退役）：预置清单摘除并自愈清理。
 * 工具式识图与多模态主模型的原生视觉能力抢调用——模型优先走插件
 * 识图工具，效果反而一般；多模态已成主流，原生能力优先，退役不再
 * 预置（历史锁定 2.0.1 keyed slot 契约适配版）。
 *
 * @module desktop/main/preset-plugins
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEB_PROFILE, dshHome, runPnpm } from './dsh-contract'
import { ensureProfilePatches, healLog } from './profile-patches'
import { SHELL_TITLEBAR_HEIGHT } from './theme-watcher'

/**
 * 预置插件：bundle 名 → 依赖 spec（键顺序即层叠顺序，对齐 mac 开发机）。
 * spec 变化由 ensurePresetPlugins 的漂移对账推送到已装 profile（只升
 * 不降）；semver 下界可提取的 spec（含 github tag 形态 github:…#v1.0.3）
 * 参与对账，link: 等无版本形态不参与。
 */
export const PRESET_PLUGINS: Record<string, string> = {
  // 0.38.5 起 index.js 不再 import settingsNamespace（alpha.2 的
  // dsh-settings 已移除该导出）——0.37.x 与 alpha.2 引擎组合启动即
  // SyntaxError 全局崩（0.4.9 Windows 升级现场实证）
  'dsh-context': '^0.38.5',
  // 自立 npm 包（fork 自 DSH-better-sidebar 0.17.2，发版节奏自控），
  // 本声明仅牵引依赖树（codemirror/ws/node-pty 等 hoist 到 profile
  // 顶层）+ bundles 注册；实体终态由 bundle/dsh-coding-sidebar
  // 物化覆盖——满足本 spec 的安装实体不会被 pnpm 回滚，index.ts 在
  // preset install 后二调 ensureKcoderBundles 兑现纠偏
  'dsh-coding-sidebar': '^1.0.0',
  '@dsh-external/dsh-drag-to-attachment': 'github:djt889/dsh-drag-to-attachment#v1.0.3',
}

/**
 * 退役预置插件：不再预置，也不留在用户 profile——dependencies 声明、
 * bundles 层叠声明与 node_modules 实体三处自愈移除（见
 * ensurePresetPlugins 的退役清理步骤；摘 deps + 删实体后由 pnpm
 * install 重放按新依赖图收敛，图与磁盘一致不漂移——不走
 * kcoder-skills-bundle RETIRED_PLUGINS 的纯 rm 路径，那会让 pnpm 图
 * 与磁盘漂移，后续 install 报错）。
 *
 * - dsh-vision-router（2026-08-30）：原生视觉优先，识图插件退役。
 * - dsh-better-sidebar（2026-09-01）：消费源切换自立包
 *   dsh-coding-sidebar（见 PRESET_PLUGINS），旧收编线整线退役——
 *   含历史 git+ssh 子目录引用形态的 deps 声明（值形态不限，摘键即
 *   清）。退役后衍生插件重装时其 peer `dsh-better-sidebar@^0.6.0`
 *   会从 npm 拉上游真包实体：该实体不进 bundles 层叠不会被加载
 *   （无双跑），仅作 peer 满足与类型来源。
 * - @tt-a1i/archify-dsh（2026-09-01）：架构图能力由自有插件
 *   dsh-super-ppts 覆盖（后续 dsh-animation 亦具备），第三方重复
 *   能力不再预置；纯技能包装，摘键即清无迁移。
 */
const RETIRED_PRESETS = ['dsh-vision-router', 'dsh-better-sidebar', '@tt-a1i/archify-dsh']

/** 上游 web 模板的 bundles 前缀（预写骨架时对齐官方层叠顺序）。 */
const TEMPLATE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** 对齐上游 initProfile 的 pnpm-workspace.yaml（nodeLinker 锚点依赖它）。 */
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/** 对齐上游 initProfile 的 cordis.patch.yml（空用户补丁层）。 */
const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

/** 读取 JSON；失败返回 null（调用方决定重建）。 */
function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * 幂等放开 pnpm 构建脚本门（dangerouslyAllowAllBuilds: true）。
 * 白名单逐包收编路线已证伪：pnpm 11 对 git 源要求带 commit hash
 * 的完整 id key，插件每次更新换 hash 即失效，且插件生态随时带进新
 * 构建型依赖（esbuild/protobufjs/ssh2/cpu-features 四连撞门，
 * 2026-08-25 实证穷举不彻底）；pnpm 失败时还会在 yaml 留
 * "set this to true or false" 占位键污染现场。放行一切构建脚本
 * 等同 npm/yarn 十几年的默认行为（pnpm 10 才收紧），信任边界前移到
 * 插件市场点安装那一刻的用户决策。已放行则不动；键在但非 true
 * （用户/上游显式收紧）尊重不覆盖。须在 pnpm install 前就位，
 * 否则首装后需重装才生效。
 */
function ensurePnpmBuildsAllowed(workspacePath: string): void {
  try {
    if (!existsSync(workspacePath)) return
    let yaml = readFileSync(workspacePath, 'utf8')
    if (!yaml.endsWith('\n')) yaml += '\n'
    if (/^dangerouslyAllowAllBuilds:[ \t]*true[ \t]*(?:#.*)?$/m.test(yaml)) return
    if (/^dangerouslyAllowAllBuilds:/m.test(yaml)) {
      healLog('[preset] dangerouslyAllowAllBuilds 非 true（显式收紧），尊重不覆盖')
      return
    }
    yaml += 'dangerouslyAllowAllBuilds: true\n'
    writeFileSync(workspacePath, yaml)
    console.log('[preset-plugins] 已写 dangerouslyAllowAllBuilds: true（构建门放开）')
    healLog('[preset] 已写 dangerouslyAllowAllBuilds: true（构建门放开）')
  } catch (error) {
    console.error('[preset-plugins] 构建门配置失败:', error)
    healLog(`[preset] 构建门配置异常：${String(error)}`)
  }
}

/**
 * 幂等补写 coding-sidebar 标题栏避让配置（$DSH_HOME/settings.yaml）：
 * 面板顶部让位 KCoder 自绘状态栏（48px，取 SHELL_TITLEBAR_HEIGHT 防魔
 * 数漂移；开关簇本体由 sidebar-cluster.ts 隐藏代理，不消费下移效果）。
 * 整块缺失才追加——用户/插件设置页改过则不动（旧收编线
 * dsh-better-sidebar 块不删：旧包退役后无人读，残留无害）；调用时序在
 * dsh 启动前，无并发写风险。tabsEnabled 不写：终端/Git 等重功能保持
 * 插件默认，用户经设置页自选（KCoder 内置终端面板已删除，预览面板
 * 不互斥）。
 */
function ensureSidebarCompatSettings(): void {
  try {
    const settingsPath = join(dshHome(), 'settings.yaml')
    if (!existsSync(settingsPath)) return
    const yaml = readFileSync(settingsPath, 'utf8')
    if (/^dsh-coding-sidebar:/m.test(yaml)) return
    const block = `dsh-coding-sidebar:\n  titleBarCompat: true\n  titleBarStripPx: ${SHELL_TITLEBAR_HEIGHT}\n`
    writeFileSync(settingsPath, yaml.endsWith('\n') ? yaml + block : yaml + '\n' + block)
    console.log('[preset-plugins] 已补写 coding-sidebar 标题栏避让配置')
    healLog('[preset] 已补写 coding-sidebar 标题栏避让配置')
  } catch (error) {
    console.error('[preset-plugins] coding-sidebar 避让配置补写失败:', error)
    healLog(`[preset] coding-sidebar 避让配置补写异常：${String(error)}`)
  }
}

/** profile package.json 的 dsh.profile.bundles（缺失段视为空数组）。 */
function bundlesOf(manifest: Record<string, unknown>): string[] {
  const dsh = manifest['dsh'] as { profile?: { bundles?: unknown } } | undefined
  const list = dsh?.profile?.bundles
  return Array.isArray(list) ? (list as string[]) : []
}

/**
 * spec/版本共用的 semver 三元组提取：`^0.38.5`/`0.1.0`/`github:…#v1.0.3`
 * （tag 版本）→ [0,38,5]/[1,0,3]；link: 等无版本形态 → null。预置 spec
 * 与实装版本同一解析，漂移对账口径一致。
 */
function specMinVer(spec: string): [number, number, number] | null {
  const m = /[~^]?(\d+)\.(\d+)\.(\d+)/.exec(spec)
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** 三元组序比较：a<b → -1，a=b → 0，a>b → 1。 */
function cmpVer(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

/** node_modules 实体的 version（缺失/损坏返回 null）。 */
function installedVersionOf(profileDir: string, name: string): string | null {
  try {
    const pkg = JSON.parse(
      readFileSync(join(profileDir, 'node_modules', name, 'package.json'), 'utf8'),
    ) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

/**
 * 幂等物化 + 注册（dsh 启动前调用）。任何失败只记日志不抛——预置插件
 * 缺席时 dsh 裸起仍可用，下次启动幂等重试。
 */
export function ensurePresetPlugins(): void {
  try {
    const profileDir = join(dshHome(), 'profiles', WEB_PROFILE)
    const manifestPath = join(profileDir, 'package.json')
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    const patchLayerPath = join(profileDir, 'cordis.patch.yml')
    const installed = (p: string): boolean => existsSync(join(profileDir, 'node_modules', p))
    const presetNames = Object.keys(PRESET_PLUGINS)

    // 1) 骨架：清单不存在 → 预写完整模板（上游 initProfile 只在缺失时写，
    //    预写不会被模板覆盖）。bundles 只含模板内置层——预置插件的声明
    //    严格后置于安装成功（见第 4 步对账，防“声明了但没装上”让 dsh 崩）
    let manifest = readJson(manifestPath)
    const fresh = manifest === null
    if (fresh) {
      mkdirSync(profileDir, { recursive: true })
      manifest = {
        name: `dsh-profile-${WEB_PROFILE}`,
        private: true,
        dependencies: { ...PRESET_PLUGINS },
        dsh: { profile: { bundles: [...TEMPLATE_BUNDLES] } },
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
      if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
      if (!existsSync(patchLayerPath)) writeFileSync(patchLayerPath, PROFILE_PATCH_TEMPLATE)
      console.log('[preset-plugins] 预写 profile 骨架并预置插件清单')
      healLog('[preset] 预写 profile 骨架并预置插件清单')
    }
    // 骨架分支已重建清单，此后 manifest 必非 null
    const m = manifest as Record<string, unknown>

    // 1.5) 非 fresh 但 pnpm-workspace.yaml 丢失（手动清理/部分删除的
    //      非常规态）：幂等补写上游同款模板。不补则三处连锁卡死——
    //      ensureProfilePatches 以它判 profile 已初始化（早退连锄点
    //      兜底都跳过，2026-08-20 实测现场）、ensureProfilePeerRules
    //      同判、ensurePnpmBuildsAllowed 同判；且丢失态下 pnpm 按
    //      默认 symlink 布局安装，偏离上游 hoisted 模板。上游
    //      initProfile 本就是缺失才补的同款幂等设计，此处对非 fresh
    //      路径补齐同一行为
    if (!fresh && !existsSync(workspacePath)) {
      writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
      console.log('[preset-plugins] pnpm-workspace.yaml 丢失，已补写上游同款模板')
      healLog('[preset] pnpm-workspace.yaml 丢失，已补写上游同款模板')
    }

    // 1.8) 退役预置清理（幂等，先于补写/对账）：老 profile 里已装的
    //      退役包三处摘除——dependencies 声明（不摘则 pnpm install 反复
    //      重装）、bundles 声明（dsh 唯一消费口，不摘则 loader 继续加
    //      载）、node_modules 实体（hoisted 顶层真目录，删除断解析）。
    //      对照 kcoder-skills-bundle 的 RETIRED_PLUGINS 模式
    const preBundles = bundlesOf(m)
    const keptBundles = preBundles.filter((p) => !RETIRED_PRESETS.includes(p))
    const depsMap = (m['dependencies'] ?? {}) as Record<string, unknown>
    const retiredDeps = RETIRED_PRESETS.filter((r) => r in depsMap)
    if (keptBundles.length !== preBundles.length || retiredDeps.length > 0) {
      if (keptBundles.length !== preBundles.length) {
        const dshSec = (m['dsh'] ?? {}) as { profile?: Record<string, unknown> }
        const profileSec = (dshSec.profile ?? {}) as Record<string, unknown>
        m['dsh'] = { ...dshSec, profile: { ...profileSec, bundles: keptBundles } }
      }
      if (retiredDeps.length > 0) {
        for (const r of retiredDeps) delete depsMap[r]
        m['dependencies'] = depsMap
      }
      writeFileSync(manifestPath, `${JSON.stringify(m, undefined, 2)}\n`)
      const cleaned = [...new Set([...retiredDeps, ...preBundles.filter((p) => RETIRED_PRESETS.includes(p))])]
      console.log(`[preset-plugins] 退役预置声明已清理: ${cleaned.join(', ')}`)
      healLog(`[preset] 退役预置声明已清理: ${cleaned.join(', ')}`)
    }
    for (const r of RETIRED_PRESETS) {
      const dir = join(profileDir, 'node_modules', r)
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
        console.log(`[preset-plugins] 已删除退役插件实体: ${r}`)
        healLog(`[preset] 已删除退役插件实体: ${r}`)
      }
      // @scope/name 形态：包删除后空 scope 壳目录一并清（pnpm 图收敛
      // 不管空壳，残留会误导排查）
      if (r.includes('/')) {
        const scopeDir = join(profileDir, 'node_modules', r.split('/')[0])
        try {
          if (existsSync(scopeDir) && readdirSync(scopeDir).length === 0) {
            rmSync(scopeDir, { recursive: true, force: true })
            console.log(`[preset-plugins] 已清理空 scope 目录: ${r.split('/')[0]}`)
            healLog(`[preset] 已清理空 scope 目录: ${r.split('/')[0]}`)
          }
        } catch { /* 目录并发变动时跳过，下次幂等重试 */ }
      }
    }

    // 2) 补写 dependencies 缺项（可先行——dsh 不查 dependencies，
    //    只查 bundles 层叠解析）
    const deps = (m['dependencies'] as Record<string, unknown> | undefined) ?? ({} as Record<string, unknown>)
    const missingDeps = presetNames.filter((p) => !(p in deps))
    if (missingDeps.length > 0) {
      for (const p of missingDeps) deps[p] = PRESET_PLUGINS[p]
      m['dependencies'] = deps
      writeFileSync(manifestPath, `${JSON.stringify(m, undefined, 2)}\n`)
      console.log(`[preset-plugins] 已补写依赖声明: ${missingDeps.join(', ')}`)
      healLog(`[preset] 已补写依赖声明: ${missingDeps.join(', ')}`)
    }

    // 2.5) spec 漂移对账（只升不降）：实体版本低于预置 spec 下界时，
    //      改写 deps spec 为预置值并摘除旧实体，交第 3 步重装。这是
    //      「预置 spec 升级推不到已装用户」的机制补丁——0.4.9 实证：
    //      alpha.2 引擎移除 dsh-settings 的 settingsNamespace 导出，
    //      升级用户 profile 里的 dsh-context 0.37.x 仍 import 该导出，
    //      启动即 SyntaxError 全局崩。实体版本满足下界则不动（用户
    //      update --latest 升线、mac git 源收编 0.17.2 均不被降级覆写）
    for (const p of presetNames) {
      const min = specMinVer(PRESET_PLUGINS[p])
      if (min === null) continue
      const cur = specMinVer(installedVersionOf(profileDir, p) ?? '')
      const entityDir = join(profileDir, 'node_modules', p)
      const staleEntity = existsSync(entityDir) && (cur === null || cmpVer(cur, min) < 0)
      if (!staleEntity && cur !== null) continue
      if (deps[p] !== PRESET_PLUGINS[p]) {
        deps[p] = PRESET_PLUGINS[p]
        writeFileSync(manifestPath, `${JSON.stringify(m, undefined, 2)}\n`)
        console.log(`[preset-plugins] 预置 spec 已对齐: ${p} → ${PRESET_PLUGINS[p]}`)
        healLog(`[preset] 预置 spec 已对齐: ${p} → ${PRESET_PLUGINS[p]}`)
      }
      if (staleEntity) {
        rmSync(entityDir, { recursive: true, force: true })
        console.log(`[preset-plugins] 已摘除过旧实体（版本低于预置下界）: ${p}`)
        healLog(`[preset] 已摘除过旧实体（版本低于预置下界）: ${p}`)
      }
    }

    // 3) 安装：任何预置包缺席 → pnpm install（先确保 patch 声明与
    //    node-pty 构建许可就位——name-only 补丁在安装时自动应用，
    //    构建许可不在 install 前写入则首装后需重装才生效）。含幽灵态
    //    自愈：旧版本声明了 bundles 但装包失败，这里重装后由第 4 步
    //    对账落地声明。install 成功后二调 ensureProfilePatches：补丁
    //    未生效时（如 v0.1.9 Windows CRLF patch 现场）重装应用 + 锄点
    //    注入兑底
    const needInstall = presetNames.some((p) => !installed(p))
    ensurePnpmBuildsAllowed(workspacePath)
    ensureSidebarCompatSettings()
    if (needInstall) {
      ensureProfilePatches()
      console.log('[preset-plugins] 预置插件缺失，执行 pnpm install …')
      healLog(`[preset] 预置插件缺失（${presetNames.filter((p) => !installed(p)).join(', ')}），执行 pnpm install …`)
      const r = runPnpm(['install'], profileDir, 600_000)
      healLog(
        `[preset] pnpm install exit=${String(r.status)}` +
          (r.status !== 0 ? ` stderr=${(r.stderr ?? '').slice(0, 800)}` : ''),
      )
      if (r.status !== 0) {
        console.error('[preset-plugins] pnpm install 失败（下次启动重试）:', r.stderr?.slice(0, 2000) ?? r.error)
      } else {
        ensureProfilePatches()
      }
    } else {
      healLog('[preset] 预置插件均已安装')
    }

    // 4) bundles 声明对账（dsh 启动的唯一消费口）：已装未声明 → 补
    //    （锚点 dsh-web-app / dsh-skills-bundle 之后，与 mac 开发机
    //    层叠一致）；已声明未装（install 失败/半装）→ 摘除，防 dsh 启动
    //    崩溃，下次启动重试重装
    const bundles = bundlesOf(m)
    const ghost = presetNames.filter((p) => bundles.includes(p) && !installed(p))
    const undeclared = presetNames.filter((p) => !bundles.includes(p) && installed(p))
    if (ghost.length > 0 || undeclared.length > 0) {
      const kept = bundles.filter((p) => !ghost.includes(p))
      let anchor = kept.indexOf('dsh-skills-bundle')
      if (anchor === -1) anchor = kept.indexOf(TEMPLATE_BUNDLES[1])
      let offset = 0
      for (const p of undeclared) {
        kept.splice(anchor + 1 + offset, 0, p)
        offset += 1
      }
      const dsh = (m['dsh'] ?? {}) as { profile?: Record<string, unknown> }
      const profile = (dsh.profile ?? {}) as Record<string, unknown>
      m['dsh'] = { ...dsh, profile: { ...profile, bundles: kept } }
      writeFileSync(manifestPath, `${JSON.stringify(m, undefined, 2)}\n`)
      console.log(
        `[preset-plugins] bundles 对账（补声明: ${undeclared.join(', ') || '无'}，摘除未装: ${ghost.join(', ') || '无'}）`,
      )
      healLog(
        `[preset] bundles 对账（补声明: ${undeclared.join(', ') || '无'}，摘除未装: ${ghost.join(', ') || '无'}）`,
      )
    }
  } catch (error) {
    console.error('[preset-plugins] 物化失败:', error)
    healLog(`[preset] 物化异常：${String(error)}`)
  }
}
