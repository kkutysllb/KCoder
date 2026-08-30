/**
 * 预置第三方插件（dsh-context / dsh-better-sidebar / archify /
 * drag-to-attachment）的开箱物化。
 *
 * 这三个插件是 KCoder 发行物的一部分：Windows 全新安装后 profile 是
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
 * update --latest 升线。破坏性敏感的包装层插件用精确锁定（如 archify）。
 *
 * 预置冻结（2026-08-30）：第三方插件不再新增预置——用户按需经插件
 * 管理页自装（github 源一键安装）。现有四个维持现状（含缺陷补丁与
 * 版本锁）；退役走 RETIRED_PRESETS 三清自愈（见 dsh-vision-router）。
 *
 * dsh-better-sidebar（2026-08-20 预置，全面替代自研功能面：文件树
 *   面板、内嵌终端与状态栏四面板——文件预览/会话轨迹/日志导出/Git
 *   ——已删除）：侧边栏工作台底座（文件树/CM6 编辑器/图片·MD 预览/
 *   终端/Git/子代理，服务化扩展点）。原生兼容 rc.8 无需补丁；两项额外物化：
 * - pnpm-workspace.yaml 补写 onlyBuiltDependencies: [node-pty,
 *   dsh-better-sidebar]（pnpm 10 默认拦截构建脚本：不许可则插件终端
 *   缺 node-pty 二进制，git 源版本（0.15.0+）直接装不上）；
 * - $DSH_HOME/settings.yaml 补写 dsh-better-sidebar.titleBarCompat:
 *   true + titleBarStripPx——面板顶部让位 KCoder 自绘状态栏（插件
 *   自动探测只认 win32 advanced 标题栏，mac 需手动开；实测
 *   2026-08-20）。开关簇不下移：由 sidebar-cluster.ts 注入器隐藏
 *   并在状态栏代理接管（代理一枚 right 12 + 自研终端 44 + 上下文 76；
 *   插件底面板产品侧弃用——agent 运行态黑屏无唤醒信号，sidebar-cluster
 *   压制看门狗自动收回一切打开路径，热补丁/挤压垫片已随终端回归
 *   自研而拆除）。
 *
 * @tt-a1i/archify-dsh（2026-08-20 预置）：架构图 agent skill——把
 * 代码库/系统描述变成自包含交互 HTML 技术图（架构/工作流/时序/
 * 数据流/生命周期五型，类型化 JSON IR + 确定性校验管线）。本体
 * tt-a1i/archify v2.15.0（MIT，14.5K★）的官方 DSH 包装，community
 * opt-in，无遥测。纯技能 bundle：零依赖零 peer、无原生构建、无
 * settings——除声明外无任何物化项。锁精确 0.1.0（包装层唯一版本，
 * 按 rc.6 发布，防后续版本破坏性变更混入）。
 * 调用：会话内 “Use the archify skill to map this repository's
 * runtime architecture.”；产物单文件 HTML 可在 better-sidebar
 * 预览面板直接打开。
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

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEB_PROFILE, dshHome, runPnpm } from './dsh-contract'
import { ensureProfilePatches, healLog } from './profile-patches'
import { SHELL_TITLEBAR_HEIGHT } from './theme-watcher'

/** 预置插件：bundle 名 → 依赖 spec（键顺序即层叠顺序，对齐 mac 开发机）。 */
export const PRESET_PLUGINS: Record<string, string> = {
  'dsh-context': '^0.37.0',
  'dsh-better-sidebar': '^0.17.0',
  '@tt-a1i/archify-dsh': '0.1.0',
  '@dsh-external/dsh-drag-to-attachment': 'github:djt889/dsh-drag-to-attachment#v1.0.3',
}

/**
 * 退役预置插件：不再预置，也不留在用户 profile——dependencies 声明、
 * bundles 层叠声明与 node_modules 实体三处自愈移除（见
 * ensurePresetPlugins 的退役清理步骤）。
 */
const RETIRED_PRESETS = ['dsh-vision-router']

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
 * 幂等补写 better-sidebar 标题栏避让配置（$DSH_HOME/settings.yaml）：
 * 面板顶部让位 KCoder 自绘状态栏（48px，取 SHELL_TITLEBAR_HEIGHT 防魔
 * 数漂移；开关簇本体由 sidebar-cluster.ts 隐藏代理，不消费下移效果）。
 * 整块缺失才追加——用户/插件设置页改过则不动；调用时序在 dsh 启动前，
 * 无并发写风险。tabsEnabled 不写：终端/Git 等重功能保持插件默认，
 * 用户经设置页自选（KCoder 内置终端面板已删除，预览面板不互斥）。
 */
function ensureSidebarCompatSettings(): void {
  try {
    const settingsPath = join(dshHome(), 'settings.yaml')
    if (!existsSync(settingsPath)) return
    const yaml = readFileSync(settingsPath, 'utf8')
    if (/^dsh-better-sidebar:/m.test(yaml)) return
    const block = `dsh-better-sidebar:\n  titleBarCompat: true\n  titleBarStripPx: ${SHELL_TITLEBAR_HEIGHT}\n`
    writeFileSync(settingsPath, yaml.endsWith('\n') ? yaml + block : yaml + '\n' + block)
    console.log('[preset-plugins] 已补写 better-sidebar 标题栏避让配置')
    healLog('[preset] 已补写 better-sidebar 标题栏避让配置')
  } catch (error) {
    console.error('[preset-plugins] better-sidebar 避让配置补写失败:', error)
    healLog(`[preset] better-sidebar 避让配置补写异常：${String(error)}`)
  }
}

/** profile package.json 的 dsh.profile.bundles（缺失段视为空数组）。 */
function bundlesOf(manifest: Record<string, unknown>): string[] {
  const dsh = manifest['dsh'] as { profile?: { bundles?: unknown } } | undefined
  const list = dsh?.profile?.bundles
  return Array.isArray(list) ? (list as string[]) : []
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
    //    （锚点 dsh-web-app / @kcoder/skills-bundle 之后，与 mac 开发机
    //    层叠一致）；已声明未装（install 失败/半装）→ 摘除，防 dsh 启动
    //    崩溃，下次启动重试重装
    const bundles = bundlesOf(m)
    const ghost = presetNames.filter((p) => bundles.includes(p) && !installed(p))
    const undeclared = presetNames.filter((p) => !bundles.includes(p) && installed(p))
    if (ghost.length > 0 || undeclared.length > 0) {
      const kept = bundles.filter((p) => !ghost.includes(p))
      let anchor = kept.indexOf('@kcoder/skills-bundle')
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
