/**
 * 子代理监控：聚合 subagent 子会话的执行状态与轨迹，供 git 面板展示。
 *
 * 数据面（上游契约，零修改消费）：
 * - `session.list` RPC：items 带 `parentSessionId` / `origin:'subagent'` /
 *   `running` / `cwd` / `agentPreset`——一次拿到全部子会话清单与运行态
 *   （sessions.schema.ts 的 sessionSummarySchema）；
 * - mux `session/event` 流（file-activity 的 onFrame 观察口）：子会话事件
 *   与父会话同构（user/message、assistant/message、tool/call、tool/result），
 *   按 sessionId 归入对应子代理的时间线；
 * - `session.history` RPC：新发现的子会话补拉历史轨迹（面板打开前开始
 *   跑的子代理也能看到干了什么）。
 *
 * 生命周期：随 git 面板开合 start/stop（引用计数；记录与轨迹跨开关存续，
 * 断流期间靠轮询自愈）。dsh 非 ready 时轮询跳过、记录保留。
 *
 * @module desktop/main/subagent-monitor
 */

import { EventEmitter } from 'node:events'
import { dshManager } from './dsh-manager'
import { fileActivity, textOfBlocks, type MuxFrame } from './file-activity'
import type { SubagentEntry, TrajectoryRow } from '@shared/ipc-contract'

/** 面板打开时的清单轮询间隔（running 态切换的最大延迟）。 */
const POLL_MS = 3_000

/** 每个子代理保留的轨迹行上限（超出丢最老）。 */
const MAX_ROWS = 60

/** 监控的子代理条目上限（超出按 lastAt 淘汰最老）。 */
const MAX_CHILDREN = 30

/** 轨迹变化推送的节流（mux 逐帧到达，不必逐帧 emit）。 */
const EMIT_THROTTLE_MS = 500

/** 任务描述（首条 user 摘录）的截断长度。 */
const TASK_CHARS = 80

/** 轨迹关注的四类 SessionEvent（与轨迹抽屉一致）。 */
const ROW_EVENT_TYPES: ReadonlySet<string> = new Set([
  'user/message', 'assistant/message', 'tool/call', 'tool/result',
])

/** 监控记录（比契约多 cwd 供面板按工作区过滤；task 在首条 user 到达时提取）。 */
export interface SubagentRecord {
  id: string
  parentId: string | null
  label: string
  cwd: string | null
  running: boolean
  task: string
  toolCalls: number
  lastAt: number
  rows: TrajectoryRow[]
  /** seq 去重（history 补拉与 mux 实时交叠）。 */
  seen: Set<number>
  /** 历史是否已补拉（每子会话一次）。 */
  historyDone: boolean
}

/** session.list 的 item 形状（只声明消费的字段）。 */
interface SessionListItem {
  sessionId?: unknown
  updatedAt?: unknown
  running?: unknown
  parentSessionId?: unknown
  origin?: unknown
  cwd?: unknown
  agentPreset?: unknown
}

/** SessionEvent 外壳（mux 帧与 history 条目共用）。 */
type SessionEventShape = { type?: unknown; seq?: unknown; time?: unknown; data?: unknown }

/**
 * 摘要一个 SessionEvent 为轨迹行（与 file-activity.trajEvent 同构，但
 * 无会话选中态耦合；返回 null = 非关注类型/形状不全）。running 行配对
 * 由调用方在各自 rows 内完成。
 */
