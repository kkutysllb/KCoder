/**
 * @kcoder/terminal — server 半（dsh web 插件，cordis patch 层挂载）。
 *
 * 嵌入式终端 RPC（逻辑平移自退役宿主 desktop/main/pty-host.ts +
 * terminal-panel.ts，语义保持一致）：
 * - POST /kc-terminal/api/rpc     pty 操作（tabs/new/write/resize/
 *   restart/close，cwd 为工作区桶键）
 * - GET  /kc-terminal/api/stream  SSE 输出流（data/exit 事件带 bucket，
 *   全局一条广播，client 按当前桶路由；15s 心跳防代理断连）
 * - GET  /kc-terminal/api/vendor/<name>  xterm vendor 静态托管
 *   （client.js 自包含无 import，运行时懒拉 + eval；白名单三件）
 *
 * 安全边界与 @kcoder/git-panel 同款：isTrusted（loopback 放行 +
 * webRuntime.trustedHosts）；写操作 POST-only；SSE 为只读推送。
 *
 * pty 引擎：node-pty（VS Code 同款），经 createRequire 从运行时
 * node_modules 解析（bundle 物化在 profiles/web/node_modules/@kcoder/
 * terminal/，向上可达 profiles/node_modules/node-pty——dsh-tool-bash
 * 已带）。延迟加载：模块导入不触发 native 绑定加载，首次 create 才
 * require，环境异常时报错仅影响终端功能不拖垮宿主。
 *
 * 纯逻辑（桶管理/参数校验）导出供 tests/run-tests.mjs node 直跑；
 * spawn 集成用例走真 pty。
 *
 * @module @kcoder/terminal/entry
 */

import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'

/** client-modules 集成对应的 cordis 依赖：RPC 注册必需 webServer。 */
export const inject = ['webServer']

/** RPC 前缀（client.js 的 API 常量与之对齐）。 */
export const RPC_PREFIX = '/kc-terminal/api'

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

/** 延迟解析 node-pty（native 模块，导入期不加载）。 */
let ptyModule = null
function getPty() {
  if (ptyModule === null) {
    ptyModule = createRequire(import.meta.url)('node-pty')
  }
  return ptyModule
}

/** 标签信息（tabs/rpc 响应；与宿主 TerminalTab 契约一致）。 */
function tabOf(s) {
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/zsh')
  return { id: s.id, alive: !s.exited, cwd: s.cwd, title: basename(shell) }
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

  /** 新建标签到指定工作区桶（shell 进程立即启动）。 */
  create(cwd) {
    const bucket = this.bucketOf(cwd)
    const s = { id: this.nextId++, pty: null, cwd: usableDir(cwd) ?? homedir(), bucket, exited: false }
    this.bucket(bucket).set(s.id, s)
    this.spawn(s)
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
    for (const m of this.buckets.values()) m.delete(id)
    this.bucket(bucket).set(id, s)
    this.spawn(s)
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
    const pty = getPty()
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/zsh')
    const args = process.platform === 'win32' ? [] : ['--login']
    s.pty = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cwd: s.cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      cols: this.cols,
      rows: this.rows,
    })
    s.pty.onData(chunk => { this.events.emit('data', chunk, s.id, s.bucket) })
    s.pty.onExit(() => {
      s.exited = true
      s.pty = null
      this.events.emit('exit', s.id, s.bucket)
    })
  }
}

/* ---------------------------------------------------------------- *
 * RPC（/kc-terminal/api/{rpc,stream,vendor/<name>}）
 * ---------------------------------------------------------------- */

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0'
}

/** 请求来源校验（@kcoder/git-panel 同款）：loopback 放行，其余对 trustedHosts。 */
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
    default: return { ok: false, error: 'unknown op' }
  }
}

/** dsh web 插件入口：注册 RPC + SSE + vendor 托管（effect 包裹随 dispose 摘除）。 */
export function apply(ctx) {
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
    'kc-terminal: api',
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
