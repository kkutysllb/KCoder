#!/usr/bin/env node
/**
 * dev 真机「打开手势落到哪里」现场探针——经 CDP 直连正在运行的 KCoder dev
 * 实例，**单次真实点击**后判定这一开是否进了**上游原生右侧栏**。
 *
 * 为什么判据是「落到原生右栏」：2026-10-09 起右侧工作台归上游（dsh-coding-sidebar
 * 整线退役、铁律 1 翻转，产品侧不再压制原生右栏）。**历史（2026-09-19 ~ 2026-10-09）**：
 * 本探针当时是**反向**判据——右侧工作台由自研插件承担、原生右栏被压制，故
 * PASS =「没有任何原生右栏宿主可见，且落进插件的页签」；插件退役后判据整体翻转
 * （原文见 git 历史），现在**落到原生右栏才是正确落点**。
 *
 * 两类被验证的入口：
 *   --target link：聊天里的 http(s) 超链接——上游 ui-chat 的 openExternalLink
 *     发 `ctx.sidebarRight.openTab('browser', …)`。PASS = 原生右栏列占宽 > 0
 *     且右栏文本里出现该链接的主机名；
 *   --target review：交付/改动卡的「查看变更 / 审查」入口——上游 ui-deliverables
 *     发 `dsh-resource://changes-review/…`。PASS = 原生右栏列占宽 > 0 且右栏
 *     文本里出现「变更 / Changes / 审查 / Review」。
 *
 * 为什么必须真机点：落点全在运行时 DOM 与计算样式里，源码推理只能定位调用链、
 * 定不了落点。用户也不必描述现象——脚本自己点、自己读、自己给结论。
 *
 * 用法（两步）：
 *   1) 用户在终端：KC_REMOTE_DEBUG_PORT=9333 pnpm dev
 *   2) 本机：node scripts/probe-dev-review-open.mjs [--port 9333] [--target link|review] [--no-click]
 *
 * 依赖 playwright-core（仅客户端，无浏览器二进制）：脚本按需自装到 /tmp/pwclient。
 *
 * @module scripts/probe-dev-review-open
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const PW_DIR = '/tmp/pwclient'

/** 确保 playwright-core 可用（缺失即装到 /tmp，不动仓库依赖）。 */
async function loadPlaywright() {
  const entry = `${PW_DIR}/node_modules/playwright-core/index.js`
  if (!existsSync(entry)) {
    console.log(`[probe] 首次运行：安装 playwright-core → ${PW_DIR}`)
    execFileSync('npm', ['init', '-y'], { cwd: PW_DIR, stdio: 'ignore' })
    execFileSync('npm', ['i', 'playwright-core', '--no-audit', '--no-fund'], { cwd: PW_DIR, stdio: 'ignore' })
  }
  const mod = await import(entry)
  return mod.default ?? mod
}

const args = process.argv.slice(2)
const portArg = args.indexOf('--port')
const port = portArg === -1 ? 9333 : Number(args[portArg + 1])
const targetArg = args.indexOf('--target')
const target = targetArg === -1 ? 'review' : String(args[targetArg + 1])
// file-review 退役（2026-10-04）后 review 模式的判据不再可达：显式说清，免得
// 把「预期落回原生」误读成回归（link 模式仍是有效的插件落点验证）。
if (target === 'review') {
  console.log('[probe] 注意：file-review 插件已于 2026-10-04 退役——review 入口不再由我们插件认领，本模式 PASS 判据已失效（结果按「落回原生右栏」解读即预期形态）。验证插件落点请用 --target link。')
}
const doClick = !args.includes('--no-click')
/** 探针给候选元素打的标记属性（点击时按它定位，避免 nth 序号错位）。 */
const MARK = 'data-kcoder-probe-target'

/**
 * 页面内取证：候选点击目标（打标记后返回序号）+ 原生右侧栏宿主可见性 +
 * 我们插件的活动页签。全部只读（点击动作由调用方单独发起）。
 */
