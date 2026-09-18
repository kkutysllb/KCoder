/**
 * 账号行注入器（零侵入）：workspace 侧边栏底部设置按钮上方注入
 * 「头像 + 登录账号」行，点击弹自绘菜单（设置 / 语言 / 主题 / 退出登录）。
 * 原始 sidebar.settings 按钮隐藏，设置入口只保留在用户菜单中。
 *
 * 定位与行为（上游契约见 SidebarRoot.tsx / SettingsRoot.tsx）：
 * - 宿主：`div[class*="settingsArea"]`（SidebarRoot 侧边栏 foot 区，
 *   `sidebar.settings` slot 的挂载容器，settings trigger 按钮之家）；
 *   账号行插容器首位，同时隐藏原始 settings trigger，避免入口重复；
 * - 菜单「设置」：转发 settings trigger 真实点击
 *   （`button[class*="_trigger"][aria-haspopup="dialog"]`，SettingsRoot
 *   专属组合锚）——走上游打开设置面板的完整路径（单页化形态照常）；
 * - 菜单「语言」「主题」：**复用上游真实控件**而非另写一套偏好写入。
 *   语言/主题各自是插件服务（locale 的 setLocale、ui-theme 的 setTheme），
 *   渲染页没有 window 级服务桥，注入脚本够不到它们；而偏好行只在设置面板
 *   的「通用」区挂载时才存在。故做法是：短暂打开设置面板 → 等控件出现 →
 *   命中 → 关闭。代价是一次面板闪现，换来的是**偏好唯一事实源**——不可能
 *   出现「菜单里显示的语言与设置里不一致」这类双写漂移（对比：自绘一份
 *   偏好写回链就得同时维护持久化、订阅、跨端一致三件事）。
 *   锚点：语言 = 该区 `button[aria-haspopup="menu"]`（LanguageRow 的
 *   Menu 选择器，语言切换后面板重渲染，菜单锚点仍有效）；主题 = 该区
 *   `button[aria-pressed]` 三枚立方块（AppearanceRow，顺序即
 *   CUBES 声明序：system/light/dark）。文案兜底只在拿不到结构锚时才用。
 * - 菜单「退出登录」：`location.assign('kcoder://auth-logout')`——
 *   复用 update-injector 的 kcoder:// 回调协议（shell 窗口无 preload，
 *   自定义协议导航是渲染页 → 主进程的既有通道），windows.ts 的
 *   will-navigate 拦截执行登出收场；
 * - rail 收起态（root.collapsed）：仅显示头像圆钮（与上游 foot 区
 *   36px 圆钮列同形，用户名隐藏），点击照常弹菜单；
 * - username 随脚本生成时烧入（did-finish-load 每次重注入；登出走
 *   reload，重登录后注入器按新账号重跑——windows.logoutToLanding）。
 *
 * 类改名 / 结构调整 → 注入静默失效（侧边栏回原样），不崩不错位；
 * React 重渲染重建 settingsArea → MutationObserver 自愈重插；
 * 切换动作拿不到控件 → 只提示不动作（宁可没反应也不改错东西）。
 *
 * @module desktop/main/account-chip
 */
import type { BrowserWindow } from 'electron'
import { authStatus } from './auth'

/** 账号行与菜单的 id 前缀（幂等标记）。 */
const CHIP_ID = '__kcoder_account_chip'
const MENU_ID = '__kcoder_account_menu'

/** 登出回调协议（windows.ts will-navigate 拦截）。 */
export const AUTH_LOGOUT_URL = 'kcoder://auth-logout'

