#!/usr/bin/env node
/**
 * 侧栏文件读取的活体检查（跨工作区 / 工作区外绝对路径）。
 *
 * 背景（2026-09-19 现场）：跨工作区预览报 `path "…" is outside workspace`。
 * 上游 `packages/api/workspace-files` 的读取契约明确允许工作区外的绝对路径
 * （"absolute path or path relative to the workspace root; files outside it are
 * allowed"），而宿主桥沿用写路径的 containment 守卫，比上游更严——agent 写到
 * /tmp 的产物、另一个仓库里的文件一律 403。本脚本经 CDP 在**运行中的 dev 实例**
 * 上直接调 `/sidebar/api/fs.read`，把"修前 403 / 修后 200"变成可复跑的证据。
 *
 * 用法（两步）：
 *   1) 用户在终端：KC_REMOTE_DEBUG_PORT=9333 pnpm dev
 *   2) 本机：node scripts/check-sidebar-fsread.mjs [--port 9333] [--out-of-workspace PATH]
 *
 * 默认探针文件：`/tmp/kcoder-outside-read-check.txt`（不存在时脚本自建一行）。
 * 判定：**工作区内**读取必须 ok（对照），**工作区外**读取也必须 ok（本修复的
 * 断言）——两者都通过才算 PASS；工作区外 403 即修复未生效（或宿主半仍是旧版）。
 *
 * 依赖 playwright-core（仅客户端，无浏览器二进制）：脚本按需自装到 /tmp/pwclient。
 *
 * @module scripts/check-sidebar-fsread
 */

import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'

const PW_DIR = '/tmp/pwclient'

/** 确保 playwright-core 可用（缺失即装到 /tmp，不动仓库依赖）。 */
async function loadPlaywright() {
  const entry = `${PW_DIR}/node_modules/playwright-core/index.js`
  if (!existsSync(entry)) {
    console.log(`[fsread] 首次运行：安装 playwright-core → ${PW_DIR}`)
    execFileSync('npm', ['init', '-y'], { cwd: PW_DIR, stdio: 'ignore' })
    execFileSync('npm', ['i', 'playwright-core', '--no-audit', '--no-fund'], { cwd: PW_DIR, stdio: 'ignore' })
  }
  const mod = await import(entry)
  return mod.default ?? mod
}

const args = process.argv.slice(2)
const portArg = args.indexOf('--port')
const port = portArg === -1 ? 9333 : Number(args[portArg + 1])
const outArg = args.indexOf('--out-of-workspace')
const outsidePath = outArg === -1 ? '/tmp/kcoder-outside-read-check.txt' : String(args[outArg + 1])

if (!existsSync(outsidePath)) {
  writeFileSync(outsidePath, `KCoder outside-workspace read check ${new Date().toISOString()}\n`)
  console.log(`[fsread] 已创建探针文件：${outsidePath}`)
}

const pw = await loadPlaywright()
let browser
try {
  browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`)
} catch (error) {
  console.error(`[fsread] 连不上 CDP 127.0.0.1:${String(port)}——确认 dev 用 KC_REMOTE_DEBUG_PORT=${String(port)} 启动：${String(error?.message ?? error)}`)
  process.exit(2)
}

const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('127.0.0.1'))
if (page === undefined) {
  console.error('[fsread] 没有找到应用页面')
  await browser.close().catch(() => {})
  process.exit(2)
}

const report = await page.evaluate(async ({ outsidePath }) => {
  /** POST one sidebar API method from inside the GUI (same-origin fetch). */
  const call = async (method, payload) => {
    const response = await fetch(`/sidebar/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => null)
    return {
      status: response.status,
      ok: body?.ok === true,
      error: body?.error?.message ?? null,
      kind: body?.value?.kind ?? null,
    }
  }
  // 本插件自己的持久化状态：键形如 dsh-sidebar:v1:<sessionId>（值是排空后的
  // per-session 状态；cwd 可能不在其中，则用 session.cwd 路由取权威值）。
  const sessions = []
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('dsh-sidebar:v1:session-')) continue
    const sessionId = key.slice('dsh-sidebar:v1:'.length)
    let state = null
    try { state = JSON.parse(localStorage.getItem(key)) } catch { /* 非 JSON 项跳过 */ }
    const tabs = state?.tabs ?? state?.state?.tabs ?? {}
    const readScopes = Object.values(tabs)
      .map(tab => tab?.meta)
      .filter(meta => meta !== null && typeof meta === 'object' && typeof meta.readCwd === 'string')
    sessions.push({ sessionId, cwd: state?.cwd ?? state?.state?.cwd ?? null, readScopes, tabCount: Object.keys(tabs).length })
    if (sessions.length >= 3) break
  }
  const results = []
  for (const session of sessions) {
    let cwd = session.cwd
    if (cwd === null || cwd === undefined) {
      // session.cwd 路由返回 { sessionId, cwd, root, parent }；失败时保持未知。
      const info = await call('session.cwd', { sessionId: session.sessionId }).catch(() => null)
      cwd = info?.ok === true ? undefined : undefined
    }
    results.push({
      sessionId: session.sessionId,
      cwd: cwd ?? null,
      tabCount: session.tabCount,
      readScopes: session.readScopes,
      insideRead: cwd === null || cwd === undefined
        ? null
        : await call('fs.read', { sessionId: session.sessionId, cwd, path: `${cwd}/package.json` }),
      outsideRead: await call('fs.read', {
        sessionId: session.sessionId,
        ...(cwd !== null && cwd !== undefined ? { cwd } : {}),
        path: outsidePath,
      }),
    })
  }
  return { sessions: sessions.map(s => ({ sessionId: s.sessionId, cwd: s.cwd, tabCount: s.tabCount })), outsidePath, results }
}, { outsidePath })

console.log(JSON.stringify(report, null, 1))
await browser.close().catch(() => {})

const outside = report.results.map(r => r.outsideRead)
const pass = outside.length > 0 && outside.every(r => r.ok)
console.log(`\n[fsread] 工作区外读取（${outsidePath}）：${outside.map(r => String(r.status)).join(', ') || '无会话可测'}`)
console.log(pass
  ? '[fsread] 结论：PASS（工作区外读取已放行，与上游 workspace-files 契约一致）'
  : '[fsread] 结论：FAIL（仍被 containment 拒绝——宿主半未更新到含 resolveReadPath 的版本？）')
process.exit(pass ? 0 : 1)
