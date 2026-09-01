#!/usr/bin/env node
/**
 * Profile 插件同步与上游更新脚本（KCoder 发布物 ↔ 用户 DSH profile）。
 *
 * 已覆盖插件缺陷补丁（profiles/web/patches/*.patch）：
 * - @dsh-external/dsh-drag-to-attachment（2026-09-01 退役，历史记录）：
 *   曾补两处缺陷（rc.8 wrap sendSession 附件分支漏 return 致输入框
 *   锁死；Everything.exe 恒缺时 spawn ENOENT 无 error 监听崩 dsh）。
 *   插件整线退役后补丁摘除，现场文件与声明由自愈链回收
 *   （见 profile-patches.ts RETIRED_PATCH_PKGS / preset-plugins.ts
 *   RETIRED_PRESETS）
 * - dsh-context：0.38 的 agents 森林图 stage 以 ResizeObserver 驱动
 *   量化布局，Windows DPI 取整/经典滚动条占位下尺寸振荡不收敛，渲染
 *   失控吃满主线程直至白屏（打开上下文即冻结的根因；mac 天然收敛）。
 *   补丁加回路冷却（500ms 超 12 次触发即静默 1s，断振荡不永久失效）
 *
 * 补丁通过 pnpm patchedDependencies 固化在 profile：精确版本键
 *   （name@ver）只对匹配版本应用；版本漂移时声明“未用”由
 *   allowUnusedPatches 容忍（pnpm 11 对失配补丁是硬错误
 *   ERR_PNPM_PATCH_FAILED，内置运行时 vendored 的就是 11）——因此
 *   上游发版后直接 `pnpm update <pkg>` 即可自动跟随
 *   - 依赖声明 ^0.12.x 本就允许 minor/patch 自动升级
 *
 * 用法：
 *   node scripts/update-profile-plugins.mjs --sync    同步仓库 patch 到 profile 并 pnpm install（默认）
 *   node scripts/update-profile-plugins.mjs --update  检查 npm 上游版本并 pnpm update 全部插件
 *   node scripts/update-profile-plugins.mjs --check   只打印本地/上游版本对比，不写任何文件
 *   node scripts/update-profile-plugins.mjs --align   只执行内置产物版本对齐（见 VERSION_ALIGNS）
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = resolveRepoRoot()
const PROFILE = process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles/web') : join(homedir(), '.dsh/profiles/web')
const PATCHES = [
  'dsh-video-preview@0.1.1.patch',
  'dsh-context@0.38.2.patch',
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
  // dsh-context RO 回路冷却特征（Windows 打开上下文冻结白屏修复；与
  // desktop/main/profile-patches.ts 同步更新）
  'dsh-context': [['lib/client.js', 'kcRoHits']],
}

/**
 * 收编物化后的版本对齐清单：上游产物内硬编码的服务版本常量与包
 * package.json 版本不一致（作者 bump 版本时漏改常量或未重建提交进仓的
 * lib/），而设置 UI 的版本 chip 读的正是常量 → 显示落后于实装版本。
 * 以包 package.json 为权威，物化后幂等改写；上游未来改从 package.json
 * 读版本或自行修正后，marker 不再命中、对齐自动变空操作。
 */
const VERSION_ALIGNS = [
  {
    pkg: 'dsh-coding-sidebar',
    // 兜底对账：1.0.0 起产物常量已由 tsdown define 从 package.json
    // version 构建期注入（单一事实源），正常发布链不再脱节；保留以
    // 覆盖手工替换 bundle 物料等旁路（「侧边卡片」设置分区头部 chip
    // 显示版本的来源）
    files: ['lib/client.js', 'lib/client-registry.js'],
    marker: 'SIDEBAR_SERVICE_VERSION',
  },
]

/** 对齐产物内硬编码版本常量到包版本。原地 write 会透过 pnpm store 硬链接
 *  污染 store 正本，必须 unlink 打断后写新 inode；上游修复后自动变空操作。 */
