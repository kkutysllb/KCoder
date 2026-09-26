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
import { SHELL_TITLEBAR_HEIGHT } from './theme-watcher'
import { productPolicyArgs } from './product-policy'

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
/**
 * 上游 dsh 客户端契约：`dsh-desktop-titlebar-inset` URL 参数声明「宿主在
 * 页面顶部占用的像素高度」。消费方是侧边栏类插件——它们把开关簇/面板
 * 顶边让到这个高度之下（本轮现场：dsh-coding-sidebar 的开关簇定位
 * top:3px、z-index 45，正被 KCoder 自绘标题栏（z-index 顶层 + 拖拽区）
 * 整块盖住 → 插件自己的按钮点不动）。
 *
 * KCoder 的标题栏就是 48px 覆盖条 + 页面 padding-top 48，如实声明即可。
 * @param url - 就绪 URL（可能带 ?token= 查询串）。
 * @returns 追加上契约参数的 URL；已是绝对 URL 才处理，解析失败原样返回。
 */
export function shellUrlWithTitlebarInset(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('dsh-desktop-titlebar-inset', String(SHELL_TITLEBAR_HEIGHT))
    return parsed.href
  } catch {
    return url
  }
}

export class DshManager extends EventEmitter {
  private child: ChildProcess | null = null
  private state: DshState = 'stopped'
  private url: string | null = null
  /** 主进程 API 面的签名 cookie（BrowserAuth；由就绪令牌兑换，见 authFetch）。 */
  private authCookie: string | null = null
  /** 兑换在途去重（并发首调共享同一次兑换）。 */
  private authMinting: Promise<string | null> | null = null
  /** shell 入口 URL：就绪行原样（带启动令牌，无门禁时等于 url）。 */
  private entryUrl: string | null = null
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
   * @param extraPatches - 追加在**产品策略层之后**的 overlay 文件路径。
   *   产品策略层是每个侧车共享的；一个远程执行世界的 overlay 只属于它自己的
   *   侧车（见 remote-world.ts），故只能在每次启动时传入，不能并进产品策略文件
   *   ——那份文件由宿主按代码重写。
   */
  start(extraPatches: readonly string[] = []): DshStatus {
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
    // --no-open：上游 rc.8 起 `dsh web` 默认把就绪 URL 交给系统默认浏览器
    //（SSH 环境除外）——宿主侧车由 Electron shell 窗口加载该 URL，绝不能
    // 再弹一个系统浏览器窗口。旧版 dsh 把该参数当未知 option 报错退出，
    // 版本门在 resolveDshCommand（webNoOpen，按来源读版本）判定。
    // ⚠️ 参数顺序是硬约束：web 子命令启用了 commander 的 passThroughOptions
    // ——**第一个 web-app 选项（--port / --no-open）之后的所有内容都会透传给
    // web app**，因此 web 子命令自己的选项（--patch / --dump-config）必须排在
    // app 选项之前。顺序反了，web app 会拿到不认识的 --patch 并以
    // "error: unknown option '--patch'" 直接退出（2026-09-15 实机踩到）。
    // 实测：web --patch X --port 0 --no-open 通过；
    //       web --port 0 --no-open --patch X 失败。
    // --patch：产品策略 overlay（会话日志不上传等，见 product-policy.ts）；
    // 上游补丁层序 bundle → profile → home → overlay，本层最后应用，
    // 覆写上游 bundle 行的 config；层文件缺席时为空数组（不传即不生效）。
    // 两组分开构造，让"web 子命令选项在前、web-app 选项在后"成为结构而非约定
    const webCommandArgs = [
      ...(command.webPatch ? productPolicyArgs() : []),
      ...extraPatches.flatMap(patch => ['--patch', patch]),
    ]
    const webAppArgs = ['--port', '0', ...(command.webNoOpen ? ['--no-open'] : [])]
    const args = [...command.baseArgs, 'web', ...webCommandArgs, ...webAppArgs]
    this.appendLog('stdout', `$ ${command.describe}\n$ ${command.command} ${args.join(' ')}`)
    const child = spawn(command.command, args, {
      cwd: command.cwd,
      // Windows:GUI 应用派生控制台子进程默认弹 cmd 窗口;隐藏后引擎的
      // 工具子进程继承同一(隐藏)控制台,任务执行期不再闪烁弹窗
      windowsHide: true,
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
        // 组 1 = 回环基址（对外快照保持无令牌：API 拉取/前缀门禁/诊断展示）；
        // 组 2 = 查询尾部（alpha.1 的 ?token=…）——shell 首次加载靠它换签名
        // cookie，两路分开存，令牌不进 DshStatus 广播。
        if (match !== null) this.onReady(match[1], match[1] + match[2])
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

  private onReady(url: string, entryUrl: string): void {
    if (this.state === 'ready') return
    this.clearReadyTimer()
    this.restartsLeft = MAX_AUTO_RESTARTS
    this.authCookie = null // 新进程新令牌：旧 cookie 绑旧 authority，必失效
    this.entryUrl = entryUrl
    this.setValues({ state: 'ready', url, error: null })
  }

  /**
   * shell 窗口入口 URL：当前实例的带令牌就绪 URL（BrowserAuth 门禁下首次
   * 访问靠它换签名 cookie）；传入地址非当前实例或无令牌时原样回退。
   * dsh 重启换端口后 authority（含端口）变化，旧 cookie 失效——新进程的
   * 新令牌正是再次换 cookie 的钥匙。
   */
  shellEntryUrl(bareUrl: string): string {
    const base = this.url === bareUrl && this.entryUrl !== null ? this.entryUrl : bareUrl
    return shellUrlWithTitlebarInset(base)
  }

  /**
   * 用就绪行令牌兑换 BrowserAuth 签名 cookie（与 shell 窗口首次加载同一
   * 机制：GET /?token=… → 303 + set-cookie）。alpha.1 起上游 /api 全线
   * 要求该 cookie——主进程裸 fetch 一律 401（曾致 file-activity 徽章链
   * 自 alpha.1 起静默断供，见 2026-09-18 排查）。
   *
   * 兑换一次、进程生命周期内复用；重启（新端口=新 authority）由 onReady
   * 清空后重新兑换。并发首调共享同一次在途兑换。
   *
   * @returns 可用作 Cookie 头的值；不可兑换（无令牌的旧版 dsh）时 null，
   *   调用方按无 cookie 降级（兼容无门禁环境）。
   */
  private mintAuthCookie(): Promise<string | null> {
    if (this.authCookie !== null) return Promise.resolve(this.authCookie)
    if (this.authMinting !== null) return this.authMinting
    this.authMinting = (async () => {
      if (this.entryUrl === null) return null
      try {
        // redirect: manual——303 的 set-cookie 才会落到本次响应头上
        const resp = await fetch(this.entryUrl, { redirect: 'manual' })
        const setCookie = resp.headers.get('set-cookie')
        if (setCookie === null || setCookie === '') return null
        const cookie = setCookie.split(';')[0] ?? ''
        this.authCookie = cookie !== '' ? cookie : null
        return this.authCookie
      } catch {
        return null // 启动间隙网络抖动：本次降级，下次调用重试
      } finally {
        this.authMinting = null
      }
    })()
    return this.authMinting
  }

  /**
   * 主进程侧带鉴权的 /api fetch：自动兑换并附带签名 cookie；不可兑换时
   * 退化为裸 fetch（无门禁的旧版 dsh 仍可用）。
   * @param url - 绝对地址（status.url 拼接的 /api 路径）。
   * @param init - fetch 初始化项（cookie 头不覆盖调用方显式给定的值）。
   */
  async authFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const cookie = await this.mintAuthCookie()
    if (cookie === null) return fetch(url, init)
    const headers = new Headers(init.headers ?? {})
    if (headers.get('cookie') === null) headers.set('cookie', cookie)
    return fetch(url, { ...init, headers })
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
