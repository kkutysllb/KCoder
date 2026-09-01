#!/usr/bin/env node
/**
 * 内置插件 bundle 同步：dsh-plugins 仓库（镜像真源）→ KCoder bundle/。
 *
 * 2026-08-30 迁址后，KCoder 仓 bundle/ 目录只是随包分发的同步副本；
 * 插件开发真源在各自独立仓（2026-09-01 起：dsh-git-panel/dsh-stats-panel/
 * dsh-terminal/dsh-language-bundle/dsh-skills-bundle/dsh-file-review-kcoder/
 * dsh-coding-sidebar，全部 dsh 标准命名 npm 包）→ dsh-plugins/<同名目录>
 * 镜像 → 本脚本同步进 bundle/ 再发版——方向单向，禁止反向手改。
 *
 * 同步映射（dsh-plugins/<src> → bundle/<dst>，目录名与包名同名）：
 * - 产物直提包全镜像（git-panel/stats-panel/terminal/language-bundle/
 *   skills-bundle，排除式镜像）
 * - dsh-file-review-kcoder 选择面映射（lib/package.json/cordis.patch.yml/
 *   README.md/LICENSE；src/tests 等构建面不进 bundle）
 * - dsh-coding-sidebar 同款选择面映射：侧边栏自立仓（fork 自
 *   DSH-better-sidebar 0.17.2，底面板移除），发布链为两级镜像
 *   （独立仓 → dsh-plugins/dsh-coding-sidebar → 本 bundle），
 *   profile deps 的 ^1.0.0 仅牵引依赖树，实体由 kcoder-skills-bundle 物化覆盖
 *
 * 用法：
 *   node scripts/sync-bundles.mjs            # 执行同步（rm+cp 镜像）
 *   node scripts/sync-bundles.mjs --check    # 只对账，差异即 exit 1
 *
 * 环境变量：KCODER_PLUGINS_DIR 覆盖 dsh-plugins 仓位置（缺省
 * <repoRoot>/../dsh-plugins）。release.sh verify 用 --check 做发版对账。
 *
 * @module scripts/sync-bundles
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const PLUGINS_DIR = process.env.KCODER_PLUGINS_DIR
  ? resolve(process.env.KCODER_PLUGINS_DIR)
  : resolve(REPO_ROOT, '..', 'dsh-plugins')
const BUNDLE_DIR = join(REPO_ROOT, 'bundle')

/** 排除物（镜像与对账共用）：版本控制与依赖安装目录。 */
const EXCLUDE = new Set(['.git', 'node_modules'])

/**
 * 同步映射表。select 为空数组表示全镜像；非空表示只同步这些
 * 相对路径（目录递归 / 文件直拷）。
 */
const MAPPINGS = [
  { src: 'dsh-git-panel', dst: 'dsh-git-panel', select: [] },
  { src: 'dsh-stats-panel', dst: 'dsh-stats-panel', select: [] },
  { src: 'dsh-terminal', dst: 'dsh-terminal', select: [] },
  { src: 'dsh-language-bundle', dst: 'dsh-language-bundle', select: [] },
  { src: 'dsh-skills-bundle', dst: 'dsh-skills-bundle', select: [] },
  {
    src: 'dsh-file-review-kcoder',
    dst: 'dsh-file-review-kcoder',
    select: ['lib', 'package.json', 'cordis.patch.yml', 'README.md', 'LICENSE'],
  },
  {
    src: 'dsh-coding-sidebar',
    dst: 'dsh-coding-sidebar',
    select: ['lib', 'package.json', 'cordis.patch.yml', 'README.md', 'LICENSE'],
  },
]

const CHECK = process.argv.includes('--check')

/** 收集目录下全部文件的相对路径集合（排除 EXCLUDE；select 非空时按前缀过滤）。 */
function collectFiles(root, select) {
  const files = new Set()
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (EXCLUDE.has(name)) continue
      const full = join(dir, name)
      const rel = relative(root, full)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (select.length === 0 || select.some((s) => rel === s || rel.startsWith(`${s}/`))) {
        files.add(rel)
      }
    }
  }
  walk(root)
  return files
}