function alignVersions() {
  for (const a of VERSION_ALIGNS) {
    const dir = join(PROFILE, 'node_modules', a.pkg)
    const pkgJson = join(dir, 'package.json')
    if (!existsSync(pkgJson)) {
      say(`${a.pkg}：未安装，跳过版本对齐`)
      continue
    }
    const version = JSON.parse(readFileSync(pkgJson, 'utf8')).version
    const re = new RegExp(`(${a.marker}\\s*=\\s*\")([^\"]+)(\")`, 'g')
    let touched = false
    for (const rel of a.files) {
      const f = join(dir, rel)
      if (!existsSync(f)) continue
      const src = readFileSync(f, 'utf8')
      const next = src.replace(re, (m, head, cur, tail) => (cur === version ? m : head + version + tail))
      if (next !== src) {
        unlinkSync(f)
        writeFileSync(f, next)
        touched = true
      }
    }
    say(touched
      ? `${a.pkg}：产物内 ${a.marker} 已对齐包版本 v${version}`
      : `${a.pkg}：产物版本已一致（v${version}）`)
  }
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
    return undefined // github 源插件不在 npm，无 latest 可查
  }
}

/** 补丁与实装版本门控（与 profile-patches.ts 的 patchVersionMatches 保持
 *  一致）：patch 按特定版本产物字节生成，版本漂移后 hunk 必然失配（pnpm
 *  WARN 跳过），视为不适用而非缺失；@x 后缀不设门。 */
function patchVersionMatches(patchFile, modDir) {
  const m = /@([^@]+)\.patch$/.exec(patchFile)
  if (m === null || m[1] === 'x') return true
  try {
    return JSON.parse(readFileSync(join(modDir, 'package.json'), 'utf8')).version === m[1]
  } catch {
    return true
  }
}

/** 返回未生效的特征（{pkg}/{file} 列表）；空数组 = 全部生效。与
 *  desktop/main/profile-patches.ts 的 patchApplied 保持一致：未安装的包
 *  跳过（后续安装时 pnpm 自动应用）；版本漂移的 patch 跳过（门控）；
 *  mark 匹配前行尾归一化为 LF（CRLF 产物——如已退役的
 *  drag-to-attachment v1.0.3 tarball——跨行 mark 按字节匹配恒失配）。 */
function patchApplied() {
  const missing = []
  for (const f of PATCHES) {
    const pkg = pkgNameOf(f)
    const marks = PATCH_MARKS[pkg]
    if (!marks) continue
    const modDir = join(PROFILE, 'node_modules', pkg)
    if (!existsSync(modDir)) continue
    if (!patchVersionMatches(f, modDir)) continue
    for (const [rel, mark] of marks) {
      const file = join(modDir, rel)
      if (!existsSync(file) || !readFileSync(file, 'utf8').replace(/\r\n/g, '\n').includes(mark)) {
        missing.push(`${pkg}/${rel}`)
      }
    }
  }
  return missing
}

/** 幂等声明 patchedDependencies，声明跟随 dependencies 实态（与
 *  desktop/main/profile-patches.ts 的 ensurePatchDeclared 同规则）：
 *  精确版本键（name@ver，@x 类 name-only）+ allowUnusedPatches 容忍；
 *  包不在 deps 时不声明且摘除已有声明（两种键形态都匹配）。 */
