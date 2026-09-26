#!/usr/bin/env node
/**
 * 内置插件「版本线」断言 —— `docs/plugin-dev-checklist.md` §2 与 §4 的执行点。
 *
 * 只读检查（不改任何东西），两条规则：
 *
 * ① **声明与物化同线**：`PRESET_PLUGINS[name]` 的下界必须等于
 *    `bundle/<dir>/package.json` 的版本。声明的职责是牵引新装 profile 的依赖树，
 *    所以它只能指向**已发布**版本；而实体终态由 `bundle/` 物化——两者不同线时，
 *    窗口期内会出现「声明旧版 + 实体新版」。
 *
 * ② **内容变更必须伴随版本变更**：自发版基线（上一个 `v*` tag）以来 `bundle/<dir>`
 *    若有**运行时面**的文件改动，该包版本必须与基线时不同。物化判据是
 *    `gt(srcVersion, dstVersion)`（`kcoder-skills-bundle.ts` 的 materialize）——
 *    版本不动 ⇒ **已装用户永远拿不到新内容**（新装用户能拿到，因为实体缺失即物化），
 *    而所有静态检查都是绿的。v0.6.17 现场：coding-sidebar 1.0.33 的修复因版本未 bump
 *    卡在 bundle 里到不了 profile。
 *
 *    **开发面豁免**（这些改动不要求 bump——随包分发但运行时不读）：`README.md` /
 *    `LICENSE` / `CHANGELOG.md` / `docs/**` / `tests/**` / `scripts/**`，以及
 *    `package.json` 里只改了 `scripts` / `devDependencies` / `files` /
 *    `packageManager` 的情况（按「运行时投影」逐字段比对，不看整体字节）。
 *    豁免面之外的任何改动都要求 bump——宁可多要一次版本，也不要「改了却到不了用户」。
 *
 * 用法：
 *   node scripts/check-bundle-version-line.mjs           # 人类可读报告
 *   node scripts/check-bundle-version-line.mjs --base <tag>   # 显式指定基线 tag
 *
 * 退出码：0 = 全过；1 = 有违规（逐条给出处置指引）。
 *
 * @module scripts/check-bundle-version-line
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(ROOT, 'bundle')
const PRESETS = join(ROOT, 'desktop', 'main', 'preset-plugins.ts')

/**
 * 允许「只物化、不走 registry」的包：它们没有 PRESET 声明，规则①对其不适用。
 * dsh-ssh-remote 属此类——真源是独立仓（kkutysllb/dsh-kylin-ssh-tunnel），
 * 不发布 npm，故只能物化；它运行所需的 provider 包反过来走
 * PRESET_RUNTIME_DEPS 牵引（见 preset-plugins.ts）。
 */
const MATERIALIZE_ONLY = new Set([
  'dsh-terminal', '@kkutysllb/dsh-terminal', 'dsh-skills-bundle', 'dsh-shell-prefs', 'dsh-ssh-remote',
])

/**
 * 开发面路径（相对 `bundle/<dir>`）：随包分发但**运行时不读**，改动不要求 bump。
 *
 * 运行时真正加载的是 `lib/**`（`package.json` 的入口字段指向它）+ `cordis.patch.yml`
 * ——`src/**` 只是随包分发的源码（镜像整体复制带来的），引擎从不加载它；源码改动若
 * 影响行为，必然同时体现在 `lib/**` 里，由那里拦下。`.map` 与文档同理。
 * 豁免面的判定宁可保守——面外的任何改动都按「用户需要拿到」处理。
 */
const DEV_ONLY_PATTERNS = [
  /(^|\/)(README|CHANGELOG)\.md$/i,
  /(^|\/)LICENSE(\.md)?$/i,
  /^docs\//,
  /^tests\//,
  /^scripts\//,
  /^src\//,
  /\.map$/,
]

/** `package.json` 里「运行时不读」的字段：只改这些字段同样不要求 bump。 */
const DEV_ONLY_PKG_FIELDS = ['scripts', 'devDependencies', 'files', 'packageManager']

/** 去掉开发面字段后的「运行时投影」，用于判断 package.json 是否只动了开发面。 */
function runtimeProjection(pkg) {
  const copy = { ...pkg }
  for (const field of DEV_ONLY_PKG_FIELDS) delete copy[field]
  return JSON.stringify(copy, Object.keys(copy).sort())
}

const argv = process.argv.slice(2)
const baseIdx = argv.indexOf('--base')
const baseArg = baseIdx >= 0 ? argv[baseIdx + 1] : undefined

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function gitTry(args) {
  try {
    return git(args)
  } catch {
    return undefined
  }
}

/** 从一个 semver range 取「下界版本」；无法识别时返回 undefined。 */
function rangeLowerBound(range) {
  const m = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(range)
  return m === null ? undefined : m[0]
}

