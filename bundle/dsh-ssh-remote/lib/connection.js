// dsh-ssh-remote — ControlMaster 连接管理：惰性建连、-O check 探活、残留清理、拆除、统计。
// Windows 宿主不支持 ControlMaster → 降级为逐次直连（degraded 模式）。
import * as cp from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { harnessHome } from './home.js'

export class ConnectionManager {
  constructor(opts = {}) {
    this.platform = opts.platform || process.platform
    this.degraded = this.platform === 'win32'
    this.cmDir = opts.cmDir || path.join(harnessHome(), 'ssh-remote', 'cm')
    this.spawnFn = opts.spawnFn || ((cmd, args, o) => cp.spawn(cmd, args, o))
    this.sleepMs = typeof opts.sleepMs === 'number' ? opts.sleepMs : 1
    this.probeIntervalMs = opts.probeIntervalMs || 250
    this.connectFloorMs = typeof opts.connectFloorMs === 'number' ? opts.connectFloorMs : 6000
    this.disposed = false // 插件停用/卸载后置位：拒绝重建 master（防无主 detached ssh 复活）
    this.stats = new Map()   // id → { latencyMs, establishedAt, commands, lastError, pid?, master: 'up'|'down'|'degraded' }
    this.pending = new Map() // id → Promise（并发去重）
  }

  /** 插件卸载收口：置 disposed 拒绝后续/在途重建请求。 */
  dispose() {
    this.disposed = true
  }

  sockPath(host) { return path.join(this.cmDir, host.id + '.sock') }

  /** 基础参数（不含 Control 三件套；scp 也能复用 -o 项）。 */
  /**
   * 认证参数（三种登录方式）：
   * - key：-i 私钥 + BatchMode=yes（无人值守永不提示）
   * - agent：不传 -i，交给 ~/.ssh/config / ssh-agent / 默认密钥，仍 BatchMode=yes
   * - password：强制密码（禁公钥），PreferredAuthentications 覆盖 password 与
   *   keyboard-interactive（PAM 常见形态）；**不设 BatchMode**——BatchMode 会连
   *   SSH_ASKPASS 一起禁掉，非交互保证改由 SSH_ASKPASS_REQUIRE=force 提供。
   */
  authArgs(host) {
    if (host.auth === 'password') {
      return [
        '-o', 'PreferredAuthentications=password,keyboard-interactive',
        '-o', 'PubkeyAuthentication=no',
        '-o', 'NumberOfPasswordPrompts=1',
      ]
    }
    const args = []
    if (host.identityFile) args.push('-i', host.identityFile)
    args.push('-o', 'BatchMode=yes')
    return args
  }

  baseArgs(host) {
    const args = [...this.authArgs(host), '-o', 'ConnectTimeout=' + (host.connectTimeoutSec || 15), '-o', 'StrictHostKeyChecking=accept-new']
    if (host.port && host.port !== 22) args.push('-p', String(host.port))
    if (host.jump) {
      const j = host._jumpHost // 已由 resolveJump 注入 {user,host,port}
      if (j) args.push('-J', j.user + '@' + j.host + (j.port && j.port !== 22 ? ':' + j.port : ''))
    }
    return args
  }

  /** ssh 用的完整参数（master 复用）。 */
  muxArgs(host) {
    const args = this.baseArgs(host)
    if (!this.degraded) {
      args.push('-o', 'ControlMaster=auto', '-o', 'ControlPath=' + this.sockPath(host), '-o', 'ControlPersist=' + (host.controlPersistSec || 600))
    }
    return args
  }

  /** scp 用：同 mux 但端口参数换成 -P（外层 transfer 处理，这里给 -o 部分）。 */
  scpArgs(host) {
    const args = [...this.authArgs(host), '-o', 'ConnectTimeout=' + (host.connectTimeoutSec || 15), '-o', 'StrictHostKeyChecking=accept-new']
    if (!this.degraded) {
      args.push('-o', 'ControlMaster=auto', '-o', 'ControlPath=' + this.sockPath(host), '-o', 'ControlPersist=' + (host.controlPersistSec || 600))
    }
    return args
  }

