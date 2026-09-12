/**
 * @kkutysllb/dsh-terminal — server 半（dsh web 插件，cordis patch 层挂载）。
 *
 * 嵌入式终端 RPC（逻辑平移自退役宿主 desktop/main/pty-host.ts +
 * terminal-panel.ts，语义保持一致）：
 * - POST /dsh-terminal/api/rpc     pty 操作（tabs/new/write/resize/
 *   restart/close/snapshot，cwd 为工作区桶键）
 * - GET  /dsh-terminal/api/stream  SSE 输出流（data/exit 事件带 bucket，
 *   全局一条广播，client 按当前桶路由；15s 心跳防代理断连）
 * - GET  /dsh-terminal/api/vendor/<name>  xterm vendor 静态托管
 *   （client.js 自包含无 import，运行时懒拉 + eval；白名单三件）
 * - GET  /dsh-terminal/api/deps    node-pty 依赖状态（降级模式：缺失时
 *   返回 cause + 可粘贴的修复命令，前端渲染降级卡）
 *
 * 安全边界与 dsh-git-panel 同款：isTrusted（loopback 放行 +
 * webRuntime.trustedHosts）；写操作 POST-only；SSE 为只读推送。
 *
 * pty 引擎：node-pty（VS Code 同款，内核级伪终端 openpty/ConPTY），经
 * createRequire 从运行时 node_modules 解析（bundle 物化在 profile 的
 * node_modules 下，向上可达 profiles/node_modules/node-pty——dsh-tool-bash
 * 已带）。真实终端健壮性（模式平移自 dsh-coding-sidebar 的 pty-deps/
 * pty-manager）：
 * - 懒加载永不抛错：模块导入不触发 native 绑定加载；加载失败缓存原因，
 *   插件保持挂载（降级态），deps 路由给出修复命令，不拖垮宿主；
 * - ensureSpawnHelper：补回包管理器剥掉的 spawn-helper 可执行位（缺失
 *   时每个 spawn 都会 posix_spawnp failed），激活时幂等执行；
 * - transcript 环形缓冲（1MB/标签）：页面刷新 / 面板重建后经 snapshot
 *   RPC 回放历史，回放在途期间的新输出由 client 侧 pending 队列保序；
 * - shell 解析链：$SHELL → passwd 登录 shell → bash 兜底；Windows 上
 *   DSH_TERMINAL_SHELL env → pwsh 探测链 → powershell.exe 兜底。
 *
 * 纯逻辑（桶管理/参数校验/依赖层/shell 链）导出供 tests/run-tests.mjs
 * node 直跑；spawn 集成用例走真 pty。
 *
 * @module @kkutysllb/dsh-terminal/entry
 */

import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, realpathSync, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

/** client-modules 集成对应的 cordis 依赖：RPC 注册必需 webServer。 */
export const inject = ['webServer']

/** RPC 前缀（client.js 的 API 常量与之对齐）。 */
export const RPC_PREFIX = '/dsh-terminal/api'

/** vendor 白名单（文件名 → content-type；client 懒拉的三件）。 */
const VENDOR_FILES = {
  'xterm.js': 'text/javascript; charset=utf-8',
  'addon-fit.js': 'text/javascript; charset=utf-8',
  'xterm.css': 'text/css; charset=utf-8',
}

/** SSE 心跳间隔（毫秒；注释行保活，防中间层空闲断连）。 */
const SSE_HEARTBEAT_MS = 15000

/** 面板高度界限（与 client clamp 一致；拖拽在 client 端持久化）。 */
export const PANEL_MIN_H = 140
export const PANEL_MAX_H = 620
export const PANEL_DEFAULT_H = 280

/* ---------------------------------------------------------------- *
 * node-pty 依赖层（模式平移自 dsh-coding-sidebar src/pty-deps.ts）
 * ---------------------------------------------------------------- */

/**
 * node-pty 版本契约：须与 DSH core（@deepseek-ai/dsh-subprocess-local）
 * 声明同 range——同 range 同 integrity 让 pnpm 把两侧解析到同一物理包
 * （一份 native 绑定，无漂移）。换 fork 或改 range 前先核对 core 声明。
 */
export const DSH_NODE_PTY_RANGE = '^1.1.0'

/** 懒加载缓存：undefined=未加载；{ok:true,module} | {ok:false,cause}。 */
let ptyLoadCache

