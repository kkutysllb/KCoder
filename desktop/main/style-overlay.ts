/**
 * 上游原生外壳压制层 + 空会话品牌水印：零修改上游的前提下，靠注入
 * 一段 `<style>` 做两件事——把 KCoder 不使用的上游原生侧栏外壳收掉，
 * 以及给空会话铺 KCoder 的 K 水印（均按层叠规则覆盖，不动上游代码）。
 *
 * ## 历史与职责收缩（2026-09-20）
 *
 * 本模块原为「消息样式覆盖层」：正文密度 / 消息列宽 / 正文字号档位，外加
 * 气泡与代码块圆角、深色气泡对比、跳到底部按钮居中、轨迹页打磨——由设置
 * 面板「通用」区的「桌面样式定制」组驱动（style-settings.ts，已随该功能
 * 整体下线）。用户决策：上游排版已完善，宿主不再动正文排版（档位、总开关、
 * 持久化字段 style 全部移除）。
 *
 * 剩下的三段都**不是排版偏好**，没有开关、恒生效：
 * 1. 原生右侧栏外壳压制（NATIVE_SIDEBAR_CSS）；
 * 2. 侧栏「插件」panellist 入口压制（SIDEBAR_PLUGIN_ENTRY_CSS）；
 * 3. 空会话 K 水印（HERO_WATERMARK_CSS）——品牌落点，用户明确要求保留。
 *
 * 注入形态不变：文档末尾追加 `<style>`，上游类名/data 属性改名 → 对应
 * 段静默失效（外壳复现 / 水印消失），不崩不错位。
 *
 * @module desktop/main/style-overlay
 */

import { readFileSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { resolveAsset } from './dsh-contract'

/** 注入的 style 元素 id（幂等替换；SPA 内部导航不清 head）。 */
const STYLE_ID = '__dsh_desktop_style_override'

/**
 * K mark used by the empty-session watermark. Embed the asset in the injected
 * stylesheet because the shell is served by the dsh sidecar and cannot rely
 * on the desktop renderer's public directory being on its URL origin.
 */
const watermarkDataUrl = `data:image/png;base64,${readFileSync(resolveAsset('brand-k.png')).toString('base64')}`

/**
 * 原生右侧栏外壳压制（D1a 恢复，2026-09-19）：dsh-coding-sidebar 复活后
 * 右侧工作台由插件承担，原生的展开按钮（会话头角落）、面板宿主与浮层
 * 宿主一并隐藏。只摘用户可见外壳——ui-sidebar-right 的服务层与契约保留
 * （六个上游包在 dsh.client.inject 里硬声明它，禁用会让主对话链整体挂
 * 掉）。display:none 而非移除：隐藏元素仍可 .click() 派发（React 事件
 * 委托挂在 root）。上游改名 → 压制静默失效（外壳复现），不崩不错位。
 *
 * 本段是「产品铁律 1：不使用上游原生侧边栏功能」的**执行点**
 * （docs/ARCHITECTURE.md §12）——上游把外壳改名或新增侧栏形态时，
 * 正解是改插件仓发新版本，不是放开本压制。
 */
const NATIVE_SIDEBAR_CSS = `[data-sidebar-right-expand],
[data-sidebar-right-panel],
[data-sidebar-right-float-host] {
  display: none !important;
}`

/**
 * 侧栏「插件」入口压制（0.1.6-alpha.2）：上游 ui-plugin-manager 向
 * `sidebar.panellist` 无条件注册侧栏条目（包内无任何配置开关，整行禁用会
 * 连管理页一起死），产品决策把插件管理收进设置页的「插件管理」注入分区
 * （plugin-settings.ts），侧栏入口藏掉。
 *
 * 锚点：panellist 条目渲染为 `nav[class*="panelList"] > … > button`（上游
 * SidebarRoot 的 PanelRow），唯一稳定标识是 `aria-label` = locale 解析后的
 * label（zh「插件」/ en "Plugins"）——button 上没有任何 data-* 属性。
 * **不能隐藏整个 nav**：演示文稿/漫剧工坊/定时任务/动效技能库等第三方
 * 产品条目同为 panellist 注册，一藏全没。
 *
 * display:none 而非移除：设置分区入口卡的「打开插件管理器」要对这个隐藏
 * 按钮派发 `.click()` 走上游真实 selectPanel 路径（sidebar-cluster 看门狗
 * 同款：display:none 不影响 HTMLElement.click() 事件派发）。
 *
 * 上游改名/补 data 属性 → 压制静默失效（入口恢复可见），不崩。
 */
const SIDEBAR_PLUGIN_ENTRY_CSS = `nav[class*="panelList"] button[aria-label="插件"],
nav[class*="panelList"] button[aria-label="Plugins"] {
  display: none !important;
}`

/**
 * 空会话 K 水印：仅 hero 阶段显示，所有会话内容保持在其上方。
 *
 * 位置和大小以滚动区为参照，避免跟随 composer 高度变化；opacity 分主题
 * 调整，浅色保持极淡，深色提高一档以免蓝色消失在深背景里。
 *
 * 恒生效：它不是"样式偏好"（原「桌面样式定制」总开关已随该功能下线），
 * 是 KCoder 的品牌落点——用户明确要求保留（2026-09-20）。
 * 上游锚点 `data-phase='hero'` / `data-conversation-scroll` /
 * `data-composer-seat` 改名 → 水印静默消失，不崩。
 */
const HERO_WATERMARK_CSS = `
[data-phase='hero'] [data-conversation-scroll] {
  position: relative;
  isolation: isolate;
}
[data-phase='hero'] [data-conversation-scroll]::before {
  content: '';
  position: absolute;
  top: 42%;
  left: 50%;
  z-index: 0;
  width: min(58vw, 620px);
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  background: url('${watermarkDataUrl}') center / contain no-repeat;
  opacity: .035;
  pointer-events: none;
}
[data-phase='hero'] [data-conversation-scroll] > [data-slot='conversation.session'],
[data-phase='hero'] [data-conversation-scroll] > [data-composer-seat] {
  position: relative;
  z-index: 1;
}
body[data-ds-dark-theme] [data-phase='hero'] [data-conversation-scroll]::before {
  opacity: .075;
  filter: saturate(1.08) brightness(1.18);
}`

/** 注入 CSS（无档位、无总开关：三段恒定生效）。 */
function buildOverlayCss(): string {
  return [NATIVE_SIDEBAR_CSS, SIDEBAR_PLUGIN_ENTRY_CSS, HERO_WATERMARK_CSS].join('\n\n')
}

/**
 * 给 shell 窗口挂注入层：每次整页加载后重新注入（幂等替换既有 style
 * 元素，SPA 内部导航不清 head 故只需一次；页面跳转间隙执行失败属正常，
 * 下次 did-finish-load 会重试）。重复调用安全，窗口重建时旧监听随窗口
 * 销毁（先捕获 webContents：closed 后再访问 getter 会抛
 * "Object has been destroyed"，sidebar-cluster 同款防御）。
 */
export function attachStyleOverlay(win: BrowserWindow): void {
  const { webContents } = win
  const inject = (): void => {
    if (win.isDestroyed()) return
    const js = `(() => {
  const css = ${JSON.stringify(buildOverlayCss())}
  let el = document.getElementById('${STYLE_ID}')
  if (el === null) {
    el = document.createElement('style')
    el.id = '${STYLE_ID}'
    document.head.append(el)
  }
  if (el.textContent !== css) el.textContent = css
})()`
    webContents.executeJavaScript(js, true).catch(() => {
      // 页面跳转间隙失败属正常
    })
  }
  webContents.on('did-finish-load', inject)
  win.once('closed', () => {
    webContents.removeListener('did-finish-load', inject)
  })
}
