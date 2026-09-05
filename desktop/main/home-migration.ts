/**
 * 用户数据目录（dsh home）决策与迁移：KCoder 数据家从上游默认 `~/.dsh`
 * 换到自有 `~/.kcoder`。
 *
 * 为什么换家：上游 home 是 harness 家族工具链的共享库（终端 dsh CLI、
 * npx dsh web、同源其他产品都读写它）——产品与浮动 CLI 共库意味着引擎
 * 代差互相污染（session format v0→v2 这类读写协议升级随时可能被旧
 * CLI 踩回），也谈不上产品私有数据边界。上游 home-paths 原生支持
 * DSH_HOME 环境变量覆盖（显式配置 > $DSH_HOME > ~/.dsh），零 fork 改动
 * 即可换家：本模块在主进程启动时决策并写入 process.env.DSH_HOME，所有
 * 子进程（引擎侧车 / dsh plugin / pnpm 物化链）经 spawn 继承，插件安装
 * 必然落新家。
 *
 * 启动决策（桌面设置存 `homeDecided` 锁，见 store.ts）：
 * 1. 用户显式设置 DSH_HOME → 绝对尊重（自管 home，不出迁移入口）；
 * 2. 已决策（迁移完成过 / 首次全新启动锁定）→ ~/.kcoder；
 * 3. 未决策且 ~/.dsh 存在 → 老用户未迁移：引擎继续跑 ~/.dsh，一切照旧
 *    （无缝），设置页出现「数据迁移」入口；
 * 4. 都不成立 → 全新 ~/.kcoder，并落锁。
 *
 * 教训（决策规则 v2）：不能拿「~/.kcoder 存在」当「已迁移」——残存的
 * 空 ~/.kcoder（如早前手工 DSH_HOME 试验产物、import 期副作用）会把老
 * 用户劫持到空家（16:10 现场事故：~/.dsh 完好却全量重新物化 + 引擎
 * onboarding 门把设置页顶没反应）。故「未决策 + 旧目录在」恒优先回
 * 旧家，~/.kcoder 是否存在只在迁移执行时作为残骸挪边处理。
 *
 * 迁移 = 整库 rename：`~/.dsh` → `~/.kcoder`（同卷原子操作，瞬时完成；
 * 派生物——插件 node_modules、Python venvs、投影缓存——全部原样保留，
 * 用户零重建；rename 即搬移即删除，旧目录自然消失）。既有 ~/.kcoder 残
 * 骸先挪至 `~/.kcoder.stray-<时间戳>` 备份。仅有的数据取舍：
 * qilin-accounts（同源其他项目误写入 home 的目录，非 KCoder 数据）迁移
 * 时直接清除。KCoder 自身的登录账号存 Electron userData（kcoder-auth.json，
 * auth.ts），与本次搬移无关。
 *
 * 设置页注入（同 about-settings 机制）：导航列注入「数据迁移」入口 +
 * 自绘内容容器，对话框级 marker 类切换显隐；console 通道通信
 * （页面 → 主进程 {op:'status'|'migrate'}，主进程 → 页面
 * window.__dshHomeMigration(status)）。入口仅在 pending（可迁移）时出现，
 * 迁移完成后即行移除。
 *
 * @module desktop/main/home-migration
 */

import type { BrowserWindow } from 'electron'
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { consoleMessageText } from './console-channel'
import { dshManager } from './dsh-manager'
import { getSettings, saveSettings } from './store'

/* ---------- 核心（无 Electron 依赖） ---------- */

/** KCoder 自有数据目录名（home 下）。 */
export const KCODER_HOME_DIR = '.kcoder'

/** 上游默认数据目录名（老用户存量所在）。 */
export const LEGACY_HOME_DIR = '.dsh'

/** 迁移完成标记（写入新 home 根；自描述 + 排障线索）。 */
const MARKER_FILE = '.kcoder-home.json'

/** 误写入 home 的第三方目录（非 KCoder 数据）：迁移时顺带清除。 */
const FOREIGN_DIRS = ['qilin-accounts']

/** KCoder 自有 home 绝对路径。 */
export function defaultKcoderHome(osHome: string = homedir()): string {
  return join(osHome, KCODER_HOME_DIR)
}

