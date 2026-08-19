'use strict'
// mcp-store → 真引擎端到端验收（对应计划第 6 节）：
//   临时 DSH_HOME（软链真实 node_modules）+ mock provider（DEEPSEEK_BASE_URL
//   指向本地 SSE mock，无需真实 key）→ 启动 dsh web → mcpServerSave 写入
//   cordis.patch.yml → HMR 热加载拉起 echo server → mock 收到的 tools 列表
//   证明注册 → 两轮 SSE 完成 mcp__e2e__echo 真实调用 → 禁用 → 工具消失。
// 用法：node build/mcp-e2e/run.js
const fs = require('fs')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')
const Module = require('module')

const DIR = __dirname
const ROOT = path.join(DIR, '..', '..')
const UPSTREAM = path.join(ROOT, 'deepseek-harness')
const BIN = path.join(UPSTREAM, 'apps', 'cli', 'lib', 'bin.js')
const HOME = path.join(DIR, 'home')
const WS = path.join(DIR, 'ws')
const LOG = path.join(DIR, 'dsh.log')
const REAL_HOME = path.join(process.env.HOME || '/Users/libing', '.kcoder')
const SERVER_JS = path.join(DIR, '..', 'mcp-verify', 'server.js')

let pass = 0
const fail = []
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail.push(name); console.log(`  ✗ ${name}`) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitUntil(fn, timeoutMs, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (fn() === true) return true
    await sleep(500)
  }
  throw new Error(`等待超时（${label}，${timeoutMs}ms）`)
}

const rpc = async (baseUrl, method, payload) => {
  const resp = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `e2e-${Date.now()}`, method, payload }),
  })
  if (!resp.ok) throw new Error(`${method} HTTP ${resp.status}`)
  const body = JSON.parse(await resp.text())
  if (!body.result || body.result.ok !== true) {
    throw new Error(`${method} 失败: ${JSON.stringify(body.result?.error ?? body)}`)
  }
  return body.result.value
}

/** 两轮状态机 mock provider：轮 1 回 tool_call，轮 2（收到 tool 结果）回文本。 */
function startMockProvider() {
  const seen = [] // 每个请求的 { tools 名单, hasToolRole }
  const sse = (chunks) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  const server = http.createServer((req, resp) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      resp.writeHead(404).end()
      return
    }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const parsed = JSON.parse(body)
      const toolNames = (parsed.tools ?? []).map((t) => t.function?.name ?? t.name)
      const hasToolRole = (parsed.messages ?? []).some((m) => m.role === 'tool')
      seen.push({ toolNames, hasToolRole })
      const base = { id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'mock' }
      let payload
      if (!hasToolRole) {
        payload = sse([
          { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
          { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'mcp__e2e__echo', arguments: '{"text":"hello-e2e"}' } }] }, finish_reason: null }] },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
        ])
      } else {
        payload = sse([
          { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'TOOL-RESULT: 完成' }, finish_reason: null }] },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        ])
      }
      resp.writeHead(200, { 'content-type': 'text/event-stream' })
      resp.end(payload)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port }))
  })
}