/** 注入脚本（页面上下文；USERNAME/LOGOUT_URL 由挂载侧生成时注入）。 */
const chipJs = (username: string): string => `(() => {
  const NAME = ${JSON.stringify(username)}
  const LOGOUT = ${JSON.stringify(AUTH_LOGOUT_URL)}
  const CHIP = ${JSON.stringify(CHIP_ID)}
  const MENU = ${JSON.stringify(MENU_ID)}

  const closeMenu = () => {
    const m = document.getElementById(MENU)
    if (m !== null) m.remove()
  }

  // 语言文案：菜单项标签与匹配锚都随当前语言走（切换后立即自洽）。
  // zh 为默认（页面 lang 缺失时按 zh）。
  const zh = (document.documentElement.lang || 'zh').toLowerCase().indexOf('zh') === 0
  const T = zh
    ? { settings: '设置', language: '语言', theme: '主题', logout: '退出登录', general: '通用设置' }
    : { settings: 'Settings', language: 'Language', theme: 'Theme', logout: 'Sign out', general: 'General' }

  // 短暂操作设置面板时用的标志：置位期间忽略「点击外部关闭」——否则
  // 切换过程中面板被误关，控件随卸载消失，动作半途失败。
  let busy = false

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  /** 轮询等待条件成立（上限 timeoutMs）。 */
  const waitFor = async (fn, timeoutMs) => {
    const end = Date.now() + (timeoutMs ?? 2500)
    for (;;) {
      let v = null
      try { v = fn() } catch { v = null }
      if (v) return v
      if (Date.now() > end) return null
      await sleep(60)
    }
  }

  const settingsTrigger = () => document.querySelector('button[class*="_trigger"][aria-haspopup="dialog"]')
  const panelOpen = () => document.querySelector('[role="dialog"] [class*="_nav"]') !== null
  const closePanel = () => {
    document.querySelector('[role="dialog"] [class*="_header"] > [class*="_close"]')?.click()
  }

  /**
   * 打开设置面板、停在「通用」区、交给 run(zone) 命中控件，然后还原。
   * 面板本就开着时不关（尊重用户当前上下文）。返回 run 的返回值。
   */
  const withGeneralRow = async (run) => {
    const opened = !panelOpen()
    if (opened) {
      const trigger = settingsTrigger()
      if (trigger === null) return null
      trigger.click()
      const nav = await waitFor(() => document.querySelector('[role="dialog"] [class*="_nav"]'), 2500)
      if (nav === null) return null
      // 分区导航首项即「通用」（SettingsRoot 按 order 渲染 navList）。
      const first = nav.querySelector('[class*="navList"] button')
      if (first !== null) first.click()
    }
    const zone = await waitFor(
      () => document.querySelector('[role="dialog"] [data-slot="settings.section"]'),
      2500,
    )
    let out = null
    if (zone !== null) out = await run(zone)
    if (opened) closePanel()
    return out
  }

  /** 底部轻提示（自带样式，3s 自动消失；不改任何持久状态）。 */
  const notify = (msg) => {
    const el = document.createElement('div')
    el.setAttribute('role', 'status')
    el.textContent = msg
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:36px', 'transform:translateX(-50%)',
      'z-index:2147483000', 'max-width:70vw', 'padding:9px 16px',
      'border-radius:10px', 'box-sizing:border-box',
      'background:var(--dsw-alias-bg-layer-2, #fff)',
      'border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25))',
      'box-shadow:0 8px 24px rgba(0,0,0,.18)',
      'color:var(--dsw-alias-label-primary, inherit)',
      'font-family:inherit', 'font-size:13px', 'line-height:20px',
      'pointer-events:none',
    ].join(';')
    document.body.append(el)
    setTimeout(() => { el.remove() }, 3000)
  }

  /**
   * 命中上游「语言」行的选择器按钮。
   *
   * 锚点（2026-09-18 实测）：该区有四个 button[aria-haspopup="menu"]
   * （权限 / 语言 / 对话显示 / 繁忙发送行为），**单独用 aria-haspopup 不唯一**
   * ——必须先按行标题「语言」/Language 定位行，再取行内 _selector 按钮；
   * 标题找不到时退回「按钮自身文案 ∈ 已知语言名」。
   */
  const findLanguageAnchor = (zone) => {
    const titles = zh ? ['语言'] : ['language']
    const rows = [...zone.querySelectorAll('div[class*="row"]')]
    for (const row of rows) {
      const title = row.querySelector('div[class*="title"]')
      const label = (title ? title.textContent : '').trim().toLowerCase()
      if (label === '' || !titles.some((k) => label.indexOf(k) >= 0)) continue
      const btn = row.querySelector('button[class*="_selector"], button[aria-haspopup="menu"]')
      if (btn !== null) return btn
    }
    const known = ['简体中文', '中文', 'english', '日本語', '한국어']
    return [...zone.querySelectorAll('button')]
      .find((b) => known.indexOf((b.textContent || '').trim().toLowerCase()) >= 0) ?? null
  }

  const LANG_LABELS = {
    zh: ['简体中文', '中文'],
    en: ['english', '英文'],
  }

  /** 弹菜单期间短暂占用设置面板（busy 抑制外部点击关闭）。 */
  const withBusy = async (fn) => {
    busy = true
    try { return await fn() } finally { busy = false }
  }

  /** 切换语言：命中上游 LanguageRow 的选择器（Menu 按钮）+ 菜单项。 */
  const switchLanguage = (targetId) => withBusy(async () => {
    const done = await withGeneralRow(async (zone) => {
      const anchor = findLanguageAnchor(zone)
      if (anchor === null) return false
      if (anchor.getAttribute('aria-expanded') !== 'true') anchor.click()
      const want = LANG_LABELS[targetId] || []
      const item = await waitFor(() => {
        const rows = [...document.querySelectorAll('[role="menuitem"]')]
        return rows.find((r) => {
          const s = (r.textContent || '').trim().toLowerCase()
          if (want.some((k) => s === k || s.indexOf(k) >= 0)) return true
          // 目标语言名不认识时按互斥匹配：挑一个「不是当前语言」的项
          const cur = zh ? LANG_LABELS.zh : LANG_LABELS.en
          return !cur.some((k) => s === k || s.indexOf(k) >= 0)
        }) ?? null
      }, 2000)
      if (item === null) return false
      item.click()
      return true
    })
    notify(done === true
      ? (targetId === 'zh' ? '已切换为简体中文' : 'Switched to English')
      : (zh ? '未能切换语言（设置面板结构可能已变）' : 'Could not switch language'))
  })

  /**
   * 切换主题：命中上游 AppearanceRow 的立方块按钮组。
   *
   * 锚点（2026-09-18 实测）：容器类含 _cubeRow，内含 3 个 button[aria-pressed]；
   * **渲染顺序是「浅色 / 深色 / 跟随系统」，不是 CUBES 的声明序**——位置兜底
   * 会切错档（早期实现按 system/light/dark 取下标，实测错位），故一律按
   * 按钮文案匹配。
   */
  const CUBE_LABELS = {
    system: ['跟随系统', 'system'],
    light: ['浅色', 'light'],
    dark: ['深色', 'dark'],
  }

  const switchTheme = (targetId) => withBusy(async () => {
    // 已是目标档：不做无谓的面板闪现（语言侧同款早退在 switchLanguage 里）
    if (themePref() === targetId) {
      notify(zh ? '当前已是' + themeLabel(targetId) : 'Already ' + themeLabel(targetId))
      return
    }
    const done = await withGeneralRow(async (zone) => {
      const row = zone.querySelector('div[class*="cubeRow"]')
      const cubes = [...(row ?? zone).querySelectorAll('button[aria-pressed]')]
      if (cubes.length === 0) return false
      const keys = CUBE_LABELS[targetId] || []
      const hit = cubes.find((b) => {
        const s = (b.textContent || '').trim().toLowerCase()
        return keys.some((k) => s === k || s.indexOf(k) >= 0)
      })
      if (hit === undefined) return false
      hit.click()
      return true
    })
    notify(done === true
      ? (zh
        ? '已切换主题：' + (targetId === 'system' ? '跟随系统' : targetId === 'light' ? '浅色' : '深色')
        : 'Theme: ' + targetId)
      : (zh ? '未能切换主题（设置面板结构可能已变）' : 'Could not switch theme'))
  })

  /** 当前是否深色（与 theme-watcher 同款双判据：body 属性 + colorScheme）。 */
  const isDark = () => document.body.hasAttribute('data-ds-dark-theme')
    || document.documentElement.style.colorScheme === 'dark'

  /**
   * 主题偏好档（'system' | 'light' | 'dark'）。
   *
   * 上游只把**实色**落 DOM，偏好档由 theme-watcher 解析后上报主进程；该值
   * 现由 theme-watcher 顺手写入 documentElement.dataset.kcoderThemePref
   * 供页面脚本读取——否则「跟随系统」与「浅色」在浅色系统下无法区分，子菜单
   * 会把当前档标错。属性缺失（首帧尚未解析）时按 system 兜底，不误标实色档。
   */
  const themePref = () => {
    const v = document.documentElement.dataset.kcoderThemePref
    return v === 'light' || v === 'dark' ? v : 'system'
  }

  /** 当前实色（浅/深）。 */
  const currentThemeValue = () => isDark() ? (zh ? '深色' : 'Dark') : (zh ? '浅色' : 'Light')

  /** 主题三档的显示名。 */
  const themeLabel = (id) => {
    if (id === 'system') return zh ? '跟随系统' : 'System'
    if (id === 'light') return zh ? '浅色' : 'Light'
    return zh ? '深色' : 'Dark'
  }

  /** 主题父项的当前值：偏好档优先（跟随系统时明确显示「跟随系统」）。 */
  const currentThemeTrail = () => {
    const pref = themePref()
    return pref === 'system' ? themeLabel('system') : currentThemeValue()
  }

  // 菜单：账号行上方弹出（侧边栏贴左缘，向上展开）；自绘层用上游
  // token 上色（bg-layer-2 + border-l1 + 阴影），跟随主题。
  const MENU_ROW = [
    'display:flex;align-items:center;gap:9px;width:100%;height:36px',
    'padding:0 10px;box-sizing:border-box;border:none;border-radius:8px',
    'background:transparent;cursor:pointer;text-align:left',
    'font-family:inherit;font-size:14px;font-weight:400;line-height:22px',
  ].join(';')
  const ICON_BOX = 'display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;opacity:.82'
  /** 右侧值/箭头位（flex 末位，不参与收缩）。 */
  const TRAIL = 'margin-left:auto;flex:none;font-size:12px;letter-spacing:.2px'
  const HOVER_IN = 'var(--dsw-specific-sidebar-nav-item-hover, rgba(128,128,128,.12))'

  /** 一行菜单项（图标 + 文案 + 可选的右侧值/箭头）。 */
  const menuRow = (opts) => {
    const el = document.createElement('button')
    el.type = 'button'
    el.setAttribute('role', 'menuitem')
    const icon = document.createElement('span')
    icon.setAttribute('aria-hidden', 'true')
    icon.innerHTML = opts.icon
    const text = document.createElement('span')
    text.textContent = opts.label
    el.append(icon, text)
    if (opts.trail !== undefined) {
      const trail = document.createElement('span')
      trail.textContent = opts.trail
      trail.style.cssText = TRAIL + (opts.trailMuted === true ? ';opacity:.55' : '')
      el.append(trail)
    }
    el.style.cssText = MENU_ROW + ';color:' + (opts.danger === true
      ? 'var(--dsw-alias-label-danger, #e5484d)'
      : 'var(--dsw-alias-label-primary, inherit)')
    icon.style.cssText = ICON_BOX
    icon.querySelector('svg')?.setAttribute('width', '16')
    icon.querySelector('svg')?.setAttribute('height', '16')
    if (opts.hover !== false) {
      el.addEventListener('mouseenter', () => { el.style.background = HOVER_IN })
      el.addEventListener('mouseleave', () => { el.style.background = 'transparent' })
    }
    return el
  }

  /** 子菜单里的一枚选项行：缩进 + 前缀对勾位（未选中留空位保证文字对齐）。 */
  const optionRow = (label, selected, onPick) => {
    const el = document.createElement('button')
    el.type = 'button'
    el.setAttribute('role', 'menuitemradio')
    el.setAttribute('aria-checked', selected ? 'true' : 'false')
    const mark = document.createElement('span')
    mark.setAttribute('aria-hidden', 'true')
    mark.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none;color:var(--dsw-alias-brand-primary, #4c8dff)'
    if (selected) {
      mark.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>'
    }
    const text = document.createElement('span')
    text.textContent = label
    el.append(mark, text)
    el.style.cssText = MENU_ROW.replace('height:36px', 'height:32px')
      + ';padding-left:26px;color:var(--dsw-alias-label-primary, inherit)'
      + (selected ? ';font-weight:500' : ';opacity:.9')
    el.addEventListener('mouseenter', () => { el.style.background = HOVER_IN })
    el.addEventListener('mouseleave', () => { el.style.background = 'transparent' })
    el.addEventListener('click', (e) => { e.stopPropagation(); onPick() })
    return el
  }

  const CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5 8 10.5 12 6.5"/></svg>'

  const openMenu = (anchor) => {
    closeMenu()
    const menu = document.createElement('div')
    menu.id = MENU
    menu.setAttribute('role', 'menu')
    const r = anchor.getBoundingClientRect()
    menu.style.cssText = [
      'position:fixed',
      'left:' + r.left + 'px',
      'bottom:' + (window.innerHeight - r.top + 6) + 'px',
      'z-index:2147483000',
      'min-width:190px',
      'padding:4px',
      'border-radius:10px',
      'box-sizing:border-box',
      // 展开子菜单后菜单会变高：限制高度并允许滚动，避免顶出视口
      'max-height:' + Math.max(180, r.top - 16) + 'px',
      'overflow-y:auto',
      'background:var(--dsw-alias-bg-layer-2, #fff)',
      'border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25))',
      'box-shadow:0 8px 24px rgba(0,0,0,.18)',
    ].join(';')

    // 手风琴状态：同时只展开一个子菜单，父项之间互斥收起。
    let expandedKey = null
    const subHosts = {}
    const parents = {}

    /** 展开/收起某个父项（无参 = 全部收起）。 */
    const toggleExpand = (key, open) => {
      for (const k of Object.keys(subHosts)) {
        const on = open === true && k === key
        subHosts[k].style.display = on ? 'block' : 'none'
        const parent = parents[k]
        parent.setAttribute('aria-expanded', on ? 'true' : 'false')
        const chev = parent.querySelector('[data-kcoder-chevron]')
        if (chev !== null) chev.style.transform = on ? 'rotate(0deg)' : 'rotate(-90deg)'
      }
      expandedKey = open === true ? key : null
    }

    /** 可展开项：父行（值 + 箭头）+ 子菜单容器。 */
    const expandable = (key, opts) => {
      const parent = menuRow({
        label: opts.label,
        icon: opts.icon,
        trail: opts.value,
        trailMuted: true,
      })
      parent.setAttribute('aria-haspopup', 'true')
      parent.setAttribute('aria-expanded', 'false')
      const chev = document.createElement('span')
      chev.setAttribute('data-kcoder-chevron', '')
      chev.setAttribute('aria-hidden', 'true')
      chev.innerHTML = CHEVRON
      chev.style.cssText = 'flex:none;display:inline-flex;opacity:.6;transform:rotate(-90deg);transition:transform .12s ease'
      parent.append(chev)
      const sub = document.createElement('div')
      sub.setAttribute('role', 'group')
      sub.style.cssText = 'display:none;padding:2px 0 4px'
      for (const opt of opts.options) {
        sub.append(optionRow(opt.label, opt.selected, () => { void opts.pick(opt.id) }))
      }
      parent.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleExpand(key, expandedKey !== key)
      })
      subHosts[key] = sub
      parents[key] = parent
      return [parent, sub]
    }

    const settingsRow = menuRow({
      label: T.settings,
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 14 5l2.5-.2 1.2 2.2 2.2 1.2-.2 2.5 1.5 2-1.5 2 .2 2.5-2.2 1.2-1.2 2.2L14 19l-2 1.5L10 19l-2.5.2-1.2-2.2-2.2-1.2.2-2.5-1.5-2 1.5-2-.2-2.5 2.2-1.2 1.2-2.2L10 5l2-1.5Z"/><circle cx="12" cy="12" r="3"/></svg>',
    })
    settingsRow.addEventListener('click', (e) => {
      e.stopPropagation()
      closeMenu()
      settingsTrigger()?.click()
    })

    const [langParent, langSub] = expandable('language', {
      label: T.language,
      value: zh ? '中文' : 'English',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5Z"/></svg>',
      options: [
        { id: 'zh', label: '中文', selected: zh },
        { id: 'en', label: 'English', selected: !zh },
      ],
      pick: (id) => switchLanguage(id),
    })

    const [themeParent, themeSub] = expandable('theme', {
      label: T.theme,
      value: currentThemeTrail(),
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 8.5h5M12 12h6M12 15.5h5"/></svg>',
      options: [
        { id: 'system', label: themeLabel('system'), selected: themePref() === 'system' },
        { id: 'light', label: themeLabel('light'), selected: themePref() === 'light' },
        { id: 'dark', label: themeLabel('dark'), selected: themePref() === 'dark' },
      ],
      pick: (id) => switchTheme(id),
    })

    const logoutRow = menuRow({
      label: T.logout,
      danger: true,
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10"/><path d="M14 8l4 4-4 4M8 12h10"/></svg>',
    })
    logoutRow.addEventListener('click', (e) => {
      e.stopPropagation()
      closeMenu()
      location.assign(LOGOUT)
    })

    menu.append(settingsRow, langParent, langSub, themeParent, themeSub, logoutRow)
    document.body.append(menu)
  }

  // 账号行：头像圈（首字符）+ 用户名；navCell 同款交互 token
  //（settings-page 返回按钮同款盒模型）。折叠态（rail 收起）切
  // kcoder-folded 类：判定用容器实际宽度（≤64px 即窄条），不依赖
  // 上游折叠类名（alpha.2 的 CSS modules 编译形态不再含 "collapsed"
  // 子串，前缀选择器会落空）；折叠/展开均伴随 foot 区 DOM 重建，
  // 下方 observer 驱动 ensureChip 重跑即同步。
  const ensureChip = () => {
    const area = document.querySelector('div[class*="settingsArea"]')
    if (area === null) return
    // 设置入口只保留在账号菜单中；原始按钮仍保留在 DOM，菜单点击
    // 可以继续复用上游真实触发链路，但视觉上不再与账号行重复。
    const settingsTrigger = area.querySelector('button[class*="_trigger"][aria-haspopup="dialog"]')
    if (settingsTrigger !== null) settingsTrigger.setAttribute('data-kcoder-hidden-settings', 'true')
    let row = document.getElementById(CHIP)
    if (row !== null) {
      row.classList.toggle('kcoder-folded', area.clientWidth <= 64)
      return
    }
    row = document.createElement('button')
    row.type = 'button'
    row.id = CHIP
    row.title = NAME
    row.className = area.clientWidth <= 64 ? 'kcoder-folded' : ''
    const avatar = document.createElement('span')
    avatar.textContent = Array.from(NAME)[0]?.toUpperCase() ?? '?'
    avatar.style.cssText = [
      'flex:none;display:grid;place-items:center;border-radius:50%',
      // 尺寸/字号走样式表（#CHIP > span:first-child 基础 22px、
      // 折叠态 28px），避免行内样式压住折叠覆盖规则
      'color:var(--dsw-alias-accent-normal, #4c8dff)',
      'background:color-mix(in srgb, var(--dsw-alias-accent-normal, #4c8dff) 14%, transparent)',
    ].join(';')
    const label = document.createElement('span')
    label.textContent = NAME
    label.style.cssText = 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis'
    row.append(avatar, label)
    row.addEventListener('click', (e) => {
      e.stopPropagation()
      const existing = document.getElementById(MENU)
      if (existing !== null) { existing.remove(); return }
      openMenu(row)
    })
    area.insertBefore(row, area.firstChild)
  }

  // 静态样式：navCell 同款盒；rail 收起态切换为圆钮形态（头像居中，
  //   用户名隐藏，与上游 foot 区 36px 圆钮列同形；collapsed 类挂在
  // sidebar root 上）
  if (document.getElementById(CHIP + '_style') === null) {
    const style = document.createElement('style')
    style.id = CHIP + '_style'
    style.textContent = [
      '#' + CHIP + '{display:flex;align-items:center;gap:8px;width:100%;height:40px;padding:9px 16px 9px 12px;box-sizing:border-box;border:none;border-radius:12px;background:transparent;cursor:pointer;font-family:inherit;font-size:14px;font-weight:400;line-height:22px;color:var(--dsw-alias-label-primary);text-align:left}',
      '#' + CHIP + ' > span:first-child{width:22px;height:22px;font-size:11px;font-weight:600}',
      '#' + CHIP + ':hover{background:var(--dsw-specific-sidebar-nav-item-hover)}',
      '#' + CHIP + ':active{background:var(--dsw-specific-sidebar-nav-item-active)}',
      // settingsArea 定位锚：折叠态头像行改为绝对居中（见下）。
      '[class*="settingsArea"] [data-kcoder-hidden-settings="true"]{display:none !important}',
      '[class*="settingsArea"]{position:relative}',
      // 折叠态容器自撑占位：上游设置钮（触发行）被隐藏后 triggerRow
      // 塌缩为 0 高，绝对定位的 top:50% 会失去参照（头像贴底沿）。
      // 54px = 上游折叠态 railRow 原生占位（margin 8 + 钮 36 +
      // margin 10），头像中心与原钮位重合（中心差 ≤1px，实测定案）。
      '[class*="collapsed"] [class*="settingsArea"]{min-height:54px}',
      // 折叠态（kcoder-folded 由 ensureChip 按容器实宽维护；旧
      // [class*="collapsed"] 前缀规则保留作双保险，两条规则终态一致）：
      // 行内元素参与上游 flex 布局会把 settingsArea 撑出双倍宽导致
      // margin auto / justify 全部失效（实测定案），故脱离文档流用
      // 绝对定位居中——left/top 50% + translate 反向半身，对上游任意
      // 布局形态免疫；头像圈 28px 与上游折叠圆钮列（36×36 钮）
      // 视觉同形。
      '#' + CHIP + '.kcoder-folded,[class*="collapsed"] #' + CHIP + '{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:36px;height:36px;margin:0;padding:0;gap:0;border-radius:10px;justify-content:center;align-items:center}',
      '#' + CHIP + '.kcoder-folded > span + span,[class*="collapsed"] #' + CHIP + ' > span + span{display:none}',
      '#' + CHIP + '.kcoder-folded > span:first-child,[class*="collapsed"] #' + CHIP + ' > span:first-child{width:28px;height:28px;font-size:14px}',
    ].join('')
    document.head.append(style)
  }

  // 点击菜单外部关闭（capture 早于页面内 handler）；busy 期间不关——
  // 语言/主题切换要先打开设置面板命中控件，此时点击落在面板内即外部。
  if (!window.__kcoderAccountChipWired) {
    window.__kcoderAccountChipWired = true
    document.addEventListener('click', () => { if (!busy) closeMenu() }, true)
    window.addEventListener('blur', () => { if (!busy) closeMenu() })
  }

  ensureChip()
  new MutationObserver(ensureChip).observe(document.body, { subtree: true, childList: true })
})()`

/**
 * 挂到 shell 窗口：did-finish-load 后按当前登录账号注入（账号随脚本
 * 生成时烧入；登录态变化由登出 reload 驱动重注入）。
 */
export function attachAccountChip(win: BrowserWindow): void {
  const run = (): void => {
    if (win.isDestroyed()) return
    const { loggedIn, username } = authStatus()
    if (!loggedIn || username === null) return
    win.webContents.executeJavaScript(chipJs(username), true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次 did-finish-load 重试
    })
  }
  win.webContents.on('did-finish-load', run)
  run()
}
