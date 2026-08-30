/**
 * 关于注入器：设置对话框导航列末尾注入「关于」分区——品牌头（与
 * workspace 侧边栏顶部商标同款构成：K 图标 + "Coder" 字标 + 「桌面版
 * v<产品版本>」徽章）+ 产品介绍 + 版本信息卡，与技能 / MCP 分区同款
 * 机制（navList 尾部克隆按钮 + 自绘内容容器 + 对话框级 marker 类切换
 * 显隐 + MutationObserver 自愈）。
 *
 * 信息全部运行时派生，发布跟随自动同步（无任何硬编码版本号）：
 * - 品牌头徽章版本号：appVersion（app.getVersion()，随产品发布自动
 *   更新，与侧边栏徽章同源同语义）；
 * - 产品版本：app.getVersion()（= package.json version，打包自动带）；
 * - 上游运行时版本：从实际解析出的运行时目录（内置运行时 / 本地克隆）
 *   读 package.json（dsh-contract.upstreamVersionIn）；
 * - 运行时来源：dsh-contract.describePublic 脱敏展示（仅来源类型 +
 *   解释器，不含本机绝对路径，不暴露开发者机器信息）；
 * - fork 分支信息：消费锚点常量（dsh-contract 的 UPSTREAM_REPO /
 *   UPSTREAM_BRANCH，升级仪式改锚点即随代码发布同步）；本地克隆在场时
 *   附带当前分支 + HEAD 短哈希（打包用户无克隆则省略）；
 * - 基线提交：仓内 upstream/BASELINE 首个非注释行（与 setup.sh /
 *   release.sh 同一读取语义）；打包版不含该文件 → 省略此行。
 *
 * 通信（console 通道，同 skills-settings / mcp-settings）：
 * - 页面 → 主进程：console.log('__dsh_about__:' + JSON 载荷) {op:'info'}；
 * - 主进程 → 页面：executeJavaScript 调 window.__dshAboutInfo(info)。
 *
 * @module desktop/main/about-settings
 */

import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { consoleMessageText } from './console-channel'
import { PROJECT_ROOT, resolveAsset, resolveDshCommand, UPSTREAM_BRANCH, UPSTREAM_DIR, UPSTREAM_REPO, upstreamVersionIn } from './dsh-contract'

/** console 通道前缀。 */
const PREFIX = '__dsh_about__:'

/** fork 信息的展示名（仓库地址剥协议前缀）。 */
const FORK_DISPLAY = UPSTREAM_REPO.replace(/^git@github\.com:/, 'github.com/').replace(/\.git$/, '')

/**
 * 品牌头资产（与 brand-injector 侧边栏顶部商标同源同款）：64px 透明 K
 * 图标 + "Coder" 字标（深色主题白字版 / 浅色主题深字版），base64 内嵌
 * 注入脚本；页面侧两张字标都渲染，按 body 主题属性 CSS 切换显隐。
 */
const BRAND_K_DATA_URL = `data:image/png;base64,${readFileSync(resolveAsset('brand-k.png')).toString('base64')}`
const BRAND_CODER_DARK_DATA_URL = `data:image/png;base64,${readFileSync(resolveAsset('brand-coder-dark.png')).toString('base64')}`
const BRAND_CODER_LIGHT_DATA_URL = `data:image/png;base64,${readFileSync(resolveAsset('brand-coder-light.png')).toString('base64')}`

/** 「关于」页数据（全部运行时派生，页面侧按字段渲染）。 */
export interface AboutInfo {
  appVersion: string
  runtimeVersion: string | null
  /** 运行时来源（脱敏展示，dsh-contract.describePublic，不含本机路径）。 */
  runtimeSource: string | null
  forkBranch: string | null
  forkHead: string | null
  baselineSha: string | null
  forkDisplay: string
  integrationBranch: string
}

/** 收集结果短缓存：对话框每次打开都请求一次，避免重复 spawn git。 */
let cache: { at: number; info: AboutInfo } | null = null
const CACHE_MS = 30_000

