/**
 * 技能设置注入器：把「技能」分区注入上游设置对话框（侧边栏底部设置
 * 按钮打开的 modal）——与上游自带分区（通用/模型/插件…）并列，但
 * 数据与语义独立（技能=提示词能力包；插件=引擎组成层）。
 *
 * 上游契约（零侵入、只读 DOM）：
 * - 对话框：SettingsRoot 的 SettingsPanel——div[role="dialog"] 内
 *   nav > navTitle + navList（按钮=分区导航，css.active 哈希类 +
 *   aria-current 标激活），内容区 div[data-slot="settings.section"]
 *   外的父容器（SlotOutlet 的锚点包裹，属性稳定）；
 * - 注入物：navList 尾部克隆一个按钮（标签改「技能」），内容区追加
 *   自绘容器；激活态用对话框级 marker 类切换（CSS 隐藏 React 分区、
 *   显示自绘容器），点其他分区恢复——React 状态不感知，重渲染由
 *   MutationObserver 自愈重注入；
 * - React 重渲染会移除注入节点 → observer 重建；对话框重新打开 →
 *   检测 dialog 元素更换，重置为非激活态。
 *
 * 通信（console 通道，同 style-settings / attach-picker）：
 * - 页面 → 主进程：console.log('__dsh_skills__:' + JSON 载荷)
 *   {op:'cat'} 请求目录 / {op:'body', path} 请求正文 /
 *   {op:'enable', path} 启用 optional 技能（拷到用户目录）；
 * - 主进程 → 页面：executeJavaScript 调 window.__dshSkillsSync(groups)
 *   / window.__dshSkillsBody(path, text) / window.__dshSkillsEnabled(path, ok)
 *   （正文/启用均白名单）.
 *
 * @module desktop/main/skills-settings
 */

