# 折叠无痕模式（对齐官方桌面端 macOS 折叠形态）

日期：2026-10-04 · 状态：已批准（用户「可以，直接做」）· 设计讨论见会话

## 背景与目标

官方 DSH 桌面端（0.2.0-rc.2）macOS 折叠态 = **整列消失**，不是 56px rail：

- `@deepseek-ai/dsh-client-ui-layout/src/client/AppFrame.tsx:168-170`：
  `collapsedWidth = (darwin || data-windows-titlebar) ? 0 : SIDEBAR_COLLAPSED`；
- 官方 preload 在 DOMContentLoaded 前写 `<html data-platform="darwin">`
  （app.asar `!/lib/preload-app.cjs` 实证）→ darwin 分支生效；
- 折叠后控件由 `shell.leading` seat 补回红绿灯右侧：
  `HeaderLeadingControls.tsx`（toggle + new chat 两枚 16px 图标钮，
  seat `left:88px top:11px`，AppFrame.module.css `.leadingSeat`）。

KCoder shell 是**无 preload 的纯浏览器载体** → `data-platform` 不存在 →
plain-web 分支 → 折叠留 **56px rail**（K logo toggle + newSession）。

「无痕」= 保持 plain-web，**自持**把折叠态第一轨归零 + 标题栏左簇按态重组：

| 态 | 左簇（26×26，红绿灯区 12~64px 不可侵占） | `--dsh-titlebar-extra-left` |
|---|---|---|
| 展开 | prev 84 → next 128 → toggle 174（现状不变） | mac 130 / win 196 |
| 折叠 | toggle 84 → new 120（对齐官方 seat 节奏：官方 88 起 28×28 gap8，本仓 84 起 26×26，字形间距同为 20px） | mac 76 / win 142 |

## 锚点（全部运行时实证）

- frame 元素 = `[class*="sidebarCol"]` 的父节点（`sidebarCol` 探针已被
  theme-watcher 长期验证）；inline
  `grid-template-columns: '<轨1>px minmax(400px,1fr) minmax(0px,<右栏max>px)'`
  + `data-sidebar-collapsed`（折叠时存在，布尔语义）；
- 上游 toggle = `[class*="logoRow"] button[class*="toggle"]`（两态同一按钮）；
- 上游 newSession = `button[class*="newSession"]`（SidebarRoot 两态都渲染；
  被裁剪 ≠ 不可点：overflow 裁剪不影响 `HTMLElement.click()` 的 React 合成
  事件派发）；
- 折叠态 sidebarCol 自带 `overflow:hidden`（0 宽轨自动裁掉 rail 内容），
  但 0.5px 右描边仍会画 → 需一并压制。

## 实现（爆炸半径 = 3 个宿主模块 + 1 支冒烟）

1. **desktop/main/sidebar-toggle.ts**（扩职责，文件名不动——windows.ts import、
   冒烟提取、文档引用 5 处免改）：
   - 独立 `<style id=__dsh_desktop_sidebar_void_style>`：折叠时写
     `grid-template-columns:0px <轨2> <轨3> !important`（轨 2/3 从 inline
     **原样复制**，顶层空格切分、括号感知；含 `{};<>` 判解析失败）+
     `[data-sidebar-collapsed] > [class*="sidebarCol"]{border-right:none !important}`；
     展开/解析失败 → 清空规则（退化成今天的 rail，不崩）。不改 React 的
     inline —— `!important` 规则层叠天然压过；`.frame[data-animating]` 的
     grid 轨道过渡照常生效，折叠/展开保留官方缓动；
   - 上游 toggle **两态都隐藏**（原「折叠态恢复显示 rail K logo」随 rail 退役）；
   - 左簇状态自适应：frame 属性 observer（attributes: style +
     data-sidebar-collapsed）+ body childList observer 全部汇入 `syncAll`；
     toggle 按钮 inline left 按态切换（84↔174），prev/next 折叠态
     display:none，new 展开态 display:none（display:none 不进 Tab 序，
     两态焦点序都与视觉序一致；DOM 序恒 prev→next→toggle→new）；
   - 新会话代理：静态内联 `IconNewChatOutlineRegular`（strokeWidth 1，
     16px，与官方 seat 同款字形；静态而非克隆，规避上游图标随分支漂移
     14/16/18 的坑，同折叠按钮 2026-09-30 决策）；点击转发上游
     newSession；aria-label/disabled 实时镜像；上游缺席 → 代理隐藏。
   - 图标光学对齐（2026-10-04，用户实机反馈「左侧折叠钮比右侧按钮组
     明显大」）：截图像素实测（DPR 2、页面缩放 0.81）确认差异**全在画稿、
     不在按钮盒**——折叠钮 ink 26 native px vs 同排 21/21/23（连本组
     new-chat 也是 21），而盒径 26px 与 shell 记录的右侧那组同值
     （theme-watcher 注释「102px = 三枚 26px 按钮」）。故 `TOGGLE_ICON_SVG`
     的 viewBox 外扩 1.75px（画稿 ×0.82）→ ink ≈ 13.1 CSS，与同排
     （12.9~13.3）及本组 new-chat（13.2）齐平；盒径/命中区/排布 84↔174
     全部不动。
2. **desktop/main/brand-injector.ts**：退役 `swapRail`（rail K logo 换标）
   及 apply() 内 rail 自清分支；展开态分体字标、hero 组合 Logo、slogan、
   运行态文案全不动（brand-k.png 仍被展开态字标使用）。
3. **desktop/main/style-overlay.ts**：`RAIL_BROWSER_ACTIONS_CSS` 前的
   「与官方对齐分析」注释**事实修正**（官方 macOS 折叠态并非同款 rail，
   而是 darwin 零宽整列 + leading seat；rc.2 实证）；压制规则本体保留
   作幂等兑底。
4. **docs/ARCHITECTURE.md**：sidebar-toggle / brand-injector 模块表行更新。

不改：上游引擎、windows.ts 装配序、theme-watcher（`--dsh-sidebar-w` 探针
读到 0 宽 sidebarCol 后 margin 公式自然收敛到 leftPad+extra，无需改动）。

## 风险与自愈

- 上游改名 `data-sidebar-collapsed` / `sidebarCol` → 规则解析失败静默退化成
  rail（不崩），冒烟红；
- 上游日后再改折叠语义（如 plain-web 也零宽）→ 本段冗余需回收；
- 折叠态窗口缩放：React 重写 inline 轨道 → style 属性 mutation → 重复制，
  轨 2/3 永不陈旧。

## 验证

- `pnpm typecheck`（链尾 check-injected-scripts：PAGE_JS 新增轨道切分器
  刻意不用正则，规避模板串单反斜杠陷阱）；
- `pnpm build` + `out/main/*.js` 关键串断言（`__dsh_desktop_new_btn`、
  `data-sidebar-collapsed`、`__dsh_desktop_sidebar_void_style`）；
- `scripts/smoke-sidebar-toggle.mjs` 扩写：fixture 加
  `.frame[data-sidebar-collapsed]` 真实 grid（轨 56/280 + minmax(400px,1fr)
  对齐上游 columns.ts 常量）→ 断言折叠态第 1 轨计算值 0px、边线 0、
  左簇两枚坐标、展开态三枚坐标、新会话转发计数、折叠态点新会话不串到
  toggle、extra 随态 76↔130（win 142↔196）、frame 属性切换的全链路自愈、
  双平台双态截图；
- 仓规：GUI 由用户实机验证（清单见交付回复），提交/ push 由用户执行。
