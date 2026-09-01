/**
 * @kkutysllb/dsh-file-attach — server 半（dsh web 插件，cordis patch 层挂载）。
 *
 * 文件附件定位链 RPC（不改引擎的文件附件通道：路径引用）：
 * - POST /dsh-file-attach/api/locate {name, cwd} → {ok, status, candidates}
 *   在 cwd 下按文件名搜索，还原浏览器 `<input type="file">` 只能拿到
 *   文件名的真实绝对路径；候选带 isDir（发送格式区分文件/目录行）。
 *   status：'found'（唯一命中）/ 'choose'（多候选，client chip 点选）/
 *   'none'（未命中）。
 *
 * 安全边界与 dsh-git-panel 同款：isTrusted（loopback 放行 +
 * webRuntime.trustedHosts）+ POST-only + JSON body。搜索用 execFile
 * 参数数组跑 `find`（POSIX）/ 固定脚本 + 环境变量传参的
 * Get-ChildItem（win32）——无 shell 拼接；文件名先经
 * normalizeAttachName（拒路径分隔符与 `..`），搜索结果再按 basename
 * 精确过滤（-name/-Filter 的 glob 语义误匹配兜底）。cwd 由 client 按
 * 当前会话工作区传入，server 不收任意搜索根之外的东西。
 *
 * 纯逻辑（名字校验/输出解析/深度排序/状态归纳）全部导出，
 * tests/run-tests.mjs 以 node 直跑覆盖。
 *
 * @module @kkutysllb/dsh-file-attach/entry
 */

import { execFile } from 'node:child_process'
import { basename, isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'

/** client-modules 集成对应的 cordis 依赖：RPC 注册必需 webServer。 */
export const inject = ['webServer']

/** RPC 前缀（client.js 的 API 常量与之对齐）。 */
export const RPC_PREFIX = '/dsh-file-attach/api'

/** 单次定位超时（毫秒；深目录全量 find 的兜底上限）。 */
const LOCATE_TIMEOUT_MS = 5000
/** 搜索深度上限（cwd 下层级；find -maxdepth / win32 -Depth 各自换算）。 */
const LOCATE_MAX_DEPTH = 6
/** 返回候选上限（超出截断，防同名海量文件撑爆 chip 选择器）。 */
const LOCATE_MAX_CANDIDATES = 8
/** stdout 上限（execFile maxBuffer；超限视为匹配过多直接失败）。 */
const LOCATE_MAX_BUFFER = 4 * 1024 * 1024
/** 定位中被剪枝的目录名（依赖与版本控制目录没有附件语义）。 */
const PRUNED_DIR_NAMES = ['node_modules', '.git']

/**
 * 附件名规范化：非空字符串、去首尾空白、拒路径分隔符与 `..` 段、
 * 长度 ≤255（常见文件系统上限）。非法返回 null。
 */
export function normalizeAttachName(name) {
  if (typeof name !== 'string') return null
  const n = name.trim()
  if (n === '' || n.length > 255) return null
  if (n === '.' || n === '..') return null
  if (n.includes('/') || n.includes('\\') || n.includes('\0')) return null
  return n
}

/** 命令输出 → 路径行数组（find -print / PS FullName 同为逐行输出）。 */
export function parseLocateOutput(stdout) {
  return String(stdout).split('\n').map(s => s.trim()).filter(s => s !== '')
}

/** 路径相对 cwd 的深度（段数；跨平台按 / 与 \\ 切）。 */
export function depthOf(p, cwd) {
  const norm = (s) => s.replace(/[\\/]+$/, '')
  const rel = norm(p).startsWith(norm(cwd)) ? norm(p).slice(norm(cwd).length) : p
  return rel.split(/[\\/]/).filter(Boolean).length
}

/**
 * 候选排序：深度浅者优先（越靠近 cwd 越可能是用户所指）→ mtime 新者
 * 优先 → 路径字典序兜底稳定。entries 为 {path, depth, mtimeMs} 数组，
 * isDir 由调用方补充，排序不感知。
 */
export function rankCandidates(entries) {
  return [...entries].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth
    if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  })
}

/** 命中数 → 定位状态（client chip 与发送等待逻辑共用此语义）。 */
export function chooseStatus(count) {
  if (count === 1) return 'found'
  if (count >= 2) return 'choose'
  return 'none'
}

/** 错误文案取首行（find/PS stderr 多行，chip 失败态只放一行）。 */
export function firstLine(s) {
  const l = String(s).split('\n').map(x => x.trim()).find(x => x !== '')
  return l === undefined ? null : l
}

