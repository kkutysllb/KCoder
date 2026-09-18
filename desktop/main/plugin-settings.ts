/**
 * 插件管理设置注入器：把「插件管理」分区注入上游设置对话框——与
 * MCP/技能/关于三套注入器同款机制（nav 克隆 + dialog 级 marker 显隐 +
 * console 通道 + MutationObserver 自愈，见 mcp-settings）。
 *
 * 产品背景（2026-09-18）：上游 0.1.6-alpha.2 的 ui-plugin-manager 向
 * `sidebar.panellist` 无条件注册了侧栏「插件」入口（无配置开关），产品
 * 决策把它收进设置页：入口经 style-overlay 的 SIDEBAR_PLUGIN_ENTRY_CSS
 * 压制，管理能力合并为本分区——
 *   ① 上游插件管理器入口卡：管理页本体是工作区面板（React，宿主无法
 *      内嵌进设置），点击后对隐藏的侧栏按钮派发 .click() 走上游真实
 *      selectPanel 路径并关闭设置（display:none 不影响 HTMLElement
 *      .click() 派发，sidebar-cluster 看门狗同款先例）；
 *   ② 已安装插件（层叠顺序）+ 重启引擎：交互逻辑移植自
 *      desktop/renderer/src/views/plugins.ts（#/plugins 面板窗口，菜单
 *      「工具 → 插件管理…」照旧保留）；
 *   ③ 社区插件发现（GitHub topic `dsh-plugin`）：同上移植。
 *
 * 数据面完全复用 plugins.ts 的已导出函数（installedPlugins /
 * latestVersions / communityPlugins / updatePlugin / runPluginCommand），
 * 经 console 通道桥接——plugins.ts 与 ipc.ts 零改动。
 *
 * 通信（console 通道）：
 * - 页面 → 主进程：console.log('__dsh_plugins__:' + JSON 载荷)
 *   {op:'list'} 已装列表 / {op:'latest', names} registry 最新版 /
 *   {op:'community', query, page} 社区搜索 / {op:'cmd', kind, pkg, label}
 *   安装卸载更新 / {op:'restart'} 重启引擎 / {op:'open', url} 外链；
 * - 主进程 → 页面：window.__dshPluginsSync(installed) /
 *   __dshPluginsLatest(latest) / __dshPluginsCommunity(result) /
 *   __dshPluginsCmdResult({label, ok, output})。
 *
 * @module desktop/main/plugin-settings
 */

import type { BrowserWindow } from 'electron'
import { shell } from 'electron'
import { consoleMessageText } from './console-channel'
import {
  communityPlugins,
  installedPlugins,
  latestVersions,
  runPluginCommand,
  updatePlugin,
} from './plugins'
import { dshManager } from './dsh-manager'
import type { CommunityQueryResult, LatestVersions, PluginCommandResult } from '@shared/ipc-contract'

/** console 通道前缀。 */
const PREFIX = '__dsh_plugins__:'

