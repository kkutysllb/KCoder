# KCoder

> 基于 [QiLin](https://github.com/kkutysllb/QiLin) 引擎驱动的 Agent 编码桌面应用。
> Electron 桌面端 × Python Agent 引擎 × MCP 工具生态，三位一体。

KCoder 是一个以大模型为核心驱动力的智能编码工作站。它将 QiLin 生产级 Agent 引擎嵌入桌面应用，通过聊天对话即可完成代码编写、终端操作、文件管理、工作区隔离、技能编排等完整软件工程闭环——而无需离开应用窗口。

- **应用类型**：Electron 桌面应用（macOS / Windows / Linux）
- **内核引擎**：[QiLin](https://github.com/kkutysllb/QiLin) v1.0.0（vendored 于 `vendor/qilin`）
- **通信架构**：主进程内嵌 Python sidecar，通过 `127.0.0.1` HTTP/SSE 桥接
- **前端栈**：React 18 + Zustand + Tailwind CSS + xterm.js
- **许可协议**：Apache-2.0（引擎）/ 项目自有（桌面端）

---

## 目录

- [整体架构](#整体架构)
- [核心引擎：QiLin](#核心引擎qilin)
- [KCoder 桌面功能](#kcoder-桌面功能)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [技术栈](#技术栈)
- [开发指南](#开发指南)
- [文档导航](#文档导航)

---

## 整体架构

KCoder 采用**三层解耦架构**，每一层职责清晰、可独立演进：

```
┌─────────────────────────────────────────────────────────────┐
│                    KCoder Electron 应用                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Renderer 进程（React 前端）                           │  │
│  │  聊天面板 · 终端 · 设置 · 侧边栏 · 状态栏               │  │
│  │         ↓ fetch http://127.0.0.1:<port>/v1/*           │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  Main 进程（TypeScript）                               │  │
│  │  qilin-runtime-manager：spawn 双 Python 子进程          │  │
│  │  PTY 终端管理 · IPC 桥 · 模型凭据存储                   │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ spawn（127.0.0.1）
            ┌──────────────┴──────────────┐
            ▼                              ▼
  ┌───────────────────┐         ┌─────────────────────┐
  │  Gateway 进程      │         │  LangGraph dev 进程  │
  │  (FastAPI)        │ ──────► │  (QiLin service)    │
  │  /v1/* 翻译层      │  HTTP   │  Lead Agent 执行内核 │
  │  认证 · SSE 桥     │         │  工具 · 技能 · 沙箱   │
  └───────────────────┘         └─────────────────────┘
                                         │
                          ┌──────────────┴──────────────┐
                          ▼                             ▼
                  ┌───────────────┐           ┌─────────────────┐
                  │  MCP Servers  │           │  LLM Providers  │
                  │  外部 MCP     │           │  OpenAI / Claude│
                  │               │           │  DeepSeek 等    │
                  └───────────────┘           └─────────────────┘
```

### 三层职责

| 层 | 进程 | 职责 | 代码位置 |
|---|---|---|---|
| **桌面应用层** | Electron Main + Renderer | 用户交互、窗口管理、终端、模型凭据存储、进程编排 | `app/` |
| **适配翻译层** | Python (FastAPI) | `/v1/*` HTTP 端点、SSE 事件翻译、用户认证、本地数据管理 | `python-runtime/kcoder_gateway/` |
| **引擎内核层** | Python (LangGraph) | Agent 执行循环、工具调用、技能编排、沙箱隔离、多模型适配 | `vendor/qilin/` |

### 关键设计原则

1. **引擎零改动**：QiLin 引擎作为只读依赖引入，所有适配代码在 KCoder 仓库内。引擎升级只需 `git subtree pull`。
2. **Renderer 无感**：前端只调 `/v1/*` REST 端点，对底层是 QiongQi 还是 QiLin 完全不感知。
3. **Loopback 隔离**：sidecar 只监听 `127.0.0.1`，不对外暴露，安全边界清晰。
4. **双进程 sidecar**：gateway（对外端口）+ langgraph dev（内部端口），gateway 负责翻译与认证，引擎专注执行。

---

## 核心引擎：QiLin

KCoder 内嵌 **QiLin v1.0.0**——一个生产级的智能体（Agent）引擎，约 437 个文件、22 个高内聚子系统，将 LangGraph 状态机、模型调用、工具/技能生态、子代理递归、沙箱隔离、权限模型、可观测性与定时调度整合在同一进程中运行。

> 引擎源码 vendored 于 `vendor/qilin/`（通过 git subtree 纳入，保留完整上游历史）。

### 引擎核心能力

| 能力 | 说明 |
|---|---|
| **嵌入式 & 服务化双模** | 可作为 Python 库嵌入式调用，也可作为 LangGraph Platform 服务运行（KCoder 采用后者） |
| **LangGraph 兼容内核** | 基于 LangGraph 状态机构建 Turn/Run 执行循环，支持中断、恢复、上下文压缩 |
| **多 Provider 模型适配** | OpenAI / Anthropic / DeepSeek / Google Gemini / Ollama，统一流式调用、工具调用、推理内容 |
| **子代理递归执行** | 支持子代理独立 checkpoint，可递归分解复杂任务 |
| **多沙箱后端隔离** | Local / aio_sandbox / boxlite / E2B / Tenki，代码执行环境可插拔 |
| **RBAC 资源授权** | 细粒度资源访问控制，工具与文件操作受权限模型约束 |
| **技能市场** | 基于 `skill.json` + `SKILL.md` 的声明式技能包，支持静态/动态扫描发现 |
| **MCP 协议兼容** | 原生支持 Model Context Protocol，可连接外部工具服务器 |
| **可观测性追踪** | Langfuse / Monocle / OpenTelemetry 多后端追踪适配 |
| **定时任务调度** | Cron 表达式与一次性定时任务，支持自动化工作流 |
| **SkillACP 兼容** | 兼容 Agent Client Protocol，标准化 Agent 通信 |

### 引擎子系统（22 个模块）

```
qilin/
├── agents/            # Lead Agent 工厂 + 中间件链 + 记忆后端
├── subagents/         # 子代理执行器 + 注册中心
├── tools/             # 工具注册与装配流水线
├── skills/            # 技能系统（静态/动态扫描）
├── mcp/               # MCP 协议适配
├── runtime/           # LangGraph 运行 + checkpoint + 流桥
├── persistence/       # 多后端持久化（SQLite / Postgres / 内存）
├── scheduler/         # 定时任务调度
├── config/            # Pydantic 配置 + 热重载
├── sandbox/           # 沙箱抽象层
├── guardrails/        # 安全护栏中间件
├── authz/             # RBAC 资源授权
├── tracing/           # 多 Provider 追踪
├── models/            # 模型适配层
├── community/         # 第三方生态（搜索、沙箱等）
├── integrations/      # 第三方渠道集成（Lark 等）
├── tui/               # Textual 终端 UI
├── uploads/           # 用户上传管理
├── workspace_changes/ # 工作区变更追踪
├── reflection/        # 变量解析
├── client.py          # QiLinClient 嵌入式入口
└── utils/             # 通用工具
```

---

## KCoder 桌面功能

KCoder 在引擎能力之上，提供完整的桌面级编码工作站体验：

### 对话与编码

- **AI 对话面板**：流式响应、代码块语法高亮（Shiki）、工具调用过程可视化、执行视图
- **多会话管理**：会话创建、列表、删除、历史消息持久化
- **会话控制**：中断、追加指令（steer）、上下文压缩（compact）
- **命令输入**：快捷指令输入，支持斜杠命令

### 终端与工作区

- **真实 PTY 终端**：基于 node-pty + xterm.js 的多标签终端，完整的 shell 交互能力
- **工作区状态**：实时查询 Git 分支、脏标记状态

### 设置与配置

- **模型供应商管理**：多模型 profile 配置、凭据安全存储、运行时切换
- **用户认证**：注册 / 登录 / 改密码（bcrypt + JWT），多用户支持
- **MCP 服务器配置**：可视化管理 MCP server 连接
- **技能管理**：技能列表查看、草稿管理、安装
- **插件管理**：本地插件 CRUD
- **子智能体管理**：子代理配置与克隆
- **命令管理**：自定义命令 CRUD
- **记忆管理**：Agent 长期记忆的增删改查
- **远程控制**：双向远程控制配置

### 主题与国际化

- **明暗主题切换**：基于 CSS 变量的主题系统，纯前端切换无需重启
- **中英双语**：基于 React Context 的 i18n，zh-CN / en 实时切换

---

## 项目结构

```
KCoder/
├── app/                            # Electron 桌面应用
│   ├── main/                       #   主进程（TypeScript）
│   │   ├── index.ts                #     应用入口
│   │   ├── qilin-runtime-manager.ts#     QiLin sidecar 生命周期管理
│   │   ├── engine-host.ts          #     引擎宿主（启动/停止/端口）
│   │   ├── window.ts               #     窗口创建
│   │   ├── terminal.ts             #     PTY 终端 IPC
│   │   ├── models.ts               #     模型 profile 管理
│   │   ├── user-data-store.ts      #     自实现 FileUserDataStore
│   │   ├── settings.ts             #     应用设置
│   │   ├── menu.ts                 #     应用菜单
│   │   └── dialog.ts               #     文件夹选择对话框
│   ├── preload/                    #   preload 脚本（安全 IPC 桥）
│   ├── renderer/                   #   React 前端
│   │   └── src/
│   │       ├── components/         #     UI 组件
│   │       │   ├── ChatPanel/      #       聊天面板
│   │       │   ├── TerminalPanel/  #       PTY 终端面板
│   │       │   ├── SettingsPanel/  #       设置面板（9 个子页）
│   │       │   ├── Sidebar/        #       侧边栏导航
│   │       │   ├── StatusBar/      #       底部状态栏
│   │       │   ├── CodeBlock/      #       代码块渲染
│   │       │   ├── CommandInput/   #       命令输入
│   │       │   ├── WelcomeScreen/  #       欢迎页
│   │       │   ├── InfoPanel/      #       信息面板
│   │       │   └── AuthModal.tsx   #       认证弹窗
│   │       ├── hooks/              #     useChat / useAuth
│   │       ├── services/           #     engine-api 客户端 + 契约
│   │       ├── stores/             #     Zustand 全局状态
│   │       ├── i18n/               #     国际化
│   │       └── types/              #     全局类型
│   ├── electron.vite.config.ts     #   electron-vite 构建配置
│   └── electron-builder.yml        #   打包配置
│
├── python-runtime/                 # QiLin sidecar 运行时（适配层）
│   ├── kcoder_gateway/             #   FastAPI 翻译层
│   │   ├── main.py                 #     FastAPI app + lifespan
│   │   ├── threads.py              #     会话端点（建/列/删/发消息/SSE）
│   │   ├── sse.py                  #     SSE 事件桥（LangGraph → KCoder）
│   │   ├── qilin_client.py         #     LangGraph Platform HTTP 客户端
│   │   ├── auth/                   #     用户认证（bcrypt + JWT）
│   │   ├── memory_routes.py        #     记忆管理端点
│   │   ├── skills_routes.py        #     技能管理端点
│   │   ├── mcp_routes.py           #     MCP 配置端点
│   │   ├── plugins_routes.py       #     插件管理端点
│   │   ├── sub_agents_routes.py    #     子代理管理端点
│   │   ├── commands_routes.py      #     命令管理端点
│   │   ├── workspace_routes.py     #     工作区状态端点
│   │   └── stubs/                  #     占位端点（待实现）
│   ├── langgraph.json              #   LangGraph Platform 入口配置
│   ├── config.yaml                 #   QiLin AppConfig
│   ├── requirements.txt            #   Python 依赖（-e ../vendor/qilin）
│   └── .env.example                #   环境变量模板
│
├── vendor/                         # vendored 第三方源码
│   └── qilin/                      #   QiLin 引擎 v1.0.0（git subtree）
│       ├── qilin/                  #     引擎包本体（22 子模块）
│       ├── docs/                   #     引擎文档
│       ├── pyproject.toml          #     包元信息
│       └── VENDOR_VERSION          #     vendored 版本追溯
│
├── docs/                           # 项目文档
│   ├── qilin-mvp-report.md         #   QiLin 集成 MVP 报告
│   └── superpowers/                #   设计文档与计划
│
├── package.json                    # 根 workspace 配置
├── pnpm-workspace.yaml             # pnpm workspace 定义
└── tsconfig.json                   # 根 TypeScript 配置
```

---

## 快速开始

### 环境要求

- **Node.js** ≥ 20
- **pnpm** ≥ 10
- **Python** ≥ 3.12（推荐 3.14）
- **macOS** / **Linux** / **Windows**

### 1. 克隆仓库

```bash
git clone <repo-url> KCoder
cd KCoder
```

### 2. 安装桌面端依赖

```bash
pnpm install
```

> 安装后会自动执行 `@electron/rebuild` 重建 `node-pty` 原生模块。

### 3. 初始化 Python sidecar

```bash
cd python-runtime
python3 -m venv .venv          # 推荐 Python 3.12+
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt   # 含 -e ../vendor/qilin 可编辑安装引擎
cp .env.example .env
cd ..
```

> 引擎源码已在 `vendor/qilin/`，`pip install` 会从此处可编辑安装，无需从外部拉取。

### 4. 启动开发模式

```bash
pnpm dev
```

启动后 Electron 主进程会自动：
1. 编译主进程 / preload / renderer
2. spawn langgraph dev 子进程（QiLin service，内部端口）
3. spawn gateway 子进程（对外端口）
4. 轮询健康检查直到双进程就绪
5. 打开应用窗口

### 5. 配置模型（可选）

应用启动后，进入 **设置 → 模型** 配置 LLM 供应商凭据。未配置时引擎进入 standby 模式（不阻塞启动）。

---

## 技术栈

### 桌面端

| 类别 | 技术 |
|---|---|
| 框架 | Electron 33 + electron-vite |
| 前端 | React 18 + TypeScript 5 |
| 状态 | Zustand 5 |
| 样式 | Tailwind CSS 3 + CSS 变量主题 |
| 终端 | node-pty + xterm.js |
| 代码高亮 | Shiki |
| Markdown | react-markdown + remark-gfm |
| 打包 | electron-builder（dmg / nsis / AppImage） |

### 引擎端

| 类别 | 技术 |
|---|---|
| Agent 引擎 | QiLin v1.0.0（vendored） |
| 运行时 | LangGraph Platform（langgraph dev） |
| 网关 | FastAPI + Uvicorn |
| 异步 HTTP | httpx |
| 认证 | passlib[bcrypt] + PyJWT |
| 持久化 | SQLite（langgraph-checkpoint-sqlite） |
| MCP 适配 | langchain-mcp-adapters（mcp < 2.0.0） |

### 工程

| 类别 | 技术 |
|---|---|
| 包管理 | pnpm workspace（Node）+ pip（Python） |
| 引擎纳入方式 | git subtree（`vendor/qilin/`） |
| 类型检查 | tsc（前端）+ py_compile（Python） |

---

## 开发指南

### 日常开发

```bash
pnpm dev          # 启动开发模式（含 sidecar 自动拉起）
pnpm build        # 构建产物
pnpm typecheck    # 全工作区类型检查
pnpm package      # 打包桌面应用
```

### 手动调试 sidecar（两个终端）

```bash
# 终端 1：启动 QiLin service（内部端口）
cd python-runtime && source .venv/bin/activate
langgraph dev --port 19201 --host 127.0.0.1 --no-browser --allow-blocking

# 终端 2：启动 gateway（对外端口）
KCODER_GATEWAY_PORT=19200 QILIN_SERVICE_URL=http://127.0.0.1:19201 \
  python -m kcoder_gateway.main
```

健康检查：

```bash
curl http://127.0.0.1:19201/ok        # => {"ok":true}
curl http://127.0.0.1:19200/health    # => {"status":"ok",...}
```

### 引擎源码修改

引擎以可编辑模式（`-e`）安装，修改 `vendor/qilin/qilin/` 下的源码后，重启 sidecar 即时生效。

### 跟进 QiLin 上游更新

```bash
git subtree pull --prefix=vendor/qilin qilin-upstream <new-tag> \
  -m "vendor: bump QiLin to <new-tag>"
```

详见 `vendor/qilin/VENDOR_VERSION`。

### 常见问题

| 问题 | 解决 |
|---|---|
| `python-runtime/ not found` | 确认在仓库根目录执行 `pnpm dev`；检查 `app/main/qilin-runtime-manager.ts` 路径解析 |
| `No module named langgraph_cli` | 确认 venv 激活且 `pip install -r requirements.txt` 执行过；解释器应为 `.venv/bin/python` |
| passlib + bcrypt 崩溃 | `requirements.txt` 已 pin `bcrypt>=4.0.0,<4.1.0`，重建 venv 即可 |
| `mcp>=2.0.0` 不兼容 | `requirements.txt` 已 pin `mcp<2.0.0` |

---

## 文档导航

| 文档 | 说明 |
|---|---|
| [QiLin 引擎文档](vendor/qilin/docs/architecture.md) | 引擎三层架构、运行机制、安全模型（22 份模块文档） |
| [Python Sidecar 说明](python-runtime/README.md) | sidecar 目录结构、配置、手动调试指南 |
| [引擎迁移设计](docs/superpowers/specs/2026-07-24-kworks-engine-migration-design.md) | QiongQi → QiLin 架构迁移设计文档 |
| [迁移实施计划](docs/superpowers/plans/) | 分阶段实施计划（契约端口、专家注册等） |

---

## 许可协议

- **KCoder 桌面端**（`app/`、`python-runtime/`）：项目自有
- **QiLin 引擎**（`vendor/qilin/`）：Apache-2.0（上游 [kkutysllb/QiLin](https://github.com/kkutysllb/QiLin)）
