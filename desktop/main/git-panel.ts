/**
 * git 环境面板 v2：浮动卡片面板（透明 WebContentsView + #/git 视图）。
 *
 * v1 注入式小浮窗（只读）；v2a 停靠式全高面板；本版 v2b 改浮动
 * 卡片——全高嵌入会盖住自绘标题栏按钮排（含 git 图标自身，
 * 无法点击收起），且嵌入感过重。浮动卡片：顶部让出标题栏
 * （y = {@link PANEL_TOP}），四周留边距，页面内圆角+阴影。
 *
 * - 入口按钮：自绘标题栏（theme-watcher 注入宿主，仅 darwin），完整
 *   序列：终端 12 / 预览 44 / 轨迹 76 / 日志 108 / git 140；徽章显
 *   示相对 HEAD 的 +N −N 行数（numstat 求和，agent 连续编辑也反映）；
 * - 面板：透明背景 WebContentsView，bounds 为右侧浮动矩形（不盖
 *   标题栏）；show 时重挂到 contentView 末尾置顶（防终端/预览面板
 *   后开时 z-order 压住卡片）；与预览抽屉互斥——windows.ts 接线
 *   onShow 双向关闭（互斥关闭不算手动关，无环）；
 * - 让位：__dshGitPad(W) 给上游 centerCol/detailsCol 注入
 *   padding-right + --dsh-git-inset 变量——主区域含输入框整体
 *   左移，卡片浮在让出的空白区上（不遮内容）；
 * - 探测：status -b / log / diff HEAD --numstat / branch 列表四条
 *   并行只读命令；probeQueue 链式串行（fetch/写操作也排队，避免
 *   读到 add 中间态；每次调用严格等自己的那次完成）；
 * - 写操作：commit（add -A + commit）/ push（有上游直接推，无则
 *   -u origin HEAD）/ checkout / branch+checkout。git 自身是安全
 *   网（脏工作区 checkout 会被拒），错误首行透出到面板 toast；
 * - 自动展开：agent 文件活动（file-activity）且面板关着且未被手动
 *   抑制 → show；用户手动关闭置 autoSuppressed，活动静默
 *   {@link AUTO_IDLE_MS} 后解除（下次任务重新自动展开）；
 * - 通道：上行 console `__dsh_git__:`（仅按钮 toggle）；面板视图 ↔
 *   主进程走 IPC git:*（契约见 shared/ipc-contract）。
 *
 * 脆性边界：git 不存在 / 工作区非 git 仓库 → 按钮半透明、面板给出
 * 空态文案；工作区跟随 file-activity 的 workspace-changed。
 *
 * @module desktop/main/git-panel
 */

import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WebContentsView, type BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { fileActivity } from './file-activity'
import { previewPanel } from './preview-panel'
import type { GitOpResult, GitPlanFile, GitSnapshot } from '@shared/ipc-contract'

/** console 通道前缀（与注入脚本约定；v2 只剩按钮 toggle 上行）。 */
const GIT_PREFIX = '__dsh_git__:'

