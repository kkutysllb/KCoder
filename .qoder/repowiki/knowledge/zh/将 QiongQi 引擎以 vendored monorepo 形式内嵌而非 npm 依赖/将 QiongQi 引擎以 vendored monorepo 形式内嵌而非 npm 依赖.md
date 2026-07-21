---
kind: design
name: 将 QiongQi 引擎以 vendored monorepo 形式内嵌而非 npm 依赖
source: session
category: adr
---

# 将 QiongQi 引擎以 vendored monorepo 形式内嵌而非 npm 依赖

_来源：f6e1781 → f3cea19 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

## 背景
KCoder 需要深度集成 QiongQi 编码引擎，且未来可能需要同步上游更新或保留自定义修改。引擎本身是包含 18 个包的复杂 monorepo。

## 决策驱动
- 保持引擎内部 workspace 引用不变
- 独立构建与测试
- 升级时可直接覆盖同步

## 备选方案
- **npm publish @qiongqi/preset-coding 作为外部依赖** _（已否决）_ — 优点：标准依赖管理；版本锁定简单；缺点：发布流程耦合；monorepo 内部引用需额外打包；难以保留本地修改
- **engine/ 目录完整拷贝到项目根，通过 pnpm workspace 协议引用** — 优点：保持 engine 内部结构不变；`pnpm -r run build/test` 独立运行；升级只需覆盖目录；应用层仅依赖公开 API；缺点：仓库体积增大；需维护 .gitignore 排除规则

## 决策
将 QiongQi 完整 monorepo 拷贝至 `KCoder/engine/`，根 `pnpm-workspace.yaml` 将其纳入外层 workspace，应用层通过 `@qiongqi/preset-coding: workspace:*` 协议引用。引擎测试在 `engine/` 下独立执行，不依赖应用层。

## 影响
引擎升级可通过从上游仓库同步覆盖实现；但需确保 `.gitignore` 正确排除 `node_modules/dist` 等生成物；应用层必须严格只使用 `preset-coding` 和 `http` 的公开 API，避免直接依赖内部包。