function rowFromEvent(ev: SessionEventShape): TrajectoryRow | null {
  if (typeof ev.type !== 'string' || !ROW_EVENT_TYPES.has(ev.type)) return null
  if (typeof ev.seq !== 'number' || typeof ev.time !== 'number') return null
  const data = (ev.data ?? {}) as Record<string, unknown>
  const turn = typeof data.turn === 'number' ? data.turn : 0
  if (ev.type === 'tool/call') {
    const callId = typeof data.callId === 'string' ? data.callId : String(ev.seq)
    const name = typeof data.name === 'string' ? data.name : '?'
    return { seq: ev.seq, at: ev.time, turn, kind: 'tool', text: null,
      tool: { callId, name, status: 'running', ms: null } }
  }
  if (ev.type === 'tool/result') {
    const message = (data.message ?? {}) as Record<string, unknown>
    const blocks = Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : []
    const block = blocks[0] ?? {}
    const callId = typeof block.toolCallId === 'string' ? block.toolCallId : String(ev.seq)
    const failed = data.error != null || block.isError === true
    return { seq: ev.seq, at: ev.time, turn, kind: 'tool', text: null,
      tool: { callId, name: '', status: failed ? 'error' : 'ok', ms: 0 } }
  }
  // user/message 的 data 即消息本体；assistant/message 的消息在 data.message
  const message = ev.type === 'user/message' ? data : (data.message ?? {}) as Record<string, unknown>
  return {
    seq: ev.seq, at: ev.time, turn,
    kind: ev.type === 'user/message' ? 'user' : 'assistant',
    text: textOfBlocks(message.content),
    tool: null,
  }
}

/** 入列（seq 升序 + 上限淘汰；配对同 callId 的 running 行补终态）。 */
function absorbRow(rec: SubagentRecord, row: TrajectoryRow): void {
  if (rec.seen.has(row.seq)) return
  rec.seen.add(row.seq)
  if (row.kind === 'tool' && row.tool !== null && row.tool.status !== 'running') {
    // result：先试配对 running 行（mux 流里 call 在前）——终态回填到
    // 原 call 行，result 行不入列（时长/状态由 call 行承载）
    const callId = row.tool.callId
    const running = [...rec.rows].reverse()
      .find(r => r.kind === 'tool' && r.tool !== null && r.tool.callId === callId && r.tool.status === 'running')
    if (running !== undefined && running.tool !== null) {
      running.tool.status = row.tool.status
      running.tool.ms = Math.max(0, row.at - running.at)
      rec.lastAt = Math.max(rec.lastAt, row.at)
      return
    }
    // 无配对（面板启动前 call 已丢）：result 行补位入列
  }
  if (row.kind === 'tool' && row.tool !== null && row.tool.status === 'running') rec.toolCalls++
  rec.rows.push(row)
  rec.rows.sort((a, b) => a.seq - b.seq)
  while (rec.rows.length > MAX_ROWS) {
    const dropped = rec.rows.shift()
    if (dropped !== undefined) rec.seen.delete(dropped.seq)
  }
  rec.lastAt = Math.max(rec.lastAt, row.at)
}

/**
 * 子代理监控单例。`changed` 事件携带全部 SubagentRecord（面板按 cwd 过滤后
 * 经 {@link toEntry} 映射为契约形状推送视图）。
 *
 * mux 帧观察常驻（constructor 挂接，不随面板开合）：后台 continuable
 * 子代理在面板关闭期间继续跑，事件若在 stop 时丢弃则永久缺失
 * （historyDone 每子会话只补拉一次，不会重拉填洞）——常驻观察每帧
 * 一次 Map 查找，成本可忽略。轮询（3s RPC）才是该省的成本，随面板
 * 开合启停；从未收录的子会话在面板打开时 poll + fetchHistory 补全，
 * 关闭期间的数据无损。
 */
class SubagentMonitor extends EventEmitter {
  private readonly children = new Map<string, SubagentRecord>()
  /** 各工作区最新父会话（cwd → sessionId；同项目多会话时非 running
   * 子代理只随活跃会话展示，老会话的完成退场防残留）。 */
  private readonly latestParents = new Map<string, string>()
  private refs = 0
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pollBusy = false
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private readonly onFrame = (frame: MuxFrame): void => { this.consume(frame) }

  constructor() {
    super()
    fileActivity.onFrame(this.onFrame)
  }

  /** 面板打开（引用计数；首客启动轮询）。 */
  start(): void {
    this.refs++
    if (this.refs > 1) return
    this.pollTimer = setInterval(() => { void this.poll() }, POLL_MS)
    void this.poll()
  }

