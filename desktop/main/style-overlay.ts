/**
 * 消息样式覆盖层：零修改上游的前提下微调 Web UI 的消息排版。
 *
 * 上游是高度 token 化的设计系统（ui-theme 的 --dsw-* / --ds-* 变量），
 * 排版出口全部变量化——覆盖层在文档末尾注入 `<style>`，按同特异性
 * 后到者赢的层叠规则直接改写 token 值；个别写死在 CSS Modules 规则
 * 里的值（气泡宽度/圆角等）用属性选择器匹配 scoped 产物类名。
 *
 * 档位驱动（偏好设置页可调，store 持久化）：density=native /
 * contentWidth=narrow 档直接不输出对应段——不覆盖即上游原生值，
 * 比手写复位值更稳（上游日后调整也能跟）；enabled=false 输出空串
 * （移除标签，完全回上游原样）。
 *
 * 产物类名含「_+原类名」子串，但 hash 位置随构建形态不同（dsh 运行
 * 时即时编译是 _<hash>_<类名>，vite build 是 _<类名>_<hash>）——
 * 一律按「_+类名」子串匹配（如 [class*="_userStack"]），不依赖
 * hash 的位置与具体值。同名类跨文件冲突（.bubble 在 Tooltip/
 * MessageItem/GoalCommandInputView 三处）用结构判别（userStack 后代）；
 * 类名太泛的（_root/_block）只重定义无人误消费的 CSS 变量。
 * 上游类改名 → 覆盖静默失效回原样，不崩不错位。
 *
 * 主题适配纯 CSS 完成：上游深色主题挂 body[data-ds-dark-theme]，
 * 覆盖层用同一宿主选择器写深色差异，无需监听主题事件重注入。
 *
 * 上游相关样式：ui-theme/src/styles/gradient-shadow-text.css（排版
 * token）、ui-conversation MessageItem/AssistantMarkdown.module.css
 * （气泡/正文）、ui-primitives markdown/CodeBlock.module.css（代码块）、
 * ui-trajectory（轨迹页：作用域锚 data-conversation-composer-overlay）。
 *
 * @module desktop/main/style-overlay
 */

import type { BrowserWindow } from 'electron'
import type { StyleSettings } from '@shared/ipc-contract'
import { getSettings } from './store'

/** 注入的 style 元素 id（幂等替换；SPA 内部导航不清 head）。 */
const STYLE_ID = '__dsh_desktop_style_override'

/** 一档排版定值：[字号px, 行高px]。 */
type LineSpec = readonly [number, number]

/** shorthand 形式（font: 400 14px/22px …）。 */
const lh = (spec: LineSpec): string => `${String(spec[0])}px/${String(spec[1])}px`

/**
 * 密度档位定值梯度（native 档不覆盖，不在表内）。
 * compact 是长期验证档；气泡沿用上游「比正文 +1px」惯例。
 */
const DENSITIES: Record<
  Exclude<StyleSettings['density'], 'native'>,
  {
    base: LineSpec
    strong: LineSpec
    h1: LineSpec
    h2: LineSpec
    h3: LineSpec
    h4: LineSpec
    code: LineSpec
    bubble: LineSpec
  }
> = {
  compact: {
    base: [14, 22],
    strong: [14, 22],
    h1: [21, 30],
    h2: [19, 28],
    h3: [17, 26],
    h4: [15, 24],
    code: [13, 21],
    bubble: [15, 23],
  },
  standard: {
    base: [15, 25],
    strong: [15, 25],
    h1: [22, 32],
    h2: [20, 30],
    h3: [18, 28],
    h4: [16, 26],
    code: [13, 22],
    bubble: [16, 25],
  },
}

/** 列宽档位 → 内容宽度 px（narrow 档不覆盖，不在表内）。 */
const CONTENT_WIDTHS: Record<Exclude<StyleSettings['contentWidth'], 'narrow'>, number> = {
  wide: 960,
  extra: 1080,
}

/**
 * 轨迹页（Trajectory 视图）精致打磨段：数据与功能不动，纯视觉微调。
 *
 * 作用域锚点 data-conversation-composer-overlay 全上游唯一（仅
 * TrajectoryView 根节点携带）——所有选择器挂在它下面即可完全避开
 * 同名类冲突（作用域内类名可放心子串匹配）；表格结构用标签/数据
 * 属性选择器（table/tr/td、data-* 比类名更稳，上游重构样式也不破）。
 * 跟随 enabled 总开关，不跟 density（工具页节奏独立于正文偏好）。
 * 深浅主题全 token 化自适应；上游类/属性改名 → 静默失效回原样。
 */
