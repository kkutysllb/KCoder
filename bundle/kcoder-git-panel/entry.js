/**
 * @kcoder/git-panel — server 半（dsh web 插件，cordis patch 层挂载）。
 *
 * 只读 git 工作区快照 RPC：
 * - POST /kc-git-panel/api/snapshot  {cwd}  → GitSnapshot
 *   （status --porcelain=v1 三计数 + diff HEAD --numstat 行数和
 *   + untracked 逐文件行数增补 + 约定位置计划文档扫描）
 * - POST /kc-git-panel/api/open-plan {path} → 系统默认应用打开
 *   （client 侧 better-sidebar 缺席时的回退链末端；仅文本计划扩展名）
 *
 * 安全边界与 dsh-git-forge 同款：isTrusted（loopback 放行 +
 * webRuntime.trustedHosts）+ POST-only + JSON body。cwd 由 client
 * 按当前会话传入（多窗口各自跟随自己的工作区），无 cwd 返回空快照。
 *
 * 纯逻辑（解析/扫描/探测）全部导出，tests/run-tests.mjs 以 node
 * 直跑覆盖（真 git 临时仓库集成用例）。逻辑平移自退役宿主
 * desktop/main/git-panel.ts，语义保持一致。
 *
 * @module @kcoder/git-panel/entry
 */

import { execFile } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** client-modules 集成对应的 cordis 依赖：RPC 注册必需 webServer。 */
export const inject = ['webServer']

/** RPC 前缀（client.js 的 API 常量与之对齐）。 */
export const RPC_PREFIX = '/kc-git-panel/api'

/** 单条 git 命令超时（毫秒；探测四路并行，整体最长约一个超时周期）。 */
const GIT_TIMEOUT_MS = 5000
/** 写操作超时（毫秒；push/commit 可能涉及网络与磁盘，放宽）。 */
const WRITE_TIMEOUT_MS = 30000
/** 变更文件列表上限（超出截断，防巨型工作区撑爆面板 DOM）。 */
const FILES_MAX = 200
/** 计划列表上限（按 mtime 新→旧截断）。 */
const PLAN_MAX = 6
/** 计划文档约定目录（一层 .md）。 */
const PLAN_DIRS = ['plans', 'docs/plans', '.plans']
/** 计划文档约定文件（工作区根）。 */
const PLAN_FILES = ['plan.md', 'PLAN.md', 'docs/plan.md']
/** untracked 单文件行数统计的大小上限（构建产物等大文件跳过）。 */
const UNTRACKED_MAX_SIZE = 10 * 1024 * 1024
/** untracked 行数统计并发。 */
const UNTRACKED_CONCURRENCY = 16
/** open-plan 允许的系统打开扩展名（面板只产计划文档，白名单防御）。 */
const OPENABLE_EXTS = ['.md', '.markdown', '.txt']

/** 错误文案取首行（git stderr 多行，面板空态只放一行）。 */
export function firstLine(s) {
  const l = s.split('\n').map(x => x.trim()).find(x => x !== '')
  return l === undefined ? null : l
}

/** 工作区显示名（路径尾段）。 */
export function wsName(cwd) {
  const segs = cwd.split('/').filter(Boolean)
  return segs.length > 0 ? (segs[segs.length - 1] ?? '') : cwd
}

/** mtime → git 风格相对时间（plan 文档用）。 */
export function relTime(ms) {
  const s = Math.max(Math.floor((Date.now() - ms) / 1000), 0)
  if (s < 60) return s === 1 ? '1 second ago' : `${s} seconds ago`
  const m = Math.floor(s / 60)
  if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`
  const h = Math.floor(m / 60)
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`
  const d = Math.floor(h / 24)
  if (d < 31) return d === 1 ? '1 day ago' : `${d} days ago`
  const mo = Math.floor(d / 31)
  if (mo < 12) return mo === 1 ? '1 month ago' : `${mo} months ago`
  const y = Math.floor(d / 365)
  return y === 1 ? '1 year ago' : `${y} years ago`
}

/** status --porcelain=v1 解析：staged/changed/untracked 三计数。 */
export function parseStatusLines(out) {
  let staged = 0
  let changed = 0
  let untracked = 0
  for (const l of out.split('\n')) {
    if (l.length < 4) continue
    const x = l[0] ?? ' '
    const y = l[1] ?? ' '
    if (x === '?' && y === '?') {
      untracked++
      continue
    }
    // 冲突行（UU/AA 等）X/Y 都非空：双计数（两态各有语义，显示近似无害）
    if (x !== ' ') staged++
    if (y !== ' ' && y !== '?') changed++
  }
  return { staged, changed, untracked }
}