/** 只读探测命令超时。 */
const GIT_TIMEOUT_MS = 5000
/** git fetch 超时（网络操作放宽）。 */
const FETCH_TIMEOUT_MS = 30000
/** git push 超时（远端可能慢）。 */
const PUSH_TIMEOUT_MS = 60000
/** 本地写操作超时（commit/checkout 等）。 */
const OP_TIMEOUT_MS = 20000
/** 面板打开时的周期重探间隔。 */
const POLL_MS = 15000
/** agent 文件活动触发重探的 debounce。 */
const ACTIVITY_DEBOUNCE_MS = 2000
/** 活动静默多久后解除「手动关闭」抑制（下次任务重新自动展开）。 */
const AUTO_IDLE_MS = 60000
/** 最近提交条数。 */
const LOG_COUNT = 8
/** 计划文档采集上限。 */
const PLAN_MAX = 6
/** 计划文档扫描的约定位置（目录扫描一层；文件为根级单文件）。 */
const PLAN_DIRS = ['plans', 'docs/plans', '.plans']
const PLAN_FILES = ['plan.md', 'PLAN.md', 'docs/plan.md']
/** 面板宽度（DIP；v2b 固定不做拖拽）。 */
const PANEL_W = 360
/** 卡片与窗口边缕的边距（右侧 + 顶部间隙）。 */
const PANEL_MARGIN = 12
/** 卡片顶部 y（自绘标题栏 48 + 间隙 12；不盖标题栏按钮排）。 */
const PANEL_TOP = 60
/** 卡片最大高度（矮窗随内容区收缩）。 */
const PANEL_MAX_H = 620
/** 让位宽度：右边距 + 卡片宽 + 与内容间隙（主区域左移量）。 */
const PAD_W = PANEL_W + PANEL_MARGIN * 2

/** dev 模式下 renderer 的 vite 服务地址；生产为 out/renderer 静态文件。 */
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

/** 预加载脚本绝对路径（面板窗口同款：preload + contextIsolation）。 */
const PRELOAD = join(__dirname, '../preload/index.js')

/** 错误文案取首行（git stderr 多行，toast 只放一行）。 */
function firstLine(s: string): string | null {
  const l = s.split('\n').map(x => x.trim()).find(x => x !== '')
  return l === undefined ? null : l
}

/** 工作区显示名（路径尾段）。 */
function wsName(cwd: string): string {
  const segs = cwd.split('/').filter(Boolean)
  return segs.length > 0 ? (segs[segs.length - 1] ?? '') : cwd
}

