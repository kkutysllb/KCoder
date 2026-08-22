/**
 * 上下文面板 GUI 入口（零侵入注入器）：状态栏插件代理与终端按钮
 * （sidebar-cluster 侧栏面板 12 / terminal-panel 内嵌终端 44）左侧
 * 注入「上下文」
 * 按钮（right 76），点击等价在输入框敲 /context 回车——dsh-context
 * 插件的 input trigger 真实契约（matchEnter 精确匹配 line ===
 * '/context' → modalStore.set(true) → 返回 'handled'：不发送消息、
 * 不进会话记录、模型不可见），比直调插件内部句柄稳（无全局句柄可调，
 * 模块闭包内）。
 *
 * 打开态接管（无论 GUI 还是手输 /context 打开，一律接管）：
 * - 沉浸模式：modal 开 → html 加 __dsh_ctx_mode class（三个让位层
 *   CSS display:none：better-sidebar 面板 host、上游侧栏列、上游
 *   overlay 层——它们 z 均低于 backdrop:200，DOM 已被盖，display:none
 *   消除半透明 backdrop 下的透出杂音；退出零状态记录，class 移除即
 *   复原）+ console 上报主进程隐藏终端 view（WebContentsView 在
 *   compositor 层，页面 DOM 永远盖不住它，必须主进程
 *   setVisible(false)；modal 关后按用户开合偏好原样恢复）；状态栏
 *   按钮全部保留可见（沉浸期间点终端按钮无反应——show() 在
 *   ctxMode 早退；点面板/折叠按钮改的是插件/上游状态，退出后按
 *   最终状态呈现，符合直觉）；
 * - 拉满主页面区域：插件 backdrop 本就 position:fixed inset:0
 *   z-index:200，而自绘状态栏 z=int32 最大值恒在其上——天然只覆盖
 *   状态栏以下；注入 CSS 把 720px 居中卡片改为 padding-top:48px
 *   （状态栏高）下的全幅铺满；
 * - backdrop 右上角注入「返回任务」按钮（z 高于卡片）：点击转发插件
 *   自带 × 关闭钮（lc-modal-close，真实关闭路径——插件的
 *   pendingConsume 会在关闭时把 composer 里的 /context token 消费掉），
 *   × 缺席兜底派发 Escape；
 * - 草稿保护：GUI 打开是模拟输入，先存 composer 草稿，modal 关闭且
 *   插件消费完 token（框回空）后再恢复——用户半截打字的草稿不丢；
 *   恢复带 guard（框非空不碰，绝不覆盖用户新输入）。
 *
 * 上游契约（运行时探测）：composer 锚 [data-composer-card] textarea
 * （data 属性是稳定 API 面）；modal 锚 .lc-modal-backdrop /
 * .lc-modal-close（dsh-context 私有 lc- 前缀，不与他插件冲突）；
 * 让位锄 [data-dsh-better-sidebar]（插件面板 host——dsh-better-sidebar
 * 自己 appendChild 到 body 直下的独立 div，不在 frame 内；插件带
 * 守护 observer 会在 host 被移出 body 时重挂，故只能 CSS 让位不能
 * 动 DOM，display:none 不触发重挂）/[class*="sidebarCol"]（上游侧栏
 * 列）/[class*="overlayLayer"]（上游 overlay 层，z:20）。console 通道
 * 前缀 __dsh_ctx__:1/0（见 console-channel，terminal-panel.onConsole
 * 消费）。受控输入须用原型 value setter + input 事件（React onChange
 * 才收得到），Enter 用合成 keydown（上游无 isTrusted 检查）；React 状态
 * 异步，输入后隔一拍（60ms）再派发 Enter，matchEnter 才能读到整行。
 *
 * 草稿回滚/恢复的时序容错：Enter 后轮询等 modal（首次打开插件懒加载
 * 可达秒级，一次性超时判定会在 modal 迟到时误回滚，实测踩过），5s
 * 未现（插件缺席/提交锁 machineBusy 拒改草稿）才回滚；modal 关闭后
 * 等 350ms（React 状态落定）再恢复。dsh-context 为预装插件
 * （preset-plugins），按钮常驻；无 composer（空态无会话）→ 按钮
 * disabled 置灰。
 *
 * right 序（全局，见 theme-watcher 避让带同步）：侧栏面板 12 /
 * 内嵌终端 44 / 上下文 76。
 *
 * @module desktop/main/context-button
 */