/** 解析 `preset-plugins.ts` 里的 PRESET_PLUGINS 字面量（扁平 Record<string,string>）。 */
function readPresets() {
  const text = readFileSync(PRESETS, 'utf8')
  const start = text.indexOf('export const PRESET_PLUGINS')
  if (start < 0) throw new Error(`找不到 PRESET_PLUGINS：${PRESETS}`)
  const open = text.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = text.slice(open + 1, end)
  const out = new Map()
  const re = /^\s*(['"])([^'"]+)\1\s*:\s*(['"])([^'"]+)\3\s*,/gm
  let m
  while ((m = re.exec(body)) !== null) out.set(m[2], m[4])
  return out
}

function readPackageJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** 基线 tag：显式 `--base` 优先，否则取最近的 `v*` 发布 tag。 */
function resolveBase() {
  if (baseArg !== undefined) return baseArg
  return gitTry(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'])
}

const failures = []
const notes = []
const presets = readPresets()
const base = resolveBase()
const baseNotes = base === undefined ? '（无发布基线：规则②跳过）' : base

const dirs = existsSync(BUNDLE)
  ? readdirSync(BUNDLE, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()
  : []

console.log(`[bundle-line] 基线 tag：${baseNotes}`)
console.log(`[bundle-line] bundle/ 下 ${dirs.length} 个内置插件\n`)

for (const dir of dirs) {
  const pkg = readPackageJson(join(BUNDLE, dir, 'package.json'))
  if (pkg === undefined) {
    failures.push(`${dir}：bundle/${dir}/package.json 缺失或不可解析`)
    continue
  }
  const name = String(pkg.name ?? '')
  const version = String(pkg.version ?? '')
  const declared = presets.get(name)
  const rows = [`v${version}`]

  // ① 声明与物化同线
  if (declared !== undefined) {
    const lower = rangeLowerBound(declared)
    if (lower === undefined) {
      failures.push(`${dir}：PRESET 声明 ${declared} 无法解析出下界版本`)
    } else if (lower !== version) {
      failures.push(
        `${dir}（${name}）：声明与物化不同线 —— PRESET \`${declared}\` 的下界是 ${lower}，`
        + `bundle 实体是 ${version}。\n`
        + `    处置：把 PRESET_PLUGINS['${name}'] 平移到 \`^${version}\`（**先确认该版本已在 npm 可见**：`
        + `指定版本端点在 npmjs / npmmirror 双源 200 再平移），或把 bundle 回退到声明线。`,
      )
    } else {
      rows.push(`同线 ^${version}`)
    }
  } else if (MATERIALIZE_ONLY.has(name)) {
    rows.push('仅物化（无 registry 声明）')
  } else {
    notes.push(`${dir}（${name}）：既不在 PRESET_PLUGINS 也不在「仅物化」白名单——确认这是有意的`)
    rows.push('无声明')
  }

  // ② 内容变更必须伴随版本变更（开发面豁免见文件头）
  if (base !== undefined) {
    const changed = gitTry(['diff', '--name-only', base, '--', `bundle/${dir}`])
    const files = changed === undefined || changed === '' ? [] : changed.split('\n').filter(Boolean)
    const rel = files.map(f => f.slice(`bundle/${dir}/`.length))
    const devOnly = rel.filter(f => DEV_ONLY_PATTERNS.some(p => p.test(f)))
    let runtime = rel.filter(f => !DEV_ONLY_PATTERNS.some(p => p.test(f)))

    // package.json：只动了开发面字段（scripts/devDependencies/files/…）⇒ 不算运行时面
    let pkgDevOnly = false
    if (runtime.includes('package.json')) {
      const atBase = gitTry(['show', `${base}:bundle/${dir}/package.json`])
      try {
        const before = JSON.parse(atBase)
        if (runtimeProjection(before) === runtimeProjection(pkg)) {
          runtime = runtime.filter(f => f !== 'package.json')
          pkgDevOnly = true
        }
      } catch {
        // 基线无此文件（新包）⇒ 保留在运行时面里按「新增」处理
      }
    }

    const atBasePkg = gitTry(['show', `${base}:bundle/${dir}/package.json`])
    let baseVersion
    try {
      baseVersion = atBasePkg === undefined ? undefined : JSON.parse(atBasePkg).version
    } catch {
      baseVersion = undefined
    }

    if (runtime.length === 0) {
      if (devOnly.length > 0 && pkgDevOnly) rows.push(`自基线仅开发面改动（${devOnly.length} 文件 + package.json 的开发字段，不要求 bump）`)
      else if (devOnly.length > 0) rows.push(`自基线仅开发面改动 ${devOnly.length} 文件（不要求 bump）`)
      else if (pkgDevOnly) rows.push('自基线仅 package.json 的开发字段改动（不要求 bump）')
      else rows.push('自基线无改动')
    } else if (baseVersion === undefined) {
      rows.push(`运行时面变更 ${runtime.length} 文件（基线无此包 ⇒ 视为新增）`)
    } else if (String(baseVersion) === version) {
      const shown = runtime.slice(0, 4).join('、')
      failures.push(
        `${dir}（${name}）：自 ${base} 以来有 ${runtime.length} 个**运行时面**文件变更，但版本仍是 ${version}。\n`
        + `    变更：${shown}${runtime.length > 4 ? ` 等 ${runtime.length} 个` : ''}\n`
        + `    物化判据是 gt(源版本, 实装版本) ⇒ **已装用户升级后拿不到这些改动**（新装用户能拿到）。\n`
        + `    处置：bump 内置插件版本（npm version patch --no-git-tag-version）→ pnpm build → `
        + `pnpm sync:mirror → node scripts/sync-bundles.mjs，再带上本仓版本发布。`,
      )
    } else {
      rows.push(`运行时面变更 ${runtime.length} 文件 ⇒ 版本 ${baseVersion} → ${version} ✓`)
    }
  }

  console.log(`  ${dir.padEnd(24)} ${rows.join('  |  ')}`)
}

if (notes.length > 0) {
  console.log('\n提醒：')
  for (const n of notes) console.log(`  · ${n}`)
}

if (failures.length > 0) {
  console.error(`\n[bundle-line] 未通过（${failures.length} 条）：`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error('\n处置说明见 docs/plugin-dev-checklist.md §2 / §4。')
  process.exit(1)
}

console.log('\n[bundle-line] 通过 ✓（声明同线 + 内容变更伴随版本变更）')
