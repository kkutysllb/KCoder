#!/usr/bin/env node
/**
 * 打包产物 extraResources 对账：仓库 bundle/ 清单与 profile-patches 必须
 * 全部随包在位。release.sh verify 1.7 的 CI 平价版——本地 build 有此闸，
 * CI-only 发布链没有，bundle/dsh-file-attach 漏配 extraResources 连续
 * 五个版本都没拦住（0.5.1-0.5.5，Windows 全新安装引擎启动即崩）。
 *
 * 用法：node scripts/verify-bundles-shipped.mjs <resources 目录>
 * （mac: dist/mac-arm64/KCoder.app/Contents/Resources；
 *   win: dist/win-unpacked/resources；linux: dist/linux-unpacked/resources）
 *
 * 对账口径：bundle/ 下每个含 package.json 的目录（与 kcoder-skills-bundle
 * BUNDLES 表的物化源清单同源）→ resources/<同名目录>/package.json；
 * profiles/web/patches/*.patch → resources/profile-patches/ 同名文件。
 *
 * @module scripts/verify-bundles-shipped
 */
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(join(fileURLToPath(import.meta.url), '..', '..'))
const resDir = resolve(process.argv[2] ?? '')
if (process.argv[2] === undefined || !existsSync(resDir)) {
  console.error(`[verify-bundles] resources 目录不存在：${resDir}（用法：node scripts/verify-bundles-shipped.mjs <resources 目录>）`)
  process.exit(2)
}

const missing = []

// bundle/ 目录清单（与物化源同源：只认含 package.json 的实体包目录）
const bundleDir = join(root, 'bundle')
for (const e of readdirSync(bundleDir, { withFileTypes: true })) {
  if (!e.isDirectory()) continue
  if (!existsSync(join(bundleDir, e.name, 'package.json'))) continue
  if (!existsSync(join(resDir, e.name, 'package.json'))) missing.push(e.name)
}

// 插件热补丁（Windows 无 launchd，随包分发是补丁的唯一通道）
const patchesDir = join(root, 'profiles', 'web', 'patches')
if (existsSync(patchesDir)) {
  for (const f of readdirSync(patchesDir)) {
    if (!f.endsWith('.patch')) continue
    if (!existsSync(join(resDir, 'profile-patches', f))) missing.push(join('profile-patches', f))
  }
}

if (missing.length > 0) {
  console.error(`[verify-bundles] 打包产物缺随包资源（extraResources 漏配？）：\n  ${missing.join('\n  ')}`)
  process.exit(1)
}
console.log(`[verify-bundles] bundle/ 与 profile-patches 全部随包在位（${resDir}）`)
