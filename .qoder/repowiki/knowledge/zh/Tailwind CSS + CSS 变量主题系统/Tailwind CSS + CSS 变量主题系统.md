---
kind: frontend_style
name: Tailwind CSS + CSS 变量主题系统
category: frontend_style
scope:
    - '**'
source_files:
    - app/renderer/src/index.css
    - app/tailwind.config.js
    - app/postcss.config.js
---

## 样式体系概述

KCoder 前端采用 Tailwind CSS 作为原子化样式框架，配合原生 CSS 自定义属性（CSS Variables）构建设计令牌层，形成「设计令牌 → Tailwind 扩展色 → 组件 className」的三层样式架构。

## 核心文件与工具链

- app/tailwind.config.js — Tailwind 配置，通过 theme.extend.colors 注入设计令牌色板
- app/postcss.config.js — PostCSS 插件链：tailwindcss + autoprefixer
- app/renderer/src/index.css — 全局样式入口，声明 @tailwind base/components/utilities 及全部 CSS 变量
- app/renderer/src/**/*.tsx — 组件中直接使用 Tailwind utility class 组合样式

## 设计令牌与配色方案

所有视觉常量集中在 index.css 的 :root 伪类下定义，包括背景色（--color-bg-primary #0d0d0d、--color-bg-sidebar #1e1e20、--color-bg-input #2a2a2c、--color-bg-hover #2a2a2c、--color-bg-active #333336）、文本色（--color-text-primary #e4e4e7、--color-text-secondary #a1a1aa、--color-text-muted #71717a）、强调色（--color-accent #ff9f00、--color-accent-blue #0ea5e9）、语义色（--color-success #22c55e、--color-warning #eab308、--color-error #ef4444）和边框色（--color-border #333336）。这些变量在 tailwind.config.js 中被映射为 Tailwind 扩展色（如 bg-primary、text-primary、accent），供组件以 bg-bg-primary、text-accent 等形式使用。

## 样式组织约定

1. 全局基础样式：index.css 中完成 reset（box-sizing）、字体栈（-apple-system / SF Pro Text / Segoe UI）、滚动条定制、Electron 拖拽区域（.drag-region / .no-drag）等基础设施
2. 组件级复用样式：在 index.css 中以 @apply 组合 Tailwind utility 形成少量共享类名（如 .sidebar-item、.task-item、.command-input、.dropdown-btn），避免重复 utility 串
3. 组件内样式：绝大多数组件直接拼接 Tailwind utility class，不引入独立 CSS 模块或 styled-components
4. 无响应式断点：当前未使用 Tailwind 响应式前缀（sm/md/lg），界面为固定布局桌面 IDE 风格

## 开发者规范

- 新增颜色必须先在 :root 定义 CSS 变量，再同步到 tailwind.config.js 的 theme.extend.colors
- 优先使用 Tailwind utility class 组合，仅在多处复用时才提取 @apply 公共类
- 禁止在组件中硬编码十六进制颜色值，应引用已注册的 Tailwind 色或 CSS 变量
- Electron 窗口拖拽区域统一使用 .drag-region / .no-drag 类名