/** diff HEAD --numstat 求和（added\tremoved\tpath；二进制 '-' 跳过）。 */
export function parseNumstatLines(out) {
  let added = 0
  let removed = 0
  for (const l of out.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(l)
    if (m === null) continue
    if (m[1] !== '-') added += Number(m[1])
    if (m[2] !== '-') removed += Number(m[2])
  }
  return { added, removed }
}

/** git 引号路径还原（porcelain 对含特殊字符路径加 " 并 C 转义；
 *  非 ASCII 为八进制字节序列，按 UTF-8 字节解码）。 */
export function unquotePath(p) {
  if (p.length < 2 || p[0] !== '"' || p[p.length - 1] !== '"') return p
  const body = p.slice(1, -1)
  const bytes = []
  for (let i = 0; i < body.length; i++) {
    const c = body[i] ?? ''
    if (c === '\\' && i + 1 < body.length) {
      const n = body[i + 1] ?? ''
      if (n >= '0' && n <= '7') {
        let j = i + 1
        let v = 0
        let k = 0
        while (j < body.length && k < 3 && (body[j] ?? '') >= '0' && (body[j] ?? '') <= '7') {
          v = v * 8 + ((body[j] ?? '').charCodeAt(0) - 48)
          j++
          k++
        }
        bytes.push(v)
        i = j - 1
      } else {
        const map = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }
        bytes.push(map[n] !== undefined ? map[n] : n.charCodeAt(0))
        i++
      }
    } else {
      for (const b of new TextEncoder().encode(c)) bytes.push(b)
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** status --porcelain=v1 逐文件解析（rename 行取新路径；引号路径还原）。 */
export function parseStatusEntries(out) {
  const entries = []
  for (const l of out.split('\n')) {
    if (l.length < 4) continue
    const x = l[0] ?? ' '
    const y = l[1] ?? ' '
    let path = l.slice(3)
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4)
    path = unquotePath(path).trim()
    if (path === '') continue
    entries.push({
      path,
      x,
      y,
      untracked: x === '?' && y === '?',
      staged: x !== ' ' && x !== '?',
      changed: y !== ' ' && y !== '?',
    })
  }
  return entries
}

/** numstat 逐文件映射（rename 两种形态归一到新路径；二进制 '-' 记 0）。 */
export function parseNumstatMap(out) {
  const map = new Map()
  for (const l of out.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l)
    if (m === null) continue
    let path = m[3] ?? ''
    const brace = /\{([^{}]*) => ([^{}]*)\}/.exec(path)
    if (brace !== null) {
      path = path.replace(brace[0], brace[2] ?? '').replace(/\/{2,}/g, '/')
    } else {
      const arrow = path.indexOf(' => ')
      if (arrow !== -1) path = path.slice(arrow + 4)
    }
    path = unquotePath(path).trim()
    if (path === '') continue
    map.set(path, {
      added: m[1] === '-' ? 0 : Number(m[1]),
      removed: m[2] === '-' ? 0 : Number(m[2]),
    })
  }
  return map
}