  /** 面板关闭（归零停轮询；mux 观察与记录常驻，后台轨迹持续累积）。 */
  stop(): void {
    this.refs = Math.max(this.refs - 1, 0)
    if (this.refs > 0) return
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /** 当前全部记录（面板初拉与推送共用；最新在前）。 */
  records(): SubagentRecord[] {
    return [...this.children.values()].sort((a, b) => b.lastAt - a.lastAt)
  }

  /** 工作区当前活跃（updatedAt 最新）父会话 id；该工作区已无父会话
   * （dsh 重启新存储等）时返回 null——非 running 条目随之退场。 */
  activeParentId(cwd: string): string | null {
    return this.latestParents.get(cwd) ?? null
  }

  /** mux 帧：已知子会话的事件入轨迹（未知 id 等轮询收录后再看得到）。 */
  private consume(frame: MuxFrame): void {
    const id = frame.sessionId
    if (id === undefined || frame.event === undefined) return
    const rec = this.children.get(id)
    if (rec === undefined) return
    const row = rowFromEvent(frame.event)
    if (row === null) return
    // 首条 user 消息 = 任务描述（subagent 工具的 prompt 参数落在这）
    if (rec.task === '' && row.kind === 'user' && row.text !== null) {
      rec.task = row.text.length > TASK_CHARS ? row.text.slice(0, TASK_CHARS - 1) + '…' : row.text
    }
    absorbRow(rec, row)
    this.scheduleEmit()
  }

  /** session.list 轮询：子会话清单 + running 态刷新；新条目补拉历史。 */
  private async poll(): Promise<void> {
    if (this.pollBusy) return
    const status = dshManager.status
    if (status.state !== 'ready' || status.url === null) return
    this.pollBusy = true
    try {
      const resp = await fetch(`${status.url}/api/session.list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: `kcoder-subagents-${Date.now()}`,
          method: 'session.list',
          payload: {},
        }),
      })
      if (!resp.ok) return
      const body = JSON.parse(await resp.text()) as {
        result?: { ok?: boolean; value?: { items?: unknown } }
      }
      const items = body.result?.ok === true ? body.result.value?.items : undefined
      if (!Array.isArray(items)) return
      // 父会话清单：每工作区取 updatedAt 最新者（非 running 子代理的归属
      // 锚点——同项目多会话时只随当前活跃会话展示，防老会话完成条目残留；
      // 该工作区已无父会话（dsh 重启新存储）时锚点消失，老条目随之退场）
      const latest = new Map<string, { id: string; at: number }>()
      for (const raw of items) {
        if (raw === null || typeof raw !== 'object') continue
        const it = raw as SessionListItem
        const pid = typeof it.sessionId === 'string' && it.sessionId !== '' ? it.sessionId : null
        const hasParent = typeof it.parentSessionId === 'string' && it.parentSessionId !== ''
        const pcwd = typeof it.cwd === 'string' && it.cwd !== '' ? it.cwd : null
        if (pid === null || hasParent || pcwd === null) continue
        const at = typeof it.updatedAt === 'number' ? it.updatedAt : 0
        const cur = latest.get(pcwd)
        if (cur === undefined || at > cur.at) latest.set(pcwd, { id: pid, at })
      }
      this.latestParents.clear()
      for (const [pcwd, v] of latest) this.latestParents.set(pcwd, v.id)
      let changed = false
      for (const raw of items) {
        if (raw === null || typeof raw !== 'object') continue
        const it = raw as SessionListItem
        const id = typeof it.sessionId === 'string' && it.sessionId !== '' ? it.sessionId : null
        // 子会话判定：parentSessionId 存在（origin:'subagent' 是展示元数据，
        // 血缘才是硬信号）
        const parentId = typeof it.parentSessionId === 'string' && it.parentSessionId !== ''
          ? it.parentSessionId
          : null
        if (id === null || parentId === null) continue
        const running = it.running === true
        const existing = this.children.get(id)
        if (existing === undefined) {
          this.children.set(id, {
            id,
            parentId,
            label: typeof it.agentPreset === 'string' && it.agentPreset !== '' ? it.agentPreset : '子代理',
            cwd: typeof it.cwd === 'string' && it.cwd !== '' ? it.cwd : null,
            running,
            task: '',
            toolCalls: 0,
            lastAt: typeof it.updatedAt === 'number' ? it.updatedAt : 0,
            rows: [],
            seen: new Set(),
            historyDone: false,
          })
          changed = true
          void this.fetchHistory(id)
        } else if (existing.running !== running) {
          existing.running = running
          changed = true
        }
      }
      // 条目上限淘汰（最老先走）
      while (this.children.size > MAX_CHILDREN) {
        let oldest: string | null = null
        let oldestAt = Number.POSITIVE_INFINITY
        for (const [id, rec] of this.children) {
          if (!rec.running && rec.lastAt < oldestAt) { oldestAt = rec.lastAt; oldest = id }
        }
        if (oldest === null) break
        this.children.delete(oldest)
        changed = true
      }
      if (changed) this.scheduleEmit()
    } catch {
      // dsh 重启间隙 / 响应非 JSON 等：静默，下轮重试
    } finally {
      this.pollBusy = false
    }
  }

  /** 新子会话的历史轨迹补拉（面板打开前开始跑的部分）。 */
  private async fetchHistory(id: string): Promise<void> {
    const rec = this.children.get(id)
    if (rec === undefined || rec.historyDone) return
    rec.historyDone = true
    const status = dshManager.status
    if (status.state !== 'ready' || status.url === null) return
    try {
      const resp = await fetch(`${status.url}/api/session.history`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: `kcoder-subagent-hist-${Date.now()}`,
          method: 'session.history',
          payload: { sessionId: id },
        }),
      })
      if (!resp.ok) return
      const body = JSON.parse(await resp.text()) as {
        result?: { ok?: boolean; value?: { events?: Array<{ event?: unknown }> } }
      }
      const events = body.result?.ok === true ? body.result.value?.events : undefined
      if (!Array.isArray(events)) return
      for (const e of events) {
        const ev = (e as { event?: unknown } | null)?.event as SessionEventShape | undefined
        if (ev === null || ev === undefined) continue
        const row = rowFromEvent(ev)
        if (row === null) continue
        if (rec.task === '' && row.kind === 'user' && row.text !== null) {
          rec.task = row.text.length > TASK_CHARS ? row.text.slice(0, TASK_CHARS - 1) + '…' : row.text
        }
        absorbRow(rec, row)
      }
      this.scheduleEmit()
    } catch {
      // 补拉失败：标记已试过，实时流继续（historyDone 已置位防重试风暴）
    }
  }

  /** 节流推送（轮询变化立即推，mux 行到达合并 500ms 一波）。 */
  private scheduleEmit(): void {
    this.dirty = true
    if (this.emitTimer !== null) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      if (this.dirty) {
        this.dirty = false
        this.emit('changed', this.records())
      }
    }, EMIT_THROTTLE_MS)
  }
}

/** 工作区显示名（cwd 尾段；Windows 分隔符兼容）。 */
function wsTail(cwd: string | null): string | null {
  if (cwd === null || cwd === '') return null
  const segs = cwd.split(/[\\/]/).filter(Boolean)
  return segs.length > 0 ? (segs[segs.length - 1] ?? null) : null
}

/**
 * 面板侧过滤（初拉与推送同源）：严格按工作区——B 工作区条目（含
 * 运行中）不进 A 工作区的 git 面板（旧「运行中跨工作区也展示」设计
 * 在主代理切任务后串台，2026-08-19 反馈修正）；本工作区运行中的仍
 * 展示（不随父会话锚点退场），已结束的只随活跃父会话展示（同项目
 * 老会话完成条目退场防残留）；面板无工作区（null/''）时显示全部。
 */
export function filterForWorkspace(
  records: SubagentRecord[],
  ws: string | null,
  active: string | null,
): SubagentRecord[] {
  return records.filter(r => ws === null || ws === ''
    || (r.cwd === ws && (r.running || r.parentId === active)))
}

/** 面板侧过滤后映射为契约形状。 */
export function toEntry(rec: SubagentRecord): SubagentEntry {
  return {
    id: rec.id,
    parentId: rec.parentId,
    ws: wsTail(rec.cwd),
    label: rec.label,
    task: rec.task,
    running: rec.running,
    toolCalls: rec.toolCalls,
    lastAt: rec.lastAt,
    rows: rec.rows,
  }
}

/** 进程级单例（记录跨面板开关存续）。 */
export const subagentMonitor = new SubagentMonitor()
