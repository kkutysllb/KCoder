/**
 * git 环境面板视图（#/git，承载于 shell 窗口右侧的透明 WebContentsView）：
 * 浮动卡片（圆角/阴影/边框在页面内绘制，view 本体透明）。
 * 分支/同步态 + 变更计数 + 提交（全部）/ 推送 / 分支切换与新建 + 最近提交。
 *
 * - 数据：IPC git:snapshot 初拉 + git:changed 推送（主进程探测，
 *   15s 轮询 + agent 文件活动 2s debounce 触发）；
 * - 写操作：git:commit / git:push / git:branch-switch / git:branch-create，
 *   busy/fetching 态全部按钮禁用；失败错误以底部 toast 透出（git 原文首行）；
 * - 提交语义 = 全部变更（add -A + commit -m），桌面工具心智模型；
 *   精细暂存交给内嵌终端；
 * - 主题：prefers-color-scheme 双套 token（theme-watcher 已同步
 *   nativeTheme 与上游主题）。
 *
 * @module desktop/renderer/src/views/git
 */

import { bridge } from '../bridge'
import type { GitSnapshot, SubagentEntry, TrajectoryRow } from '@shared/ipc-contract'

/** 视图内样式（独立于 app.css；页面透明，卡片承色）。 */
const PAGE_CSS = `
html, body { height: 100%; margin: 0; overflow: hidden; background: transparent; }
#app { height: 100%; font: 400 12px/1.55 -apple-system, "PingFang SC", "Segoe UI", sans-serif; }
/* 浮动卡片：view 矩形透明，视觉主体在这里（圆角+阴影+边框） */
.gt-card { height: 100%; display: flex; flex-direction: column; border-radius: 12px; border: 1px solid var(--gt-border); background: var(--gt-bg); box-shadow: 0 14px 44px rgba(9, 16, 29, .22), 0 2px 8px rgba(9, 16, 29, .10); overflow: hidden; color: var(--gt-fg); }
.gt-card { --gt-bg: #FFFFFF; --gt-header: #F9FAFB; --gt-fg: #1A1D21; --gt-border: rgba(0,0,0,.10); --gt-muted: rgba(26,29,33,.55); --gt-chip: rgba(128,128,128,.14); --gt-hover: rgba(128,128,128,.12); --gt-accent: #2F6FED; --gt-add: #1A7F37; --gt-del: #CF222E; --gt-mono: ui-monospace, Menlo, Monaco, monospace; }
@media (prefers-color-scheme: dark) {
.gt-card { --gt-bg: #1B1B1C; --gt-header: #222325; --gt-fg: #E8EAED; --gt-border: #2C2C2E; --gt-muted: rgba(232,234,237,.55); --gt-chip: rgba(128,128,128,.18); --gt-hover: rgba(128,128,128,.16); --gt-accent: #7C9BFF; --gt-add: #3FB950; --gt-del: #F85149; box-shadow: 0 14px 44px rgba(0, 0, 0, .55), 0 2px 8px rgba(0, 0, 0, .4); }
}
.gt-header { flex: none; height: 34px; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 12px; background: var(--gt-header); border-bottom: 1px solid var(--gt-border); user-select: none; }
.gt-branch { display: inline-flex; align-items: center; gap: 5px; min-width: 0; flex: 1; font: 600 12px/1 var(--gt-mono); }
.gt-branch .gt-bname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gt-branch svg { width: 13px; height: 13px; flex: none; color: var(--gt-accent); }
.gt-track { flex: none; font: 500 10px/1 var(--gt-mono); color: var(--gt-muted); max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gt-track .up { color: var(--gt-add); }
.gt-track .down { color: var(--gt-del); }
.gt-btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; cursor: pointer; color: var(--gt-muted); flex: none; }
.gt-btn:hover { background: var(--gt-hover); color: var(--gt-fg); }
.gt-btn:disabled { opacity: .4; cursor: default; }
.gt-btn:disabled:hover { background: transparent; }
.gt-btn svg { width: 14px; height: 14px; }
.gt-status { flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--gt-border); }
.gt-lines { font: 650 12px/1.2 var(--gt-mono); font-variant-numeric: tabular-nums; margin-right: 2px; }
.gt-lines .a { color: var(--gt-add); }
.gt-lines .d { color: var(--gt-del); margin-left: 4px; }
.gt-pill { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 6px; background: var(--gt-chip); }
.gt-pill b { font: 650 11px/1.2 var(--gt-mono); font-variant-numeric: tabular-nums; }
.gt-pill span { font-size: 10px; color: var(--gt-muted); }
.gt-tabs { flex: none; display: flex; gap: 2px; padding: 6px 10px 0; border-bottom: 1px solid var(--gt-border); user-select: none; }
.gt-tab { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; height: 26px; padding: 0 12px; border-radius: 7px 7px 0 0; cursor: pointer; font-size: 11px; color: var(--gt-muted); }
.gt-tab:hover { color: var(--gt-fg); }
.gt-tab[data-on="1"] { color: var(--gt-fg); font-weight: 600; box-shadow: inset 0 -2px 0 var(--gt-accent); }
.gt-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 16px; }
.gt-label { font-size: 10px; color: var(--gt-muted); margin: 4px 0 6px; letter-spacing: .5px; user-select: none; }
.gt-msg { box-sizing: border-box; width: 100%; height: 64px; resize: none; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--gt-border); background: var(--gt-bg); color: var(--gt-fg); font: 400 12px/1.5 inherit; outline: none; }
.gt-msg:focus { border-color: var(--gt-accent); }
.gt-msg::placeholder { color: var(--gt-muted); }
.gt-actions { display: flex; gap: 8px; margin-top: 8px; }
.gt-main { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: 26px; padding: 0 14px; border-radius: 7px; cursor: pointer; background: var(--gt-accent); color: #FFF; font-size: 11px; font-weight: 600; }
.gt-main:hover { filter: brightness(1.08); }
.gt-main:disabled { opacity: .45; cursor: default; }
.gt-ghost { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: 26px; padding: 0 12px; border-radius: 7px; cursor: pointer; border: 1px solid var(--gt-border); color: var(--gt-fg); font-size: 11px; }
.gt-ghost:hover { background: var(--gt-hover); }
.gt-ghost:disabled { opacity: .45; cursor: default; }
.gt-hint { margin-top: 8px; font-size: 10px; color: var(--gt-muted); }
.gt-brow { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 7px; width: 100%; height: 26px; padding: 0 9px; border-radius: 7px; cursor: pointer; font: 500 12px/1 var(--gt-mono); }
.gt-brow:hover { background: var(--gt-hover); }
.gt-brow .dot { width: 6px; height: 6px; border-radius: 50%; border: 1.5px solid var(--gt-muted); flex: none; }
.gt-brow[data-cur="1"] { font-weight: 650; }
.gt-brow[data-cur="1"] .dot { border-color: var(--gt-add); background: var(--gt-add); }
.gt-brow .here { font-size: 9px; color: var(--gt-muted); margin-left: auto; }
.gt-newrow { display: flex; gap: 6px; margin-top: 8px; }
.gt-newrow input { box-sizing: border-box; flex: 1; min-width: 0; height: 26px; padding: 0 9px; border-radius: 7px; border: 1px solid var(--gt-border); background: var(--gt-bg); color: var(--gt-fg); font: 400 12px/1 var(--gt-mono); outline: none; }
.gt-newrow input:focus { border-color: var(--gt-accent); }
.gt-caps { margin: 14px 0 4px; font-size: 10px; color: var(--gt-muted); letter-spacing: .5px; user-select: none; }
.gt-caps::after { content: ''; display: inline-block; width: 60px; height: 1px; background: linear-gradient(to right, var(--gt-border), transparent); vertical-align: middle; margin-left: 6px; }
.gt-caps.foldable { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.gt-caps.foldable::after { width: auto; flex: 1; max-width: 60px; }
.gt-caps.foldable:hover { color: var(--gt-fg); }
.gt-caret { flex: none; font-size: 9px; line-height: 1; transition: transform .15s ease; }
.gt-caps[data-fold="1"] .gt-caret { transform: rotate(-90deg); }
.gt-plan { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border-radius: 7px; cursor: pointer; }
.gt-plan:hover { background: var(--gt-hover); }
.gt-plan svg { width: 13px; height: 13px; flex: none; color: var(--gt-accent); display: block; }
.gt-plan .t { flex: 1; min-width: 0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gt-plan .w { flex: none; font-size: 10px; color: var(--gt-muted); }
.gt-commit { display: flex; gap: 8px; align-items: baseline; padding: 4px 2px; border-radius: 6px; }
.gt-commit:hover { background: var(--gt-hover); }
.gt-commit .hash { flex: none; font: 500 11px/1.4 var(--gt-mono); color: var(--gt-accent); }
.gt-commit .subj { flex: 1; min-width: 0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gt-commit .when { flex: none; font-size: 10px; color: var(--gt-muted); }
.gt-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; height: 100%; color: var(--gt-muted); font-size: 12px; text-align: center; padding: 0 20px; }
.gt-toast { position: fixed; left: 10px; right: 10px; bottom: 10px; padding: 8px 12px; border-radius: 8px; background: color-mix(in srgb, var(--gt-del) 12%, var(--gt-bg)); border: 1px solid color-mix(in srgb, var(--gt-del) 35%, transparent); color: var(--gt-del); font-size: 11px; display: none; }
.gt-toast[data-show="1"] { display: block; }
/* 子代理监控（状态点 running 呼吸灯；行点击展开轨迹） */
.gt-sub { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border-radius: 7px; cursor: pointer; }
.gt-sub:hover { background: var(--gt-hover); }
.gt-sub .st { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--gt-chip); box-shadow: 0 0 0 2px var(--gt-chip) inset; }
.gt-sub[data-run="1"] .st { background: var(--gt-accent); animation: gt-pulse 1.6s ease-in-out infinite; }
@keyframes gt-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.gt-sub .lb { flex: none; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 12px; }
.gt-sub .tk { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--gt-muted); }
.gt-sub .tk:empty::before { content: '（任务待观察）'; }
.gt-sub .at { flex: none; max-width: 76px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9.5px; color: var(--gt-accent); opacity: .85; }
.gt-sub .tc { flex: none; font: 500 10px/1.2 var(--gt-mono); color: var(--gt-muted); font-variant-numeric: tabular-nums; }
.gt-sub .tc b { color: var(--gt-fg); }
.gt-sub-traj { margin: 2px 0 6px 4px; padding-left: 10px; border-left: 1px solid var(--gt-border); display: flex; flex-direction: column; gap: 1px; }
.gt-tr { display: flex; align-items: baseline; gap: 6px; font-size: 11px; color: var(--gt-muted); padding: 1px 2px; border-radius: 4px; }
.gt-tr .ic { flex: none; font: 650 9px/1.6 var(--gt-mono); letter-spacing: .3px; }
.gt-tr[data-k="user"] .ic { color: var(--gt-accent); }
.gt-tr[data-k="tool"] .ic { color: var(--gt-muted); }
.gt-tr[data-k="assistant"] .ic { color: var(--gt-add); }
.gt-tr .tx { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gt-tr[data-k="tool"] .tx { font-family: var(--gt-mono); font-size: 10.5px; }
.gt-tr[data-ok="err"] .tx { color: var(--gt-del); }
.gt-tr .ms { flex: none; font: 500 9.5px/1.6 var(--gt-mono); opacity: .8; }
.gt-tr[data-ok="run"] .ms { color: var(--gt-accent); }
`