import type { BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { enableOptionalSkill, listSkills, readSkillBody } from './skills-catalog'
import { MEDIA_MODEL_GROUPS, readMediaModelEnv, writeMediaModelEnv } from './media-models'

/** console 通道前缀。 */
const PREFIX = '__dsh_skills__:'

/** 注入脚本（页面上下文执行；纯 JS：无模板字面量、反引号转义）。 */
const PAGE_JS = `(() => {
  if (window.__dshSkillsWired) return
  window.__dshSkillsWired = true

  var CSS_ID = '__dsh_desktop_skills_css'
  var NAV_ID = '__dsh_desktop_skills_nav'
  var SEC_ID = '__dsh_desktop_skills_section'
  var MARKER = '__dsh_sk_on'
  var PREFIX = '__dsh_skills__:'

  var groups = []
  // 多媒体模型分组定义（静态字段表，编译期插值；已存值运行时推送）
  var MEDIA = ${JSON.stringify(MEDIA_MODEL_GROUPS)}
  var mediaVals = {}
  var dialog = null     // 当前挂载的设置对话框
  var navList = null
  var activeExtra = []  // 哈希激活类（激活按钮类集 - 普通按钮类集）
  var on = false

  // ── 迷你 markdown 渲染（escape 先行；与预览抽屉同款白名单） ──────────
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  function inline(s) {
    var o = esc(s)
    o = o.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>')
    o = o.replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, function (m, t, u) {
      var url = u.replace(/&amp;/g, '&')
      if (!/^(https?:\\/\\/|#|\\/|\\.\\/)/.test(url)) return m
      return '<a href="' + u + '" target="_blank" rel="noreferrer">' + t + '</a>'
    })
    o = o.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
    o = o.replace(/(^|[^*])\\*([^*][^*]*?)\\*/g, '$1<em>$2</em>')
    o = o.replace(/~~([^~]+)~~/g, '<del>$1</del>')
    return o
  }
  function md(src) {
    var lines = src.split('\\n')
    var out = [], para = [], quote = [], code = null, list = null, table = []
    function fP() { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = [] } }
    function fQ() { if (quote.length) { out.push('<blockquote>' + inline(quote.join(' ')) + '</blockquote>'); quote = [] } }
    function fL() { if (list) { out.push('</' + list.tag + '>'); list = null } }
    function fT() {
      if (!table.length) return
      var rows = table.map(function (r) {
        return r.trim().replace(/^\\|/, '').replace(/\\|$/, '').split('|').map(function (c) { return c.trim() })
      })
      table = []
      var head = rows.length > 1 && rows[1].every(function (c) { return /^:?-+:?$/.test(c) }) ? rows[0] : null
      var bodyRows = head ? rows.slice(2) : rows
      var html = '<table>'
      if (head) html += '<thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>' }).join('') + '</tr></thead>'
      html += '<tbody>' + bodyRows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>' }).join('') + '</tr>'
      }).join('') + '</tbody></table>'
      out.push(html)
    }
    function flush() { fP(); fQ(); fL(); fT() }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      if (code !== null) {
        if (/^\\s*\\\`\\\`\\\`/.test(line)) { out.push('<pre><code>' + esc(code.join('\\n')) + '</code></pre>'); code = null }
        else code.push(line)
        continue
      }
      if (/^\\s*\\\`\\\`\\\`/.test(line)) { flush(); code = []; continue }
      var hm = /^(#{1,6}) (.*)$/.exec(line)
      if (hm) { flush(); var n = hm[1].length; out.push('<h' + n + '>' + inline(hm[2]) + '</h' + n + '>'); continue }
      if (/^\\s*(---+|\\*\\*\\*+|___+)\\s*$/.test(line)) { flush(); out.push('<hr>'); continue }
      var qm = /^> ?(.*)$/.exec(line)
      if (qm) { fP(); fL(); fT(); quote.push(qm[1]); continue }
      if (/^\\|.*\\|\\s*$/.test(line)) { fP(); fQ(); fL(); table.push(line); continue }
      fT()
      var task = /^[-*] \\[( |x|X)\\] (.*)$/.exec(line)
      if (task) {
        fP(); fQ()
        if (!list || list.tag !== 'ul') { fL(); list = { tag: 'ul' }; out.push('<ul>') }
        out.push('<li class="dsk-task"><span class="dsk-box' + (task[1] !== ' ' ? ' on' : '') + '"></span>' + inline(task[2]) + '</li>')
        continue
      }
      var ulm = /^[-*] (.+)$/.exec(line)
      if (ulm) {
        fP(); fQ()
        if (!list || list.tag !== 'ul') { fL(); list = { tag: 'ul' }; out.push('<ul>') }
        out.push('<li>' + inline(ulm[1]) + '</li>')
        continue
      }
      var olm = /^\\d+\\. (.+)$/.exec(line)
      if (olm) {
        fP(); fQ()
        if (!list || list.tag !== 'ol') { fL(); list = { tag: 'ol' }; out.push('<ol>') }
        out.push('<li>' + inline(olm[1]) + '</li>')
        continue
      }
      if (line.trim() === '') { flush(); continue }
      fQ()
      para.push(line)
    }
    flush()
    if (code !== null) out.push('<pre><code>' + esc(code.join('\\n')) + '</code></pre>')
    return out.join('\\n')
  }

  // ── 目录数据 → DOM ─────────────────────────────────────────────
  var SUBS = {
    builtin: '随 KCoder 分发并已注册生效的方法论技能（@kcoder/skills-bundle，随版本更新）。',
    project: '当前工作区 .dsh/skills 与 .agents/skills 目录（优先级最高，可覆盖同名内置技能）。',
    user: '用户级技能目录：$DSH_HOME/skills 与 ~/.agents/skills（后者为跨工具共享目录，Claude Code 等同样读取）。',
    optional: '随包分发但未启用的长尾技能（不占会话上下文）。点行尾「启用」按钮装到用户目录；新开会话后 agent 可用。'
  }
  var BADGE = { builtin: 'KCoder', project: '工作区', user: '用户', shared: '共享目录', optional: '未启用' }

  function send(payload) { console.log(PREFIX + JSON.stringify(payload)) }

  function rowEl(e) {
    var row = document.createElement('div')
    row.className = 'dsk-row'
    row.setAttribute('data-path', e.path)
    row.title = e.description + '\\n' + e.path
    var x = document.createElement('span'); x.className = 'dsk-x'; x.textContent = '\\u25B8'
    var badge = document.createElement('span')
    badge.className = 'dsk-badge' + (e.source === 'builtin' ? ' kc' : '')
    badge.textContent = BADGE[e.source] || e.source
    var name = document.createElement('span'); name.className = 'dsk-name'; name.textContent = e.name
    var desc = document.createElement('span'); desc.className = 'dsk-desc'; desc.textContent = e.description
    row.append(x, badge, name, desc)
    // optional 行尾「启用」按钮：主进程代拷到 ~/.dsh/skills/<name>/，
    // 免手动命令行（cp -R 目标不存在时的分叉坑）；成功后目录整体刷新，
    // 该行跳到用户全局区
    if (e.source === 'optional') {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'dsk-enable'
      btn.textContent = '\u542F\u7528'
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation()
        if (btn.disabled) return
        btn.disabled = true
        btn.textContent = '\u542F\u7528\u4E2D\u2026'
        send({ op: 'enable', path: e.path })
      })
      row.append(btn)
    }
    var body = document.createElement('div')
    body.className = 'dsk-body'
    row.addEventListener('click', function () {
      var opening = !row.classList.contains('on')
      row.classList.toggle('on', opening)
      if (!opening) return
      if (!body.firstChild) {
        var loading = document.createElement('div')
        loading.className = 'dsk-md'; loading.textContent = '读取中…'
        body.appendChild(loading)
        send({ op: 'body', path: e.path })
      }
    })
    var frag = document.createDocumentFragment()
    frag.append(row, body)
    return frag
  }

  // ── 多媒体模型配置区（面板顶部，内置 media 技能的凭据入口） ──────
  function saveMedia() {
    var btn = document.getElementById('dsk-media-save')
    if (btn === null || btn.disabled) return
    btn.disabled = true
    btn.textContent = '\u4fdd\u5b58\u4e2d\u2026'
    var vals = {}
    var inputs = document.querySelectorAll('#' + SEC_ID + ' .dsk-mf-i')
    for (var i = 0; i < inputs.length; i++) {
      vals[inputs[i].getAttribute('data-key')] = inputs[i].value
    }
    send({ op: 'media-save', values: vals })
  }

  function renderMedia(sec) {
    var box = document.createElement('div')
    box.className = 'dsk-group'
    var title = document.createElement('div')
    title.className = 'dsk-gtitle'
    var filled = 0
    for (var g = 0; g < MEDIA.length; g++) {
      for (var i = 0; i < MEDIA[g].fields.length; i++) {
        if ((mediaVals[MEDIA[g].fields[i].key] || '') !== '') filled++
      }
    }
    title.textContent = '\u591a\u5a92\u4f53\u6a21\u578b' + (filled > 0 ? ' (\u5df2\u914d\u7f6e ' + filled + ' \u9879)' : '')
    var sub = document.createElement('div')
    sub.className = 'dsk-gsub'
    sub.textContent = '\u5185\u7f6e\u591a\u5a92\u4f53\u6280\u80fd\uff08\u56fe\u50cf / \u89c6\u9891 / \u97f3\u4e50 / \u64ad\u5ba2\uff09\u7684\u751f\u6210\u6a21\u578b\u51ed\u636e\u3002' +
      '\u4fdd\u5b58\u5230 $DSH_HOME/media-models.env\uff0c\u968f dsh \u5f15\u64ce\u542f\u52a8\u6ce8\u5165\u8fdb\u7a0b\u73af\u5883\uff1b\u4fee\u6539\u540e\u91cd\u542f\u5f15\u64ce\u751f\u6548\u3002' +
      '\u7559\u7a7a\u5219\u7528\u811a\u672c\u5185\u7f6e\u9ed8\u8ba4\u503c\uff1b\u540c\u7ec4\u5185\u6309\u811a\u672c\u4f18\u5148\u7ea7\u81ea\u52a8\u9009\u62e9\u5df2\u914d\u7f6e\u7684 provider\u3002'
    box.append(title, sub)
    for (var m = 0; m < MEDIA.length; m++) {
      var grp = MEDIA[m]
      var card = document.createElement('div')
      card.className = 'dsk-mg'
      var filledInGroup = 0
      for (var k = 0; k < grp.fields.length; k++) {
        if ((mediaVals[grp.fields[k].key] || '') !== '') filledInGroup++
      }
      if (filledInGroup > 0) card.classList.add('on')
      var head = document.createElement('div')
      head.className = 'dsk-mg-h'
      var hx = document.createElement('span'); hx.className = 'dsk-x'; hx.textContent = '\u25B8'
      var ht = document.createElement('span'); ht.className = 'dsk-mg-t'; ht.textContent = grp.title
      head.append(hx, ht)
      if (filledInGroup > 0) {
        var cnt = document.createElement('span'); cnt.className = 'dsk-mg-cnt'
        cnt.textContent = '\u5df2\u914d\u7f6e ' + filledInGroup
        head.appendChild(cnt)
      }
      head.addEventListener('click', function () { this.parentElement.classList.toggle('on') })
      var body = document.createElement('div')
      body.className = 'dsk-mg-b'
      var hnote = document.createElement('div')
      hnote.className = 'dsk-mg-note'
      hnote.textContent = grp.note
      body.appendChild(hnote)
      for (var j = 0; j < grp.fields.length; j++) {
        var f = grp.fields[j]
        var row = document.createElement('label')
        row.className = 'dsk-mf'
        var lab = document.createElement('span'); lab.className = 'dsk-mf-l'; lab.textContent = f.label
        var inp = document.createElement('input')
        inp.className = 'dsk-mf-i'
        inp.type = f.secret ? 'password' : 'text'
        inp.placeholder = f.placeholder
        inp.setAttribute('data-key', f.key)
        inp.value = mediaVals[f.key] || ''
        inp.spellcheck = false
        inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') saveMedia() })
        row.append(lab, inp)
        body.appendChild(row)
      }
      card.append(head, body)
      box.appendChild(card)
    }
    var actions = document.createElement('div')
    actions.className = 'dsk-media-actions'
    var btn = document.createElement('button')
    btn.type = 'button'
    btn.id = 'dsk-media-save'
    btn.className = 'dsk-media-save'
    btn.textContent = '\u4fdd\u5b58'
    btn.addEventListener('click', saveMedia)
    var ok = document.createElement('span'); ok.className = 'dsk-media-ok'; ok.id = 'dsk-media-ok'
    actions.append(btn, ok)
    box.appendChild(actions)
    sec.appendChild(box)
  }

  function render() {
    var sec = document.getElementById(SEC_ID)
    if (sec === null) return
    sec.replaceChildren()
    var lead = document.createElement('div')
    lead.className = 'dsk-lead'
    lead.textContent = '技能是提示词能力包：模型按描述自动匹配加载，或在输入框用 /名称 调用。' +
      '插件（AgentLoop / Bash / WebSearch / 视觉路由等通用工具）在「插件」分区管理。' +
      '同名技能生效优先级：工作区 > KCoder 内置 > 用户全局。'
    sec.appendChild(lead)
    renderMedia(sec)
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g]
      var section = document.createElement('div')
      section.className = 'dsk-group'
      var title = document.createElement('div')
      title.className = 'dsk-gtitle'
      title.textContent = grp.title + (grp.entries.length > 0 ? ' (' + grp.entries.length + ')' : '')
      var sub = document.createElement('div')
      sub.className = 'dsk-gsub'
      sub.textContent = SUBS[grp.id] || ''
      section.append(title, sub)
      if (grp.entries.length === 0) {
        var empty = document.createElement('div')
        empty.className = 'dsk-gsub'; empty.textContent = '（无）'
        section.appendChild(empty)
      }
      for (var i = 0; i < grp.entries.length; i++) section.appendChild(rowEl(grp.entries[i]))
      sec.appendChild(section)
    }
  }

  /** 主进程 → 页面：目录推送。 */
  window.__dshSkillsSync = function (data) {
    groups = Array.isArray(data) ? data : []
    render()
  }

  /** 主进程 → 页面：多媒体模型已存值推送（与目录同步触发全量重绘）。 */
  window.__dshSkillsMediaValues = function (vals) {
    mediaVals = vals && typeof vals === 'object' ? vals : {}
    render()
  }

  /** 主进程 → 页面：保存应答（按钮反馈；重绘由目录/值推送完成）。 */
  window.__dshSkillsMediaSaved = function (ok) {
    var btn = document.getElementById('dsk-media-save')
    var tip = document.getElementById('dsk-media-ok')
    if (btn !== null) {
      btn.disabled = false
      btn.textContent = '\u4fdd\u5b58'
    }
    if (tip !== null) {
      tip.textContent = ok
        ? '\u5df2\u4fdd\u5b58\u2713 \u91cd\u542f\u5f15\u64ce\u540e\u751f\u6548'
        : '\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5'
      if (tip.timer !== undefined) clearTimeout(tip.timer)
      tip.timer = setTimeout(function () { tip.textContent = '' }, 4000)
    }
  }

  /** 主进程 → 页面：启用应答（失败提示回按钮；成功路径无需处理——
     目录刷新后该行已跳到用户区，按钮随行重建）。 */
  window.__dshSkillsEnabled = function (path, ok) {
    if (ok) return
    var row = document.querySelector('#' + SEC_ID + ' .dsk-row[data-path=' + JSON.stringify(path) + ']')
    var btn = row !== null ? row.querySelector('.dsk-enable') : null
    if (btn !== null) {
      btn.disabled = false
      btn.textContent = '\u5931\u8D25\uFF0C\u91CD\u8BD5'
    }
  }

  /** 主进程 → 页面：正文应答（按 data-path 找行）。 */
  window.__dshSkillsBody = function (path, text) {
    var row = document.querySelector('#' + SEC_ID + ' .dsk-row[data-path=' + JSON.stringify(path) + ']')
    if (row === null) return
    var body = row.nextElementSibling
    if (body === null || !body.classList.contains('dsk-body')) return
    body.replaceChildren()
    if (typeof text !== 'string') {
      var fail = document.createElement('div')
      fail.className = 'dsk-md'; fail.textContent = '（正文读取失败）'
      body.appendChild(fail)
      return
    }
    var wrap = document.createElement('div')
    wrap.className = 'dsk-md'
    wrap.innerHTML = md(text) // 安全：渲染器内部全量 escape
    body.appendChild(wrap)
  }

  // ── 对话框挂载 / 激活切换 ───────────────────────────────────────
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
      // 对话框重新挂载（上次关闭后重开）：重置状态并请求新目录
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
      send({ op: 'cat' })
    }

    // 样式（幂等）
    if (document.getElementById(CSS_ID) === null) {
      var style = document.createElement('style')
      style.id = CSS_ID
      style.textContent = [
        '#' + SEC_ID + ' { display: none; }',
        // settings-page 会把右侧内容统一限宽；带 options 祖先的选择器
        // 确保技能激活时原生 React 分区始终被隐藏，不与自绘列表叠加。
        '[role="dialog"].' + MARKER + ' [class*="_options"] > div[data-slot="settings.section"] { display: none !important; }',
        '[role="dialog"].' + MARKER + ' #' + SEC_ID + ' { display: block; width: 100%; max-width: 960px; margin: 0 auto; box-sizing: border-box; }',
        '.dsk-lead { margin: 2px 0 20px; color: var(--dsw-alias-label-secondary, #888); font-size: 13px; line-height: 1.65; }',
        '.dsk-group { margin: 0 0 26px; }',
        '.dsk-gtitle { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); margin: 0 0 4px; }',
        '.dsk-gsub { font-size: 12px; color: var(--dsw-alias-label-tertiary, #999); margin: 0 0 10px; }',
        '.dsk-row { display: flex; align-items: baseline; gap: 10px; padding: 10px 12px; border-radius: 10px; cursor: pointer; }',
        '.dsk-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1)); }',
        '.dsk-row .dsk-x { flex: none; color: var(--dsw-alias-label-tertiary, #999); font-size: 10px; transition: transform .12s ease; }',
        '.dsk-row.on .dsk-x { transform: rotate(90deg); }',
        '.dsk-badge { flex: none; font-size: 10px; line-height: 1; padding: 3px 7px; border-radius: 5px; background: var(--dsw-alias-bg-layer-2, #eee); color: var(--dsw-alias-label-secondary, #666); }',
        '.dsk-badge.kc { background: var(--dsw-alias-brand-primary, #2f6fed); color: var(--dsw-alias-label-primary-inverted, #fff); }',
        '.dsk-row .dsk-name { flex: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: var(--dsw-alias-label-primary, #222); }',
        '.dsk-row .dsk-desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }',
        '.dsk-enable { flex: none; margin-left: 8px; font-size: 11px; line-height: 1; padding: 5px 10px; border: 1px solid var(--dsw-alias-border-l3, #c8c8cc); border-radius: 6px; background: var(--dsw-alias-bg-layer-2, #f6f7f8); color: var(--dsw-alias-label-secondary, #666); cursor: pointer; }',
        '.dsk-enable:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); color: var(--dsw-alias-label-primary, #222); }',
        '.dsk-enable:disabled { opacity: .55; cursor: default; }',
        '.dsk-row.on + .dsk-body { display: block; }',
        '.dsk-body { display: none; margin: 2px 12px 14px; border: 1px solid var(--dsw-alias-border-l2, #e2e2e4); border-radius: 10px; padding: 6px 18px 16px; max-height: 420px; overflow: auto; }',
        '.dsk-md { font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-primary, #222); }',
        '.dsk-md h1, .dsk-md h2, .dsk-md h3, .dsk-md h4 { margin: 16px 0 8px; line-height: 1.35; }',
        '.dsk-md h1 { font-size: 18px; padding-bottom: 6px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e2e2e4); }',
        '.dsk-md h2 { font-size: 16px; padding-bottom: 5px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e2e2e4); }',
        '.dsk-md h3 { font-size: 14px; } .dsk-md h4 { font-size: 13px; }',
        '.dsk-md p { margin: 8px 0; }',
        '.dsk-md ul, .dsk-md ol { margin: 8px 0; padding-left: 22px; }',
        '.dsk-md li.dsk-task { list-style: none; margin-left: -18px; }',
        '.dsk-box { display: inline-block; width: 13px; height: 13px; margin-right: 7px; border: 1px solid var(--dsw-alias-border-l3, #c8c8cc); border-radius: 3px; vertical-align: -2px; }',
        '.dsk-box.on { background: var(--dsw-alias-brand-primary, #2f6fed); border-color: transparent; position: relative; }',
        '.dsk-box.on::after { content: ""; position: absolute; left: 4px; top: 1px; width: 3px; height: 7px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }',
        '.dsk-md blockquote { margin: 8px 0; padding: 2px 0 2px 12px; border-left: 3px solid var(--dsw-alias-border-l3, #c8c8cc); color: var(--dsw-alias-label-secondary, #888); }',
        '.dsk-md pre { margin: 8px 0; padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #f6f7f8); overflow: auto; font-size: 12px; line-height: 1.6; }',
        '.dsk-md code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }',
        '.dsk-md :not(pre) > code { background: var(--dsw-alias-bg-layer-2, #f0f0f2); padding: 1px 5px; border-radius: 4px; }',
        '.dsk-md table { border-collapse: collapse; margin: 8px 0; font-size: 12px; }',
        '.dsk-md th, .dsk-md td { border: 1px solid var(--dsw-alias-border-l2, #e2e2e4); padding: 5px 10px; text-align: left; }',
        '.dsk-md th { background: var(--dsw-alias-bg-layer-2, #f6f7f8); }',
        '.dsk-md hr { border: none; border-top: 1px solid var(--dsw-alias-border-l2, #e2e2e4); margin: 14px 0; }',
        '.dsk-md a { color: var(--dsw-alias-brand-primary, #2f6fed); }',
        '.dsk-mg { margin: 0 0 10px; border: 1px solid var(--dsw-alias-border-l2, #e2e2e4); border-radius: 10px; overflow: hidden; }',
        '.dsk-mg-h { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; user-select: none; }',
        '.dsk-mg-h:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); }',
        // 卡头单行稳定：标题不压缩不换行（内容区实际仅 ~525px，标题+说明同行会互相挤压折成多行）；
        // 说明文字（note）移展开体首行，右侧换「已配置」徽标
        '.dsk-mg-t { flex: none; font-size: 13px; font-weight: 600; white-space: nowrap; color: var(--dsw-alias-label-primary, #222); }',
        '.dsk-mg-cnt { flex: none; margin-left: auto; font-size: 10px; line-height: 1; padding: 3px 7px; border-radius: 5px; background: var(--dsw-alias-bg-layer-2, #eee); color: var(--dsw-alias-label-secondary, #666); }',
        '.dsk-mg-h .dsk-x { font-size: 10px; color: var(--dsw-alias-label-tertiary, #999); transition: transform .12s ease; }',
        '.dsk-mg.on .dsk-mg-h .dsk-x { transform: rotate(90deg); }',
        '.dsk-mg-b { display: none; padding: 4px 12px 12px; border-top: 1px solid var(--dsw-alias-border-l2, #e2e2e4); }',
        '.dsk-mg.on .dsk-mg-b { display: block; }',
        '.dsk-mg-note { font-size: 11px; line-height: 1.55; color: var(--dsw-alias-label-tertiary, #999); margin: 8px 0 4px; }',
        '.dsk-mf { display: flex; align-items: center; gap: 8px; margin: 7px 0; }',
        '.dsk-mf-l { flex: none; width: 118px; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); text-align: right; }',
        '.dsk-mf-i { flex: 1; min-width: 0; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; padding: 5px 9px; border: 1px solid var(--dsw-alias-border-l3, #c8c8cc); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #222); outline: none; }',
        '.dsk-mf-i:focus { border-color: var(--dsw-alias-brand-primary, #2f6fed); }',
        '.dsk-media-actions { display: flex; align-items: center; gap: 10px; padding: 4px 0 2px; }',
        '.dsk-media-save { font-size: 12px; line-height: 1; padding: 7px 14px; border: none; border-radius: 6px; background: var(--dsw-alias-brand-primary, #2f6fed); color: var(--dsw-alias-label-primary-inverted, #fff); cursor: pointer; }',
        '.dsk-media-save:hover { opacity: .88; }',
        '.dsk-media-save:disabled { opacity: .55; cursor: default; }',
        '.dsk-media-ok { font-size: 12px; color: var(--dsw-alias-label-tertiary, #999); }'
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
        if (label !== null) label.textContent = '\u6280\u80FD'
        mine.addEventListener('click', function (ev) { ev.stopPropagation(); activate() })
        seed.parentNode.appendChild(mine)
      }
    }
    
    // 激活态再同步：上游按钮的 aria-current/active 类是 React 管理的，
    // 若激活期间发生重渲染会被恢复 —— 每次 DOM 变化都重新压住
    if (on) activate()

    // 点击其他分区 → 让位（捕获期，React 各自处理自己的状态）
    if (dialog.getAttribute('data-dsk-nav') !== '1') {
      dialog.setAttribute('data-dsk-nav', '1')
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
 * 给 shell 窗口挂技能设置注入器：整页加载后注入页面脚本并推当前目录；
 * console 通道接收目录/正文请求（正文走 readSkillBody 白名单）。
 * 窗口销毁时监听随 webContents 消亡。
 */
export function attachSkillsSettingsInjector(win: BrowserWindow): void {
  const { webContents } = win

  const push = (): void => {
    if (win.isDestroyed()) return
    void webContents.executeJavaScript(
      `window.__dshSkillsSync && window.__dshSkillsSync(${JSON.stringify(listSkills())})`,
      true,
    ).catch(() => {})
    void webContents.executeJavaScript(
      `window.__dshSkillsMediaValues && window.__dshSkillsMediaValues(${JSON.stringify(readMediaModelEnv())})`,
      true,
    ).catch(() => {})
  }

  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(PREFIX) || win.isDestroyed()) return
    let payload: { op?: unknown; path?: unknown; values?: unknown }
    try { payload = JSON.parse(message.slice(PREFIX.length)) as { op?: unknown; path?: unknown; values?: unknown } } catch { return }
    if (payload.op === 'cat') {
      push()
      return
    }
    if (payload.op === 'body' && typeof payload.path === 'string') {
      const text = readSkillBody(payload.path)
      void webContents.executeJavaScript(
        `window.__dshSkillsBody && window.__dshSkillsBody(${JSON.stringify(payload.path)}, ${JSON.stringify(text)})`,
        true,
      ).catch(() => {})
      return
    }
    if (payload.op === 'media-save') {
      let ok = false
      if (payload.values !== null && typeof payload.values === 'object') {
        try {
          writeMediaModelEnv(payload.values as Record<string, string>)
          ok = true
        } catch { ok = false }
      }
      void webContents.executeJavaScript(
        `window.__dshSkillsMediaSaved && window.__dshSkillsMediaSaved(${ok})`,
        true,
      ).catch(() => {})
      if (ok) push() // 已配置计数/默认展开态随新值重绘
      return
    }
    if (payload.op === 'enable' && typeof payload.path === 'string') {
      const ok = enableOptionalSkill(payload.path)
      void webContents.executeJavaScript(
        `window.__dshSkillsEnabled && window.__dshSkillsEnabled(${JSON.stringify(payload.path)}, ${JSON.stringify(ok)})`,
        true,
      ).catch(() => {})
      if (ok) push() // 目录刷新：该行跳到用户全局区
    }
  }

  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', () => {
    void webContents.executeJavaScript(PAGE_JS, true).then(push).catch(() => {})
  })
}
