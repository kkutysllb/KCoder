#!/usr/bin/env node
/**
 * Profile 插件同步与上游更新脚本（KCoder 发布物 ↔ 用户 DSH profile）。
 *
 * 已覆盖插件缺陷补丁（profiles/web/patches/*.patch）：
 * - @dsh-external/dsh-drag-to-attachment：wrap 的 sendSession 附件分支
 *   发送成功后无 return（resolve undefined）——rc.8 提交事务硬化后
 *   settleSubmit 读 undefined.kind 炸 TypeError，machine 卡 submitting，
 *   带附件/图片发送后输入框永久锁死。补丁补一行 return（github 源插件，
 *   不在 npm，update 模式自动跳过）
 * - dsh-plugin-genui：卡片注册漏传 key + node half 不注册 settings
 *   namespace 两个上游缺陷（npm 最新版同样存在）
 * - dsh-context：node half 缓存失败缺陷（projection 状态残留），修复版
 *   与 npm 原版快照归档于 .patches/dsh-context-fix 与 .patches/dsh-context
 *
 * 补丁通过 pnpm patchedDependencies（name-only 声明）固化在 profile：
 *   - 上游任意版本安装/升级时 pnpm 都会尝试应用；应用失败静默跳过
 *     （插件裸装，keyed slot 报错横幅提示需更新 patch）——因此上游发
 *     版后直接 `pnpm update <pkg>` 即可自动跟随
 *   - 依赖声明 ^0.12.x 本就允许 minor/patch 自动升级
 *
 * 用法：
 *   node scripts/update-profile-plugins.mjs --sync    同步仓库 patch 到 profile 并 pnpm install（默认）
 *   node scripts/update-profile-plugins.mjs --update  检查 npm 上游版本并 pnpm update 全部插件
 *   node scripts/update-profile-plugins.mjs --check   只打印本地/上游版本对比，不写任何文件
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = resolveRepoRoot()
const PROFILE = process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles/web') : join(homedir(), '.kcoder/profiles/web')
const PATCHES = [
  'dsh-plugin-genui@0.12.2.patch',
  'dsh-context@0.12.1.patch',
  '@dsh-external__dsh-drag-to-attachment@1.0.3.patch',
]
const WORKSPACE_YAML = join(PROFILE, 'pnpm-workspace.yaml')

/** 从 patch 文件名提取包名（scoped 包的 `@scope__name` 还原为 `@scope/name`）。
 *  与 desktop/main/profile-patches.ts 的 pkgNameOf 保持一致。 */
function pkgNameOf(patchFile) {
  return patchFile.replace(/@[^@]+\.patch$/, '').replace(/^(@[^/]*?)__/, '$1/')
}

/** YAML 声明键：`@` 是 YAML 保留指示符，scoped 包名单引号包裹。 */
function yamlKeyOf(pkg) {
  return pkg.startsWith('@') ? `'${pkg}'` : pkg
}

/** 各插件补丁生效特征（与 desktop/main/profile-patches.ts 保持一致）。 */
const PATCH_MARKS = {
  '@dsh-external/dsh-drag-to-attachment': [
    ['lib/client.js', "clearFiles()\n        return { kind: 'success' }"],
  ],
  'dsh-plugin-genui': [
    ['lib/client.js', 'key: "genui-design"'],
    ['lib/index.js', 'ctx.settings.register("genui-design"'],
    ['lib/index.js', '"agents",\n\t"settings"'],
  ],
  'dsh-context': [['lib/index.js', 'delete st.pendingShadowedSeqs']],
}

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

function localVersion(pkg) {
  const p = join(PROFILE, `node_modules/${pkg}/package.json`)
  if (!existsSync(p)) return undefined
  return JSON.parse(readFileSync(p, 'utf8')).version
}

function latestVersion(pkg) {
  try {
    const out = run('npm', ['view', pkg, 'version'], ROOT)
    return out.trim()
  } catch {
    return undefined // github 源插件不在 npm（如 drag-to-attachment）
  }
}

