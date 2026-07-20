# KCoder — Agent-Driven Coding Desktop App 设计方案

## 总体架构

```
+----------------------------------------------------------+
|                   Electron Main Process                    |
|                                                          |
|  +-------------------+    +---------------------------+  |
|  | Engine Host       |    | Window / Lifecycle Mgr    |  |
|  | (preset-coding)   |    +---------------------------+  |
|  | QiongQi HTTP/SSE  |                                   |
|  | 127.0.0.1:PORT    |                                   |
|  +-------------------+                                   |
+----------------------------------------------------------+
          |  localhost HTTP/SSE
+----------------------------------------------------------+
|                 Electron Renderer (React)                  |
|                                                          |
|  Chat Panel | Code Preview | File Tree | Terminal Output  |
+----------------------------------------------------------+
```

- Main process 启动时通过 `@qiongqi/preset-coding` 的 `createCodingAgent()` 在本地起 HTTP/SSE 服务
- Renderer 通过 `http://127.0.0.1:{port}` 与引擎通信（REST + SSE 流式响应）
- Preload 仅暴露引擎端口和少量 IPC（窗口控制、文件系统对话框等）

---

## 项目目录结构

```
KCoder/
├── engine/                          # QiongQi 核心引擎（vendored 拷贝）
│   ├── packages/                    # 18 个 @qiongqi/* 包（原样保留）
│   ├── tests/                       # 引擎测试套件
│   ├── scripts/                     # 构建辅助脚本
│   ├── package.json                 # 引擎 monorepo root
│   ├── pnpm-workspace.yaml
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── app/                             # Electron 应用层
│   ├── main/                        # Main process
│   │   ├── index.ts                 # Electron 入口
│   │   ├── engine-host.ts           # 引擎生命周期管理（启动/停止/健康检查）
│   │   ├── window.ts                # BrowserWindow 管理
│   │   └── menu.ts                  # 应用菜单
│   ├── preload/
│   │   └── index.ts                 # contextBridge 暴露安全 API
│   └── renderer/                    # React 前端
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── components/          # UI 组件
│       │   │   ├── ChatPanel/       # 对话面板（消息列表 + 输入）
│       │   │   ├── CodeBlock/       # 代码高亮展示
│       │   │   ├── FileTree/        # 工作区文件树
│       │   │   └── StatusBar/       # 引擎状态指示
│       │   ├── services/
│       │   │   └── engine-api.ts    # QiongQi HTTP/SSE 客户端封装
│       │   ├── hooks/
│       │   │   ├── useChat.ts       # 对话状态管理
│       │   │   └── useSSE.ts        # SSE 流式订阅
│       │   └── stores/
│       │       └── app-store.ts     # 全局状态（zustand）
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
│
├── package.json                     # 根 workspace 配置
├── pnpm-workspace.yaml              # workspace: ['app/*', 'engine']
├── electron-builder.yml             # 打包配置
├── tsconfig.json                    # 根 TS 配置
└── .gitignore
```

---

## 实施步骤

### Phase 1: 项目脚手架搭建

1. **初始化根 workspace**
   - 创建 `package.json`（private, scripts）
   - 创建 `pnpm-workspace.yaml`：`packages: ['app/*', 'engine']`
   - 创建 `.gitignore`（node_modules, dist, .vite, out 等）
   - 创建根 `tsconfig.json`

2. **拷贝 QiongQi 引擎**
   - 将 `/Users/libing/kk_Projects/QiongQi` 拷贝到 `KCoder/engine/`
   - 排除：`node_modules/`、`.git/`、`.DS_Store`、`docs/`、`deploy/`、`assets/`、`findings.md`、`progress.md`、`task_plan.md`
   - 保留：`packages/`、`tests/`、`scripts/`、配置文件、`skills/`
   - 验证：在 `engine/` 下 `pnpm install && pnpm -r run build` 确保引擎独立可构建

### Phase 2: Electron 应用骨架