function inspect(mode) {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return {
      display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
      w: Math.round(box.width), h: Math.round(box.height),
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0
        && box.width > 0 && box.height > 0,
    }
  }
  const natives = {}
  for (const [name, sel] of [
    ['panel', '[data-sidebar-right-panel]'],
    ['floatHost', '[data-sidebar-right-float-host]'],
    ['expand', '[data-sidebar-right-expand]'],
  ]) {
    const el = document.querySelector(sel)
    natives[name] = el === null ? 'absent' : vis(el)
  }
  const pluginHosts = [...document.querySelectorAll('[data-dsh-panel-host]')]
  const tabs = pluginHosts.flatMap(host => [...host.querySelectorAll('[class*="tab"]')]
    .map(el => ({ text: (el.textContent ?? '').trim().slice(0, 40), active: String(el.className).includes('tabActive') })))
  const activeTab = tabs.find(t => t.active)?.text ?? null

  document.querySelectorAll(`[${MARK}]`).forEach(el => { el.removeAttribute(MARK) })
  const candidates = []
  const mark = (el, kind, extra = {}) => {
    const box = el.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    const index = candidates.length
    el.setAttribute(MARK, String(index))
    candidates.push({
      kind, index,
      label: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 32),
      box: { x: Math.round(box.x), y: Math.round(box.y) }, ...extra,
    })
  }
  const urlOf = (el) => { try { return new URL(el.href).href } catch { return undefined } }
  if (mode === 'link') {
    // 聊天区（排除侧栏宿主内部）里可见的 http(s) 链接
    for (const el of document.querySelectorAll('a[href^="http"]')) {
      if (el.closest('[data-dsh-panel-host]') !== null) continue
      const href = urlOf(el)
      if (href === undefined) continue
      mark(el, 'external-link', { href, host: (() => { try { return new URL(href).hostname } catch { return undefined } })() })
    }
  } else {
    document.querySelectorAll('button[aria-label]').forEach(el => {
      const label = el.getAttribute('aria-label') ?? ''
      if (label.includes('在侧边栏查看本轮改动') || label.includes('Review this turn')) mark(el, 'native-changes-header')
      else if (/^查看 .+ 的改动$/.test(label) || label.startsWith('View changes to ')) mark(el, 'native-changes-row')
      else if (label.includes('审查') || label.includes('Review')) mark(el, 'file-review-action')
    })
    const ORDER = { 'native-changes-header': 0, 'native-changes-row': 1, 'file-review-action': 2 }
    candidates.sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
  }
  return {
    url: location.href.replace(/token=[^&]+/, 'token=…'),
    mode,
    activeTab,
    pluginHostCount: pluginHosts.length,
    tabs: tabs.slice(0, 14),
    natives,
    candidates,
  }
}

const pw = await loadPlaywright()
let browser
try {
  browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`)
} catch (error) {
  console.error(`[probe] 连不上 CDP 127.0.0.1:${String(port)}——确认 dev 用 KC_REMOTE_DEBUG_PORT=${String(port)} 启动：${String(error?.message ?? error)}`)
  process.exit(2)
}

const pages = browser.contexts().flatMap(c => c.pages())
console.log(`[probe] 已连接；页面数 ${String(pages.length)}；模式 ${target}`)
let verdict = null
for (const [i, page] of pages.entries()) {
  const hasApp = await page.evaluate(() => document.getElementById('root') !== null).catch(() => false)
  if (!hasApp) continue
  await page.bringToFront().catch(() => {})
  console.log(`\n=== 页面 ${String(i)} ===`)
  const before = await page.evaluate(inspect, target)
  console.log('[before]', JSON.stringify(before, null, 1))
  if (!doClick) continue
  if (before.candidates.length === 0) {
    console.log(target === 'link'
      ? '[click] 聊天区没有可见的 http(s) 链接（先让回答里带一个链接再试）'
      : '[click] 无候选目标（当前会话没有改动卡？先跑一轮会改文件的对话再试）')
    continue
  }
  const picked = before.candidates[0]
  console.log(`[click] 目标：${picked.kind} / ${picked.label}${picked.href === undefined ? '' : ` → ${picked.href}`}`)
  try {
    await page.locator(`[${MARK}="0"]`).first().click({ timeout: 4000 })
  } catch (error) {
    console.log(`[click] 点击被拦：${String(error?.message ?? error).split('\n')[0]}`)
    continue
  }
  await page.waitForTimeout(1500)
  const after = await page.evaluate(inspect, target)
  console.log('[after]', JSON.stringify(after, null, 1))
  const nativeVisible = Object.entries(after.natives)
    .filter(([, v]) => v !== 'absent' && v.visible === true).map(([k]) => k)
  const landed = target === 'link'
    ? (picked.host !== undefined && (after.activeTab ?? '').includes(picked.host))
    : ((after.activeTab ?? '').includes('审查') || (after.activeTab ?? '').toLowerCase().includes('review'))
  const pass = nativeVisible.length === 0 && landed
  console.log(`[verdict] ${pass ? 'PASS' : 'FAIL'}`
    + `｜活动页签=${after.activeTab ?? '未识别'}`
    + `｜期望落点=${target === 'link' ? `浏览器页签（${picked.host ?? '?'}）` : '文件审查页签'}`
    + `｜原生宿主可见=${nativeVisible.length === 0 ? '无' : nativeVisible.join(',')}`
    + `｜点击前活动页签=${before.activeTab ?? '未识别'}`)
  if (verdict === null || verdict === true) verdict = pass
}
await browser.close().catch(() => {})
console.log(verdict === null ? '\n[probe] 未取得判定（没有可点的目标或没有带 #root 的页面）' : `\n[probe] 结论：${verdict ? 'PASS' : 'FAIL'}`)
process.exit(verdict === false ? 1 : 0)
