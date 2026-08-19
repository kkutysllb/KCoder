/**
 * MCP 设置分区 DOM 冒烟：手搓上游设置对话框 DOM → 注入 mcp-settings 的
 * PAGE_JS → 推合成服务器列表 → 激活「MCP 服务器」分区 → 断言列表/表单/
 * 启停/删除/console 通道载荷 + 双主题截图。
 *
 * 运行：pnpm exec electron scripts/smoke-mcp-dom.mjs
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BT = String.fromCharCode(96)
const src = readFileSync('desktop/main/mcp-settings.ts', 'utf8')
const decl = 'const PAGE_JS = ' + BT
const from = src.indexOf(decl) + decl.length
const tail = src.indexOf('\n})()' + BT, from)
const endTick = src.indexOf(BT, tail + 1)
const pageJs = eval(BT + src.slice(from, endTick) + BT)

// 上游深色主题真实值（design-platform.css :root[data-theme=dark] 块）
const DARK_VARS = `:root {
  --dsw-alias-bg-layer-2: rgb(44, 44, 46);
  --dsw-alias-brand-primary: rgb(249, 250, 251);
  --dsw-alias-label-primary: rgb(249, 250, 251);
  --dsw-alias-label-primary-inverted: rgb(53, 54, 56);
  --dsw-alias-label-secondary: rgb(151, 157, 166);
  --dsw-alias-label-tertiary: rgb(97, 102, 107);
  --dsw-alias-interactive-bg-hover: rgba(249, 250, 251, .08);
  --dsw-alias-border-l2: rgb(44, 44, 46);
  --dsw-alias-border-l3: rgb(53, 54, 56);
}`

const html = (vars) => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${vars}
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; background: #17181a; display: flex; align-items: center; justify-content: center; height: 100vh; }
  button { font: inherit; }
  .nv { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border: none; background: none; border-radius: 8px; cursor: pointer; color: inherit; }
  .nv.on { background: rgba(255,255,255,.1); font-weight: 600; }
</style></head><body>
<div role="dialog" aria-modal="true" style="display:flex;width:960px;height:640px;background:#1c1d1f;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.5)">
  <nav style="width:200px;background:#17181a;padding:16px 10px;flex:none;color:#e8eaed">
    <div style="font-weight:600;margin:0 8px 10px">设置</div>
    <div>
      <button type="button" class="nv on" aria-current="true"><svg width="16" height="16"><circle cx="8" cy="8" r="7" fill="#888"/></svg><span>通用</span></button>
      <button type="button" class="nv"><svg width="16" height="16"><circle cx="8" cy="8" r="7" fill="#888"/></svg><span>模型</span></button>
    </div>
  </nav>
  <div style="flex:1;padding:20px;overflow:auto;color:#e8eaed">
    <div class="options"><div data-slot="settings.section"><div style="color:#555">原生分区内容占位</div></div></div>
  </div>
</div>
</body></html>`

const servers = [
  { id: 'mcp-verify', serverName: 'verify', transport: 'stdio', enabled: true,
    command: 'node', args: ['server.js', '--flag'], env: { T: '1' }, cwd: '', url: '', headers: {},
    toolCallTimeoutMs: null },
  { id: 'mcp-fetch', serverName: 'fetch', transport: 'stdio', enabled: true,
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'], env: {}, cwd: '', url: '', headers: {},
    toolCallTimeoutMs: null },
  { id: 'mcp-web', serverName: 'web', transport: 'streamable-http', enabled: false,
    command: '', args: [], env: {}, cwd: '', url: 'http://x/mcp', headers: { A: 'b' },
    toolCallTimeoutMs: 30000 },
]
const builtinNames = ['fetch']

async function runScenario(win, label, vars) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-smoke-'))
  writeFileSync(join(dir, 'index.html'), html(vars))
  await win.loadFile(join(dir, 'index.html'))

  // 模拟主进程：捕获 console 通道载荷
  const ops = []
  win.webContents.on('console-message', (event, ...rest) => {
    const message = typeof event?.message === 'string' ? event.message : (typeof rest[2] === 'string' ? rest[2] : '')
    if (message.startsWith('__dsh_mcp__:')) {
      try { ops.push(JSON.parse(message.slice('__dsh_mcp__:'.length))) } catch { /* 忽略 */ }
    }
  })

  await win.webContents.executeJavaScript(pageJs, true)
  await new Promise((r) => setTimeout(r, 400))
  await win.webContents.executeJavaScript(`window.__dshMcpSync(${JSON.stringify(servers)}, ${JSON.stringify(builtinNames)})`, true)
  await new Promise((r) => setTimeout(r, 200))

  // 激活分区
  await win.webContents.executeJavaScript(
    `document.getElementById('__dsh_desktop_mcp_nav').click()`, true)
  await new Promise((r) => setTimeout(r, 300))

  const fails = []
  const listProbe = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const sec = document.getElementById('__dsh_desktop_mcp_section')
    const native = document.querySelector('div[data-slot="settings.section"]')
    return JSON.stringify({
      visible: sec !== null && getComputedStyle(sec).display !== 'none',
      nativeHidden: getComputedStyle(native).display === 'none',
      rows: sec.querySelectorAll('.dmi-row').length,
      navLabel: document.getElementById('__dsh_desktop_mcp_nav').textContent,
      offRow: sec.querySelectorAll('.dmi-row.off').length,
      badges: Array.from(sec.querySelectorAll('.dmi-badge')).map(b => b.textContent),
      descs: Array.from(sec.querySelectorAll('.dmi-desc')).map(d => d.textContent),
      builtinBadges: sec.querySelectorAll('.dmi-builtin').length,
      builtinRowHasDelete: (() => {
        const rows = Array.from(sec.querySelectorAll('.dmi-row'))
        const fetchRow = rows.find(r => r.querySelector('.dmi-name').textContent === 'fetch')
        return fetchRow ? fetchRow.querySelector('.dmi-danger') !== null : false
      })(),
    })
  })()`, true))
  if (!listProbe.visible) fails.push('分区不可见')
  if (!listProbe.nativeHidden) fails.push('原生分区未隐藏')
  if (listProbe.rows !== 3) fails.push(`rows=${listProbe.rows} 应为 3`)
  if (listProbe.navLabel !== 'MCP 服务器') fails.push(`导航标签=${listProbe.navLabel}`)
  if (listProbe.offRow !== 1) fails.push(`停用行=${listProbe.offRow} 应为 1`)
  if (listProbe.badges.join(',') !== 'stdio,stdio,http') fails.push(`徽章=${listProbe.badges}`)
  if (!listProbe.descs[0].includes('--flag')) fails.push(`stdio 描述=${listProbe.descs[0]}`)
  if (listProbe.builtinBadges !== 1) fails.push(`内置徽标=${listProbe.builtinBadges} 应为 1`)
  if (listProbe.builtinRowHasDelete) fails.push('内置行不应有删除按钮')

  // 新增表单：填名 → 保存 → 载荷 + 防重复态
  await win.webContents.executeJavaScript(`document.querySelector('#__dsh_desktop_mcp_section .dmi-head .dmi-save').click()`, true)
  await new Promise((r) => setTimeout(r, 150))
  await win.webContents.executeJavaScript(`(() => {
    const f = document.querySelector('.dmi-form')
    f.querySelector('input[type="text"]').value = 'e2e'
  })()`, true)
  const saveProbe = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    document.querySelector('.dmi-form .dmi-save').click()
    const b = document.querySelector('.dmi-form .dmi-save')
    return JSON.stringify({ disabled: b.disabled, text: b.textContent })
  })()`, true))
  await new Promise((r) => setTimeout(r, 200))
  const saveOp = ops.find((o) => o.op === 'save')
  if (saveOp === undefined) fails.push('save 载荷未发出')
  else {
    if (saveOp.entry.serverName !== 'e2e') fails.push(`载荷 serverName=${saveOp.entry.serverName}`)
    if (saveOp.entry.transport !== 'stdio') fails.push(`载荷 transport=${saveOp.entry.transport}`)
    if (saveOp.entry.id !== '') fails.push(`新增载荷 id 应为空`)
  }
  if (!saveProbe.disabled || saveProbe.text !== '保存中…') fails.push(`保存按钮防重复态失效=${JSON.stringify(saveProbe)}`)

  // 失败应答：表单保留 + 错误回填 + 按钮恢复
  await win.webContents.executeJavaScript(`window.__dshMcpSaved({ ok: false, error: '名称 e2e 已存在' })`, true)
  await new Promise((r) => setTimeout(r, 150))
  const errProbe = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const f = document.querySelector('.dmi-form')
    const err = f.querySelector('.dmi-err')
    const b = f.querySelector('.dmi-save')
    return JSON.stringify({ formOpen: f !== null, errShown: !err.hidden, errText: err.textContent, btnEnabled: !b.disabled, btnText: b.textContent })
  })()`, true))
  if (!errProbe.formOpen || !errProbe.errShown || !errProbe.errText.includes('e2e') || !errProbe.btnEnabled) {
    fails.push(`失败应答处理=${JSON.stringify(errProbe)}`)
  }

  // 成功应答 + 列表刷新：表单关闭 + 新行出现
  await win.webContents.executeJavaScript(`window.__dshMcpSaved({ ok: true, error: null })`, true)
  await win.webContents.executeJavaScript(`window.__dshMcpSync(${JSON.stringify([...servers, { id: 'mcp-e2e', serverName: 'e2e', transport: 'stdio', enabled: true, command: 'node', args: [], env: {}, cwd: '', url: '', headers: {}, toolCallTimeoutMs: null }])}, ${JSON.stringify(builtinNames)})`, true)
  await new Promise((r) => setTimeout(r, 150))
  const okProbe = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const sec = document.getElementById('__dsh_desktop_mcp_section')
    return JSON.stringify({ formGone: sec.querySelector('.dmi-form') === null, rows: sec.querySelectorAll('.dmi-row').length, status: (sec.querySelector('.dmi-status') || {}).textContent || '' })
  })()`, true))
  if (!okProbe.formGone) fails.push('成功后表单未关闭')
  if (okProbe.rows !== 4) fails.push(`刷新后 rows=${okProbe.rows} 应为 4`)

  // 启停开关：翻 web 行 → 载荷 enabled 翻转
  await win.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll('.dmi-row'))
    rows.find(r => r.querySelector('.dmi-name').textContent === 'web').querySelector('.dmi-toggle').click()
  })()`, true)
  await new Promise((r) => setTimeout(r, 200))
  const toggleOp = [...ops].reverse().find((o) => o.op === 'save')
  if (toggleOp === undefined || toggleOp.entry.serverName !== 'web' || toggleOp.entry.enabled !== true) {
    fails.push(`启停载荷=${JSON.stringify(toggleOp)}`)
  }

  // 删除按钮 → 载荷
  await win.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll('.dmi-row'))
    rows.find(r => r.querySelector('.dmi-name').textContent === 'verify').querySelector('.dmi-danger').click()
  })()`, true)
  await new Promise((r) => setTimeout(r, 200))
  const delOp = [...ops].reverse().find((o) => o.op === 'delete')
  if (delOp === undefined || delOp.id !== 'mcp-verify') fails.push(`删除载荷=${JSON.stringify(delOp)}`)

  // radio 切换：http 选中后字段组互换
  const radioProbe = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    document.querySelector('#__dsh_desktop_mcp_section .dmi-head .dmi-save').click()
    const form = document.querySelector('.dmi-form')
    const groups = form.querySelectorAll('.dmi-fgroup')
    const httpRadio = form.querySelector('input[value="streamable-http"]')
    httpRadio.click()
    return JSON.stringify({ stdioHiddenBefore: groups[0].hidden })
  })()`, true))
  await new Promise((r) => setTimeout(r, 100))
  const radioProbe2 = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const groups = document.querySelectorAll('.dmi-form .dmi-fgroup')
    return JSON.stringify({ stdioHidden: groups[0].hidden, httpHidden: groups[1].hidden })
  })()`, true))
  if (radioProbe2.stdioHidden !== true || radioProbe2.httpHidden !== false) {
    fails.push(`radio 切换=${JSON.stringify(radioProbe2)}`)
  }

  console.log(`[${label}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '))
  const img = await win.webContents.capturePage()
  const slug = label === 'dark' ? 'dark' : 'light'
  writeFileSync(`out/mcp-section-${slug}.png`, img.toPNG())
  return fails.length === 0
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1040, height: 700, show: false })
  const light = await runScenario(win, 'light', '')
  const dark = await runScenario(win, 'dark', DARK_VARS)
  console.log(light && dark ? 'ALL PASS' : 'SMOKE FAILED')
  app.quit()
})
