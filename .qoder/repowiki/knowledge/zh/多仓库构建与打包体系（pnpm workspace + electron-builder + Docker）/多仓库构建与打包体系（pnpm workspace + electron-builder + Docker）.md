---
kind: build_system
name: 多仓库构建与打包体系（pnpm workspace + electron-builder + Docker）
category: build_system
scope:
    - '**'
source_files:
    - pnpm-workspace.yaml
    - package.json
    - engine/pnpm-workspace.yaml
    - engine/scripts/build.mjs
    - app/electron-builder.yml
    - engine/Dockerfile
    - engine/docker-compose.yml
---

## 1. 构建系统概览

本项目采用 **pnpm workspace** 作为顶层包管理，聚合两个独立子项目：
- `app/` — Electron + Vite 桌面 IDE（@kcoder/app），通过 SSE 与引擎通信
- `engine/` — QiongQi 多 Agent 运行时 Monorepo，内含 18 个 @qiongqi/* 子包

根级 package.json 提供统一入口脚本，将 dev/build/test/package 命令转发到对应子项目。

## 2. 核心构建流程

### 2.1 Engine 拓扑构建器
`engine/scripts/build.mjs` 是自定义的拓扑排序构建编排器，解决 engine 内部存在循环依赖 SCC（services → delegation → adapter-tools → loop）的问题。构建顺序分 8 层：
- L1: contracts, adapter-fs
- L2: domain, attachments, tool-infra
- L3: ports, cache
- L4: adapter-model, adapter-storage
- L5: memory, skills
- L6 (SCC): services → delegation → adapter-tools → loop
- L7: http
- L8: preset-coding, cli

每个包执行自身 `pnpm run build`（通常是 tsc），并校验 `dist/index.js` 是否产出；对 SCC 内仅类型引用的非致命错误做了容忍处理。

### 2.2 App 打包流程
`app/package.json` 中 `package` 脚本串联 `electron-vite build && electron-builder`，使用 `electron-builder.yml` 配置跨平台产物：
- macOS: dmg + zip，启用 hardenedRuntime
- Windows: nsis 安装包
- Linux: AppImage

`extraResources` 将整个 `engine/dist` 目录打包进应用，使桌面端可内嵌运行 QiongQi 引擎。

### 2.3 容器化部署
`engine/Dockerfile` 采用多阶段构建：
- deps 阶段：安装 python3/make/g++（编译 native addon）、corepack、pnpm install、prepare-sqlite、build 所有包、flatten-dist
- runtime 阶段：最小化 node:20-bookworm-slim，暴露 8899 端口，以 `@qiongqi/cli` 启动 HTTP 服务
`docker-compose.yml` 提供健康检查与 /data 持久卷挂载。

## 3. 关键文件与约定

| 文件 | 作用 |
|------|------|
| `pnpm-workspace.yaml` | 顶层 workspace 定义，限定 onlyBuiltDependencies（better-sqlite3/electron/sharp/esbuild） |
| `engine/pnpm-workspace.yaml` | engine 子 workspace，匹配 `packages/*/*` |
| `engine/scripts/build.mjs` | 拓扑构建编排器，硬编码 18 个包的构建顺序 |
| `app/electron-builder.yml` | 跨平台桌面应用打包配置 |
| `engine/Dockerfile` | 引擎服务端镜像构建与运行入口 |
| `engine/docker-compose.yml` | 本地开发/测试用的 compose 编排 |

## 4. 开发者应遵循的规则

1. **新增 engine 包时必须更新 `scripts/build.mjs` 中的 sequence 数组**，确保其构建顺序正确，否则会出现 dist 缺失或 TS 覆盖输入的错误。
2. **避免在 SCC 包之间引入运行时依赖**，当前仅允许 `import type` 类型的反向引用；若需新增运行时边，需重新评估拓扑顺序。
3. **native addon 必须列入 `onlyBuiltDependencies`**，否则 pnpm 会在无关包上触发不必要的原生编译。
4. **App 打包前需先构建 engine**，因为 `extraResources` 会复制 engine 产物；建议通过根级 `pnpm build:engine` 预构建。
5. **Docker 构建依赖 corepack**，且需要 python3/make/g++ 编译环境，CI 中需保证这些工具链可用。
6. **所有包使用 ESM（"type": "module"）**，tsc 输出为 .js，不生成 .d.ts（由 tsconfig 控制）。