function ensurePatchDeclared() {
  if (!existsSync(WORKSPACE_YAML)) die(`profile workspace 不存在：${WORKSPACE_YAML}`)
  let yaml = readFileSync(WORKSPACE_YAML, 'utf8')
  let deps
  try {
    deps = new Set(Object.keys(JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8')).dependencies ?? {}))
  } catch {
    die(`profile package.json 不可读：${join(PROFILE, 'package.json')}`)
  }
  let changed = false
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`)
  // 该包的任意声明行：name-only 与 name@ver 两种键形态（scoped 带引号，
  // @ver 在引号内）
  const declLineOf = (pkg) =>
    new RegExp(String.raw`^  (?:'${escapeRe(pkg)}(?:@[^']+)?'|${escapeRe(pkg)}(?:@[^:\s'"]+)?)?: patches/[^\n]*\n?`, 'gm')
  // pnpm 11 语义配套：未用声明容忍（精确键漂移/摘除残留都不再报 ERR_PNPM_UNUSED_PATCH）
  if (!/^allowUnusedPatches:/m.test(yaml)) {
    const anchor = 'nodeLinker: hoisted\n'
    if (yaml.includes(anchor)) {
      yaml = yaml.replace(
        anchor,
        `${anchor}# KCoder：未用补丁声明容忍（精确版本键 + 实装版本漂移时声明未用不报错）\nallowUnusedPatches: true\n`,
      )
      changed = true
    }
  }
  for (const f of PATCHES) {
    const pkg = pkgNameOf(f)
    if (deps.has(pkg)) continue
    const next = yaml.replace(declLineOf(pkg), '')
    if (next !== yaml) {
      yaml = next
      changed = true
      say(`已摘除未用补丁声明（包不在 dependencies）：${pkg}`)
    }
  }
  const declKeyOf = (f) => {
    const pkg = pkgNameOf(f)
    const vm = /@([^@]+)\.patch$/.exec(f)
    return vm === null || vm[1] === 'x' ? pkg : `${pkg}@${vm[1]}`
  }
  // 键形态迁移：name-only → 精确版本键（@x 类除外）——老 profile（v0.2.9
  // 及之前）的 name-only 声明在 pnpm 11 下版本漂移即 PATCH_FAILED 硬错误；
  // 既有精确键时 name-only 是冗余（老代码误判追加的现场）直接摘除
  for (const f of PATCHES) {
    const pkg = pkgNameOf(f)
    const vm = /@([^@]+)\.patch$/.exec(f)
    if (vm === null || vm[1] === 'x' || !deps.has(pkg)) continue
    const nameOnly = new RegExp(String.raw`^  (?:'${escapeRe(pkg)}'|${escapeRe(pkg)}): patches/[^\n]*\n`, 'gm')
    if (!nameOnly.test(yaml)) continue
    const exact = new RegExp(String.raw`^  (?:'${escapeRe(pkg)}@[^']+'|${escapeRe(pkg)}@[^:\s'"]+): patches/`, 'm')
    // 老代码可反复追加同名 name-only 行：首处升级为精确键，其余摘除
    // （全局替换会把每一行都变成重复精确键，yaml 重复键 pnpm 拒解析）
    let upgraded = false
    yaml = exact.test(yaml)
      ? yaml.replace(nameOnly, '')
      : yaml.replace(nameOnly, () => {
          if (upgraded) return ''
          upgraded = true
          return `  ${yamlKeyOf(declKeyOf(f))}: patches/${f}\n`
        })
    changed = true
    say(`补丁声明键形态已规范（name-only → 精确键/摘除冗余）：${pkg}`)
  }
  const missing = PATCHES.filter((f) => deps.has(pkgNameOf(f)) && !declLineOf(pkgNameOf(f)).test(yaml))
  if (missing.length === 0 && !changed) {
    say('patchedDependencies 已同步（跟随 dependencies 实态），跳过写入')
    return
  }
  if (missing.length === 0) {
    writeFileSync(WORKSPACE_YAML, yaml)
    return
  }
  const entries = missing.map((f) => `  ${yamlKeyOf(declKeyOf(f))}: patches/${f}`).join('\n')
  const m = yaml.match(/^patchedDependencies:\n(?:[ \t].*\n?)*/m)
  if (m) {
    // 已有块：新条目追加到块尾（replace 避免 m[0] 与文件头的偏移错位）
    yaml = yaml.replace(m[0], `${m[0]}${entries}\n`)
  } else {
    const anchor = 'nodeLinker: hoisted\n'
    if (!yaml.includes(anchor)) die('pnpm-workspace.yaml 缺少 nodeLinker: hoisted 锚点，无法定位插入')
    const block = `patchedDependencies:
  # 精确版本键：只对匹配版本应用；版本漂移时声明未用由
  # allowUnusedPatches 容忍（pnpm 11 语义）。
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
    if (current === undefined) {
      say(`${pkg}：未安装（不在 dependencies），跳过 update`)
      continue
    }
    const latest = latestVersion(pkg)
    if (latest === undefined) {
      say(`${pkg}：本地 v${current}，不在 npm（github 源），跳过 update`)
      continue
    }
    say(`${pkg}：本地 v${current} → npm 上游 v${latest}`)
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
    alignVersions()
    verify()
    break
  case '--sync':
    syncPatch()
    alignVersions()
    verify()
    break
  case '--align':
    alignVersions()
    break
  default:
    die(`未知模式 ${mode}（可用：--sync / --update / --check / --align）`)
}
