/**
 * MCP 设置注入器：把「MCP 服务器」分区注入上游设置对话框（侧边栏底部
 * 设置按钮打开的 modal）——与「技能」分区同款机制（见 skills-settings）。
 *
 * 管理对象是 cordis.patch.yml 里的 `@deepseek-ai/dsh-mcp-client` 实例
 * （每个实例 = 一个外部 MCP 服务器，工具以 mcp__<serverName>__* 注册）。
 * 保存即写 patch 文件，上游 HMR 热加载断开重连——无需重启引擎。
 *
 * 上游契约（零侵入、只读 DOM）：与技能分区完全一致——navList 尾部克隆
 * 导航按钮，内容区挂 settings.section 锚点的父级，对话框级 marker 类
 * 切换显隐，MutationObserver 自愈重注入。
 *
 * 通信（console 通道，同 skills-settings / style-settings）：
 * - 页面 → 主进程：console.log('__dsh_mcp__:' + JSON 载荷)
 *   {op:'list'} 请求列表 / {op:'save', entry} 新增或改写 /
 *   {op:'delete', id} 删除；
 * - 主进程 → 页面：executeJavaScript 调 window.__dshMcpSync(servers)
 *   / window.__dshMcpSaved(result)（save/delete 应答，成功后列表必刷）。
 *
 * @module desktop/main/mcp-settings
 */

