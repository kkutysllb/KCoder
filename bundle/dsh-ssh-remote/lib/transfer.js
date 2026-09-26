// dsh-ssh-remote — 文件传输：单文件 scp（端口 -P 大写）；目录 tar-over-ssh 双进程管道。
import * as cp from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { shellQuote as q, classifyError } from './exec.js'

export class Transfer {
  constructor({ conn, runner, spawnFn, sleepMs = 1 }) {
    this.conn = conn
    this.runner = runner
    this.spawnFn = spawnFn || ((cmd, args, o) => cp.spawn(cmd, args, o))
    this.sleepMs = sleepMs
  }

  /** push/pull 统一入口。 */
  push(host, localPath, remotePath, { recursive = false, timeoutMs } = {}) {
    return recursive ? this.pushDir(host, localPath, remotePath, timeoutMs) : this.pushFile(host, localPath, remotePath, timeoutMs)
  }
  pull(host, remotePath, localPath, { recursive = false, timeoutMs } = {}) {
    return recursive ? this.pullDir(host, remotePath, localPath, timeoutMs) : this.pullFile(host, remotePath, localPath, timeoutMs)
  }

  async pushFile(host, localPath, remotePath, timeoutMs) {
    const args = [...this.conn.scpArgs(host)]
    if (host.port && host.port !== 22) args.push('-P', String(host.port))
    args.push(String(localPath), this.conn.target(host) + ':' + String(remotePath))
    return this._runScp(args, timeoutMs)
  }

  async pullFile(host, remotePath, localPath, timeoutMs) {
    const args = [...this.conn.scpArgs(host)]
    if (host.port && host.port !== 22) args.push('-P', String(host.port))
    args.push(this.conn.target(host) + ':' + String(remotePath), String(localPath))
    return this._runScp(args, timeoutMs)
  }

  /** 目录推：mkdir -p 远端 → 本地 tar 打包 stdout 接 ssh stdin。 */
  async pushDir(host, localDir, remoteDir, timeoutMs) {
    const mk = await this.runner.run(host, 'mkdir -p ' + q(remoteDir), {})
    if (mk.exitCode !== 0) return { exitCode: mk.exitCode, stderr: mk.stderr, durationMs: mk.durationMs, timedOut: false, errorKind: mk.errorKind }
    const remote = 'tar -C ' + q(remoteDir) + ' -xf -'
    return this._tarPipe(host,
      ['-C', String(localDir), '-cf', '-', '.'],
      remote, timeoutMs)
  }

  /** 目录拉：ssh tar 打包 stdout 接本地 tar stdin。 */
  async pullDir(host, remoteDir, localDir, timeoutMs) {
    try { fs.mkdirSync(String(localDir), { recursive: true }) } catch { /* */ }
    const remote = 'tar -C ' + q(remoteDir) + ' -cf - .'
    return this._tarPipe(host,
      ['-C', String(localDir), '-xf', '-'],
      remote, timeoutMs, { producer: 'ssh', consumer: 'tar' })
  }

  /** producer(本地 tar) → consumer(ssh)；pull 时反向。 */
  _tarPipe(host, tarArgs, remote, timeoutMs, { producer = 'tar', consumer = 'ssh' } = {}) {
    return new Promise((resolve) => {
      const started = Date.now()
      // 组装：ssh [opts] target 'remote-script'
      const sshArgv = [...this.conn.muxArgs(host), this.conn.target(host), remote]
      let producerChild, consumerChild
      try {
        const tarSpawnOpts = { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
        if (producer === 'tar') {
          producerChild = this.spawnFn('tar', tarArgs, tarSpawnOpts)
          consumerChild = this.spawnFn('ssh', sshArgv, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        } else {
          producerChild = this.spawnFn('ssh', sshArgv, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
          consumerChild = this.spawnFn('tar', tarArgs, tarSpawnOpts)
        }
        // EPIPE 防崩（对齐 exec.js Runner 的教训）：pipe 目标流挂 error 监听，结局由 close 兜底
        if (consumerChild.stdin) consumerChild.stdin.on('error', () => {})
        producerChild.stdout.pipe(consumerChild.stdin)
      } catch (err) {
        resolve({ exitCode: -1, stderr: 'spawn 失败: ' + (err && err.message), durationMs: 0, timedOut: false, errorKind: 'spawn-error' })
        return
      }
      let done = false
      let stderr = ''
      const cap = (d) => { stderr = (stderr + d.toString('utf8')).slice(-8192) }
      if (producerChild.stderr) producerChild.stderr.on('data', cap)
      if (consumerChild.stderr) consumerChild.stderr.on('data', cap)
      const finish = (tag, code, extra) => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve({ exitCode: code, stderr: (extra || '') + stderr, durationMs: Date.now() - started, timedOut: false, errorKind: classifyError((extra || '') + stderr, code) || undefined })
      }
      const limit = Math.max(10000, Number(timeoutMs) || 180000)
      const timer = setTimeout(() => {
        done = true
        try { producerChild.kill() } catch { /* */ }
        try { consumerChild.kill() } catch { /* */ }
        resolve({ exitCode: -1, stderr: stderr + '\n[已超时 ' + limit + 'ms，双进程被终止]', durationMs: Date.now() - started, timedOut: true, errorKind: 'timed-out' })
      }, limit)
      consumerChild.on('close', (code) => finish('consumer', code))
      producerChild.on('close', (code) => { if (code !== 0) finish('producer', code) })
      producerChild.on('error', (e) => finish('producer', -1, String(e && e.message)))
      consumerChild.on('error', (e) => finish('consumer', -1, String(e && e.message)))
    })
  }

  _runScp(args, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now()
      let child
      try {
        child = this.spawnFn('scp', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (err) {
        resolve({ exitCode: -1, stderr: 'spawn scp 失败: ' + (err && err.message), durationMs: 0, timedOut: false, errorKind: 'spawn-error' })
        return
      }
      let stderr = ''
      if (child.stderr) child.stderr.on('data', d => { stderr = (stderr + d.toString('utf8')).slice(-8192) })
      const limit = Math.max(10000, Number(timeoutMs) || 180000)
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* */ }
        resolve({ exitCode: -1, stderr: stderr + '\n[已超时 ' + limit + 'ms]', durationMs: Date.now() - started, timedOut: true, errorKind: 'timed-out' })
      }, limit)
      child.on('error', (err) => { clearTimeout(timer); resolve({ exitCode: -1, stderr: 'spawn scp 失败: ' + (err && err.message), durationMs: Date.now() - started, timedOut: false, errorKind: 'spawn-error' }) })
      child.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code, stderr, durationMs: Date.now() - started, timedOut: false, errorKind: classifyError(stderr, code) || undefined }) })
    })
  }
}
