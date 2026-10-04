#!/usr/bin/env node
/**
 * 依赖陈旧哨兵（供 `pnpm dev` 启动前自检）+ setup.sh 的 store 查询口。
 *
 * ## 为什么需要它
 *
 * pnpm install 之后又改过清单（package.json / pnpm-lock.yaml /
 * pnpm-workspace.yaml）时，node_modules 里的工作区软链会缺失——而失败形态
 * 是**静默的**：引擎照常启动、页面照常打开，只是插件清单少条目。
 *
 * 2026-10-04 实测（上游克隆 0.1.6-alpha.2 → 0.2.0-rc.2 升级后漏跑 install）：
 *   · node_modules 12:55 / 清单 13:08 → 52 个包缺 60 条 workspace:* 软链
 *   · 宿主侧唯一真错：Cannot find package '@deepseek-ai/dsh-scope'
 *     imported from …/packages/client/file-upload/lib/index.js
 *   · 连锁：file-upload 半边 import 失败 → fileUploads 服务缺失 →
 *     session-controller 永远 pending → 客户端 33 条插件条目全部 pending，
 *     上屏的只有一句「Failed to load plugins」（宿主侧错误不出现在终端）
 *
 * ## 判据（宁缺勿滥：只报确定要重装的情形，任何解析失败一律放行）
 *
 *   1. node_modules/.modules.yaml 缺失 → 未安装
 *   2. node_modules/.pnpm/lock.yaml ≠ pnpm-lock.yaml → 装的是旧锁文件快照
 *      （这份快照由 pnpm 每次 install 落盘，内容不一致即「锁文件变过、没重装」）
 *   3. 工作区包声明的 dependencies/devDependencies 解析不到 → 软链缺失
 *      （从包目录逐级上溯到工作区根，正是 Node/pnpm 的解析路径）
 *
 * 刻意**不**比对 package.json 的 mtime：改 version/scripts 也会动它，而依赖
 * 可能完全没变（KCoder 自身 package.json 2026-10-03 改过，装状态 2026-09-23
 * 仍然正确），据此告警会在每次 dev 误报。也刻意不做全量链接审计（体积大、
 * 假阳性窗口多）——判据 2 + 3 已覆盖本次事故的两条独立信号。
 *
 * ## 用法
 *
 *   node scripts/deps-freshness.mjs <dir>              # 体检，exit 1 = 陈旧
 *   node scripts/deps-freshness.mjs --store-dir <dir>  # 打印已装 store 路径
 *
 * 第二个用法给 scripts/setup.sh 用：pnpm 要求 store 与既有 node_modules
 * 一致，不一致时非交互环境直接 ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY，
 * 所以安装前必须按既有记录复用 store（本机克隆的 store 在仓内 .pnpm-store）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const MODULES_STATE = join('node_modules', '.modules.yaml')
const LOCK_SNAPSHOT = join('node_modules', '.pnpm', 'lock.yaml')
const LOCK = 'pnpm-lock.yaml'

/**
 * 已装状态记录的 store 路径（pnpm 写在 node_modules/.modules.yaml）。
 * 实测该文件是 JSON 形态；不同 pnpm 版本可能落 YAML，故带正则兜底。
 */
