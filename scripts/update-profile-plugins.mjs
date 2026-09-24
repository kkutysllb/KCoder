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
 * - dsh-context：0.55 轮尾「在上下文视图中查看此轮」jump 先试
 *   sidebarRight.openTab 展开原生右栏列，本产品布局下呈现大片空白且与
 *   标题栏「上下文」按钮不一致 → 改为一律走会话内 tab（activateContextTab），
 *   openContextSidebar 整函数摘除
 *   两条修复合并分发在 dsh-context@0.55.0.patch 一份 patch 里（同包两条
 *   marks：kcRoHits / kcCtxJumpViaTab，锄点各自独立）。早前单独承载 RO
 *   冷却的 dsh-context@0.38.2.patch 已退役——0.55.0 patch 与 kcRoHits
 *   锄点都已含该修复，留着只会每次核对报一条无意义的版本漂移待办
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
 *   node scripts/update-profile-plugins.mjs --release-gate  发版闸（只读，不过即 exit 1；
 *                                                      release.sh 的 build/prepush/ship 调用）
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = resolveRepoRoot()
/** 补丁分发目录（唯一事实源）：清单由扫描得出，新增/退役补丁无需改本脚本，
 *  发版闸（--release-gate）也随之自动覆盖。 */
const PATCH_SRC_DIR = join(ROOT, 'profiles/web/patches')
/** 仓库侧分发清单（*.patch 文件名）。 */
const PATCHES = existsSync(PATCH_SRC_DIR)
  ? readdirSync(PATCH_SRC_DIR).filter((f) => f.endsWith('.patch')).sort()
  : []
/** 目标 profile：显式 DSH_HOME 优先，否则 KCoder 自有 home，再退上游默认。 */
const PROFILE = resolveProfile()

function resolveProfile() {
  if (process.env.DSH_HOME) return join(process.env.DSH_HOME, 'profiles/web')
  const kcoder = join(homedir(), '.kcoder', 'profiles', 'web')
  if (existsSync(kcoder)) return kcoder
  return join(homedir(), '.dsh', 'profiles', 'web')
}

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
  // dsh-context：两条独立修复，marks 全中才算生效（任一缺失 → 锄点注入，
  // 与 desktop/main/profile-patches.ts 同步更新）
  // 1) RO 回路冷却（Windows 打开上下文冻结白屏）
  // 2) 轮尾 jump 改走会话内 tab，不再展开原生右栏（布局大片空白）
  'dsh-context': [['lib/client.js', 'kcRoHits'], ['lib/client.js', 'kcCtxJumpViaTab']],
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
    const re = new RegExp(`(${a.marker}\\s*=\\s*")([^"]+)(")`, 'g')
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

/** 补丁与实装版本门控：patch 按特定版本产物字节生成，版本漂移后 hunk 必然
 *  失配（pnpm 判 unused 不应用）——**只用于报告「该 patch 本轮没被应用、
 *  修复靠锄点注入兜着」的发版待办（stalePatches / --release-gate），不参与
 *  生效判定**（生效判定见 patchApplied：只看 PATCH_MARKS，不看门控）。
 *  @x 后缀不设门。desktop 侧同名函数已随门控空洞修复摘除（2026-09-24），
 *  本脚本是唯一实现。 */
function patchVersionMatches(patchFile, modDir) {
  const m = /@([^@]+)\.patch$/.exec(patchFile)
  if (m === null || m[1] === 'x') return true
  try {
    return JSON.parse(readFileSync(join(modDir, 'package.json'), 'utf8')).version === m[1]
  } catch {
    return true
  }
}

/**
 * 生效核对：只按 PATCH_MARKS + 实装目录判，**不看版本门控**。
 * 门控只决定「pnpm 会不会应用 patch」，与「修复在不在产物里」是两件事：
 * 版本键漂移时 pnpm 判 unused 跳过，但 app 启动的锄点注入与版本键无关、
 * 照样落位——此时若按门控 skip 就会恒真报「全部生效」，把真缺口藏起来
 * （9-14 现场教训）。这里如实报 mark，缺了就是缺了，补丁链据此重出 patch。
 */