/** worktree list --porcelain 解析（bare 仓库剔除）。 */
export function parseWorktreesPorcelain(out) {
  const list = []
  let cur = null
  for (const l of out.split('\n')) {
    if (l.startsWith('worktree ')) {
      if (cur !== null) list.push(cur)
      cur = { path: l.slice(9), branch: null, detached: false }
    } else if (cur === null) {
      continue
    } else if (l.startsWith('branch ')) {
      cur.branch = l.slice(7).replace(/^refs\/heads\//, '')
    } else if (l === 'detached') {
      cur.detached = true
    } else if (l === 'bare') {
      cur.bare = true
    }
  }
  if (cur !== null) list.push(cur)
  return list.filter(w => w.bare !== true)
}

/** rev-list --left-right --count 输出解析（左=ahead 右=behind；< > 前缀剥离）。 */
export function parseAheadBehind(out) {
  const m = /^([<>]?\d+)\s+([<>]?\d+)\s*$/.exec(out.trim())
  if (m === null) return { ahead: 0, behind: 0 }
  return {
    ahead: parseInt(m[1]?.replace(/[<>]/g, '') ?? '0', 10),
    behind: parseInt(m[2]?.replace(/[<>]/g, '') ?? '0', 10),
  }
}

/** 分支名基础校验（execFile 无 shell 注入面，此层拦误操作；
 *  规则取 git check-ref-format 高频拒绝项子集）。 */
export function isValidBranchName(name) {
  if (typeof name !== 'string') return false
  if (name === '' || name.length > 200) return false
  if (/\s/.test(name)) return false
  if (name.startsWith('-') || name.startsWith('.') || name.startsWith('/')) return false
  if (name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false
  if (name.includes('..') || name.includes('//') || name.includes('@{')) return false
  if (/[~^:?*[\]\\]/.test(name)) return false
  return true
}

/** 仓库路径清洗（剥 .git 与首尾斜杠；单段路径不视为 owner/repo）。 */
function cleanRepoPath(p) {
  const s = String(p).replace(/\.git\/?$/, '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (s === '' || !s.includes('/')) return null
  return s
}

/** remote URL → {host, path}（scp 形式 git@host:owner/repo 与
 *  http(s)/ssh/git 协议形式；其余 null）。 */
export function remoteRepoUrl(remoteUrl) {
  if (typeof remoteUrl !== 'string') return null
  const u = remoteUrl.trim()
  if (u === '') return null
  const scp = /^[a-zA-Z0-9._-]+@([a-zA-Z0-9._-]+):(.+)$/.exec(u)
  if (scp !== null) {
    const path = cleanRepoPath(scp[2] ?? '')
    return path === null ? null : { host: scp[1] ?? '', path }
  }
  try {
    const url = new URL(u)
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol)) return null
    const path = cleanRepoPath(url.pathname)
    return path === null ? null : { host: url.hostname, path }
  } catch {
    return null
  }
}

/** 比较分支外链（GitHub 风格 compare URL；remote 不可解析 null）。 */
export function compareUrl(remoteUrl, base, branch) {
  const repo = remoteRepoUrl(remoteUrl)
  if (repo === null) return null
  if (typeof base !== 'string' || base === '') return null
  if (typeof branch !== 'string' || branch === '') return null
  return `https://${repo.host}/${repo.path}/compare/${base}...${branch}`
}

/** execFile 包装：失败不抛（ok/err 由调用方消化；stderr 优先作错误文案）。 */
export function runGit(args, cwd, timeoutMs) {
  return new Promise(resolve => {
    execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null) {
        const err = stderr !== '' ? stderr : (typeof error.message === 'string' ? error.message : 'git failed')
        resolve({ ok: false, out: '', err })
        return
      }
      resolve({ ok: true, out: stdout, err: stderr })
    })
  })
}

/**
 * 扫描工作区里的计划文档（agent 执行任务时写的 markdown 计划；
 * 约定位置：plans/、docs/plans/、.plans/ 一层 + 根 plan.md 等）。
 * 标题取文档首个 `# ` 行（读头 512B），缺省回退文件名。
 */
export async function scanPlans(cwd) {
  const found = []
  // 按 dev:ino 身份去重：macOS 大小写不敏感盘上 plan.md 与 PLAN.md 同指
  // 一文件，但字符串路径不同，Set 按 path 拦不住
  const seen = new Set()
  const push = async (dir, name) => {
    const p = join(dir, name)
    try {
      const st = await stat(p)
      const id = `${st.dev}:${st.ino}`
      if (st.isFile() && !seen.has(id)) {
        seen.add(id)
        found.push({ path: p, mtime: st.mtimeMs, base: name })
      }
    } catch { /* 不存在跳过 */ }
  }
  for (const rel of PLAN_DIRS) {
    const dir = join(cwd, rel)
    let names = []
    try { names = await readdir(dir) } catch { continue }
    for (const n of names) {
      if (n.toLowerCase().endsWith('.md')) await push(dir, n)
    }
  }
  for (const rel of PLAN_FILES) await push(cwd, rel)
  found.sort((a, b) => b.mtime - a.mtime)
  const top = found.slice(0, PLAN_MAX)
  return Promise.all(top.map(async f => {
    let title = f.base.replace(/\.md$/i, '')
    try {
      const head = (await readFile(f.path, 'utf8')).slice(0, 512)
      const m = /^#{1,3}\s+(.+)$/m.exec(head)
      if (m !== null && (m[1] ?? '').trim() !== '') title = (m[1] ?? '').trim()
    } catch { /* 不可读回退文件名 */ }
    return { path: f.path, title, when: relTime(f.mtime) }
  }))
}

