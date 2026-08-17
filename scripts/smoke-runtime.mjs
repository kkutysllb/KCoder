#!/usr/bin/env node
/**
 * 运行时真实起服冒烟（打包前后的统一验收）。
 *
 * 在目标目录（默认 staging/dsh-runtime，或 --dir 指定打包后的
 * resources/dsh-runtime）真实启动 `bin.js web --port 0`，等待就绪行
 * `dsh web: http://127.0.0.1:<port>`，再 GET / 要求 HTTP 200。
 * 任何一步失败即非零退出——禁止坏运行时进入安装包或被放行。
 *
 * 用法：node scripts/smoke-runtime.mjs [--dir <runtime-dir>] [--exec <interpreter>]
 *
 * --exec 指定解释器（默认当前 node）。传入 Electron 应用二进制时以
 * ELECTRON_RUN_AS_NODE 形态运行——复现真机 GUI 启动路径（PATH 无
 * 系统 node 时回退 Electron 内置 node）。两种形态都带
 * --expose-internals（与桌面端 resolveRuntime 的真实 spawn 严格一致：
 * web profile 的 HMR 需 internal loader，Electron node 下 addon 回退
 * 不可用，v0.1.0 真机曾挂在此处而系统 node 冒烟漏过）。
 *
 * @module scripts/smoke-runtime
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
let dir = resolve(import.meta.dirname, '..', 'staging', 'dsh-runtime')
let exec = process.execPath
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir') {
    if (!args[i + 1]) { console.error('[smoke] --dir 需要路径参数'); process.exit(2) }
    dir = resolve(args[++i])
  } else if (args[i] === '--exec') {
    if (!args[i + 1]) { console.error('[smoke] --exec 需要解释器路径'); process.exit(2) }
    exec = resolve(args[++i])
  }
}
if (!existsSync(join(dir, 'lib', 'bin.js'))) {
  console.error(`[smoke] ${dir} 下无 lib/bin.js`)
  process.exit(2)
}

const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-'))
const isElectron = exec !== process.execPath
const child = spawn(exec, ['--expose-internals', 'lib/bin.js', 'web', '--port', '0'], {
  cwd: dir,
  env: {
    ...process.env,
    DSH_HOME: home,
    ...(isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let buf = ''
const READY = /dsh web: http:\/\/127\.0\.0\.1:(\d+)/
const timer = setTimeout(() => fail('60s 内未出现就绪行'), 60_000)

let done = false
function fail(reason) {
  if (done) return
  clearTimeout(timer)
  child.kill('SIGKILL')
  console.error(`[smoke] 失败：${reason}`)
  console.error(buf.split('\n').slice(-25).join('\n'))
  cleanup()
  process.exit(1)
}
function cleanup() {
  try { rmSync(home, { recursive: true, force: true }) } catch { /* 尽力 */ }
}

child.stdout.on('data', (d) => { buf += d })
child.stderr.on('data', (d) => { buf += d })
child.on('exit', (code) => fail(`进程提前退出（code=${code}）`))

function poll() {
  const m = READY.exec(buf)
  if (m === null) { setTimeout(poll, 500); return }
  const url = `http://127.0.0.1:${m[1]}`
  fetch(`${url}/`)
    .then((res) => {
      if (res.status !== 200) fail(`首页 HTTP ${res.status}`)
      clearTimeout(timer)
      done = true // 主动收尾，exit 事件不再视为失败
      console.log(`[smoke] 通过：就绪行 + 首页 200（${url}）`)
      child.kill('SIGTERM')
      setTimeout(() => { child.kill('SIGKILL'); cleanup(); process.exit(0) }, 300)
    })
    .catch((e) => fail(`首页请求异常：${e.message}`))
}
poll()