/** execFile 包装：失败不抛（ok/err 由调用方消化，错误文案进面板）。 */
function runGit(args: string[], cwd: string, timeoutMs: number): Promise<{ ok: boolean; out: string; err: string }> {
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

/** porcelain v1 -b 分支行解析（## main...origin/main [ahead 1, behind 2]）。 */
function parseBranchLine(line: string): { branch: string | null; upstream: string | null; ahead: number | null; behind: number | null } {
  if (!line.startsWith('## ')) return { branch: null, upstream: null, ahead: null, behind: null }
  let body = line.slice(3)
  let ahead: number | null = null
  let behind: number | null = null
  const lb = body.indexOf(' [')
  if (lb >= 0) {
    const track = body.slice(lb + 2, body.length - 1)
    body = body.slice(0, lb)
    for (const part of track.split(',')) {
      const m = /ahead (\d+)/.exec(part)
      if (m !== null) ahead = Number(m[1])
      const m2 = /behind (\d+)/.exec(part)
      if (m2 !== null) behind = Number(m2[1])
    }
  }
  const dot = body.indexOf('...')
  if (dot >= 0) {
    const branch = body.slice(0, dot)
    const upstream = body.slice(dot + 3).split(' ')[0] ?? ''
    return { branch, upstream: upstream !== '' ? upstream : null, ahead, behind }
  }
  // 裸分支名（无上游）/ detached（HEAD (no branch)）/ 空仓库（No commits yet on main）
  const m = /No commits yet on (.+)$/.exec(body)
  if (m !== null) return { branch: m[1] ?? null, upstream: null, ahead: null, behind: null }
  if (body.startsWith('HEAD')) return { branch: null, upstream: null, ahead: null, behind: null }
  return { branch: body.split(' ')[0] || null, upstream: null, ahead: null, behind: null }
}

/** mtime → git 风格相对时间（plan 文档用；commits 走 git %ar）。 */
function relTime(ms: number): string {
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

/**
 * 扫描工作区里的计划文档（agent 执行任务时写的 markdown 计划；
 * 约定位置：plans/、docs/plans/、.plans/ 一层 + 根 plan.md）。
 * 标题取文档首个 `# ` 行（读头 512B），缺省回退文件名。
 */
async function scanPlans(cwd: string): Promise<GitPlanFile[]> {
  const found: Array<{ path: string; mtime: number; base: string }> = []
  const push = async (dir: string, name: string): Promise<void> => {
    const p = join(dir, name)
    try {
      const st = await stat(p)
      if (st.isFile()) found.push({ path: p, mtime: st.mtimeMs, base: name })
    } catch { /* 不存在跳过 */ }
  }
  for (const rel of PLAN_DIRS) {
    const dir = join(cwd, rel)
    let names: string[] = []
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

/** 探测一个工作区（四条只读命令 + 计划扫描并行；非 git 仓库返回 isRepo=false 快照）。 */
async function probeGit(cwd: string): Promise<GitSnapshot> {
  const name = wsName(cwd)
  const [status, log, numstat, branches, plans] = await Promise.all([
    runGit(['status', '--porcelain=v1', '-b'], cwd, GIT_TIMEOUT_MS),
    runGit(['log', `-${LOG_COUNT}`, '--pretty=format:%h%x1f%s%x1f%ar%x1f%an'], cwd, GIT_TIMEOUT_MS),
    // 相对 HEAD 的全部已跟踪变更（staged + unstaged）；行数统计源
    runGit(['diff', 'HEAD', '--numstat'], cwd, GIT_TIMEOUT_MS),
    // 本地分支列表（detached HEAD 不在 refs/heads，天然不列出）
    runGit(['branch', '--format=%(refname:short)'], cwd, GIT_TIMEOUT_MS),
    // 计划文档（约定位置扫描；失败不影响 git 态）
    scanPlans(cwd).catch(() => [] as GitPlanFile[]),
  ])
  if (!status.ok) {
    // not a git repository 是正常态（无 error 文案）；其余（git 缺失等）透出
    const benign = status.err.includes('not a git repository')
    return {
      workspace: name, isRepo: false, branch: null, upstream: null, ahead: null, behind: null,
      staged: 0, changed: 0, untracked: 0, added: 0, removed: 0, branches: [], plans: [], commits: [],
      fetching: false, busy: false,
      error: benign ? null : firstLine(status.err),
    }
  }
  const lines = status.out.split('\n')
  const { branch, upstream, ahead, behind } = parseBranchLine(lines[0] ?? '')
  let staged = 0
  let changed = 0
  let untracked = 0
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i] ?? ''
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
  // numstat 求和（added\tremoved\tpath；二进制文件 - 跳过）。空仓库
  // 无 HEAD → diff 失败 → 0（全部文件是 untracked，文件数胶囊仍可见）
  let added = 0
  let removed = 0
  if (numstat.ok) {
    for (const l of numstat.out.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t/.exec(l)
      if (m === null) continue
      if (m[1] !== '-') added += Number(m[1])
      if (m[2] !== '-') removed += Number(m[2])
    }
  }
  const commits = (log.ok ? log.out : '')
    .split('\n')
    .filter(l => l !== '')
    .map(l => {
      const [hash = '', subject = '', when = '', author = ''] = l.split('\x1f')
      return { hash, subject, when, author }
    })
  const branchList = branches.ok
    ? branches.out.split('\n').map(l => l.trim()).filter(l => l !== '').sort()
    : []
  return {
    workspace: name, isRepo: true, branch, upstream, ahead, behind,
    staged, changed, untracked, added, removed, branches: branchList, plans, commits,
    fetching: false, busy: false, error: null,
  }
}

/**
 * 页面注入脚本（上游 shell 页面上下文）：按钮样式 + 标题栏按钮 +
 * 让位入口 __dshGitPad + 徽章/按钮态渲染 __dshGitBadge（主进程
 * executeJavaScript 调用）。面板本体是独立 WebContentsView，不在
 * 上游页面 DOM 里。
 */
const PAGE_JS = `(() => {
  if (window.__dshGitWired) return
  window.__dshGitWired = true
  const BTN_ID = '__dsh_desktop_git_btn'
  const STYLE_ID = '__dsh_desktop_git_style'

  const CSS = [
    '#' + BTN_ID + '{all:unset;box-sizing:border-box;position:absolute;right:140px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    '#' + BTN_ID + ':hover{background:rgba(128,128,128,.16);color:rgba(26,29,33,.9)}',
    '#' + BTN_ID + '[data-on="1"]{background:rgba(47,111,237,.14);color:#2F6FED}',
    'body[data-ds-dark-theme] #' + BTN_ID + '{color:rgba(232,234,237,.6)}',
    'body[data-ds-dark-theme] #' + BTN_ID + ':hover{background:rgba(128,128,128,.22);color:rgba(232,234,237,.9)}',
    'body[data-ds-dark-theme] #' + BTN_ID + '[data-on="1"]{background:rgba(124,155,255,.18);color:#7C9BFF}',
    '#' + BTN_ID + '.dim{opacity:.35}',
    '#' + BTN_ID + ' svg{width:15px;height:15px;flex:none}',
    '#' + BTN_ID + ' .bdg{position:absolute;top:-3px;right:-10px;min-width:14px;height:14px;padding:0 4px;border-radius:7px;background:#CF222E;color:#FFF;white-space:nowrap;font:600 9px/14px -apple-system,"PingFang SC",sans-serif;text-align:center}',
  ].join('')

  /* 样式立即注入：按钮的定位/尺寸全靠它（懒注入会让按钮以原生
     样式流内落在标题栏模式徽章旁，尺寸失控） */
  const ensureStyle = () => {
    let style = document.getElementById(STYLE_ID)
    if (style === null) {
      style = document.createElement('style')
      style.id = STYLE_ID
      document.head.append(style)
    }
    style.textContent = CSS
  }
  ensureStyle()

  const report = (obj) => { console.log('__dsh_git__:' + JSON.stringify(obj)) }

  /* ---- 标题栏按钮（sessionlog 左侧；宿主由 theme-watcher 注入） ---- */
  const bar = () => document.getElementById('__dsh_desktop_titlebar')
  const injectBtn = () => {
    const host = bar()
    if (host === null || document.getElementById(BTN_ID) !== null) return host !== null
    const btn = document.createElement('button')
    btn.id = BTN_ID
    btn.title = 'git 环境'
    btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><circle cx="4.5" cy="4" r="1.8" fill="currentColor"/><circle cx="11.5" cy="3.2" r="1.8" fill="currentColor"/><circle cx="4.5" cy="12" r="1.8" fill="currentColor"/><circle cx="11.5" cy="12.8" r="1.8" fill="currentColor"/><path d="M4.5 5.8v4.4M11.5 5v5.4M6.3 4h3.4M6.3 12h3.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>'
    btn.onclick = () => report({ action: 'toggle' })
    host.append(btn)
    return true
  }
  let tries = 0
  const poll = setInterval(() => {
    if (injectBtn() || ++tries > 120) clearInterval(poll)
  }, 500)

  /* ---- 内容区右侧让位（主进程每次布局时调用；W=0 清除）----
     与 __dshPreviewPad 同款逻辑：互斥保证两者不同时非零，
     padding-right 不会互相覆盖 */
  window.__dshGitPad = (W) => {
    document.documentElement.style.setProperty('--dsh-git-inset', W > 0 ? W + 'px' : '0px')
    const cols = document.querySelectorAll('[class*="centerCol"], [class*="detailsCol"]')
    for (const el of cols) {
      if (W > 0) el.style.paddingRight = W + 'px'
      else el.style.removeProperty('padding-right')
    }
  }

  /* ---- 徽章/按钮态渲染（主进程推送时调用）---- */
  window.__dshGitBadge = (s) => {
    const btn = document.getElementById(BTN_ID)
    if (btn === null) return
    btn.classList.toggle('dim', s.isRepo !== true)
    btn.dataset.on = s.open === true ? '1' : '0'
    const delta = s.isRepo === true ? s.added + s.removed : 0
    let bdg = btn.querySelector('.bdg')
    if (delta > 0) {
      if (bdg === null) { bdg = document.createElement('span'); bdg.className = 'bdg'; btn.append(bdg) }
      bdg.textContent = '+' + s.added + ' \\u2212' + s.removed
    } else if (bdg !== null) bdg.remove()
  }
})()`

/**
 * git 面板管理器：每 shell 窗口一份。供 ipc.ts 的 git:* handlers、
 * windows.ts（互斥接线）与 file-activity（自动展开信号）调用。
 */
class GitPanel {
  private win: BrowserWindow | null = null
  private view: WebContentsView | null = null
  private visible = false
  /** 最近一次探测的裸快照（fetching/busy 合成在 push 时进行）。 */
  private snapshot: GitSnapshot = emptySnapshot()
  private fetching = false
  private busy = false
  /** 当前工作区绝对路径（file-activity 解析，null = 无）。 */
  private workspace: string | null = null
  /** 串行队列：探测与写操作严格排队（读到中间态不可能）。 */
  private probeQueue: Promise<unknown> = Promise.resolve()
  /** 面板打开时的周期重探。 */
  private pollTimer: ReturnType<typeof setInterval> | null = null
  /** activity → 重探 debounce。 */
  private probeDebounce: ReturnType<typeof setTimeout> | null = null
  /** 活动静默计时（到点解除手动关闭抑制）。 */
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  /** 用户手动关过 → 本次任务不再自动展开。 */
  private autoSuppressed = false
  /** 布局互斥钩子（windows.ts 接线：show 时收预览抽屉，防环只在此触发）。 */
  onShow: (() => void) | null = null

  /** shell 窗口创建后接线（重复调用安全）。 */
  attach(win: BrowserWindow): void {
    this.win = win
    const { webContents } = win
    const onConsole = (event: unknown, ...rest: unknown[]): void => {
      const message = consoleMessageText(event, rest)
      if (!message.startsWith(GIT_PREFIX)) return
      try {
        const payload = JSON.parse(message.slice(GIT_PREFIX.length)) as Record<string, unknown>
        if (payload.action === 'toggle') this.toggle()
      } catch { /* 非 JSON 忽略 */ }
    }
    const onDidLoad = (): void => {
      if (win.isDestroyed()) return
      webContents.executeJavaScript(PAGE_JS, true).catch(() => {
        // 页面跳转间隙执行失败属正常，下次加载会重试
      })
      // 让位随页面重注入（开合态在页面侧丢失，可见时补设）
      if (this.visible) this.pad(PAD_W)
      this.syncBadge()
    }
    webContents.on('console-message', onConsole)
    webContents.on('did-finish-load', onDidLoad)
    // 工作区切换：清快照重探（徽章跟随新工作区）
    const onWsChanged = (ws: string | null): void => {
      if (win.isDestroyed()) return
      this.workspace = ws
      this.snapshot = emptySnapshot()
      void this.probe()
    }
    fileActivity.on('workspace-changed', onWsChanged)
    // agent 文件活动：debounce 重探 + 自动展开 + 静默解除抑制
    const onActivity = (): void => {
      if (win.isDestroyed()) return
      if (this.probeDebounce !== null) clearTimeout(this.probeDebounce)
      this.probeDebounce = setTimeout(() => {
        this.probeDebounce = null
        void this.probe()
      }, ACTIVITY_DEBOUNCE_MS)
      if (this.idleTimer !== null) clearTimeout(this.idleTimer)
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null
        this.autoSuppressed = false
      }, AUTO_IDLE_MS)
      if (!this.visible && !this.autoSuppressed) this.show()
    }
    fileActivity.on('activity', onActivity)
    win.on('resize', () => { if (this.visible) this.layout() })
    win.once('closed', () => {
      webContents.removeListener('console-message', onConsole)
      webContents.removeListener('did-finish-load', onDidLoad)
      fileActivity.removeListener('workspace-changed', onWsChanged)
      fileActivity.removeListener('activity', onActivity)
      this.stopPoll()
      this.destroyView()
      this.win = null
    })
    // 初始工作区（attach 晚于首个 workspace-changed 时兜底）
    this.workspace = fileActivity.activeKey()
    void this.probe()
  }

  /** 应用退出前彻底清理。 */
  dispose(): void {
    this.stopPoll()
    this.destroyView()
  }

  toggle(): void {
    if (this.visible) this.hide(true)
    else this.show()
  }

  /** 展示面板（视图懒建；互斥钩子收预览抽屉）。 */
  show(): void {
    const win = this.win
    if (win === null || win.isDestroyed()) return
    this.visible = true
    // 互斥先行：对方 hide 的 pad(0) 清除发生在本面板 pad(W) 设置
    // 之前（同 webContents executeJavaScript 按调用序执行），
    // 后设者胜出，让位不会被误清
    this.onShow?.()
    if (this.view === null) {
      this.view = new WebContentsView({
        webPreferences: {
          preload: PRELOAD,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
        },
      })
      // 透明背景：页面内卡片自带圆角/阴影，view 矩形不露出底色
      //（View.setBackgroundColor 是文档指定的透明 view 做法）
      this.view.setBackgroundColor('#00000000')
      win.contentView.addChildView(this.view)
      const url = RENDERER_URL !== undefined
        ? `${RENDERER_URL}/#/git`
        : `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}#/git`
      void this.view.webContents.loadURL(url)
    } else {
      // 重挂到末尾置顶：终端/预览面板后建 view 时 z-order 在本面板
      // 之上，浮动卡片会被压住（remove+add 即移到顶层）
      win.contentView.removeChildView(this.view)
      win.contentView.addChildView(this.view)
    }
    this.view.setVisible(true)
    this.layout()
    this.startPoll()
    this.broadcast()
  }

  /**
   * 收起面板。manual=true（按钮/面板内关闭）置自动展开抑制；
   * 互斥联动（预览抽屉打开）传 false，保留自动展开资格。
   */
  hide(manual = true): void {
    this.visible = false
    this.view?.setVisible(false)
    this.pad(0)
    this.stopPoll()
    if (manual) this.autoSuppressed = true
    this.syncBadge()
    // 焦点还给上游页面
    this.win?.webContents.focus()
  }

  /** 供互斥接线（预览抽屉打开时收起，不影响自动展开语义）。 */
  hideByConflict(): void {
    this.hide(false)
  }

  /**
   * 在预览抽屉中打开计划文档（git 面板计划区点击）：预览抽屉切
   * 文件模式并展示——setMode(show) 触发互斥钩子收起本面板，
   * 抽屉内 markdown 走渲染视图（preview 视图按扩展名分流）。
   */
  openPlan(path: string): void {
    if (path === '') return
    const entry = fileActivity.open(path)
    previewPanel.setMode('files')
    previewPanel.forwardActivity(entry, true)
  }

  /** 当前快照（git:snapshot 拉取；fetching/busy 合成）。 */
  current(): GitSnapshot {
    return { ...this.snapshot, fetching: this.fetching, busy: this.busy }
  }

  /** 触发一次重探（git:refresh）。 */
  refresh(): Promise<void> {
    return this.probe()
  }

  /** git fetch（拉取上游；fetching 态即时推送，完成后快照再推）。 */
  fetch(): Promise<GitOpResult> {
    const cwd = this.requireWorkspace()
    if (cwd === null) return Promise.resolve(miss('当前无工作区'))
    this.fetching = true
    this.broadcast()
    const next = this.enqueue(async () => {
      const r = await runGit(['fetch'], cwd, FETCH_TIMEOUT_MS)
      if (!r.ok) return miss(firstLine(r.err))
      await this.doProbe()
      return { ok: true, error: null }
    })
    return next.finally(() => {
      this.fetching = false
      this.broadcast()
    })
  }

  /** 提交全部变更（add -A + commit -m）。 */
  commit(message: string): Promise<GitOpResult> {
    const cwd = this.requireWorkspace()
    if (cwd === null) return Promise.resolve(miss('当前无工作区'))
    const msg = message.trim()
    if (msg === '') return Promise.resolve(miss('提交信息为空'))
    return this.writeOp(async () => {
      const add = await runGit(['add', '-A'], cwd, OP_TIMEOUT_MS)
      if (!add.ok) return miss(firstLine(add.err))
      const c = await runGit(['commit', '-m', msg], cwd, OP_TIMEOUT_MS)
      if (!c.ok) return miss(firstLine(c.err))
      return { ok: true, error: null }
    })
  }

  /** 推送（有上游直接推，否则 -u origin HEAD 建立跟踪）。 */
  push(): Promise<GitOpResult> {
    const cwd = this.requireWorkspace()
    if (cwd === null) return Promise.resolve(miss('当前无工作区'))
    const args = this.snapshot.upstream !== null ? ['push'] : ['push', '-u', 'origin', 'HEAD']
    return this.writeOp(async () => {
      const r = await runGit(args, cwd, PUSH_TIMEOUT_MS)
      if (!r.ok) return miss(firstLine(r.err))
      return { ok: true, error: null }
    })
  }

  /** 切换本地分支（checkout；脏工作区被 git 拒绝时错误透出）。 */
  switchBranch(name: string): Promise<GitOpResult> {
    const cwd = this.requireWorkspace()
    if (cwd === null) return Promise.resolve(miss('当前无工作区'))
    const n = name.trim()
    if (n === '') return Promise.resolve(miss('分支名为空'))
    return this.writeOp(async () => {
      const r = await runGit(['checkout', n], cwd, OP_TIMEOUT_MS)
      if (!r.ok) return miss(firstLine(r.err))
      return { ok: true, error: null }
    })
  }

  /** 新建分支并切换（base 空 = 从当前 HEAD）。 */
  createBranch(name: string, base: string | null): Promise<GitOpResult> {
    const cwd = this.requireWorkspace()
    if (cwd === null) return Promise.resolve(miss('当前无工作区'))
    const n = name.trim()
    if (n === '') return Promise.resolve(miss('分支名为空'))
    if (/[\\\^\:\s~?\*\[]/.test(n) || n.startsWith('-') || n.includes('..') || n.includes('/.') || n.endsWith('.lock') || n.endsWith('/')) {
      return Promise.resolve(miss('分支名含非法字符'))
    }
    const b = base !== null ? base.trim() : ''
    return this.writeOp(async () => {
      const br = await runGit(b !== '' ? ['branch', n, b] : ['branch', n], cwd, OP_TIMEOUT_MS)
      if (!br.ok) return miss(firstLine(br.err))
      const co = await runGit(['checkout', n], cwd, OP_TIMEOUT_MS)
      if (!co.ok) return miss(firstLine(co.err))
      return { ok: true, error: null }
    })
  }

  /** 写操作包装：busy 态推送 → 排队执行 → 完成重探推送。 */
  private async writeOp(op: () => Promise<GitOpResult>): Promise<GitOpResult> {
    this.busy = true
    this.broadcast()
    try {
      return await this.enqueue(op)
    } finally {
      this.busy = false
      await this.probe()
      this.broadcast()
    }
  }

  /** 写操作前置校验的工作区。 */
  private requireWorkspace(): string | null {
    const ws = this.workspace
    if (ws === null || ws === '') return null
    return ws
  }

  /** 排入串行队列（探测/写操作互斥；返回自己的那次结果）。 */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.probeQueue.then(op)
    // 队尾吞错：后续排队不受前次失败影响（op 自身全 catch 语义）
    this.probeQueue = next.then(() => undefined, () => undefined)
    return next
  }

  /** 探测（串行；完成即推送）。 */
  private probe(): Promise<void> {
    return this.enqueue(() => this.doProbe())
  }

  private async doProbe(): Promise<void> {
    const cwd = this.workspace
    if (cwd === null || cwd === '') {
      this.snapshot = emptySnapshot()
      this.broadcast()
      return
    }
    this.snapshot = await probeGit(cwd)
    this.broadcast()
  }

  /** 面板视图推送（含 fetching/busy 合成）+ 标题栏徽章同步。 */
  private broadcast(): void {
    const wc = this.view?.webContents
    if (wc !== undefined && !wc.isDestroyed()) wc.send('git:changed', this.current())
    this.syncBadge()
  }

  /** 徽章/按钮态同步到上游页面（PAGE_JS 的 __dshGitBadge）。 */
  private syncBadge(): void {
    const win = this.win
    if (win === null || win.isDestroyed()) return
    const s = this.snapshot
    const payload = JSON.stringify({ isRepo: s.isRepo, added: s.added, removed: s.removed, open: this.visible })
    win.webContents.executeJavaScript(`window.__dshGitBadge ? window.__dshGitBadge(${payload}) : undefined`, true)
      .catch(() => { /* 页面跳转间隙失败属正常 */ })
  }

  /** 几何布局（浮动卡片矩形）+ 让位。 */
  private layout(): void {
    const win = this.win
    if (win === null || win.isDestroyed() || this.view === null) return
    const { width: contentW, height: contentH } = win.getContentBounds()
    const x = Math.max(contentW - PANEL_W - PANEL_MARGIN, 0)
    const h = Math.max(Math.min(contentH - PANEL_TOP - PANEL_MARGIN, PANEL_MAX_H), 200)
    this.view.setBounds({ x, y: PANEL_TOP, width: Math.min(PANEL_W, contentW), height: h })
    this.pad(PAD_W)
  }

  /** 让位注入（上游页面脚本就绪前的调用会静默丢失，布局时重设）。 */
  private pad(w: number): void {
    this.win?.webContents.executeJavaScript(`window.__dshGitPad ? window.__dshGitPad(${w}) : undefined`, true)
      .catch(() => { /* 页面跳转间隙失败属正常 */ })
  }

  private startPoll(): void {
    if (this.pollTimer !== null) return
    this.pollTimer = setInterval(() => { void this.probe() }, POLL_MS)
  }

  private stopPoll(): void {
    if (this.pollTimer === null) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private destroyView(): void {
    if (this.view === null) return
    const view = this.view
    this.view = null
    // closed 事件时窗口已销毁，contentView/webContents 访问即抛——
    // 摘除与关闭各自防御，任一失败不影响其余清理
    try { this.win?.contentView.removeChildView(view) } catch { /* 窗口已销毁 */ }
    try { view.setVisible(false) } catch { /* 已随窗口销毁 */ }
    try { view.webContents.close() } catch { /* 已销毁 */ }
  }
}

/** 空快照（无工作区/初始态）。 */
function emptySnapshot(): GitSnapshot {
  return {
    workspace: null, isRepo: false, branch: null, upstream: null, ahead: null, behind: null,
    staged: 0, changed: 0, untracked: 0, added: 0, removed: 0, branches: [], plans: [], commits: [],
    fetching: false, busy: false, error: null,
  }
}

/** 失败结果构造。 */
function miss(error: string | null): GitOpResult {
  return { ok: false, error }
}

/** 进程级单例（windows.ts 接线，ipc.ts 消费）。 */
export const gitPanel = new GitPanel()