function filesEqual(a, b) {
  return readFileSync(a).equals(readFileSync(b))
}

/** 对账单个映射：返回差异描述数组（空数组 = 一致）。 */
function diffMapping(m) {
  const srcRoot = join(PLUGINS_DIR, m.src)
  const dstRoot = join(BUNDLE_DIR, m.dst)
  if (!existsSync(srcRoot)) return [`源缺失: ${m.src}（dsh-plugins 仓库内无此目录）`]
  if (!existsSync(dstRoot)) {
    const faces = m.select.length > 0 ? m.select : ['<整个目录>']
    return faces.map((s) => `目标缺失: bundle/${m.dst}/${s}`)
  }
  const srcFiles = collectFiles(srcRoot, m.select)
  const dstFiles = collectFiles(dstRoot, m.select)
  const diffs = []
  for (const rel of srcFiles) if (!dstFiles.has(rel)) diffs.push(`仅真源有（未同步）: bundle/${m.dst}/${rel}`)
  for (const rel of dstFiles) if (!srcFiles.has(rel)) diffs.push(`仅副本有（应删）: bundle/${m.dst}/${rel}`)
  for (const rel of srcFiles) {
    if (!dstFiles.has(rel)) continue
    if (statSync(join(srcRoot, rel)).size !== statSync(join(dstRoot, rel)).size
      || !filesEqual(join(srcRoot, rel), join(dstRoot, rel))) {
      diffs.push(`内容不一致: bundle/${m.dst}/${rel}`)
    }
  }
  return diffs
}

function die(msg) {
  console.error(`[sync-bundles] ${msg}`)
  process.exit(1)
}

// ── 主流程 ──────────────────────────────────────────────────────────
if (!existsSync(PLUGINS_DIR)) {
  const msg = `dsh-plugins 仓库不存在: ${PLUGINS_DIR}（可设 KCODER_PLUGINS_DIR 指定）`
  if (CHECK) {
    console.warn(`[sync-bundles] 跳过对账：${msg}`)
    process.exit(0)
  }
  die(msg)
}

const allDiffs = []
for (const m of MAPPINGS) allDiffs.push(...diffMapping(m))

if (allDiffs.length > 0 && CHECK) {
  console.error(`[sync-bundles] bundle/ 与 dsh-plugins 不一致（${allDiffs.length} 处）：`)
  for (const d of allDiffs) console.error(`  - ${d}`)
  console.error('[sync-bundles] 先在 dsh-plugins 提交推送，回 KCoder 跑 sync-bundles.mjs 同步后再发版')
  process.exit(1)
}

if (allDiffs.length === 0) {
  console.log('[sync-bundles] bundle/ 与 dsh-plugins 一致，无需同步')
  process.exit(0)
}

// 执行模式：逐映射镜像重建
for (const m of MAPPINGS) {
  const srcRoot = join(PLUGINS_DIR, m.src)
  if (!existsSync(srcRoot)) die(`源缺失，中止: ${m.src}`)
  const dstRoot = join(BUNDLE_DIR, m.dst)
  rmSync(dstRoot, { recursive: true, force: true })
  mkdirSync(dstRoot, { recursive: true })
  if (m.select.length === 0) {
    cpSync(srcRoot, dstRoot, { recursive: true, filter: (s) => !EXCLUDE.has(s.split('/').pop()) })
  } else {
    for (const s of m.select) {
      const from = join(srcRoot, s)
      if (!existsSync(from)) die(`源选择面缺失，中止: ${m.src}/${s}`)
      cpSync(from, join(dstRoot, s), { recursive: true })
    }
  }
  console.log(`[sync-bundles] 已镜像 ${m.src} → bundle/${m.dst}`)
}
console.log('[sync-bundles] 同步完成（重跑 --check 应零差异）')
