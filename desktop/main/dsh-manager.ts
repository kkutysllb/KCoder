/**
 * dsh Host 侧车进程管理器。
 *
 * 职责：spawn `dsh web --port 0` → 从 stdout 解析就绪行 → 广播状态；
 * 崩溃自动重启（指数退避，上限见 {@link MAX_AUTO_RESTARTS}）；
 * 应用退出时优雅关闭（SIGTERM → 宽限 → SIGKILL）。
 *
 * 桌面端与 dsh 的关系是"宿主与侧车"：dsh 拥有 agent loop、API 网关、
 * 会话与持久化（`$DSH_HOME`），桌面端只负责进程与窗口，绝不侵入其
 * 运行时——这正是一切皆插件理念下的正确边界。
 *
 * @module desktop/main/dsh-manager
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  MAX_AUTO_RESTARTS,
  READY_LINE_RE,
  READY_TIMEOUT_MS,
  resolveDshCommand,
  type DshCommand,
} from './dsh-contract'
import type { DshLogLine, DshState, DshStatus } from '@shared/ipc-contract'
import { mediaSpawnEnv } from './media-models'

/** 日志环形缓冲容量（诊断面板展示尾部）。 */
const LOG_RING_SIZE = 500

/** 优雅退出宽限（毫秒）。 */
const TERM_GRACE_MS = 5_000

/** 事件负载：状态快照。 */
export type DshManagerEvents = {
  'state-changed': (status: DshStatus) => void
  log: (line: DshLogLine) => void
}

/**
 * 单例管理器。所有状态变更经 {@link DshManagerEvents} 广播，
 * IPC 层与窗口层订阅后各自反应。
 */
export class DshManager extends EventEmitter {
  private child: ChildProcess | null = null
  private state: DshState = 'stopped'
  private url: string | null = null
  private error: string | null = null
  private source: DshStatus['source'] = null
  private restartsLeft = MAX_AUTO_RESTARTS
  private logs: DshLogLine[] = []
  private readyTimer: NodeJS.Timeout | null = null
  private backoffTimer: NodeJS.Timeout | null = null
  private stopping = false
  private exitedAfterStop = true

  /** 当前快照。 */
  get status(): DshStatus {
    return {
      state: this.state,
      url: this.url,
      source: this.source,
      error: this.error,
      restartsLeft: this.restartsLeft,
    }
  }

  /** 日志尾部（最多 {@link LOG_RING_SIZE} 行）。 */
  get logTail(): DshLogLine[] {
    return [...this.logs]
  }

  /** 上次成功使用的命令描述（诊断用）。 */
  get lastCommand(): DshCommand | null {
    return this.command
  }

  private command: DshCommand | null = null

