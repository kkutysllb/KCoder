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
    - app/renderer/src/App.tsx
---

## 样式体系概述

KCoder 前端采用 **Tailwind CSS** 作为原子化样式框架，结合 **CSS 自定义属性（CSS Variables）** 实现暗色/亮色双主题切换，通过 PostCSS + Autoprefixer 构建。整体风格为深色为主的桌面应用 UI，辅以橙色强调色。

## 核心架构

### 1. 设计令牌层（Design Tokens）
- `app/renderer/src/index.css`：定义完整的 CSS 变量语义化命名空间，包括 `--color-bg-*`、`--color-text-*`、`--color-accent*`、`--color-border*`、`--color-success/warning/error` 等
- 支持 `.theme-light` 类覆盖变量值实现主题切换，默认暗色主题
- 字体栈使用系统原生字体：`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI'...`

### 2. Tailwind 扩展配置
- `app/tailwind.config.js`：将 CSS 变量映射到 Tailwind 颜色别名（如 `bg-primary` → `var(--color-bg-primary)`），使组件中可直接使用 `bg-bg-primary` 等语义化 class
- 扫描路径限定在 `./renderer/**/*.{js,ts,jsx,tsx}`，避免扫描引擎代码

### 3. 构建管线
- `app/postcss.config.js`：启用 `tailwindcss` 和 `autoprefixer` 插件
- Vite 构建（`electron.vite.config.ts`）驱动整个渲染进程打包

### 4. 主题切换机制
- `App.tsx` 启动时读取 `localStorage.kcoder-general-prefs` 中的 theme 字段（dark/light/system）
- 根据用户偏好或系统 `prefers-color-scheme` 自动切换 `document.documentElement.classList.toggle('theme-light')`

## 组件样式约定

- 组件内直接使用 Tailwind class，通过 `bg-bg-primary`、`text-text-muted`、`border-border-custom` 等别名访问主题色
- 少量全局复用样式在 `index.css` 中以 `@apply` 组合形式定义（如 `.sidebar-item`、`.task-item`、`.command-input`、`.dropdown-btn`）
- 无独立 SCSS/Sass 文件，纯 CSS + Tailwind
- 未引入第三方 UI 组件库（如 Ant Design、shadcn/ui），所有交互组件均为自研 React 组件

## 开发者规范

1. **颜色使用**：优先使用 Tailwind 颜色别名（`bg-bg-primary`、`text-text-secondary`），而非硬编码十六进制值
2. **新增主题色**：先在 `index.css` 的 `:root` 或 `.theme-light` 下添加 CSS 变量，再在 `tailwind.config.js` 中映射
3. **全局样式**：仅当被多个组件复用时才放入 `index.css`，否则直接在组件 className 中使用 Tailwind
4. **响应式**：依赖 Tailwind 内置断点，未看到媒体查询定制
5. **Electron 特定**：使用 `-webkit-app-region: drag/no-drag` 控制窗口拖拽区域