async function main() {
  if (!fs.existsSync(BIN)) throw new Error(`dsh bin 不存在：${BIN}（需先构建上游）`)

  /* ---- 1. 临时 DSH_HOME：软链 node_modules，其余 cp 保真 ---- */
  fs.rmSync(HOME, { recursive: true, force: true })
  const PROFILE = path.join(HOME, 'profiles', 'web')
  fs.mkdirSync(PROFILE, { recursive: true })
  fs.mkdirSync(WS, { recursive: true })
  for (const f of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'cordis.yml']) {
    fs.copyFileSync(path.join(REAL_HOME, 'profiles', 'web', f), path.join(PROFILE, f))
  }
  fs.cpSync(path.join(REAL_HOME, 'profiles', 'web', 'patches'), path.join(PROFILE, 'patches'), { recursive: true })
  fs.copyFileSync(path.join(REAL_HOME, 'profiles', 'web', 'cordis.patch.yml'), path.join(PROFILE, 'cordis.patch.yml'))
  // 用最小 patch 层开头（保留 compaction 行供 E10 保真检查，但不含用户真实
  // MCP 条目——内置服务器物化后用户配置会有 4 个 builtin 条目，会干扰 E3/E9 断言）
  const userPatch = fs.readFileSync(path.join(PROFILE, 'cordis.patch.yml'), 'utf8')
  const compactionLine = userPatch.split('\n').find(l => l.includes('id: compaction-basic'))
  const MINIMAL_PATCH = compactionLine
    ? `- disable:\n    id: compaction-basic\n    disabled: true\n`
    : '[]\n'
  fs.writeFileSync(path.join(PROFILE, 'cordis.patch.yml'), MINIMAL_PATCH)
  fs.symlinkSync(path.join(REAL_HOME, 'profiles', 'web', 'node_modules'), path.join(PROFILE, 'node_modules'))
  fs.symlinkSync(path.join(REAL_HOME, 'profiles', 'node_modules'), path.join(HOME, 'profiles', 'node_modules'))
  fs.writeFileSync(path.join(HOME, 'settings.yaml'), 'locale:\n  preference: zh\n')
  const ORIGINAL_PATCH_TEXT = fs.readFileSync(path.join(PROFILE, 'cordis.patch.yml'), 'utf8')

  /* ---- 2. mcp-store 转译（stub dsh-contract 读 DSH_HOME env）---- */
  process.env.DSH_HOME = HOME
  fs.writeFileSync(path.join(DIR, 'dsh-contract-stub.js'),
    "module.exports = { dshHome: () => process.env.DSH_HOME, WEB_PROFILE: 'web' }\n")
  const origResolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    if (request === './dsh-contract') return path.join(DIR, 'dsh-contract-stub.js')
    return origResolve.call(this, request, ...rest)
  }
  const es = require(path.join(ROOT, 'node_modules', '.pnpm', 'esbuild@0.25.12', 'node_modules', 'esbuild'))
  es.buildSync({
    entryPoints: [path.join(ROOT, 'desktop', 'main', 'mcp-store.ts')],
    format: 'cjs', target: 'node20', platform: 'node',
    outfile: path.join(DIR, 'store.js'),
  })
  const { mcpServers, mcpServerSave } = require('./store.js')

  /* ---- 3. mock provider + 引擎 ---- */
  const mock = await startMockProvider()
  console.log(`mock provider: 127.0.0.1:${mock.port}`)
  const logFd = fs.openSync(LOG, 'w')
  const child = spawn(process.execPath, ['--expose-internals', BIN, 'web', '--port', '0'], {
    cwd: UPSTREAM,
    env: {
      ...process.env,
      DSH_HOME: HOME,
      DEEPSEEK_API_KEY: 'mock-key-e2e',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${mock.port}`,
    },
    stdio: ['ignore', logFd, logFd],
  })
  let engineLog = ''
  const readLog = () => { try { engineLog = fs.readFileSync(LOG, 'utf8') } catch { engineLog = '' } return engineLog }

  try {
    console.log('\n[1] 引擎启动（就绪行）')
    let baseUrl = ''
    await waitUntil(() => {
      const m = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/.exec(readLog())
      if (m === null) return false
      baseUrl = m[1]
      return true
    }, 60_000, '引擎就绪')
    check('E1 引擎就绪（loader 结算通过）', Boolean(baseUrl))
    console.log(`  engine: ${baseUrl}`)

    console.log('\n[2] mcpServerSave 写入 → HMR 热加载（模拟 GUI 保存，不重启引擎）')
    const saveR = mcpServerSave({
      id: '', serverName: 'e2e', transport: 'stdio', enabled: true,
      command: process.execPath, args: [SERVER_JS], env: {}, cwd: '',
      url: '', headers: {}, toolCallTimeoutMs: null,
    })
    check('E2 保存成功', saveR.ok)
    check('E3 列表读回 1 条', mcpServers().length === 1 && mcpServers()[0].serverName === 'e2e')
    await waitUntil(() => {
      const l = readLog()
      return l.includes('[mcp-verify-server] started') && l.includes('[mcp-verify-server] initialized')
    }, 20_000, 'HMR 拉起 mcp server')
    check('E4 HMR 热加载：echo server 被拉起并完成握手（started+initialized）',
      readLog().includes('[mcp-verify-server] started') && readLog().includes('[mcp-verify-server] initialized'))

    console.log('\n[3] 会话内真实工具调用（两轮 SSE：tool_call → 结果 → 文本）')
    const created = await rpc(baseUrl, 'session.create', { cwd: WS })
    await rpc(baseUrl, 'session.prompt', {
      sessionId: created.sessionId, mode: 'queue',
      content: [{ type: 'text', text: '调用 mcp__e2e__echo 工具' }],
    })
    await waitUntil(() => mock.seen.some((s) => s.hasToolRole) === true, 120_000, '工具调用完成（第二轮请求）')
    const regReq = mock.seen.find((s) => !s.hasToolRole)
    check('E5 工具已注册（provider 请求 tools 含 mcp__e2e__echo）',
      regReq !== undefined && regReq.toolNames.includes('mcp__e2e__echo'))
    check('E6 工具真实执行（echo server 收到 tools/call）', readLog().includes('[mcp-verify-server] tools/call echo: hello-e2e'))
    check('E7 工具结果回传模型（第二轮请求含 tool role）', mock.seen.some((s) => s.hasToolRole))

    console.log('\n[4] 禁用 → HMR 摘除（模拟 GUI 开关）')
    const cur = mcpServers()[0]
    const disR = mcpServerSave({ ...cur, enabled: false })
    check('E8 禁用保存成功', disR.ok)
    await sleep(3_000)
    // 老会话第三轮：工具集可能已随会话快照固定（上游语义），仅诊断不断言
    await rpc(baseUrl, 'session.prompt', {
      sessionId: created.sessionId, mode: 'queue',
      content: [{ type: 'text', text: '再看看工具还在吗' }],
    })
    // 禁用生效验证用新会话：工具集在会话创建时重新结算
    const created2 = await rpc(baseUrl, 'session.create', { cwd: WS })
    await rpc(baseUrl, 'session.prompt', {
      sessionId: created2.sessionId, mode: 'queue',
      content: [{ type: 'text', text: '看看工具在不在' }],
    })
    await waitUntil(() => mock.seen.length >= 4, 60_000, '禁用后新会话请求')
    const oldSessionReq = mock.seen[2]
    console.log(`  （诊断）老会话第三轮 tools 含 e2e: ${oldSessionReq.toolNames.includes('mcp__e2e__echo')}（会话内快照固定属正常）`)
    const newSessionReq = mock.seen[3]
    check('E9 禁用后新会话工具从 provider 请求中消失', !newSessionReq.toolNames.includes('mcp__e2e__echo'))
    const finalPatch = fs.readFileSync(path.join(PROFILE, 'cordis.patch.yml'), 'utf8')
    check('E10 其他 patch 内容保真（compaction 禁用行仍在）', finalPatch.includes('id: compaction-basic') && finalPatch.length > ORIGINAL_PATCH_TEXT.length / 2)

    console.log(`\nPASS ${pass} / FAIL ${fail.length}`)
    if (fail.length > 0) {
      console.log('FAILURES:', fail)
      console.log('\n===== dsh.log 尾部 =====')
      console.log(readLog().slice(-3000))
      process.exitCode = 1
    }
  } finally {
    child.kill('SIGTERM')
    mock.server.close()
    fs.closeSync(logFd)
    // 保留 dsh.log 供查障；临时 home 与转译产物清理
    fs.rmSync(HOME, { recursive: true, force: true })
    fs.rmSync(path.join(DIR, 'store.js'), { force: true })
    fs.rmSync(path.join(DIR, 'dsh-contract-stub.js'), { force: true })
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