3. **初始化 Electron + Vite + React**
   - 使用 `electron-vite`（或 electron-forge + vite plugin）初始化 `app/` 目录
   - `app/renderer/package.json`：React 18+, Vite, TypeScript
   - `app/main/package.json`：Electron, 依赖 `@qiongqi/preset-coding`（workspace 引用）
   - 配置 Vite 的 renderer 构建

4. **实现 engine-host.ts**
   - 调用 `createCodingAgent()` 启动引擎
   - 随机端口分配（避免冲突）
   - 健康检查轮询 `/health`
   - 优雅退出：app quit 时关闭引擎
   - 关键代码结构：
     ```ts
     import { createCodingAgent } from '@qiongqi/preset-coding'
     
     export async function startEngine(config: EngineConfig) {
       const runtime = await createCodingAgent({
         port: config.port,
         dataDir: config.dataDir,
         runtimeToken: config.token,
         apiKey: config.apiKey,
         baseUrl: config.baseUrl,
         model: config.model,
         approvalPolicy: 'auto',  // 桌面端可自动审批
       })
       return runtime
     }
     ```

5. **实现 preload 和 IPC**
   - 暴露：引擎端口号、打开文件对话框、窗口控制
   - 不暴露：文件系统直接访问（安全考虑）

### Phase 3: React 前端核心 UI

6. **Engine API 客户端** (`services/engine-api.ts`)
   - 封装 QiongQi HTTP API：
     - `POST /v1/threads` — 创建对话线程
     - `POST /v1/threads/:id/turns` — 发送消息
     - `GET /v1/threads/:id/turns/:turnId/events` — SSE 流式事件
   - 封装 SSE 订阅逻辑

7. **ChatPanel 组件**
   - 消息列表（用户消息 + Agent 回复）
   - 流式渲染 Agent 响应（SSE）
   - Markdown 渲染 + 代码高亮
   - 输入框 + 发送

8. **基础布局**
   - 左侧：对话面板
   - 右侧（可折叠）：代码预览 / 文件变更
   - 底部：状态栏（引擎连接状态、模型信息）

### Phase 4: 配置与打包

9. **应用配置**
   - 首次启动设置页：API Key、模型选择、工作目录
   - 配置持久化（electron-store 或 JSON 文件）

10. **打包配置**
    - `electron-builder.yml`：macOS dmg/zip
    - 引擎代码打包进 asar 或 extraResources
    - 原生模块处理（better-sqlite3 需要 rebuild）

---

## 关键技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 构建工具 | electron-vite | 统一 main/preload/renderer 构建，HMR 支持好 |
| 状态管理 | zustand | 轻量，适合中等复杂度 |
| UI 组件库 | Tailwind CSS + shadcn/ui | 高质量、可定制 |
| 代码高亮 | shiki 或 prism-react-renderer | 多语言支持 |
| Markdown | react-markdown + remark-gfm | 渲染 Agent 响应 |
| 引擎引用方式 | pnpm workspace 协议 | `@qiongqi/preset-coding: workspace:*` |
| 原生模块 | electron-rebuild | better-sqlite3 需要针对 Electron ABI 重编译 |

---

## 引擎隔离策略

- `engine/` 目录是完整的 QiongQi monorepo 副本，保持内部 workspace 引用不变
- 根 `pnpm-workspace.yaml` 将 `engine` 作为一个整体纳入外层 workspace
- 应用层仅通过 `@qiongqi/preset-coding` 和 `@qiongqi/http` 的公开 API 交互
- 引擎升级：直接从 QiongQi 仓库同步覆盖 `engine/` 目录即可
- 引擎测试：`cd engine && pnpm test` 独立运行，不依赖应用层

---

## 后续扩展预留

- 自定义工具：通过 QiongQi 的 ToolHost port 注入 KCoder 专属工具
- 自定义技能：在 `app/skills/` 目录放置 coding skill bundles
- 多模型支持：利用 adapter-model 的 provider-neutral 特性
- 项目上下文：通过 attachments 机制注入项目文件
- 审批流程：对危险操作（删除文件、执行命令）弹出确认对话框
