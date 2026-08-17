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

/** 事件面：data（pty → 终端，带标签 id）、exit（进程退出）。 */
export interface PtyHostEvents {
  data: (chunk: string, id: number) => void
  exit: (id: number) => void
}

/** 单个 pty 会话（一个 shell 进程 = 一个标签）。 */
interface Session {
  id: number
  pty: IPty | null
  cwd: string
  exited: boolean
}

/** pty 会话宿主（多标签，由 terminal-panel 持有调用）。 */
export class PtyHost {
  private readonly events = new EventEmitter()
  private readonly sessions = new Map<number, Session>()
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

  /** 全部标签快照（Map 迭代序即创建序）。 */
  list(): TerminalTab[] {
    return [...this.sessions.values()].map(tabOf)
  }

  /** 单个标签信息；不存在返回 null。 */
  info(id: number): TerminalTab | null {
    const s = this.sessions.get(id)
    return s === undefined ? null : tabOf(s)
  }

  /** 新建标签（shell 进程立即启动，工作目录首选当前工作区）。 */
  create(preferredCwd: string | null): TerminalTab {
    const s: Session = { id: this.nextId++, pty: null, cwd: usableDir(preferredCwd) ?? homedir(), exited: false }
    this.sessions.set(s.id, s)
    this.spawn(s)
    return tabOf(s)
  }

  /** 面板打开时确保至少有一个标签（无则新建；退出的保留退出现场）。 */
  ensureFirst(preferredCwd: string | null): TerminalTab {
    const first = this.sessions.values().next().value
    if (first !== undefined) return tabOf(first)
    return this.create(preferredCwd)
  }

  /** 销毁对应标签并以（可能已变化的）工作区目录重建。 */
  restart(id: number, preferredCwd: string | null): TerminalTab | null {
    const s = this.sessions.get(id)
    if (s === undefined) return null
    const cwd = usableDir(preferredCwd) ?? s.cwd ?? homedir()
    killPty(s)
    s.cwd = cwd
    s.exited = false
    this.spawn(s)
    return tabOf(s)
  }

  write(id: number, data: string): void {
    this.sessions.get(id)?.pty?.write(data)
  }

  resize(id: number, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (s === undefined) return
    this.cols = cols
    this.rows = rows
    try { s.pty?.resize(cols, rows) } catch {
      // 进程退出瞬间 resize 会抛错，忽略（exit 事件会接手）
    }
  }

  /** 关闭单个标签（杀 shell），返回剩余标签。 */
  close(id: number): TerminalTab[] {
    const s = this.sessions.get(id)
    if (s === undefined) return this.list()
    killPty(s)
    this.sessions.delete(id)
    return this.list()
  }

  /** 彻底销毁全部会话（应用退出/窗口关闭时调用）。 */
  dispose(): void {
    for (const s of this.sessions.values()) killPty(s)
    this.sessions.clear()
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
    s.pty.onData(chunk => { this.events.emit('data', chunk, s.id) })
    s.pty.onExit(() => {
      s.exited = true
      s.pty = null
      this.events.emit('exit', s.id)
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
