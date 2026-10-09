#!/usr/bin/env node
/**
 * 上游构建链的 pnpm 调用**唯一实现**：按上游 `package.json` 的 `packageManager`
 * 取**精确版本**执行。
 *
 * 为什么要它（两条，分开说清楚——别再混为一谈）：
 *   1. **一致性**：上游声明 `pnpm@<pin>`，而本仓 CI 的 `pnpm/action-setup` 目前硬编码
 *      `version: 11.7.0` ⇒ 上游构建在 CI 与本机跑的不是上游声明的版本。凡「物化/构建
 *      上游」的调用点都应走这里，与上游声明对齐（本仓桌面端自身步骤不在此列）。
 *   2. **2026-10-10 本机现场**：切基线后 `node_modules` 是**上一个 pnpm 版本留下的**
 *      （混合安装态），此时构建会以
 *        [@deepseek-ai/dsh-root] Cannot find entry: ["lib/types/{index,startup}.js"]
 *      失败——而该批垫片**既不在版本控制、`tsc -b` 也不生成**，报错与病因完全对不上。
 *      **权威处置是「全新树 + 重装」**（新建工作树/克隆；见 README 的两条构建铁律），
 *      本模块只负责把版本钉到上游声明，不替代那条处置。
 *
 * 用法：
 *   node scripts/pnpm-pinned.mjs --print <upstreamDir>            # 一行概览（含本机 vs pin）
 *   node scripts/pnpm-pinned.mjs --run <upstreamDir> -- <args…>    # 直接执行（shell 调用）
 *
 * @module scripts/pnpm-pinned
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 读上游声明的 pnpm 精确版本（无声明返回空串）。 */
export function readUpstreamPnpmPin(upstreamDir) {
  try {
    const manifest = JSON.parse(readFileSync(join(upstreamDir, 'package.json'), 'utf8'))
    const pm = typeof manifest.packageManager === 'string' ? manifest.packageManager : ''
    return pm.startsWith('pnpm@') ? pm.slice('pnpm@'.length) : ''
  } catch {
    return ''
  }
}

const IS_WIN = process.platform === 'win32'

/**
 * Windows 上 `npx`/`pnpm` 是 `.cmd` 垫片：Node ≥20 出于安全**禁止无 shell 直接 spawn**
 * （表现为 ENOENT/EINVAL，2026-10-10 在 Git Bash 下实测 `spawnSync pnpm ENOENT`）。
 * 故 Windows 下一律 `shell: true`，并自行给含空格的参数加引号（shell 会按空格再切一次）。
 * 同款先例见 scripts/materialize-peers.mjs 的 `shell: process.platform === 'win32'`。
 */
const quoteArg = (a) => (IS_WIN && /\s/.test(a) ? `"${a}"` : a)
const spawnOpts = (extra) => ({ shell: IS_WIN, windowsHide: true, ...extra })

function probe(command, args) {
  const r = spawnSync(command, args.map(quoteArg), spawnOpts({ encoding: 'utf8', timeout: 30_000 }))
  return r.status === 0 && typeof r.stdout === 'string' ? r.stdout.trim() : ''
}

/**
 * 解析实际执行式：有 pin 且 npx 可用 → `npx --yes pnpm@<pin>`；否则回落本机 pnpm
 * （上游未声明 `packageManager`，或离线/无 npx 的场景）。
 */
export function resolvePinnedPnpm(upstreamDir) {
  const pin = readUpstreamPnpmPin(upstreamDir)
  const npxVersion = probe('npx', ['--version'])
  const localVersion = probe('pnpm', ['--version'])
  if (pin !== '' && npxVersion !== '') {
    return { command: 'npx', args: ['--yes', `pnpm@${pin}`], pin, localVersion, via: 'npx' }
  }
  return { command: 'pnpm', args: [], pin, localVersion, via: 'local' }
}

/** 人类可读的一行概览（setup.sh / release.sh 打印用）。 */
export function describePinnedPnpm(upstreamDir) {
  const { command, args, pin, localVersion, via } = resolvePinnedPnpm(upstreamDir)
  const local = localVersion === '' ? '未知' : localVersion
  if (pin === '') return `本机 pnpm ${local}（上游未声明 packageManager，按本机执行）`
  if (via === 'local') return `本机 pnpm ${local}（上游 pin ${pin}，但无 npx ⇒ 只能按本机执行）`
  const note = local === pin ? '与本机一致' : `本机 ${local} ≠ pin ⇒ 改用 ${command} ${args.join(' ')}`
  return `本机 pnpm ${local}　上游 pin ${pin}（${note}）`
}

/** 执行一次上游 pnpm 调用（继承 stdio，返回退出码）。 */
export function runPinnedPnpm(upstreamDir, pnpmArgs) {
  const { command, args, pin, localVersion, via } = resolvePinnedPnpm(upstreamDir)
  if (pin !== '' && via === 'npx' && localVersion !== pin) {
    console.error(`[pnpm-pinned] 本机 pnpm ${localVersion} ≠ 上游 pin ${pin} ⇒ 用 ${command} ${args.join(' ')}`)
  }
  const r = spawnSync(command, [...args, ...pnpmArgs].map(quoteArg), spawnOpts({ stdio: 'inherit' }))
  if (r.error !== undefined) throw r.error
  return r.status ?? 1
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url
if (invokedDirectly) {
  const [, , flag, dir, ...rest] = process.argv
  const upstreamDir = dir !== undefined && !dir.startsWith('--') ? dir : process.cwd()
  if (flag === '--print') {
    console.log(describePinnedPnpm(upstreamDir))
  } else if (flag === '--run') {
    const sep = rest.indexOf('--')
    const pnpmArgs = sep >= 0 ? rest.slice(sep + 1) : rest
    process.exit(runPinnedPnpm(upstreamDir, pnpmArgs))
  } else {
    console.error('用法：node scripts/pnpm-pinned.mjs --print <upstreamDir> | --run <upstreamDir> -- <pnpm args…>')
    process.exit(2)
  }
}
