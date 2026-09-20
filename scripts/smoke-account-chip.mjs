/**
 * 账号行（account-chip 注入器）DOM 冒烟：手搓上游侧边栏 foot 区
 * （SidebarRoot.module.css + settings-general 的 SettingsRoot.module.css，
 * 类名取上游编译产物形态 sPz-Sq_* / oQd2WG_*，让 `[class*="..."]` 锚点
 * 与真实 DOM 同构）→ 注入 account-chip 的 chipJs → 断言：
 *
 * - 展开态：账号行是 settingsArea 首个子元素、整行可点、点击弹菜单
 *   （设置 / 语言 / 主题 / 退出登录 四组），菜单里「设置」仍转发到被
 *   隐藏的上游 trigger（上游面板打开路径照旧）；
 * - 收起态（rail）：kcoder-folded 生效（36×36 圆钮、用户名隐藏）、
 *   **头像圆心处 elementFromPoint 必须命中头像自己**、真实输入点击
 *   弹菜单；
 * - 双态都断言：上游设置触发行外壳（triggerRow.railRow）**不吃点击**
 *   —— 这是 2026-09-20 用户报障的根因面（外观正常、点击无反应），
 *   修复手段是折叠态定位规则上的 z-index:2；
 * - 上游 trigger 按钮仍被 display:none 隐藏（设置入口只留账号菜单）。
 *
 * 为什么必须有一条这样的冒烟：注入器静态检查（check-injected-scripts）
 * 只查悬空引用与语法，看不见「绘制顺序 / 命中顺序」——上游把设置触发
 * 行外壳做成 position:relative（定位元素、DOM 排在我们之后）后，它作为
 * 空的 36×36 死区压在头像圈上，视觉毫无变化，只有点击会失效。
 *
 * 运行：pnpm exec electron scripts/smoke-account-chip.mjs
 * （若当前环境带 ELECTRON_RUN_AS_NODE=1，Electron 会退化成 Node 跑，
 *   `import { BrowserWindow } from 'electron'` 直接报无此导出——用
 *   `env -u ELECTRON_RUN_AS_NODE pnpm exec electron ...` 前缀。）
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const BT = String.fromCharCode(96)

// ── 从源码提取 chipJs 模板，按主进程挂载侧的求值方式替换插值 ─────────
const src = readFileSync(join(ROOT, 'desktop/main/account-chip.ts'), 'utf8')
const decl = 'const chipJs = (username: string, build: string): string => ' + BT
const from = src.indexOf(decl) + decl.length
const endTick = src.indexOf('\n})()`', from)
if (from < decl.length || endTick < 0) throw new Error('无法提取 chipJs')
const chipJs = src.slice(from, endTick + 5)
  .replace('${JSON.stringify(build)}', JSON.stringify('smoke'))
  .replace('${JSON.stringify(username)}', JSON.stringify('Kcoder'))
  .replace('${JSON.stringify(AUTH_LOGOUT_URL)}', JSON.stringify('kcoder://auth-logout'))
  .replace('${JSON.stringify(CHIP_ID)}', JSON.stringify('__kcoder_account_chip'))
  .replace('${JSON.stringify(MENU_ID)}', JSON.stringify('__kcoder_account_menu'))
if (chipJs.includes('${')) throw new Error('chipJs 仍有未替换的插值')

// ── fixture：上游结构与关键规则（逐条对齐上游 CSS，注明出处）────────
// SidebarRoot.module.css：.footArea / .settingsArea 及其 .collapsed 变体；
// SettingsRoot.module.css：.triggerRow（position:relative 是本次故障关键）
// / .triggerRow.railRow（36 宽 + 上下 8/10 margin = 54 高）/ .trigger.rail。
const html = (collapsed) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; font-family: -apple-system, system-ui, sans-serif; background: #f5f6f7; }
  /* ---- 上游 SidebarRoot.module.css（节选）---- */
  .sPz-Sq_root { display: flex; flex-direction: column; height: 100%; padding: 6px 12px; background: #f5f6f7; color: #1a1d21; font-size: 14px; }
  .sPz-Sq_root.sPz-Sq_collapsed { padding: 18px 10px 6px; }
  .side { width: ${collapsed ? 56 : 256}px; height: 100%; }
  .sPz-Sq_regionArea { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .sPz-Sq_footArea { flex: none; display: flex; flex-direction: column; }
  .sPz-Sq_settingsArea, .sPz-Sq_footerActions { flex: none; min-width: 0; width: 100%; }
  .sPz-Sq_collapsed .sPz-Sq_footArea { align-items: center; }
  .sPz-Sq_collapsed .sPz-Sq_settingsArea { display: flex; justify-content: center; width: auto; }
  /* ---- 上游 settings-general 的 SettingsRoot.module.css（节选）---- */
  .oQd2WG_triggerRow { position: relative; flex: none; display: flex; align-items: center; gap: 8px; width: calc(100% + 4px); margin: 4px -2px; }
  .oQd2WG_triggerRow.oQd2WG_railRow { width: 36px; margin: 8px 0 10px; }
  .oQd2WG_trigger { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 10px 0 8px; border: none; border-radius: 12px; background: transparent; cursor: pointer; color: #1a1d21; }
  .oQd2WG_trigger.oQd2WG_rail { flex: none; width: 36px; height: 36px; margin: 0; justify-content: center; gap: 0; padding: 0; }
</style></head><body>
<div class="side">
  <div class="sPz-Sq_root${collapsed ? ' sPz-Sq_collapsed' : ''}">
    <div class="sPz-Sq_regionArea"></div>
    <div class="sPz-Sq_footArea">
      <div class="sPz-Sq_footerActions"></div>
      <div class="sPz-Sq_settingsArea">
        <div style="display: contents">
          <div class="oQd2WG_triggerRow${collapsed ? ' oQd2WG_railRow' : ''}">
            <button type="button" class="oQd2WG_trigger${collapsed ? ' oQd2WG_rail' : ''}" aria-haspopup="dialog" aria-label="设置">
              <svg width="18" height="18" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
  window.__upstreamSettingsClicks = 0
  document.querySelector('.oQd2WG_trigger').addEventListener('click', () => { window.__upstreamSettingsClicks++ })
</script>
</body></html>`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function runScenario(win, label, collapsed) {
  const dir = mkdtempSync(join(tmpdir(), 'chip-smoke-'))
  writeFileSync(join(dir, 'index.html'), html(collapsed))
  await win.loadFile(join(dir, 'index.html'))
  await win.webContents.executeJavaScript(chipJs, true)
  await sleep(300)

  const geom = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const chip = document.getElementById('__kcoder_account_chip')
    if (chip === null) return JSON.stringify({ chip: false })
    const r = chip.getBoundingClientRect()
    const cx = Math.round(r.left + r.width / 2)
    const cy = Math.round(r.top + r.height / 2)
    const hit = document.elementFromPoint(cx, cy)
    const trigger = document.querySelector('.oQd2WG_trigger')
    const triggerRow = document.querySelector('.oQd2WG_triggerRow')
    const cs = getComputedStyle(chip)
    return JSON.stringify({
      chip: true,
      folded: chip.className.includes('kcoder-folded'),
      rect: { w: Math.round(r.width), h: Math.round(r.height) },
      center: [cx, cy],
      // 命中归属：本次故障的直接判据（修复前这里落到 triggerRow）
      hitId: hit === null ? null : (hit.id || hit.className || hit.tagName),
      hitIsChip: hit !== null && (hit === chip || chip.contains(hit)),
      hitIsTriggerRow: hit !== null && triggerRow !== null && (hit === triggerRow || triggerRow.contains(hit)),
      zIndex: cs.zIndex,
      nameVisible: (() => { const s = chip.querySelector('span + span'); return s !== null && getComputedStyle(s).display !== 'none' })(),
      avatar: (() => { const a = chip.querySelector('span'); const ar = a.getBoundingClientRect(); return [Math.round(ar.width), Math.round(ar.height)] })(),
      triggerHidden: trigger !== null && getComputedStyle(trigger).display === 'none',
    })
  })()`, true))

  const fails = []
  if (geom.chip !== true) {
    console.log(`[${label}] FAIL: 账号行未注入`)
    return false
  }
  // 真实输入点击（走浏览器命中测试路径，与用户点击同构）
  const [cx, cy] = geom.center
  win.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 })
  await sleep(300)
  const opened = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const m = document.getElementById('__kcoder_account_menu')
    const labels = m === null ? [] : [...m.querySelectorAll('button[role="menuitem"]')].map((b) => b.textContent.trim())
    // 关闭再验「菜单 → 上游设置」转发：点菜单里的「设置」项
    let forwarded = null
    if (m !== null) {
      const before = window.__upstreamSettingsClicks
      m.querySelector('button[role="menuitem"]').click()
      forwarded = { closed: document.getElementById('__kcoder_account_menu') === null, clicks: window.__upstreamSettingsClicks - before }
    }
    return JSON.stringify({ open: m !== null, labels, forwarded })
  })()`, true))

  if (collapsed) {
    if (!geom.folded) fails.push('收起态未加 kcoder-folded 类')
    if (geom.rect.w !== 36 || geom.rect.h !== 36) fails.push(`收起态头像钮尺寸 ${geom.rect.w}x${geom.rect.h} 应为 36x36`)
    if (geom.nameVisible) fails.push('收起态用户名仍可见（应隐藏）')
    if (geom.avatar[0] !== 28) fails.push(`收起态头像圈 ${geom.avatar[0]}px 应为 28px`)
  } else {
    if (geom.folded) fails.push('展开态不应带 kcoder-folded 类')
    if (!geom.nameVisible) fails.push('展开态用户名应可见')
  }
  // 根因面：命中归属必须是头像自己，不能是上游设置触发行外壳
  if (geom.hitIsTriggerRow) fails.push('头像圆心命中上游 triggerRow（死区吃点击）——折叠态 z-index 未生效')
  if (!geom.hitIsChip) fails.push(`头像圆心未命中头像（命中 ${String(geom.hitId)}）`)
  if (collapsed && geom.zIndex !== '2') fails.push(`收起态头像钮 z-index=${geom.zIndex} 应为 2`)
  if (!geom.triggerHidden) fails.push('上游设置 trigger 未被隐藏（设置入口应只留在账号菜单）')
  if (!opened.open) fails.push('点击头像未弹出菜单')
  if (opened.labels.length !== 4) fails.push(`菜单项 ${opened.labels.length} 项应为 4（设置/语言/主题/退出登录）：${opened.labels.join('/')}`)
  if (opened.forwarded === null || !opened.forwarded.closed) fails.push('点菜单「设置」后菜单未关闭')
  if (opened.forwarded !== null && opened.forwarded.clicks !== 1) fails.push('菜单「设置」未转发到上游 trigger')

  console.log(`[${label}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '))
  const img = await win.webContents.capturePage()
  writeFileSync(join(ROOT, 'out', `account-chip-${collapsed ? 'collapsed' : 'expanded'}.png`), img.toPNG())
  return fails.length === 0
}

// 不要在 Electron 主进程 ESM 顶层 await app.whenReady()（与 whenReady 互等
// 死锁，见 smoke-sidebar-toggle）；userData 指到临时目录，避免与正在运行的
// KCoder 应用争用 profile。
app.setPath('userData', mkdtempSync(join(tmpdir(), 'kcoder-chip-smoke-')))
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 720, show: false })
  const results = []
  results.push(await runScenario(win, 'expanded', false))
  results.push(await runScenario(win, 'collapsed', true))
  console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILED')
  app.exit(results.every(Boolean) ? 0 : 1)
})
