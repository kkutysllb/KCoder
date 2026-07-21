---
kind: design
name: engine/ 作为 vendored monorepo 副本纳入外层 pnpm workspace
source: session
category: adr
---

# engine/ 作为 vendored monorepo 副本纳入外层 pnpm workspace

_来源：f00d382 → 9ebea10 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
QiongQi 引擎是包含 18 个包的独立 monorepo，KCcoder 需要将其集成到自身项目中，同时保持引擎的可移植性和独立测试能力。

## 决策驱动
- 引擎可独立构建和测试
- 应用层仅依赖公开 API 而非内部实现
- 升级时可直接从上游仓库同步覆盖

## 备选方案
- **pnpm link / workspace 引用源码** _（已否决）_ — 优点：开发时可实时看到引擎改动；缺点：破坏引擎内部 workspace 引用结构；升级时需要手动合并变更；测试耦合
- **npm publish 私有包** _（已否决）_ — 优点：标准依赖管理；缺点：发布流程复杂；每次小改动都要发版；无法保留 skills/ 等非代码资源
- **vendored 副本 + 根 workspace 聚合** — 优点：engine/ 保持原样，pnpm -r run build 可独立构建；根 workspace 统一安装依赖；升级即 git diff 后覆盖；测试互不干扰；缺点：需要维护 .gitignore 排除规则；双份 node_modules 占用磁盘

## 决策
将 QiongQi 完整 monorepo 拷贝至 engine/ 目录，排除运行时无关文件，在根 pnpm-workspace.yaml 中将 engine 作为一个整体纳入 workspace，应用层仅通过 @qiongqi/preset-coding 和 @qiongqi/http 的公开 API 交互。

## 影响
engine/ 可独立运行 pnpm install && pnpm test；应用升级引擎只需同步上游仓库覆盖 engine/ 目录；但需注意 .gitignore 排除列表的维护，以及 better-sqlite3 等原生模块针对 Electron ABI 的重编译问题。