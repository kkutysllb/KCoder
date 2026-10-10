/**
 * 存量会话预设迁移的宿主面（D4，2026-10-10）：扫描 → 用户决定 → 改写。
 *
 * 两个入口：
 * - **启动路径** {@link runStartupSessionMigration}：引擎启动**前**执行——
 *   引擎运行中会话可能在屏，改写竞态不可接受。候选为 0 时静默跳过（全新
 *   安装/已迁移完的机器零开销，仅一次首帧扫描）；有候选时弹独立小窗，由
 *   用户逐条勾选决定，选「暂不处理」则会话保持原样（下次启动再问）。
 *   任何异常都不阻断引擎启动（fail-open：迁移失败 ⇒ 会话保持原样，可重试）。
 * - **菜单路径** {@link promptMigrationFromMenu}：引擎恒在运行（启动即拉起），
 *   故只做「扫描 + 报数 + 重启引导」——重启后由启动路径接管。
 *
 * 页面 ⇄ 主进程通道：页面是临时 HTML 文件（file://，同 remote-progress-page
 * 的教训——data: URL 被部分环境视为不可信来源渲染空白），无 preload、不开
 * nodeIntegration；用户决定经 `console.log('__KCODER_MIGRATION__…')` 回传
 * （console-message 事件在 file:// 下可用），主进程进度经 executeJavaScript
 * 注入。Electron 32+ 的 console-message 签名从多参改为单事件对象，这里对
 * 两种形态都做防御性提取。
 *
 * @module desktop/main/session-migration-window
 */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog } from 'electron'
import {
  migrateSessionFile,
  scanSessionCandidatesAsync,
  type SessionPresetCandidate,
} from '../shared/session-preset-migration.ts'

/** 页面 → 主进程的回传前缀（console.log 载荷）。 */
const CHANNEL_PREFIX = '__KCODER_MIGRATION__'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

interface MigrationChoice {
  action: 'migrate' | 'skip'
  files: string[]
}

/** 从 console-message 的两种事件签名里提取回传载荷（未命中 → null）。 */
function extractChoice(args: unknown[]): MigrationChoice | null {
  for (const arg of args) {
    const text = typeof arg === 'string'
      ? arg
      : arg !== null && typeof arg === 'object' && typeof (arg as { message?: unknown }).message === 'string'
        ? (arg as { message: string }).message
        : null
    if (text === null || !text.includes(CHANNEL_PREFIX)) continue
    try {
      const parsed = JSON.parse(text.slice(text.indexOf(CHANNEL_PREFIX) + CHANNEL_PREFIX.length)) as MigrationChoice
      if ((parsed.action === 'migrate' || parsed.action === 'skip') && Array.isArray(parsed.files)) {
        return parsed
      }
    } catch {
      return null
    }
  }
  return null
}

/** 迁移列表窗口（勾选 → 回传；关窗 = 暂不处理）。 */
let activeMigrationWindow: BrowserWindow | null = null

