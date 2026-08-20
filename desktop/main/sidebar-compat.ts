/**
 * better-sidebar 底面板布局垫片：补齐插件在 rc.8 基线上失效的
 * 「占位而非覆盖」挤压。
 *
 * 插件机制（v0.14.0 layout.css）：底面板开合把高度写进 `<html>` 的
 * `--dsh-sidebar-height`，再由 `#root [data-dsh-frame] >
 * [data-pane="conversation"]` 落成对话列的 margin-bottom——网格拉伸项
 * 被 margin 收缩，消息输出与输入框整体抬升，absolute 贴底（z-40）的
 * 终端/Git 面板“占位”而非“覆盖”。
 *
 * 缺陷：`data-dsh-frame` / `data-pane` 是上游 rc.8 **之后**才引入的
 * 属性（作者对着 0.1.x 实物页验证），rc.8 的 AppFrame 只有 CSS modules
 * 类名——选择器在 KCoder 钉版基线上匹配不到任何元素，margin 落空，
 * 开终端面板直接盖住输入框。右侧文件树不受影响：宽度挤压挂 #root
 * 本体，不依赖该锚。
 *
 * 垫片按 rc.8 结构复刻同一声明：中心列锚 `centerCol` 类名 + 直接子级
 * `conversation` 槽位壳（:has 锁唯一，正是插件运行时自己的定位器——
 * `querySelector('#root [data-slot="conversation"]').parentElement`，
 * 面板本体定位在 rc.8 一直正常即其佐证）。与插件原规则声明完全相同
 * （同一变量同一值）：上游基线升级带上 data-pane 后两规则不叠加
 * （同属性同值，胜者任意）；centerCol 类名若被上游改名（§7 契约），
 * 垫片静默失效回到插件原状，需随契约清单同步。
 *
 * 第二垫片（宽度挤压门控）：底面板拖高的 move 处理器把
 * --dsh-sidebar-width 写成右侧栏持久化宽度（不按 panelOpen 门控），
 * 侧栏关闭时拖高会横向压缩主区域——用插件自维的
 * body[data-dsh-sidebar-collapsed] 把宽度挤压限定在面板开启态。
 *
 * @module desktop/main/sidebar-compat
 */

import type { BrowserWindow } from 'electron'

/** 注入样式元素 id（页面上下文）。 */
const STYLE_ID = '__dsh_desktop_sidebar_compat_style'

/** 垫片样式（静态；变量缺省 0px = 无面板时零影响）。 */
const COMPAT_CSS = `
#root [class*="centerCol"]:has(> [data-slot="conversation"]) {
  margin-bottom: var(--dsh-sidebar-height, 0px);
  transition: margin-bottom var(--ds-transition-duration-slow) var(--ds-ease-in-out);
}
body[data-dsh-sidebar-dragging] #root [class*="centerCol"]:has(> [data-slot="conversation"]) {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  #root [class*="centerCol"]:has(> [data-slot="conversation"]) { transition: none; }
}

/* 宽度挤压门控：底面板拖高的 move 处理器把 --dsh-sidebar-width 写成右侧栏
   持久化宽度（state.width，不按 panelOpen 门控，v0.14.0），侧栏关闭时拖高
   会横向压缩 #root，松手后才由 layout-push effect 复位。插件在 body 上
   维护 data-dsh-sidebar-collapsed（面板关闭必在，其 layout.css 的 header
   padding 规则同锚）——用它把宽度挤压限定在面板开启态；选择器特异性
   (1,1,1) > 插件 #root (1,0,0)，无需 !important，面板开启时本规则不生效、
   插件原规则照常。 */
body[data-dsh-sidebar-collapsed] #root {
  margin-right: 0;
  width: 100%;
}
`

/**
 * 给 shell 窗口挂 better-sidebar 布局垫片（每次整页加载后重新注入；
 * 重复调用安全，窗口重建时旧监听随窗口销毁）。
 */
export function attachSidebarCompat(win: BrowserWindow): void {
  // 先捕获：closed 时窗口已销毁，再访问 win.webContents getter 会抛
  // "Object has been destroyed"（style-overlay 同款防御）
  const { webContents } = win
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    const js = `(() => {
  let el = document.getElementById('${STYLE_ID}')
  if (el === null) {
    el = document.createElement('style')
    el.id = '${STYLE_ID}'
    document.head.append(el)
    el.textContent = ${JSON.stringify(COMPAT_CSS)}
  }
})()`
    webContents.executeJavaScript(js, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载重试
    })
  }
  webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    webContents.removeListener('did-finish-load', onDidLoad)
  })
}
