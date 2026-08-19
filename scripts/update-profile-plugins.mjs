#!/usr/bin/env node
/**
 * Profile 插件同步与上游更新脚本（KCoder 发布物 ↔ 用户 DSH profile）。
 *
 * dsh-plugin-genui 有两个上游缺陷（npm 最新版同样存在），由仓库内
 * profiles/web/patches/dsh-plugin-genui@0.12.2.patch 修复：
 *   1. client.js 的 settings.plugin.item 卡片注册漏传 key（缺 key 的
 *      keyed slot 在 boot 时抛错）
 *   2. node half 从不注册 settings namespace（settings.describe 列表
 *      无 genui-design → 设置 > 插件 > 插件配置 永不渲染该卡片）
 *
 * 补丁通过 pnpm patchedDependencies（name-only 声明）固化在 profile：
 *   - 上游任意版本安装/升级时 pnpm 都会尝试应用；应用失败静默跳过
 *     （插件裸装，keyed slot 报错横幅提示需更新 patch）——因此上游发
 *     版后直接 `pnpm update dsh-plugin-genui` 即可自动跟随
 *   - 依赖声明 ^0.12.2 本就允许 minor/patch 自动升级
 *
 * 用法：
 *   node scripts/update-profile-plugins.mjs --sync    同步仓库 patch 到 profile 并 pnpm install（默认）
 *   node scripts/update-profile-plugins.mjs --update  检查 npm 上游版本并 pnpm update dsh-plugin-genui
 *   node scripts/update-profile-plugins.mjs --check   只打印本地/上游版本对比，不写任何文件
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = resolveRepoRoot()
const PROFILE = process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles/web') : join(homedir(), '.kcoder/profiles/web')
const PATCH_NAME = 'dsh-plugin-genui@0.12.2.patch'
const PATCH_SRC = join(ROOT, 'profiles/web/patches', PATCH_NAME)
const PATCH_DST = join(PROFILE, 'patches', PATCH_NAME)
const WORKSPACE_YAML = join(PROFILE, 'pnpm-workspace.yaml')

function resolveRepoRoot() {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..')
}

function say(msg) {
  console.log(`\x1b[34m[plugins]\x1b[0m ${msg}`)
}
function die(msg) {
  console.error(`\x1b[31m[plugins] 错误：\x1b[0m ${msg}`)
  process.exit(1)
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' })
}

function localVersion() {
  const pkg = join(PROFILE, 'node_modules/dsh-plugin-genui/package.json')
  if (!existsSync(pkg)) return undefined
  return JSON.parse(readFileSync(pkg, 'utf8')).version
}

function latestVersion() {
  const out = run('npm', ['view', 'dsh-plugin-genui', 'version'], ROOT)
  return out.trim()
}

function patchApplied() {
  const client = join(PROFILE, 'node_modules/dsh-plugin-genui/lib/client.js')
  const host = join(PROFILE, 'node_modules/dsh-plugin-genui/lib/index.js')
  const okKey = existsSync(client) && readFileSync(client, 'utf8').includes('key: "genui-design"')
  const okNs = existsSync(host) && readFileSync(host, 'utf8').includes('ctx.settings.register("genui-design"')
  return { okKey, okNs }
}

/** 幂等声明 patchedDependencies（name-only），已存在则跳过。 */
function ensurePatchDeclared() {
  if (!existsSync(WORKSPACE_YAML)) die(`profile workspace 不存在：${WORKSPACE_YAML}`)
  const yaml = readFileSync(WORKSPACE_YAML, 'utf8')
  if (yaml.includes('dsh-plugin-genui:')) {
    say('patchedDependencies 已声明（name-only），跳过写入')
    return
  }
  const block = `patchedDependencies:
  # name-only：上游任意版本都尝试应用；应用失败时 pnpm 静默跳过（插件裸装，
  # keyed slot 报错横幅会提示需要更新 patch）。
  dsh-plugin-genui: patches/${PATCH_NAME}
`
  const anchor = 'nodeLinker: hoisted\n'
  if (!yaml.includes(anchor)) die('pnpm-workspace.yaml 缺少 nodeLinker: hoisted 锚点，无法定位插入')
  writeFileSync(WORKSPACE_YAML, yaml.replace(anchor, anchor + block))
  say('patchedDependencies 声明已写入 pnpm-workspace.yaml')
}

function syncPatch() {
  if (!existsSync(PATCH_SRC)) die(`仓库 patch 缺失：${PATCH_SRC}`)
  mkdirSync(dirname(PATCH_DST), { recursive: true })
  copyFileSync(PATCH_SRC, PATCH_DST)
  say(`patch 已同步：${PATCH_DST}`)
  ensurePatchDeclared()
  say('执行 pnpm install 应用补丁 …')
  run('pnpm', ['install'], PROFILE)
}

function updatePlugin() {
  const current = localVersion()
  const latest = latestVersion()
  say(`本地 v${current ?? '未安装'} → npm 上游 v${latest}`)
  if (current === latest) {
    say('已是最新版本，无需更新')
    return
  }
  say(`升级到 v${latest} …`)
  run('pnpm', ['update', 'dsh-plugin-genui'], PROFILE)
}

function verify() {
  const { okKey, okNs } = patchApplied()
  say(`补丁校验：client key ${okKey ? '✓' : '✗（裸装）'}，host namespace ${okNs ? '✓' : '✗（裸装）'}`)
  if (!okKey || !okNs) {
    console.warn('  提示：上游若已修复对应缺陷，patch 上下文不匹配被静默跳过属正常；')
    console.warn('  若上游仍未修复，则需更新 profiles/web/patches/ 下的 patch 后重跑 --sync。')
  }
}

const mode = process.argv[2] ?? '--sync'
switch (mode) {
  case '--check':
    say(`本地 v${localVersion() ?? '未安装'}，npm 上游 v${latestVersion()}`)
    verify()
    break
  case '--update':
    ensurePatchDeclared()
    updatePlugin()
    verify()
    break
  case '--sync':
    syncPatch()
    verify()
    break
  default:
    die(`未知模式 ${mode}（可用：--sync / --update / --check）`)
}
