#!/usr/bin/env node
/**
 * 实验性组合包随包断言：构建出的引擎运行时必须真的带上上游全部实验性 bundle。
 *
 * 为什么单独有这道闸（2026-10-09 产品决策「上游实验性功能一律随 KCoder 发版」）：
 * 这些包**不属于上游依赖图**（`pnpm deploy --prod` 不会带上），由
 * `scripts/materialize-peers.mjs` 的实验供给块主动补进 staging。供给代码一旦被
 * 误删或打回，产物本身不报错——用户侧表现为「profile 声明了这些 bundle，但引擎
 * 解析不到实体」：轻则该能力静默不可用，重则启动即崩（声明跟随实态的前提）。
 * 与 verify-runtime-providers.mjs 同族的「随包物必须在产物里」断言，离线可跑
 * （不需要 registry）。
 *
 * 清单不在这里重复维护——直接从 `materialize-peers.mjs` 里解析
 * `EXPERIMENTAL_BUNDLE_PACKAGES` 字面量（仓内既有约定：verify-runtime-providers
 * 同样文本解析 `PROVIDER_PACKAGES`）。
 *
 * 对每个 bundle 断言三件事：引擎清单里有且版本一致、实体在包里、实体自己的
 * version 与声明一致；并额外断言每个 bundle 的行包（`dependencies`）在产物里
 * 可达——行包缺失正是「闭包补齐」这步存在的理由。
 *
 * 用法：
 *   node scripts/verify-runtime-experimental.mjs staging/kcoder-runtime
 *   node scripts/verify-runtime-experimental.mjs staging/kcoder-runtime.tar.gz
 *
 * @module scripts/verify-runtime-experimental
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(join(fileURLToPath(import.meta.url), '..', '..'))

/** 从 materialize-peers.mjs 解析 EXPERIMENTAL_BUNDLE_PACKAGES 字面量。 */
function experimentalBundles() {
  const src = readFileSync(join(root, 'scripts', 'materialize-peers.mjs'), 'utf8')
  const start = src.indexOf('const EXPERIMENTAL_BUNDLE_PACKAGES = [')
  if (start < 0) throw new Error('materialize-peers.mjs 里找不到 EXPERIMENTAL_BUNDLE_PACKAGES')
  const end = src.indexOf(']', start)
  if (end < 0) throw new Error('EXPERIMENTAL_BUNDLE_PACKAGES 数组未闭合')
  const names = [...src.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1])
  if (names.length === 0) throw new Error('EXPERIMENTAL_BUNDLE_PACKAGES 解析为空')
  return names
}

const target = process.argv[2]
if (target === undefined || !existsSync(target)) {
  console.error('[verify-experimental] 用法：node scripts/verify-runtime-experimental.mjs <staging 目录 | kcoder-runtime.tar.gz>')
  process.exit(2)
}
const targetPath = resolve(target)
const isTar = statSync(targetPath).isFile()
// tar 一律用「切到归档所在目录 + 基名」调用（Windows 带盘符的绝对路径会被 GNU tar
// 当远端主机，见 verify-runtime-providers.mjs 的同款注释）。
const tarCwd = isTar ? dirname(targetPath) : undefined
const tarName = isTar ? basename(targetPath) : undefined

let tarIndex = null
function tarMemberNames() {
  if (tarIndex !== null) return tarIndex
  tarIndex = new Map()
  try {
    const out = execFileSync('tar', ['-tzf', tarName], { cwd: tarCwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    for (const line of out.split('\n')) {
      const entry = line.trim()
      if (entry === '') continue
      tarIndex.set(entry.replace(/^\.\//, ''), entry)
    }
  } catch { /* 交给调用方报「读不到」 */ }
  return tarIndex
}

function readMember(member) {
  if (!isTar) {
    const p = join(targetPath, member)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  const entry = tarMemberNames().get(member.replace(/\\/g, '/').replace(/^\.\//, ''))
  if (entry === undefined) return null
  try {
    return execFileSync('tar', ['-xzOf', tarName, entry], { cwd: tarCwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
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

const names = experimentalBundles()
const problems = []

const manifestText = readMember('package.json')
const manifest = manifestText === null ? null : parseJson(manifestText)
if (manifest === null) {
  console.error(`[verify-experimental] 读不到引擎清单（package.json）：${targetPath}`)
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
  // 行包可达：bundle 的 cordis.patch.yml 里 name: 都必须在产物里能解析到
  // （展开 undefined 本就是空对象，故不需要 `?? {}` 兜底——去掉以过 lint）
  const rowDeps = { ...entity.dependencies, ...entity.peerDependencies }
  for (const dep of Object.keys(rowDeps)) {
    if (!dep.startsWith('@deepseek-ai/')) continue
    if (readMember(join('node_modules', dep, 'package.json')) === null) {
      problems.push(`${name} 的行包 ${dep} 不在产物里（闭包补齐漏步）`)
    }
  }
}

if (problems.length > 0) {
  console.error(`[verify-experimental] 实验性组合包未随包到位（${problems.length} 处）：\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`[verify-experimental] 实验性组合包全部随包在位（${String(names.length)} 个：${names.join(', ')}）`)
