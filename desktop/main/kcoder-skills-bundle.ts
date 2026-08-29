/**
 * KCoder 自有 dsh bundle 的物化与注册（out-of-tree bundle 随桌面端分发）。
 *
 * 当前三个 bundle：
 * - @kcoder/skills-bundle（bundle/kcoder-skills）：方法论技能包（适配自
 *   KSkills 仓库），激活时注册 runtime skill；
 * - @kcoder/language-bundle（bundle/kcoder-language）：「强制中文回答」
 *   system-prompt section 插件，默认 disabled，由 language-settings.ts
 *   在 home patch 层热切换；
 * - @kcoder/git-panel（bundle/kcoder-git-panel）：独立 git 工作区面板
 *   （server 只读快照 RPC + client 页面内浮动面板）。2026-08 起整体替代
 *   已退役的 Electron 宿主 git-panel.ts（旧 IPC/视图/让位协议已摘除）。
 *
 * 本模块在 dsh 启动前把各 bundle 幂等物化进 web profile：
 *
 * - 文件：`<bundle 源> → $DSH_HOME/profiles/web/node_modules/@kcoder/<name>`
 *   （版本号变化才重拷；pnpm 布局下真实目录同样可被 Node 父链 resolve）
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
import { PROJECT_ROOT, WEB_PROFILE, dshHome } from './dsh-contract'

/** bundle 包名（profile bundles 数组与 node_modules 目录名）。 */
export const KCODER_SKILLS_BUNDLE = '@kcoder/skills-bundle'

/** 语言指令 bundle 包名（开关热切换见 language-settings.ts）。 */
export const KCODER_LANGUAGE_BUNDLE = '@kcoder/language-bundle'

/** git 工作区面板 bundle 包名（独立插件，见 bundle/kcoder-git-panel）。 */
export const KCODER_GIT_PANEL_BUNDLE = '@kcoder/git-panel'

/** 嵌入式终端 bundle 包名（独立插件，见 bundle/kcoder-terminal）。 */
export const KCODER_TERMINAL_BUNDLE = '@kcoder/terminal'

/** 上游 web 模板的 bundles 前缀（预写骨架时对齐官方层叠顺序）。 */
const TEMPLATE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** 一个内置 bundle 的物化描述。 */
interface BundledPlugin {
  /** 包名（bundles 注册与 node_modules 目录名）。 */
  pkg: string
  /** 源目录名（开发态 bundle/ 下；打包态 resources/ 下同名）。 */
  dir: string
  /** entry.js 之外参与完整性检查的相对路径。 */
  intactFiles: string[]
}

/** 全部内置 bundle（物化顺序即注册顺序）。 */
const BUNDLES: BundledPlugin[] = [
  { pkg: KCODER_SKILLS_BUNDLE, dir: 'kcoder-skills', intactFiles: [join('skills', 'manifest.json')] },
  { pkg: KCODER_LANGUAGE_BUNDLE, dir: 'kcoder-language', intactFiles: [] },
  { pkg: KCODER_GIT_PANEL_BUNDLE, dir: 'kcoder-git-panel', intactFiles: ['client.js'] },
  { pkg: KCODER_TERMINAL_BUNDLE, dir: 'kcoder-terminal', intactFiles: ['client.js'] },
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
  if (!existsSync(join(source, 'entry.js'))) {
    console.warn(`[kcoder-bundle] ${b.pkg} 源缺失，跳过物化:`, source)
    return
  }
  const target = join(profileDir, 'node_modules', b.pkg)

  // 1) 文件物化：版本一致且入口齐全则跳过
  const srcVersion = (readJson(join(source, 'package.json'))?.['version'] as string) ?? ''
  const dstVersion = (readJson(join(target, 'package.json'))?.['version'] as string) ?? ''
  const intact = existsSync(join(target, 'entry.js'))
    && b.intactFiles.every((f) => existsSync(join(target, f)))
  if (!intact || srcVersion !== dstVersion) {
    mkdirSync(join(profileDir, 'node_modules', '@kcoder'), { recursive: true })
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
