/**
 * 品牌注入器：shell 窗口（上游 Web UI）侧边栏 logo 与窗口标题品牌化。
 *
 * 定位依据（上游 SidebarRoot.tsx + ui-primitives + DocumentTitle.tsx）：
 * - 展开态：logoRow 内 `button.brand`（兼新会话快捷键）含 BrandWordmark
 *   SVG（鲸鱼 + "deepseek" 字形 + harness 徽章，全部矢量路径）；
 * - 收起态（rail）：iconButton.toggle 内 `<FishLogo className={railFish}>`
 *   → `svg[class*="railFish"]`，hover 时 CSS 换 panel 图标（类名继承）；
 * - 标题：index.html `<title>DeepSeek Harness</title>`；DocumentTitle
 *   组件在挂载时快照 original，投射 "会话标题 — DeepSeek Harness"。
 *
 * 替换策略（零侵入，仅 executeJavaScript）：
 * - 展开：SVG 藏起（display:none）+ 旁插组合 Logo 图（brand-combo-
 *   dark/light.png：K 图标 + "Coder" 字标已按 22px 等高、零间距渲染
 *   成单张 PNG，深色主题白字 / 浅色主题深字，主题切换自动换版）；
 *   不动上游节点本身——React 卸载 BrandWordmark 时仍能 removeChild
 *   原节点，不会抛 NotFoundError 崩树（replaceWith 方案已踩坑）；
 *   button 的新会话点击行为不受影响；
 * - rail：鲸鱼 SVG 同样藏起 + 旁插 logo img（复制 railFish 类名，
 *   hover 换图 CSS 继续生效）；
 * - 新会话空状态页（EmptyHero/HeroShell）：同把 34×25 鲸鱼换成 K
 *   logo；headline 换为产品 slogan（中文「所思，皆可成码」/英文
 *   "Think it, code it."，按当前文案是否含 CJK 自适应，语言切换
 *   自愈跟随）；预览徽章（“预览版”/"Preview"）为上游装饰，直接藏起。
 *   文本替换只改文本节点 .data——改 textContent 会移除 React 持有的
 *   文本节点，组件卸载时 removeChild 拖错崩树（同 replaceWith 坑）；
 *   observer 需加 characterData 监听自愈 React 重设文案；
 * - 回合运行态文案（ChatView 的 turnStatus，role=status）：
 *   “Deep diving…” → “KCoder…”。同款只改文本节点 nodeValue——
 *   上游微光动画（background-clip:text + shimmer）作用在容器与
 *   文本本体上，节点不动则动画/时钟 span/reduced-motion 全原样；
 *   类名子串匹配会同时命中 _turnStatusClock（含前缀），靠首文本
 *   节点精确等值护身，遍历全部匹配逐一判定。
 * - 标题：拦截 document.title setter 做字符串替换（快照早于注入的
 *   original 旧名也会在每次赋值时被改写），注入后立即替换当前值；
 *   注：UI 内有组件渲染 document.title（状态栏 span），源头替换即可。
 *   accessor 位置随 Chromium 版本在原型链上浮动，需逐层查（见内注）。
 *
 * React 重渲染可能重建节点 → MutationObserver 自愈；侧边栏异步挂载
 * → 短轮询等待（同 update-injector 模式）。
 *
 * @module desktop/main/brand-injector
 */

import { readFileSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { resolveAsset } from './dsh-contract'

/** 上游产品名 → 桌面品牌名（标题替换）。 */
const UPSTREAM_NAME = 'DeepSeek Harness'
const BRAND_NAME = 'KCoder'

/** hero slogan（按当前文案含 CJK 与否自适应，语言切换自愈跟随）。 */
const TAGLINE_ZH = '所思，皆可成码'
const TAGLINE_EN = 'Think it, code it.'

/** logo 元素 id（页面内唯一标记，兼幂等检测）。 */
const LOGO_ID = '__dsh_desktop_brand_logo'

/** 模块级缓存：64px 透明 K（~3.4KB），读一次嵌入注入脚本（rail/hero 用）。 */
const logoDataUrl = `data:image/png;base64,${readFileSync(resolveAsset('brand-k.png')).toString('base64')}`

/**
 * 组合 Logo：K 图标 + "Coder" 字标渲染为单张 PNG（Avenir Next Bold，
 * 22px 等高、零间距紧贴），分深色主题（白字）/ 浅色主题（深字）两版。
 * 展开态 brand 按钮内直接用这一张图替换上游 BrandWordmark，不再需要
 * 独立的 word span 与间距 CSS。
 */
const logoComboDarkDataUrl = `data:image/png;base64,${readFileSync(resolveAsset('brand-combo-dark.png')).toString('base64')}`
const logoComboLightDataUrl = `data:image/png;base64,${readFileSync(resolveAsset('brand-combo-light.png')).toString('base64')}`

/** 注入脚本（页面上下文执行，幂等 + 自愈）。 */
const INJECT_JS = `(() => {
  const DATA_URL = ${JSON.stringify(logoDataUrl)}
  const DATA_DARK = ${JSON.stringify(logoComboDarkDataUrl)}
  const DATA_LIGHT = ${JSON.stringify(logoComboLightDataUrl)}
  const UP = ${JSON.stringify(UPSTREAM_NAME)}
  const DOWN = ${JSON.stringify(BRAND_NAME)}
  const LOGO_ID = ${JSON.stringify(LOGO_ID)}
  const TAGLINE_ZH = ${JSON.stringify(TAGLINE_ZH)}
  const TAGLINE_EN = ${JSON.stringify(TAGLINE_EN)}

  // ---- 标题品牌替换：拦截 setter + 立即改写当前值 ----
  // 坑（2026-08-17 CDP 实测）：title 的原生 accessor 不一定在第一层原型
  // ——本机 Electron 在 Document.prototype，HTMLDocument.prototype 上
  // 无 own descriptor，只查一层拿到 undefined → 拦截静默不生效，React
  // 后续每次赋值都是旧名（首次验证被“立即替换当前值”的一次性效果
  // 骗过，末验证持续拦截）。必须沿原型链逐层找到再拦。
  if (!window.__dshBrandTitleHooked) {
    window.__dshBrandTitleHooked = true
    const rewrite = (v) => (typeof v === 'string' && v.includes(UP) ? v.split(UP).join(DOWN) : v)
    let proto = document
    let desc = null
    while (proto !== null) {
      desc = Object.getOwnPropertyDescriptor(proto, 'title')
      if (desc !== undefined) break
      proto = Object.getPrototypeOf(proto)
    }
    if (desc?.set) {
      const { get, set } = desc
      Object.defineProperty(document, 'title', {
        configurable: true,
        get: () => get.call(document),
        set: (v) => { set.call(document, rewrite(v)) },
      })
    }
    if (document.title.includes(UP)) document.title = document.title.split(UP).join(DOWN)
  }

  // ---- 全局样式（极简：仅隐藏 brand 内 SVG） ----
  // 组合 Logo 已是单张图（K+Coder 紧贴），brand 按钮回归上游无边框
  // 样式（上游 .brand 本身 border:none / background:transparent /
  // padding:0），无需任何边框/hover/字标 CSS。唯一必须保留的是
  // brand 内上游 BrandWordmark SVG 的隐藏——否则 React 重渲染重建
  // 新 SVG 时（inline display:none 会被清掉），HARNESS 徽章 rect 会
  // 以 currentColor 白底圆角矩形重新出现。CSS !important 兜底覆盖
  // React 重建路径，选择器对新 SVG 持续生效。
  const installStyles = () => {
    if (document.getElementById(LOGO_ID + '_style') !== null) return
    const el = document.createElement('style')
    el.id = LOGO_ID + '_style'
    el.textContent = [
      '[class*="root"]:not([class*="collapsed"]) [class*="logoRow"] [class*="brand"] svg{',
      '  display:none !important;',
      '}',
    ].join('')
    document.head.appendChild(el)
  }

  // ---- 展开：brand 按钮内 wordmark SVG 藏起 + 旁插组合 Logo 图 ----
  // 不用 replaceWith：React 卸载时会 removeChild 它记录的旧 svg，
  // 节点被换走会抛 NotFoundError 崩整棵树（实测踩坑）。
  // 组合 Logo 为单张 PNG（K + Coder 紧贴渲染），按主题选深/浅字色版。
  const swapBrand = () => {
    const btn = document.querySelector('[class*="logoRow"] button[class*="brand"]')
    if (btn === null || btn.querySelector('#' + LOGO_ID) !== null) return
    const svg = btn.querySelector('svg')
    if (svg === null) return
    const img = document.createElement('img')
    img.id = LOGO_ID
    img.src = document.body?.getAttribute('data-ds-dark-theme') !== null ? DATA_DARK : DATA_LIGHT
    img.alt = ''
    // 组合图高度对齐原 wordmark（22）；brand 是 inline-flex + align-items
    // center，img 自动垂直居中；不设 display——避免内联样式压过上游 CSS
    img.style.height = '22px'
    img.style.width = 'auto'
    img.style.flex = 'none'
    svg.style.display = 'none'
    svg.insertAdjacentElement('afterend', img)
  }

  // ---- 主题切换：组合 Logo 换字色版（深色→白字版，浅色→深字版） ----
  const syncLogoTheme = () => {
    const img = document.getElementById(LOGO_ID)
    if (img === null) return
    const want = document.body?.getAttribute('data-ds-dark-theme') !== null ? DATA_DARK : DATA_LIGHT
    if (img.getAttribute('src') !== want) img.setAttribute('src', want)
  }

  // ---- rail：鲸鱼 SVG 藏起 + 旁插 logo img（复制类名，hover 换图生效）----
  const swapRail = () => {
    const svg = document.querySelector('svg[class*="railFish"]')
    if (svg === null || svg.nextElementSibling?.id === LOGO_ID + '_rail') return
    const img = document.createElement('img')
    img.id = LOGO_ID + '_rail'
    img.src = DATA_URL
    img.alt = ''
    img.className = svg.getAttribute('class') || ''
    img.style.height = '23px'
    img.style.width = '23px'
    img.style.flex = 'none'
    // 不设 display：让 .collapsed .toggle:hover .railFish { display:none }
    // 等 hover 换图规则保持作用（内联不与 display 规则冲突）
    svg.style.display = 'none'
    svg.insertAdjacentElement('afterend', img)
  }

  // ---- turnStatus：回合运行态文案 Deep diving... → KCoder... ----
  //（首文本节点精确等值才改：turnStatusClock 也含 _turnStatus 子串，
  //  误命中不致误改；回合结束卸载、重挂恢复原文 → observer 自愈）
  const swapTurnStatus = () => {
    for (const el of document.querySelectorAll('[class*="_turnStatus"]')) {
      const node = el.firstChild
      if (node?.nodeType === Node.TEXT_NODE && node.nodeValue === 'Deep diving...') {
        node.nodeValue = 'KCoder...'
      }
    }
  }

  // ---- hero：新会话空状态页的鲸鱼/文案/预览徽章 ----
  const swapHero = () => {
    // 鲸鱼 logo（EmptyHero_fish_<hash>；railFish 含大写 F 不会误匹配）
    const svg = document.querySelector('svg[class*="fish"]')
    if (svg !== null && svg.nextElementSibling?.id !== LOGO_ID + '_hero') {
      const img = document.createElement('img')
      img.id = LOGO_ID + '_hero'
      img.src = DATA_URL
      img.alt = ''
      img.style.height = '26px'
      img.style.width = '26px'
      img.style.flex = 'none'
      svg.style.display = 'none'
      svg.insertAdjacentElement('afterend', img)
    }
    // headline：换为产品 slogan（中英自适应；只改文本节点 .data，
    // 不动 DOM 结构，见文件头注释）
    const head = document.querySelector('span[class*="headlineText"]')
    const node = head?.firstChild
    if (node?.nodeType === Node.TEXT_NODE
      && node.nodeValue !== TAGLINE_ZH && node.nodeValue !== TAGLINE_EN) {
      node.nodeValue = /[\u4e00-\u9fff]/.test(node.nodeValue) ? TAGLINE_ZH : TAGLINE_EN
    }
    // 预览徽章：上游装饰，藏起
    const badge = document.querySelector('span[class*="previewBadge"]')
    if (badge !== null && badge.style.display !== 'none') badge.style.display = 'none'
  }

  const apply = () => {
    // 展开态自清 rail 残留：React 卸载 railFish svg，但注入的 img 在
    // 永不卸载的 toggle 内，需主动移除（否则展开态多显示一个 K 图）
    const railEl = document.getElementById(LOGO_ID + '_rail')
    if (railEl !== null && document.querySelector('[class*="collapsed"]') === null) {
      railEl.remove()
    }
    installStyles()
    swapBrand()
    syncLogoTheme()
    swapRail()
    swapHero()
    swapTurnStatus()
  }
  apply()
  // 侧边栏异步挂载（插件树加载中）：短轮询，最长 60s
  let n = 0
  const t = setInterval(() => {
    apply()
    if (++n > 120) clearInterval(t)
  }, 500)
  // React 重渲染可能重建 logoRow/brand/railFish/hero：自愈重替换
  //（characterData：React 重设 headline 文案时也能自愈改回；attributes：
  //  主题切换 data-ds-dark-theme 时换组合 Logo 字色版）
  const mo = new MutationObserver(apply)
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-ds-dark-theme'],
  })
})()`

/**
 * 把品牌注入器挂到 shell 窗口：每次页面加载完成后执行。
 * 窗口销毁后 executeJavaScript 抛错被吞（判活先行）。
 */
export function attachBrandInjector(win: BrowserWindow): void {
  const run = (): void => {
    if (win.isDestroyed()) return
    win.webContents.executeJavaScript(INJECT_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次 did-finish-load 重试
    })
  }
  win.webContents.on('did-finish-load', run)
  run()
}
