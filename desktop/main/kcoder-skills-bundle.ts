/**
 * @kcoder/skills-bundle 内置 bundle 的物化与注册。
 *
 * KCoder 自有 dsh bundle（bundle/kcoder-skills）：方法论技能包（适配自
 * KSkills 仓库）以 out-of-tree bundle 形态随桌面端分发。本模块在 dsh
 * 启动前把它幂等物化进 web profile：
 *
 * - 文件：`<bundle 源> → $DSH_HOME/profiles/web/node_modules/@kcoder/skills-bundle`
 *   （版本号变化才重拷；pnpm 布局下真实目录同样可被 Node 父链 resolve）
 * - 注册：profile package.json 的 `dsh.profile.bundles` 数组插入
 *   `@kcoder/skills-bundle`（紧跟 dsh-web-app 之后）。上游 loadProfile
 *   只在清单不存在时写模板（packages/boot/app-boot profile.ts initProfile），
 *   预写/改写清单不会被模板覆盖；层叠顺序中我们的 patch 行最后应用。
 *
 * 源目录：开发态 `PROJECT_ROOT/bundle/kcoder-skills`；打包态
 * `resources/kcoder-skills`（electron-builder extraResources 物化）。
 *
 * @module desktop/main/kcoder-skills-bundle
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT, WEB_PROFILE, dshHome } from './dsh-contract'

/** bundle 包名（profile bundles 数组与 node_modules 目录名）。 */
export const KCODER_SKILLS_BUNDLE = '@kcoder/skills-bundle'

/** 上游 web 模板的 bundles 前缀（预写骨架时对齐官方层叠顺序）。 */
const TEMPLATE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** 分发的 bundle 源目录（开发态仓库内；打包态 extraResources）。 */
function bundleSource(): string {
  const packaged = join(process.resourcesPath ?? PROJECT_ROOT, 'kcoder-skills')
  if (existsSync(packaged)) return packaged
  return join(PROJECT_ROOT, 'bundle', 'kcoder-skills')
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
 * 幂等物化 + 注册（dsh 启动前调用）。任何失败只记日志不抛——技能包
 * 缺席时 dsh 仍可正常启动，桌面端功能不受影响。
 */
export function ensureKcoderSkillsBundle(): void {
  try {
    const source = bundleSource()
    if (!existsSync(join(source, 'entry.js'))) {
      console.warn('[kcoder-skills] bundle 源缺失，跳过物化:', source)
      return
    }
    const profileDir = join(dshHome(), 'profiles', WEB_PROFILE)
    const target = join(profileDir, 'node_modules', KCODER_SKILLS_BUNDLE)

    // 1) 文件物化：版本一致且入口齐全则跳过
    const srcVersion = (readJson(join(source, 'package.json'))?.['version'] as string) ?? ''
    const dstVersion = (readJson(join(target, 'package.json'))?.['version'] as string) ?? ''
    const intact = existsSync(join(target, 'entry.js')) && existsSync(join(target, 'skills', 'manifest.json'))
    if (!intact || srcVersion !== dstVersion) {
      mkdirSync(join(profileDir, 'node_modules', '@kcoder'), { recursive: true })
      rmSync(target, { recursive: true, force: true })
      cpSync(source, target, { recursive: true })
      console.log(`[kcoder-skills] 物化 ${srcVersion}: ${target}`)
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
        dsh: { profile: { bundles: [...TEMPLATE_BUNDLES, KCODER_SKILLS_BUNDLE] } },
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
      console.log('[kcoder-skills] 预写 profile 清单并注册 bundle')
      return
    }
    const bundles = bundlesOf(manifest)
    if (bundles.includes(KCODER_SKILLS_BUNDLE)) return
    const anchor = bundles.indexOf(TEMPLATE_BUNDLES[1])
    bundles.splice(anchor === -1 ? bundles.length : anchor + 1, 0, KCODER_SKILLS_BUNDLE)
    const dsh = (manifest['dsh'] ?? {}) as { profile?: Record<string, unknown> }
    const profile = (dsh.profile ?? {}) as Record<string, unknown>
    manifest['dsh'] = { ...dsh, profile: { ...profile, bundles } }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    console.log('[kcoder-skills] 已注册进 profile bundles 层叠')
  } catch (error) {
    console.error('[kcoder-skills] 物化失败:', error)
  }
}