  target(host) { return host.user + '@' + host.host }

  /** 宿主把 jump 主机解析进 host._jumpHost（注册表查引用；失配/未配置时清除，防旧 -J 残留）。 */
  resolveJump(host, registry) {
    if (!host.jump) { host._jumpHost = null; return }
    const j = registry && registry.list().find(x => x.id === host.jump)
    host._jumpHost = j ? { user: j.user, host: j.host, port: j.port } : null
  }

  stat(id) {
    if (!this.stats.has(id)) this.stats.set(id, { latencyMs: null, establishedAt: null, commands: 0, lastError: null, master: 'down', tornDown: false })
    return this.stats.get(id)
  }

  _spawnSsh(args, opts) { return this.spawnFn('ssh', args, opts) }

  /** 一次 ssh 子进程跑完并收 exit code（-O check/exit 用）。 */
  _sshOnce(args) {
    return new Promise((resolve) => {
      let child
      try {
        child = this._spawnSsh(args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      } catch (err) { resolve({ code: -1, err: String(err && err.message) }); return }
      let out = ''
      if (child.stdout) child.stdout.on('data', d => { out += d.toString('utf8') })
      const timer = setTimeout(() => { try { child.kill() } catch { /* */ } resolve({ code: -1, err: 'timeout' }) }, 10000)
      child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, err: String(err && err.message) }) })
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }) })
    })
  }

  checkArgs(host) {
    const args = this.authArgs(host)
    if (host.port && host.port !== 22) args.push('-p', String(host.port))
    if (!this.degraded) args.push('-o', 'ControlPath=' + this.sockPath(host))
    args.push('-O', 'check', this.target(host))
    return args
  }

  /**
   * 惰性建 master：check → 失败则清残留 socket → spawn -N master → poll check。
   * degraded（win32）直接 ok。并发调用共享同一 Promise。
   */
  ensureMaster(host) {
    if (this.disposed) {
      // 停用/卸载后不再重建：返回失败让调用方走错误文案，而不是
      // 留下一个无主 detached master 活到 ControlPersist 窗口结束。
      return Promise.resolve({ ok: false, error: 'connection manager disposed' })
    }
    if (this.degraded) {
      const s = this.stat(host.id)
      s.master = 'degraded'
      return Promise.resolve({ ok: true, degraded: true })
    }
    if (this.pending.has(host.id)) return this.pending.get(host.id)
    const p = this._ensureMasterInner(host).finally(() => this.pending.delete(host.id))
    this.pending.set(host.id, p)
    return p
  }

  async _ensureMasterInner(host) {
    const s = this.stat(host.id)
    s.tornDown = false
    const started = Date.now()
    const r0 = await this._sshOnce(this.checkArgs(host))
    if (r0.code === 0) {
      s.master = 'up'
      s.latencyMs = Date.now() - started
      s.establishedAt = s.establishedAt || Date.now()
      s.lastError = null
      return { ok: true, reused: true }
    }
    if (this.disposed) return { ok: false, error: 'connection manager disposed' }
    // 清残留 socket
    try { fs.rmSync(this.sockPath(host), { force: true }) } catch { /* */ }
    try { fs.mkdirSync(this.cmDir, { recursive: true }) } catch { /* */ }
    const masterArgs = [...this.muxArgs(host), '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=4', '-N', this.target(host)]
    let child
    try {
      child = this._spawnSsh(masterArgs, { detached: true, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    } catch (err) {
      s.lastError = 'spawn ssh 失败: ' + (err && err.message)
      return { ok: false, error: s.lastError }
    }
    let stderrBuf = ''
    let masterExited = false
    let exitInfo = null
    if (child.stderr) child.stderr.on('data', d => { stderrBuf = (stderrBuf + d.toString('utf8')).slice(-2048) })
    // spawn 失败（ENOENT 等）走 'error' 而非 'exit'；不监听会变成未捕获异常。
    child.on('error', err => {
      masterExited = true
      s.lastError = 'spawn ssh 失败: ' + (err && err.message)
    })
    child.on('exit', (code, signal) => {
      masterExited = true
      exitInfo = { code, signal }
      if (child.pid !== undefined) delete s.pid
      // teardown 后迟到的 exit 不写 lastError；建连期/运行期死亡照常走 establishedAt===null 判据记录
      if (this.stat(host.id).tornDown) return
      if (this.stat(host.id).establishedAt === null) s.lastError = stderrBuf.trim().split(/\r?\n/).slice(-2).join(' | ')
    })
    if (child.pid !== undefined) s.pid = child.pid
    const deadline = Date.now() + Math.max(this.connectFloorMs, (host.connectTimeoutSec || 15) * 2000 + 2000)
    for (;;) {
      await this._sleep(Math.max(10, this.probeIntervalMs * this.sleepMs))
      if (this.disposed) {
        try { child.kill() } catch { /* */ }
        s.master = 'down'
        return { ok: false, error: 'connection manager disposed' }
      }
      // master 前台进程退出 ≠ 失败：ControlPersist 会把 master daemon 化到后台，
      // 前台随即以 0 退出（socket 已建好、-O check 可查到 master）——实测验证过。
      // 只有非 0 退出 / 信号 / spawn 失败才是真失败，且应立刻返回（认证失败、
      // 网络不通都发生在 1~2s 内，否则要干等到 deadline，用户端表现为"一直测试中"）。
      if (masterExited && !(exitInfo && exitInfo.code === 0 && !exitInfo.signal)) {
        s.master = 'down'
        const stderrTail = stderrBuf.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' | ')
        const how = exitInfo ? ('exit ' + (exitInfo.signal || exitInfo.code)) : '已退出'
        s.lastError = s.lastError || stderrTail || ('master 进程' + how + '（无 stderr 输出）')
        return { ok: false, error: s.lastError }
      }
      const c = await this._sshOnce(this.checkArgs(host))
      if (c.code === 0) {
        s.master = 'up'
        s.latencyMs = Date.now() - started
        s.establishedAt = Date.now()
        s.lastError = null
        return { ok: true }
      }
      if (Date.now() > deadline) {
        try { child.kill() } catch { /* */ }
        s.master = 'down'
        s.lastError = s.lastError || ('master 在 ' + (host.connectTimeoutSec || 15) * 2 + 's 内未就绪')
        return { ok: false, error: s.lastError }
      }
    }
  }

  /** 操作前调用：master 失效则重建一次；degraded 直通。 */
  async beforeOp(host) {
    const r = await this.ensureMaster(host)
    // commands 统计 mux 复用路径的操作数（degraded 逐次直连不计）
    if (r.ok && !r.degraded) this.stat(host.id).commands += 1
    return r
  }

  async teardown(host) {
    if (this.degraded) return
    const r = await this._sshOnce([...this.checkArgs(host).slice(0, -3), '-O', 'exit', this.target(host)])
    const s = this.stat(host.id)
    // -O exit 失败（socket 失联/超时）且记录过 master pid：直接按 pid 兜底
    // kill，避免 detached master 存活到 ControlPersist 窗口（默认 600s）。
    if (r && typeof r.code === 'number' && r.code !== 0 && s.pid !== undefined) {
      try { process.kill(s.pid, 'SIGTERM') } catch { /* 已退出或不可达 */ }
    }
    s.master = 'down'
    s.tornDown = true
    s.establishedAt = null
    delete s.pid
    void r
  }

  async teardownAll(hosts) {
    for (const h of hosts) await this.teardown(h)
  }

  view() {
    return [...this.stats.entries()].map(([id, s]) => {
      const { tornDown, ...rest } = s
      void tornDown
      return { id, ...rest }
    })
  }

  _sleep(ms) {
    return new Promise(resolve => {
      const h = setTimeout(resolve, Math.max(1, ms))
      if (h.unref) h.unref()
    })
  }
}
