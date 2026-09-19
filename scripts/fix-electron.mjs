#!/usr/bin/env node
/**
 * Electron 二进制离线恢复（`pnpm fix:electron`）。
 *
 * 背景：electron 包只带 JS 壳，真正的二进制由 postinstall（install.js 经
 * @electron/get）下载并解压到包内的 `dist/`，同时写下 `path.txt`。本机到
 * GitHub releases 不可达时，那次 postinstall 会挂死或拉不到——于是包目录里
 * 只剩壳，`pnpm dev` / `electron-vite` 直接报
 *
 *     Error: Electron uninstall
 *
 * （2026-09-19 现场：一次隐式 `pnpm install` 重链 node_modules 后触发。）
 *
 * 本脚本从**本地缓存 zip**（@electron/get 的缓存目录）把 dist/ 与 path.txt
 * 补回来，全程离线、幂等；已就绪时只打印状态直接退出。
 *
 * 用法：
 *   node scripts/fix-electron.mjs          # 缺什么补什么（幂等）
 *   node scripts/fix-electron.mjs --check  # 只检查，不写入（CI/巡检用）
 *
 * 缓存目录（@electron/get 口径）：
 *   macOS   ~/Library/Caches/electron
 *   Linux   ${XDG_CACHE_HOME:-~/.cache}/electron
 *   Windows %LOCALAPPDATA%/electron/Cache
 *
 * 若缓存里也没有对应 zip：设 `ELECTRON_MIRROR` 后跑
 * `node node_modules/electron/install.js`，或直接 `pnpm install`（镜像已配）。
 *
 * @module scripts/fix-electron
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const checkOnly = process.argv.includes('--check')

/** 目标平台可执行文件在解压目录里的相对路径（electron install.js 同口径）。 */
function executableRelPath() {
  if (process.platform === 'darwin') return join('Electron.app', 'Contents', 'MacOS', 'Electron')
  if (process.platform === 'win32') return 'electron.exe'
  return 'electron'
}

/** @electron/get 的缓存根目录。 */
function cacheRoots() {
  const roots = []
  if (process.platform === 'darwin') roots.push(join(homedir(), 'Library', 'Caches', 'electron'))
  else if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA']
    if (local !== undefined) roots.push(join(local, 'electron', 'Cache'))
  } else {
    roots.push(join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'electron'))
  }
  return roots.filter(dir => existsSync(dir))
}

/** 在缓存里找 electron-v<版本>-<平台>-<架构>.zip（缓存按内容哈希分子目录）。 */
function findCachedZip(version) {
  const name = `electron-v${version}-${process.platform}-${process.arch}.zip`
  for (const root of cacheRoots()) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(root, entry.name, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const require = createRequire(import.meta.url)
let pkgDir
try {
  pkgDir = dirname(require.resolve('electron/package.json'))
} catch {
  console.error('[fix-electron] 找不到 electron 包——先 `pnpm install`')
  process.exit(2)
}
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version
const rel = executableRelPath()
const binary = join(pkgDir, 'dist', rel)
const pathTxt = join(pkgDir, 'path.txt')

if (existsSync(binary) && existsSync(pathTxt)) {
  console.log(`[fix-electron] 已就绪：electron ${version} → ${binary}`)
  process.exit(0)
}
console.log(`[fix-electron] electron ${version} 二进制缺失（缺 ${existsSync(binary) ? 'path.txt' : 'dist/'}）`)
if (checkOnly) process.exit(1)

const zip = findCachedZip(version)
if (zip === null) {
  console.error(`[fix-electron] 缓存里没有 electron-v${version}-${process.platform}-${process.arch}.zip`
    + '——设 ELECTRON_MIRROR 后跑 `node node_modules/electron/install.js`，或直接 `pnpm install`（镜像已配）')
  process.exit(3)
}
console.log(`[fix-electron] 从缓存解压：${zip}`)
rmSync(join(pkgDir, 'dist'), { recursive: true, force: true })
mkdirSync(join(pkgDir, 'dist'), { recursive: true })
// unzip 在 macOS / 主流 Linux 自带；失败即明确报错（不静默留半个 dist）
execFileSync('unzip', ['-q', zip, '-d', join(pkgDir, 'dist')], { stdio: 'inherit' })
if (!existsSync(binary)) {
  console.error(`[fix-electron] 解压后仍缺 ${binary}——zip 内容与平台不符？`)
  process.exit(4)
}
writeFileSync(pathTxt, rel)
console.log(`[fix-electron] 已恢复：${binary}`)
console.log('[fix-electron] 自证：node -p "require(\'electron\')" 应打印上面的路径')