/**
 * 加载 node-pty（同步、单次、永不抛错）。模块缺失、native 绑定损坏、
 * pnpm 11 strict-dep-builds 跳过 install script 等都只会被记进缓存——
 * 插件保持挂载（降级态），由 deps 路由给出修复命令。
 */
export function loadNodePty() {
  if (ptyLoadCache === undefined) {
    try {
      ptyLoadCache = { ok: true, module: createRequire(import.meta.url)('node-pty') }
    } catch (cause) {
      ptyLoadCache = { ok: false, cause }
    }
  }
  return ptyLoadCache.ok ? ptyLoadCache.module : null
}

/** 已记录的加载失败原因（成功或未加载时 undefined）。 */
export function nodePtyLoadCause() {
  return ptyLoadCache !== undefined && !ptyLoadCache.ok ? ptyLoadCache.cause : undefined
}

/** 加载失败的一行人读描述。 */
function describeCause(cause) {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

/** 加载 node-pty 或抛规范错误（create/restart 路径；消息指向 deps 路由）。 */
function loadRequiredNodePty() {
  const m = loadNodePty()
  if (m === null) {
    throw new Error(
      'node-pty (' + DSH_NODE_PTY_RANGE + ') failed to load: ' + describeCause(nodePtyLoadCause())
      + ' -- see GET ' + RPC_PREFIX + '/deps for the repair command',
    )
  }
  return m
}

/** 解析到物理位置（symlink/link 安装），供 walk-up 探测。 */
function realDir(file) {
  try { return dirname(realpathSync(file)) } catch { return dirname(file) }
}

/** 从 dir 向上找满足条件的祖先根（限深 16 层）。 */
function walkUp(dir, isRoot) {
  let current = dir
  for (let depth = 0; depth < 16; depth += 1) {
    if (isRoot(current)) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/** 是否 DSH profile 根（package.json + pnpm-workspace.yaml 双证）。 */
function isProfileRoot(dir) {
  return existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'pnpm-workspace.yaml'))
}

/**
 * 探测本插件安装所在的 profile 目录：插件模块的最近双证祖先（profile
 * 根，插件从其 node_modules 解析）；探测不到回退 $DSH_HOME/profiles/web
 * （标准 web profile）；仍不像则 null。
 */
export function findProfileDir(fromFile = fileURLToPath(import.meta.url)) {
  const detected = walkUp(realDir(fromFile), isProfileRoot)
  if (detected !== null) return detected
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  const web = join(home, 'profiles', 'web')
  return isProfileRoot(web) ? realpathSync(web) : null
}

/**
 * node-pty 安装损坏时的可粘贴修复命令。本插件不随包发 install 脚本
 * （依赖 DSH core 侧的 node-pty），因此始终走 dsh plugin 重装兜底，
 * 并附 allowBuilds 提示（pnpm 11 拦 native 构建 scripts 的常见病因）。
 */
export function buildRepairCommand(options = {}) {
  const profileDir = options.profileDir !== undefined ? options.profileDir : findProfileDir()
  const name = profileDir !== null ? basename(profileDir) : 'web'
  return {
    command: 'dsh plugin --profile "' + name + '" install',
    note: "If pnpm 11 blocked node-pty's build script, ensure allowBuilds: node-pty: true"
      + " in the profile's pnpm-workspace.yaml, then rerun the install command.",
  }
}

/** deps 路由的响应形态：{ok:true} | {ok:false, cause, command, profile, note?}。 */
export function depsStatus() {
  const m = loadNodePty()
  if (m !== null) return { ok: true }
  const profileDir = findProfileDir()
  const { command, note } = buildRepairCommand({ profileDir })
  return {
    ok: false,
    cause: describeCause(nodePtyLoadCause()),
    command,
    profile: profileDir !== null ? basename(profileDir) : null,
    note,
  }
}

/**
 * 补回包管理器剥掉的 spawn-helper 可执行位（平移自 dsh-coding-sidebar
 * ensureSpawnHelper）：spawn-helper 是 macOS 侧 fork 并装配 pty 的
 * prebuilt 助手，丢执行位时每个 spawn 都报 posix_spawnp failed。幂等；
 * 解析或 chmod 失败静默——由 spawn 自身的报错暴露问题。
 */
export function ensureSpawnHelper() {
  if (process.platform === 'win32') return
  try {
    const require = createRequire(import.meta.url)
    const entry = require.resolve('node-pty')
    const packageRoot = dirname(dirname(entry))
    const candidates = [
      join(packageRoot, 'prebuilds', process.platform + '-' + process.arch, 'spawn-helper'),
      join(packageRoot, 'build', 'Release', 'spawn-helper'),
    ]
    for (const helper of candidates) {
      if (existsSync(helper)) chmodSync(helper, 0o755)
    }
  } catch {
    // 解析失败（依赖缺失）留给 deps 降级路径；chmod 失败由 spawn 报错暴露。
  }
}

/* ---------------------------------------------------------------- *
 * shell 解析链（平移自 dsh-coding-sidebar defaultShell 系）
 * ---------------------------------------------------------------- */

/**
 * Windows 侧可能装着 pwsh.exe 的目录：PATH 条目优先，其后机器/用户级
 * 已知安装位置（含 preview 通道与 per-user 布局）。机器级同时读
 * ProgramW6432 与 ProgramFiles（32 位 Node 的 ProgramFiles 指向 (x86)，
 * 仍要能找到 64 位 PowerShell 7）。去重且保持优先序。
 */
function windowsPwshCandidateDirs(env) {
  const dirs = []
  const pathEntries = env.PATH
  if (pathEntries !== undefined) {
    // win32 分支固定用 Windows PATH 分隔符；硬编码保证跨平台可测。
    for (const entry of pathEntries.split(';')) {
      const trimmed = entry.trim()
      if (trimmed !== '') dirs.push(trimmed)
    }
  }
  for (const programFiles of [env.ProgramW6432, env.ProgramFiles]) {
    if (programFiles === undefined || programFiles.trim() === '') continue
    dirs.push(join(programFiles, 'PowerShell', '7'))
    dirs.push(join(programFiles, 'PowerShell', '7-preview'))
  }
  const localAppData = env.LOCALAPPDATA
  if (localAppData !== undefined && localAppData.trim() !== '') {
    dirs.push(join(localAppData, 'Microsoft', 'PowerShell', '7'))
    dirs.push(join(localAppData, 'Microsoft', 'PowerShell', '7-preview'))
    dirs.push(join(localAppData, 'Programs', 'PowerShell', '7'))
    dirs.push(join(localAppData, 'Programs', 'PowerShell', '7-preview'))
  }
  return [...new Set(dirs)]
}

/**
 * 交互 shell 解析（像终端模拟器那样）：
 * - POSIX：$SHELL → passwd 登录 shell（userInfo().shell；服务管理器/
 *   容器 init 常不带 SHELL 启动 dsh，这一步让标签仍开用户的登录 shell
 *   而非静默降级 bash）→ /bin/bash 兜底；
 * - Windows：DSH_TERMINAL_SHELL env → PATH/已知目录的 pwsh.exe 探测链
 *   （PowerShell 7 用户不再拿到老 5.1）→ powershell.exe 兜底。
 * options 显式传参仅供测试注入平台/env/存在性探测。
 */
export function defaultShell(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync
  if (platform === 'win32') {
    const envShell = env.DSH_TERMINAL_SHELL
    if (envShell !== undefined && envShell.trim() !== '') return envShell.trim()
    for (const dir of windowsPwshCandidateDirs(env)) {
      const candidate = join(dir, 'pwsh.exe')
      if (exists(candidate)) return candidate
    }
    return 'powershell.exe'
  }
  const envShell = env.SHELL
  if (envShell !== undefined && envShell.trim() !== '') return envShell.trim()
  // uid 无 passwd 条目时 userInfo() 会抛（罕见 chroot）：兜底 /bin/bash。
  try {
    const loginShell = userInfo().shell
    if (typeof loginShell === 'string' && loginShell.trim() !== '') return loginShell
  } catch { /* 无 passwd 条目：落到 bash 兜底 */ }
  return '/bin/bash'
}

/**
 * spawn 参数：POSIX 走登录 shell（读 ~/.profile ~/.zprofile 等 profile
 * 文件）；Windows PowerShell 不收登录旗标。显式传入时整体替换默认。
 */
export function shellSpawnArgs(configured = []) {
  if (configured.length > 0) return [...configured]
  return process.platform === 'win32' ? [] : ['-l']
}

/** 标签标题用的 shell 短名：/bin/zsh → zsh，C:\...\pwsh.exe → pwsh。 */
export function shellDisplayName(shell) {
  const normalized = shell.replace(/\\/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  if (base === '') return shell
  return base.replace(/\.(exe|cmd|bat)$/i, '')
}

/* ---------------------------------------------------------------- *
 * transcript（回放缓冲；平移自 dsh-coding-sidebar 的环形裁剪语义）
 * ---------------------------------------------------------------- */

/** 单标签 transcript 上限（字符；超出丢头保尾）。 */
export const TRANSCRIPT_LIMIT = 1 << 20

/** 追加一块输出并裁剪到上限（纯函数，供测试）。 */
export function appendTranscript(prev, chunk) {
  const next = prev + chunk
  return next.length > TRANSCRIPT_LIMIT ? next.slice(next.length - TRANSCRIPT_LIMIT) : next
}

/** 标签信息（tabs/rpc 响应；与宿主 TerminalTab 契约一致）。 */
function tabOf(s) {
  return { id: s.id, alive: !s.exited, cwd: s.cwd, title: shellDisplayName(s.shell ?? defaultShell()) }
}

function killPty(s) {
  if (s.pty !== null) {
    try { s.pty.kill() } catch { /* 已退出 */ }
    s.pty = null
  }
}

/** 目录可用性校验：存在且是目录才采用，否则交给回退。 */
export function usableDir(path) {
  if (path === null || path === undefined || path === '') return null
  try {
    if (!statSync(path).isDirectory()) return null
    return path
  } catch {
    return null
  }
}

/** 供面板 header 显示的目录短名。 */
export function dirLabel(cwd) {
  if (cwd === '') return '~'
  return basename(cwd) || cwd
}

/** 高度 clamp（插件版本地持久化，服务端不再管高度；导出仅为测试对齐）。 */
export function clampH(h) {
  return Math.min(PANEL_MAX_H, Math.max(PANEL_MIN_H, Math.round(h)))
}

/**
 * pty 会话宿主（平移自宿主 PtyHost）：每工作区一份私有 sessions 池
 * （buckets = Map<cwd, Map<id, session>>），不同工作区互不干扰；
 * id 全局唯一跨桶可寻址；面板关闭仅隐藏不杀进程，restart 销毁重建
 * 同 id，close 关单标签。事件：data(chunk, id, bucket) / exit(id, bucket)。
 * 每会话维护 transcript 环形缓冲（snapshot RPC 供 client 回放历史，
 * 退出会话仍可回放）；spawn 失败时 create 回滚入桶、restart 如实标退出。
 */
export class PtyHost {
  constructor() {
    this.events = new EventEmitter()
    this.buckets = new Map()
    this.nextId = 1
    this.cols = 80
    this.rows = 24
  }

  bucketOf(cwd) {
    return cwd !== null && cwd !== undefined ? cwd : ''
  }

  bucket(cwd) {
    const key = this.bucketOf(cwd)
    let m = this.buckets.get(key)
    if (m === undefined) { m = new Map(); this.buckets.set(key, m) }
    return m
  }

  /** 当前工作区全部标签快照（Map 迭代序即创建序）。 */
  list(cwd) {
    const m = this.buckets.get(this.bucketOf(cwd))
    return m === undefined ? [] : [...m.values()].map(tabOf)
  }

  /** 全部桶标签快照（调试/清账用）。 */
  listAll() {
    const out = []
    for (const m of this.buckets.values()) for (const s of m.values()) out.push(tabOf(s))
    return out
  }

  /** 单个标签信息（按全局 id 查，跨桶一次）。 */
  info(id) {
    const s = this.find(id)
    return s === null ? null : tabOf(s)
  }

  /** 全局 id 定位 session（id 全局唯一，跨桶查找一次即可）。 */
  find(id) {
    for (const m of this.buckets.values()) {
      const s = m.get(id)
      if (s !== undefined) return s
    }
    return null
  }

  /** 新建标签到指定工作区桶（shell 进程立即启动；spawn 失败回滚入桶）。 */
  create(cwd) {
    const bucket = this.bucketOf(cwd)
    const s = { id: this.nextId++, pty: null, cwd: usableDir(cwd) ?? homedir(), bucket, exited: false, transcript: '', shell: null }
    this.bucket(bucket).set(s.id, s)
    try {
      this.spawn(s)
    } catch (error) {
      this.bucket(bucket).delete(s.id)
      throw error
    }
    return tabOf(s)
  }

  /** 面板打开时确保指定工作区桶至少有一个标签（无则新建）。 */
  ensureFirst(cwd) {
    const first = this.bucket(cwd).values().next().value
    if (first !== undefined) return tabOf(first)
    return this.create(cwd)
  }

  /** 销毁对应标签并以（可能已变化的）工作区目录重建（同 id，跨桶迁移）。 */
  restart(id, preferredCwd) {
    const bucket = this.bucketOf(preferredCwd)
    const s = this.buckets.get(bucket)?.get(id)
    if (s === undefined) return null
    const cwd = usableDir(preferredCwd) ?? s.cwd ?? homedir()
    killPty(s)
    s.cwd = cwd
    s.bucket = bucket
    s.exited = false
    s.transcript = ''
    for (const m of this.buckets.values()) m.delete(id)
    this.bucket(bucket).set(id, s)
    try {
      this.spawn(s)
    } catch (error) {
      // 重建失败：标签如实标退出并发 exit（前端显示退出条），错误上抛给 rpc。
      s.exited = true
      this.events.emit('exit', s.id, s.bucket)
      throw error
    }
    return tabOf(s)
  }

  write(id, data) {
    this.find(id)?.pty?.write(data)
  }

  resize(id, cols, rows) {
    const s = this.find(id)
    if (s === undefined || s === null) return
    this.cols = cols
    this.rows = rows
    try { s.pty?.resize(cols, rows) } catch {
      // 进程退出瞬间 resize 会抛错，忽略（exit 事件会接手）
    }
  }

  /** 标签的回放缓冲（退出会话仍可回放；未知 id 返回 null）。 */
  snapshot(id) {
    const s = this.find(id)
    return s === null ? null : s.transcript
  }

  /** 关闭单个标签（仅限 cwd 桶内：跨桶 id 一律不动），返回剩余标签。 */
  close(id, cwd) {
    const bucket = this.bucketOf(cwd)
    const s = this.buckets.get(bucket)?.get(id)
    if (s === undefined) return this.list(cwd)
    killPty(s)
    this.buckets.get(bucket)?.delete(id)
    return this.list(cwd)
  }

  /** 彻底销毁全部会话（插件 dispose 时调用）。 */
  dispose() {
    for (const m of this.buckets.values())
      for (const s of m.values()) killPty(s)
    this.buckets.clear()
  }

  spawn(s) {
    const pty = loadRequiredNodePty()
    const shell = defaultShell()
    const args = shellSpawnArgs()
    s.shell = shell
    s.pty = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cwd: s.cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      cols: this.cols,
      rows: this.rows,
    })
    s.pty.onData(chunk => {
      s.transcript = appendTranscript(s.transcript, chunk)
      this.events.emit('data', chunk, s.id, s.bucket)
    })
    s.pty.onExit(() => {
      s.exited = true
      s.pty = null
      this.events.emit('exit', s.id, s.bucket)
    })
  }
}