export function readStoreDir(root) {
  const file = join(root, MODULES_STATE)
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  try {
    const state = JSON.parse(raw)
    if (typeof state?.storeDir === 'string') return state.storeDir
  } catch {
    // 落到正则兜底
  }
  const m = /storeDir:\s*['"]?([^'"\n,]+)/.exec(raw)
  return m ? m[1].trim() : ''
}

/** 锁文件快照与现状是否已不一致（快照缺失 = 无从判断，放行）。 */
function lockfileChanged(root) {
  const live = join(root, LOCK)
  const snap = join(root, LOCK_SNAPSHOT)
  if (!existsSync(live) || !existsSync(snap)) return false
  try {
    return !readFileSync(live).equals(readFileSync(snap))
  } catch {
    return false
  }
}

/** 读 pnpm-workspace.yaml 的 packages 通配（只认这个文件里实际出现的简单形态）。 */
function readWorkspacePatterns(root) {
  const file = join(root, 'pnpm-workspace.yaml')
  if (!existsSync(file)) return null
  let lines
  try {
    lines = readFileSync(file, 'utf8').split('\n')
  } catch {
    return null
  }
  const patterns = []
  let inPackages = false
  for (const line of lines) {
    const text = line.replace(/#.*$/, '')
    if (/^packages:\s*$/.test(text)) {
      inPackages = true
      continue
    }
    if (!inPackages) continue
    if (text.trim() === '') continue
    if (/^\S/.test(text)) break // 下一个顶层键，列表结束
    const m = /^\s*-\s*(.+?)\s*$/.exec(text)
    if (m) patterns.push(m[1].replace(/^['"]|['"]$/g, ''))
  }
  return patterns.length > 0 ? patterns : null
}

/** 展开单层 `*` 通配（本仓/上游的 packages 形态都只有单段通配与字面路径）。 */
function expandPattern(root, pattern) {
  let dirs = [root]
  for (const seg of pattern.split('/')) {
    const next = []
    for (const dir of dirs) {
      if (seg === '*') {
        let entries = []
        try {
          entries = readdirSync(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const e of entries) {
          if (e.name === 'node_modules' || e.name.startsWith('.')) continue
          if (e.isDirectory() || e.isSymbolicLink()) next.push(join(dir, e.name))
        }
      } else {
        const abs = join(dir, seg)
        if (existsSync(abs)) next.push(abs)
      }
    }
    dirs = next
  }
  return dirs
}

/** 工作区根 + 各 workspace 包目录（含 `!` 排除项的展开）。 */
function workspacePackageDirs(root) {
  const dirs = new Set([root])
  const patterns = readWorkspacePatterns(root)
  if (!patterns) return [...dirs]
  const excluded = new Set()
  for (const p of patterns.filter((x) => x.startsWith('!'))) {
    for (const d of expandPattern(root, p.slice(1))) excluded.add(d)
  }
  for (const p of patterns.filter((x) => !x.startsWith('!'))) {
    for (const d of expandPattern(root, p)) {
      if (!excluded.has(d) && existsSync(join(d, 'package.json'))) dirs.add(d)
    }
  }
  return [...dirs]
}

/** 包声明的依赖名（只取 pnpm 默认会装的字段；optional/peer 天然可能缺席）。 */
function declaredDeps(pkgJsonPath) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  } catch {
    return []
  }
  const names = new Set()
  for (const field of ['dependencies', 'devDependencies']) {
    const obj = pkg?.[field]
    if (obj && typeof obj === 'object') for (const n of Object.keys(obj)) names.add(n)
  }
  return [...names]
}

/** 从 startDir 逐级上溯到工作区根，看依赖能否解析（Node/pnpm 的解析路径）。 */
function resolvesFrom(startDir, root, name) {
  let dir = startDir
  for (;;) {
    if (existsSync(join(dir, 'node_modules', name))) return true
    if (dir === root) return false
    const parent = dirname(dir)
    if (parent === dir || !(parent === root || parent.startsWith(root + sep))) return false
    dir = parent
  }
}

/**
 * 体检一棵依赖树。
 * @returns {{ state: 'ok'|'missing'|'stale', problems: string[], examples: string[], error?: string }}
 */
export function checkDepsFreshness(root) {
  try {
    if (!existsSync(join(root, MODULES_STATE))) {
      return { state: 'missing', problems: ['未安装（node_modules/.modules.yaml 不存在）'], examples: [] }
    }
    const problems = []
    if (lockfileChanged(root)) {
      problems.push(`装的是旧锁文件快照（node_modules/.pnpm/${LOCK} ≠ ${LOCK}）`)
    }
    const missing = []
    for (const dir of workspacePackageDirs(root)) {
      for (const name of declaredDeps(join(dir, 'package.json'))) {
        if (!resolvesFrom(dir, root, name)) missing.push(`${relative(root, dir) || '.'} → ${name}`)
      }
    }
    if (missing.length > 0) {
      problems.push(`工作区软链缺失 ${missing.length} 条，首个：${missing[0]}`)
      if (missing.length > 1) problems.push(`其余例：${missing.slice(1, 4).join(' / ')}`)
    }
    return { state: problems.length > 0 ? 'stale' : 'ok', problems, examples: [] }
  } catch (err) {
    // 哨兵自身出错绝不阻塞开发：宁可不报，也不误报
    return { state: 'ok', problems: [], examples: [], error: err instanceof Error ? err.message : String(err) }
  }
}

/** 格式化告警（多行，含可直接照抄的修复命令——store 必须与既有记录一致）。 */
export function formatDepsWarning(root, report) {
  const store = readStoreDir(root)
  const install = store ? `pnpm install --store-dir ${store}` : 'pnpm install'
  return [
    `[dev] ⚠ 依赖陈旧：${root}`,
    ...report.problems.map((p) => `      · ${p}`),
    `      → 修：cd ${root} && ${install}`,
    store ? '        （store 已在 .modules.yaml 记录，不能省——不一致时 pnpm 要清空重装，非交互直接报错）' : '',
    '      → 不修也能起，但引擎插件面会静默缺条目（Failed to load plugins / 大量 pending）',
  ]
    .filter(Boolean)
    .join('\n')
}

const invokedDirectly = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (invokedDirectly) {
  const [, , first, second] = process.argv
  if (first === '--store-dir') {
    process.stdout.write(readStoreDir(second ?? process.cwd()))
  } else {
    const dir = first ?? process.cwd()
    const report = checkDepsFreshness(dir)
    if (report.state === 'ok') {
      console.log(`[deps] 正常：${dir}${report.error ? `（哨兵未生效：${report.error}）` : ''}`)
    } else {
      console.log(formatDepsWarning(dir, report))
      process.exitCode = 1
    }
  }
}