/** 注入脚本（页面上下文执行；纯 JS：无模板字面量、反引号转义）。 */
const PAGE_JS = `(() => {
  if (window.__dshPluginsWired) return
  window.__dshPluginsWired = true

  var CSS_ID = '__dsh_desktop_plugins_css'
  var NAV_ID = '__dsh_desktop_plugins_nav'
  var SEC_ID = '__dsh_desktop_plugins_section'
  var MARKER = '__dsh_pl_on'
  var PREFIX = '__dsh_plugins__:'

  // 导航图标工厂：上游 IconPluginPinwheelOutline16 path 零误差复制
  //（ui-primitives icons/index.tsx:1017-1020，stroke 型），class 抄被
  // 替换的旧 svg（上游 navIcon 编译类）。
  function navIcon(old) {
    var NS = 'http://www.w3.org/2000/svg'
    var svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', '16')
    svg.setAttribute('height', '16')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('fill', 'none')
    var cls = old.getAttribute('class')
    if (cls !== null) svg.setAttribute('class', cls)
    var ds = [
      'M7.84457 5.06199C11.6605 4.93876 14.7962 6.14848 14.8484 7.76397C14.8875 8.97461 13.1838 10.0696 10.7215 10.5942',
      'M5.12742 8.07731C5.00419 4.26138 6.21391 1.12568 7.8294 1.07351C9.04004 1.03441 10.135 2.73808 10.6596 5.20037',
      'M8.02457 10.6802C4.20865 10.8034 1.07294 9.5937 1.02077 7.97821C0.981678 6.76758 2.68535 5.67262 5.14763 5.14798',
      'M10.7476 7.89535C10.8708 11.7113 9.66109 14.847 8.0456 14.8991C6.83496 14.9382 5.74 13.2346 5.21536 10.7723'
    ]
    for (var i = 0; i < ds.length; i++) {
      var p = document.createElementNS(NS, 'path')
      p.setAttribute('d', ds[i])
      p.setAttribute('stroke', 'currentColor')
      p.setAttribute('stroke-width', '1.2')
      svg.appendChild(p)
    }
    return svg
  }

  // ── 状态（页面级；对话框重开后保留，DOM 由 build() 重建） ──────
  var installed = []
  var installedQuery = ''
  var latest = {}
  var latestAt = 0
  var busy = false      // 插件命令执行中（禁全部动作按钮）
  var status = ''       // 分区顶部状态行（sync 时清空）
  var logText = '（命令输出将显示在这里）'
  var communityQuery = ''
  var communityItems = []
  var communityTotal = 0
  var communityPage = 1
  var communityLoading = false
  var communityTouched = false
  var communityDirty = false
  var communityTimer
  var dialog = null
  var navList = null
  var activeExtra = []
  var on = false
  // 静态结构引用（ensureSection 建一次；对话框重开由 build() 重建再取）
  var refs = null

  function send(payload) { console.log(PREFIX + JSON.stringify(payload)) }

  /** 简易语义版本比较（major.minor.patch 逐段；prerelease/build 忽略）。 */
  function versionGt(a, b) {
    function seg(v) {
      return v.replace(/^v/, '').split('+')[0].split('-')[0].split('.').map(function (n) { return parseInt(n, 10) || 0 })
    }
    var x = seg(a)
    var y = seg(b)
    for (var i = 0; i < 3; i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
    }
    return false
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (Array.isArray(text)) {
      // 数组 = 子元素列表（表格行构造用）；逐个 append，不能塞 textContent
      //（会渲染成 "[object HTMLTableCellElement],…"——首版实测踩坑）
      for (var i = 0; i < text.length; i++) n.appendChild(text[i])
    } else if (text !== undefined) {
      n.textContent = text
    }
    return n
  }

  /** 「有新版本」判定唯一依据：registry latest > 实装版本。 */
  function hasUpdate(entry) {
    var newest = latest[entry.name]
    return entry.updatable && entry.version !== null && newest !== undefined && versionGt(newest, entry.version)
  }

  function versionText(entry) {
    if (entry.version === null) return '—'
    var newest = latest[entry.name]
    return newest !== undefined && versionGt(newest, entry.version) ? entry.version + ' → ' + newest : entry.version
  }

  // ── 数据流 ────────────────────────────────────────────────────
  function refreshLatest(names) {
    if (Date.now() - latestAt < 60000) return
    latestAt = Date.now()
    send({ op: 'latest', names: names })
  }

  function refreshInstalled() {
    send({ op: 'list' })
  }

  /** 社区查询：reset 重置到第 1 页替换列表；否则翻页追加。 */
  function loadCommunity(reset) {
    if (communityLoading) { communityDirty = true; return }
    communityLoading = true
    communityTouched = true
    if (reset) communityItems = []
    var page = reset ? 1 : communityPage + 1
    renderCommunity()
    send({ op: 'community', query: communityQuery, page: page })
  }

  // ── 渲染（静态结构建一次，只更新动态区） ──────────────────────
  function appendLog(text) {
    logText = logText === '（命令输出将显示在这里）' ? text : logText + '\\n' + text
    if (refs !== null) refs.log.textContent = logText
  }

  function renderInstalled() {
    if (refs === null) return
    var q = installedQuery
    var filtered = q === '' ? installed : installed.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0 })
    var body = refs.installedBody
    body.replaceChildren()
    if (filtered.length === 0) {
      body.append(el('tr', '', [el('td', 'dpi-emptyrow', installed.length === 0 ? '尚未安装任何插件（内置层随发行版提供）' : '无匹配，换个关键词试试')]))
      return
    }
    for (var i = 0; i < filtered.length; i++) {
      (function (p) {
        // 操作位单按钮互换：检出 registry 新版 → 「更新」；否则回落
        // 「卸载」（内置禁用）。与 #/plugins 窗口同款语义
        var upd = hasUpdate(p)
        var action = el('button', upd ? 'dpi-primary' : 'dpi-danger', upd ? '更新' : '卸载')
        action.type = 'button'
        action.disabled = busy || (!upd && p.inBox)
        if (!upd && p.inBox) action.title = '内置层不可卸载'
        action.addEventListener('click', function () {
          send({ op: 'cmd', kind: upd ? 'update' : 'remove', pkg: p.name, label: (upd ? '更新 ' : '卸载 ') + p.name })
        })
        var ver = el('td', 'dpi-mono', versionText(p))
        if (upd) ver.classList.add('dpi-hasupdate')
        var tr = el('tr', '', [
          el('td', '', String(p.layer)),
          el('td', 'dpi-mono', p.name),
          ver,
          el('td', '', p.inBox ? '内置' : '用户安装'),
        ])
        var tdAct = el('td', '')
        tdAct.appendChild(action)
        tr.appendChild(tdAct)
        body.appendChild(tr)
      })(filtered[i])
    }
    refs.installedCount.textContent = installed.length > 0 ? '（' + String(installed.length) + '）' : ''
  }

  function renderCommunity() {
    if (refs === null) return
    var body = refs.communityBody
    body.replaceChildren()
    if (!communityTouched) {
      body.append(el('tr', '', [el('td', 'dpi-emptyrow', '加载中…')]))
      return
    }
    if (communityItems.length === 0) {
      body.append(el('tr', '', [el('td', 'dpi-emptyrow', communityQuery === ''
        ? '暂无结果（网络受限或社区尚无 dsh-plugin 仓库）'
        : '没有匹配「' + communityQuery + '」的仓库，换个关键词试试')]))
      refs.communityMeta.textContent = ''
      refs.loadMore.hidden = true
      return
    }
    for (var i = 0; i < communityItems.length; i++) {
      (function (plugin) {
        // 社区发现给 GitHub full_name，已装列表是 npm 包名（可能带
        // scope）：按最后一段（repo 名）匹配
        var repo = plugin.fullName.indexOf('/') >= 0 ? plugin.fullName.split('/').pop() : plugin.fullName
        var matched = null
        for (var k = 0; k < installed.length; k++) {
          var n = installed[k]
          if (n.name === plugin.fullName || n.name.split('/').pop() === repo) { matched = n; break }
        }
        var isInstalled = matched !== null
        var upd = isInstalled && hasUpdate(matched)
        var action = el('button', '', '')
        action.type = 'button'
        if (!isInstalled) { action.textContent = '安装'; action.className = 'dpi-primary' }
        else if (upd) { action.textContent = '更新'; action.className = 'dpi-primary' }
        else { action.textContent = '已最新'; action.disabled = true }
        action.disabled = action.disabled || busy
        action.addEventListener('click', function () {
          // 已装：用已装包名（npm spec）更新；未装：用 github spec 安装
          var pkg = isInstalled ? matched.name : (plugin.fullName.indexOf('/') >= 0 ? 'github:' + plugin.fullName : plugin.fullName)
          send({ op: 'cmd', kind: isInstalled ? 'update' : 'add', pkg: pkg, label: action.textContent + ' ' + plugin.fullName })
        })
        var link = el('td', 'dpi-link', plugin.fullName)
        link.addEventListener('click', function () { send({ op: 'open', url: plugin.url }) })
        var ver = el('td', 'dpi-mono', !isInstalled ? '—' : versionText(matched))
        if (upd) ver.classList.add('dpi-hasupdate')
        var tr = el('tr', '', [
          link,
          el('td', '', plugin.description.slice(0, 80)),
          el('td', '', String(plugin.stars)),
          ver,
        ])
        var tdAct = el('td', '')
        tdAct.appendChild(action)
        tr.appendChild(tdAct)
        body.appendChild(tr)
      })(communityItems[i])
    }
    refs.communityMeta.textContent =
      '共 ' + String(communityTotal) + ' 个' + (communityQuery === '' ? '候选' : '匹配') + '仓库 · 已显示 ' + String(communityItems.length) + ' 个（按 ★ 倒序）'
    var more = communityItems.length < communityTotal
    refs.loadMore.hidden = !more
    refs.loadMore.disabled = communityLoading
    refs.loadMore.textContent = communityLoading ? '加载中…' : '加载更多'
  }

  function renderBusy() {
    if (refs === null) return
    var buttons = refs.sec.querySelectorAll('.dpi-primary, .dpi-danger')
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i]
      if (b.id !== refs.loadMore.id) b.disabled = busy
    }
  }

  function renderStatus() {
    if (refs !== null) {
      refs.status.textContent = status
      refs.status.hidden = status === ''
    }
  }

  /** 分区静态结构（幂等；对话框每次重开重建）。 */
  function ensureSection(dlg) {
    var existing = document.getElementById(SEC_ID)
    if (existing !== null) return
    var slot = dlg.querySelector('div[data-slot="settings.section"]')
    if (slot === null || slot.parentElement === null) return
    var sec = document.createElement('div')
    sec.id = SEC_ID

    var lead = el('div', 'dpi-lead',
      '一切皆插件：管理上游插件面板（层叠 bundle 启停）、内置与已装插件、社区发现。' +
      '安装/卸载/更新后需重启引擎进入组合。')
    sec.appendChild(lead)
    var statusEl = el('div', 'dpi-status')
    statusEl.hidden = true
    sec.appendChild(statusEl)

    // ① 上游插件管理器入口卡
    var cardMgr = el('div', 'dpi-card')
    cardMgr.appendChild(el('div', 'dpi-cardtitle', '上游插件管理器'))
    cardMgr.appendChild(el('div', 'dpi-desc',
      '上游 0.1.6 起的层叠 bundle 管理面板（启停/安装/安装日志）。点击后关闭设置并切换到插件面板。'))
    var openMgr = el('button', 'dpi-primary', '打开插件管理器')
    openMgr.type = 'button'
    openMgr.addEventListener('click', function () {
      // 对隐藏的侧栏按钮派发 .click()（display:none 不影响事件派发），
      // 走上游真实 selectPanel('plugins')；再点设置 header 关闭按钮回主区
      var btn = document.querySelector('nav[class*="panelList"] button[aria-label="插件"]')
      if (btn === null) btn = document.querySelector('nav[class*="panelList"] button[aria-label="Plugins"]')
      if (btn === null) {
        status = '未找到插件面板入口（上游结构可能已变化）；可从菜单「工具 → 插件管理…」管理内置插件。'
        renderStatus()
        return
      }
      btn.click()
      var close = document.querySelector('[role="dialog"] [class*="_header"] > [class*="_close"]')
      if (close !== null) close.click()
      deactivate()
    })
    var mgrRow = el('div', 'dpi-row')
    mgrRow.appendChild(openMgr)
    cardMgr.appendChild(mgrRow)
    sec.appendChild(cardMgr)

    // ② 已安装卡
    var cardInst = el('div', 'dpi-card')
    var instTitle = el('div', 'dpi-cardtitle', '')
    instTitle.appendChild(document.createTextNode('已安装（层叠顺序，自下而上）'))
    var instCount = el('span', 'dpi-count', '')
    instTitle.appendChild(instCount)
    cardInst.appendChild(instTitle)
    var instSearch = el('input', 'dpi-search')
    instSearch.type = 'search'
    instSearch.placeholder = '搜索已安装插件…'
    instSearch.addEventListener('input', function () {
      installedQuery = instSearch.value.trim().toLowerCase()
      renderInstalled()
    })
    cardInst.appendChild(instSearch)
    var instTable = el('table', 'dpi-table')
    var instHead = el('thead', '')
    instHead.append(el('tr', '', [el('th', '', '层'), el('th', '', '插件'), el('th', '', '版本'), el('th', '', '来源'), el('th', '', '')]))
    instTable.appendChild(instHead)
    var instBody = el('tbody', '')
    instTable.appendChild(instBody)
    cardInst.appendChild(instTable)
    sec.appendChild(cardInst)

    // ③ 社区发现卡
    var cardCom = el('div', 'dpi-card')
    cardCom.appendChild(el('div', 'dpi-cardtitle', '社区插件（GitHub topic: dsh-plugin）'))
    cardCom.appendChild(el('div', 'dpi-desc', '按 ★ 倒序；搜索直接查询 GitHub，可找到榜单之外的插件。'))
    var comSearch = el('input', 'dpi-search')
    comSearch.type = 'search'
    comSearch.placeholder = '搜索插件（仓库名 / 说明）…'
    comSearch.addEventListener('input', function () {
      if (communityTimer !== undefined) clearTimeout(communityTimer)
      communityTimer = setTimeout(function () {
        var next = comSearch.value.trim()
        if (next === communityQuery) return
        communityQuery = next
        loadCommunity(true)
      }, 400)
    })
    comSearch.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return
      if (communityTimer !== undefined) clearTimeout(communityTimer)
      var next = comSearch.value.trim()
      if (next === communityQuery) return
      communityQuery = next
      loadCommunity(true)
    })
    cardCom.appendChild(comSearch)
    var comMeta = el('div', 'dpi-meta', '')
    cardCom.appendChild(comMeta)
    var comTable = el('table', 'dpi-table')
    var comHead = el('thead', '')
    comHead.append(el('tr', '', [el('th', '', '仓库'), el('th', '', '说明'), el('th', '', '★'), el('th', '', '版本'), el('th', '', '')]))
    comTable.appendChild(comHead)
    var comBody = el('tbody', '')
    comTable.appendChild(comBody)
    cardCom.appendChild(comTable)
    var loadMore = el('button', 'dpi-btn', '加载更多')
    loadMore.type = 'button'
    loadMore.hidden = true
    loadMore.addEventListener('click', function () { loadCommunity(false) })
    cardCom.appendChild(loadMore)
    sec.appendChild(cardCom)

    // ④ 操作卡（刷新 / 重启 + 日志）
    var cardOps = el('div', 'dpi-card')
    cardOps.appendChild(el('div', 'dpi-cardtitle', '操作'))
    var opsRow = el('div', 'dpi-row')
    var refresh = el('button', 'dpi-btn', '刷新')
    refresh.type = 'button'
    refresh.addEventListener('click', function () {
      refreshInstalled()
      latestAt = 0
      refreshLatest(installed.map(function (p) { return p.name }))
      loadCommunity(true)
    })
    var restart = el('button', 'dpi-btn', '重启引擎使插件生效')
    restart.type = 'button'
    restart.addEventListener('click', function () { send({ op: 'restart' }) })
    opsRow.append(refresh, restart)
    cardOps.appendChild(opsRow)
    var log = el('pre', 'dpi-log', logText)
    cardOps.appendChild(log)
    sec.appendChild(cardOps)

    slot.parentElement.appendChild(sec)
    refs = {
      sec: sec, status: statusEl, installedBody: instBody, installedCount: instCount,
      communityBody: comBody, communityMeta: comMeta, loadMore: loadMore, log: log,
    }
    renderStatus()
    renderInstalled()
    renderCommunity()
  }

  // ── 主进程 → 页面回调 ─────────────────────────────────────────
  window.__dshPluginsSync = function (data) {
    installed = Array.isArray(data) ? data : []
    status = ''
    renderStatus()
    renderInstalled()
    refreshLatest(installed.map(function (p) { return p.name }))
  }

  window.__dshPluginsLatest = function (data) {
    latest = data !== null && typeof data === 'object' ? data : {}
    renderInstalled()
    renderCommunity()
  }

  window.__dshPluginsCommunity = function (result) {
    communityLoading = false
    if (result !== null && typeof result === 'object') {
      communityPage = typeof result.page === 'number' ? result.page : 1
      communityTotal = typeof result.totalCount === 'number' ? result.totalCount : 0
      var items = Array.isArray(result.items) ? result.items : []
      if (communityPage <= 1) {
        communityItems = items
      } else {
        var seen = {}
        for (var i = 0; i < communityItems.length; i++) seen[communityItems[i].fullName] = true
        for (var j = 0; j < items.length; j++) {
          if (!seen[items[j].fullName]) communityItems.push(items[j])
        }
      }
    }
    renderCommunity()
    if (communityDirty) { communityDirty = false; loadCommunity(true) }
  }

  window.__dshPluginsCmdResult = function (payload) {
    busy = false
    renderBusy()
    if (payload !== null && typeof payload === 'object') {
      appendLog('⏳ ' + payload.label + '…\\n' + payload.output + '\\n' + (payload.ok ? '✅ 完成（重启引擎后生效）' : '❌ 失败'))
    }
    latestAt = 0
    refreshInstalled()
    refreshLatest(installed.map(function (p) { return p.name }))
  }

  // ── 对话框挂载 / 激活切换（与 MCP 分区同款） ───────────────────
  function classes(elx) { return Array.from(elx.classList) }

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
      if (dialog !== null) { on = false; dialog = null; navList = null; refs = null }
      return
    }
    if (dlg !== dialog) {
      // 对话框重新挂载：重置激活态并请求新列表
      on = false
      busy = false
      dialog = dlg
      refs = null
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
      send({ op: 'list' })
      if (!communityTouched) loadCommunity(true)
    }

    // 样式（幂等）
    if (document.getElementById(CSS_ID) === null) {
      var style = document.createElement('style')
      style.id = CSS_ID
      style.textContent = [
        '#' + SEC_ID + ' { display: none; }',
        '[role="dialog"].' + MARKER + ' div[data-slot="settings.section"] { display: none !important; }',
        '[role="dialog"].' + MARKER + ' #' + SEC_ID + ' { display: block; }',
        '.dpi-lead { margin: 2px 0 16px; color: var(--dsw-alias-label-secondary, #888); font-size: 13px; line-height: 1.65; }',
        '.dpi-status { margin: 0 0 12px; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }',
        '.dpi-card { margin: 0 0 14px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l2, #e2e2e4); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, transparent); }',
        '.dpi-cardtitle { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); margin: 0 0 8px; }',
        '.dpi-count { font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-secondary, #888); margin-left: 6px; }',
        '.dpi-desc { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #888); margin: 0 0 10px; }',
        '.dpi-row { display: flex; gap: 8px; align-items: center; }',
        '.dpi-search { width: 100%; box-sizing: border-box; margin: 0 0 10px; padding: 6px 9px; border: 1px solid var(--dsw-alias-border-l3, #c8c8cc); border-radius: 7px; background: var(--dsw-alias-bg-layer-1, transparent); color: var(--dsw-alias-label-primary, #222); font-size: 12.5px; }',
        '.dpi-search:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #2f6fed); }',
        '.dpi-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }',
        '.dpi-table th { text-align: left; padding: 6px 8px; font-weight: 600; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #888); border-bottom: 1px solid var(--dsw-alias-border-l2, #e2e2e4); }',
        '.dpi-table td { padding: 7px 8px; border-bottom: 1px solid var(--dsw-alias-border-l3, #ececef); color: var(--dsw-alias-label-primary, #222); }',
        '.dpi-table tr:last-child td { border-bottom: none; }',
        '.dpi-emptyrow { color: var(--dsw-alias-label-tertiary, #999); font-size: 12px; }',
        '.dpi-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }',
        '.dpi-hasupdate { color: var(--dsw-alias-brand-primary, #2f6fed); font-weight: 600; }',
        '.dpi-link { cursor: pointer; color: var(--dsw-alias-brand-primary, #2f6fed); }',
        '.dpi-link:hover { text-decoration: underline; }',
        '.dpi-meta { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #888); margin: 2px 0 8px; }',
        '.dpi-log { max-height: 140px; overflow: auto; margin: 10px 0 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2, #e2e2e4); border-radius: 8px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06)); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; color: var(--dsw-alias-label-secondary, #888); }',
        '.dpi-btn { flex: none; font-size: 11px; line-height: 1; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l3, #c8c8cc); border-radius: 6px; background: var(--dsw-alias-bg-layer-2, #f6f7f8); color: var(--dsw-alias-label-secondary, #666); cursor: pointer; }',
        '.dpi-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); color: var(--dsw-alias-label-primary, #222); }',
        '.dpi-btn:disabled { opacity: .5; cursor: default; }',
        '.dpi-primary { flex: none; font-size: 11.5px; line-height: 1; padding: 7px 14px; border: none; border-radius: 6px; background: var(--dsw-alias-brand-primary, #2f6fed); color: var(--dsw-alias-label-primary-inverted, #fff); cursor: pointer; }',
        '.dpi-primary:hover:not(:disabled) { filter: brightness(1.08); }',
        '.dpi-primary:disabled { opacity: .5; cursor: default; }',
        '.dpi-danger { flex: none; font-size: 11px; line-height: 1; padding: 6px 10px; border: 1px solid rgba(229,72,77,.45); border-radius: 6px; background: transparent; color: #e5484d; cursor: pointer; }',
        '.dpi-danger:hover:not(:disabled) { background: rgba(229,72,77,.08); }',
        '.dpi-danger:disabled { opacity: .4; cursor: default; }'
      ].join('\\n')
      document.head.appendChild(style)
    }

    if (navList === null) return

    // 导航按钮（React 重渲染后重注入）
    if (document.getElementById(NAV_ID) === null) {
      var seeds = Array.from(navList.querySelectorAll('button'))
      var seed = seeds[seeds.length - 1]
      if (seed !== undefined) {
        var mine = seed.cloneNode(true)
        mine.id = NAV_ID
        mine.removeAttribute('aria-current')
        var label = mine.querySelector('span')
        if (label !== null) label.textContent = '插件管理'
        var oldIcon = mine.querySelector('svg')
        if (oldIcon !== null) oldIcon.replaceWith(navIcon(oldIcon))
        mine.addEventListener('click', function (ev) { ev.stopPropagation(); activate() })
        seed.parentNode.appendChild(mine)
      }
    }

    // 激活态再同步：上游按钮的 aria-current/active 类是 React 管理的，
    // 激活期间重渲染会被恢复 —— 每次 DOM 变化都重新压住
    if (on) activate()

    // 点击其他分区 → 让位（捕获期，React 各自处理自己的状态）
    if (dialog.getAttribute('data-dpi-nav') !== '1') {
      dialog.setAttribute('data-dpi-nav', '1')
      dialog.addEventListener('click', function (ev) {
        if (navList === null) return
        var btn = ev.target instanceof Element ? ev.target.closest('button') : null
        if (btn === null || !navList.contains(btn)) return
        if (btn.id === NAV_ID) return // 自己的点击已处理
        if (on) deactivate()
      }, true)
    }

    ensureSection(dlg)
  }

  var mo = new MutationObserver(function () { build() })
  mo.observe(document.body, { childList: true, subtree: true })
  build()
})()`