/** 上游旧 home 绝对路径（存量用户数据所在）。 */
export function defaultLegacyHome(osHome: string = homedir()): string {
  return join(osHome, LEGACY_HOME_DIR)
}

/** 用户显式设置的 DSH_HOME（未设置/空白为 null）。 */
function userEnvHome(envHome: string | undefined): string | null {
  if (envHome === undefined || envHome.trim() === '') return null
  return resolve(envHome)
}

/** 一次启动 home 决策。 */
export interface BootHome {
  /** 本进程应使用的 home 绝对路径（调用方写入 process.env.DSH_HOME）。 */
  home: string
  /** 用户显式设置了 DSH_HOME（绝对尊重，迁移入口不出现）。 */
  userOverride: boolean
  /** 老用户未迁移：当前跑在 ~/.dsh 上，设置页出迁移入口。 */
  pendingMigration: boolean
}

/** 无状态启动决策（已决策锁由调用方从桌面设置读入，见模块头注释）。 */
export function resolveBootHome(
  osHome: string = homedir(),
  envHome?: string,
  decided = false,
): BootHome {
  const user = userEnvHome(envHome ?? process.env.DSH_HOME)
  if (user !== null) return { home: user, userOverride: true, pendingMigration: false }
  const kcoder = defaultKcoderHome(osHome)
  if (decided) return { home: kcoder, userOverride: false, pendingMigration: false }
  const legacy = defaultLegacyHome(osHome)
  if (existsSync(legacy)) return { home: legacy, userOverride: false, pendingMigration: true }
  return { home: kcoder, userOverride: false, pendingMigration: false }
}

/** 迁移可用性：用户未自管 home、未决策过，且旧目录在。 */
export function migrationEligible(
  osHome: string = homedir(),
  envHome?: string,
  decided = false,
): boolean {
  if (userEnvHome(envHome ?? process.env.DSH_HOME) !== null) return false
  if (decided) return false
  return existsSync(defaultLegacyHome(osHome))
}

/** 迁移核心：残骸挪边 + 整库 rename + 清理误入目录 + 落迁移标记。 */
export function performMigrationPaths(from: string, to: string): string[] {
  if (!existsSync(from)) throw new Error(`旧数据目录不存在：${from}`)
  const warnings: string[] = []
  if (existsSync(to)) {
    // 残骸挪边（如早前手工 DSH_HOME 试验的空壳）：备份而非删除，用户
    // 自行处置；同秒重名以 -N 递增兜底
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    let aside = `${to}.stray-${stamp}`
    for (let i = 0; existsSync(aside); i++) aside = `${to}.stray-${stamp}-${String(i)}`
    renameSync(to, aside)
    warnings.push(`既有 ${to} 已备份为 ${aside}（非本次迁移内容，确认无用后可删除）`)
  }
  renameSync(from, to)
  for (const name of FOREIGN_DIRS) {
    try {
      rmSync(join(to, name), { recursive: true, force: true })
    } catch (error) {
      warnings.push(`清理 ${name} 失败（不影响使用，可手动删除）：${String(error)}`)
    }
  }
  writeFileSync(join(to, MARKER_FILE), `${JSON.stringify({ migratedAt: new Date().toISOString() })}\n`)
  return warnings
}

/* ---------- 状态与编排（Electron 侧） ---------- */

/** 桌面设置里的 home 决策锁（迁移完成 / 首次全新启动后置 true）。 */
function homeDecided(): boolean {
  return getSettings().homeDecided === true
}

/** 设置页迁移面板的状态载荷。 */
export interface HomeMigrationStatus {
  /** 是否可迁移（决定设置页入口显隐）。 */
  available: boolean
  /** 当前生效 home 的符号展示（~/.kcoder / ~/.dsh / 自定义绝对路径）。 */
  home: string
  /** 旧目录绝对路径（面板展示用）。 */
  from: string
  /** 新目录绝对路径（面板展示用）。 */
  to: string
}

/** 当前状态快照（设置页每次打开时拉取）。 */
export function homeMigrationStatus(): HomeMigrationStatus {
  const boot = resolveBootHome(homedir(), process.env.DSH_HOME, homeDecided())
  const symbolic = (home: string): string =>
    home === defaultKcoderHome() ? `~/${KCODER_HOME_DIR}`
      : home === defaultLegacyHome() ? `~/${LEGACY_HOME_DIR}`
        : home
  return {
    available: migrationEligible(homedir(), process.env.DSH_HOME, homeDecided()),
    home: symbolic(boot.home),
    from: defaultLegacyHome(),
    to: defaultKcoderHome(),
  }
}

