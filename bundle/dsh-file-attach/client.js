/**
 * @kkutysllb/dsh-file-attach — client 半（输入栏文件/文件夹附件）。
 *
 * 交付形态：dsh client-modules 按 package.json 的 dsh.client 声明把本
 * 文件作为 `exports["./client"]` bundle 读入，经 /plugins combo 路由以
 * 普通 script 拼接执行——因此这里没有 import/export，走
 * window.__ModuleLoader__.load({id, factory}) 注册协议（inject: []，
 * 立即 apply；slots/sessions/conversation 全部 ctx.get 软探测）。
 *
 * 六个功能面：
 * 1. 📎 按钮：slots 注入 conversation.input.left（React 组件，factory
 *    的 require 通道软取 react；缺席则退化为纯拖拽，toast 引导）。
 *    点击选文件，Alt+点击选文件夹（浏览器 input 通道，KCoder shell
 *    窗口无 preload，Electron 原生对话框不可用）。
 * 2. 定位链：文件名 → POST /dsh-file-attach/api/locate {name, cwd}，
 *    cwd 由当前会话快照读取（dsh-git-panel 同款）；唯一命中入队、
 *    多候选 chip 点选、未命中标红。
 * 3. chips UI：挂 [data-composer-card] 卡片顶部（MutationObserver
 *    自愈重挂）；chip 显示定位状态，多候选弹层点选，X 移除。
 * 4. 拖拽分流：document capture 拦 drop——载荷含非图片文件/目录才
 *    拦下入队；纯图片放行走原生（图片链路零参与）；混合载荷图片
 *    部分 toast 引导粘贴。
 * 5. 发送 wrap：conversation 服务原型链 PATCH_MARK 幂等 wrap
 *    sendSession——有已定位 chips 时把 [附件]name|path 行与原文拼合
 *    走 session.prompt，成功必须 return { kind: 'success' }（rc.8
 *    SubmitOutcome 契约，缺 return 会让 settleSubmit 抛 TypeError、
 *    输入框永久锁死）；无 chips 时 original 原样透传（imageIds 不碰）。
 * 6. 气泡附件卡片：MutationObserver 盯用户/steering 气泡
 *    （div[data-actions-reveal]，上游稳定 data 锚），把文本里的
 *    [附件]name|path 行就地替换为文件胶囊卡片（title 保留完整路径，
 *    正文不展示原始路径）；React 重渲染重建节点后幂等重放。
 *
 * 上游锚点契约（变更即对应功能静默失效）：conversation.input.left
 * slot、[data-composer-card]、conversation.sendSession 签名、
 * sessions.list 快照、div[data-actions-reveal]、session.prompt 返回
 * {ok}。
 *
 * @module @kkutysllb/dsh-file-attach/client
 */