/** 取逐文件行数（跳过目录/超限文件；utf8 readFile + \n 计行）。
 * 设计妥协（平移自宿主）：二进制文件走 utf8 readFile 会拿到乱码串，
 * split('\n').length 仍返回一个整数——工程上无害，仅与 wc -l 语义
 * 取同数量级。 */
export async function countUntrackedLines(cwd, list) {
  const rels = list.split('\n').filter(l => l !== '')
  if (rels.length === 0) return 0
  let total = 0
  let cursor = 0
  const workers = Array.from({ length: Math.min(UNTRACKED_CONCURRENCY, rels.length) }, async () => {
    while (cursor < rels.length) {
      const i = cursor++
      const rel = rels[i] ?? ''
      const full = join(cwd, rel)
      let st
      try { st = await stat(full) } catch { continue }
      if (!st.isFile() || st.size > UNTRACKED_MAX_SIZE) continue
      let text
      try { text = await readFile(full, 'utf8') } catch { continue }
      // \n 字符数计行（与 wc -l / git numstat 一致：末尾无 \n 的
      // “最后一行”不额外计，避免为 31 个文件多报 31 行）
      total += text.split('\n').length - 1
    }
  })
  await Promise.all(workers)
  return total
}

/** 空快照（无工作区/初始态）。 */
export function emptySnapshot() {
  return {
    workspace: null, isRepo: false,
    staged: 0, changed: 0, untracked: 0, added: 0, removed: 0, plans: [],
    branch: null, ahead: 0, behind: 0, hasUpstream: false,
    remoteUrl: null, defaultBranch: null, worktrees: [], root: null,
    files: [], filesTruncated: false,
    error: null,
  }
}

/**
 * 扫描一个工作区（四路并行；非 git 仓库返回 isRepo=false 快照）。
 *
 * untracked 行数统计：git diff HEAD --numstat 语义只看已跟踪文件变更，
 * agent 一次创建 N 个新文件（目录、代码模板）会完全漏报——产品
 * 体验上 “动了文件但计数为 0” 是断颈。这里 spawn 一次 ls-files 拿
 * untracked 清单，逐个统计行数（限制单文件大小 + 并发）加入 added。
 * untracked 只有 added、没有 removed（概念上不存在）。
 */
