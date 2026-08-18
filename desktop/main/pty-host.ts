/**
 * pty 宿主：内嵌终端的真实终端进程管理（node-pty，VS Code 同款）。
 *
 * 多会话模型：每个标签一个 shell 进程。面板关闭仅隐藏（全部进程保留，
 * 会话不丢）；显式 restart 销毁重建对应标签；close 关闭单个标签。
 * 工作目录 = 当前任务的工作区（terminal-panel 的页面探针解析后经
 * toggle/缓存传入）。
 *
 * 数据链路：xterm（终端视图）→ IPC terminal:write → pty.write；
 * pty.onData → IPC terminal:data（带标签 id）广播 → xterm。resize 同理。
 *
 * @module desktop/main/pty-host
 */

import { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { spawn as ptySpawn, type IPty } from 'node-pty'

/** 面板侧展示的标签信息（terminal:tabs / terminal:info）。 */
export interface TerminalTab {
  id: number
  alive: boolean
  cwd: string
  /** shell 名（zsh/bash/powershell，tab/header 显示用）。 */
  title: string
}

/** 事件面：data（pty → 终端，带标签 id + 工作区桶键）、exit（进程退出）。 */
export interface PtyHostEvents {
  data: (chunk: string, id: number, bucket: string) => void
  exit: (id: number, bucket: string) => void
}

/** 单个 pty 会话（一个 shell 进程 = 一个标签）。 */
interface Session {
  id: number
  pty: IPty | null
  cwd: string
  /** 所属工作区桶键（冗余记一份，避免 data/exit 路由时反查 buckets）。 */
  bucket: string
  exited: boolean
}

/** pty 会话宿主（多标签，按工作区隔离，由 terminal-panel 持有调用）。
 *
 * 会话模型（修正：每个工作区一份私有 sessions 池，避免工作区切换时
 * 互相污染或被误杀）：
 * - sessions = Map<workspacePath, Map<sessionId, Session>>：以工作区
 *   绝对路径为桶键，每个工作区独立 id 空间；
 * - 不同工作区可以同时持有各自的多 tab，互不干扰；
 * - "当前工作区" = terminal-panel 跟踪的 workspacePath，list/create
 *   等面板侧 API 都作用于该桶；切工作区后调 ensureFirst 在新桶里建
 *   第一个标签，老桶里的进程继续存活（用户切回去还是它们的）。 */
export class PtyHost {
  private readonly events = new EventEmitter()
  /** workspacePath → 该工作区的 session id → session。空串键 = 无工作区桶（兜底）。 */
  private readonly buckets = new Map<string, Map<number, Session>>()
  private nextId = 1
  /** 最近一次 resize 的尺寸（新建标签沿用，避免先 80×24 再闪变）。 */
  private cols = 80
  private rows = 24

  on<K extends keyof PtyHostEvents>(event: K, listener: PtyHostEvents[K]): this {
    this.events.on(event, listener)
    return this
  }

  off<K extends keyof PtyHostEvents>(event: K, listener: PtyHostEvents[K]): this {
    this.events.off(event, listener)
    return this
  }

  /** 当前工作区桶键：缺省工作区用空串（兜底），避免 null/undefined 进 Map 不可见。 */
  private bucketOf(cwd: string | null): string {
    return cwd !== null ? cwd : ''
  }

  private bucket(cwd: string | null): Map<number, Session> {
    const key = this.bucketOf(cwd)
    let m = this.buckets.get(key)
    if (m === undefined) { m = new Map(); this.buckets.set(key, m) }
    return m
  }

  /** 当前工作区全部标签快照（Map 迭代序即创建序）。 */
  list(cwd: string | null): TerminalTab[] {
    const m = this.buckets.get(this.bucketOf(cwd))
    return m === undefined ? [] : [...m.values()].map(tabOf)
  }

  /** 当前工作区里全部桶的标签快照（用于工作区切换时的清账/调试）。 */
  listAll(): TerminalTab[] {
    const out: TerminalTab[] = []
    for (const m of this.buckets.values()) for (const s of m.values()) out.push(tabOf(s))
    return out
  }

  /** 单个标签信息（按全局 id 查，因为 IPC handler 已用 id，不区分桶）。 */
  info(id: number): TerminalTab | null {
    for (const m of this.buckets.values()) {
      const s = m.get(id)
      if (s !== undefined) return tabOf(s)
    }
    return null
  }

  /** 新建标签到指定工作区桶（shell 进程立即启动）。 */
  create(cwd: string | null): TerminalTab {
    const bucket = this.bucketOf(cwd)
    const s: Session = { id: this.nextId++, pty: null, cwd: usableDir(cwd) ?? homedir(), bucket, exited: false }
    this.bucket(bucket).set(s.id, s)
    this.spawn(s)
    return tabOf(s)
  }

  /** 面板打开时确保指定工作区桶至少有一个标签（无则新建）。 */
  ensureFirst(cwd: string | null): TerminalTab {
    const m = this.bucket(cwd)
    const first = m.values().next().value
    if (first !== undefined) return tabOf(first)
    return this.create(cwd)
  }

  /** 销毁对应标签（仅限 preferredCwd 桶内），并以（可能已变化的）工作区目录重建（同 id）。 */
  restart(id: number, preferredCwd: string | null): TerminalTab | null {
    const bucket = this.bucketOf(preferredCwd)
    const s = this.buckets.get(bucket)?.get(id)
    if (s === undefined) return null
    const cwd = usableDir(preferredCwd) ?? s.cwd ?? homedir()
    killPty(s)
    s.cwd = cwd
    s.bucket = bucket
    s.exited = false
    // 跨工作区重启：把 session 移到新桶（id 不变即可保持面板标签稳定）
    for (const m of this.buckets.values()) m.delete(id)
    this.bucket(bucket).set(id, s)
    this.spawn(s)
    return tabOf(s)
  }

  write(id: number, data: string): void {
    this.find(id)?.pty?.write(data)
  }

  resize(id: number, cols: number, rows: number): void {
    const s = this.find(id)
    if (s === null) return
    this.cols = cols
    this.rows = rows
    try { s.pty?.resize(cols, rows) } catch {
      // 进程退出瞬间 resize 会抛错，忽略（exit 事件会接手）
    }
  }

  /** 关闭单个标签（仅限 cwd 桶内：跨桶 id 一律不动，绝不影响其他工作区进程），返回当前工作区剩余标签。 */
  close(id: number, cwd: string | null): TerminalTab[] {
    const bucket = this.bucketOf(cwd)
    const s = this.buckets.get(bucket)?.get(id)
    if (s === undefined) return this.list(cwd)
    killPty(s)
    this.buckets.get(bucket)?.delete(id)
    return this.list(cwd)
  }

  /** 彻底销毁全部会话（应用退出/窗口关闭时调用）。 */
  dispose(): void {
    for (const m of this.buckets.values())
      for (const s of m.values()) killPty(s)
    this.buckets.clear()
  }

  /** 全局 id 定位 session（id 全局唯一，跨桶查找一次即可）。 */
  private find(id: number): Session | null {
    for (const m of this.buckets.values()) {
      const s = m.get(id)
      if (s !== undefined) return s
    }
    return null
  }

  private spawn(s: Session): void {
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/zsh')
    const args = process.platform === 'win32' ? [] : ['--login']
    s.pty = ptySpawn(shell, args, {
      name: 'xterm-256color',
      cwd: s.cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
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

function tabOf(s: Session): TerminalTab {
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/zsh')
  return { id: s.id, alive: !s.exited, cwd: s.cwd, title: basename(shell) }
}

function killPty(s: Session): void {
  if (s.pty !== null) {
    try { s.pty.kill() } catch { /* 已退出 */ }
    s.pty = null
  }
}

/** 目录可用性校验：存在且是目录才采用，否则交给回退。 */
function usableDir(path: string | null): string | null {
  if (path === null || path === '') return null
  try {
    if (!statSync(path).isDirectory()) return null
    return path
  } catch {
    return null
  }
}

/** 供终端视图 header 显示的目录短名。 */
export function dirLabel(cwd: string): string {
  if (cwd === '') return '~'
  return basename(cwd) || cwd
}
