/**
 * 账号行注入器（零侵入）：workspace 侧边栏底部设置按钮上方注入
 * 「头像 + 登录账号」行，点击弹自绘菜单（设置 / 退出登录）。原始
 * sidebar.settings 按钮隐藏，设置入口只保留在用户菜单中。
 *
 * 定位与行为（上游契约见 SidebarRoot.tsx / SettingsRoot.tsx）：
 * - 宿主：`div[class*="settingsArea"]`（SidebarRoot 侧边栏 foot 区，
 *   `sidebar.settings` slot 的挂载容器，settings trigger 按钮之家）；
 *   账号行插容器首位，同时隐藏原始 settings trigger，避免入口重复；
 * - 菜单「设置」：转发 settings trigger 真实点击
 *   （`button[class*="_trigger"][aria-haspopup="dialog"]`，SettingsRoot
 *   专属组合锚）——走上游打开设置面板的完整路径（单页化形态照常）；
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
 * React 重渲染重建 settingsArea → MutationObserver 自愈重插。
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

  // 菜单：账号行上方弹出（侧边栏贴左缘，向上展开）；自绘层用上游
  // token 上色（bg-layer-2 + border-l1 + 阴影），跟随主题。
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
      'min-width:168px',
      'padding:4px',
      'border-radius:10px',
      'background:var(--dsw-alias-bg-layer-2, #fff)',
      'border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25))',
      'box-shadow:0 8px 24px rgba(0,0,0,.18)',
    ].join(';')
    const item = (label, danger, onClick, iconMarkup) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.setAttribute('role', 'menuitem')
      const icon = document.createElement('span')
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = iconMarkup
      const text = document.createElement('span')
      text.textContent = label
      el.append(icon, text)
      el.style.cssText = [
        'display:flex;align-items:center;gap:9px;width:100%;height:40px',
        'padding:0 12px;box-sizing:border-box;border:none;border-radius:8px',
        'background:transparent;cursor:pointer;text-align:left',
        'font-family:inherit;font-size:14px;font-weight:400;line-height:22px',
        'color:' + (danger
          ? 'var(--dsw-alias-label-danger, #e5484d)'
          : 'var(--dsw-alias-label-primary, inherit)'),
      ].join(';')
      icon.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;opacity:.82'
      icon.querySelector('svg')?.setAttribute('width', '16')
      icon.querySelector('svg')?.setAttribute('height', '16')
      el.addEventListener('mouseenter', () => {
        el.style.background = 'var(--dsw-specific-sidebar-nav-item-hover, rgba(128,128,128,.12))'
      })
      el.addEventListener('mouseleave', () => { el.style.background = 'transparent' })
      el.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); onClick() })
      return el
    }
    menu.append(
      item('设置', false, () => {
        document.querySelector('button[class*="_trigger"][aria-haspopup="dialog"]')?.click()
      }, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 14 5l2.5-.2 1.2 2.2 2.2 1.2-.2 2.5 1.5 2-1.5 2 .2 2.5-2.2 1.2-1.2 2.2L14 19l-2 1.5L10 19l-2.5.2-1.2-2.2-2.2-1.2.2-2.5-1.5-2 1.5-2-.2-2.5 2.2-1.2 1.2-2.2L10 5l2-1.5Z"/><circle cx="12" cy="12" r="3"/></svg>'),
      item('退出登录', true, () => { location.assign(LOGOUT) }, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10"/><path d="M14 8l4 4-4 4M8 12h10"/></svg>'),
    )
    document.body.append(menu)
  }

  // 账号行：头像圈（首字符）+ 用户名；navCell 同款交互 token
  //（settings-page 返回按钮同款盒模型）
  const ensureChip = () => {
    const area = document.querySelector('div[class*="settingsArea"]')
    if (area === null) return
    // 设置入口只保留在账号菜单中；原始按钮仍保留在 DOM，菜单点击
    // 可以继续复用上游真实触发链路，但视觉上不再与账号行重复。
    const settingsTrigger = area.querySelector('button[class*="_trigger"][aria-haspopup="dialog"]')
    if (settingsTrigger !== null) settingsTrigger.setAttribute('data-kcoder-hidden-settings', 'true')
    if (document.getElementById(CHIP) !== null) return
    const row = document.createElement('button')
    row.type = 'button'
    row.id = CHIP
    row.title = NAME
    const avatar = document.createElement('span')
    avatar.textContent = Array.from(NAME)[0]?.toUpperCase() ?? '?'
    avatar.style.cssText = [
      'flex:none;display:grid;place-items:center',
      'width:22px;height:22px;border-radius:50%',
      'font-size:11px;font-weight:600',
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
      '#' + CHIP + ':hover{background:var(--dsw-specific-sidebar-nav-item-hover)}',
      '#' + CHIP + ':active{background:var(--dsw-specific-sidebar-nav-item-active)}',
      '[class*="settingsArea"] [data-kcoder-hidden-settings="true"]{display:none !important}',
      '[class*="collapsed"] #' + CHIP + '{height:36px;justify-content:center;padding:0;gap:0;border-radius:10px}',
      '[class*="collapsed"] #' + CHIP + ' > span + span{display:none}',
    ].join('')
    document.head.append(style)
  }

  // 点击菜单外部关闭（capture 早于页面内 handler）
  if (!window.__kcoderAccountChipWired) {
    window.__kcoderAccountChipWired = true
    document.addEventListener('click', closeMenu, true)
    window.addEventListener('blur', closeMenu)
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
