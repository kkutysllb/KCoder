/**
 * 活动订阅器：作为第二个客户端连 dsh 的 mux 事件流，跟踪 agent 的
 * 读/编辑文件活动（tool/result 的 view 卡片），供两个消费方使用：
 * - 工作区基准（skills-catalog）：`activeKey()` 给出当前工作区，
 *   供工作区项目技能目录探位；
 * - 正文文件徽章（workspace-probe）：当前工作区的 edit 活动推给
 *   shell 页面加 +n/−n 统计，历史部分从 session.history 补拉
 *   （页面探针拦截上报触发，首页即够）。
 *
 * 上游契约（packages/host/apiproxy/src/api/events.ts + core/tools
 * presentation.ts + core/session/src/types.ts + client/connection
 * websocket-downlink.ts，全部运行时消费，零修改）：
 * - mux 流：`ws://127.0.0.1:<port>/api/events.mux`，连上即推、客户端
 *   只读（发消息是协议违规）；Node WebSocket 客户端不带 Origin 头，
 *   走 loopback 受信分支，无需 token；
 * - WS 下行线每帧包 ServerRequest 信封（websocket-downlink 的
 *   serverRequest()）：`{type:'server-request', rpcId, method, payload}`，
 *   业务帧在 payload——method === 'session/event' 时 payload 形状 =
 *   {type:'session/event', sessionId, event, view?}；SessionEvent
 *   形状 = {type, seq, time, data}；
 * - 文件活动只关心 `event.type === 'tool/result'` 且 `view.for === 'result'`：
 *   - `view.view.card === 'read'`：ReadResultView（path/lines/lang/
 *     totalLines，行号齐全）；
 *   - `view.view.card === 'diff'`：DiffResultView（diffs = applied
 *     contextual hunks，`{path, oldText|null, newText}`）；
 * - view 是 host 侧即时推导的渲染意图、不持久化——断线重连前发生的
 *   活动不会重放。历史会话的活动通过 {@link FileActivity.fetchHistory}
 *   补拉：session.history RPC 的 HistoryEntry 携带同一形状的 view
 *   （分页时推导），页面打开会话时由注入 hook 上报 sessionId 触发。
 *
 * 生命周期跟随 dshManager：ready 即连（重启换端口自动重连），其余
 * 状态断开；活动按文件聚合（同文件取最新），上限 {@link MAX_ENTRIES}。
 *
 * 工作区隔离：mux 流推送所有会话的活动，多工作区并存时直接入同一
 * 张表会互串。按「会话 → 工作区」归属分桶存储——归属映射来自
 * workspace.list 的 sessionIds（主进程自拉，5s 节流 + in-flight
 * 去重）；映射未收录的新会话先按当前工作区兑底（新会话总是在当前
 * 工作区创建），映射刷新后后续事件归位。相对路径同样按归属工作区
 * 解析。list() 只面向当前工作区桶；跨工作区实时活动不转发（消费方
 * 按 wsKey 过滤）。
 *
 * @module desktop/main/file-activity
 */

import { EventEmitter } from 'node:events'
import { isAbsolute, join } from 'node:path'
import { dshManager } from './dsh-manager'
import type { PreviewEntry } from '@shared/ipc-contract'

/** 聚合后的活动条目上限（每工作区桶独立计算，超出丢最老）。 */
const MAX_ENTRIES = 300

/** 断线重连间隔（毫秒）。 */
const RECONNECT_MS = 2_000

/** 会话归属映射的刷新节流（毫秒；失败同样退避）。 */
const MAPPING_TTL_MS = 5_000

/** diff 行数统计的 DP 上限（乘积），超过退化为粗略计数。 */
const LCS_CELL_LIMIT = 4_000_000

/** 常见扩展名 → 高亮语言提示（上游 read 视图给 lang 时优先）。 */
const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'xml', xml: 'xml', svg: 'xml',
  md: 'md', mdx: 'md',
  py: 'py', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  cs: 'cs', swift: 'swift', kt: 'kotlin',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  sql: 'sql', lua: 'lua', php: 'php', dart: 'dart',
}

/** 活动条目文本摘录的截断长度（textOfBlocks 用；子代理监控同用）。 */
const TRAJ_TEXT_CHARS = 240

/** 从消息 content 块里拼文本摘录（text 块拼接；纯图片/纯工具调用为 null）。子代理监控同用。 */
export function textOfBlocks(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  let text = ''
  for (const block of content) {
    if (block !== null && typeof block === 'object'
      && (block as Record<string, unknown>).type === 'text'
      && typeof (block as Record<string, unknown>).text === 'string') {
      text += (text === '' ? '' : '\n') + (block as Record<string, unknown>).text as string
    }
  }
  if (text === '') return null
  return text.length > TRAJ_TEXT_CHARS ? text.slice(0, TRAJ_TEXT_CHARS - 1) + '…' : text
}

