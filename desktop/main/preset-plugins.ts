/**
 * 预置第三方插件（dsh-vision-router / dsh-context）的开箱物化。
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
 * update --latest 升线。vision-router 精确锁定（keyed slot 契约适配版，
 * 防破坏性变更混入）。
 *
 * dsh-plugin-genui 已不再预置（2026-08-20 起由用户经插件市场自行安装）。
 * 它的两个上游缺陷补丁仍随包分发：用户自装后 ensureProfilePatches 会
 * 补声明并自愈（锄点注入兑底，见 profile-patches.ts）。
 *
 * @module desktop/main/preset-plugins
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEB_PROFILE, dshHome, runPnpm } from './dsh-contract'
import { ensureProfilePatches, healLog } from './profile-patches'

/** 预置插件：bundle 名 → 依赖 spec（键顺序即层叠顺序，对齐 mac 开发机）。 */
export const PRESET_PLUGINS: Record<string, string> = {
  'dsh-vision-router': '1.6.1',
  'dsh-context': '^0.12.1',
}

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

    // 3) 安装：任何预置包缺席 → pnpm install（先确保 patch 声明就位——
    //    name-only 补丁在安装时自动应用）。含幽灵态自愈：旧版本声明了
    //    bundles 但装包失败，这里重装后由第 4 步对账落地声明。
    //    install 成功后二调 ensureProfilePatches：补丁未生效时（如
    //    v0.1.9 Windows CRLF patch 现场）重装应用 + 锄点注入兑底
    const needInstall = presetNames.some((p) => !installed(p))
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
