/**
 * 活动记录器：按工作区分桶跟踪 agent 的读/编辑文件活动（tool/result
 * 的 view 卡片），供两个消费方使用：
 * - 工作区基准（skills-catalog）：`activeKey()` 给出当前工作区，
 *   供工作区项目技能目录探位；
 * - 正文文件徽章（workspace-probe）：当前工作区的 edit 活动推给
 *   shell 页面加 +n/−n 统计。
 *
 * 数据源历史：旧版连 dsh 的 /api/events.mux 实时事件流；alpha.1 基线
 * 把事件流迁到 /api/remote.mux（Gateway WebSocket，upgrade 要求浏览器
 * 签名 cookie），主进程拿不到会话态，旧端点退役（426）——mux 连接面
 * 已删。实时活动改由历史补拉承担：
 * - 历史补拉：页面打开/翻页会话时（workspace-probe 的 DOM 选中变化 +
 *   fetch 拦截双路触发）→ {@link FileActivity.fetchHistory} 调一次性
 *   session/page（alpha.1 起 session.history 已移除）从 tool/call 原始事件
 *   推导活动（首页即够；实时增量缺失，徽章数字偏保守）。
 *
 * 上游契约（全部运行时消费，零修改）：
 * - session/page 的 records 是完整事件区间切片（含工具事件）：
 *   tool/call 事件 data = { name, arguments(JSON 字符串) }，按工具名推导：
 *   - read/read_image（file_path）→ read 徽章；
 *   - edit（old_string/new_string）→ edit 徽章，+− 按参数行数近似；
 *   - write（content）→ edit 徽章，+ 全文行数（旧文未知计 0）。
 *
 * 活动按文件聚合（同文件取最新），上限 {@link MAX_ENTRIES}。
 *
 * 工作区隔离：多工作区并存时直接入同一张表会互串。按「会话 → 工作区」
 * 归属分桶存储——归属映射来自 session/list 的 SessionSummary.cwd
 * （主进程自拉，5s 节流 + in-flight 去重；映射未收录的新会话先按当前工作区兜底，
 * 映射刷新后后续事件归位）。相对路径同样按归属工作区解析。list() 只面
 * 向当前工作区桶；跨工作区活动不转发（消费方按 wsKey 过滤）。
 *
 * @module desktop/main/file-activity
 */

import { EventEmitter } from 'node:events'
import { isAbsolute, join } from 'node:path'
import { dshManager } from './dsh-manager'
import type { PreviewEntry } from '@shared/ipc-contract'

/** 聚合后的活动条目上限（每工作区桶独立计算，超出丢最老）。 */
const MAX_ENTRIES = 300

/** 会话归属映射的刷新节流（毫秒；失败同样退避）。 */
const MAPPING_TTL_MS = 5_000

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

function langOf(path: string, hint: unknown): string | null {
  if (typeof hint === 'string' && hint !== '') return hint
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  const ext = path.slice(dot + 1).toLowerCase()
  return EXT_LANG[ext] ?? null
}

/**
 * 记录器单例。`setWorkspace` 由 workspace-probe 探针解析的工作区路径
 * 喂进（当前显示哪个工作区的桶；相对 path 按归属工作区解析）。
 */
class FileActivity extends EventEmitter {
  /** 工作区路径 →（绝对路径 → 条目）：活动按工作区隔离，切换互不污染。 */
  private readonly buckets = new Map<string, Map<string, PreviewEntry>>()
  /** 当前页面选中的工作区（list() 的目标桶；null = 无工作区）。 */
  private activeWorkspace: string | null = null
  /** sessionId → 工作区路径（session/list 的 SessionSummary.cwd 归属）。 */
  private readonly sessionWorkspace = new Map<string, string>()
  private mappingAt = 0
  private mappingBusy: Promise<void> | null = null
  /** 最近一次历史补拉的会话与时间（翻页重复上报去重）。 */
  private lastHistorySession = ''
  private lastHistoryAt = 0

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