function langOf(path: string, hint: unknown): string | null {
  if (typeof hint === 'string' && hint !== '') return hint
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  const ext = path.slice(dot + 1).toLowerCase()
  return EXT_LANG[ext] ?? null
}

/** 行数统计：LCS 公共行（首尾公共行 trim 后 DP，超限退化粗略值）。 */
function countChanges(oldText: string | null, newText: string): { added: number; removed: number } {
  const oldLines = oldText === null ? [] : oldText.split('\n')
  const newLines = newText.split('\n')
  // 首尾公共行裁剪（未变更的上下文大头）
  let head = 0
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++
  let tail = 0
  while (
    tail < oldLines.length - head && tail < newLines.length - head
    && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  ) tail++
  const a = oldLines.slice(head, oldLines.length - tail)
  const b = newLines.slice(head, newLines.length - tail)
  if (a.length === 0 || b.length === 0) {
    return { added: b.length, removed: a.length }
  }
  if (a.length * b.length > LCS_CELL_LIMIT) {
    // 超大 hunk：粗略（宁多勿漏，仅影响 badge 数字）
    return { added: b.length, removed: a.length }
  }
  // 经典 LCS DP（滚动行）
  let prev = new Uint32Array(b.length + 1)
  let curr = new Uint32Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1])
    }
    const swap = prev; prev = curr; curr = swap
    curr.fill(0)
  }
  const common = prev[b.length]
  return { added: b.length - common, removed: a.length - common }
}

/** WS 下行线的 ServerRequest 信封（业务帧在 payload）。 */
interface MuxEnvelope {
  type: string
  rpcId?: string
  method?: string
  payload?: MuxFrame
}

/** mux 业务帧的最小形状（只声明消费的字段；event = SessionEvent 外壳）。子代理监控也消费（onFrame）。 */
export interface MuxFrame {
  type: string
  sessionId?: string
  event?: { type?: string; seq?: number; time?: number; data?: unknown }
  view?: { for?: string; view?: Record<string, unknown> }
}

/**
 * 订阅器单例。`setWorkspace` 由 workspace-probe 探针解析的工作区路径
 * 喂进（当前显示哪个工作区的桶；相对 path 按归属工作区解析）。
 */
class FileActivity extends EventEmitter {
  /** 工作区路径 →（绝对路径 → 条目）：活动按工作区隔离，切换互不污染。 */
  private readonly buckets = new Map<string, Map<string, PreviewEntry>>()
  private ws: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  /** 当前页面选中的工作区（list() 的目标桶；null = 无工作区）。 */
  private activeWorkspace: string | null = null
  /** sessionId → 工作区路径（workspace.list 的 sessionIds 归属）。 */
  private readonly sessionWorkspace = new Map<string, string>()
  private mappingAt = 0
  private mappingBusy: Promise<void> | null = null
  /** 最近一次历史补拉的会话与时间（翻页重复上报去重）。 */
  private lastHistorySession = ''
  private lastHistoryAt = 0

  constructor() {
    super()
    dshManager.on('state-changed', (status) => {
      if (status.state === 'ready' && status.url !== null) this.connect(status.url)
      else this.disconnect()
    })
    const current = dshManager.status
    if (current.state === 'ready' && current.url !== null) this.connect(current.url)
  }

  /** 页面探针解析的当前工作区（workspace-probe 喂进；变化时发 workspace-changed，git 面板重探徽章跟随）。 */
  setWorkspace(path: string | null): void {
    const next = path !== null && path !== '' ? path : null
    if (next === this.activeWorkspace) return
    this.activeWorkspace = next
    this.emit('workspace-changed', next)
  }

  /** 当前工作区桶键（无工作区时空串，桶仍可用但不常展示）。 */
  activeKey(): string {
    return this.activeWorkspace ?? ''
  }

  /** 聚合条目（最新在前；只含当前工作区）。 */
  list(): PreviewEntry[] {
    const bucket = this.buckets.get(this.activeKey())
    return bucket === undefined ? [] : [...bucket.values()].reverse()
  }

  /** mux 帧观察口（subagent-monitor 消费子会话事件；只读，勿改帧）。 */
  onFrame(cb: (frame: MuxFrame) => void): void {
    this.on('frame', cb)
  }

  /** 应用退出前清理。 */
  dispose(): void {
    this.disconnect()
  }
  
