#!/usr/bin/env node
/**
 * 运行时真实起服冒烟（打包前后的统一验收）。
 *
 * 在目标目录（默认 staging/kcoder-runtime，或 --dir 指定打包后的
 * resources/kcoder-runtime）真实启动 `bin.js web --port 0`，等待就绪行
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
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
let dir = resolve(import.meta.dirname, '..', 'staging', 'kcoder-runtime')
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

// vendored pnpm 必须随运行时分发：预置插件/补丁物化链（桌面端
// runPnpm）依赖它，普通用户机器没有 pnpm。缺了即坏包——禁止放行。
{
  const entry = join(dir, 'tools', 'pnpm', 'bin', 'pnpm.mjs')
  if (!existsSync(entry)) {
    console.error(`[smoke] ${dir} 下缺 tools/pnpm/bin/pnpm.mjs（预置插件安装链退回 PATH pnpm，普通用户机器不可用）`)
    process.exit(2)
  }
  // Electron 二进制形态需 RUN_AS_NODE（与起服 spawn 同款 env 处理）
  const v = spawnSync(exec, [entry, '--version'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      ...(exec !== process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
  })
  if (v.status !== 0 || !String(v.stdout).trim().startsWith('11.')) {
    console.error(`[smoke] vendored pnpm 不可执行（exit=${v.status}，stdout=${String(v.stdout).trim()}，stderr=${String(v.stderr).trim().slice(0, 300)}）`)
    process.exit(2)
  }
  console.log(`[smoke] vendored pnpm ${String(v.stdout).trim()} 可执行`)
}

const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-'))
const isElectron = exec !== process.execPath
// --no-open：上游 rc.8 起 `dsh web` 默认把就绪 URL 交给系统默认浏览器
//——冒烟在 CI/后台跑，弹浏览器既是副作用也可能因无浏览器而拖慢/失败；
//与桌面端 dsh-manager 同款参数（版本门由物化基线保证 ≥ rc.8）
const child = spawn(exec, ['--expose-internals', 'lib/bin.js', 'web', '--port', '0', '--no-open'], {
  cwd: dir,
  env: {
    ...process.env,
    DSH_HOME: home,
    ...(isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let buf = ''
// 0.1.2-alpha.1 起就绪行携一次性启动 token（首页鉴权，丢了即 401）；
// 捕获完整 URL 而非从端口重建。token 是进程级稳定值，首访铸 cookie 后
// 后续请求靠 cookie（browser-auth 同款链路）。
const READY = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/?(?:\?[^\s]*)?)/
const timer = setTimeout(() => fail('60s 内未出现就绪行'), 60_000)

let done = false
function fail(reason) {
  if (done) return
  clearTimeout(timer)
  child.kill('SIGKILL')
  console.error(`[smoke] 失败：${reason}`)
  // 就绪行携启动 token，回显前脱敏（CI 日志公开可见）
  console.error(buf.split('\n').slice(-25).map((l) => l.replace(/token=[^&\s]+/, 'token=<redacted>')).join('\n'))
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
  // authUrl = 就绪行整段（可能携 token）；旧基线无鉴权时即裸首页。
  // token 鉴权链路是「首访携 token → 铸 cookie → 303 落首页」；node 全局
  // fetch 无 cookie jar，redirect: 'follow' 跳转会丢 Set-Cookie 致落点仍 401，
  // 故手动跟随：取 set-cookie + location，携 cookie 请求落点验 200。
  const authUrl = m[1]
  const redact = (u) => u.replace(/token=[^&\s]+/, 'token=<redacted>')
  const pass = () => {
    clearTimeout(timer)
    done = true // 主动收尾，exit 事件不再视为失败
    console.log(`[smoke] 通过：就绪行 + 首页 200（${authUrl.replace(/[?&]token=[^&\s]+/, '')}）`)
    child.kill('SIGTERM')
    setTimeout(() => { child.kill('SIGKILL'); cleanup(); process.exit(0) }, 300)
  }
  fetch(authUrl, { redirect: 'manual' })
    .then(async (res) => {
      if (res.status === 200) { pass(); return } // 无鉴权基线：直接首页 200
      const location = res.headers.get('location')
      const setCookies = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [])
      if (res.status >= 300 && res.status < 400 && location && setCookies.length > 0) {
        const target = new URL(location, authUrl).href
        const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
        const res2 = await fetch(target, { headers: { cookie }, redirect: 'follow' })
        if (res2.status === 200) { pass(); return }
        fail(`鉴权后首页 HTTP ${res2.status}（${redact(target)}）`)
        return
      }
      fail(`首页 HTTP ${res.status}（${redact(authUrl)}）`)
    })
    .catch((e) => fail(`首页请求异常：${e.message}`))
}
poll()