/** locate：文件名 + 会话 cwd → 状态与候选（带 isDir，供发送行格式）。 */
export async function handleLocate(body, run = runLocate) {
  const name = normalizeAttachName(body?.name)
  if (name === null) return { ok: false, error: 'bad name' }
  const cwd = typeof body?.cwd === 'string' && isAbsolute(body.cwd) ? body.cwd : ''
  if (cwd === '') return { ok: false, error: 'bad cwd' }
  let lines
  try {
    lines = await run(name, cwd)
  } catch (error) {
    return { ok: false, error: firstLine(String(error?.message ?? error)) ?? 'locate failed' }
  }
  // basename 精确过滤：-name/-Filter 的 glob 语义可能意外多匹配。
  const hits = lines.filter((p) => basename(p) === name)
  const enriched = []
  for (const path of hits) {
    let isDir = false
    let mtimeMs = 0
    try {
      const s = await stat(path)
      isDir = s.isDirectory()
      mtimeMs = s.mtimeMs
    } catch { /* 竞态删除等：保留候选，按文件处理 */ }
    enriched.push({ path, isDir, depth: depthOf(path, cwd), mtimeMs })
  }
  const candidates = rankCandidates(enriched)
    .slice(0, LOCATE_MAX_CANDIDATES)
    .map(({ path, isDir }) => ({ path, isDir }))
  return { ok: true, status: chooseStatus(candidates.length), candidates }
}

/**
 * 按文件名在 cwd 下搜索（execFile 参数数组，无 shell）。
 * POSIX：find -prune 剪掉依赖/版本控制目录；win32：固定脚本 +
 * 环境变量传参的 Get-ChildItem（值不经过任何命令行解析）。
 * 命令非零退出但已有部分输出（find 遇无权限目录继续）时用部分结果。
 */
function runLocate(name, cwd) {
  const opts = {
    timeout: LOCATE_TIMEOUT_MS,
    maxBuffer: LOCATE_MAX_BUFFER,
    windowsHide: true,
  }
  if (process.platform === 'win32') {
    const script = 'Get-ChildItem -LiteralPath $env:DSA_FILE_ATTACH_DIR -Recurse '
      + `-Depth ${LOCATE_MAX_DEPTH - 1} -Filter $env:DSA_FILE_ATTACH_NAME -Force `
      + '-ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName'
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        ...opts,
        env: {
          ...process.env,
          DSA_FILE_ATTACH_DIR: cwd,
          DSA_FILE_ATTACH_NAME: name,
        },
      }, (err, stdout) => settle(err, stdout, resolve, reject))
    })
  }
  const args = [
    cwd,
    '-maxdepth', String(LOCATE_MAX_DEPTH),
    '(', ...PRUNED_DIR_NAMES.flatMap((n) => ['-name', n]), ')', '-prune',
    '-o', '-name', name, '-print',
  ]
  return new Promise((resolve, reject) => {
    execFile('find', args, opts, (err, stdout) => settle(err, stdout, resolve, reject))
  })
}

/** execFile 回调收敛：有输出优先（部分结果），无输出且报错则拒绝。 */
function settle(err, stdout, resolve, reject) {
  const lines = parseLocateOutput(stdout)
  if (lines.length > 0) {
    resolve(lines)
    return
  }
  if (err) {
    const msg = String(err?.message ?? err)
    reject(new Error(msg.includes('maxBuffer') ? 'too many matches' : msg))
    return
  }
  resolve([])
}

/** dsh web 插件入口：注册定位 RPC（effect 包裹，随插件 dispose 摘除）。 */
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
            if (method === 'locate') {
              writeJson(res, 200, await handleLocate(body))
              return
            }
            writeJson(res, 404, { ok: false, error: 'unknown method' })
          } catch (error) {
            writeJson(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    'dsh-file-attach: api',
  )
}

/* ---------------------------------------------------------------- *
 * RPC 公共（与 dsh-git-panel 同款安全边界实现）
 * ---------------------------------------------------------------- */

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0'
}

/** 请求来源校验：loopback 放行，其余对 trustedHosts。 */
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

/** 路径尾段即 method（/dsh-file-attach/api/locate → 'locate'）。 */
function methodOf(url) {
  try {
    const pathname = new URL(url ?? '/', 'http://x').pathname
    const segs = pathname.split('/').filter(Boolean)
    return segs.length > 0 ? decodeURIComponent(segs[segs.length - 1] ?? '') : ''
  } catch {
    return ''
  }
}