export async function probeWorkspace(cwd) {
  const name = wsName(cwd)
  const [status, numstat, plans, untrackedList, branchRef, aheadBehind, remoteRes, originHead, worktreesRes, topRes] = await Promise.all([
    runGit(['status', '--porcelain=v1'], cwd, GIT_TIMEOUT_MS),
    // 相对 HEAD 的全部已跟踪变更（staged + unstaged）；行数统计源
    runGit(['diff', 'HEAD', '--numstat'], cwd, GIT_TIMEOUT_MS),
    // 计划文档（约定位置扫描；失败不影响 git 态）
    scanPlans(cwd).catch(() => []),
    // untracked 文件清单（--exclude-standard 走 .gitignore，避免把
    // venv/node_modules/build 产物算进去）
    runGit(['ls-files', '--others', '--exclude-standard'], cwd, GIT_TIMEOUT_MS),
    // 当前分支（detached 时失败 → null）
    runGit(['symbolic-ref', '--short', 'HEAD'], cwd, GIT_TIMEOUT_MS),
    // ahead/behind（无上游失败 → 0/0 + hasUpstream=false）
    runGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], cwd, GIT_TIMEOUT_MS),
    runGit(['remote', 'get-url', 'origin'], cwd, GIT_TIMEOUT_MS),
    runGit(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], cwd, GIT_TIMEOUT_MS),
    runGit(['worktree', 'list', '--porcelain'], cwd, GIT_TIMEOUT_MS),
    runGit(['rev-parse', '--show-toplevel'], cwd, GIT_TIMEOUT_MS),
  ])
  const branch = branchRef.ok ? branchRef.out.trim() : null
  const ab = aheadBehind.ok ? parseAheadBehind(aheadBehind.out) : { ahead: 0, behind: 0 }
  const remoteUrl = remoteRes.ok ? remoteRes.out.trim() : null
  const defaultBranch = await resolveDefaultBranch(originHead, remoteUrl, cwd)
  const worktrees = worktreesRes.ok ? parseWorktreesPorcelain(worktreesRes.out) : []
  const root = topRes.ok ? topRes.out.trim() : null
  if (!status.ok) {
    // not a git repository 是正常态（无 error 文案）；其余（git 缺失等）透出
    const benign = status.err.includes('not a git repository')
    return {
      workspace: name, isRepo: false,
      staged: 0, changed: 0, untracked: 0, added: 0, removed: 0, plans,
      branch: null, ahead: 0, behind: 0, hasUpstream: false,
      remoteUrl: null, defaultBranch: null, worktrees: [], root: null,
      files: [], filesTruncated: false,
      error: benign ? null : firstLine(status.err),
    }
  }
  const counts = parseStatusLines(status.out)
  let added = 0
  let removed = 0
  const numMap = numstat.ok ? parseNumstatMap(numstat.out) : new Map()
  if (numstat.ok) {
    const lines = parseNumstatLines(numstat.out)
    added = lines.added
    removed = lines.removed
  }
  // 空仓库无 HEAD → diff 失败 → 0（全部文件是 untracked，文件数胶囊仍可见）
  if (untrackedList.ok) {
    added += await countUntrackedLines(cwd, untrackedList.out)
  }
  // 逐文件变更列表（numstat 行数挂到跟踪文件；untracked 只标新文件）
  const all = parseStatusEntries(status.out)
  const files = []
  for (const e of all) {
    const nm = numMap.get(e.path)
    files.push({
      path: e.path, x: e.x, y: e.y, untracked: e.untracked, staged: e.staged,
      added: e.untracked ? null : (nm?.added ?? 0),
      removed: e.untracked ? null : (nm?.removed ?? 0),
    })
    if (files.length >= FILES_MAX) break
  }
  return {
    workspace: name, isRepo: true,
    staged: counts.staged, changed: counts.changed, untracked: counts.untracked,
    added, removed, plans,
    branch, ahead: ab.ahead, behind: ab.behind, hasUpstream: aheadBehind.ok,
    remoteUrl, defaultBranch, worktrees, root,
    files, filesTruncated: all.length > files.length,
    error: null,
  }
}