import type { BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { mcpServerDelete, mcpServerSave, mcpServers, type McpServerEntry } from './mcp-store'
import { BUILTIN_MCP_SERVERS } from './mcp-builtin'

/** console 通道前缀。 */
const PREFIX = '__dsh_mcp__:'

/** 注入脚本（页面上下文执行；纯 JS：无模板字面量、反引号转义）。 */
const PAGE_JS = `(() => {
  if (window.__dshMcpWired) return
  window.__dshMcpWired = true

  var CSS_ID = '__dsh_desktop_mcp_css'
  var NAV_ID = '__dsh_desktop_mcp_nav'
  var SEC_ID = '__dsh_desktop_mcp_section'
  var MARKER = '__dsh_mc_on'
  var PREFIX = '__dsh_mcp__:'

  var servers = []
  var editing = null    // 编辑中条目（null = 列表态）
  var isNew = false
  var dialog = null
  var navList = null
  var activeExtra = []
  var on = false
  var status = ''       // 行内状态/错误行（sync 时清空）
  var formRefs = null   // 表单控件引用（表单打开时非空）
  var builtinNames = [] // 内置服务器名称列表（来自 mcp-builtin）

  function send(payload) { console.log(PREFIX + JSON.stringify(payload)) }

  // ── 键值行 ↔ 记录（env / headers 编辑用） ─────────────────────
  function parsePairs(text) {
    var out = {}
    var lines = String(text).split('\\n')
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim()
      if (t === '') continue
      var eq = t.indexOf('=')
      if (eq <= 0) continue
      out[t.slice(0, eq)] = t.slice(eq + 1)
    }
    return out
  }
  function pairsText(rec) {
    var parts = []
    for (var k in rec) parts.push(k + '=' + rec[k])
    return parts.join('\\n')
  }
  function blankEntry() {
    return {
      id: '', serverName: '', transport: 'stdio', enabled: true,
      command: '', args: [], env: {}, cwd: '', url: '', headers: {},
      toolCallTimeoutMs: null,
    }
  }

  // ── DOM 构建 ──────────────────────────────────────────────────
  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined) n.textContent = text
    return n
  }
  function field(labelText, input) {
    var w = el('div', 'dmi-fw')
    var lb = el('label', '', labelText)
    w.append(lb, input)
    return w
  }
  function textInput(value, placeholder) {
    var i = el('input', 'dmi-in')
    i.type = 'text'
    i.value = value
    i.placeholder = placeholder
    return i
  }
  function areaInput(value, placeholder) {
    var a = el('textarea', 'dmi-in dmi-ta')
    a.value = value
    a.placeholder = placeholder
    return a
  }

  /** 编辑表单（行内展开；radio 切 stdio/http 两组字段）。 */
  function buildForm(e) {
    var f = {}
    f.name = textInput(e.serverName, '例如 filesystem（字母/数字/_/-，≤32 位）')
    if (builtinNames.indexOf(e.serverName) >= 0) { f.name.disabled = true; f.name.classList.add('dmi-ro') }

    var stdioRadio = el('input', 'dmi-radio'); stdioRadio.type = 'radio'
    stdioRadio.name = 'dmi-transport'; stdioRadio.value = 'stdio'
    stdioRadio.checked = e.transport !== 'streamable-http'
    var httpRadio = el('input', 'dmi-radio'); httpRadio.type = 'radio'
    httpRadio.name = 'dmi-transport'; httpRadio.value = 'streamable-http'
    httpRadio.checked = e.transport === 'streamable-http'
    var radios = el('div', 'dmi-radios')
    var l1 = el('label', '', ''); l1.append(stdioRadio, document.createTextNode('stdio（本地命令）'))
    var l2 = el('label', '', ''); l2.append(httpRadio, document.createTextNode('streamable-http（服务器 URL）'))
    radios.append(l1, l2)

    f.command = textInput(e.command, '例如 npx')
    f.args = textInput(e.args.join(' '), '空格分隔，例如 -y @modelcontextprotocol/server-filesystem')
    f.cwd = textInput(e.cwd, '可选，子进程工作目录')
    f.env = areaInput(pairsText(e.env), '每行一个 KEY=VALUE')
    f.url = textInput(e.url, 'http://localhost:3000/mcp')
    f.headers = areaInput(pairsText(e.headers), '每行一个 KEY=VALUE，例如 Authorization=Bearer xxx')
    f.timeout = el('input', 'dmi-in'); f.timeout.type = 'number'
    f.timeout.value = e.toolCallTimeoutMs === null ? '' : String(e.toolCallTimeoutMs)
    f.timeout.placeholder = '默认 60000'

    var stdioGroup = el('div', 'dmi-fgroup')
    var r1 = el('div', 'dmi-fr'); r1.append(field('命令', f.command), field('参数（空格分隔）', f.args))
    var r2 = el('div', 'dmi-fr'); r2.append(field('工作目录（可选）', f.cwd), field('环境变量', f.env))
    stdioGroup.append(r1, r2)
    var httpGroup = el('div', 'dmi-fgroup')
    var r3 = el('div', 'dmi-fr'); r3.append(field('服务器 URL', f.url), field('请求头', f.headers))
    httpGroup.append(r3)
    function syncGroups() {
      stdioGroup.hidden = !stdioRadio.checked
      httpGroup.hidden = !httpRadio.checked
    }
    stdioRadio.addEventListener('change', syncGroups)
    httpRadio.addEventListener('change', syncGroups)
    syncGroups()

    f.err = el('div', 'dmi-err'); f.err.hidden = true
    f.save = el('button', 'dmi-save'); f.save.type = 'button'; f.save.textContent = '保存'
    f.save.addEventListener('click', submit)
    var cancel = el('button', 'dmi-btn'); cancel.type = 'button'; cancel.textContent = '取消'
    cancel.addEventListener('click', function () { editing = null; isNew = false; formRefs = null; render() })

    var form = el('div', 'dmi-form')
    var nameRow = el('div', 'dmi-fr'); nameRow.append(field('名称（工具 namespace）', f.name))
    var tpRow = el('div', 'dmi-fw')
    tpRow.append(el('label', '', '传输方式'), radios)
    var toRow = el('div', 'dmi-fr'); toRow.append(field('工具调用超时（毫秒，可选）', f.timeout))
    var btnRow = el('div', 'dmi-btnrow')
    btnRow.append(el('span', 'dmi-grow', ''), cancel, f.save)
    form.append(nameRow, tpRow, stdioGroup, httpGroup, toRow, f.err, btnRow)
    f.stdioRadio = stdioRadio
    f.httpRadio = httpRadio
    return { form: form, f: f }
  }

  /** 表单 → 条目（空集合/空超时归一化）。 */
  function readForm(f) {
    var timeout = parseInt(f.timeout.value, 10)
    return {
      id: editing !== null ? editing.id : '',
      serverName: f.name.value.trim(),
      transport: f.httpRadio.checked ? 'streamable-http' : 'stdio',
      enabled: editing !== null ? editing.enabled : true,
      command: f.command.value.trim(),
      args: f.args.value.trim() === '' ? [] : f.args.value.trim().split(/\\s+/),
      env: parsePairs(f.env.value),
      cwd: f.cwd.value.trim(),
      url: f.url.value.trim(),
      headers: parsePairs(f.headers.value),
      toolCallTimeoutMs: isNaN(timeout) ? null : timeout,
    }
  }

  function submit() {
    var f = formRefs
    if (f === null) return
    if (editing !== null && builtinNames.indexOf(editing.serverName) >= 0) return
    var entry = readForm(f)
    f.err.hidden = true
    f.err.textContent = ''
    f.save.disabled = true
    f.save.textContent = '保存中…'
    send({ op: 'save', entry: entry })
  }

  /** 服务器行（启停开关 + 名称 + transport 徽标 + 描述 + 编辑/删除）。 */
  function rowEl(s) {
    var row = el('div', 'dmi-row' + (s.enabled ? '' : ' off'))

    var toggle = el('input', 'dmi-toggle'); toggle.type = 'checkbox'
    toggle.checked = s.enabled
    toggle.title = s.enabled ? '已启用（点击停用）' : '已停用（点击启用）'
    toggle.addEventListener('change', function () {
      var next = { }
      for (var k in s) next[k] = s[k]
      next.enabled = toggle.checked
      status = '正在' + (toggle.checked ? '启用' : '停用') + ' ' + s.serverName + '…'
      render()
      send({ op: 'save', entry: next })
    })

    var badge = el('span', 'dmi-badge', s.transport === 'streamable-http' ? 'http' : 'stdio')
    var name = el('span', 'dmi-name', s.serverName)
    var desc = el('span', 'dmi-desc',
      s.transport === 'stdio' ? [s.command].concat(s.args).filter(Boolean).join(' ') : s.url)
    desc.title = desc.textContent

    var editBtn = el('button', 'dmi-btn', '编辑'); editBtn.type = 'button'
    editBtn.addEventListener('click', function () {
      editing = s; isNew = false; status = ''; render()
    })
    var delBtn = el('button', 'dmi-danger', '删除'); delBtn.type = 'button'
    delBtn.addEventListener('click', function () {
      status = '正在删除 ' + s.serverName + '…'
      render()
      send({ op: 'delete', id: s.id })
    })

    var isBuiltin = builtinNames.indexOf(s.serverName) >= 0
    if (isBuiltin) row.appendChild(el('span', 'dmi-builtin', '\u5185\u7f6e'))
    row.append(toggle, name, badge, desc, editBtn)
    if (!isBuiltin) row.appendChild(delBtn)
    return row
  }

  function render() {
    var sec = document.getElementById(SEC_ID)
    if (sec === null) return
    sec.replaceChildren()
    formRefs = null

    var lead = el('div', 'dmi-lead',
      'MCP 服务器把外部工具以 mcp__<名称>__* 提供给模型（配置写入 cordis.patch.yml 的 dsh-mcp-client 实例层）。' +
      '保存后引擎热加载生效（数秒内断开重连）；已开启会话的工具列表在会话内固定，以新会话为准。')
    sec.appendChild(lead)

    if (status !== '') {
      sec.appendChild(el('div', 'dmi-status', status))
    }

    var head = el('div', 'dmi-head')
    head.appendChild(el('div', 'dmi-title', '已配置' + (servers.length > 0 ? ' (' + servers.length + ')' : '')))
    var add = el('button', 'dmi-save', '添加服务器'); add.type = 'button'
    add.addEventListener('click', function () {
      editing = blankEntry(); isNew = true; status = ''; render()
      var first = sec.querySelector('.dmi-form input[type="text"]')
      if (first) first.focus()
    })
    head.appendChild(add)
    sec.appendChild(head)

    if (editing !== null) {
      var built = buildForm(editing)
      formRefs = built.f
      sec.appendChild(built.form)
    }

    var others = servers.filter(function (s) {
      return !(editing !== null && !isNew && s.id === editing.id)
    })
    for (var i = 0; i < others.length; i++) sec.appendChild(rowEl(others[i]))

    if (editing === null && servers.length === 0) {
      sec.appendChild(el('div', 'dmi-empty',
        '还没有配置 MCP 服务器。点击右上「添加服务器」开始——例如接入 filesystem、github 或自建服务。'))
    }
  }

  /** 主进程 → 页面：列表推送（save/delete 成功后必达）。 */
  window.__dshMcpSync = function (data, builtin) {
    servers = Array.isArray(data) ? data : []
    builtinNames = Array.isArray(builtin) ? builtin : []
    status = ''
    render()
  }

  /** 主进程 → 页面：save/delete 应答（失败回填；成功由 sync 刷新收尾）。 */
  window.__dshMcpSaved = function (result) {
    if (result !== null && typeof result === 'object' && result.ok === true) {
      editing = null
      isNew = false
      status = '已保存，引擎热加载中（数秒内生效）'
      render()
      return
    }
    var message = result !== null && typeof result === 'object' && typeof result.error === 'string'
      ? result.error : '操作失败'
    if (formRefs !== null) {
      formRefs.err.textContent = message
      formRefs.err.hidden = false
      formRefs.save.disabled = false
      formRefs.save.textContent = '保存'
      return
    }
    status = message
    render()
  }

  // ── 对话框挂载 / 激活切换（与技能分区同款） ─────────────────────
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
      if (dialog !== null) { on = false; dialog = null; navList = null }
      return
    }
    if (dlg !== dialog) {
      // 对话框重新挂载（上次关闭后重开）：重置状态并请求新列表
      on = false
      editing = null
      isNew = false
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
      send({ op: 'list' })
    }

    // 样式（幂等）
    if (document.getElementById(CSS_ID) === null) {
      var style = document.createElement('style')
      style.id = CSS_ID
      style.textContent = [
        '#' + SEC_ID + ' { display: none; }',
        '[role="dialog"].' + MARKER + ' div[data-slot="settings.section"] { display: none !important; }',
        '[role="dialog"].' + MARKER + ' #' + SEC_ID + ' { display: block; }',
        '.dmi-lead { margin: 2px 0 16px; color: var(--dsw-alias-label-secondary, #888); font-size: 13px; line-height: 1.65; }',
        '.dmi-status { margin: 0 0 12px; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }',
        '.dmi-head { display: flex; align-items: center; margin: 0 0 6px; }',
        '.dmi-title { flex: 1; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); }',
        '.dmi-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; }',
        '.dmi-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1)); }',
        '.dmi-row.off .dmi-name, .dmi-row.off .dmi-desc { opacity: .45; }',
        '.dmi-toggle { flex: none; width: 15px; height: 15px; accent-color: var(--dsw-alias-brand-primary, #2f6fed); cursor: pointer; }',
        '.dmi-name { flex: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: var(--dsw-alias-label-primary, #222); }',
        '.dmi-badge { flex: none; font-size: 10px; line-height: 1; padding: 3px 7px; border-radius: 5px; background: var(--dsw-alias-bg-layer-2, #eee); color: var(--dsw-alias-label-secondary, #666); }',
        '.dmi-desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dsw-alias-label-secondary, #888); }',
        '.dmi-empty { padding: 14px 2px; color: var(--dsw-alias-label-tertiary, #999); font-size: 12.5px; }',
        '.dmi-form { display: flex; flex-direction: column; gap: 10px; margin: 6px 0 14px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2, #e2e2e4); border-radius: 10px; }',
        '.dmi-fr { display: flex; gap: 12px; flex-wrap: wrap; }',
        '.dmi-fw { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 180px; }',
        '.dmi-form label { font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }',
        '.dmi-in { width: 100%; box-sizing: border-box; padding: 6px 9px; border: 1px solid var(--dsw-alias-border-l3, #c8c8cc); border-radius: 7px; background: var(--dsw-alias-bg-layer-1, transparent); color: var(--dsw-alias-label-primary, #222); font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }',
        '.dmi-in:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #2f6fed); }',
        '.dmi-ta { min-height: 54px; resize: vertical; }',
        '.dmi-radios { display: flex; gap: 14px; align-items: center; font-size: 12.5px; color: var(--dsw-alias-label-primary, #222); }',
        '.dmi-radios label { color: inherit; display: flex; gap: 5px; align-items: center; cursor: pointer; }',
        '.dmi-radio { accent-color: var(--dsw-alias-brand-primary, #2f6fed); }',
        '.dmi-err { color: #e5484d; font-size: 12px; white-space: pre-wrap; }',
        '.dmi-btnrow { display: flex; align-items: center; gap: 8px; }',
        '.dmi-grow { flex: 1; }',
        '.dmi-btn { flex: none; font-size: 11px; line-height: 1; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l3, #c8c8cc); border-radius: 6px; background: var(--dsw-alias-bg-layer-2, #f6f7f8); color: var(--dsw-alias-label-secondary, #666); cursor: pointer; }',
        '.dmi-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); color: var(--dsw-alias-label-primary, #222); }',
        '.dmi-danger { border-color: rgba(229,72,77,.45); color: #e5484d; }',
        '.dmi-danger:hover { background: rgba(229,72,77,.08); color: #e5484d; }',
        '.dmi-save { flex: none; font-size: 11.5px; line-height: 1; padding: 7px 14px; border: none; border-radius: 6px; background: var(--dsw-alias-brand-primary, #2f6fed); color: var(--dsw-alias-label-primary-inverted, #fff); cursor: pointer; }',
        '.dmi-save:disabled { opacity: .55; cursor: default; }',
        '.dmi-save:hover:not(:disabled) { filter: brightness(1.08); }',
        '.dmi-builtin { flex: none; font-size: 10px; line-height: 1; padding: 3px 7px; border-radius: 5px; background: var(--dsw-alias-brand-primary, #2f6fed); color: var(--dsw-alias-label-primary-inverted, #fff); }'
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
        if (label !== null) label.textContent = 'MCP \u670D\u52A1\u5668'
        mine.addEventListener('click', function (ev) { ev.stopPropagation(); activate() })
        seed.parentNode.appendChild(mine)
      }
    }

    // 激活态再同步：上游按钮的 aria-current/active 类是 React 管理的，
    // 若激活期间发生重渲染会被恢复 —— 每次 DOM 变化都重新压住
    if (on) activate()

    // 点击其他分区 → 让位（捕获期，React 各自处理自己的状态）
    if (dialog.getAttribute('data-dmi-nav') !== '1') {
      dialog.setAttribute('data-dmi-nav', '1')
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
 * 给 shell 窗口挂 MCP 设置注入器：整页加载后注入页面脚本并推当前列表；
 * console 通道接收 list/save/delete（写 mcp-store，成功后回推刷新）。
 * 窗口销毁时监听随 webContents 消亡。
 */
export function attachMcpSettingsInjector(win: BrowserWindow): void {
  const { webContents } = win

  const push = (): void => {
    if (win.isDestroyed()) return
    void webContents.executeJavaScript(
      `window.__dshMcpSync && window.__dshMcpSync(${JSON.stringify(mcpServers())}, ${JSON.stringify(BUILTIN_MCP_SERVERS.map((s) => s.serverName))})`,
      true,
    ).catch(() => {})
  }

  const reply = (result: { ok: boolean; error: string | null }): void => {
    if (win.isDestroyed()) return
    void webContents.executeJavaScript(
      `window.__dshMcpSaved && window.__dshMcpSaved(${JSON.stringify(result)})`,
      true,
    ).catch(() => {})
  }

  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(PREFIX) || win.isDestroyed()) return
    let payload: { op?: unknown; entry?: unknown; id?: unknown }
    try { payload = JSON.parse(message.slice(PREFIX.length)) as { op?: unknown; entry?: unknown; id?: unknown } } catch { return }
    if (payload.op === 'list') {
      push()
      return
    }
    if (payload.op === 'save' && typeof payload.entry === 'object' && payload.entry !== null) {
      const result = mcpServerSave(payload.entry as McpServerEntry)
      reply(result)
      if (result.ok) push()
      return
    }
    if (payload.op === 'delete' && typeof payload.id === 'string') {
      const result = mcpServerDelete(payload.id)
      reply(result)
      if (result.ok) push()
    }
  }

  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', () => {
    void webContents.executeJavaScript(PAGE_JS, true).then(push).catch(() => {})
  })
}
