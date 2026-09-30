#!/usr/bin/env node
/**
 * 内置 provider 随包断言：构建出的引擎运行时必须真的带上 4 个 SSH provider。
 *
 * 为什么单独有这道闸：这 4 个包**不属于上游依赖图**（`pnpm deploy --prod`
 * 不会带上），由 `scripts/materialize-peers.mjs` 的供给块主动补进 staging。
 * 供给代码一旦被误删或打回，产物本身不会报错——用户侧表现为远程世界
 * `failed to import`；若谁又把它改回 profile 依赖，则会退化成插件页「异常」
 * 红标 + 整棵 pnpm 依赖图报废（2026-09-30 现场）。与 verify-bundles-shipped.mjs
 * 同族的「随包物必须在产物里」断言，离线可跑（不需要 registry）。
 *
 * 清单不在这里重复维护——直接从 `materialize-peers.mjs` 里解析
 * `PROVIDER_PACKAGES` 字面量（仓内既有约定：check-bundle-version-line.mjs
 * 同样文本解析 preset-plugins.ts 的 PRESET_PLUGINS）。
 *
 * 对每个 provider 断言三件事：引擎清单里有且版本一致、实体在包里、
 * 实体自己的 version 与声明一致。
 *
 * 用法：
 *   node scripts/verify-runtime-providers.mjs staging/kcoder-runtime
 *   node scripts/verify-runtime-providers.mjs staging/kcoder-runtime.tar.gz
 *
 * @module scripts/verify-runtime-providers
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(join(fileURLToPath(import.meta.url), '..', '..'))

/** 从 materialize-peers.mjs 解析 PROVIDER_PACKAGES 字面量。 */
function providerPackages() {
  const src = readFileSync(join(root, 'scripts', 'materialize-peers.mjs'), 'utf8')
  const start = src.indexOf('const PROVIDER_PACKAGES = [')
  if (start < 0) throw new Error('materialize-peers.mjs 里找不到 PROVIDER_PACKAGES')
  const end = src.indexOf(']', start)
  if (end < 0) throw new Error('PROVIDER_PACKAGES 数组未闭合')
  const names = [...src.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1])
  if (names.length === 0) throw new Error('PROVIDER_PACKAGES 解析为空')
  return names
}

const target = process.argv[2]
if (target === undefined || !existsSync(target)) {
  console.error('[verify-providers] 用法：node scripts/verify-runtime-providers.mjs <staging 目录 | kcoder-runtime.tar.gz>')
  process.exit(2)
}
const targetPath = resolve(target)
const isTar = statSync(targetPath).isFile()

/** tar 成员名 → 真实成员名（归档里可能带 `./` 前缀）。惰性构建。 */
let tarIndex = null
function tarMemberNames() {
  if (tarIndex !== null) return tarIndex
  tarIndex = new Map()
  try {
    const out = execFileSync('tar', ['-tzf', targetPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    for (const line of out.split('\n')) {
      const entry = line.trim()
      if (entry === '') continue
      tarIndex.set(entry.replace(/^\.\//, ''), entry)
    }
  } catch { /* 交给调用方报「读不到」 */ }
  return tarIndex
}

/** 读目标里的一个文件：目录直接读，tar 用 `tar -xzOf` 单成员解出。 */
function readMember(member) {
  if (!isTar) {
    const p = join(targetPath, member)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  // tar 成员名恒用 `/`（Windows 上 join() 给的是 `\`，必须换算后再查表）
  const entry = tarMemberNames().get(member.replace(/\\/g, '/').replace(/^\.\//, ''))
  if (entry === undefined) return null
  try {
    return execFileSync('tar', ['-xzOf', targetPath, entry], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return null
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const names = providerPackages()
const problems = []

const manifestText = readMember('package.json')
const manifest = manifestText === null ? null : parseJson(manifestText)
if (manifest === null) {
  console.error(`[verify-providers] 读不到引擎清单（package.json）：${targetPath}`)
  process.exit(1)
}
const declared = manifest.dependencies ?? {}

for (const name of names) {
  const want = declared[name]
  if (want === undefined) {
    problems.push(`${name} 未登记进引擎清单 dependencies`)
    continue
  }
  const entityText = readMember(join('node_modules', name, 'package.json'))
  const entity = entityText === null ? null : parseJson(entityText)
  if (entity === null) {
    problems.push(`${name}@${want} 实体不在产物里（node_modules/${name}/package.json 缺失）`)
    continue
  }
  if (entity.version !== want) {
    problems.push(`${name} 版本不一致：清单 ${want} / 实体 ${String(entity.version)}`)
  }
}

if (problems.length > 0) {
  console.error(`[verify-providers] 内置 provider 未随包到位（${problems.length} 处）：\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`[verify-providers] 内置 provider 全部随包在位（${String(names.length)} 个：${names.join(', ')}）`)
