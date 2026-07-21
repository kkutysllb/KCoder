---
kind: build_system
name: 构建与打包系统：pnpm monorepo + electron-vite + electron-builder
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - app/package.json
    - app/electron.vite.config.ts
    - app/electron-builder.yml
    - engine/package.json
    - engine/scripts/build.mjs
    - engine/Dockerfile
    - engine/docker-compose.yml
---

## 1. 使用的系统与工具链
- 包管理器：pnpm 10（根 `package.json` 通过 `packageManager` 字段锁定版本）
- Monorepo：`pnpm-workspace.yaml` 声明 `app`、`engine` 以及 `engine/packages/*/*` 三个层级
- Node 引擎要求：>=20（根与 engine 的 `engines` 字段统一约束）
- Electron 应用构建：electron-vite（开发/编译）+ electron-builder（跨平台打包）
- QiongQi 引擎构建：自研拓扑排序脚本 `engine/scripts/build.mjs`，逐层调用各子包的 `pnpm run build`
- 容器化：`engine/Dockerfile` + `docker-compose.yml`，以多阶段镜像构建并暴露 HTTP 服务
- 原生依赖重建：`@electron/rebuild` 在 `postinstall` 中针对 `better-sqlite3` 执行 rebuild；`pnpm-workspace.yaml` 通过 `onlyBuiltDependencies` 白名单限制仅重建必要包

## 2. 关键文件与入口
- 根级编排：`package.json`（顶层 scripts）、`pnpm-workspace.yaml`（workspace 与 onlyBuiltDependencies）
- App 侧：`app/package.json`（electron-vite/electron-builder 脚本）、`app/electron.vite.config.ts`（main/preload/renderer 三入口）、`app/electron-builder.yml`（产物名、extraResources、mac/win/linux 目标）
- Engine 侧：`engine/package.json`（scripts 指向 `scripts/build.mjs`）、`engine/scripts/build.mjs`（18 个包的固定拓扑顺序）、`engine/Dockerfile`、`engine/docker-compose.yml`、`engine/vitest.config.ts`（测试）

## 3. 架构与约定
- 两层 workspace：根 workspace 管理 app 与 engine 两个顶级包；engine 内部再按领域拆分为 18 个子包（foundation/infrastructure/domain-layer/...），并通过自定义脚本解决 SCC 循环依赖导致的 pnpm -r 无法保证顺序的问题。
- 构建分层（L1→L8）由 `build.mjs` 硬编码顺序驱动，每层只依赖已构建的前序层，SCC 内以 type-only 导入容忍非致命类型错误。
- App 通过 `extraResources` 将完整 `engine/` 目录（排除 node_modules/tests/*.map）复制到打包产物中的 `engine/` 子目录，运行时由 main 进程启动本地 HTTP 服务，渲染进程通过 `@qiongqi/http` 等 workspace 包访问。
- Docker 镜像采用两阶段：deps 阶段安装依赖、prepare sqlite、全量 build、`flatten-dist.mjs` 扁平化输出；runtime 阶段仅拷贝构建产物并以 `@qiongqi/cli` 的 serve 命令启动。
- 原生模块重建策略：`pnpm install` 后触发 `electron-rebuild -f -w better-sqlite3`，同时 `electron-builder` 配置 `nodeGypRebuild: false`，避免二次重复构建。

## 4. 开发者应遵循的规则
- 新增 engine 子包时，必须将其加入 `engine/scripts/build.mjs` 的 `sequence` 数组，确保其出现在所有依赖它的包之后。
- 新增 native addon 需同步写入 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`，否则 CI 或 clean install 会失败。
- 修改 Electron 入口（main/preload/renderer）需对应更新 `app/electron.vite.config.ts` 的 Rollup input，否则打包会找不到入口。
- 需要把新资源随应用分发时，在 `app/electron-builder.yml` 的 `files` / `extraResources` 中添加过滤规则，注意排除 `.map`、`tests` 等体积大且运行不需要的内容。
- 发布流程：先 `pnpm build:engine` 构建引擎，再 `pnpm package` 触发 electron-vite build + electron-builder；Docker 场景直接 `docker compose up --build`。