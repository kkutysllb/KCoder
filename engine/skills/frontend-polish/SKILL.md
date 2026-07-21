---
id: frontend-polish
name: Frontend Polish
---
# Frontend Polish

优化界面细节、响应式状态和视觉一致性。

## 审查维度

1. **间距节奏** — 统一使用设计系统的间距刻度；对齐基线，消除"差不多"的像素值。
2. **交互状态** — 每个可交互元素必须具备 hover / focus-visible / active / disabled 状态；数据区域必须有 loading / empty / error 状态。
3. **动效** — 过渡 150–250ms、统一缓动曲线；尊重 prefers-reduced-motion。
4. **排版** — 行高、字重层级、截断策略（ellipsis/line-clamp）一致。
5. **响应式** — 在 375 / 768 / 1280 / 1920 断点检查布局，无横向滚动、无溢出截断。
6. **一致性** — 颜色/圆角/阴影全部来自 token，禁止游离值。

## 流程

- 先审查列出问题清单（带文件位置），再逐项修复，最后逐断点复核。