const TRAJECTORY_CSS = `
/* 行高节奏：30→32px（request-only/collapsed/terminal 等特殊行高的
   上游规则不动，:not 排除避免覆盖） */
[data-conversation-composer-overlay] table tbody
tr:not([data-request-only='true']):not([data-collapsed-summary]):not([data-terminal-request-boundary='true']) > td {
  height: 32px;
}
/* 轮次分隔线细化：2→1px */
[data-conversation-composer-overlay] table tbody
tr[data-turn-start='true']:not(:first-child) > td::before {
  height: 1px;
}
/* 错误行极淡红底（hover 加深一档；td 层覆盖会遮 tr 层 hover 背景，
   故错误行 hover 自带加深；选中态仍有 3px selectionRail 蓝轨） */
[data-conversation-composer-overlay] table tbody tr[data-error='true'] > td {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 4%, transparent);
}
[data-conversation-composer-overlay] table tbody tr[data-error='true']:hover > td {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}
/* 徽章圆角 4→5（与整体圆角语言一致）；轮次标签 8→9px 更清晰 */
[data-conversation-composer-overlay] [class*="_kindTag"] { border-radius: 5px; }
[data-conversation-composer-overlay] [class*="_turnLabel"] { font-size: 9px; }
/* 时间线色块圆角 1→2px（数据属性选择器，不碰类名） */
[data-conversation-composer-overlay] span[data-timeline-span] { border-radius: 2px; }
/* 详情侧栏浮起阴影（宽屏分栏形态；窄屏浮层自带阴影） */
@media (min-width: 761px) {
  [data-conversation-composer-overlay] [class*="_details"] {
    box-shadow: -8px 0 24px rgba(9, 16, 29, .05);
  }
  body[data-ds-dark-theme] [data-conversation-composer-overlay] [class*="_details"] {
    box-shadow: -8px 0 24px rgba(0, 0, 0, .3);
  }
}
/* 详情 tab hover 圆角化 */
[data-conversation-composer-overlay] [class*="_detailTab"] { border-radius: 5px; }
/* 工具栏：按钮圆角 3→5、搜索框 4→6 且高 22→24 */
[data-conversation-composer-overlay] [class*="_toggle"],
[data-conversation-composer-overlay] [class*="_action"] { border-radius: 5px; }
[data-conversation-composer-overlay] [class*="_search"] {
  border-radius: 6px;
  height: 24px;
}`

/**
 * 按档位生成覆盖 CSS。空串 = 移除覆盖标签，完全回上游原样。
 * @module 内部导出仅供测试/诊断；注入一律走 refreshStyleOverlay。
 */
