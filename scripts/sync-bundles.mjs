#!/usr/bin/env node
/**
 * 内置插件 bundle 同步：dsh-plugins 仓库（镜像真源）→ KCoder bundle/。
 *
 * 2026-08-30 迁址后，KCoder 仓 bundle/ 目录只是随包分发的同步副本；
 * 插件开发真源在各自独立仓（2026-09-01 起：dsh-skills-bundle，全部 dsh 标准
 * 命名 npm 包；dsh-terminal 已于 2026-10-09 退役摘除，dsh-coding-sidebar 已于
 * 2026-10-09 退役摘除，dsh-file-review-kcoder 已于 2026-10-04 退役摘除）→
 * dsh-plugins/<同名目录> 镜像 → 本脚本同步进 bundle/ 再发版——方向单向，
 * 禁止反向手改。
 *
 * 同步映射（dsh-plugins/<src> → bundle/<dst>，目录名与包名同名）：
 * - 产物直提包全镜像（skills-bundle，排除式镜像；file-attach 已于 0.5.6 退役摘除，
 *   git-panel 已于 2026-09-14 退役摘除）
 * - dsh-file-review-kcoder（2026-10-04 退役）：选择面映射与 bundle 目录一并
 *   摘除——真源仓与 npm 包保留，但 KCoder 不再同步、不再内置
 * - dsh-coding-sidebar（2026-09-19 un-retire @1.0.18 → **2026-10-09 退役**）：
 *   映射与其 bundle 目录一并摘除——真源仓与 npm 包保留（它同时是 QiLin 的
 *   第一方内置工作台），但 KCoder 不再同步、不再内置
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
  // dsh-terminal（2026-10-09 退役）：映射与其 bundle 目录同批摘除（终端交回
  // 上游原生右栏终端 tab）
  { src: 'dsh-skills-bundle', dst: 'dsh-skills-bundle', select: [] },
  // dsh-coding-sidebar（2026-09-19 un-retire @1.0.18 → **2026-10-09 退役**）：
  // 映射与其 bundle 目录同批摘除；真源仓 kkutysllb/dsh-coding-sidebar 与 npm
  // 包保留（它同时是 QiLin 的第一方内置工作台），但 KCoder 不再同步、不再内置
  // dsh-file-review-kcoder（2026-09-19 un-retire @1.0.5 → 2026-10-04 退役）：
  // 同上，映射与 bundle 目录同批摘除
  // dsh-ssh-remote（2026-09-26 内置化）：SSH 远程运维/开发工具套件。
  // 真源仓另有 analysis/ docs/ plans/ scripts/（开发面），故用选择面映射——
  // bundle 只带运行时面：宿主 lib/、客户端 client/、locale/、cordis.patch.yml、
  // icon.svg、package.json（其 dsh.client.inject 与 files 是运行期契约）。
  {
    src: 'dsh-ssh-remote',
    dst: 'dsh-ssh-remote',
    select: ['lib', 'client', 'locale', 'cordis.patch.yml', 'icon.svg', 'package.json', 'README.md'],
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
  // 归一化行尾再比：真源是 Git 检出（autocrlf 下 CRLF），镜像是同步脚本直写
  // （LF）——逐字节比在 Windows 上会把「只差行尾」判成漂移（与 deps-freshness
  // 的锁文件快照同一类陷阱，2026-10-08 一并收掉）。
  const norm = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n')
  return norm(readFileSync(a)) === norm(readFileSync(b))
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
