---
kind: dependency_management
name: pnpm 多包工作区与本地 vendored 引擎依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - pnpm-workspace.yaml
    - package.json
    - engine/pnpm-workspace.yaml
    - engine/package.json
    - app/package.json
    - engine/packages/engine/loop/package.json
    - engine/packages/foundation/contracts/package.json
---

## 系统概览
KCoder 采用 pnpm workspace 构建双层级多包结构：根仓库聚合 app（Electron 桌面端）和 engine（QiongQi 多 Agent 框架），并通过 workspace:* 协议在包间建立强耦合的内部依赖。同时，engine 以 vendored 方式内嵌到应用目录中，作为本地子模块被 Electron main 进程直接启动。

## 关键文件与包
- 根级工作区配置：pnpm-workspace.yaml、package.json
- 应用层：app/package.json（@kcoder/app，通过 workspace:* 引用 @qiongqi/* 包）
- 引擎层：engine/pnpm-workspace.yaml、engine/package.json、engine/packages/*/package.json（如 @qiongqi/loop、@qiongqi/contracts 等）
- 锁定文件：根级 pnpm-lock.yaml、engine/pnpm-lock.yaml（分别由两个 pnpm 实例生成）
- 原生依赖白名单：onlyBuiltDependencies: [better-sqlite3, esbuild, sharp, electron]

## 架构与约定
1. 双层 workspace：根 pnpm-workspace.yaml 声明 app、engine 以及 engine/packages/*/*；engine 内部再定义 packages/*/* 子工作区，形成嵌套但各自独立的包图。
2. 内部依赖统一走 workspace:*：所有 @qiongqi/* 包之间以及 @kcoder/app 对引擎包的引用均使用 workspace:*，禁止使用语义化版本范围，确保开发时始终指向源码。
3. Vendored 嵌入策略：engine 目录作为完整 npm 包被复制到 app/node_modules/@qiongqi/...（或通过 workspace 解析），Electron main 进程直接 require 其 dist 产物，无需运行时安装。
4. 原生依赖隔离：通过 onlyBuiltDependencies 显式允许 better-sqlite3、esbuild、sharp、electron 四个包进行原生编译，其余包默认跳过 rebuild，加速 CI 与本地安装。
5. Node 版本约束：根与 engine 的 engines.node >= 20 强制统一运行环境，配合 packageManager: pnpm@10.32.1 锁定工具链。
6. 私有包标记：所有 @qiongqi/* 包均设置 "private": true，表明它们仅作为内部实现细节，不发布到公共 registry。

## 开发者应遵循的规则
- 新增内部包：在 engine/packages/<category>/<name>/package.json 下创建，名称以 @qiongqi/ 前缀，并在该包中使用 workspace:* 引用其他内部包。
- 跨层引用：app 只能通过已发布的 @qiongqi/* 包间接访问引擎能力，禁止直接 import engine/packages/... 源码路径。
- 版本同步：修改任何 @qiongqi/* 包的 API 后，需同步更新依赖方的 workspace:* 调用点并重新执行 pnpm install 以刷新锁文件。
- 原生依赖：若引入新的原生模块，必须将其加入根 pnpm-workspace.yaml 的 onlyBuiltDependencies 列表，否则会被 pnpm 拦截导致安装失败。
- 不要提交 node_modules：仓库根与 engine 均忽略 node_modules，依赖通过 pnpm-lock.yaml 还原；发布产物为各包的 dist/ 目录。
- 脚本入口：统一通过根 package.json 的 pnpm --filter 命令分发任务（如 pnpm -r run typecheck），避免在各子包单独维护重复脚本。