/** upstream/BASELINE 首个非注释非空行（与 setup.sh 的读取语义一致）。 */
function readBaselineSha(): string | null {
  try {
    const line = readFileSync(join(PROJECT_ROOT, 'upstream', 'BASELINE'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '' && !l.startsWith('#'))
    return line ?? null
  } catch {
    return null
  }
}

/** git 单参探测（毫秒级；不在仓内 / 无 git 返回 null，不抛）。 */
function gitArg(dir: string, ...args: string[]): string | null {
  try {
    const out = execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out === '' ? null : out
  } catch {
    return null
  }
}

/** 汇总「关于」数据（带短缓存）。 */
function collectAboutInfo(): AboutInfo {
  if (cache !== null && Date.now() - cache.at < CACHE_MS) return cache.info

  const cmd = resolveDshCommand()
  const runtimeVersion = cmd !== null ? upstreamVersionIn(cmd.cwd) : null

  // fork 本地克隆在场时附带当前分支 + HEAD（开发机/有克隆的用户）；
  // 打包用户通常只有内置运行时，forkBranch 回退为消费锚点常量
  const branch = gitArg(UPSTREAM_DIR, 'rev-parse', '--abbrev-ref', 'HEAD')
  const head = gitArg(UPSTREAM_DIR, 'rev-parse', '--short=10', 'HEAD')

  const info: AboutInfo = {
    appVersion: app.getVersion(),
    runtimeVersion,
    runtimeSource: cmd !== null ? cmd.describePublic : null,
    forkBranch: branch ?? UPSTREAM_BRANCH,
    forkHead: head,
    baselineSha: readBaselineSha(),
    forkDisplay: FORK_DISPLAY,
    integrationBranch: UPSTREAM_BRANCH,
  }
  cache = { at: Date.now(), info }
  return info
}

/** 注入脚本（页面上下文执行；纯 JS：无模板字面量、反引号转义）。 */
const PAGE_JS = `(() => {
  if (window.__dshAboutWired) return
  window.__dshAboutWired = true

  var CSS_ID = '__dsh_desktop_about_css'
  var NAV_ID = '__dsh_desktop_about_nav'
  var SEC_ID = '__dsh_desktop_about_section'
  var MARKER = '__dsh_ab_on'
  var PREFIX = '__dsh_about__:'

  var BRAND_K = ${JSON.stringify(BRAND_K_DATA_URL)}
  var CODER_DARK = ${JSON.stringify(BRAND_CODER_DARK_DATA_URL)}
  var CODER_LIGHT = ${JSON.stringify(BRAND_CODER_LIGHT_DATA_URL)}

  var info = null       // 主进程推送的版本数据
  var dialog = null     // 当前挂载的设置对话框
  var navList = null
  var activeExtra = []  // 哈希激活类（激活按钮类集 - 普通按钮类集）
  var on = false

  function send(payload) { console.log(PREFIX + JSON.stringify(payload)) }

  function featRow(name, desc) {
    var row = document.createElement('div')
    row.className = 'akf-row'
    var n = document.createElement('span'); n.className = 'akf-name'; n.textContent = name
    var d = document.createElement('span'); d.className = 'akf-desc'; d.textContent = desc
    row.append(n, d)
    return row
  }

  function verRow(label, value, mono) {
    if (value === null || value === undefined || value === '') return null
    var row = document.createElement('div')
    row.className = 'akv-row'
    var l = document.createElement('span'); l.className = 'akv-label'; l.textContent = label
    var v = document.createElement('span')
    v.className = 'akv-value' + (mono ? ' mono' : '')
    v.textContent = value
    v.title = String(value)
    row.append(l, v)
    return row
  }

  function render() {
    var sec = document.getElementById(SEC_ID)
    if (sec === null) return
    sec.replaceChildren()

    // 品牌头：与 workspace 侧边栏顶部商标同款构成（brand-injector 同源
    // 资产）——K 图标 + "Coder" 字标（深浅两版同位渲染，CSS 按主题切显隐）
    // + 「桌面版 v」徽章；徽章版本号取 info.appVersion（= app.getVersion()，
    // 随产品发布自动更新）。info 未到达时先渲染无徽章形态，到达后
    // __dshAboutInfo 触发重渲染补齐。
    var brand = document.createElement('div')
    brand.className = 'ak-brand'
    var k = document.createElement('img')
    k.className = 'ak-brand-k'
    k.src = BRAND_K
    k.alt = 'KCoder'
    var cd = document.createElement('img')
    cd.className = 'ak-coder-img ak-coder-dark'
    cd.src = CODER_DARK
    cd.alt = ''
    var cl = document.createElement('img')
    cl.className = 'ak-coder-img ak-coder-light'
    cl.src = CODER_LIGHT
    cl.alt = ''
    brand.append(k, cd, cl)
    if (info !== null) {
      var ver = document.createElement('span')
      ver.className = 'ak-brand-ver'
      ver.textContent = '桌面版 v' + info.appVersion
      brand.appendChild(ver)
    }
    sec.appendChild(brand)

    var lead = document.createElement('div')
    lead.className = 'ak-lead'
    lead.textContent = 'KCoder 是基于 DSH（deepseek-harness）基线的桌面 AI 编码工作台：' +
      '零修改复用上游引擎、Web UI 与插件生态，以零侵入注入层完成桌面化改造。' +
      '版本信息随产品发布自动同步——产品版本取应用元数据，上游运行时版本从实际' +
      '运行时目录读取，fork 分支与基线锚点随代码发布跟随，无硬编码。'
    sec.appendChild(lead)

    var feat = document.createElement('div')
    feat.className = 'ak-card'
    var ft = document.createElement('div')
    ft.className = 'ak-title'
    ft.textContent = '产品功能'
    feat.appendChild(ft)
    var feats = [
      ['零侵入注入层', '上游 Web UI 桌面化：设置页单页化、工作区头部收纳、自绘状态栏、主题跟随'],
      ['技能与插件', '内置 / 工作区 / 用户三层技能目录，预置插件随包安装、用户插件热装热补'],
      ['MCP 服务器', '设置面板内可视化管理外部 MCP 服务器，保存即热重载无需重启引擎'],
      ['桌面样式定制', '密度 / 列宽 / 字号等桌面专属项，写回即时生效'],
      ['工作台面板', 'Git 面板、终端面板、会话统计图表、附件选择器'],
      ['fork 锚定升级', '上游修复以提交落自有 fork 集成分支，基线升级走钉版仪式，发布可复现']
    ]
    for (var i = 0; i < feats.length; i++) feat.appendChild(featRow(feats[i][0], feats[i][1]))
    sec.appendChild(feat)

    if (info === null) return
    var card = document.createElement('div')
    card.className = 'ak-card'
    var vt = document.createElement('div')
    vt.className = 'ak-title'
    vt.textContent = '版本信息'
    card.appendChild(vt)
    var rows = [
      verRow('产品版本', 'v' + info.appVersion, false),
      verRow('上游运行时版本', info.runtimeVersion, true),
      verRow('运行时来源', info.runtimeSource, false),
      verRow('上游基线（fork 仓库）', info.forkDisplay, true),
      verRow('消费分支', info.integrationBranch, true),
      verRow('本地克隆当前分支', info.forkBranch !== info.integrationBranch ? info.forkBranch : null, true),
      verRow('本地克隆 HEAD', info.forkHead, true),
      verRow('基线提交', info.baselineSha, true)
    ]
    for (var j = 0; j < rows.length; j++) {
      if (rows[j] !== null) card.appendChild(rows[j])
    }
    sec.appendChild(card)
  }

  /** 主进程 → 页面：版本信息推送。 */
  window.__dshAboutInfo = function (data) {
    info = data && typeof data === 'object' ? data : null
    render()
  }

  // ── 对话框挂载 / 激活切换（同 skills-settings / mcp-settings） ──
  function classes(el) { return Array.from(el.classList) }

  function activate() {
    on = true
    if (dialog !== null) dialog.classList.add(MARKER)
    var mine = document.getElementById(NAV_ID)
    var buttons = navList !== null ? Array.from(navList.querySelectorAll('button')) : []
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i]
      if (b === mine) {
        b.setAttribute('aria-current', 'true')
        for (var j = 0; j < activeExtra.length; j++) b.classList.add(activeExtra[j])
      } else {
        b.removeAttribute('aria-current')
        for (var k = 0; k < activeExtra.length; k++) b.classList.remove(activeExtra[k])
      }
    }
  }

  function deactivate() {
    on = false
    if (dialog !== null) dialog.classList.remove(MARKER)
    var mine = document.getElementById(NAV_ID)
    if (mine !== null) {
      mine.removeAttribute('aria-current')
      for (var k = 0; k < activeExtra.length; k++) mine.classList.remove(activeExtra[k])
    }
  }

  function build() {
    var dlg = document.querySelector('[role="dialog"][aria-modal="true"]')
    if (dlg === null || dlg.querySelector('div[data-slot="settings.section"]') === null) {
      if (dialog !== null) { on = false; dialog = null; navList = null }
      return
    }
    if (dlg !== dialog) {
      // 对话框重新挂载（上次关闭后重开）：重置状态并请求最新信息
      on = false
      dialog = dlg
      var nav = dlg.querySelector('nav')
      navList = nav !== null
        ? Array.from(nav.children).find(function (c) { return c.tagName === 'DIV' && c.querySelector('button') !== null }) || null
        : null
      activeExtra = []
      if (navList !== null) {
        var buttons = Array.from(navList.querySelectorAll('button'))
        var activeBtn = buttons.find(function (b) { return b.getAttribute('aria-current') === 'true' }) || null
        var plainBtn = buttons.find(function (b) { return b.getAttribute('aria-current') !== 'true' }) || null
        if (activeBtn !== null && plainBtn !== null) {
          var plain = new Set(classes(plainBtn))
          activeExtra = classes(activeBtn).filter(function (c) { return !plain.has(c) })
        }
      }
      send({ op: 'info' })
    }

    // 样式（幂等）
    if (document.getElementById(CSS_ID) === null) {
      var style = document.createElement('style')
      style.id = CSS_ID
      style.textContent = [
        '#' + SEC_ID + ' { display: none; }',
        // 激活时隐藏原生 React 分区、显示自绘容器（同 skills/mcp 机制）
        '[role="dialog"].' + MARKER + ' [class*="_options"] > div[data-slot="settings.section"] { display: none !important; }',
        '[role="dialog"].' + MARKER + ' #' + SEC_ID + ' { display: block; width: 100%; max-width: 960px; margin: 0 auto; box-sizing: border-box; }',
        // 品牌头（关于内容区顶部居中）：尺寸与侧边栏一致（K / 字标 22px
        // 等高沉底，徽章上标位与字标字形顶齐平，同 badgeEl 几何）；字标
        // 深浅两版按 body 主题属性纯 CSS 切换，无需 observer
        '.ak-brand { display: flex; align-items: flex-end; justify-content: center; margin: 2px 0 22px; }',
        '.ak-brand-k { height: 22px; width: 22px; flex: none; }',
        '.ak-coder-img { height: 22px; width: auto; flex: none; }',
        'body[data-ds-dark-theme] .ak-coder-light { display: none; }',
        'body:not([data-ds-dark-theme]) .ak-coder-dark { display: none; }',
        '.ak-brand-ver { align-self: flex-start; margin-top: 1px; margin-left: 5px; flex: none; font-size: 10px; line-height: 1; padding: 2px 6px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12)); color: var(--dsw-alias-label-tertiary, #999); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2)); white-space: nowrap; }',
        '.ak-lead { margin: 2px 0 20px; color: var(--dsw-alias-label-secondary, #888); font-size: 13px; line-height: 1.65; }',
        '.ak-card { box-sizing: border-box; width: 100%; margin: 0 0 14px; padding: 20px 24px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-module-platform); box-shadow: 0 2px 10px rgba(9,16,29,.035); }',
        'body[data-ds-dark-theme] .ak-card { box-shadow: 0 2px 12px rgba(0,0,0,.16); }',
        '.ak-title { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); margin: 0 0 12px; }',
        // 功能行：左特性名右说明（同 settings.general.item 的行感）
        '.akf-row { display: flex; align-items: baseline; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--dsw-alias-border-l2, #eee); }',
        '.akf-row:last-child { border-bottom: 0; }',
        '.akf-name { flex: none; width: 128px; font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary, #222); }',
        '.akf-desc { flex: 1; min-width: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #888); }',
        // 版本信息行：左标签右值（值长省略，title 全量）
        '.akv-row { display: flex; align-items: baseline; gap: 14px; padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l2, #eee); }',
        '.akv-row:last-child { border-bottom: 0; }',
        '.akv-label { flex: none; width: 128px; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }',
        '.akv-value { flex: 1; min-width: 0; font-size: 13px; color: var(--dsw-alias-label-primary, #222); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
        '.akv-value.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }'
      ].join('\\n')
      document.head.appendChild(style)
    }

    if (navList === null) return

    // 导航按钮（React 重渲染后重注入；克隆末位按钮 = 排在最后）
    if (document.getElementById(NAV_ID) === null) {
      var seeds = Array.from(navList.querySelectorAll('button'))
      var seed = seeds[seeds.length - 1]
      if (seed !== undefined) {
        var mine = seed.cloneNode(true)
        mine.id = NAV_ID
        mine.removeAttribute('aria-current')
        var label = mine.querySelector('span')
        if (label !== null) label.textContent = '关于'
        mine.addEventListener('click', function (ev) { ev.stopPropagation(); activate() })
        seed.parentNode.appendChild(mine)
      }
    }

    // 激活态再同步：上游按钮的 aria-current/active 类是 React 管理的，
    // 若激活期间发生重渲染会被恢复 —— 每次 DOM 变化都重新压住
    if (on) activate()

    // 点击其他分区 → 让位（捕获期，React 各自处理自己的状态）
    if (dialog.getAttribute('data-dsk-about-nav') !== '1') {
      dialog.setAttribute('data-dsk-about-nav', '1')
      dialog.addEventListener('click', function (ev) {
        if (navList === null) return
        var btn = ev.target instanceof Element ? ev.target.closest('button') : null
        if (btn === null || !navList.contains(btn)) return
        if (btn.id === NAV_ID) return // 自己的点击已处理
        if (on) deactivate()
      }, true)
    }

    // 内容容器（挂在 settings.section 锚点的父级）
    if (document.getElementById(SEC_ID) === null) {
      var slot = dlg.querySelector('div[data-slot="settings.section"]')
      if (slot !== null && slot.parentElement !== null) {
        var sec = document.createElement('div')
        sec.id = SEC_ID
        slot.parentElement.appendChild(sec)
        render()
      }
    }
  }

  var mo = new MutationObserver(function () { build() })
  mo.observe(document.body, { childList: true, subtree: true })
  build()
})()`

/**
 * 给 shell 窗口挂关于注入器：整页加载后注入页面脚本；对话框每次打开
 * 经 console 通道请求最新信息（30s 缓存，git 探测毫秒级）。
 * 窗口销毁时监听随 webContents 消亡。
 */
export function attachAboutSettingsInjector(win: BrowserWindow): void {
  const { webContents } = win

  const push = (): void => {
    if (win.isDestroyed()) return
    void webContents.executeJavaScript(
      `window.__dshAboutInfo && window.__dshAboutInfo(${JSON.stringify(collectAboutInfo())})`,
      true,
    ).catch(() => {})
  }

  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(PREFIX) || win.isDestroyed()) return
    let payload: { op?: unknown }
    try { payload = JSON.parse(message.slice(PREFIX.length)) as { op?: unknown } } catch { return }
    if (payload.op === 'info') push()
  }

  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', () => {
    void webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  })
}
