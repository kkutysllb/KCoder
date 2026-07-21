---
kind: dependency_management
name: pnpm Workspace 多包依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - engine/package.json
    - engine/pnpm-workspace.yaml
    - app/package.json
    - engine/packages/foundation/contracts/package.json
    - engine/packages/adapters/adapter-model/package.json
---

本仓库采用 pnpm workspace 组织跨 Electron 桌面端与 QiongQi Agent 引擎的 monorepo，通过 workspace:* 协议实现包间强耦合引用，配合 lockfile 保证全仓版本一致性。

## 系统概览
- 包管理器：pnpm@10.32.1（根与 engine 子仓库均声明 packageManager 字段）
- Node 要求：>=20（根与 engine 均通过 engines 约束）
- 工作区结构：根级 pnpm-workspace.yaml 聚合 app、engine 以及 engine/packages/*/* 两层目录；engine 内部另有独立 pnpm-workspace.yaml，仅包含 packages/*/*，形成嵌套 workspace

## 关键文件
- package.json — 根脚本统一入口，提供 dev/build/build:engine/test:engine/typecheck/package 等跨模块命令
- pnpm-workspace.yaml — 顶层工作区定义 + onlyBuiltDependencies 白名单（better-sqlite3、esbuild、sharp、electron），避免不必要的原生编译
- engine/package.json — engine monorepo 元信息，构建/测试脚本委托给各子包
- engine/pnpm-workspace.yaml — engine 内部子包发现规则
- app/package.json — Electron 应用依赖，以 workspace:* 引用 @qiongqi/preset-coding、@qiongqi/http、@qiongqi/contracts
- engine/packages/foundation/contracts/package.json — 契约包示例，使用 zod 做运行时校验，被 adapter-* 层以 workspace:* 依赖

## 架构与约定
1. 双层级 workspace：根 workspace 把 app 和整个 engine 纳入同一依赖图；engine 内部再按 packages/<layer>/<name> 划分 adapters/capabilities/cli-layer/delegation-layer/domain-layer/engine/foundation/http-layer/infrastructure/ports-layer/presets 共 18 个 @qiongqi/* 包，彼此通过 workspace:* 互相引用，不发布到 npm。
2. 私有包标记：所有 engine 子包均声明 "private": true，禁止意外发布。
3. 导出规范：每个包统一暴露 main 指向 ./dist/index.js，并通过 exports 字段同时声明 ./* 通配路径的 types/import 映射，便于子包按需导入。
4. 构建产物：子包统一用 tsc -p tsconfig.build.json 输出到 dist/，由 engine 根 scripts/build.mjs 编排拓扑顺序。
5. 原生依赖裁剪：根 workspace 通过 onlyBuiltDependencies 限定只允许 better-sqlite3、esbuild、sharp、electron 四个包触发 C++ 编译，其余依赖走预编译二进制，显著缩短安装时间。
6. 类型检查：根与 engine 均提供 typecheck 脚本，通过 pnpm -r run typecheck 在全部子包并行执行 tsc --noEmit。

## 开发者应遵循的规则
- 新增子包：在 engine/packages/<layer>/ 下创建目录，添加 package.json（含 private: true、main、exports、dependencies 中的 workspace:* 引用），并在 engine/pnpm-workspace.yaml 中确认匹配规则 packages/*/* 已覆盖。
- 跨包引用：一律使用 workspace:* 版本号，禁止写死具体 semver，确保变更在单仓库内一次提交生效。
- 外部依赖升级：通过 pnpm up 或手动编辑 package.json 后运行 pnpm install 更新 pnpm-lock.yaml，不要手写 lockfile。
- 原生依赖：如需引入新的 C++ 扩展，先在根 pnpm-workspace.yaml 的 onlyBuiltDependencies 白名单中添加，否则 CI 会失败。
- 发布流程：当前所有包均为私有，工程化脚本未集成发布；若未来需要，应在根脚本中增加基于 git tag 的版本递增与 pnpm publish 步骤。
- Node 版本：开发环境必须满足 node >= 20，可通过 nvm 或 corepack 自动锁定到 pnpm@10.32.1。