/** 一次迁移的执行结果（设置页展示）。 */
export interface HomeMigrationResult {
  ok: boolean
  error: string | null
  /** 非致命警告（残骸备份、误入目录清理失败等），迁移本体已成功。 */
  warnings: string[]
}

let migrating = false

/**
 * 执行迁移：优雅停引擎 → 残骸挪边 + 整库 rename → 清理误入目录 → 落
 * 标记与决策锁 → 切 env → 重启引擎。失败时引擎在旧 home 原地恢复，状态
 * 不变可重试。
 */
export async function performHomeMigration(win: BrowserWindow | null): Promise<HomeMigrationResult> {
  if (migrating) return { ok: false, error: '迁移正在进行中', warnings: [] }
  if (!migrationEligible(homedir(), process.env.DSH_HOME, homeDecided())) {
    return { ok: false, error: '没有可迁移的旧数据（~/.dsh 不存在，或已迁移过）', warnings: [] }
  }
  migrating = true
  try {
    await dshManager.stop()
    let warnings: string[] = []
    try {
      warnings = performMigrationPaths(defaultLegacyHome(), defaultKcoderHome())
    } catch (error) {
      // 引擎原地恢复（env 未动，仍指旧 home），迁移可重试
      dshManager.start()
      return { ok: false, error: `迁移失败：${String(error)}`, warnings: [] }
    }
    saveSettings({ homeDecided: true })
    process.env.DSH_HOME = defaultKcoderHome()
    dshManager.start()
    pushHomeMigrationStatus(win)
    return { ok: true, error: null, warnings }
  } finally {
    migrating = false
  }
}

/**
 * 启动期 home 决策与注入（index.ts 模块顶层调用）：决策写入本进程 env
 * 供全部子进程继承，并打一行决策日志（dev 终端可见，排障锚点）。
 */
export function applyBootHomeEnv(): void {
  const boot = resolveBootHome(homedir(), process.env.DSH_HOME, homeDecided())
  if (!boot.userOverride) process.env.DSH_HOME = boot.home
  const why = boot.userOverride
    ? '用户 DSH_HOME 自管'
    : boot.pendingMigration
      ? '旧目录待迁移（设置页可一键迁移）'
      : 'KCoder 自有数据目录'
  console.log(`[home] dsh home = ${boot.home}（${why}）`)
}

/** 把最新状态推给设置页（注入脚本据此显隐入口）。 */
export function pushHomeMigrationStatus(win: BrowserWindow | null): void {
  if (win === null || win.isDestroyed()) return
  void win.webContents.executeJavaScript(
    `window.__dshHomeMigration && window.__dshHomeMigration(${JSON.stringify(homeMigrationStatus())})`,
    true,
  ).catch(() => {})
}

/* ---------- 设置页注入器 ---------- */

const PREFIX = '__dsh_home_migration__:'