function patchApplied() {
  const missing = []
  for (const pkg of Object.keys(PATCH_MARKS)) {
    const modDir = join(PROFILE, 'node_modules', pkg)
    if (!existsSync(modDir)) continue // 未安装：后续安装时 pnpm 自动应用
    for (const [rel, mark] of PATCH_MARKS[pkg]) {
      const file = join(modDir, rel)
      if (!existsSync(file) || !readFileSync(file, 'utf8').replace(/\r\n/g, '\n').includes(mark)) {
        missing.push(`${pkg}/${rel}`)
      }
    }
  }
  return missing
}

/**
 * 精确版本键与实装版本不符的补丁（pnpm 判 unused 不应用）。这些补丁的
 * 修复此刻只靠 app 侧锄点注入兜着——**每次插件升版都必须走一遍
 * --sync/--check**：mark 仍在 → 锄点已落位，等下次发版把 patch 重出到
 * 新版本键（锄点按字节锚、版本无关）；mark 缺 → 该版本产物字节变了，
 * 锄点也没锚中，必须立即重出 patch 并提交，否则随包分发物化不出修复。
 */
function stalePatches() {
  return PATCHES.filter((f) => {
    const modDir = join(PROFILE, 'node_modules', pkgNameOf(f))
    return existsSync(modDir) && !patchVersionMatches(f, modDir)
  })
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

/**
 * 生效核对（--sync/--update/--check 跑完都走一遍，是「随版本发布物化」的
 * 哨口）：
 * 1) patchApplied（不看门控）判修复在不在产物里——缺一个 mark 就算缺；
 * 2) stalePatches 单独报「精确版本键已漂移、pnpm 这轮没应用」的补丁：
 *    它们的修复此刻只靠 app 启动的锄点注入兜着，patch 文件需要重出到新
 *    版本键（锄点按字节锚、版本无关，通常 mark 仍在位）；
 * 3) 两者交叉决定提示：mark 在位 + 版本漂移 = 重出 patch（发版动作，不
 *    阻塞）；mark 缺失 = 锄点也没锚中，必须立即重出并提交，否则新装用户
 *    拿不到修复。
 */
function verify() {
  const missing = patchApplied()
  const stale = stalePatches()
  if (stale.length > 0) {
    say(`补丁版本键漂移（pnpm 本轮判 unused 未应用，修复由锄点注入兜底）：${stale.join('、')}`)
  }
  if (missing.length === 0) {
    if (stale.length > 0) {
      say('补丁校验：修复全部在产物里 ✓（marks 在位）')
      console.warn('  待办（发版前）：把上述 patch 重出到当前实装版本键，使 pnpm 路径也生效——')
      console.warn('  逐 hunk 对当前产物取证后改名（profiles/web/patches/ → @<实装版本>.patch），')
      console.warn('  同步 PATCHES 清单，再跑一次 --check 确认零漂移。')
      return
    }
    say('补丁校验：全部生效 ✓')
    return
  }
  for (const m of missing) console.warn(`  补丁未生效：${m}`)
  if (stale.length > 0) {
    console.warn('  其中含版本键漂移的补丁：锄点注入也没锚中 → 该版本产物字节已变；')
    console.warn('  必须立即重出 patch（对当前产物取证）并提交，否则随包分发的物化拿不到修复。')
    return
  }
  console.warn('  提示：上游若已修复对应缺陷，patch 上下文不匹配被静默跳过属正常——')
  console.warn('  此时应把该缺陷补丁线整线退役（补丁文件 + PATCH_MARKS + PATCH_FALLBACKS 一并摘）；')
  console.warn('  若上游仍未修复，则需重出 profiles/web/patches/ 下的 patch 后重跑 --sync。')
}

/**
 * 发版闸（--release-gate，由 release.sh 的 build/prepush/ship 调用）：只读
 * 校验，任一不过即 exit 1。拦住四类会让「补丁随版本物化」断供的现场：
 *
 * 1. **分发目录存在**（release.sh 另有包内逐文件对账，这里是构建前更早的一道）；
 * 2. **实装产物有修复**：PATCH_MARKS 全中（不看版本门控）——缺 mark 说明
 *    连锄点注入都没锚中，新装用户拿不到修复；
 * 3. **无版本键漂移**：patch 文件名版本 == 实装版本。漂移本身不影响修复
 *    （锄点兜着），但意味着这次发版没把 patch 重出到实装版本键，pnpm 路径
 *    是哑的——属于发版作业漏做，拒绝；
 * 4. **声明就位**：每份 patch 在 profile 的 patchedDependencies 里有对应
 *    精确键。没有 profile（CI/干净机器）时 2~4 降级为警告：这些是「现场
 *    物化」的判据，仓库侧（1）仍强制。
 */
function releaseGate() {
  const problems = []
  if (PATCHES.length === 0) problems.push(`分发补丁清单为空（${PATCH_SRC_DIR} 下无 *.patch）`)

  const profileReady = existsSync(WORKSPACE_YAML) && existsSync(join(PROFILE, 'node_modules'))
  if (!profileReady) {
    if (problems.length > 0) {
      for (const p of problems) console.error(`  补丁闸未过：${p}`)
      process.exit(1)
    }
    console.warn(`[plugins] 补丁闸：未发现 profile（${PROFILE}）——现场物化判据降级为警告，仅校验仓库侧分发 ✓`)
    return
  }

  // 2) 修复在不在产物里（不看门控）
  for (const m of patchApplied()) problems.push(`修复未落位（marks 缺失）：${m} → 锄点锚点已失配，必须重出 patch`)
  // 3) 版本键漂移
  for (const f of stalePatches()) {
    const v = localVersion(pkgNameOf(f)) ?? '未安装'
    problems.push(`版本键漂移：${f} 对应实装 v${v} → 发版前必须把该 patch 重出到当前版本键（对产物逐 hunk 取证后改名 + 同步分发清单）`)
  }
  // 4) patchedDependencies 声明
  let yaml = ''
  try {
    yaml = readFileSync(WORKSPACE_YAML, 'utf8')
  } catch {
    problems.push(`patchedDependencies 不可读：${WORKSPACE_YAML}`)
  }
  for (const f of PATCHES) {
    const vm = /@([^@]+)\.patch$/.exec(f)
    const pkg = pkgNameOf(f)
    const key = vm === null || vm[1] === 'x' ? pkg : `${pkg}@${vm[1]}`
    const line = new RegExp(String.raw`^\s*'?${key.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)}'?\s*:\s*patches/`, 'm')
    if (!line.test(yaml)) problems.push(`patchedDependencies 缺声明：${key} → patches/${f}`)
  }
  // 同包多版本键会让 pnpm 拒解析整份 workspace.yaml（v0.2.9 老代码的重复行现场）。
  // 注意键须含 `@`：否则 `pkg` 的正则会前缀命中 `pkg-other@x`。
  for (const pkg of new Set(PATCHES.map(pkgNameOf))) {
    const re = new RegExp(
      String.raw`^\s*'?(?:${pkg.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)}(?:@[^':\s]+)?|@[^'/]+/${pkg.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)}@[^':\s]+)'?\s*:\s*patches/(\S+)`,
      'gm',
    )
    const keys = [...yaml.matchAll(re)].map((m) => m[1])
    if (keys.length > 1) {
      problems.push(`patchedDependencies 同包多版本键（pnpm 会拒解析）：${keys.join('、')} → 同包只保留当前实装版本那一条`)
    }
  }

  if (problems.length > 0) {
    console.error(`[plugins] 补丁闸未过（${problems.length} 项）——发布中断：`)
    for (const p of problems) console.error(`  ✗ ${p}`)
    console.error('  逐条处置后重跑：node scripts/update-profile-plugins.mjs --check')
    process.exit(1)
  }
  console.log(`[plugins] 补丁闸通过 ✓（${PATCHES.length} 份 patch：仓库分发 + 现场 marks + 版本键零漂移 + 声明就位）`)
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
  case '--release-gate':
    releaseGate()
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
    die(`未知模式 ${mode}（可用：--sync / --update / --check / --align / --release-gate）`)
}