function promptWindow(candidates: SessionPresetCandidate[]): Promise<MigrationChoice | null> {
  const rows = candidates.map((c, i) => {
    const date = new Date(c.createdAt)
    const when = Number.isFinite(date.getTime())
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      : '未知日期'
    return `    <label class="row"><input type="checkbox" data-file="${escapeHtml(c.file)}" checked>
      <span class="ws" title="${escapeHtml(c.workspaceDisplay)}">${escapeHtml(c.workspaceDisplay)}</span>
      <span class="meta">${when} · ${escapeHtml(c.oldPreset)} · ${escapeHtml(c.sessionId.slice(0, 8))}</span></label>`
  }).join('\n')

  const html = `<!doctype html><meta charset="utf-8"><title>KCoder · 会话模式迁移</title>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body { margin:0; background:#17181a; color:#e8e8ea; font:14px/1.6 -apple-system,"PingFang SC",sans-serif;
         display:flex; flex-direction:column; height:100vh }
  header { padding:18px 22px 10px }
  h1 { font-size:16px; font-weight:600; margin:0 0 6px }
  p { margin:0; color:#9aa0a6; font-size:12.5px }
  #list { flex:1; overflow:auto; margin:12px 22px; border:1px solid #303236; border-radius:8px; background:#1f2124 }
  .row { display:flex; align-items:center; gap:10px; padding:9px 14px; border-bottom:1px solid #26282b; cursor:pointer }
  .row:last-child { border-bottom:none }
  .row:hover { background:#24262a }
  .row input { accent-color:#4c8dff; flex:none }
  .ws { font-family:ui-monospace,Menlo,monospace; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .meta { margin-left:auto; flex:none; color:#8b9097; font-size:12px }
  footer { display:flex; gap:12px; justify-content:flex-end; padding:12px 22px 18px; align-items:center }
  #count { color:#9aa0a6; font-size:12.5px; margin-right:auto }
  button { font:inherit; padding:7px 18px; border-radius:7px; border:1px solid #303236; background:#24262a; color:#e8e8ea; cursor:pointer }
  button.primary { background:#2563eb; border-color:#2563eb; color:#fff }
  button:disabled { opacity:.45; cursor:default }
  #log { display:none; margin:12px 22px; padding:10px 12px; background:#1f2124; border:1px solid #303236; border-radius:8px;
         font:12px/1.7 ui-monospace,Menlo,monospace; color:#b6bcc4; white-space:pre-wrap; max-height:34vh; overflow:auto }
</style>
<header>
  <h1>会话模式迁移</h1>
  <p>检测到 ${candidates.length} 个使用旧模式的会话。产品现在只有一种工作模式（后台自动运行，不再显示模式选择）。迁移后这些会话可正常继续；不迁移则会话保留在列表中但无法继续对话。原始文件会自动备份（.bak-preset）。</p>
</header>
<div id="list">
${rows}
</div>
<pre id="log"></pre>
<footer>
  <span id="count"></span>
  <button id="skip">暂不处理</button>
  <button id="go" class="primary">迁移所选会话</button>
</footer>
<script>
  const boxes = [...document.querySelectorAll('input[type=checkbox]')]
  const go = document.getElementById('go')
  const count = document.getElementById('count')
  const sync = () => {
    const n = boxes.filter(b => b.checked).length
    go.disabled = n === 0
    count.textContent = '已选 ' + n + ' / ' + boxes.length + ' 个会话'
  }
  boxes.forEach(b => b.addEventListener('change', sync))
  sync()
  const send = (payload) => console.log('${CHANNEL_PREFIX}' + JSON.stringify(payload))
  document.getElementById('skip').addEventListener('click', () => send({ action: 'skip', files: [] }))
  go.addEventListener('click', () => {
    send({ action: 'migrate', files: boxes.filter(b => b.checked).map(b => b.dataset.file) })
  })
  window.__migLog = (line) => {
    const el = document.getElementById('log')
    el.style.display = 'block'
    el.textContent += (el.textContent ? '\\n' : '') + line
    el.scrollTop = el.scrollHeight
  }
  window.__migDone = () => {
    go.disabled = true
    document.getElementById('skip').textContent = '关闭'
  }
</script>`

  const file = join(tmpdir(), `kcoder-migration-${String(Date.now())}.html`)
  writeFileSync(file, html)

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 680,
      height: 600,
      show: false,
      title: 'KCoder · 会话模式迁移',
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    let settled = false
    activeMigrationWindow = win
    const settle = (choice: MigrationChoice | null): void => {
      if (settled) return
      settled = true
      if (activeMigrationWindow === win) activeMigrationWindow = null
      resolve(choice)
    }
    win.once('ready-to-show', () => win.show())
    // 关窗（X / 暂不处理之后）= 暂不处理；回传已发生时 settle 已占用
    win.on('closed', () => settle(null))
    win.webContents.on('console-message', (...args: unknown[]) => {
      const choice = extractChoice(args)
      if (choice !== null) settle(choice)
    })
    void win.loadURL(pathToFileURL(file).href)
  })
}