/** 注入脚本（页面上下文执行；纯 JS：无模板字面量、反引号转义）。 */
const PAGE_JS = `(() => {
  if (window.__dshHomeMigrationWired) return
  window.__dshHomeMigrationWired = true

  var CSS_ID = '__dsh_desktop_home_migration_css'
  var NAV_ID = '__dsh_desktop_home_migration_nav'
  var SEC_ID = '__dsh_desktop_home_migration_section'
  var MARKER = '__dsh_hm_on'
  var PREFIX = '__dsh_home_migration__:'

  // 导航图标（14 网格自绘 import 形：托盘 + 落入箭头，DOM 构造不用
  // innerHTML；class 抄被替换的旧 svg 对齐上游 navIcon 编译类）
  function navIcon(old) {
    var NS = 'http://www.w3.org/2000/svg'
    var svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', '14')
    svg.setAttribute('height', '14')
    svg.setAttribute('viewBox', '0 0 14 14')
    svg.setAttribute('fill', 'none')
    var cls = old.getAttribute('class')
    if (cls !== null) svg.setAttribute('class', cls)
    var ds = [
      'M7 1.4 L10.5 5.1 L8.2 5.1 L8.2 9.4 L5.8 9.4 L5.8 5.1 L3.5 5.1 Z',
      'M2.2 8.2 L3.4 8.2 L3.4 11.3 L10.6 11.3 L10.6 8.2 L11.8 8.2 L11.8 12.5 L2.2 12.5 Z'
    ]
    for (var i = 0; i < ds.length; i++) {
      var p = document.createElementNS(NS, 'path')
      p.setAttribute('d', ds[i])
      p.setAttribute('fill', 'currentColor')
      svg.appendChild(p)
    }
    return svg
  }

  var status = null      // 主进程推送的迁移状态
  var dialog = null      // 当前挂载的设置对话框
  var navList = null
  var activeExtra = []   // 哈希激活类（激活按钮类集 - 普通按钮类集）
  var on = false
  var busy = false

  function send(payload) { console.log(PREFIX + JSON.stringify(payload)) }

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

  /** 入口显隐随状态走：可迁移才注入 nav + section；不可迁移即拆除。 */
  function syncNav() {
    var available = status !== null && status.available === true
    var mine = document.getElementById(NAV_ID)
    if (!available) {
      if (mine !== null) mine.remove()
      var sec = document.getElementById(SEC_ID)
      if (sec !== null) sec.remove()
      if (on) { deactivate() }
      return
    }
    if (mine !== null || dialog === null || navList === null) return
    var seeds = Array.from(navList.querySelectorAll('button'))
    var seed = seeds[seeds.length - 1]
    if (seed === undefined) return
    var btn = seed.cloneNode(true)
    btn.id = NAV_ID
    btn.removeAttribute('aria-current')
    var label = btn.querySelector('span')
    if (label !== null) label.textContent = '数据迁移'
    var oldIcon = btn.querySelector('svg')
    if (oldIcon !== null) oldIcon.replaceWith(navIcon(oldIcon))
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); activate() })
    // 排在「关于」之后（同族注入器按挂载序占位，锚定而非抢尾）
    var about = document.getElementById('__dsh_desktop_about_nav')
    if (about !== null && about.parentNode === seed.parentNode) {
      seed.parentNode.insertBefore(btn, about.nextSibling)
    } else {
      seed.parentNode.appendChild(btn)
    }
  }

  function card(title) {
    var c = document.createElement('div')
    c.className = 'hm-card'
    var t = document.createElement('div')
    t.className = 'hm-title'
    t.textContent = title
    c.appendChild(t)
    return c
  }

  function para(text) {
    var p = document.createElement('div')
    p.className = 'hm-para'
    p.textContent = text
    return p
  }

  function render() {
    var sec = document.getElementById(SEC_ID)
    if (sec === null || status === null) return
    sec.replaceChildren()

    var lead = document.createElement('div')
    lead.className = 'hm-lead'
    lead.textContent = '检测到旧版数据目录 ' + status.from + '。KCoder 现使用独立数据目录 ' +
      status.to + '（会话、技能、插件、设置等全部用户数据）。当前引擎仍运行在旧目录，' +
      '一切照常；迁移把旧目录整体搬移到新目录，完成后旧目录自动移除。'
    sec.appendChild(lead)

    var what = card('迁移内容')
    what.appendChild(para(
      '整库搬移，零重建：会话与任务记录、投影缓存、已安装插件及其依赖、技能、' +
      'MCP 配置、登录凭据、模型与多媒体设置全部原样保留（插件依赖与运行环境' +
      '随迁，不需要重新下载或重建）。'
    ))
    what.appendChild(para(
      '顺带清理误写入的 qilin-accounts 目录（其他项目撞库产物，非 KCoder 数据）。'
    ))
    sec.appendChild(what)

    var note = card('注意事项')
    note.appendChild(para(
      '迁移中引擎会短暂重启，进行中的回答会中断；请先确认没有其他程序' +
      '（如终端里的 dsh 命令）正在使用 ' + status.from + '。'
    ))
    sec.appendChild(note)

    var btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'hm-btn'
    btn.id = '__dsh_desktop_home_migration_btn'
    btn.textContent = busy ? '迁移中…' : '开始迁移'
    btn.disabled = busy
    btn.addEventListener('click', function () {
      if (busy) return
      busy = true
      btn.textContent = '迁移中…'
      btn.disabled = true
      send({ op: 'migrate' })
    })
    sec.appendChild(btn)

    var hint = document.createElement('div')
    hint.className = 'hm-hint'
    hint.textContent = '当前数据目录：' + status.home
    sec.appendChild(hint)
  }

  /** 主进程 → 页面：状态推送（含迁移结果后的最新状态）。 */
  window.__dshHomeMigration = function (data) {
    status = data && typeof data === 'object' ? data : null
    busy = false
    syncNav()
    render()
  }

  function build() {
    var dlg = document.querySelector('[role="dialog"][aria-modal="true"]')
    if (dlg === null || dlg.querySelector('div[data-slot="settings.section"]') === null) {
      if (dialog !== null) { on = false; dialog = null; navList = null }
      return
    }
    if (dlg !== dialog) {
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
      send({ op: 'status' })
    }

    if (document.getElementById(CSS_ID) === null) {
      var style = document.createElement('style')
      style.id = CSS_ID
      style.textContent = [
        '#' + SEC_ID + ' { display: none; }',
        '[role="dialog"].' + MARKER + ' [class*="_options"] > div[data-slot="settings.section"] { display: none !important; }',
        '[role="dialog"].' + MARKER + ' #' + SEC_ID + ' { display: block; width: 100%; max-width: 960px; margin: 0 auto; box-sizing: border-box; min-width: 0; }',
        '.hm-lead { margin: 2px 0 20px; color: var(--dsw-alias-label-secondary, #888); font-size: 13px; line-height: 1.65; }',
        '.hm-card { box-sizing: border-box; width: 100%; margin: 0 0 14px; padding: 20px 24px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-module-platform); box-shadow: 0 2px 10px rgba(9,16,29,.035); }',
        'body[data-ds-dark-theme] .hm-card { box-shadow: 0 2px 12px rgba(0,0,0,.16); }',
        '.hm-title { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); margin: 0 0 10px; }',
        '.hm-para { margin: 0 0 10px; font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-secondary, #888); }',
        '.hm-para:last-child { margin-bottom: 0; }',
        '.hm-btn { display: inline-block; margin: 4px 0 14px; padding: 9px 22px; border: none; border-radius: 12px; background: var(--dsw-alias-label-primary, #222); color: var(--dsw-alias-bg-module-platform, #fff); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }',
        '.hm-btn:hover { opacity: .88; }',
        '.hm-btn:disabled { opacity: .5; cursor: default; }',
        '.hm-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary, #aaa); }'
      ].join('\\n')
      document.head.appendChild(style)
    }

    if (navList === null) return
    syncNav()

    if (on) activate()

    if (dialog.getAttribute('data-dsk-hm-nav') !== '1') {
      dialog.setAttribute('data-dsk-hm-nav', '1')
      dialog.addEventListener('click', function (ev) {
        if (navList === null) return
        var btn = ev.target instanceof Element ? ev.target.closest('button') : null
        if (btn === null || !navList.contains(btn)) return
        if (btn.id === NAV_ID) return
        if (on) deactivate()
      }, true)
    }

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
 * 给 shell 窗口挂迁移注入器：整页加载后注入页面脚本并推一次状态；
 * 对话框每次打开经 console 通道请求状态（入口显隐随文件系统现状走）。
 */
export function attachHomeMigrationInjector(win: BrowserWindow): void {
  const { webContents } = win

  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(PREFIX) || win.isDestroyed()) return
    let payload: { op?: unknown }
    try { payload = JSON.parse(message.slice(PREFIX.length)) as { op?: unknown } } catch { return }
    if (payload.op === 'status') {
      pushHomeMigrationStatus(win)
      return
    }
    if (payload.op === 'migrate') {
      void performHomeMigration(win).then((result) => {
        if (!result.ok && !win.isDestroyed()) {
          // 失败就地反馈：状态打回（busy 复位），错误经 alert 通道最直白
          pushHomeMigrationStatus(win)
          void webContents.executeJavaScript(
            `window.alert(${JSON.stringify(result.error ?? '迁移失败')})`,
            true,
          ).catch(() => {})
        }
      })
    }
  }

  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    void webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
    pushHomeMigrationStatus(win)
  })
}