  /**
   * 拉会话历史补活动（页面打开/切换会话时由探针触发）：
   * alpha.1 无实时事件流（mux 退役），读/编辑活动只能从 session/page 的
   * tool/call 原始事件推导补回。失败静默（徽章退化为无历史）。
   */
  async fetchHistory(sessionId: string): Promise<void> {
    const now = Date.now()
    // 同会话翻页会重复上报（每页一次触发），短窗口去重只拉首页
    if (sessionId === this.lastHistorySession && now - this.lastHistoryAt < 5_000) return
    const status = dshManager.status
    if (status.state !== 'ready' || status.url === null) return
    try {
      // 先刷新归属映射：历史会话可能属于其他工作区（跨工作区点开），
      // 兑现不了时（新会话）按当前工作区兜底（免误入他桶）
      await this.refreshMapping()
      const wsKey = this.workspaceOfSession(sessionId)
      // 与页面同源的 POST RPC（Node fetch 不带 Origin，loopback 受信）。
      // alpha.1 wire：endpoint 以 / 分隔；typert 命名参 args.request；
      // throughSeq=-1 跳校验且等价全量游标；子代理会话需父址，非
      // session- 前缀直接跳过防报错噪音。
      if (!sessionId.startsWith('session-')) return
      const resp = await fetch(`${status.url}/api/session/page`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: `kcoder-history-${now}`,
          method: 'session/page',
          payload: {
            args: {
              request: {
                address: { kind: 'session', sessionId },
                throughSeq: -1,
                maxMessages: 60,
              },
            },
          },
        }),
      })
      if (!resp.ok) return
      const body = JSON.parse(await resp.text()) as {
        result?: {
          ok?: boolean
          value?: { records?: Array<{ event?: { type?: string; data?: unknown } }> }
        }
      }
      const records = body.result?.ok === true ? body.result.value?.records : undefined
      if (!Array.isArray(records)) return
      this.lastHistorySession = sessionId
      this.lastHistoryAt = Date.now()
      for (const rec of records) {
        if (rec?.event?.type !== 'tool/call' || rec.event.data === undefined) continue
        const entry = this.entryFromToolCall(rec.event.data as Record<string, unknown>, wsKey)
        // replay=true：历史回放只进列表，不触发 git 面板自动展开
        if (entry !== null) this.record(entry, wsKey, true)
      }
    } catch {
      // dsh 重启间隙 / 响应非 JSON 等：静默，下次会话打开重试
    }
  }
  
  /** 会话 → 归属工作区桶键；映射未收录时触发节流刷新，本次先按当前工作区兑底。 */
  private workspaceOfSession(sessionId: string | null): string {
    if (sessionId !== null) {
      const hit = this.sessionWorkspace.get(sessionId)
      if (hit !== undefined) return hit
      void this.refreshMapping()
    }
    return this.activeKey()
  }

  /** session/list → sessionWorkspace 全量重建（节流 + in-flight 去重）。
   * alpha.1 契约：workspace.list 一次性 RPC 已移除；改调一次性
   * session/list，SessionSummary 自带 cwd，直建 sessionId→目录归属。
   * wire：endpoint 路径段以 / 分隔，typert payload 须
   * { args: { _request: {...} } } 命名参格式（均已实测）。 */
  private refreshMapping(): Promise<void> {
    if (this.mappingBusy !== null) return this.mappingBusy
    const now = Date.now()
    if (now - this.mappingAt < MAPPING_TTL_MS) return Promise.resolve()
    const status = dshManager.status
    if (status.state !== 'ready' || status.url === null) return Promise.resolve()
    const url = status.url
    this.mappingBusy = (async () => {
      try {
        const resp = await fetch(`${url}/api/session/list`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: `kcoder-wsmap-${now}`,
            method: 'session/list',
            payload: { args: { _request: {} } },
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
              const item = it as { sessionId?: unknown; cwd?: unknown }
              const sid = typeof item.sessionId === 'string' && item.sessionId !== '' ? item.sessionId : null
              const path = typeof item.cwd === 'string' && item.cwd !== '' ? item.cwd : null
              if (sid === null || path === null) continue
              this.sessionWorkspace.set(sid, path)
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

  /** tool/call 事件 data → 活动条目；不可识别的工具返回 null。
   * alpha.1 起的推导源（旧 ToolEventView 卡片模型已随 mux 退役）：
   * read/read_image 给 file_path → read；edit 给 old_string/new_string →
   * +− 按参数行数近似（旧版 applied hunk 精确值已不可得，徽章数字宁近似勿缺）；
   * write 给 content → + 全文行数（旧文未知计 0）。 */
  private entryFromToolCall(data: Record<string, unknown>, wsKey: string): PreviewEntry | null {
    const name = typeof data.name === 'string' ? data.name : null
    if (name === null) return null
    let args: Record<string, unknown> = {}
    if (typeof data.arguments === 'string') {
      try { args = JSON.parse(data.arguments) as Record<string, unknown> } catch { return null }
    }
    if (name === 'read' || name === 'read_image') {
      const path = typeof args.file_path === 'string' && args.file_path !== '' ? args.file_path : null
      if (path === null) return null
      return {
        path: this.resolve(path, wsKey),
        kind: 'read',
        at: Date.now(),
        added: 0,
        removed: 0,
        lang: langOf(path, null),
        diffs: null,
      }
    }
    if (name === 'edit') {
      const path = typeof args.file_path === 'string' && args.file_path !== '' ? args.file_path : null
      if (path === null) return null
      const oldStr = typeof args.old_string === 'string' ? args.old_string : ''
      const newStr = typeof args.new_string === 'string' ? args.new_string : ''
      return {
        path: this.resolve(path, wsKey),
        kind: 'edit',
        at: Date.now(),
        added: newStr === '' ? 0 : newStr.split('\n').length,
        removed: oldStr === '' ? 0 : oldStr.split('\n').length,
        lang: langOf(path, null),
        diffs: null,
      }
    }
    if (name === 'write') {
      const path = typeof args.file_path === 'string' && args.file_path !== '' ? args.file_path : null
      const content = typeof args.content === 'string' ? args.content : null
      if (path === null || content === null) return null
      return {
        path: this.resolve(path, wsKey),
        kind: 'edit',
        at: Date.now(),
        added: content === '' ? 0 : content.split('\n').length,
        removed: 0,
        lang: langOf(path, null),
        diffs: null,
      }
    }
    return null
  }

  /** 入列（同文件聚合、上限淘汰）+ 通知监听方（带桶键供过滤；replay=
   * 历史回放——语义保留供消费方过滤）。 */
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
