#!/usr/bin/env node
/**
 * 探针：内置 provider（`@deepseek-ai/dsh-*-ssh`）在 dsh 宿主解析链下的结果。
 *
 * 复刻 `@deepseek-ai/dsh-plugin-manager` 的 `listBundles()` → `bundleManifest()`
 * → `@deepseek-ai/dsh-app-boot` 的 `resolveBundleDir` / `readProfileManifest`
 * （直接 import 运行时自己的实现，不重写逻辑），逐包打印宿主会怎么判：
 *
 * - **解析不到** ⇒ `resolveBundleDir` 抛错 ⇒ 宿主记 `operation-error` ⇒
 *   dsh 插件管理页给该包打「异常」红标（2026-09-30 现场）；
 * - **解析到但无 `dsh.bundle`** ⇒ `bundleManifest` 返回 undefined ⇒ 包不在
 *   profile 的 `dsh.profile.bundles` 里（enabled=false）时宿主直接跳过 ⇒
 *   **不入列、不报错**（provider 的正确归宿，2026-09-30 起随引擎分发）；
 * - 解析到且有 `dsh.bundle` ⇒ 按 bundle 正常入列（那是真插件）。
 *
 * 用法：
 *   node scripts/probe-profile-providers.mjs --runtime <引擎运行时目录> --profile <profile 目录>
 * 缺省取本机打包态运行时与 `$DSH_HOME/profiles/web`。
 *
 * @module scripts/probe-profile-providers
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 与 `desktop/main/preset-plugins.ts` 的 RUNTIME_PROVIDED_PACKAGES 同源。 */
const PACKAGES = [
  '@deepseek-ai/dsh-ssh',
  '@deepseek-ai/dsh-fs-ssh',
  '@deepseek-ai/dsh-subprocess-ssh',
  '@deepseek-ai/dsh-sandbox-ssh',
]

const argv = process.argv.slice(2)
const argOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const defaultRuntime = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'KCoder', 'kcoder-runtime')
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.kcoder')
const runtimeDir = resolve(argOf('--runtime') ?? defaultRuntime)
const profileDir = resolve(argOf('--profile') ?? join(dshHome, 'profiles', 'web'))

const anchor = join(runtimeDir, 'package.json')
if (!existsSync(anchor)) {
  console.error(`[probe-providers] 引擎运行时锚点不存在：${anchor}`)
  process.exit(2)
}
if (!existsSync(join(profileDir, 'package.json'))) {
  console.error(`[probe-providers] profile 清单不存在：${join(profileDir, 'package.json')}`)
  process.exit(2)
}

// 判定逻辑取自**任一**带 dsh-app-boot 的运行时：解析行为只由下面传入的
// 锚点/profile 两个路径决定，与函数从哪份副本加载无关。锚点自己缺 app-boot
// 时（合成/裁剪场景）回退到本机打包态运行时，并打印来源。
const bootEntryOf = (dir) => join(dir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
const bootDir = [runtimeDir, resolve(defaultRuntime)].find((dir) => existsSync(bootEntryOf(dir)))
if (bootDir === undefined) {
  console.error('[probe-providers] 找不到 dsh-app-boot（既不在 --runtime，也不在本机打包态运行时）')
  process.exit(2)
}
if (resolve(bootDir) !== runtimeDir) {
  console.log(`[probe-providers] 判定实现取自 ${bootDir}（锚点仍是 ${runtimeDir}）`)
}

const { resolveBundleDir, readProfileManifest } = await import(pathToFileURL(bootEntryOf(bootDir)).href)

const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
const deps = Object.keys(manifest.dependencies ?? {})
const selected = manifest.dsh?.profile?.bundles ?? []
console.log(`[probe-providers] 运行时=${runtimeDir}\n[probe-providers] profile=${profileDir}`)

let failed = 0
for (const name of PACKAGES) {
  const installed = deps.includes(name)
  const enabled = selected.includes(name)
  try {
    const dir = resolveBundleDir('dsh', name, anchor, profileDir)
    const info = readProfileManifest('dsh', dir)
    const hasBundle = info.dsh?.bundle?.patch !== undefined
    const from = dir.startsWith(runtimeDir) ? '安装锚点（随引擎分发）' : 'profile'
    const verdict = hasBundle
      ? '按 bundle 入列（真插件）'
      : enabled
        ? 'not-bundle 问题入列'
        : '不入列（无 dsh.bundle 且未选中）—— 无红标、无「已安装」条目'
    console.log(`OK   ${name}  version=${String(info.version)}  installed=${String(installed)} enabled=${String(enabled)}`)
    console.log(`     解析自：${from}`)
    console.log(`     宿主判定：${verdict}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}  installed=${String(installed)} enabled=${String(enabled)}`)
    console.log(`     ${error.message}`)
    console.log('     宿主判定：operation-error → 插件页「异常」红标')
  }
}
console.log(
  failed === 0
    ? `\n[probe-providers] ${String(PACKAGES.length)}/${String(PACKAGES.length)} 可由锚点或 profile 解析（无宿主错误）`
    : `\n[probe-providers] ${String(failed)}/${String(PACKAGES.length)} 解析失败 → 宿主会报 operation-error（「异常」）`,
)
process.exit(failed === 0 ? 0 : 1)
