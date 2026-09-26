// dsh-ssh-remote — 远程执行核心：spawn 参数数组直调 ssh（不经任何本地 shell）。
import * as cp from 'node:child_process'

/** 远端 shell 单引号安全引用。 */
export function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

/** 过滤 OpenSSH 良性 stderr 噪音（post-quantum 提示等）。 */
export function cleanSshStderr(text) {
  if (!text) return text
  return text.split(/\r?\n/)
    .filter(line => !/post-quantum|store now, decrypt later|server may need to be upgraded/i.test(line))
    .join('\n')
}

/** 失败分类：Agent 可反应的结构化错误前缀。 */
export function classifyError(stderr, exitCode) {
  if (exitCode === 75) return 'stale-edit'
  const s = stderr || ''
  if (/connection timed out|connection refused|no route to host|network is unreachable|could not resolve hostname|control socket/i.test(s)) return 'unreachable'
  if (/^[^\s@]+@[^\s]+: Permission denied \((publickey|password|hostbased|keyboard-interactive)/m.test(s)) return 'auth'
  if (/no such file or directory/i.test(s)) return 'not-found'
  return null
}

function cap(buf, limit) {
  return buf.length > limit ? buf.slice(buf.length - limit) : buf
}

export class Runner {
  /**
   * @param opts {muxArgs(host): string[], target(host): string, spawnFn?,
   *              defaults {commandTimeoutMs, maxStdout, maxStderr}}
   */
  constructor(opts = {}) {
    this.opts = opts
    this.spawnFn = opts.spawnFn || ((cmd, args, o) => cp.spawn(cmd, args, o))
    this.defaults = Object.assign({ commandTimeoutMs: 60000, maxStdout: 262144, maxStderr: 65536 }, opts.defaults)
  }

  /** 组装完整 ssh argv：mux 参数 + user@host + 远端命令（单参数）。 */
  argv(host, remote) {
    return [...this.opts.muxArgs(host), this.opts.target(host), remote]
  }

  /** 执行远程命令；cwd 归 host.defaultCwd（可被参数覆盖）。 */
  async run(host, command, o = {}) {
    const cwd = o.cwd !== undefined ? o.cwd : host.defaultCwd
    const remote = (cwd ? 'cd ' + shellQuote(cwd) + ' && ' : '') + String(command)
    return this.execArgv(host, this.argv(host, remote), { stdin: null, timeoutMs: o.timeoutMs, maxStdout: o.maxStdout })
  }

  /** 远端脚本 + stdin 载荷（write/edit 用）。 */
  async runWithStdin(host, remoteScript, o = {}) {
    return this.execArgv(host, this.argv(host, remoteScript), { stdin: o.stdin || '', timeoutMs: o.timeoutMs, maxStdout: o.maxStdout })
  }

  execArgv(host, args, { stdin, timeoutMs, maxStdout }) {
    return new Promise((resolve) => {
      const started = Date.now()
      // 按调用放宽 stdout 上限（read/readWhole 大窗口需要；底限 4096 仅约束显式覆盖值，防误传 0/负数——
      // 不作用于 defaults，否则小上限配置（如测试的 64）被抬高、截断语义失真）
      const maxOut = Number(maxStdout) > 0 ? Math.max(4096, Number(maxStdout)) : this.defaults.maxStdout
      let child
      try {
        child = this.spawnFn('ssh', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (err) {
        resolve({ exitCode: -1, stdout: '', stdoutTruncated: false, stderr: 'spawn ssh 失败: ' + (err && err.message), durationMs: 0, timedOut: false, errorKind: 'spawn-error' })
        return
      }
      let stdout = ''
      let stderr = ''
      let stdoutTruncated = false
      if (child.stdout) child.stdout.on('data', d => { const s = stdout + d.toString('utf8'); if (s.length > maxOut) { stdout = s.slice(s.length - maxOut); stdoutTruncated = true } else stdout = s })
      if (child.stderr) child.stderr.on('data', d => { stderr = cap(stderr + d.toString('utf8'), this.defaults.maxStderr) })
      if (child.stdin) child.stdin.on('error', () => { /* EPIPE：远端早退，close 兜底返回 */ })
      if (stdin !== null && child.stdin) {
        child.stdin.write(stdin)
        child.stdin.end()
      }
      const limit = Math.max(1000, Number(timeoutMs) || this.defaults.commandTimeoutMs)
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        resolve({ exitCode: -1, stdout, stdoutTruncated, stderr: cleanSshStderr(stderr) + '\n[已超时 ' + limit + 'ms，本地进程被终止]', durationMs: Date.now() - started, timedOut: true, errorKind: 'timed-out' })
      }, limit)
      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ exitCode: -1, stdout, stdoutTruncated, stderr: 'spawn ssh 失败: ' + (err && err.message), durationMs: Date.now() - started, timedOut: false, errorKind: 'spawn-error' })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const cleaned = cleanSshStderr(stderr)
        resolve({ exitCode: code ?? -1, stdout, stdoutTruncated, stderr: cleaned, durationMs: Date.now() - started, timedOut: false, errorKind: classifyError(cleaned, code) })
      })
    })
  }
}