  /**
   * 拉会话历史补活动（页面打开/切换会话时由注入 hook 触发）：mux
   * 不重放历史，读/编辑活动只能从 session.history 的分页时 view 推导
   * 补回。失败静默（面板退化为只显示实时活动）。
   */
  async fetchHistory(sessionId: string): Promise<void> {
    const now = Date.now()
    // 同会话翻页会重复上报（每页一次 RPC），短窗口去重只拉首页
    if (sessionId === this.lastHistorySession && now - this.lastHistoryAt < 5_000) return
    const status = dshManager.status
    if (status.state !== 'ready' || status.url === null) return
    try {
      // 先刷新归属映射：历史会话可能属于其他工作区（跨工作区点开），
      // 兑现不了时（新会话）按当前工作区兑底
      await this.refreshMapping()
      const wsKey = this.workspaceOfSession(sessionId)
      // 与页面同源的 POST RPC（Node fetch 不带 Origin，loopback 受信）
      const resp = await fetch(`${status.url}/api/session.history`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: `kcoder-history-${now}`,
          method: 'session.history',
          payload: { sessionId },
        }),
      })
      if (!resp.ok) return
      const body = JSON.parse(await resp.text()) as {
        result?: {
          ok?: boolean
          value?: { events?: Array<{ view?: { for?: string; view?: Record<string, unknown> } }> }
        }
      }
      const events = body.result?.ok === true ? body.result.value?.events : undefined
      if (!Array.isArray(events)) return
      this.lastHistorySession = sessionId
      this.lastHistoryAt = Date.now()
      for (const e of events) {
        // HistoryEntry.view 与 mux 帧同构（ToolEventView：for + view.card）
        if (e?.view?.for !== 'result' || e.view.view === undefined) continue
        const entry = this.entryFromCard(e.view.view, wsKey)
        // replay=true：历史回放只进列表，不触发 git 面板自动展开
        if (entry !== null) this.record(entry, wsKey, true)
      }
    } catch {
      // dsh 重启间隙 / 响应非 JSON 等：静默，下次会话打开重试
    }
  }

  private connect(httpUrl: string): void {
    this.disconnect()
    const wsUrl = httpUrl.replace(/^http/, 'ws') + '/api/events.mux'
    let socket: WebSocket
    try {
      socket = new WebSocket(wsUrl)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = socket
    socket.onopen = () => { /* 连上即推，无订阅握手 */ }
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return
      let envelope: MuxEnvelope
      try { envelope = JSON.parse(event.data) as MuxEnvelope } catch { return }
      // ServerRequest 信封解包：只认 session/event 业务帧（其余 method
      // 忽略；历史版本误把信封当业务帧解析，实时活动全部丢弃）
      if (envelope.type !== 'server-request'
        || envelope.method !== 'session/event'
        || envelope.payload === undefined) return
      this.consume(envelope.payload)
    }
    socket.onclose = () => {
      if (this.ws === socket) this.ws = null
      if (dshManager.status.state === 'ready') this.scheduleReconnect()
    }
    socket.onerror = () => { /* onclose 随后到，重连统一在那里处理 */ }
  }

  private disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const socket = this.ws
    this.ws = null
    if (socket !== null) {
      socket.onclose = null
      socket.onmessage = null
      socket.onerror = null
      try { socket.close() } catch { /* 已关闭 */ }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      const status = dshManager.status
      if (status.state === 'ready' && status.url !== null) this.connect(status.url)
    }, RECONNECT_MS)
  }

  private consume(frame: MuxFrame): void {
    if (frame.type !== 'session/event') return
    this.emit('frame', frame)
    if (frame.event?.type !== 'tool/result') return
    const view = frame.view
    if (view?.for !== 'result' || view.view === undefined) return
    const sessionId = typeof frame.sessionId === 'string' && frame.sessionId !== '' ? frame.sessionId : null
    const wsKey = this.workspaceOfSession(sessionId)
    const entry = this.entryFromCard(view.view, wsKey)
    if (entry === null) return
    this.record(entry, wsKey)
  }

  /** 会话 → 归属工作区桶键；映射未收录时触发节流刷新，本帧先按当前工作区兑底。 */
  private workspaceOfSession(sessionId: string | null): string {
    if (sessionId !== null) {
      const hit = this.sessionWorkspace.get(sessionId)
      if (hit !== undefined) return hit
      void this.refreshMapping()
    }
    return this.activeKey()
  }

  /** workspace.list → sessionWorkspace 全量重建（节流 + in-flight 去重）。 */
  private refreshMapping(): Promise<void> {
    if (this.mappingBusy !== null) return this.mappingBusy
    const now = Date.now()
    if (now - this.mappingAt < MAPPING_TTL_MS) return Promise.resolve()
    const status = dshManager.status
    if (status.state !== 'ready' || status.url === null) return Promise.resolve()
    const url = status.url
    this.mappingBusy = (async () => {
      try {
        const resp = await fetch(`${url}/api/workspace.list`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: `kcoder-wsmap-${now}`,
            method: 'workspace.list',
            payload: {},
          }),
        })
        if (resp.ok) {
          const body = JSON.parse(await resp.text()) as {
            result?: { ok?: boolean; value?: { items?: unknown } }
          }
          const items = body.result?.ok === true ? body.result.value?.items : undefined
          if (Array.isArray(items)) {
            this.sessionWorkspace.clear()
            for (const it of items) {
              if (it === null || typeof it !== 'object') continue
              const item = it as { path?: unknown; sessionIds?: unknown }
              const path = typeof item.path === 'string' && item.path !== '' ? item.path : null
              if (path === null || !Array.isArray(item.sessionIds)) continue
              for (const sid of item.sessionIds) {
                if (typeof sid === 'string' && sid !== '') this.sessionWorkspace.set(sid, path)
              }
            }
          }
        }
      } catch {
        // dsh 重启间隙 / 响应非 JSON 等：静默，下次触发重试
      } finally {
        // 成败都记时：失败也退避，避免每帧重试
        this.mappingAt = Date.now()
        this.mappingBusy = null
      }
    })()
    return this.mappingBusy
  }

  /** view.view（card）→ 活动条目；不可识别的 card 返回 null。 */
  private entryFromCard(card: Record<string, unknown>, wsKey: string): PreviewEntry | null {
    if (card.card === 'read') {
      const path = typeof card.path === 'string' ? card.path : null
      if (path === null) return null
      return {
        path: this.resolve(path, wsKey),
        kind: 'read',
        at: Date.now(),
        added: 0,
        removed: 0,
        lang: langOf(path, card.lang),
        diffs: null,
      }
    }
    if (card.card === 'diff') {
      const diffsRaw = Array.isArray(card.diffs) ? card.diffs : []
      const diffs = diffsRaw.flatMap((d) => {
        if (d === null || typeof d !== 'object') return []
        const p = typeof (d as Record<string, unknown>).path === 'string' ? (d as Record<string, unknown>).path as string : null
        const newText = typeof (d as Record<string, unknown>).newText === 'string' ? (d as Record<string, unknown>).newText as string : null
        if (p === null || newText === null) return []
        const oldText = typeof (d as Record<string, unknown>).oldText === 'string' ? (d as Record<string, unknown>).oldText as string : null
        return [{ path: this.resolve(p, wsKey), oldText, newText }]
      })
      if (diffs.length === 0) return null
      // 首个 hunk 定位主文件（多文件 hunk 极罕见，badge 取合计）
      let added = 0
      let removed = 0
      for (const d of diffs) {
        const counts = countChanges(d.oldText, d.newText)
        added += counts.added
        removed += counts.removed
      }
      return {
        path: diffs[0].path,
        kind: 'edit',
        at: Date.now(),
        added,
        removed,
        lang: langOf(diffs[0].path, null),
        diffs,
      }
    }
    return null
  }

  /** 入列（同文件聚合、上限淘汰）+ 通知监听方（带桶键供过滤；replay=
   * 历史回放——git 面板不因其自动展开，预览列表照常消费）。 */
  private record(entry: PreviewEntry, wsKey: string, replay = false): void {
    const bucket = this.bucketOf(wsKey)
    bucket.delete(entry.path)
    bucket.set(entry.path, entry)
    this.trim(bucket)
    this.emit('activity', entry, wsKey, replay)
  }

  /** 桶懒建（工作区数量级小，无回收）。 */
  private bucketOf(wsKey: string): Map<string, PreviewEntry> {
    let bucket = this.buckets.get(wsKey)
    if (bucket === undefined) {
      bucket = new Map()
      this.buckets.set(wsKey, bucket)
    }
    return bucket
  }

  private trim(bucket: Map<string, PreviewEntry>): void {
    while (bucket.size > MAX_ENTRIES) {
      const oldest = bucket.keys().next().value
      if (oldest === undefined) break
      bucket.delete(oldest)
    }
  }

  /** model-facing path → 绝对路径（绝对用之；相对按归属工作区解析）。 */
  private resolve(path: string, wsKey: string): string {
    if (isAbsolute(path)) return path
    return wsKey !== '' ? join(wsKey, path) : path
  }
}

/** 进程级单例（活动记录跨窗口存续，托盘保活期间继续累积）。 */
export const fileActivity = new FileActivity()