/** 返回未生效的特征（{pkg}/{file} 列表）；空数组 = 全部生效。 */
function patchApplied() {
  const missing = []
  for (const f of PATCHES) {
    const pkg = pkgNameOf(f)
    const marks = PATCH_MARKS[pkg]
    if (!marks) continue
    for (const [rel, mark] of marks) {
      const file = join(PROFILE, 'node_modules', pkg, rel)
      if (!existsSync(file) || !readFileSync(file, 'utf8').includes(mark)) missing.push(`${pkg}/${rel}`)
    }
  }
  return missing
}

/** 幂等声明 patchedDependencies（name-only），缺失条目逐条补写。 */
function ensurePatchDeclared() {
  if (!existsSync(WORKSPACE_YAML)) die(`profile workspace 不存在：${WORKSPACE_YAML}`)
  let yaml = readFileSync(WORKSPACE_YAML, 'utf8')
  const missing = PATCHES.filter((f) => !yaml.includes(`\n  ${yamlKeyOf(pkgNameOf(f))}: patches/`))
  if (missing.length === 0) {
    say('patchedDependencies 已全部声明（name-only），跳过写入')
    return
  }
  const entries = missing.map((f) => `  ${yamlKeyOf(pkgNameOf(f))}: patches/${f}`).join('\n')
  const m = yaml.match(/^patchedDependencies:\n(?:[ \t].*\n?)*/m)
  if (m) {
    // 已有块：新条目追加到块尾（replace 避免 m[0] 与文件头的偏移错位）
    yaml = yaml.replace(m[0], `${m[0]}${entries}\n`)
  } else {
    const anchor = 'nodeLinker: hoisted\n'
    if (!yaml.includes(anchor)) die('pnpm-workspace.yaml 缺少 nodeLinker: hoisted 锚点，无法定位插入')
    const block = `patchedDependencies:
  # name-only：上游任意版本都尝试应用；应用失败时 pnpm 静默跳过（插件裸装，
  # keyed slot 报错横幅会提示需要更新 patch）。
${entries}
`
    yaml = yaml.replace(anchor, anchor + block)
  }
  writeFileSync(WORKSPACE_YAML, yaml)
  say(`patchedDependencies 声明已补写（${missing.join(', ')}）`)
}

function syncPatch() {
  for (const name of PATCHES) {
    const src = join(ROOT, 'profiles/web/patches', name)
    if (!existsSync(src)) die(`仓库 patch 缺失：${src}`)
    mkdirSync(join(PROFILE, 'patches'), { recursive: true })
    copyFileSync(src, join(PROFILE, 'patches', name))
    say(`patch 已同步：${name}`)
  }
  ensurePatchDeclared()
  say('执行 pnpm install 应用补丁 …')
  run('pnpm', ['install'], PROFILE)
}

function updatePlugin() {
  for (const pkg of PATCHES.map(pkgNameOf)) {
    const current = localVersion(pkg)
    const latest = latestVersion(pkg)
    if (latest === undefined) {
      say(`${pkg}：本地 v${current ?? '未安装'}，不在 npm（github 源），跳过 update`)
      continue
    }
    say(`${pkg}：本地 v${current ?? '未安装'} → npm 上游 v${latest}`)
    if (current === latest) {
      say(`${pkg} 已是最新版本，无需更新`)
      continue
    }
    say(`升级 ${pkg} 到 v${latest} …`)
    run('pnpm', ['update', pkg], PROFILE)
  }
}

function verify() {
  const missing = patchApplied()
  if (missing.length === 0) {
    say('补丁校验：全部生效 ✓')
    return
  }
  for (const m of missing) console.warn(`  补丁未生效：${m}`)
  console.warn('  提示：上游若已修复对应缺陷，patch 上下文不匹配被静默跳过属正常；')
  console.warn('  若上游仍未修复，则需更新 profiles/web/patches/ 下的 patch 后重跑 --sync。')
}

const mode = process.argv[2] ?? '--sync'
switch (mode) {
  case '--check':
    for (const pkg of PATCHES.map(pkgNameOf)) {
      const latest = latestVersion(pkg)
      say(`${pkg}：本地 v${localVersion(pkg) ?? '未安装'}，npm 上游 v${latest ?? '不在 npm（github 源）'}`)
    }
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