import type { BrowserWindow } from 'electron'
import { SHELL_TITLEBAR_HEIGHT } from './theme-watcher'

/** 「上下文」按钮 id（挂自绘状态栏，right 序第三枚）。 */
const CONTEXT_BTN_ID = '__dsh_desktop_context_btn'

/** 右缘 right 偏移（DIP）：侧栏面板与终端按钮（12/44）左侧第三枚。 */
const CONTEXT_BTN_RIGHT = 76

/** 「返回任务」按钮 id（挂插件 backdrop 右上角，随 backdrop 消亡）。 */
const BACK_BTN_ID = '__dsh_desktop_context_back'

/** 沉浸模式 console 上报前缀（terminal-panel.onConsole 消费）。 */
const CONTEXT_PREFIX = '__dsh_ctx__:'

/** IconQueueOutline14（上游 ui-primitives，对话气泡 + 内容行 = 会话
 * 上下文；v1 用 IconDataOutline16 被看成汉字——三枚六边形集群在
 * 16px 下似「品」形，换此更直观。viewBox 14 由按钮 CSS 拉到 16px；
 * path 静态内联，注入时一次写死，任何 observer 不得回写比较）。 */
const ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M7.00049 0.199829C3.24488 0.199829 0.199952 3.24408 0.199707 6.99963C0.199707 8.0414 0.434087 9.03061 0.854004 9.91467L1.11279 10.4576L2.19775 9.94202L1.94092 9.39905L1.81787 9.12268C1.5498 8.46885 1.40186 7.75171 1.40186 6.99963C1.4021 3.90808 3.90888 1.40198 7.00049 1.40198C10.0919 1.40219 12.5979 3.90821 12.5981 6.99963C12.5981 10.0913 10.0921 12.5981 7.00049 12.5983C6.36734 12.5983 5.90348 12.5535 5.49268 12.4401C5.08803 12.3283 4.7041 12.1414 4.24463 11.8209C3.57111 11.3511 2.60588 11.1855 1.81006 11.6881L1.79736 11.6959L1.78467 11.7047L1.25537 12.0778L1.65381 13.2672L2.46045 12.6989C2.75029 12.5214 3.18004 12.5442 3.55615 12.8063C4.10063 13.1861 4.60863 13.4423 5.17334 13.5983C5.73194 13.7525 6.31665 13.8004 7.00049 13.8004C10.7561 13.8002 13.8003 10.7553 13.8003 6.99963C13.8 3.24421 10.7559 0.200041 7.00049 0.199829ZM3.81201 7.47327V8.67542H7.11572V7.47327H3.81201ZM3.81201 6.34924H10.2173V5.14709H3.81201V6.34924Z"/></svg>'

