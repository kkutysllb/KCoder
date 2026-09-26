// dsh-ssh-remote — browser half（样式以内联为主；:hover/:focus-visible 由去重注入的
// <style> 承载，此外无全局副作用）。设置页配方对齐 dsh-coding-sidebar「侧边卡片」。
// 会话头部「SSH」胶囊：绿=全部主机可达 / 红=有不可达 / 灰=无主机。
// 浮窗：每主机状态行（连通性探测/打开设置）+ 刷新。
window.__ModuleLoader__.load({
  id: 'dsh-ssh-remote',
  factory: function (require) {
    var React = require('react')
    var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef, useCallback = React.useCallback

    function h(type, props) {
      var children = Array.prototype.slice.call(arguments, 2)
      return React.createElement.apply(React, [type, props].concat(children))
    }

    var S = {
      chip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', border: '1px solid var(--dsw-alias-border-l1,#88888866)', borderRadius: 999, background: 'transparent', color: 'var(--dsw-alias-label-secondary,#999)', cursor: 'pointer', font: 'inherit', fontSize: 12, lineHeight: 1.8, whiteSpace: 'nowrap', position: 'relative' },
      dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flex: '0 0 auto' },
      panel: { position: 'fixed', zIndex: 2000, maxWidth: '92vw', maxHeight: '70vh', overflow: 'auto', background: 'var(--dsw-alias-bg-layer-1,#1f1f1f)', border: '1px solid var(--dsw-alias-border-l1,#88888866)', borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,.4)', padding: '10px 12px', font: 'inherit', fontSize: 12, color: 'var(--dsw-alias-label-primary,inherit)', textAlign: 'left' },
      head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--dsw-alias-border-l1,#88888866)' },
      ttl: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary,inherit)' },
      close: { font: 'inherit', fontSize: 14, lineHeight: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#88888866)', background: 'transparent', color: 'var(--dsw-alias-label-secondary,#bbb)', cursor: 'pointer' },
      row: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 6, margin: '1px 0', borderBottom: '1px solid var(--dsw-alias-border-l1,#88888866)' },
      nm: { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--dsw-alias-label-primary,inherit)', fontWeight: 600 },
      sub: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary,#888)', marginTop: 2, wordBreak: 'break-all' },
      badge: { fontSize: 10, padding: '1px 5px', borderRadius: 999, flex: '0 0 auto' },
      btn: { flex: '0 0 auto', font: 'inherit', fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#88888866)', background: 'transparent', color: 'var(--dsw-alias-label-secondary,#bbb)', cursor: 'pointer', marginLeft: 4 },
      actions: { display: 'flex', gap: 6, alignItems: 'center', margin: '8px 0 2px' },
      err: { color: '#e5484d', fontSize: 11, marginTop: 4, wordBreak: 'break-all' },
      empty: { color: 'var(--dsw-alias-label-tertiary,#888)', padding: '8px 4px', fontSize: 11 },
    }

    function postJson(url, body) {
      return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(function (r) { return r.json() })
    }

    function putJson(url, body) {
      return fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(function (r) { return r.json() })
    }

    function SshRemoteUtility() {
      var wrapRef = useRef(null)
      // useRef(null)：初值必须是假值，下面的 `|| 默认状态` 才会生效（useRef({}) 永远为真值，
      // 导致 st.data / st.probing 等字段全是 undefined，组件首次渲染即抛错）。
      var stateRef = useRef(null)
      var render = useState(0)[1]
      stateRef.current = stateRef.current || { data: null, error: null, open: false, pos: null, probing: {} }

      var refresh = useCallback(function () {
        fetch('/ssh-remote/api/status').then(function (r) { return r.json() }).then(function (res) {
          stateRef.current.error = res && res.ok ? null : 'status failed'
          stateRef.current.data = res && res.ok ? res.value : stateRef.current.data
          render(function (n) { return n + 1 })
        }).catch(function () {
          stateRef.current.error = 'host api unavailable'
          render(function (n) { return n + 1 })
        })
      }, [])

      useEffect(function () { refresh() }, [refresh])

      // 兜底：open 且无 pos 时补测一次并触发渲染（toggle 已同步测量，此 effect 只兜异常路径）
      useEffect(function () {
        var st = stateRef.current
        if (!st.open || st.pos) return
        var chip = wrapRef.current
        if (!chip) return
        var r = chip.getBoundingClientRect()
        st.pos = { top: r.bottom + 6, left: Math.max(8, r.right - 460), width: 460 }
        render(function (n) { return n + 1 })
      })

      function probe(id) {
        stateRef.current.probing[id] = true
        render(function (n) { return n + 1 })
        postJson('/ssh-remote/api/probe', { hostId: id }).then(function (res) {
          stateRef.current.probing[id] = false
          if (res && res.ok === false && res.error) stateRef.current.error = res.error.message
          refresh()
        }).catch(function () {
          stateRef.current.probing[id] = false
          stateRef.current.error = 'probe 请求失败（host api unavailable）'
          render(function (n) { return n + 1 })
        })
      }

      var st = stateRef.current
      var data = st.data
      var hosts = data && Array.isArray(data.hosts) ? data.hosts : []
      var conns = {}
      if (data && Array.isArray(data.connections)) data.connections.forEach(function (c) { conns[c.id] = c })
      var anyDown = hosts.length > 0 && hosts.some(function (x) { var c = conns[x.id]; return c && c.master === 'down' })
      var dotColor = hosts.length === 0 ? '#888' : (anyDown ? '#e5484d' : '#30a46c')

      return h('div', { ref: wrapRef, style: S.chip, onClick: function () {
        // 打开前同步测量位置（修复：effect 写 pos 无重渲染导致面板永不出现）
        if (!st.open && wrapRef.current) {
          var r = wrapRef.current.getBoundingClientRect()
          st.pos = { top: r.bottom + 6, left: Math.max(8, r.right - 460), width: 460 }
        }
        st.open = !st.open
        render(function (n) { return n + 1 })
      }, title: 'SSH 远程主机：点击展开' },
        h('span', { style: Object.assign({ background: dotColor }, S.dot) }),
        h('span', null, 'SSH'),
        st.open && st.pos && h('div', { style: Object.assign({ top: st.pos.top, left: st.pos.left, width: st.pos.width }, S.panel), onClick: function (e) { e.stopPropagation() } },
          h('div', { style: S.head },
            h('span', { style: S.ttl }, 'SSH 远程主机'),
            h('button', { style: S.close, onClick: function () { st.open = false; render(function (n) { return n + 1 }) } }, '✕')
          ),
          hosts.length === 0 && h('div', { style: S.empty }, '未配置主机（设置页或 cordis.patch.yml 的 ssh-remote.config.hosts）'),
          hosts.map(function (x) {
            var c = conns[x.id] || {}
            var up = c.master === 'up' || c.master === 'degraded'
            var color = c.master === 'up' ? '#30a46c' : (c.master === 'degraded' ? '#f5a623' : '#e5484d')
            var extra = []
            if (c.latencyMs !== null && c.latencyMs !== undefined) extra.push('延迟 ' + c.latencyMs + 'ms')
            if (c.commands) extra.push('命令 ' + c.commands + ' 次')
            if (x.source) extra.push(x.source === 'static' ? '静态' : '动态')
            return h('div', { key: x.id, style: S.row },
              h('span', { style: Object.assign({ background: color }, S.dot) }),
              h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
                h('div', { style: S.nm }, h('span', null, x.name),
                  h('span', { style: Object.assign({}, S.badge, { background: up ? 'var(--dsw-alias-state-success-primary,#16a34a)' : 'var(--dsw-alias-state-danger-primary,#e5484d)', color: '#fff' }) }, c.master === 'degraded' ? '直连' : (up ? 'UP' : 'DOWN'))),
                h('div', { style: S.sub }, x.user + '@' + x.host + (x.port !== 22 ? ':' + x.port : '') + (x.jump ? ' · 经 ' + x.jump : '')),
                extra.length > 0 && h('div', { style: S.sub }, extra.join(' · ')),
                c.lastError && h('div', { style: S.err, title: c.lastError }, '最后错误：' + String(c.lastError).slice(0, 160))
              ),
              h('button', { style: S.btn, disabled: st.probing[x.id], onClick: function () { probe(x.id) } }, st.probing[x.id] ? '探测中…' : '连通性')
            )
          }),
          st.error && h('div', { style: S.err }, st.error),
          h('div', { style: S.actions }, h('button', { style: S.btn, onClick: refresh }, '刷新'))
        )
      )
    }

    // ── 设置页样式：对齐 dsh-coding-sidebar「侧边卡片」的 DSH 原生配方
    //（section 760px 内容列 / group 卡片 l2 描边 r16 layer-3 / 标题+计数徽章 /
    //  输入与按钮统一令牌 / 主按钮=label-primary 反色填充）。
    // :hover / :focus-visible / disabled 由下方去重注入的 <style> 承载（行内样式做不到伪类）。
    var STYLE_ID = 'dsh-ssh-remote-style'
    var CSS = [
      '.dsshr-btn,.dsshr-btn-primary,.dsshr-btn-danger,.dsshr-input,.dsshr-textarea{transition:background .12s ease,border-color .12s ease,color .12s ease}',
      '.dsshr-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff14);border-color:var(--dsw-alias-interactive-bg-hover-accent,#ffffff3d);color:var(--dsw-alias-label-primary,#f9fafb)}',
      '.dsshr-btn-primary:hover{background:var(--dsw-alias-button-primary-hover,#ebeef2)}',
      '.dsshr-btn-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,#f25a5a26);border-color:var(--dsw-alias-state-error-primary,#f25a5a);color:var(--dsw-alias-state-error-primary,#f25a5a)}',
      '.dsshr-btn:focus-visible,.dsshr-btn-primary:focus-visible,.dsshr-btn-danger:focus-visible{outline:2px solid var(--dsw-alias-border-l4,#ffffff33);outline-offset:1px}',
      '.dsshr-input:focus-visible,.dsshr-textarea:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#7aaaff);outline-offset:1px}',
      '.dsshr-btn:disabled,.dsshr-btn-primary:disabled{opacity:.45;cursor:not-allowed}',
      '.dsshr-input:disabled{color:var(--dsw-alias-label-tertiary,#adb2b8);cursor:not-allowed}',
      '@media (prefers-reduced-motion:reduce){.dsshr-btn,.dsshr-btn-primary,.dsshr-btn-danger,.dsshr-input,.dsshr-textarea{transition:none}}',
    ].join('\n')

    function ensureStyle() {
      if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return
      if (document.getElementById(STYLE_ID)) return
      var el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = CSS
      ;(document.head || document.body).appendChild(el)
    }

    var SS = {
      section: { display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 760, boxSizing: 'border-box' },
      intro: { margin: 0, padding: '0 2px', fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary,#adb2b8)' },
      group: { display: 'flex', flexDirection: 'column', gap: 8, padding: 20, boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2,#ffffff1f)', borderRadius: 16, background: 'var(--dsw-alias-bg-layer-3,#353638)' },
      groupHeading: { display: 'flex', alignItems: 'baseline', gap: 7, padding: '0 2px 6px', fontSize: 13, lineHeight: '20px', fontWeight: 600, color: 'var(--dsw-alias-label-primary,#f9fafb)' },
      count: { padding: '1px 8px', borderRadius: 999, background: 'var(--dsw-alias-bg-layer-2,#2c2c2e)', fontSize: 11, lineHeight: '16px', fontWeight: 500, color: 'var(--dsw-alias-label-secondary,#cfd3d6)', fontVariantNumeric: 'tabular-nums' },
      card: { display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2,#ffffff1f)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2,#2c2c2e)' },
      cardHead: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      cardTitle: { flex: '1 1 auto', minWidth: 0, fontSize: 13, lineHeight: '20px', fontWeight: 600, color: 'var(--dsw-alias-label-primary,#f9fafb)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      badge: { flex: 'none', padding: '1px 8px', borderRadius: 999, background: 'var(--dsw-alias-bg-layer-1,#232324)', fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary,#cfd3d6)' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px 12px' },
      field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
      fieldLabel: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary,#adb2b8)' },
      input: { width: '100%', boxSizing: 'border-box', padding: '5px 8px', border: '1px solid var(--dsw-alias-border-l2,#ffffff1f)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3,#353638)', color: 'var(--dsw-alias-label-primary,#f9fafb)', font: 'inherit', fontSize: 13, lineHeight: '20px' },
      // 禁用态必须走行内样式：行内 color 的优先级高于 .dsshr-input:disabled 的类规则。
      inputDisabled: { color: 'var(--dsw-alias-label-tertiary,#adb2b8)', cursor: 'not-allowed' },
      textarea: { width: '100%', boxSizing: 'border-box', minHeight: 120, padding: '8px 10px', border: '1px solid var(--dsw-alias-border-l2,#ffffff1f)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3,#353638)', color: 'var(--dsw-alias-label-primary,#f9fafb)', fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)', fontSize: 12, lineHeight: 1.6, resize: 'vertical' },
      row: { display: 'flex', alignItems: 'flex-end', gap: 8, padding: '2px 2px 0' },
      actions: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px 0' },
      btn: { flex: 'none', appearance: 'none', border: '1px solid var(--dsw-alias-border-l2,#ffffff1f)', borderRadius: 8, padding: '5px 12px', font: 'inherit', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary,#cfd3d6)', background: 'transparent', cursor: 'pointer' },
      btnPrimary: { flex: 'none', appearance: 'none', border: '1px solid transparent', borderRadius: 8, padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: '20px', background: 'var(--dsw-alias-label-primary,#f9fafb)', color: 'var(--dsw-alias-bg-layer-3,#353638)', cursor: 'pointer' },
      btnDanger: { flex: 'none', appearance: 'none', border: '1px solid var(--dsw-alias-border-l2,#ffffff1f)', borderRadius: 8, padding: '3px 12px', font: 'inherit', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary,#cfd3d6)', background: 'transparent', cursor: 'pointer' },
      hint: { padding: '2px 2px 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary,#adb2b8)' },
      empty: { padding: '20px 2px', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary,#adb2b8)' },
      ok: { padding: '10px 0 2px', fontSize: 12, lineHeight: '17px', color: 'var(--dsw-alias-state-success-primary,#22c55e)' },
      error: { padding: '10px 0 2px', fontSize: 12, lineHeight: '17px', color: 'var(--dsw-alias-state-error-primary,#f25a5a)' },
    }

    var FIELDS = [
      { key: 'name', label: '名称', ph: '如 生产机' },
      { key: 'host', label: '主机', ph: 'IP 或域名' },
      { key: 'user', label: '用户', ph: 'root' },
      { key: 'port', label: '端口', ph: '22' },
      { key: 'identityFile', label: '私钥路径', ph: '~/.ssh/id_ed25519' },
      { key: 'jump', label: '跳板', ph: '可选，跳板主机 id' },
      { key: 'defaultCwd', label: '默认目录', ph: '可选，如 /srv/app' },
      { key: 'id', label: 'ID（工具引用）', ph: '保存后生成' },
    ]

    function SshRemoteSettings(props) {
      // 同上：初值必须是假值，默认状态才有机会建立（否则 st.hosts 为 undefined，首帧即崩）。
      var stateRef = useRef(null)
      var render = useState(0)[1]
      stateRef.current = stateRef.current || { hosts: [], dirty: false, msg: null, err: null, importOpen: false, importFormat: 'sshconfig', importText: '', importPreview: null, saving: false, pw: {}, probe: {}, target: null }

      var load = useCallback(function () {
        fetch('/ssh-remote/api/hosts').then(function (r) { return r.json() }).then(function (res) {
          if (res && res.ok) {
            stateRef.current.hosts = res.value.map(function (x) { return Object.assign({}, x) })
            stateRef.current.dirty = false
          } else stateRef.current.err = '加载失败'
          fetch('/ssh-remote/api/target').then(function (r2) { return r2.json() }).then(function (t) {
            if (t && t.ok) stateRef.current.target = t.value && t.value.active ? t.value.active : null
            render(function (n) { return n + 1 })
          }).catch(function () {})
          render(function (n) { return n + 1 })
        }).catch(function () { stateRef.current.err = 'host api unavailable'; render(function (n) { return n + 1 }) })
      }, [])
      useEffect(function () { load() }, [load])

      function setCell(i, key, v) {
        var st = stateRef.current
        st.hosts[i][key] = v
        st.dirty = true
        render(function (n) { return n + 1 })
      }
      function addRow() {
        var st = stateRef.current
        st.hosts.push({ id: '', name: '', host: '', user: 'root', port: 22, auth: 'key', identityFile: '', jump: '', defaultCwd: '', source: 'dynamic' })
        st.dirty = true
        render(function (n) { return n + 1 })
      }
      function delRow(i) {
        var st = stateRef.current
        var row = st.hosts[i]
        if (row.source === 'static') { st.err = '静态主机不可在此删除（cordis.patch.yml）'; render(function (n) { return n + 1 }); return }
        if (row.id) {
          fetch('/ssh-remote/api/hosts/' + encodeURIComponent(row.id), { method: 'DELETE' }).then(function (r) { return r.json() }).then(function (res) {
            if (res && res.ok) load()
            else { st.err = (res && res.error && res.error.message) || '删除失败'; render(function (n) { return n + 1 }) }
          }).catch(function () {
            st.err = '删除请求失败（host api unavailable）'
            render(function (n) { return n + 1 })
          })
        } else {
          st.hosts.splice(i, 1); st.dirty = true; render(function (n) { return n + 1 })
        }
      }
      function save() {
        var st = stateRef.current
        st.saving = true; st.err = null; st.msg = null
        render(function (n) { return n + 1 })
        postJson('/ssh-remote/api/hosts/bulk', { hosts: st.hosts.filter(function (x) { return x.source !== 'static' }) }).then(function (res) {
          st.saving = false
          if (res && res.ok) {
            var warns = res.warnings || []
            var dyn = (res.value || []).filter(function (x) { return x.source !== 'static' }).length
            st.msg = '已保存（' + dyn + ' 台动态主机）' + (warns.length ? '；' + warns.length + ' 条被拒绝' : '')
            st.err = warns.length ? warns.slice(0, 3).join('；') : null
            load()
          } else st.err = (res && res.error && res.error.message) || '保存失败'
          render(function (n) { return n + 1 })
        }).catch(function () { st.saving = false; st.err = '保存请求失败（host api unavailable）'; render(function (n) { return n + 1 }) })
      }
      function doImport(preview) {
        var st = stateRef.current
        postJson('/ssh-remote/api/hosts/import', { format: st.importFormat, text: st.importText, commit: !preview }).then(function (res) {
          if (res && res.ok) {
            if (preview) st.importPreview = res.value.preview
            else { st.importPreview = null; st.importOpen = false; st.importText = ''; st.msg = '导入完成'; load() }
          } else st.err = (res && res.error && res.error.message) || '导入失败'
          render(function (n) { return n + 1 })
        }).catch(function () { st.err = '导入请求失败（host api unavailable）'; render(function (n) { return n + 1 }) })
      }
      function setTarget(i) {
        var st = stateRef.current
        var row = st.hosts[i]
        if (!row.id) { st.err = '请先保存主机（需要 id）后再设为目标'; render(function (n) { return n + 1 }); return }
        putJson('/ssh-remote/api/target', { hostId: row.id, path: row.defaultCwd || '~' }).then(function (res) {
          if (res && res.ok) { st.target = res.value && res.value.active; st.err = null; st.msg = '已设为远程目标：' + row.id + ':' + (row.defaultCwd || '~') }
          else st.err = (res && res.error && res.error.message) || '设置失败'
          render(function (n) { return n + 1 })
        }).catch(function () { st.err = '请求失败（host api unavailable）'; render(function (n) { return n + 1 }) })
      }
      function testConn(i) {
        var st = stateRef.current
        var row = st.hosts[i]
        if (!row.id) return
        st.probe[i] = { pending: true }
        render(function (n) { return n + 1 })
        postJson('/ssh-remote/api/probe', { hostId: row.id }).then(function (res) {
          if (res && res.ok) st.probe[i] = { ok: !!res.value.ok, degraded: !!res.value.degraded, latencyMs: res.value.latencyMs, error: res.value.error }
          else st.probe[i] = { ok: false, error: (res && res.error && res.error.message) || '探测失败' }
          render(function (n) { return n + 1 })
        }).catch(function () { st.probe[i] = { ok: false, error: '请求失败（host api unavailable）' }; render(function (n) { return n + 1 }) })
      }
      function savePw(i) {
        var st = stateRef.current
        var row = st.hosts[i]
        var value = (st.pw[i] && st.pw[i].value) || ''
        if (!row.user || !row.host) { st.err = '请先填写「用户」与「主机」，再设置密码'; render(function (n) { return n + 1 }); return }
        if (!value) { st.err = '密码不能为空'; render(function (n) { return n + 1 }); return }
        putJson('/ssh-remote/api/credentials', { user: row.user, host: row.host, password: value }).then(function (res) {
          if (res && res.ok) { row.hasPassword = true; st.pw[i] = null; st.err = null; st.msg = '密码已写入加密凭据库（' + row.user + '@' + row.host + '）' }
          else st.err = (res && res.error && res.error.message) || '密码保存失败'
          render(function (n) { return n + 1 })
        }).catch(function () { st.err = '密码保存请求失败（host api unavailable）'; render(function (n) { return n + 1 }) })
      }
      function clearPw(i) {
        var st = stateRef.current
        var row = st.hosts[i]
        fetch('/ssh-remote/api/credentials/' + encodeURIComponent(row.user + '@' + row.host), { method: 'DELETE' }).then(function (r) { return r.json() }).then(function (res) {
          if (res && res.ok) { row.hasPassword = false; st.msg = '已清除该主机的密码凭据' }
          else st.err = (res && res.error && res.error.message) || '清除失败'
          render(function (n) { return n + 1 })
        }).catch(function () { st.err = '请求失败（host api unavailable）'; render(function (n) { return n + 1 }) })
      }
      function exportJson() {
        var blob = new Blob([JSON.stringify(stateRef.current.hosts, null, 2)], { type: 'application/json' })
        var a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'ssh-remote-hosts.json'
        a.click()
        setTimeout(function () { URL.revokeObjectURL(a.href) }, 0)
      }

      var st = stateRef.current
      var canSave = st.dirty && !st.saving

      function authField(row, i) {
        return h('label', { key: 'auth', style: SS.field },
          h('span', { style: SS.fieldLabel }, '登录方式'),
          h('select', {
            style: Object.assign({}, SS.input, { width: 130 }),
            className: 'dsshr-input',
            value: row.auth || 'agent',
            onChange: function (e) { setCell(i, 'auth', e.target.value) },
          },
            h('option', { value: 'key' }, '私钥'),
            h('option', { value: 'password' }, '密码'),
            h('option', { value: 'agent' }, 'agent/config')
          )
        )
      }
      function pwField(row, i) {
        var st = stateRef.current
        var edit = st.pw[i]
        // 跨 2 列 + 允许换行：编辑态是"输入框 + 保存 + 取消"一行，单格宽度装不下，
        // 会溢出到下一格并被其输入框压住（用户点不到保存 → 密码存不上）。
        return h('div', { key: 'pw', style: Object.assign({}, SS.field, { gridColumn: 'span 2' }) },
          h('span', { style: SS.fieldLabel }, '登录密码'),
          edit && edit.editing
            ? h('div', { style: { display: 'flex', gap: 6, minWidth: 0, flexWrap: 'wrap' } },
                h('input', {
                  style: Object.assign({}, SS.input, { width: 'auto', flex: '1 1 130px', minWidth: 0 }),
                  className: 'dsshr-input',
                  type: 'password',
                  value: edit.value,
                  placeholder: '仅写入加密凭据库',
                  onChange: function (e) { st.pw[i] = { editing: true, value: e.target.value }; render(function (n) { return n + 1 }) },
                }),
                h('button', { type: 'button', style: SS.btnPrimary, className: 'dsshr-btn-primary', onClick: function () { savePw(i) } }, '保存'),
                h('button', { type: 'button', style: SS.btn, className: 'dsshr-btn', onClick: function () { st.pw[i] = null; render(function (n) { return n + 1 }) } }, '取消')
              )
            : h('div', { style: { display: 'flex', gap: 6, minWidth: 0, flexWrap: 'wrap' } },
                h('button', { type: 'button', style: SS.btn, className: 'dsshr-btn', onClick: function () { st.pw[i] = { editing: true, value: '' }; render(function (n) { return n + 1 }) } }, row.hasPassword ? '已设置 · 更换' : '设置密码'),
                row.hasPassword && h('button', { type: 'button', style: SS.btnDanger, className: 'dsshr-btn-danger', onClick: function () { clearPw(i) } }, '清除')
              )
        )
      }
      function fieldsOf(row, i) {
        var byKey = {}
        FIELDS.forEach(function (f) { byKey[f.key] = f })
        var out = [fieldOf(row, i, byKey.name), fieldOf(row, i, byKey.host), fieldOf(row, i, byKey.user), fieldOf(row, i, byKey.port)]
        out.push(authField(row, i))
        if (row.auth === 'key') out.push(fieldOf(row, i, byKey.identityFile))
        if (row.auth === 'password') out.push(pwField(row, i))
        out.push(fieldOf(row, i, byKey.jump))
        out.push(fieldOf(row, i, byKey.defaultCwd))
        out.push(fieldOf(row, i, byKey.id))
        return out
      }

      function fieldOf(row, i, f) {
        var editable = row.source !== 'static'
        var v = row[f.key]
        return h('label', { key: f.key, style: SS.field },
          h('span', { style: SS.fieldLabel }, f.label),
          h('input', {
            style: editable ? SS.input : Object.assign({}, SS.input, SS.inputDisabled),
            className: 'dsshr-input',
            value: v === undefined || v === null ? '' : String(v),
            disabled: !editable,
            placeholder: f.ph || '',
            onChange: function (e) { setCell(i, f.key, e.target.value) },
          })
        )
      }

      return h('div', { style: SS.section },
        h('p', { style: SS.intro }, 'SSH 远程主机管理：动态主机在此增删改，保存后立即生效（无需重启）；静态主机来自 profile cordis.patch.yml，仅展示。'),
        st.msg && h('div', { style: SS.ok }, st.msg),
        st.err && h('div', { style: SS.error }, st.err),
        h('div', { style: SS.group },
          h('div', { style: SS.groupHeading }, '主机', h('span', { style: SS.count }, st.hosts.length + ' 台')),
          st.hosts.length === 0 && h('div', { style: SS.empty }, '暂无主机：点下方「新增主机」逐条添加，或用「批量导入」从 ~/.ssh/config、JSON、YAML 导入。'),
          st.hosts.map(function (row, i) {
            return h('div', { key: i, style: SS.card, 'data-ssh-host': row.id || 'draft-' + i },
              h('div', { style: SS.cardHead },
                h('span', { style: SS.cardTitle }, row.name || row.host || '未命名主机'),
                h('span', { style: SS.badge }, row.source === 'static' ? '静态' : '动态'),
                st.target && st.target.hostId === row.id && h('span', { style: Object.assign({}, SS.badge, { color: 'var(--dsw-alias-state-success-primary,#22c55e)' }) }, '★ 当前目标'),
                h('button', {
                  type: 'button',
                  style: Object.assign({}, SS.btn, row.id ? null : { opacity: 0.45, cursor: 'not-allowed' }),
                  className: 'dsshr-btn',
                  disabled: !row.id,
                  title: '把该主机目录设为远程目标（agent 将在此目录干活）',
                  onClick: function () { setTarget(i) },
                }, '设为目标'),
                h('button', {
                  type: 'button',
                  style: Object.assign({}, SS.btn, row.id ? null : { opacity: 0.45, cursor: 'not-allowed' }),
                  className: 'dsshr-btn',
                  disabled: !row.id,
                  title: row.id ? '建立连接并测连通性' : '保存后可测试（需要 id）',
                  onClick: function () { testConn(i) },
                }, (st.probe[i] && st.probe[i].pending) ? '测试中…' : '测试连接'),
                row.source === 'static'
                  ? h('span', { style: SS.hint }, '来自 cordis.patch.yml')
                  : h('button', { type: 'button', style: SS.btnDanger, className: 'dsshr-btn-danger', onClick: function () { delRow(i) } }, '删除')
              ),
              st.probe[i] && !st.probe[i].pending && h('div', { style: st.probe[i].ok ? SS.ok : SS.error },
                st.probe[i].ok
                  ? ('✓ 连通' + (st.probe[i].degraded ? '（降级直连）' : '') + (st.probe[i].latencyMs !== undefined && st.probe[i].latencyMs !== null ? ' · ' + st.probe[i].latencyMs + 'ms' : ''))
                  : ('✗ ' + (st.probe[i].error || '连接失败'))),
              h('div', { style: SS.grid }, fieldsOf(row, i)),
              row.source === 'static' && h('div', { style: SS.hint }, '静态主机不可在此编辑或删除。')
            )
          }),
          h('div', { style: SS.actions },
            h('button', { type: 'button', style: SS.btn, className: 'dsshr-btn', onClick: addRow }, '+ 新增主机'),
            h('button', { type: 'button', style: SS.btn, className: 'dsshr-btn', onClick: function () { st.importOpen = !st.importOpen; st.importPreview = null; render(function (n) { return n + 1 }) } }, st.importOpen ? '收起导入' : '批量导入'),
            h('button', { type: 'button', style: SS.btn, className: 'dsshr-btn', onClick: exportJson }, '导出 JSON'),
            h('span', { style: { flex: '1 1 auto' } }),
            h('button', { type: 'button', disabled: !canSave, style: SS.btnPrimary, className: 'dsshr-btn-primary', onClick: save }, st.saving ? '保存中…' : '保存动态主机')
          )
        ),
        st.importOpen && h('div', { style: SS.group },
          h('div', { style: SS.groupHeading }, '批量导入'),
          h('div', { style: SS.row },
            h('label', { style: SS.field },
              h('span', { style: SS.fieldLabel }, '配置格式'),
              h('select', {
                style: Object.assign({}, SS.input, { width: 130 }),
                className: 'dsshr-input',
                value: st.importFormat,
                onChange: function (e) { st.importFormat = e.target.value; render(function (n) { return n + 1 }) },
              },
                h('option', { value: 'sshconfig' }, '~/.ssh/config'),
                h('option', { value: 'json' }, 'JSON'),
                h('option', { value: 'yaml' }, 'YAML')
              )
            ),
            h('span', { style: { flex: '1 1 auto' } }),
            h('button', { type: 'button', style: SS.btn, className: 'dsshr-btn', onClick: function () { doImport(true) } }, '预览'),
            h('button', { type: 'button', style: SS.btnPrimary, className: 'dsshr-btn-primary', disabled: !st.importPreview, onClick: function () { doImport(false) } }, '确认导入')
          ),
          h('textarea', {
            style: SS.textarea,
            className: 'dsshr-textarea',
            value: st.importText,
            placeholder: '粘贴配置文本…',
            onChange: function (e) { st.importText = e.target.value; render(function (n) { return n + 1 }) },
          }),
          st.importPreview && h('div', null,
            h('div', { style: SS.hint }, '解析到 ' + st.importPreview.hosts.length + ' 台；问题 ' + st.importPreview.errors.length + ' 条'),
            st.importPreview.errors.map(function (e, i) { return h('div', { key: 'e' + i, style: SS.error }, e) }),
            st.importPreview.hosts.map(function (x, i) {
              return h('div', { key: 'h' + i, style: SS.hint }, x.id + ' → ' + x.host + (x.jump ? '（经 ' + x.jump + '）' : ''))
            })
          )
        )
      )
    }

    /* ---- 目录来源切换：本机 / 远程主机 ----
       为什么需要接管：壳的目录对话框只会列本机目录，而远程工作区必须建在它所属的
       世界里（上游 SSH 世界是进程级的），所以远程来源不是"在本地窗口里选个远端
       路径"，而是"连到那台机器的窗口去选"。本机来源仍走原有原生对话框。 */
    var S2 = {
      mask: { position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
      dlg: { width: 560, maxWidth: '92vw', maxHeight: '78vh', overflow: 'auto', background: 'var(--dsw-alias-bg-layer-1,#1f1f1f)', border: '1px solid var(--dsw-alias-border-l1,#88888866)', borderRadius: 12, padding: '14px 16px', textAlign: 'left', color: 'var(--dsw-alias-label-primary,inherit)', fontSize: 13 },
      tabs: { display: 'flex', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--dsw-alias-border-l1,#88888866)', paddingBottom: 10 },
      tab: { font: 'inherit', fontSize: 12, padding: '4px 12px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l1,#88888866)', background: 'transparent', color: 'var(--dsw-alias-label-secondary,#bbb)', cursor: 'pointer' },
      tabOn: { background: 'var(--dsw-alias-bg-layer-2,#2a2a2a)', color: 'var(--dsw-alias-label-primary,#fff)', fontWeight: 600 },
      row: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', margin: '4px 0', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1,#88888866)' },
      grow: { flex: '1 1 auto', minWidth: 0 },
      nm: { fontWeight: 600, color: 'var(--dsw-alias-label-primary,inherit)' },
      sub: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary,#888)', marginTop: 2, wordBreak: 'break-all' },
      hint: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary,#888)', margin: '8px 0' },
      err: { color: '#e5484d', fontSize: 11, marginTop: 6, wordBreak: 'break-all' },
      log: { fontSize: 10, fontFamily: 'ui-monospace, monospace', color: 'var(--dsw-alias-label-secondary,#aaa)', whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto', background: 'var(--dsw-alias-bg-layer-2,#2a2a2a)', borderRadius: 6, padding: 8, marginTop: 8 },
      foot: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
      crumbs: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
      crumb: { font: 'inherit', fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#88888866)', background: 'transparent', color: 'var(--dsw-alias-label-secondary,#bbb)', cursor: 'pointer' },
    }

    function SshDirectoryFlow(props) {
      var open = props.open, busy = props.busy
      // 值域与 setter 必须来自**同一次** useState：拆成两次调用时 setter 属于
      // 另一个单元，状态永远不更新（只重渲染）——2026-09-26 实机踩到。
      var pair = useState({ source: 'local', hosts: [], worlds: [], log: null, busy: false, error: null, detail: null, remote: null, listing: null, loading: false })
      var st = pair[0]
      var set = pair[1]
      var render = function (patch) { set(function (s) { return Object.assign({}, s, patch) }) }
      useEffect(function () {
        if (!open) return
        render({ error: null })
        fetch('/ssh-remote/api/world').then(function (r) { return r.json() }).then(function (res) {
          var remote = !!(res && res.ok && res.value && res.value.remote)
          render({ remote: remote })
          // 远程世界：直接进应用内浏览（本世界就是那台机器），无来源可切换。
          if (remote) loadListing(undefined)
        }).catch(function () { render({ remote: false }) })
        fetch('/ssh-remote/api/hosts').then(function (r) { return r.json() }).then(function (res) {
          render({ hosts: res && res.ok && res.value ? res.value : [] })
        }).catch(function () { render({ error: '读取主机列表失败' }) })
        fetch('/ssh-remote/api/worlds').then(function (r) { return r.json() }).then(function (res) {
          render({ worlds: res && res.ok && res.value ? res.value : [] })
        }).catch(function () {})
      }, [open])
      if (!open) return null
      var browser = function () {
        var l = st.listing
        return h('div', null,
          l ? h('div', { style: S2.crumbs }, l.crumbs.map(function (c, i) {
            return h('button', { key: 'c' + i, type: 'button', style: S2.crumb, onClick: function () { loadListing(c.path) } }, c.name)
          })) : null,
          st.loading ? h('div', { style: S2.hint }, '加载中…') : null,
          l && l.entries.length === 0 && !st.loading ? h('div', { style: S2.hint }, '（此目录下没有子目录）') : null,
          l ? l.entries.map(function (en) {
            return h('div', { key: en.path, style: S2.row },
              h('div', { style: S2.grow, onClick: function () { loadListing(en.path) }, cursor: 'pointer' }, h('div', { style: S2.nm }, en.name)),
              h('button', { type: 'button', style: S2.tab, onClick: function () { loadListing(en.path) } }, '进入')
            )
          }) : null,
          l && l.truncated ? h('div', { style: S2.hint }, '目录过多，仅显示开头部分。') : null,
          h('div', { style: S2.hint }, '当前：' + (l ? l.path : '—')),
          h('div', { style: S2.foot },
            h('button', { type: 'button', style: S2.tab, onClick: props.onCancel }, '取消'),
            h('button', { type: 'button', style: Object.assign({}, S2.tab, S2.tabOn), disabled: !l || busy === true, onClick: function () { if (l) props.onPicked(l.path) } }, '选为工作区')
          )
        )
      }
      var byId = {}
      st.hosts.forEach(function (h) { byId[h.id] = h })
      var worldOf = {}
      st.worlds.forEach(function (w) { worldOf[w.hostId] = w })
      // 应用内逐层浏览（远程世界唯一可用的来源；本地世界在系统对话框不可用时也用它）
      var loadListing = function (path) {
        var ui = props.ui
        if (!ui || !ui.listDirectory) { render({ error: '当前载体没有目录枚举能力' }); return }
        render({ loading: true, error: null })
        ui.listDirectory(path).then(function (listing) {
          render({ loading: false, listing: listing })
        }, function (err) { render({ loading: false, error: String((err && err.message) || err) }) })
      }
      var pickLocal = function () {
        if (!props.ui || !props.ui.pickDirectory) { props.onError('当前载体没有本地目录选择能力'); return }
        props.ui.pickDirectory().then(function (path) {
          if (path === null || path === undefined) props.onCancel(); else props.onPicked(path)
        }, function () {
          // 系统对话框不可用（后端是应用内 browse，例如远程世界或 SSH 启动）：
          // 就地切成应用内浏览，而不是把用户堵在报错上。
          loadListing(undefined)
          render({ source: 'browse' })
        })
      }
      var connect = function (hostId) {
        render({ busy: true, error: null })
        postJson('/ssh-remote/api/remote-open', { hostId: hostId }).then(function (res) {
          if (res && res.ok) {
            render({ busy: false })
            props.onCancel()
          } else {
            render({ busy: false, error: (res && res.error && res.error.message) || '无法请求打开远程窗口' })
          }
        }, function (err) { render({ busy: false, error: '请求失败：' + String((err && err.message) || err) }) })
      }
      var provision = function (hostId) {
        render({ busy: true, error: null, log: ['开始引导…'] })
        postJson('/ssh-remote/api/provision', { hostId: hostId }).then(function (res) {
          var log = (res && res.log) || []
          if (res && res.ok) {
            var done = res.value && res.value.spec ? res.value.spec.workspace : ''
            render({ busy: false, log: log.concat(['完成：远端工作区 ' + done]) })
            fetch('/ssh-remote/api/worlds').then(function (r) { return r.json() }).then(function (wr) {
              render({ worlds: wr && wr.ok && wr.value ? wr.value : [] })
            }).catch(function () {})
          } else {
            render({ busy: false, log: log, error: (res && res.error && res.error.message) || '引导失败', detail: res && res.error && res.error.detail })
          }
        }, function (err) { render({ busy: false, error: '引导请求失败：' + String((err && err.message) || err) }) })
      }
      var hosts = st.hosts
      return h('div', { style: S2.mask, onClick: function (e) { if (e.target === e.currentTarget) props.onCancel() } },
        h('div', { style: S2.dlg },
          h('div', { style: S2.tabs },
            h('button', { type: 'button', style: Object.assign({}, S2.tab, st.source === 'local' ? S2.tabOn : null), onClick: function () { render({ source: 'local' }) } }, '本机'),
            h('button', { type: 'button', style: Object.assign({}, S2.tab, st.source === 'remote' ? S2.tabOn : null), onClick: function () { render({ source: 'remote' }) } }, '远程主机')
          ),
          st.remote === true
            ? browser()
            : st.source === 'local'
            ? h('div', null,
                h('div', { style: S2.hint }, '用系统目录对话框选择本机目录。'),
                h('div', { style: S2.foot },
                  h('button', { type: 'button', style: S2.tab, onClick: props.onCancel }, '取消'),
                  h('button', { type: 'button', style: Object.assign({}, S2.tab, S2.tabOn), disabled: busy === true, onClick: pickLocal }, '选择目录…')
                )
              )
            : st.source === 'browse'
            ? browser()
            : h('div', null,
                hosts.length === 0
                  ? h('div', { style: S2.hint }, '还没有配置远程主机。到「设置 → SSH 远程主机」添加一台。')
                  : hosts.map(function (host) {
                      var world = worldOf[host.id]
                      return h('div', { key: host.id, style: S2.row },
                        h('div', { style: S2.grow },
                          h('div', { style: S2.nm }, host.name || host.id),
                          h('div', { style: S2.sub }, host.user + '@' + host.host + ':' + host.port),
                          h('div', { style: S2.sub }, world
                            ? '已就绪 · 远端工作区可建在 ' + world.workspace
                            : '未引导（需装 Node 与运行组件）')
                        ),
                        h('button', { type: 'button', style: S2.tab, disabled: st.busy === true, onClick: function () { provision(host.id) } }, world ? '重新引导' : '引导'),
                        h('button', { type: 'button', style: Object.assign({}, S2.tab, world ? S2.tabOn : null), disabled: st.busy !== true && !world, onClick: function () { connect(host.id) } }, '连接')
                      )
                    }),
                h('div', { style: S2.hint }, '远程工作区建在那台机器的世界里——点「连接」会打开它的窗口，在那里用目录对话框逐层点选远端目录。'),
                st.log ? h('div', { style: S2.log }, st.log.join('\n')) : null,
                st.error ? h('div', { style: S2.err }, st.error + (st.detail ? '：' + st.detail : '')) : null,
                h('div', { style: S2.foot }, h('button', { type: 'button', style: S2.tab, onClick: props.onCancel }, '取消'))
              )
        )
      )
    }

    return {
      inject: ['slots'],
      apply: function (ctx) {
        ensureStyle()
        ctx.slots.inject('conversation.session.header.utilities', function () {
          return ctx.slots.register(
            { name: 'conversation.session.header.utilities', id: 'ssh-remote', order: 116, label: 'SSH' },
            SshRemoteUtility
          )
        })
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            { name: 'settings.section', id: 'ssh-remote', order: 116, label: 'SSH 远程主机' },
            SshRemoteSettings
          )
        })
        // 来源切换：接管两个目录流洞（priority -1 遮蔽内置占用者；上游
        // ui-slots 的既定遮蔽语义——升序优先级、最低者渲染）。本机来源仍走
        // 原生对话框，故是超集而非替换。
        var flowInjected = function () { return { ui: ctx.get('uiWorkspace') } }
        ;['sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow'].forEach(function (hole) {
          ctx.slots.inject(hole, function () {
            return ctx.slots.register({ name: hole, priority: -1, inject: flowInjected }, SshDirectoryFlow)
          })
        })
      },
    }
  },
})