/** 默认分支：origin/HEAD 符号引用优先，缺席时试探 origin/main、origin/master。 */
async function resolveDefaultBranch(originHead, remoteUrl, cwd) {
  if (originHead.ok) {
    const b = originHead.out.trim().replace(/^refs\/remotes\/origin\//, '')
    if (b !== '') return b
  }
  if (remoteUrl === null) return null
  for (const cand of ['main', 'master']) {
    const v = await runGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${cand}`], cwd, GIT_TIMEOUT_MS)
    if (v.ok) return cand
  }
  return null
}

/* ---------------------------------------------------------------- *
 * RPC（/kc-git-panel/api/{snapshot,open-plan}）
 * ---------------------------------------------------------------- */

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0'
}

/** 请求来源校验（dsh-git-forge 同款）：loopback 放行，其余对 trustedHosts。 */
function isTrusted(req, trustedHosts) {
  try {
    const hostHeader = req.headers?.host || req.headers?.Host
    if (!hostHeader) return false
    const url = new URL('http://' + hostHeader)
    if (isLoopbackHostname(url.hostname)) return true
    const list = Array.isArray(trustedHosts) ? trustedHosts : []
    return list.some((entry) => {
      const e = String(entry)
      return e === hostHeader || e === url.hostname || e === url.host
    })
  } catch {
    return false
  }
}

function writeJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

/** 路径尾段即 method（/kc-git-panel/api/snapshot → 'snapshot'）。 */
function methodOf(url) {
  try {
    const pathname = new URL(url ?? '/', 'http://x').pathname
    const segs = pathname.split('/').filter(Boolean)
    return segs.length > 0 ? decodeURIComponent(segs[segs.length - 1] ?? '') : ''
  } catch {
    return ''
  }
}

/** snapshot：cwd 必须是绝对路径；缺席/非法返回空快照（面板“等待工作区”）。 */
export async function handleSnapshot(body) {
  const cwd = typeof body?.cwd === 'string' && isAbsolute(body.cwd) ? body.cwd : ''
  if (cwd === '') return emptySnapshot()
  return probeWorkspace(cwd)
}

/** 写操作 RPC 公共 cwd 校验（缺席/相对路径拒绝）。 */
function absCwd(body) {
  return typeof body?.cwd === 'string' && isAbsolute(body.cwd) ? body.cwd : ''
}

/** branches：当前分支 + 本地分支清单（选择器数据源）。 */
export async function handleBranches(body) {
  const cwd = absCwd(body)
  if (cwd === '') return { ok: false, error: 'bad cwd' }
  const [cur, list] = await Promise.all([
    runGit(['symbolic-ref', '--short', 'HEAD'], cwd, GIT_TIMEOUT_MS),
    runGit(['for-each-ref', 'refs/heads', '--format=%(refname:short)'], cwd, GIT_TIMEOUT_MS),
  ])
  if (!list.ok) return { ok: false, error: firstLine(list.err) ?? 'git failed' }
  return {
    ok: true,
    current: cur.ok ? cur.out.trim() : null,
    branches: list.out.split('\n').map(s => s.trim()).filter(s => s !== ''),
  }
}

/** checkout：切到已存在分支（分支名基础校验前置）。 */
export async function handleCheckout(body) {
  const cwd = absCwd(body)
  if (cwd === '') return { ok: false, error: 'bad cwd' }
  const branch = typeof body?.branch === 'string' ? body.branch.trim() : ''
  if (!isValidBranchName(branch)) return { ok: false, error: 'invalid branch name' }
  const r = await runGit(['checkout', branch], cwd, WRITE_TIMEOUT_MS)
  return r.ok ? { ok: true } : { ok: false, error: firstLine(r.err) ?? 'checkout failed' }
}

/** create-branch：创建并检出新分支（checkout -b）。 */
export async function handleCreateBranch(body) {
  const cwd = absCwd(body)
  if (cwd === '') return { ok: false, error: 'bad cwd' }
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!isValidBranchName(name)) return { ok: false, error: 'invalid branch name' }
  const r = await runGit(['checkout', '-b', name], cwd, WRITE_TIMEOUT_MS)
  return r.ok ? { ok: true } : { ok: false, error: firstLine(r.err) ?? 'create branch failed' }
}

/** delete-branch：删除本地分支。默认安全删（`branch -d`，未合并拒绝并
 *  带 merged 标记供 UI 升级强制确认）；`force` 走 `branch -D`；
 *  当前检出分支拒绝。 */
export async function handleDeleteBranch(body) {
  const cwd = absCwd(body)
  if (cwd === '') return { ok: false, error: 'bad cwd' }
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!isValidBranchName(name)) return { ok: false, error: 'invalid branch name' }
  const cur = await runGit(['symbolic-ref', '--short', 'HEAD'], cwd, GIT_TIMEOUT_MS)
  if (cur.ok && cur.out.trim() === name) return { ok: false, error: 'cannot delete current branch' }
  const r = await runGit(['branch', body?.force === true ? '-D' : '-d', name], cwd, WRITE_TIMEOUT_MS)
  if (r.ok) return { ok: true }
  return { ok: false, error: firstLine(r.err) ?? 'delete failed', merged: /not fully merged/i.test(r.err ?? '') }
}

/** commit：提交待提交变更（已有暂存仅提暂存；无暂存但有
 *  changed/untracked 时先 add -A 全量暂存——对齐 Codex 提交或推送语义；
 *  无任何变更拒绝；信息非空且 ≤2000 字）。 */
export async function handleCommit(body) {
  const cwd = absCwd(body)
  if (cwd === '') return { ok: false, error: 'bad cwd' }
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (message === '' || message.length > 2000) return { ok: false, error: 'empty or too long message' }
  const st = await runGit(['status', '--porcelain=v1'], cwd, GIT_TIMEOUT_MS)
  if (!st.ok) return { ok: false, error: firstLine(st.err) ?? 'status failed' }
  const counts = parseStatusLines(st.out)
  if (counts.staged + counts.changed + counts.untracked === 0) {
    return { ok: false, error: 'nothing to commit' }
  }
  if (counts.staged === 0) {
    const add = await runGit(['add', '-A'], cwd, WRITE_TIMEOUT_MS)
    if (!add.ok) return { ok: false, error: firstLine(add.err) ?? 'stage failed' }
  }
  const r = await runGit(['commit', '-m', message], cwd, WRITE_TIMEOUT_MS)
  return r.ok ? { ok: true } : { ok: false, error: firstLine(r.err) ?? 'commit failed' }
}

/** push：按已配置上游推送（无上游时 git 报错透出）。 */
export async function handlePush(body) {
  const cwd = absCwd(body)
  if (cwd === '') return { ok: false, error: 'bad cwd' }
  const r = await runGit(['push'], cwd, WRITE_TIMEOUT_MS)
  return r.ok ? { ok: true } : { ok: false, error: firstLine(r.err) ?? 'push failed' }
}

/** open-compare：派生 GitHub 风格 compare URL 并系统浏览器打开。 */
export async function handleOpenCompare(body) {
  const cwd = absCwd(body)
  if (cwd === '') return { ok: false, error: 'bad cwd' }
  const [remoteRes, originHead, branchRef] = await Promise.all([
    runGit(['remote', 'get-url', 'origin'], cwd, GIT_TIMEOUT_MS),
    runGit(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], cwd, GIT_TIMEOUT_MS),
    runGit(['symbolic-ref', '--short', 'HEAD'], cwd, GIT_TIMEOUT_MS),
  ])
  if (!remoteRes.ok) return { ok: false, error: 'no origin remote' }
  const branch = branchRef.ok ? branchRef.out.trim() : null
  const base = await resolveDefaultBranch(originHead, remoteRes.out.trim(), cwd)
  const url = compareUrl(remoteRes.out.trim(), base, branch)
  if (url === null) return { ok: false, error: 'unsupported remote url' }
  await openWithSystemApp(url)
  return { ok: true, url }
}

/** 系统默认应用打开（macOS open / Windows start / Linux xdg-open）。 */
function openWithSystemApp(path) {
  const cmd = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', path] : [path]
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: GIT_TIMEOUT_MS }, () => resolve())
  })
}

/** open-plan：白名单扩展名 + 绝对路径（防御性；面板只产计划文档）。 */
export async function handleOpenPlan(body) {
  const path = typeof body?.path === 'string' ? body.path : ''
  if (path === '' || !isAbsolute(path)) return { ok: false, error: 'bad path' }
  const lower = path.toLowerCase()
  if (!OPENABLE_EXTS.some(ext => lower.endsWith(ext))) return { ok: false, error: 'unsupported type' }
  await openWithSystemApp(path)
  return { ok: true }
}

/** dsh web 插件入口：注册只读 RPC（effect 包裹，随插件 dispose 摘除）。 */
export function apply(ctx) {
  // webRuntime 可选（isTrusted 的非 loopback 白名单来源）
  const trustedHosts = () => {
    try { return ctx.get('webRuntime')?.trustedHosts || [] } catch { return [] }
  }
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: RPC_PREFIX,
        handler: async (req, res) => {
          if (!isTrusted(req, trustedHosts())) {
            writeJson(res, 403, { ok: false, error: 'forbidden' })
            return
          }
          if (req.method !== 'POST') {
            writeJson(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          const method = methodOf(req.url)
          let body = {}
          try { body = await readJsonBody(req) } catch {
            writeJson(res, 400, { ok: false, error: 'bad json body' })
            return
          }
          try {
            if (method === 'snapshot') {
              writeJson(res, 200, await handleSnapshot(body))
              return
            }
            if (method === 'open-plan') {
              writeJson(res, 200, await handleOpenPlan(body))
              return
            }
            if (method === 'branches') {
              writeJson(res, 200, await handleBranches(body))
              return
            }
            if (method === 'checkout') {
              writeJson(res, 200, await handleCheckout(body))
              return
            }
            if (method === 'create-branch') {
              writeJson(res, 200, await handleCreateBranch(body))
              return
            }
            if (method === 'delete-branch') {
              writeJson(res, 200, await handleDeleteBranch(body))
              return
            }
            if (method === 'commit') {
              writeJson(res, 200, await handleCommit(body))
              return
            }
            if (method === 'push') {
              writeJson(res, 200, await handlePush(body))
              return
            }
            if (method === 'open-compare') {
              writeJson(res, 200, await handleOpenCompare(body))
              return
            }
            writeJson(res, 404, { ok: false, error: 'unknown method' })
          } catch (error) {
            writeJson(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    'kc-git-panel: api',
  )
}
