#!/usr/bin/env node
/**
 * dev 真机「设置页点不动」现场探针——经 CDP 直连正在运行的 KCoder dev 实例。
 *
 * 为什么走 CDP 而不是让用户往 DevTools Console 贴代码：Chrome 对 Console
 * 粘贴有防自毁门（"Type allow pasting"），让用户为一次诊断去开那个门并不
 * 合适；本脚本从外部只读/单次点击地驱动页面，用户零操作。
 *
 * 用法（两步）：
 *   1) 用户在终端：KC_REMOTE_DEBUG_PORT=9333 pnpm dev   （仓库既有诊断开关，
 *      见 desktop/main/index.ts:34，默认不生效、不影响打包）
 *   2) 本机：node scripts/probe-dev-settings.mjs [--port 9333] [--click]
 *
 * 输出：目标页 URL、卡片/按钮计数、首卡命中栈（拦截者即栈顶）、祖先链上的
 * inert/pointer-events/visibility 异常、全屏浮层清单、#root.inert 与各
 * aria-modal 宿主相对 #root 的 body 次序。--click 会再对首卡做一次真实
 * 点击并报告是否打开了详情页（区分"点不到"与"点了没反应"）。
 *
 * 依赖 playwright-core（仅客户端，无浏览器二进制）：脚本按需自装到
 * /tmp/pwclient，避免污染仓库依赖。
 *
 * @module scripts/probe-dev-settings
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
const doClick = args.includes('--click')

/** 页面内的只读取证（与 scripts/probe-settings-unclickable.mjs 同源判据）。 */
function probe() {
  const report = {}
  const cards = [...document.querySelectorAll('[data-plugin-item]')]
  const btns = [...document.querySelectorAll('[data-plugin-item] button[class*="cardOpen"]')]
  report['卡片数'] = cards.length
  report['可点按钮数'] = btns.length
  report['当前 tab'] = [...document.querySelectorAll('[role="tablist"] button')].map(b => b.textContent.trim())
  if (btns.length === 0) return report
  const b = btns[0].getBoundingClientRect()
  report['视口'] = { w: innerWidth, h: innerHeight }
  report['首卡按钮矩形'] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  report['元素栈(顶→底)'] = document.elementsFromPoint(cx, cy).slice(0, 6)
    .map(e => `${e.tagName}#${e.id || ''}.${String(e.className || '').slice(0, 44)}`)
  const chain = []
  for (let el = btns[0]; el && el !== document.documentElement; el = el.parentElement) {
    const cs = getComputedStyle(el)
    if (el.inert === true || el.hasAttribute('inert') || cs.pointerEvents !== 'auto'
      || cs.visibility !== 'visible' || cs.display === 'none' || cs.opacity === '0') {
      chain.push({
        tag: el.tagName, cls: String(el.className || '').slice(0, 44),
        inert: el.inert === true, pe: cs.pointerEvents, vis: cs.visibility,
        disp: cs.display, opacity: cs.opacity,
      })
    }
  }
  report['可疑祖先'] = chain.length > 0 ? chain : '无（链路干净）'
  report['body 子级'] = [...document.body.children]
    .map((c, i) => `${i}:${c.tagName}#${c.id || ''}.${String(c.className || '').slice(0, 32)}`)
  const covers = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue
    const bb = el.getBoundingClientRect()
    if (bb.width < innerWidth * 0.8 || bb.height < innerHeight * 0.8) continue
    covers.push({
      tag: el.tagName, cls: String(el.className || '').slice(0, 44), z: cs.zIndex,
      pe: cs.pointerEvents, vis: cs.visibility, disp: cs.display,
      opacity: cs.opacity, ariaHidden: el.getAttribute('aria-hidden'),
    })
  }
  report['全屏浮层'] = covers
  const root = document.getElementById('root')
  report['#root.inert'] = root ? root.inert : null
  report['aria-modal 宿主次序'] = [...document.querySelectorAll('[aria-modal="true"]')].map(m => ({
    label: m.getAttribute('aria-label'),
    hostIdx: m.parentElement ? [...document.body.children].indexOf(m.parentElement) : -1,
    rootIdx: root ? [...document.body.children].indexOf(root) : -1,
  }))
  return report
}

const pw = await loadPlaywright()
let browser
try {
  browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`)
} catch (error) {
  console.error(`[probe] 连不上 CDP 127.0.0.1:${String(port)}——确认 dev 是用 KC_REMOTE_DEBUG_PORT=${String(port)} 启动的：${String(error?.message ?? error)}`)
  process.exit(2)
}

const contexts = browser.contexts()
const pages = contexts.flatMap(c => c.pages())
console.log(`[probe] 已连接；页面数 ${String(pages.length)}`)
for (const [i, page] of pages.entries()) {
  const url = page.url()
  console.log(`\n=== 页面 ${String(i)}：${url} ===`)
  // 只对有 dsh 应用根/设置入口的页面取证
  const hasApp = await page.evaluate(() => document.getElementById('root') != null).catch(() => false)
  if (!hasApp) {
    console.log('（无 #root，跳过）')
    continue
  }
  const report = await page.evaluate(probe).catch(error => ({ 取证失败: String(error?.message ?? error) }))
  console.log(JSON.stringify(report, null, 1))
  if (doClick) {
    const target = page.locator('[data-plugin-item] button[class*="cardOpen"]').first()
    if (await target.count() === 0) {
      console.log('[click] 无卡片可点')
      continue
    }
    try {
      await target.click({ timeout: 4000 })
      const opened = await page.evaluate(() => {
        const d = document.querySelector('[data-plugin-item-detail]')
        return d ? d.getAttribute('data-plugin-item-detail') : null
      })
      console.log(`[click] 点击成功；详情页 = ${opened ?? '未打开'}`)
    } catch (error) {
      console.log(`[click] 点击被拦：${String(error?.message ?? error).split('\n')[0]}`)
    }
  }
}
await browser.close()
console.log('\n[probe] 完成')