/** 空/占位快照（挂载后第一次推送前）。 */
const EMPTY: GitSnapshot = {
  workspace: null, isRepo: false, branch: null, upstream: null, ahead: null, behind: null,
  staged: 0, changed: 0, untracked: 0, added: 0, removed: 0, branches: [], plans: [], commits: [],
  fetching: false, busy: false, error: null,
}

export function mountGit(app: HTMLDivElement): void {
  document.title = 'git'
  const style = document.createElement('style')
  style.textContent = PAGE_CSS
  document.head.append(style)

  let snap: GitSnapshot = EMPTY
  let tab: 'commit' | 'branch' = 'commit'
  let toastTimer = 0

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag)
    if (cls !== '') n.className = cls
    if (text !== '') n.textContent = text
    return n
  }
  const SVG = {
    branch: '<svg viewBox="0 0 16 16" fill="none"><circle cx="4.5" cy="4" r="1.7" fill="currentColor"/><circle cx="11.5" cy="3.2" r="1.7" fill="currentColor"/><circle cx="4.5" cy="12" r="1.7" fill="currentColor"/><circle cx="11.5" cy="12.8" r="1.7" fill="currentColor"/><path d="M4.5 5.7v4.6M11.5 4.9v6M6.2 4h3.6M6.2 12h3.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    fetch: '<svg viewBox="0 0 16 16" fill="none"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  }

  /* ---- 骨架（浮动卡片层） ---- */
  app.className = ''
  const card = el('div', 'gt-card')
  const header = el('div', 'gt-header')
  const bIcon = el('span', '', '')
  bIcon.innerHTML = SVG.branch
  const bName = el('span', 'gt-bname', '')
  const bTrack = el('span', 'gt-track', '')
  const fetchBtn = el('button', 'gt-btn')
  fetchBtn.innerHTML = SVG.fetch
  fetchBtn.title = 'Fetch 拉取上游'
  const closeBtn = el('button', 'gt-btn')
  closeBtn.innerHTML = SVG.close
  closeBtn.title = '关闭面板'
  header.append(bIcon, bName, bTrack, fetchBtn, closeBtn)

  const status = el('div', 'gt-status')
  const lines = el('span', 'gt-lines')
  const la = el('b', 'a', '+0')
  const ld = el('b', 'd', '\u22120')
  lines.append(la, ld)
  const pill = (label: string): HTMLElement => {
    const p = el('span', 'gt-pill')
    p.append(el('b', '', '0'), el('span', '', label))
    return p
  }
  const pStaged = pill('已暂存')
  const pChanged = pill('已修改')
  const pUntracked = pill('未跟踪')
  status.append(lines, pStaged, pChanged, pUntracked)

  const tabs = el('div', 'gt-tabs')
  const tabCommit = el('button', 'gt-tab', '提交')
  const tabBranch = el('button', 'gt-tab', '分支')
  tabs.append(tabCommit, tabBranch)

  const body = el('div', 'gt-body')
  /* 提交 tab：消息 + 提交全部 / 推送 */
  const commitBox = el('div')
  commitBox.append(el('div', 'gt-label', '提交信息（提交全部变更）'))
  const msg = document.createElement('textarea')
  msg.className = 'gt-msg'
  msg.placeholder = 'commit message…'
  commitBox.append(msg)
  const actions = el('div', 'gt-actions')
  const commitBtn = el('button', 'gt-main', '提交全部')
  const pushBtn = el('button', 'gt-ghost', '推送')
  pushBtn.title = 'git push（无上游时自动 -u origin HEAD）'
  actions.append(commitBtn, pushBtn)
  commitBox.append(actions, el('div', 'gt-hint', '⌘/Ctrl + Enter 快速提交 · 精细暂存请用终端'))
  /* 分支 tab：列表 + 新建 */
  const branchBox = el('div')
  branchBox.append(el('div', 'gt-label', '本地分支（点击切换）'))
  const branchList = el('div')
  branchBox.append(branchList)
  const newRow = el('div', 'gt-newrow')
  const newInput = document.createElement('input')
  newInput.placeholder = '新分支名…'
  newInput.spellcheck = false
  const newBtn = el('button', 'gt-ghost', '创建')
  newBtn.title = '从当前 HEAD 创建并切换'
  newRow.append(newInput, newBtn)
  branchBox.append(newRow)
  /* 最近提交（tab 无关常驻；标题行整行可点折叠） */
  const caps = el('div', 'gt-caps foldable')
  caps.title = '折叠 / 展开提交历史'
  caps.setAttribute('role', 'button')
  caps.setAttribute('aria-expanded', 'true')
  caps.append(el('span', 'gt-caret', '\u25BE'), document.createTextNode('最近提交'))
  const commitList = el('div')
  let commitsFolded = false
  const applyCommitsFold = (): void => {
    caps.dataset.fold = commitsFolded ? '1' : '0'
    caps.setAttribute('aria-expanded', commitsFolded ? 'false' : 'true')
    commitList.style.display = commitsFolded ? 'none' : ''
  }
  caps.onclick = () => {
    commitsFolded = !commitsFolded
    applyCommitsFold()
  }
  /* 子代理监控（subagent 子会话聚合；行点击展开执行轨迹） */
  const subCaps = el('div', 'gt-caps foldable')
  subCaps.title = '折叠 / 展开子代理'
  subCaps.setAttribute('role', 'button')
  subCaps.setAttribute('aria-expanded', 'true')
  subCaps.append(el('span', 'gt-caret', '\u25BE'), document.createTextNode('子代理'))
  const subList = el('div')
  let subsFolded = false
  const applySubsFold = (): void => {
    subCaps.dataset.fold = subsFolded ? '1' : '0'
    subCaps.setAttribute('aria-expanded', subsFolded ? 'false' : 'true')
    subList.style.display = subsFolded ? 'none' : ''
  }
  subCaps.onclick = () => {
    subsFolded = !subsFolded
    applySubsFold()
  }
  /* 任务计划（约定位置扫到的 agent 计划文档；点击 → 预览抽屉渲染） */
  const planCaps = el('div', 'gt-caps', '任务计划')
  const planList = el('div')
  const planSvg = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 2.2h10c.6 0 1 .4 1 1v9.6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V3.2c0-.6.4-1 1-1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>'
  /* 空态 */
  const empty = el('div', 'gt-empty')
  body.append(commitBox, branchBox, subCaps, subList, planCaps, planList, caps, commitList, empty)

  const toast = el('div', 'gt-toast')
  card.append(header, status, tabs, body, toast)
  app.append(card)

  /* ---- 行为 ---- */
  const showToast = (text: string): void => {
    toast.textContent = text
    toast.dataset.show = '1'
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => { delete toast.dataset.show }, 3500)
  }
  closeBtn.onclick = () => { void bridge.gitHide() }
  fetchBtn.onclick = () => {
    void bridge.gitFetch().then(r => { if (!r.ok && r.error !== null) showToast(r.error) })
  }
  const doCommit = (): void => {
    const text = msg.value
    if (text.trim() === '') { showToast('提交信息为空'); return }
    void bridge.gitCommit(text).then(r => {
      if (r.ok) msg.value = ''
      else if (r.error !== null) showToast(r.error)
    })
  }
  commitBtn.onclick = doCommit
  msg.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doCommit() }
  })
  pushBtn.onclick = () => {
    void bridge.gitPush().then(r => { if (!r.ok && r.error !== null) showToast(r.error) })
  }
  const setTab = (t: 'commit' | 'branch'): void => {
    tab = t
    tabCommit.dataset.on = t === 'commit' ? '1' : '0'
    tabBranch.dataset.on = t === 'branch' ? '1' : '0'
    commitBox.style.display = t === 'commit' ? '' : 'none'
    branchBox.style.display = t === 'branch' ? '' : 'none'
  }
  tabCommit.onclick = () => setTab('commit')
  tabBranch.onclick = () => setTab('branch')
  setTab('commit')
  const doCreate = (): void => {
    const n = newInput.value
    if (n.trim() === '') { showToast('分支名为空'); return }
    void bridge.gitBranchCreate(n, null).then(r => {
      if (r.ok) newInput.value = ''
      else if (r.error !== null) showToast(r.error)
    })
  }
  newBtn.onclick = doCreate
  newInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doCreate() }
  })

  /* ---- 渲染 ---- */
  let subs: SubagentEntry[] = []
  const subsOpen = new Set<string>()
  const renderSubs = (): void => {
    subList.replaceChildren()
    for (const s of subs) {
      const row = el('button', 'gt-sub')
      if (s.running) row.dataset.run = '1'
      row.title = s.running ? '运行中 · 点击展开/收起轨迹' : '已结束 · 点击展开/收起轨迹'
      row.append(el('span', 'st'))
      row.append(el('span', 'lb', s.label))
      row.append(el('span', 'tk', s.task))
      // 跨工作区后台子代理（running 不随主代理切任务中断）：标注归属
      if (s.ws !== null && s.ws !== snap.workspace) row.append(el('span', 'at', '@' + s.ws))
      const tc = el('span', 'tc')
      const b = el('b', '', String(s.toolCalls))
      tc.append(b, document.createTextNode(' 工具'))
      row.append(tc)
      subList.append(row)
      if (!subsOpen.has(s.id)) {
        row.onclick = () => {
          subsOpen.add(s.id)
          renderSubs()
        }
        continue
      }
      // 展开态：行点击收起；轨迹列表随行（最近活动在底部，自动滚入视野）
      row.onclick = () => {
        subsOpen.delete(s.id)
        renderSubs()
      }
      const traj = el('div', 'gt-sub-traj')
      for (const r of s.rows.slice(-24)) {
        traj.append(trajRow(r))
      }
      if (s.rows.length === 0) traj.append(el('div', 'gt-hint', '未观察到事件（等待轮询/实时流）'))
      subList.append(traj)
    }
    // 面板骨架的空态让位收口读取 subs（render 内）；空态恢复也走 render
    if (snap.workspace === null || snap.error !== null) return
    subCaps.style.display = subs.length > 0 && !hasEmptyState() ? '' : 'none'
    applySubsFold()
  }
  const trajRow = (r: TrajectoryRow): HTMLElement => {
    const div = el('div', 'gt-tr')
    div.dataset.k = r.kind
    const ic = el('span', 'ic', r.kind === 'user' ? 'USR' : r.kind === 'assistant' ? 'AI' : 'TOOL')
    div.append(ic)
    const tx = el('span', 'tx')
    if (r.kind === 'tool' && r.tool !== null) {
      tx.textContent = r.tool.name !== '' ? r.tool.name : '调用'
      if (r.tool.status === 'running') { div.dataset.ok = 'run'; div.append(el('span', 'ms', '…')) }
      else {
        div.dataset.ok = r.tool.status === 'error' ? 'err' : 'ok'
        if (r.tool.ms !== null) div.append(el('span', 'ms', r.tool.ms >= 1000 ? (r.tool.ms / 1000).toFixed(1) + 's' : r.tool.ms + 'ms'))
      }
    } else {
      tx.textContent = r.text ?? ''
      if (tx.textContent === '') return div
    }
    div.insertBefore(tx, div.children[1] ?? null)
    return div
  }
  const hasEmptyState = (): boolean => {
    // 与 render() 的空态判定同源（错误/无工作区时子代理区一并让位）
    return snap.error !== null || snap.workspace === null
  }

  const render = (s: GitSnapshot): void => {
    snap = s
    const lock = s.busy || s.fetching || !s.isRepo
    fetchBtn.disabled = s.fetching || s.busy
    commitBtn.disabled = lock
    pushBtn.disabled = lock
    newBtn.disabled = lock
    commitBtn.textContent = s.busy ? '执行中…' : s.fetching ? '拉取中…' : '提交全部'
    pushBtn.textContent = s.upstream !== null ? '推送' : '推送（建上游）'
    // 头行：分支 + 同步态
    bName.textContent = s.isRepo ? (s.branch !== null ? s.branch : 'HEAD（游离）') : '—'
    bTrack.replaceChildren()
    if (s.isRepo) {
      if (s.upstream !== null) {
        const up = el('span')
        if (s.ahead !== null && s.ahead > 0) up.textContent = '\u2191' + s.ahead + ' '
        bTrack.append(up)
        const down = el('span', 'down')
        if (s.behind !== null && s.behind > 0) down.textContent = '\u2193' + s.behind + ' '
        bTrack.append(down, document.createTextNode(s.upstream))
      } else if (s.branch !== null) {
        bTrack.textContent = '无上游'
      }
    }
    la.textContent = '+' + s.added
    ld.textContent = '\u2212' + s.removed
    const setPill = (p: HTMLElement, v: number): void => { (p.querySelector('b') as HTMLElement).textContent = String(v) }
    setPill(pStaged, s.staged)
    setPill(pChanged, s.changed)
    setPill(pUntracked, s.untracked)
    // 分支列表（当前置顶）
    branchList.replaceChildren()
    const sorted = s.branches.slice().sort((a, b) =>
      (a === s.branch ? -1 : b === s.branch ? 1 : 0) || a.localeCompare(b))
    for (const name of sorted) {
      const row = el('button', 'gt-brow')
      const isCur = name === s.branch
      if (isCur) { row.dataset.cur = '1'; row.append(el('span', 'here', '当前')) }
      row.prepend(el('span', 'dot'), document.createTextNode(name))
      if (!isCur) row.onclick = () => {
        void bridge.gitBranchSwitch(name).then(r => { if (!r.ok && r.error !== null) showToast(r.error) })
      }
      else row.onclick = null
      branchList.append(row)
    }
    if (sorted.length === 0 && s.isRepo) branchList.append(el('div', 'gt-hint', '暂无本地分支'))
    // 任务计划（无计划时整区隐藏；显隐统一收口到下方空态块）
    planList.replaceChildren()
    const hasPlans = s.isRepo && s.plans.length > 0
    for (const p of s.plans) {
      const row = el('button', 'gt-plan')
      row.title = p.path
      const ico = el('span')
      ico.innerHTML = planSvg
      row.append(ico, el('span', 't', p.title), el('span', 'w', p.when))
      row.onclick = () => { void bridge.gitOpenPlan(p.path) }
      planList.append(row)
    }
    // 最近提交
    commitList.replaceChildren()
    for (const c of s.commits) {
      const row = el('div', 'gt-commit')
      row.append(
        el('span', 'hash', c.hash),
        el('span', 'subj', c.subject),
        el('span', 'when', c.when),
      )
      commitList.append(row)
    }
    // 空态与错误
    empty.replaceChildren()
    if (s.error !== null) {
      empty.append(el('div', '', s.error))
    } else if (s.workspace === null) {
      empty.append(el('div', '', '等待工作区…'))
    } else if (!s.isRepo) {
      empty.append(el('div', '', `「${s.workspace}」不是 git 仓库`))
    }
    // 分区显隐统一收口：空态时各区全部让位；恢复时按各自状态回位
    //（caps 曾因恢复分支漏了它——首次空态后"最近提交"标题永久消失）
    const hasEmpty = empty.childNodes.length > 0
    empty.style.display = hasEmpty ? '' : 'none'
    commitBox.style.display = 'none'
    branchBox.style.display = 'none'
    subCaps.style.display = 'none'
    subList.style.display = 'none'
    planCaps.style.display = 'none'
    planList.style.display = 'none'
    caps.style.display = 'none'
    if (!hasEmpty) {
      setTab(tab)
      caps.style.display = ''
      applyCommitsFold()
      // 子代理区独立渲染/推送，仅跟随空态让位（不依赖 git 探测结果）
      if (subs.length > 0) {
        subCaps.style.display = ''
        applySubsFold()
      }
      planCaps.style.display = hasPlans ? '' : 'none'
      planList.style.display = hasPlans ? '' : 'none'
    }
  }

  /* ---- 数据接线 ---- */
  void bridge.gitSnapshot().then(render)
  bridge.onGitSnapshot(render)
  void bridge.gitSubagents().then(list => {
    subs = list
    renderSubs()
  })
  bridge.onGitSubagents(list => {
    subs = list
    renderSubs()
  })
}