window.__ModuleLoader__.load({
  id: '@kkutysllb/dsh-file-attach',
  factory: (require) => {
    const exports = {}

    /** react 软依赖：require 通道缺席/失败返回 null（按钮退化为拖拽）。 */
    const React = (() => {
      try { return typeof require === 'function' ? require('react') : null } catch { return null }
    })()

    exports.inject = []

    /* ---------------------------------------------------------------- *
     * 纯逻辑（导出供 tests/run-tests.mjs node 直跑）
     * ---------------------------------------------------------------- */

    /** 附件行（单行）：[附件]name|path / [附件·目录]name|path。 */
    const ATTACH_LINE_RE = /^\[附件(?:·目录)?\](.+)\|(.+)$/
    /** 文本内附件行（多行扫描用）：卡片替换按匹配片段重建。 */
    const ATTACH_SCAN_RE = /\[附件(?:·目录)?\][^\n|]+\|[^\n]+/g
    /** 图片扩展名（宽集合）：drop 分流用——纯图片载荷放行原生链路。 */
    const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|svg|heic|heif|avif|tiff?)$/i

    exports.ATTACH_LINE_RE = ATTACH_LINE_RE

    /** 图片名字判定（drop 分流）。 */
    exports.isImageName = (name) => IMAGE_EXT_RE.test(String(name || ''))

    /** 发送行格式（isDir 决定目录 tag）。 */
    exports.buildAttachmentLine = (item) =>
      (item && item.isDir ? '[附件·目录]' : '[附件]') + item.name + '|' + item.path

    /** 发送正文：附件行块（单换行）+ 原文（块间空行）。 */
    exports.buildMessageBody = (readyItems, text) => {
      const lines = (readyItems || []).map(exports.buildAttachmentLine)
      const t = String(text ?? '').replace(/\s+$/, '')
      if (lines.length === 0) return t
      return t === '' ? lines.join('\n') : lines.join('\n') + '\n\n' + t
    }

    /** 消息文本 → 附件清单与剩余正文（气泡/测试用纯解析）。 */
    exports.parseAttachmentMarkup = (text) => {
      const attachments = []
      const rest = []
      for (const line of String(text ?? '').split('\n')) {
        const m = ATTACH_LINE_RE.exec(line.trim())
        if (m) attachments.push({ name: m[1], path: m[2], isDir: line.includes('[附件·目录]') })
        else rest.push(line)
      }
      return { attachments, rest: rest.join('\n').trim() }
    }

    /* ---------------------------------------------------------------- *
     * apply
     * ---------------------------------------------------------------- */

    exports.apply = function apply(ctx) {
      if (window.__dshFileAttachWired) return
      window.__dshFileAttachWired = true

      const API = '/dsh-file-attach/api'
      const BAR_ID = '__dsh_file_attach_bar'
      const STYLE_ID = '__dsh_file_attach_style'
      const CARD_ANCHOR = '[data-composer-card]'
      const BUBBLE_ROW_SEL = 'div[data-actions-reveal]'
      const PATCH_MARK = '__dshFileAttachSendPatched'

      /** 队列项：{id, name, status, path, isDir, candidates, error}。 */
      const items = []
      let itemSeq = 0
      let popEl = null // 多候选浮层（bar 内）

      /* ---- 样式 ---- */
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        '#' + BAR_ID + '{position:relative;display:none;flex-wrap:wrap;gap:6px;padding:2px 14px 0;max-width:100%;box-sizing:border-box}',
        '#' + BAR_ID + '[data-on="1"]{display:flex}',
        // 胶囊形态对齐上游产物 chip（ui-deliverables ProducedFiles .file：
        // 6px 圆角 + interactive-bg 底 + label-secondary）
        '#' + BAR_ID + ' .dfa-chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));font-size:12px;line-height:1;color:var(--dsw-alias-label-secondary,inherit);cursor:default;user-select:none;max-width:300px}',
        '#' + BAR_ID + ' .dfa-chip .ic{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.75))}',
        '#' + BAR_ID + ' .dfa-chip .ic svg{width:100%;height:100%}',
        '#' + BAR_ID + ' .dfa-chip .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '#' + BAR_ID + ' .dfa-chip[data-status="found"] .nm{color:var(--dsw-alias-label-primary,inherit)}',
        '#' + BAR_ID + ' .dfa-chip .st{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.75))}',
        '#' + BAR_ID + ' .dfa-chip[data-status="found"] .st{color:var(--dsw-alias-state-success-primary,#1a7f37)}',
        '#' + BAR_ID + ' .dfa-chip[data-status="choose"]{cursor:pointer;box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary,#2f6fed)}',
        '#' + BAR_ID + ' .dfa-chip[data-status="none"]{box-shadow:inset 0 0 0 1px var(--dsw-alias-state-error-primary,#e5534b)}',
        '#' + BAR_ID + ' .dfa-chip[data-status="none"] .st{color:var(--dsw-alias-state-error-primary,#e5534b)}',
        '#' + BAR_ID + ' .dfa-chip .rm{flex:none;cursor:pointer;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.75))}',
        '#' + BAR_ID + ' .dfa-chip .rm:hover{background:rgba(127,127,127,.18);color:var(--dsw-alias-label-primary,inherit)}',
        '#' + BAR_ID + ' .dfa-pop{position:absolute;top:calc(100% + 4px);left:0;z-index:2147483000;min-width:240px;max-width:420px;max-height:220px;overflow-y:auto;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 10px 32px rgba(9,16,29,.18);padding:4px}',
        '#' + BAR_ID + ' .dfa-pop .cap{font-size:10px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.75));padding:4px 8px 2px;user-select:none}',
        '#' + BAR_ID + ' .dfa-pop button{all:unset;box-sizing:border-box;display:block;width:100%;padding:6px 8px;border-radius:6px;font-size:11px;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#' + BAR_ID + ' .dfa-pop button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
        // 气泡附件卡片（data 标记防幂等重放）：同款胶囊 + 图标方块提供
        // 「缩略图」实体感（对齐文件管理器图标块观感）
        'span[data-dfa-card]{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 4px;margin:1px 2px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));font-size:12px;vertical-align:middle;max-width:320px}',
        'span[data-dfa-card] .icbox{flex:none;display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:4px;background:var(--dsw-specific-selector,rgba(127,127,127,.16));color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.75))}',
        'span[data-dfa-card] .icbox svg{width:11px;height:11px}',
        'span[data-dfa-card] .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,inherit)}',
        'span[data-dfa-card] .tag{flex:none;font-size:10px;line-height:1;padding:2px 4px;border-radius:4px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.75));box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,rgba(127,127,127,.25))}',
        // 📎 按钮：对齐上游 InputBar .add（28px 圆形 token 底 + hover 提亮；
        // 上游内嵌图标 14px，曲别针线条复杂取 16px 视觉平衡）
        '.dfa-attach-btn{all:unset;box-sizing:border-box;display:grid;place-items:center;width:28px;height:28px;border-radius:999px;background:var(--dsw-specific-selector,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit);cursor:pointer;flex:none}',
        '.dfa-attach-btn:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.22))}',
        '.dfa-attach-btn svg{width:16px;height:16px}',
        // 轻量 toast
        '#__dsh_file_attach_toast{position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:2147483647;background:var(--dsw-alias-bg-layer-2,rgba(30,30,32,.92));color:var(--dsw-alias-label-primary,#fff);font-size:12px;line-height:1.4;padding:8px 14px;border-radius:10px;box-shadow:0 8px 24px rgba(9,16,29,.25);pointer-events:none;opacity:0;transition:opacity .18s ease}',
        '#__dsh_file_attach_toast[data-on="1"]{opacity:1}',
      ].join('')
      document.head.append(style)

      /* ---- 隐藏文件 inputs（浏览器通道；Alt=目录） ---- */
      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.multiple = true
      fileInput.style.display = 'none'
      const dirInput = document.createElement('input')
      dirInput.type = 'file'
      dirInput.setAttribute('webkitdirectory', '')
      dirInput.style.display = 'none'
      document.body.append(fileInput, dirInput)
      fileInput.onchange = () => {
        for (const f of fileInput.files ?? []) enqueue(String(f.name))
        fileInput.value = ''
      }
      dirInput.onchange = () => {
        // webkitdirectory 的 FileList 全是目录内文件；目录名取相对路径首段
        const first = (dirInput.files ?? [])[0]
        const rel = first && first.webkitRelativePath ? first.webkitRelativePath : ''
        const dirName = rel.split('/')[0] ?? ''
        if (dirName !== '') enqueue(dirName)
        dirInput.value = ''
      }

      /* ---- toast ---- */
      let toastTimer = null
      const toast = (msg) => {
        let el = document.getElementById('__dsh_file_attach_toast')
        if (el === null) {
          el = document.createElement('div')
          el.id = '__dsh_file_attach_toast'
          document.body.append(el)
        }
        el.textContent = msg
        el.dataset.on = '1'
        if (toastTimer !== null) clearTimeout(toastTimer)
        toastTimer = setTimeout(() => { el.dataset.on = '0' }, 2400)
      }

      /* ---- cwd（当前会话工作区；dsh-git-panel 同款快照读取） ---- */
      const currentCwd = () => {
        try {
          const snap = ctx.get('sessions')?.list?.getSnapshot?.()
          const cur = snap?.current
          if (cur === undefined || cur === null) return null
          return snap?.byId?.[cur]?.cwd ?? null
        } catch { return null }
      }

      /* ---- 定位链 ---- */
      const locateItem = async (item) => {
        item.status = 'locating'
        renderBar()
        const cwd = currentCwd()
        if (cwd === null || cwd === '') {
          item.status = 'none'
          item.error = '无工作区'
          renderBar()
          return
        }
        try {
          const res = await fetch(API + '/locate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: item.name, cwd }),
          }).then((r) => r.json())
          if (!res || res.ok !== true) {
            item.status = 'none'
            item.error = (res && res.error) || '定位失败'
          } else if (res.status === 'found') {
            const hit = (res.candidates ?? [])[0]
            item.status = 'found'
            item.path = hit?.path ?? ''
            item.isDir = hit?.isDir === true
          } else if (res.status === 'choose') {
            item.status = 'choose'
            item.candidates = res.candidates ?? []
          } else {
            item.status = 'none'
            item.error = '未找到'
          }
        } catch {
          item.status = 'none'
          item.error = '网络异常'
        }
        renderBar()
      }

      const enqueue = (name) => {
        const n = String(name || '').trim()
        if (n === '') return
        if (items.some((it) => it.name === n && it.status !== 'none')) return
        const item = { id: ++itemSeq, name: n, status: 'locating', path: '', isDir: false, candidates: [], error: '' }
        items.push(item)
        void locateItem(item)
      }

      const removeFromItems = (id) => {
        const i = items.findIndex((it) => it.id === id)
        if (i !== -1) items.splice(i, 1)
      }

      /* ---- chips bar（[data-composer-card] 顶部自愈挂载） ---- */
      const bar = document.createElement('div')
      bar.id = BAR_ID

      const ensureBar = () => {
        const card = document.querySelector(CARD_ANCHOR)
        if (card === null) {
          bar.remove()
          return
        }
        if (bar.previousElementSibling !== null || bar.parentElement !== card) {
          card.insertBefore(bar, card.firstChild)
        }
      }

      const statusLabel = (it) => {
        if (it.status === 'locating') return '定位中…'
        if (it.status === 'found') return '✓'
        if (it.status === 'choose') return '多候选'
        return it.error || '未找到'
      }

      const closePop = () => { if (popEl !== null) { popEl.remove(); popEl = null } }

      const openPop = (chip, item) => {
        closePop()
        popEl = document.createElement('div')
        popEl.className = 'dfa-pop'
        popEl.append(Object.assign(document.createElement('div'), { className: 'cap', textContent: '选择「' + item.name + '」的位置' }))
        for (const c of item.candidates ?? []) {
          const b = document.createElement('button')
          b.type = 'button'
          b.textContent = (c.isDir ? '📁 ' : '📄 ') + c.path
          b.title = c.path
          b.onclick = (ev) => {
            ev.stopPropagation()
            item.status = 'found'
            item.path = c.path
            item.isDir = c.isDir === true
            closePop()
            renderBar()
          }
          popEl.append(b)
        }
        bar.append(popEl)
        chip.after(popEl)
      }

      const mkChip = (item) => {
        const chip = document.createElement('span')
        chip.className = 'dfa-chip'
        chip.dataset.status = item.status
        const ic = document.createElement('span')
        ic.className = 'ic'
        ic.innerHTML = item.status === 'found' && item.isDir ? FOLDER_SVG : (item.status === 'none' ? HELP_SVG : FILE_SVG)
        const nm = document.createElement('span')
        nm.className = 'nm'
        nm.textContent = item.name
        nm.title = item.status === 'found' ? item.path : item.name
        const st = document.createElement('span')
        st.className = 'st'
        st.textContent = statusLabel(item)
        const rm = document.createElement('span')
        rm.className = 'rm'
        rm.textContent = '×'
        rm.title = '移除'
        rm.onclick = (ev) => { ev.stopPropagation(); removeFromItems(item.id); closePop(); renderBar() }
        chip.append(ic, nm, st, rm)
        if (item.status === 'choose') {
          chip.onclick = (ev) => {
            ev.stopPropagation()
            if (popEl !== null) closePop()
            else openPop(chip, item)
          }
        }
        return chip
      }

      const renderBar = () => {
        if (bar.isConnected === false) ensureBar()
        closePop()
        bar.replaceChildren()
        for (const it of items) bar.append(mkChip(it))
        bar.dataset.on = items.length > 0 ? '1' : '0'
      }

      /* ---- 📎 按钮（slot 注入；react 缺席则退化为拖拽） ---- */
      const PAPERCLIP_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>'
      /* chip/卡片图标（lucide 线框；尺寸由容器 CSS 控制）。 */
      const FILE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/></svg>'
      const FOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>'
      const HELP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>'

      const AttachButton = React
        ? function AttachButton() {
            return React.createElement('button', {
              type: 'button',
              title: '附件（Alt+点击选文件夹）',
              'aria-label': '添加附件',
              onClick: (ev) => {
                ev.preventDefault()
                if (ev.altKey) dirInput.click()
                else fileInput.click()
              },
              className: 'dfa-attach-btn',
              dangerouslySetInnerHTML: { __html: PAPERCLIP_SVG },
            })
          }
        : null

      let btnWired = false
      const mountButton = () => {
        if (btnWired) return true
        const slots = ctx.get('slots')
        if (slots === undefined || AttachButton === null) return false
        try {
          slots.inject('conversation.input.left', () => slots.register(
            { name: 'conversation.input.left', id: 'file-attach', order: -90 },
            AttachButton,
          ))
          btnWired = true
          try { console.log('[dsh-file-attach] 📎 button injected into conversation.input.left') } catch { /* noop */ }
        } catch (error) {
          try { console.error('[dsh-file-attach] button inject failed:', error) } catch { /* noop */ }
        }
        return btnWired
      }

      /* ---- 拖拽分流（capture；只拦非图片载荷） ---- */
      const hasFiles = (dt) => {
        try { return Array.from(dt?.types ?? []).includes('Files') } catch { return false }
      }

      document.addEventListener('dragover', (ev) => {
        if (!hasFiles(ev.dataTransfer)) return
        // 允许 drop 落地（drop 分类在 capture 的 drop 里做；preventDefault
        // 只声明「可放置」，不会吞掉上游对纯图片的处理）
        ev.preventDefault()
      }, true)

      document.addEventListener('drop', (ev) => {
        const dt = ev.dataTransfer
        if (!hasFiles(dt)) return
        // webkitGetAsEntry/getAsFile 必须在事件同步段全部取完
        const entries = []
        const files = []
        for (const item of Array.from(dt.items ?? [])) {
          if (item.kind !== 'file') continue
          let entry = null
          try { entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null } catch { entry = null }
          const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null
          if (entry !== null) entries.push(entry)
          else if (file !== null) files.push(file)
        }
        const dirEntries = entries.filter((e) => e.isDirectory)
        const fileEntries = entries.filter((e) => e.isFile)
        const imageEntries = fileEntries.filter((e) => exports.isImageName(e.name))
        const plainEntries = fileEntries.filter((e) => !exports.isImageName(e.name))
        const looseImages = files.filter((f) => exports.isImageName(f.name))
        const loosePlains = files.filter((f) => !exports.isImageName(f.name))
        const isPureImage = dirEntries.length === 0 && plainEntries.length === 0 && loosePlains.length === 0
          && (imageEntries.length > 0 || looseImages.length > 0)
        if (isPureImage) return // 纯图片：原生链路接管
        if (dirEntries.length === 0 && plainEntries.length === 0 && loosePlains.length === 0) return
        // 含非图片文件/目录：拦下入队；图片部分引导粘贴
        ev.preventDefault()
        ev.stopPropagation()
        for (const e of dirEntries) enqueue(e.name)
        for (const e of plainEntries) enqueue(e.name)
        for (const f of loosePlains) enqueue(f.name)
        if (imageEntries.length > 0 || looseImages.length > 0) {
          toast('图片附件走原生：请直接粘贴发送（文件已收 ' + (dirEntries.length + plainEntries.length + loosePlains.length) + ' 项）')
        }
      }, true)

      /* ---- 发送 wrap（原型链 PATCH_MARK 幂等） ---- */
      const findOwnerProto = (obj, key) => {
        let p = Object.getPrototypeOf(obj)
        while (p !== null && p !== Object.prototype) {
          if (Object.prototype.hasOwnProperty.call(p, key)) return p
          p = Object.getPrototypeOf(p)
        }
        return null
      }

      let sendWired = false
      const wireSend = () => {
        if (sendWired) return true
        const sessions = ctx.get('sessions')
        if (sessions === undefined) return false
        let conversation = null
        try {
          const cur = sessions.list?.getSnapshot?.()?.current
          const scoped = cur !== undefined && cur !== null && typeof sessions.scope === 'function'
            ? sessions.scope(cur)
            : undefined
          conversation = scoped !== undefined ? scoped.get('conversation') : undefined
        } catch { conversation = undefined }
        if (conversation === undefined || conversation === null) {
          try { conversation = ctx.get('conversation') } catch { conversation = undefined }
        }
        if (conversation === undefined || conversation === null) return false
        const owner = findOwnerProto(conversation, 'sendSession')
        if (owner === null) {
          sendWired = true // 不再重试（服务形态变更，README 风险条款）
          try { console.error('[dsh-file-attach] sendSession owner not found on prototype chain') } catch { /* noop */ }
          return true
        }
        if (owner[PATCH_MARK] === true) {
          sendWired = true
          return true
        }
        const original = owner.sendSession
        if (typeof original !== 'function') {
          sendWired = true
          return true
        }
        owner.sendSession = async function patchedSendSession(session, text, imageIds, mode, signal) {
          const ready = items.filter((it) => it.status === 'found' && it.path !== '')
          if (ready.length === 0) return original.call(this, session, text, imageIds, mode, signal)
          // 图片完全透传：text/imageIds 形态不动图片部分，附件行走
          // session.prompt 文本通道（imageIds 为空时与上游 subagent 分支同构）
          const body = exports.buildMessageBody(ready, text)
          let result = null
          try {
            result = await session.prompt([{ type: 'text', text: body }], mode, signal)
          } catch {
            return { kind: 'error' }
          }
          if (result !== null && result !== undefined && result.ok === true) {
            for (const it of ready) removeFromItems(it.id)
            renderBar()
            // rc.8 SubmitOutcome 契约：缺 return 会让 settleSubmit 读
            // undefined.kind 抛 TypeError，submit-settled 不派发，输入框锁死
            return { kind: 'success' }
          }
          return { kind: 'error' }
        }
        owner[PATCH_MARK] = true
        sendWired = true
        try { console.log('[dsh-file-attach] conversation.sendSession wrapped') } catch { /* noop */ }
        return true
      }

      /* ---- 气泡附件卡片（data-actions-reveal 行内文本重写） ---- */
      const buildCard = (line) => {
        const m = ATTACH_LINE_RE.exec(line.trim())
        const isDir = line.includes('[附件·目录]')
        const name = m ? m[1] : line
        const path = m ? m[2] : line
        const span = document.createElement('span')
        span.dataset.dfaCard = '1'
        span.title = path
        const icbox = document.createElement('span')
        icbox.className = 'icbox'
        icbox.innerHTML = isDir ? FOLDER_SVG : FILE_SVG
        const nm = document.createElement('span')
        nm.className = 'nm'
        nm.textContent = name
        span.append(icbox, nm)
        if (isDir) {
          const tag = document.createElement('span')
          tag.className = 'tag'
          tag.textContent = '目录'
          span.append(tag)
        }
        return span
      }

      /** 文本节点内附件行 → 卡片；有替换返回 true。 */
      const processTextNode = (node) => {
        const text = node.nodeValue ?? ''
        ATTACH_SCAN_RE.lastIndex = 0
        if (!ATTACH_SCAN_RE.test(text)) return false
        const frag = document.createDocumentFragment()
        let last = 0
        String(text).replace(ATTACH_SCAN_RE, (match, idx) => {
          if (idx > last) frag.append(document.createTextNode(text.slice(last, idx)))
          frag.append(buildCard(match))
          last = idx + match.length
          return match
        })
        if (last < text.length) frag.append(document.createTextNode(text.slice(last)))
        if (node.parentNode !== null) node.parentNode.replaceChild(frag, node)
        return true
      }

      const transformRow = (row) => {
        let touched = false
        const walker = document.createTreeWalker(row, window.NodeFilter?.SHOW_TEXT ?? 4)
        const nodes = []
        while (walker.nextNode()) nodes.push(walker.currentNode)
        for (const n of nodes) {
          if (processTextNode(n)) touched = true
        }
        return touched
      }

      /** 扫单个节点（含自身就是气泡行的情形）。 */
      const scanNode = (n) => {
        if (n === null || n.nodeType !== 1) return
        const row = n.matches?.(BUBBLE_ROW_SEL) ? n : n.closest?.(BUBBLE_ROW_SEL)
        if (row !== null && row !== undefined) {
          if (row.dataset.dfaDone !== '1' && transformRow(row)) row.dataset.dfaDone = '1'
        }
        let rows
        try { rows = n.querySelectorAll(BUBBLE_ROW_SEL) } catch { return }
        for (const r of rows) {
          if (r.dataset.dfaDone !== '1' && transformRow(r)) r.dataset.dfaDone = '1'
        }
      }

      /* ---- 总 observer（气泡重写 + bar 自愈合一；自身替换幂等收敛） ----
       * 三类变化都收敛到「找到相关气泡行 → 未处理则重写」：整行新增、
       * 行内局部更新（React 只换文本节点时不产生元素级 added，需从
       * target 向上找回行，否则卡片会被重渲染回原始路径文本）。 */
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type !== 'childList') continue
          let touched = false
          for (const n of m.addedNodes) {
            if (n.nodeType === 1) { ensureBar(); scanNode(n); touched = true }
          }
          if (!touched) scanNode(m.target)
        }
      })
      mo.observe(document.body, { subtree: true, childList: true })
      // 首扫（页面已有消息与 composer）
      ensureBar()
      scanNode(document)

      /* ---- 探测链（slots/sessions 服务就绪即挂，20s 上限） ---- */
      let tries = 0
      const probe = setInterval(() => {
        tries += 1
        const btnDone = mountButton()
        const sendDone = wireSend()
        if ((btnDone && sendDone) || tries >= 40) clearInterval(probe)
      }, 500)
    }

    return exports
  },
})