interface PagePayload {
  op?: unknown
  names?: unknown
  query?: unknown
  page?: unknown
  kind?: unknown
  pkg?: unknown
  label?: unknown
  url?: unknown
}

/**
 * 给 shell 窗口挂插件管理设置注入器：整页加载后注入页面脚本并推已装
 * 列表；console 通道接收 list/latest/community/cmd/restart/open。
 * 窗口销毁时监听随 webContents 消亡。
 */
export function attachPluginSettingsInjector(win: BrowserWindow): void {
  const { webContents } = win

  const push = (): void => {
    if (win.isDestroyed()) return
    void webContents.executeJavaScript(
      `window.__dshPluginsSync && window.__dshPluginsSync(${JSON.stringify(installedPlugins())})`,
      true,
    ).catch(() => {})
  }

  const replyLatest = (latest: LatestVersions): void => {
    if (win.isDestroyed()) return
    void webContents.executeJavaScript(
      `window.__dshPluginsLatest && window.__dshPluginsLatest(${JSON.stringify(latest)})`,
      true,
    ).catch(() => {})
  }

  const replyCommunity = (result: CommunityQueryResult): void => {
    if (win.isDestroyed()) return
    void webContents.executeJavaScript(
      `window.__dshPluginsCommunity && window.__dshPluginsCommunity(${JSON.stringify(result)})`,
      true,
    ).catch(() => {})
  }

  const replyCmd = (label: string, result: PluginCommandResult): void => {
    if (win.isDestroyed()) return
    void webContents.executeJavaScript(
      `window.__dshPluginsCmdResult && window.__dshPluginsCmdResult(${JSON.stringify({ label, ok: result.ok, output: result.output })})`,
      true,
    ).catch(() => {})
  }

  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(PREFIX) || win.isDestroyed()) return
    let payload: PagePayload
    try { payload = JSON.parse(message.slice(PREFIX.length)) as PagePayload } catch { return }

    if (payload.op === 'list') {
      push()
      return
    }
    if (payload.op === 'latest' && Array.isArray(payload.names)) {
      const names = payload.names.filter((n): n is string => typeof n === 'string')
      latestVersions(names).then(replyLatest).catch(() => replyLatest({}))
      return
    }
    if (payload.op === 'community') {
      const query = typeof payload.query === 'string' ? payload.query : ''
      const page = typeof payload.page === 'number' ? payload.page : 1
      communityPlugins(query, page).then(replyCommunity).catch(() => {})
      return
    }
    if (payload.op === 'cmd' && typeof payload.pkg === 'string' && typeof payload.label === 'string') {
      const { pkg, label } = payload
      const kind = payload.kind
      const run = kind === 'update'
        ? updatePlugin(pkg)
        : runPluginCommand([kind === 'remove' ? 'remove' : 'add', pkg])
      run
        .then((result) => { replyCmd(label, result); if (result.ok) push() })
        .catch((error: unknown) => { replyCmd(label, { ok: false, output: String(error) }) })
      return
    }
    if (payload.op === 'restart') {
      const label = typeof payload.label === 'string' ? payload.label : '重启引擎'
      dshManager.restart()
      replyCmd(label, { ok: true, output: '重启请求已发出，就绪后自动回到主界面' })
      return
    }
    if (payload.op === 'open' && typeof payload.url === 'string' && payload.url.startsWith('https://github.com/')) {
      void shell.openExternal(payload.url).catch(() => {})
    }
  }

  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', () => {
    void webContents.executeJavaScript(PAGE_JS, true).then(push).catch(() => {})
  })
}
