/**
 * 预置第三方插件（dsh-vision-router / dsh-plugin-genui / dsh-context）的
 * 开箱物化。
 *
 * 这三个插件是 KCoder 发行物的一部分：Windows 全新安装后 profile 是
 * 上游空模板（只有 dsh-base / dsh-web-app 内置层），第三方插件不会自动
 * 出现（mac 开发机上它们存在于用户 profile，属用户数据不随包分发）。
 * 本模块在 dsh 启动前幂等物化：
 *
 * - profile 清单（package.json）不存在时预写完整骨架（对齐上游
 *   initProfile 模板：package.json + pnpm-workspace.yaml + cordis.patch.yml；
 *   上游只在清单缺失时写模板，预写不会被覆盖），bundles 层叠 =
 *   模板内置层 + 三个预置插件
 * - 已存在时补写缺失的 dependencies 条目与 bundles 项（锚点插在
 *   dsh-web-app / @kcoder/skills-bundle 之后，与 mac 开发机层叠一致）
 * - dependencies 有新增或 node_modules 缺包时跑一次 pnpm install
 *   （先确保 patch 声明就位——name-only 补丁在安装时自动应用；离线
 *   失败不抛，下次启动幂等重试）
 *
 * 版本策略：genui/context 用 ^（缺陷补丁跟随上游 minor/patch），
 * vision-router 精确锁定（keyed slot 契约适配版，防破坏性变更混入）。
 *
 * @module desktop/main/preset-plugins
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { WEB_PROFILE, dshHome } from './dsh-contract'
import { ensureProfilePatches } from './profile-patches'

/** 预置插件：bundle 名 → 依赖 spec（键顺序即层叠顺序，对齐 mac 开发机）。 */
export const PRESET_PLUGINS: Record<string, string> = {
  'dsh-vision-router': '1.6.1',
  'dsh-context': '^0.12.1',
  'dsh-plugin-genui': '^0.12.2',
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
 * 缺席时 dsh 仍可正常启动，下次启动幂等重试。
 */
export function ensurePresetPlugins(): void {
  try {
    const profileDir = join(dshHome(), 'profiles', WEB_PROFILE)
    const manifestPath = join(profileDir, 'package.json')
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    const patchLayerPath = join(profileDir, 'cordis.patch.yml')

    // 1) 骨架：清单不存在 → 预写完整模板（上游 initProfile 只在缺失时写，
    //    预写不会被模板覆盖）；依赖直接含预置插件，bundles 含预置层
    let manifest = readJson(manifestPath)
    const fresh = manifest === null
    if (fresh) {
      mkdirSync(profileDir, { recursive: true })
      manifest = {
        name: `dsh-profile-${WEB_PROFILE}`,
        private: true,
        dependencies: { ...PRESET_PLUGINS },
        dsh: { profile: { bundles: [...TEMPLATE_BUNDLES, ...Object.keys(PRESET_PLUGINS)] } },
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
      if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
      if (!existsSync(patchLayerPath)) writeFileSync(patchLayerPath, PROFILE_PATCH_TEMPLATE)
      console.log('[preset-plugins] 预写 profile 骨架并预置插件清单')
    }
    // 骨架分支已重建清单，此后 manifest 必非 null
    const m = manifest as Record<string, unknown>

    // 2) 补写：dependencies 缺项 + bundles 缺失项（幂等）
    const deps = (m['dependencies'] as Record<string, unknown> | undefined) ?? ({} as Record<string, unknown>)
    const bundles = bundlesOf(m)
    const presetNames = Object.keys(PRESET_PLUGINS)
    const missingDeps = presetNames.filter((p) => !(p in deps))
    const missingBundles = presetNames.filter((p) => !bundles.includes(p))
    if (!fresh && (missingDeps.length > 0 || missingBundles.length > 0)) {
      for (const p of missingDeps) deps[p] = PRESET_PLUGINS[p]
      // 锚点：dsh-web-app / @kcoder/skills-bundle 之后（分发层顺序）
      let anchor = bundles.indexOf('@kcoder/skills-bundle')
      if (anchor === -1) anchor = bundles.indexOf(TEMPLATE_BUNDLES[1])
      let offset = 0
      for (const p of missingBundles) {
        bundles.splice(anchor + 1 + offset, 0, p)
        offset += 1
      }
      const dsh = (m['dsh'] ?? {}) as { profile?: Record<string, unknown> }
      const profile = (dsh.profile ?? {}) as Record<string, unknown>
      m['dependencies'] = deps
      m['dsh'] = { ...dsh, profile: { ...profile, bundles } }
      writeFileSync(manifestPath, `${JSON.stringify(m, undefined, 2)}\n`)
      console.log(
        `[preset-plugins] 已补写预置插件（依赖: ${missingDeps.join(', ') || '无'}，bundle: ${missingBundles.join(', ') || '无'}）`,
      )
    }

    // 3) 安装：依赖有新增或 node_modules 缺包 → pnpm install（先确保
    //    patch 声明就位——name-only 补丁在安装时自动应用）
    const needInstall =
      fresh ||
      missingDeps.length > 0 ||
      presetNames.some((p) => !existsSync(join(profileDir, 'node_modules', p)))
    if (!needInstall) return
    ensureProfilePatches()
    console.log('[preset-plugins] 预置插件缺失，执行 pnpm install …')
    const r = spawnSync('pnpm', ['install'], { cwd: profileDir, encoding: 'utf8', timeout: 600_000 })
    if (r.status !== 0) {
      console.error('[preset-plugins] pnpm install 失败（下次启动重试）:', r.stderr?.slice(0, 2000) ?? r.error)
    }
  } catch (error) {
    console.error('[preset-plugins] 物化失败:', error)
  }
}
