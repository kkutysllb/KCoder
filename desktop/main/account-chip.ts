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
 *   36px 圆钮列同形，用户名隐藏），点击照常弹菜单；同一格上还压着上游
 *   设置触发行的空外壳（settings-general 的 triggerRow.railRow，定位
 *   元素、DOM 在我们之后），样式表用 z-index:2 把头像圈提到它之上——
 *   否则外观正常、点击却被它吃掉（2026-09-20 实测定案，见静态样式块）；
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

/** 本次构建标记：写进注入脚本并在页面 console 打印，用于确认运行实例的版本。 */
const BUILD_MARK = new Date().toISOString().replace('T', ' ').slice(0, 19)

/** 注入脚本（页面上下文；USERNAME/LOGOUT_URL 由挂载侧生成时注入）。 */
const chipJs = (username: string, build: string): string => `(() => {
  const BUILD = ${JSON.stringify(build)}
  const BRIDGE_KEY = '__kcoderShellPrefs'
  const NAME = ${JSON.stringify(username)}
  const LOGOUT = ${JSON.stringify(AUTH_LOGOUT_URL)}
  const CHIP = ${JSON.stringify(CHIP_ID)}
  const MENU = ${JSON.stringify(MENU_ID)}

  const closeMenu = () => {
    const m = document.getElementById(MENU)
    if (m !== null) m.remove()
  }

  /**
   * 上游设置面板的真实触发按钮（SettingsRoot 专属组合锚）。菜单「设置」项
   * 转发它的真实点击走上游完整打开路径。注意：按钮被本注入器隐藏
   * （display:none 的元素 .click() 照常派发事件），但 DOM 里始终存在。
   */
  const settingsTrigger = () => document.querySelector('button[class*="_trigger"][aria-haspopup="dialog"]')

  /**
   * 当前界面语言是否中文——**每次读取，不烘焙**。
   *
   * 早期版本把它算成模块常量，于是菜单标签、子菜单当前值、对勾全停在脚本
   * 注入那一刻的语言：切到英文后重开菜单，标题与对勾仍是中文（功能其实已
   * 生效）。现在改为实时判定：桥（上游 active）优先，DOM lang 兜底。
   */
  const isZh = () => {
    const b = window.__kcoderShellPrefs
    if (b !== undefined && b !== null && typeof b.getLocale === 'function') {
      const info = b.getLocale()
      if (info !== null && typeof info.id === 'string' && info.id !== '') {
        return info.id.toLowerCase().indexOf('zh') === 0
      }
    }
    return (document.documentElement.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  /** 菜单文案（开菜单时算一次，随当前语言自洽）。 */
  const strings = () => isZh()
    ? { settings: '设置', language: '语言', theme: '主题', logout: '退出登录', general: '通用设置' }
    : { settings: 'Settings', language: 'Language', theme: 'Theme', logout: 'Sign out', general: 'General' }

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
   * 上游偏好桥（由内置 bundle dsh-shell-prefs 的 client 半发布）。
   *
   * 为什么用桥而不是模拟点击设置控件：注入脚本没有 window 级服务桥可触达
   * ctx.locale.setLocale / ctx.theme.setTheme，早前那版靠"打开设置面板
   * → 点通用区控件"，每一步都在猜锚点（行标题被产品注入的「回答语言」抢中、
   * 命中却静默失败）。dsh-shell-prefs 的 client 半直接注入这两个服务并把
   * 窄接口发布到 window，于是偏好写入走上游唯一入口——与设置页里点的是同一
   * 条路径，不存在第二条事实源。
   *
   * 桥缺席（bundle 未装 / 该部署未启用对应插件）→ 菜单项降级为只读提示。
   */
  const bridge = () => {
    const b = window[BRIDGE_KEY]
    return b !== undefined && b !== null && typeof b === 'object' ? b : null
  }

  /** 语言父项的当前值：取上游 active 的 label（桥给不出时退回内置两项的匹配）。 */
  const langTrail = () => {
    const active = localeActive()
    const hit = localeOptions().find(o => o.id === active)
    if (hit !== undefined) return hit.label
    return active === 'zh' ? '中文' : 'English'
  }

  /** 语言选项（桥给不出时退回内置两项；上游内置语言就是这两个）。 */
  const localeOptions = () => {
    const b = bridge()
    const info = b !== null && typeof b.getLocale === 'function' ? b.getLocale() : null
    if (info !== null && Array.isArray(info.options) && info.options.length > 1) return info.options
    return [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }]
  }

  /** 当前语言 id（桥给不出时按页面 lang 兜底）。 */
  const localeActive = () => {
    const b = bridge()
    const info = b !== null && typeof b.getLocale === 'function' ? b.getLocale() : null
    if (info !== null && typeof info.id === 'string' && info.id !== '') return info.id
    return isZh() ? 'zh' : 'en'
  }

  /** 主题选项：上游三档（跟随系统/浅色/深色）＋偏好档当前值。 */
  const THEME_OPTIONS = [
    { id: 'system', zh: '跟随系统', en: 'System' },
    { id: 'light', zh: '浅色', en: 'Light' },
    { id: 'dark', zh: '深色', en: 'Dark' },
  ]

  const themeOptions = () => THEME_OPTIONS.map(o => ({ id: o.id, label: isZh() ? o.zh : o.en }))

  /** 当前主题偏好档（桥给不出时按实色兜底——不误标实色档）。 */
  const themeActive = () => {
    const b = bridge()
    const info = b !== null && typeof b.getTheme === 'function' ? b.getTheme() : null
    if (info !== null && typeof info.id === 'string' && info.id !== '') return info.id
    return themePref()
  }

  /** 走桥切换语言；返回 false 表示桥不可用或上游拒绝。 */
  const setLocaleViaBridge = (id) => {
    const b = bridge()
    if (b === null || typeof b.setLocale !== 'function') return false
    return b.setLocale(id) === true
  }

  /** 走桥切换主题。 */
  const setThemeViaBridge = (id) => {
    const b = bridge()
    if (b === null || typeof b.setTheme !== 'function') return false
    return b.setTheme(id) === true
  }

  /**
   * 切换语言：直接调上游 locale.setLocale（经 dsh-shell-prefs 的桥）。
   *
   * 与早前"模拟点击设置控件"的版本相比少了整整一层不确定性：不再需要打开
   * 设置面板、不猜行标题/按钮锚点、不解析上游菜单项文案。写入走上游唯一入口，
   * 设置页里的选择器会同步跟着变（同一份状态）。
   */
  const switchLanguage = (targetId) => {
    if (localeActive() === targetId) {
      const hit = localeOptions().find(o => o.id === targetId)
      notify((isZh() ? '当前已是 ' : 'Already ') + (hit === undefined ? targetId : hit.label))
      return
    }
    if (!setLocaleViaBridge(targetId)) {
      notify(isZh() ? '语言偏好桥不可用（dsh-shell-prefs 未装或上游契约已变）' : 'Language bridge unavailable')
      return
    }
    const hit = localeOptions().find(o => o.id === targetId)
    notify((isZh() ? '已切换为 ' : 'Switched to ') + (hit === undefined ? targetId : hit.label))
  }

  /**
   * 切换主题：直接调上游 theme.setTheme（经同一座桥）。
   *
   * 主题 id 就是上游偏好档 id（system / light / dark），不再需要按立方块
   * 文案匹配、也不再有"渲染顺序 ≠ 声明序"那类错位风险。
   */
  const switchTheme = (targetId) => {
    if (themeActive() === targetId) {
      notify(isZh() ? '当前已是 ' + themeLabel(targetId) : 'Already ' + themeLabel(targetId))
      return
    }
    if (!setThemeViaBridge(targetId)) {
      notify(isZh() ? '主题偏好桥不可用（dsh-shell-prefs 未装或上游契约已变）' : 'Theme bridge unavailable')
      return
    }
    notify(isZh() ? '已切换主题：' + themeLabel(targetId) : 'Theme: ' + themeLabel(targetId))
  }

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
  const currentThemeValue = () => isDark() ? (isZh() ? '深色' : 'Dark') : (isZh() ? '浅色' : 'Light')

  /** 主题三档的显示名。 */
  const themeLabel = (id) => {
    if (id === 'system') return isZh() ? '跟随系统' : 'System'
    if (id === 'light') return isZh() ? '浅色' : 'Light'
    return isZh() ? '深色' : 'Dark'
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
      trail.setAttribute('data-kcoder-trail', '')
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

  /**
   * 打开账号菜单。
   * @param anchor - 定位锚（账号行）。
   * @param keepOpenKey - 刷新后保持展开的组（'language' | 'theme'）：选中某项后
   *   不关菜单、就地重绘并保持该组展开，对勾**当场**移过去，还能连续切换。
   */
  const openMenu = (anchor, keepOpenKey) => {
    closeMenu()
    const T = strings()
    // 诊断：每次打开菜单打印"菜单自己算出来的状态"。三轮"改了但现象不变"之后，
    // 这是唯一能一次定位的读数——它同时暴露：脚本版本、页面语言、桥是否就绪、
    // 桥给的语言、菜单算出的当前语言、各选项 id。
    try {
      const binfo = (() => { const b = bridge(); return b === null ? null : b.getLocale() })()
      console.log('[account-chip] openMenu'
        + ' build=' + BUILD
        + ' domLang=' + document.documentElement.lang
        + ' bridge=' + (bridge() !== null)
        + ' bridgeLocale=' + (binfo === null ? 'null' : binfo.id)
        + ' isZh=' + isZh()
        + ' active=' + localeActive()
        + ' options=' + localeOptions().map(o => o.id).join('|'))
    } catch (error) {
      console.log('[account-chip] openMenu diag threw: ' + String(error && error.message))
    }
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
        sub.append(optionRow(opt.label, opt.selected, () => {
          // 选中后**不关菜单**：先走切换，再原地重绘（对勾当场移动、组保持展开）。
          // 关闭由用户点击外部/设置项/退出登录完成——与"选了就想看到结果"的
          // 预期一致，也允许连续切换两项。
          void Promise.resolve(opts.pick(opt.id)).then(() => {
            const root = document.getElementById(MENU)
            if (root !== null) openMenu(anchor, key)
          })
        }))
      }
      if (keepOpenKey === key) {
        // 本次打开是为了刷新：保持该组展开，并让 chevron 指向展开态
        sub.style.display = 'block'
        parent.setAttribute('aria-expanded', 'true')
        chev.style.transform = 'rotate(0deg)'
        expandedKey = key
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
      value: langTrail(),
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5Z"/></svg>',
      // 选项与当前值都取自上游服务（经 dsh-shell-prefs 的桥）：语言集合由本
      // 部署注册了什么决定，不在壳里写死；对勾按上游 active 标。
      options: localeOptions().map(o => ({ id: o.id, label: o.label, selected: o.id === localeActive() })),
      pick: (id) => switchLanguage(id),
    })

    const [themeParent, themeSub] = expandable('theme', {
      label: T.theme,
      value: currentThemeTrail(),
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 8.5h5M12 12h6M12 15.5h5"/></svg>',
      // 三档来自壳：上游 themes 注册表只含 light/dark——system 是**偏好档**、
      // 不是可注册主题，若只按桥返回的 options 渲染「跟随系统」会消失；当前档
      // 仍读上游 preference（桥），对勾据此标。
      options: themeOptions().map(o => ({ id: o.id, label: o.label, selected: o.id === themeActive() })),
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
      //
      // z-index:2 是**点击可用性的必要条件**，不是修饰：折叠态上游设置
      // 触发行的外壳（settings-general 的 triggerRow.railRow：36×36、
      // position:relative、DOM 排在我们之后）与本头像圈同格同位。它虽然
      // 是空的（里面的 trigger 按钮被上面那条 display:none 隐藏），但作为
      // 定位元素仍排在绘制与命中之上——实测：不给 z-index 时该点
      // elementFromPoint 命中 triggerRow 而非头像，点击「设置/语言/主题/
      // 退出登录」全无反应（外观照旧，故只在点击上暴露）。z-index:2 只需
      // 压过同层 z-index:auto 的定位兄弟，不引入新的层叠竞争。
      '#' + CHIP + '.kcoder-folded,[class*="collapsed"] #' + CHIP + '{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:36px;height:36px;margin:0;padding:0;gap:0;border-radius:10px;justify-content:center;align-items:center;z-index:2}',
      '#' + CHIP + '.kcoder-folded > span + span,[class*="collapsed"] #' + CHIP + ' > span + span{display:none}',
      '#' + CHIP + '.kcoder-folded > span:first-child,[class*="collapsed"] #' + CHIP + ' > span:first-child{width:28px;height:28px;font-size:14px}',
    ].join('')
    document.head.append(style)
  }

  // 点击菜单外部关闭。
  //
  // 为什么必须显式判「点在菜单内」而不能靠子元素 stopPropagation()：
  // 本监听挂在**捕获阶段**（早于页面内 handler 执行），而子元素的
  // stopPropagation 发生在冒泡阶段——事件还没走到子元素，菜单就已经被
  // 关掉了。现场：点「语言」父项 → 菜单直接消失、子菜单从未出现（未推送
  // 初版的实测现象）。故此处按 event.target 归属判定，与阶段顺序无关。
  //
  if (!window.__kcoderAccountChipWired) {
    window.__kcoderAccountChipWired = true
    const insideMenu = (target) => {
      const m = document.getElementById(MENU)
      if (m === null) return false
      if (!(target instanceof Node)) return false
      return m === target || m.contains(target)
    }
    document.addEventListener('click', (e) => {
      if (insideMenu(e.target)) return
      closeMenu()
    }, true)
    window.addEventListener('blur', () => { closeMenu() })
  }

  // 构建标记：每次改本脚本都会变，用于一眼确认运行中的实例到底是哪一版
  // （多轮"改了但现象不变"的排查教训——先确认代码在跑，再谈逻辑）。
  console.log('[account-chip] build=' + BUILD + ' lang=' + document.documentElement.lang
    + ' bridge=' + (window[BRIDGE_KEY] !== undefined && window[BRIDGE_KEY] !== null))

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
    win.webContents.executeJavaScript(chipJs(username, BUILD_MARK), true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次 did-finish-load 重试
    })
  }
  win.webContents.on('did-finish-load', run)
  run()
}