const PAGE_JS = `(() => {
  if (window.__dshContextBtnWired) return
  window.__dshContextBtnWired = true
  const BTN = '${CONTEXT_BTN_ID}'
  const BACK = '${BACK_BTN_ID}'
  const BAR_H = ${SHELL_TITLEBAR_HEIGHT}
  const LINE = '/context'
  const bar = () => document.getElementById('__dsh_desktop_titlebar')
  const modal = () => document.querySelector('.lc-modal-backdrop')
  const ta = () => document.querySelector('[data-composer-card] textarea')
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  const setDraft = (t, v) => {
    valueSetter.call(t, v)
    t.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const style = document.createElement('style')
  style.id = '__dsh_desktop_context_style'
  style.textContent = [
    // 状态栏按钮（与 sidebar-cluster 代理按钮同款规格）
    '#' + BTN + '{all:unset;box-sizing:border-box;position:absolute;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    '#' + BTN + ' svg{width:16px;height:16px;display:block;flex:none}',
    '#' + BTN + '{right:${CONTEXT_BTN_RIGHT}px}',
    'body[data-ds-dark-theme] #' + BTN + '{color:rgba(232,234,237,.8)}',
    '#' + BTN + ':hover:not(:disabled){background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#' + BTN + ':active:not(:disabled){background:color-mix(in srgb,currentColor 18%,transparent)}',
    '#' + BTN + ':disabled{opacity:.4;cursor:default}',
    // 拉满主页面区域：backdrop 让出状态栏高，卡片全幅铺满（lc- 前缀为
    // dsh-context 私有命名空间；modal 不存在时规则无目标零副作用）
    '.lc-modal-backdrop{padding-top:' + BAR_H + 'px !important;align-items:stretch !important}',
    '.lc-modal-card{width:100% !important;max-width:none !important;height:100% !important;max-height:none !important;border-radius:0 !important}',
    // 沉浸让位（三个遮挡源 CSS 退场，退出 class 移除即复原）：
    // - [data-dsh-better-sidebar]：插件面板 host（body 直下独立 div，
    //   不在 frame 内；插件带守护 observer 会重挂被移出的 host，故只能
    //   CSS 让位不能动 DOM，display:none 不触发重挂）；
    // - [class*="sidebarCol"]：上游侧栏列；[class*="overlayLayer"]：
    //   上游 overlay 层（z:20）。
    // 状态栏按钮全部保留可见（藏按钮是 v1 的错误设计，用户否决）。
    '.__dsh_ctx_mode [data-dsh-better-sidebar], .__dsh_ctx_mode [class*="sidebarCol"], .__dsh_ctx_mode [class*="overlayLayer"]{display:none !important}',
    // 「返回任务」按钮（挂 backdrop 内，随 backdrop 消亡，无需清理）
    '#' + BACK + '{all:unset;box-sizing:border-box;position:absolute;top:' + (BAR_H + 10) + 'px;right:12px;z-index:1;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 12px;border-radius:7px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font:500 12px -apple-system,"PingFang SC","Segoe UI",sans-serif;cursor:pointer;box-shadow:0 2px 8px #0003}',
    '#' + BACK + ' svg{width:14px;height:14px;display:block;flex:none}',
    '#' + BACK + ':hover{border-color:color-mix(in srgb,currentColor 30%,var(--dsw-alias-border-l1))}',
    '#' + BACK + ':active{background:color-mix(in srgb,currentColor 8%,var(--dsw-alias-bg-layer-1))}',
  ].join('')
  document.head.append(style)

  // modal 关闭且插件消费完 token（框回空）后恢复草稿；框非空不碰
  // （绝不覆盖用户此时的新输入）。interval 泄漏兜底 120s。
  const restoreAfterClose = (saved) => {
    if (saved === '') return
    const started = Date.now()
    const iv = setInterval(() => {
      if (modal() != null) {
        if (Date.now() - started > 120000) clearInterval(iv)
        return
      }
      clearInterval(iv)
      setTimeout(() => {
        const t = ta()
        if (t != null && t.value === '') setDraft(t, saved)
      }, 350)
    }, 200)
  }

  // 打开：模拟「输入 /context + 回车」走插件 input trigger 真实契约
  // （matchEnter → handled：不发送消息、不进会话记录）
  const openPanel = () => {
    if (modal() != null) return
    const t = ta()
    if (t == null || t.disabled) return
    const saved = t.value
    setDraft(t, LINE)
    // React 状态异步：隔一拍再派发 Enter，matchEnter 才能读到整行。
    // 之后轮询等 modal：首次打开插件懒加载可达秒级，一次性超时判定
    // 会在 modal 迟到时误回滚草稿（实测踩过），轮询 + 5s 兑底才稳。
    setTimeout(() => {
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
      const started = Date.now()
      const iv = setInterval(() => {
        if (modal() != null) {
          clearInterval(iv)
          restoreAfterClose(saved)
          return
        }
        if (Date.now() - started > 5000) {
          clearInterval(iv)
          // 插件缺席/提交锁拒改草稿 → 回滚（框值仍是整行时才碰）
          const cur = ta()
          if (cur != null && cur.value === LINE) setDraft(cur, saved)
        }
      }, 150)
    }, 60)
  }

  // 沉浸模式开关：只在 modal 出现/消失的翻转沿上报（sync 每次变更
  // 都跑）。页面重载会丢 class 与 ctxOn 记忆，主进程侧 onDidLoad
  // 复位兑底；console 上报丢失时主进程 ctxMode 卡住由同一路径自愈。
  let ctxOn = false
  const setCtxMode = (on) => {
    ctxOn = on
    document.documentElement.classList.toggle('__dsh_ctx_mode', on)
    console.log('${CONTEXT_PREFIX}' + (on ? '1' : '0'))
  }

  // 「返回任务」注入（幂等）：点插件自带 × 走真实关闭路径
  // （pendingConsume 消费 composer 里的 token）；× 缺席兜底 Escape
  const injectBack = () => {
    const bd = modal()
    if (bd == null || document.getElementById(BACK) != null) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = BACK
    btn.title = '返回任务'
    btn.setAttribute('aria-label', '返回任务')
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8.5 2.15137L8.07617 2.57617L5.34863 5.30273C5.09294 5.55843 4.86618 5.78438 4.70215 5.98828C4.53117 6.20088 4.38244 6.44405 4.33398 6.75C4.30778 6.91565 4.30778 7.08435 4.33398 7.25C4.38244 7.55595 4.53117 7.79912 4.70215 8.01172C4.86618 8.21561 5.09294 8.44157 5.34863 8.69727L8.07617 11.4238L8.5 11.8486L9.34863 11L8.92383 10.5762L6.19727 7.84863C5.92268 7.57405 5.75151 7.40124 5.6377 7.25977C5.53096 7.12709 5.52187 7.07728 5.51953 7.0625C5.51297 7.02105 5.51297 6.97895 5.51953 6.9375C5.52187 6.92272 5.53096 6.87291 5.6377 6.74023C5.75152 6.59876 5.92268 6.42595 6.19727 6.15137L8.92383 3.42383L9.34863 3L8.5 2.15137Z"/></svg><span>返回任务</span>'
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const x = document.querySelector('.lc-modal-close')
      if (x != null) {
        x.click()
        return
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    bd.append(btn)
  }

  const injectBtn = () => {
    if (document.getElementById(BTN) != null) return 'present'
    const host = bar()
    if (host == null) return 'absent'
    const b = document.createElement('button')
    b.type = 'button'
    b.id = BTN
    b.title = '上下文'
    b.setAttribute('aria-label', '上下文')
    b.innerHTML = '${ICON_SVG}'
    b.addEventListener('click', openPanel)
    host.append(b)
    return 'injected'
  }

  // 无 composer（空态无会话）→ 置灰；手输 /context 打开的 modal
  // 一并接管（拉满 + 返回按钮）
  const sync = () => {
    const b = document.getElementById(BTN)
    if (b != null && b.disabled !== (ta() == null)) b.disabled = ta() == null
    const inCtx = modal() != null
    if (inCtx !== ctxOn) setCtxMode(inCtx)
    if (inCtx) injectBack()
  }

  let tries = 0
  const poll = setInterval(() => {
    const status = injectBtn()
    sync()
    if (status !== 'absent' || ++tries > 120) clearInterval(poll)
  }, 500)

  new MutationObserver(sync).observe(document.body, { subtree: true, childList: true })
})()`

/**
 * 把上下文面板 GUI 入口挂到 shell 窗口：
 * 仅 darwin/win32（自绘状态栏存在的平台）；did-finish-load 注入
 * （每次导航后重新注入，脚本自幂等）。
 */
export function attachContextButton(win: BrowserWindow): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  })
}