/**
 * 启动路径：扫描 → 用户决定 → 改写。**必须在引擎启动前调用**。
 * @param sessionsRoot 会话根目录（`$DSH_HOME/sessions`）——由调用方传入，
 *   本模块不反向依赖 dsh-contract（真 GUI 冒烟要传临时目录）。
 */
export async function runStartupSessionMigration(
  sessionsRoot: string,
  log: (message: string) => void,
): Promise<'none' | 'migrated' | 'skipped'> {
  const onError = (file: string, error: unknown): void => {
    log(`[preset-migration] 扫描跳过不可读会话 ${file}: ${String(error)}`)
  }
  const candidates = await scanSessionCandidatesAsync(sessionsRoot, onError)
  if (candidates.length === 0) {
    log('[preset-migration] 无待迁移会话')
    return 'none'
  }
  log(`[preset-migration] 发现 ${String(candidates.length)} 个待迁移会话，等待用户决定 …`)
  const choice = await promptWindow(candidates)
  if (choice === null || choice.action === 'skip') {
    log('[preset-migration] 用户选择暂不处理（下次启动再问）')
    return 'skipped'
  }
  let ok = 0
  let fail = 0
  for (const file of choice.files) {
    try {
      const r = migrateSessionFile(file)
      ok += 1
      log(`[preset-migration] 已迁移 ${file}（改写 ${String(r.renamed)} 条 / ${String(r.frames)} 帧）`)
      await pushLog(`✓ ${file.split('/').slice(-2).join('/')}（改写 ${String(r.renamed)} 条记录）`)
    } catch (error) {
      fail += 1
      log(`[preset-migration] 迁移失败 ${file}: ${String(error)}（备份保留在 .bak-preset）`)
      await pushLog(`✗ ${file.split('/').slice(-2).join('/')}: ${String(error)}`)
    }
  }
  log(`[preset-migration] 迁移完成：成功 ${String(ok)}，失败 ${String(fail)}`)
  await pushLog(`完成：成功 ${String(ok)}，失败 ${String(fail)}。关闭窗口后继续启动。`)
  await pushDone()
  return 'migrated'
}

/** 迁移进度注入（窗口可能已被用户关掉：失败不影响迁移本身）。 */
async function pushLog(line: string): Promise<void> {
  const win = activeMigrationWindow
  if (win === null || win.isDestroyed()) return
  try {
    await win.webContents.executeJavaScript(`window.__migLog(${JSON.stringify(line)})`, true)
  } catch { /* 窗口已关：进度丢弃 */ }
}

async function pushDone(): Promise<void> {
  const win = activeMigrationWindow
  if (win === null || win.isDestroyed()) return
  try {
    await win.webContents.executeJavaScript('window.__migDone()', true)
  } catch { /* 窗口已关 */ }
}

/**
 * 菜单路径：引擎恒在运行（启动即拉起），改写必须在引擎启动前进行——
 * 扫描报数后引导重启，重启后的启动路径接管真正的迁移。
 */
export async function promptMigrationFromMenu(sessionsRoot: string): Promise<void> {
  const onError = (): void => { /* 菜单路径的扫描错误不打扰用户，数量如实即可 */ }
  const candidates = await scanSessionCandidatesAsync(sessionsRoot, onError)
  if (candidates.length === 0) {
    await dialog.showMessageBox({
      type: 'info',
      title: '会话模式迁移',
      message: '没有需要迁移的会话。',
      detail: '所有会话都已在当前模式下，或已迁移完成。',
      buttons: ['好'],
    })
    return
  }
  const wsCount = new Set(candidates.map((c) => c.workspaceDir)).size
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: '会话模式迁移',
    message: `发现 ${String(candidates.length)} 个使用旧模式的会话（跨 ${String(wsCount)} 个工作区）。`,
    detail: '迁移需要在引擎启动前进行。点击「重启并迁移」将退出应用，重新打开后会出现迁移窗口，由你逐条决定；也可以随时取消。',
    buttons: ['重启并迁移', '取消'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) {
    app.relaunch()
    app.exit(0)
  }
}
