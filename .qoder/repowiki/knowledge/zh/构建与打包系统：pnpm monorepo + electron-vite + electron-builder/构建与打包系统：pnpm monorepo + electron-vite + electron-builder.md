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

- 包管理器：pnpm workspace（根 pnpm-workspace.yaml 声明 app、engine 以及 engine/packages/*/* 三个层级）
- Node 版本约束：根与 engine 均要求 node >= 20，通过 engines 字段锁定
- Electron 应用层：electron-vite 负责 main/preload/renderer 三端分别编译；electron-builder 负责跨平台打包（macOS dmg/zip、Windows nsis、Linux AppImage）
- 引擎层（QiongQi）：自研拓扑排序脚本 engine/scripts/build.mjs 按 8 个 build layer 顺序调用各子包的 pnpm run build，以解决内部循环依赖的 SCC 问题
- 容器化：engine 提供独立 Dockerfile 与 docker-compose.yml，可单独作为 HTTP 服务运行

## 2. 关键文件与入口

- 根工作区：package.json、pnpm-workspace.yaml
- Electron 应用：app/package.json、app/electron.vite.config.ts、app/electron-builder.yml
- QiongQi 引擎：engine/package.json、engine/scripts/build.mjs、engine/Dockerfile、engine/docker-compose.yml
- 原生模块重建：根 postinstall 调用 electron-rebuild -f -w better-sqlite3 -w node-pty，并通过 onlyBuiltDependencies 白名单限定

## 3. 架构与约定

### 3.1 顶层脚本约定
- pnpm dev → 启动 @kcoder/app 的 electron-vite dev
- pnpm build → 仅构建 app 产物
- pnpm build:engine → 进入 engine 目录执行 pnpm -r run build（即走自定义拓扑构建）
- pnpm package → 先 electron-vite build 再 electron-builder 产出安装包
- pnpm rebuild / postinstall → 针对 better-sqlite3、node-pty 等 native addon 执行 electron-rebuild

### 3.2 Electron 应用构建流
- main 与 preload 使用 externalizeDepsPlugin() 将依赖外置，避免重复打包
- preload 输出强制 ESM 格式且文件名固定为 [name].mjs，与 main 进程引用路径严格对齐
- renderer 基于 Vite + React，别名 @ 指向 renderer/src
- electron-builder.yml 将 ../engine 整个目录（排除 node_modules/tests/*.map）作为 extraResources 注入到安装包中，运行时由主进程启动本地 HTTP 服务

### 3.3 QiongQi 引擎构建流
- scripts/build.mjs 显式定义 18 个包的构建顺序，划分为 L1~L8 共 8 层，其中 L6 是包含 services/delegation/adapter-tools/loop 的强连通分量（SCC），依靠 tsc 的 noEmitOnError: false 容忍类型-only 反向边
- 每个包构建前会删除自身 dist/，并扫描 src 下误发的 .js/.d.ts/.map 清理，确保增量构建稳定
- 构建完成后校验 dist/index.js 是否存在，否则视为失败
- 支持 --clean 参数一次性清理所有 dist 及 stray emit

### 3.4 容器化部署
- 多阶段镜像：deps 阶段安装依赖、prepare sqlite、全量构建并执行 flatten-dist.mjs；runtime 阶段仅拷贝产物
- 暴露 8899 端口，通过环境变量 QIONGQI_HOST、QIONGQI_PORT、QIONGQI_DATA_DIR 控制行为
- docker-compose 提供健康检查，拉取 /ready 判定就绪

## 4. 开发者应遵循的规则

1. 新增子包必须加入拓扑序列：在 engine/scripts/build.mjs 的 sequence 数组中插入新包名及其 packages/... 相对路径，并确保其依赖已在前面层构建完成。
2. 保持 ESM 一致性：工程全局 type: module，preload 输出强制 .mjs，任何修改需同步更新 main 进程的 import 路径。
3. native 依赖白名单：新增需要 node-gyp 编译的原生模块时，需在根 pnpm-workspace.yaml 的 onlyBuiltDependencies 中添加名称，并在根 package.json 的 rebuild 脚本 -w 参数中注册。
4. 打包产物范围：electron-builder.yml 的 files 与 extraResources.filter 已明确排除测试与 map 文件，新增资源应按相同模式配置 filter。
5. 引擎独立运行：若要在容器中单独运行 engine，需先执行 pnpm run prepare:sqlite 初始化数据库，再通过 @qiongqi/cli 的 serve 命令启动。