export function buildOverlayCss(style: StyleSettings): string {
  if (!style.enabled) return ''
  const sections: string[] = []

  if (style.density !== 'native') {
    const d = DENSITIES[style.density]
    // shorthand + longhand 双写：部分组件消费 longhand 变量
    sections.push(`/* ---- 排版 token（${style.density} 档） ---- */
:root {
  --dsw-font-markdown-base: 400 ${lh(d.base)} var(--dsw-font-family);
  --dsw-font-markdown-base-font-family: var(--dsw-font-family);
  --dsw-font-markdown-base-font-weight: 400;
  --dsw-font-markdown-base-font-size: ${String(d.base[0])}px;
  --dsw-font-markdown-base-font-style: normal;
  --dsw-font-markdown-base-line-height: ${String(d.base[1])}px;
  --dsw-font-markdown-base-strong: 600 ${lh(d.strong)} var(--dsw-font-family);
  --dsw-font-markdown-base-strong-font-size: ${String(d.strong[0])}px;
  --dsw-font-markdown-base-strong-line-height: ${String(d.strong[1])}px;
  --dsw-font-markdown-h1: 700 ${lh(d.h1)} var(--dsw-font-family);
  --dsw-font-markdown-h1-font-size: ${String(d.h1[0])}px;
  --dsw-font-markdown-h1-line-height: ${String(d.h1[1])}px;
  --dsw-font-markdown-h2: 700 ${lh(d.h2)} var(--dsw-font-family);
  --dsw-font-markdown-h2-font-size: ${String(d.h2[0])}px;
  --dsw-font-markdown-h2-line-height: ${String(d.h2[1])}px;
  --dsw-font-markdown-h3: 600 ${lh(d.h3)} var(--dsw-font-family);
  --dsw-font-markdown-h3-font-size: ${String(d.h3[0])}px;
  --dsw-font-markdown-h3-line-height: ${String(d.h3[1])}px;
  --dsw-font-markdown-h4: 600 ${lh(d.h4)} var(--dsw-font-family);
  --dsw-font-markdown-h4-font-size: ${String(d.h4[0])}px;
  --dsw-font-markdown-h4-line-height: ${String(d.h4[1])}px;
  --dsw-font-markdown-code-block: ${lh(d.code)} var(--ds-font-family-code);
  --dsw-font-markdown-code-block-font-size: ${String(d.code[0])}px;
  --dsw-font-markdown-code-block-line-height: ${String(d.code[1])}px;
}`)
  }

  // ---- 用户气泡：宽度上限放宽（宽屏）+ 圆角/内距利落化。
  // bubble 类跨文件同名（Tooltip/MessageItem/GoalCommandInput 三处），
  // 用「userStack 后代」结构判别锁定 MessageItem 的那一处（userStack
  // 全仓唯一）；两个选择器均按「_+类名」子串匹配，对 hash 位置无感。
  // 字号/行高只在非 native 密度下写（native = 上游原值）。
  const bubbleText =
    style.density !== 'native'
      ? `  font-size: ${String(DENSITIES[style.density].bubble[0])}px !important;
  line-height: ${String(DENSITIES[style.density].bubble[1])}px !important;
`
      : ''
  sections.push(`[class*="_userStack"] { max-width: min(640px, 88%) !important; }
[class*="_userStack"] [class*="_bubble"] {
  border-radius: 16px !important;
  padding: 8px 14px !important;
${bubbleText}}`)

  // ---- 代码块：圆角收敛（局部变量重定义，banner 顶角自动跟随）。
  // _block 是常见类名，泛匹配仅定义一个局部变量——非 CodeBlock 的
  // block 后代不消费 --dsl-code-block-border-radius，零视觉副作用
  sections.push('[class*="_block"] { --dsl-code-block-border-radius: 10px; }')

  // ---- 消息列宽：定义方（ConversationRoot 容器）与消费方（ChatView/
  // 输入卡等）同用 _root 类名；泛匹配把宽度广播到所有 root，消费方取
  // 最近定义一致，非会话子树不消费该变量；上游是单一宽度轴设计，输入
  // 卡/dock 卡自动跟随（narrow 档不写 = 上游 748 原生）
  if (style.contentWidth !== 'narrow') {
    sections.push(`[class*="_root"] { --dsh-chat-content-width: ${String(CONTENT_WIDTHS[style.contentWidth])}px; }`)
  }

  // ---- 深色主题：气泡与背景（900）对比拉开一档 ----
  sections.push('body[data-ds-dark-theme] { --dsw-specific-bubble: var(--dsw-static-neutral-bluish-800); }')

  // ---- 轨迹页精致打磨（跟随 enabled 总开关，不跟 density 档位） ----
  sections.push(TRAJECTORY_CSS)

  return sections.join('\n\n')
}

/**
 * 立即（重新）注入当前档位的覆盖样式。偏好设置变更后由主进程调用，
 * 不等下次整页加载；页面跳转间隙执行失败属正常，did-finish-load
 * 会重试。脚本纯 JS（模板字符串内禁 TS 注解）且自幂等。
 */
export function refreshStyleOverlay(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const css = buildOverlayCss(getSettings().style)
  const js = `(() => {
  const css = ${JSON.stringify(css)}
  let el = document.getElementById('${STYLE_ID}')
  if (css === '') {
    if (el !== null) el.remove()
    return
  }
  if (el === null) {
    el = document.createElement('style')
    el.id = '${STYLE_ID}'
    document.head.append(el)
  }
  if (el.textContent !== css) el.textContent = css
})()`
  win.webContents.executeJavaScript(js, true).catch(() => {
    // 页面跳转间隙失败属正常
  })
}

/**
 * 给 shell 窗口挂样式覆盖（每次整页加载后按最新设置重新注入；
 * 重复调用安全，窗口重建时旧监听随窗口销毁）。
 */
export function attachStyleOverlay(win: BrowserWindow): void {
  // 先捕获：closed 时窗口已销毁，再访问 win.webContents getter 会抛
  // "Object has been destroyed"（terminal-panel 同款防御）
  const { webContents } = win
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    refreshStyleOverlay(win)
  }
  webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    webContents.removeListener('did-finish-load', onDidLoad)
  })
}