/* ---------------------------------------------------------------- *
 * RPC（/dsh-terminal/api/{rpc,stream,vendor/<name>}）
 * ---------------------------------------------------------------- */

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0'
}

/** 请求来源校验（dsh-git-panel 同款）：loopback 放行，其余对 trustedHosts。 */
export function isTrusted(req, trustedHosts) {
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

/** RPC 操作分派（纯逻辑导出供测试；pty 实例操作走 host）。 */
export function dispatchRpc(host, body) {
  const op = typeof body?.op === 'string' ? body.op : ''
  const cwd = typeof body?.cwd === 'string' && body.cwd !== '' ? body.cwd : null
  switch (op) {
    case 'tabs': return { ok: true, tabs: host.list(cwd) }
    case 'new': return { ok: true, tab: host.create(cwd) }
    case 'write':
      if (typeof body.id !== 'number' || typeof body.data !== 'string') return { ok: false, error: 'bad id/data' }
      host.write(body.id, body.data)
      return { ok: true }
    case 'resize': {
      if (typeof body.id !== 'number' || typeof body.cols !== 'number' || typeof body.rows !== 'number') {
        return { ok: false, error: 'bad id/cols/rows' }
      }
      host.resize(body.id, body.cols, body.rows)
      return { ok: true }
    }
    case 'restart': {
      if (typeof body.id !== 'number') return { ok: false, error: 'bad id' }
      return { ok: true, tab: host.restart(body.id, cwd) }
    }
    case 'close': {
      if (typeof body.id !== 'number') return { ok: false, error: 'bad id' }
      return { ok: true, tabs: host.close(body.id, cwd) }
    }
    case 'snapshot': {
      if (typeof body.id !== 'number') return { ok: false, error: 'bad id' }
      return { ok: true, chunk: host.snapshot(body.id) }
    }
    default: return { ok: false, error: 'unknown op' }
  }
}

/** dsh web 插件入口：注册 RPC + SSE + vendor + deps（effect 包裹随 dispose 摘除）。 */
export function apply(ctx) {
  // 真实终端前置换修：macOS 侧 prebuilt spawn-helper 的可执行位可能被
  // 包管理器剥掉（幂等，失败静默，由 spawn 自身报错兜底暴露）。
  ensureSpawnHelper()
  const host = new PtyHost()
  /** 活跃 SSE 客户端（res 集；断开即摘除）。 */
  const sseClients = new Set()
  // 帧不带 event: 行（保持默认 message 事件，client 端 onmessage 直收）
  const onData = (chunk, id, bucket) => {
    const frame = `data: ${JSON.stringify({ type: 'data', bucket, id, chunk })}\n\n`
    for (const res of sseClients) res.write(frame)
  }
  const onExit = (id, bucket) => {
    const frame = `data: ${JSON.stringify({ type: 'exit', bucket, id })}\n\n`
    for (const res of sseClients) res.write(frame)
  }
  host.events.on('data', onData)
  host.events.on('exit', onExit)
  const heartbeat = setInterval(() => {
    for (const res of sseClients) res.write(`: ping\n\n`)
  }, SSE_HEARTBEAT_MS)
  if (typeof heartbeat.unref === 'function') heartbeat.unref()

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
          let pathname = '/'
          try { pathname = new URL(req.url ?? '/', 'http://x').pathname } catch { /* 兜底 '/' */ }
          const tail = pathname.slice(RPC_PREFIX.length).replace(/^\/+/, '')

          // SSE 输出流（只读 GET；持有响应即订阅，断开即退订）
          if (tail === 'stream') {
            if (req.method !== 'GET') {
              writeJson(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            res.statusCode = 200
            res.setHeader('content-type', 'text/event-stream; charset=utf-8')
            res.setHeader('cache-control', 'no-store')
            res.setHeader('connection', 'keep-alive')
            res.write(': open\n\n')
            sseClients.add(res)
            req.on('close', () => { sseClients.delete(res) })
            return
          }

          // xterm vendor 静态托管（白名单三件；client 懒拉 + eval）
          if (tail.startsWith('vendor/')) {
            const name = tail.slice('vendor/'.length)
            const type = VENDOR_FILES[name]
            if (type === undefined) {
              writeJson(res, 404, { ok: false, error: 'unknown vendor file' })
              return
            }
            try {
              const text = await readFile(new URL(`./vendor/${name}`, import.meta.url))
              res.statusCode = 200
              res.setHeader('content-type', type)
              res.setHeader('cache-control', 'no-store')
              res.end(text)
            } catch (error) {
              writeJson(res, 500, { ok: false, error: String(error?.message ?? error) })
            }
            return
          }

          // node-pty 依赖状态（降级模式：cause + 可粘贴修复命令）
          if (tail === 'deps') {
            if (req.method !== 'GET') {
              writeJson(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            writeJson(res, 200, depsStatus())
            return
          }

          // pty 操作 RPC（写操作 POST-only）
          if (tail === 'rpc') {
            if (req.method !== 'POST') {
              writeJson(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            let body = {}
            try { body = await readJsonBody(req) } catch {
              writeJson(res, 400, { ok: false, error: 'bad json body' })
              return
            }
            try {
              writeJson(res, 200, dispatchRpc(host, body))
            } catch (error) {
              writeJson(res, 500, { ok: false, error: String(error?.message ?? error) })
            }
            return
          }

          writeJson(res, 404, { ok: false, error: 'unknown method' })
        },
      }),
    'dsh-terminal: api',
  )

  // 插件停用时杀全部 shell + 摘事件（cordis effect 反向函数）
  return () => {
    clearInterval(heartbeat)
    host.events.off('data', onData)
    host.events.off('exit', onExit)
    for (const res of sseClients) res.end()
    sseClients.clear()
    host.dispose()
  }
}