  /**
   * 启动（或在新来源可用后再次尝试启动）dsh 侧车。
   * 已在运行时是幂等的 no-op。
   */
  start(): DshStatus {
    if (this.child !== null || this.state === 'starting' || this.state === 'restarting') {
      return this.status
    }
    const command = resolveDshCommand()
    if (command === null) {
      this.fail('未找到可用的 dsh：请先完成上游克隆与构建（见“设置”页），或设置 DSH_BIN')
      return this.status
    }
    this.stopping = false
    this.command = command
    this.setValues({ state: 'starting', error: null, source: command.source })

    // --port 0：由 OS 从临时端口段随机分配，避免与用户自起的 `dsh web`(3080)
    // 及同机 DSH-Desktop 的侧车（同样 --port 0，各自拿不同的随机端口）冲突；
    // 临时段（macOS 49152-65535）与 3080 等低位固定端口天然不相交，内核
    // 保证两个 --port 0 监听永不撞车。实际端口从就绪行解析。DSH_WEB_URL
    // 等环境由 dsh 自行管理。websocket/mux 复用同一 HTTP server 的 upgrade，
    // 全进程仅此一个监听。
    const args = [...command.baseArgs, 'web', '--port', '0']
    this.appendLog('stdout', `$ ${command.describe}\n$ ${command.command} ${args.join(' ')}`)
    const child = spawn(command.command, args, {
      cwd: command.cwd,
      // mediaSpawnEnv：多媒体技能模型凭据（$DSH_HOME/media-models.env，
      // 设置→技能→多媒体模型维护），随侧车传给 agent 的工具子进程
      env: { ...process.env, ...command.env, ...mediaSpawnEnv() },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    this.exitedAfterStop = false

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line === '') continue
        this.appendLog('stdout', line)
        const match = READY_LINE_RE.exec(line)
        if (match !== null) this.onReady(`http://127.0.0.1:${match[1]}`)
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line !== '') this.appendLog('stderr', line)
      }
    })
    child.on('error', (error) => {
      this.child = null
      this.fail(`无法启动 dsh 进程：${String(error)}`)
    })
    child.on('exit', (code, signal) => {
      this.child = null
      this.clearReadyTimer()
      if (this.exitedAfterStop) return
      if (this.stopping) {
        this.setValues({ state: 'stopped' })
        return
      }
      // 意外退出：自动重启直到额度耗尽
      this.appendLog('stderr', `dsh 进程退出（code=${String(code)} signal=${String(signal)}）`)
      if (this.restartsLeft > 0) {
        this.scheduleRestart()
      } else {
        this.fail(`dsh 连续崩溃，已停止自动重启（最后退出 code=${String(code)}）`)
      }
    })

    this.readyTimer = setTimeout(() => {
      if (this.state === 'starting' || this.state === 'restarting') {
        this.fail(`等待就绪超时（${String(READY_TIMEOUT_MS / 1000)}s）。详见下方日志；上游首次冷启动较慢，可重试。`)
        void this.stop()
      }
    }, READY_TIMEOUT_MS)
    return this.status
  }

  /** 重启：优雅停止后重新启动。 */
  restart(): DshStatus {
    void this.stop().then(() => {
      this.restartsLeft = MAX_AUTO_RESTARTS
      this.start()
    })
    return { ...this.status, state: 'restarting' }
  }

  /** 优雅停止；resolve 于进程真正退出（或本就不在运行）。 */
  async stop(): Promise<void> {
    this.stopping = true
    this.clearTimers()
    const child = this.child
    if (child === null || child.exitCode !== null || child.signalCode !== null) {
      this.child = null
      this.setValues({ state: 'stopped' })
      return
    }
    await new Promise<void>((resolve) => {
      const done = (): void => {
        child.removeAllListeners('exit')
        clearTimeout(killTimer)
        resolve()
      }
      const killTimer = setTimeout(() => {
        this.appendLog('stderr', '优雅退出超时，发送 SIGKILL')
        child.kill('SIGKILL')
      }, TERM_GRACE_MS)
      child.once('exit', done)
      child.kill('SIGTERM')
    })
    this.child = null
    this.exitedAfterStop = true
    this.setValues({ state: 'stopped' })
  }

  /* ---------- 内部 ---------- */

  private onReady(url: string): void {
    if (this.state === 'ready') return
    this.clearReadyTimer()
    this.restartsLeft = MAX_AUTO_RESTARTS
    this.setValues({ state: 'ready', url, error: null })
  }

  private scheduleRestart(): void {
    const attempt = MAX_AUTO_RESTARTS - this.restartsLeft + 1
    this.restartsLeft -= 1
    const delay = Math.min(1_000 * 2 ** (attempt - 1), 8_000)
    this.setValues({ state: 'restarting' })
    this.appendLog('stderr', `将在 ${String(delay)}ms 后自动重启（剩余 ${String(this.restartsLeft)} 次）`)
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null
      this.start()
    }, delay)
  }

  private fail(message: string): void {
    this.clearTimers()
    this.setValues({ state: 'failed', error: message })
  }

  private setValues(patch: Partial<Pick<DshStatus, 'state' | 'url' | 'error' | 'source'>>): void {
    if (patch.state !== undefined) this.state = patch.state
    if (patch.url !== undefined) this.url = patch.url
    if (patch.error !== undefined) this.error = patch.error
    if (patch.source !== undefined) this.source = patch.source
    this.emit('state-changed', this.status)
  }

  private appendLog(stream: DshLogLine['stream'], line: string): void {
    const entry: DshLogLine = { stream, line, at: Date.now() }
    this.logs.push(entry)
    if (this.logs.length > LOG_RING_SIZE) this.logs.splice(0, this.logs.length - LOG_RING_SIZE)
    this.emit('log', entry)
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== null) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
  }

  private clearTimers(): void {
    this.clearReadyTimer()
    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer)
      this.backoffTimer = null
    }
  }
}

/** 进程级单例（主进程内共享）。 */
export const dshManager = new DshManager()
