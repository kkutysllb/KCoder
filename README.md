# KCoder

> 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 引擎驱动的 Agent 编码桌面应用。
> Electron 桌面端 × Node.js Agent 引擎 × Cordis 插件生态，三位一体。

KCoder 是一个以大模型为核心驱动力的智能编码工作站。它将 DeepSeek Harness（`dsh`）生产级 Agent 引擎嵌入桌面应用，通过聊天对话即可完成代码编写、终端操作、文件管理、工作区隔离、技能编排等完整软件工程闭环——而无需离开应用窗口。

- **应用类型**：Electron 桌面应用（macOS / Windows / Linux）
- **内核引擎**：DeepSeek Harness `v0.1.0-rc.5`（以 `deepseek-harness/` 子仓库承载）
- **引擎架构**：Cordis 插件框架（"一切皆插件"），TypeScript + Node.js 单进程宿主
- **通信架构**：主进程内嵌 Node.js sidecar，监听 `127.0.0.1` 端口
- **前端栈**：React 18 + Zustand + Tailwind CSS + xterm.js + Monaco
- **许可协议**：MIT（DSH 引擎）/ 项目自有（桌面端）

---

## 目录

- [整体架构](#整体架构)
- [核心引擎：DeepSeek Harness](#核心引擎deepseek-harness)
- [KCoder 桌面功能](#kcoder-桌面功能)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [技术栈](#技术栈)
- [开发指南](#开发指南)
- [文档导航](#文档导航)

---

## 整体架构

KCoder 与前一版（QiLin 引擎）相比，引擎从 Python 栈整体迁移到 Node.js 栈，进程边界、插件模型、配置语义都翻新为 DSH 风格。整体仍保持"三层解耦"：

```
┌─────────────────────────────────────────────────────────────┐
│                    KCoder Electron 应用                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Renderer 进程（React 前端）                           │  │
│  │  聊天面板 · 终端 · 设置 · 侧边栏 · 状态栏 · Monaco     │  │
│  │         ↓ IPC 桥 (window.kcoder.*)                    │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  Main 进程（TypeScript）                               │  │
│  │  engine-host: spawn dsh Node.js 子进程                │  │
│  │  PTY 终端管理 · 用户数据 · 模型凭据 · 子代理注入        │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ spawn (127.0.0.1:<port>)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 DeepSeek Harness 引擎进程                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Cordis 插件宿主（dsh cli / web / acp / headless）   │  │
│  │  agent-loop · session · tools · subagent · skill       │  │
│  │  llm · credentials · settings · guard · workflow       │  │
│  │  plugins 以 effects / register 注册，按生命周期组合     │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
   ┌───────────────────┐         ┌─────────────────────┐
   │  DSH Plugin 生态   │         │  LLM Providers       │
   │  code-runtime      │         │  DeepSeek / OpenAI   │
   │  fs · terminal     │         │  Anthropic · 自托管  │
   │  skill · MCP       │         │  等任意 OpenAI 兼容  │
   └───────────────────┘         └─────────────────────┘
```

### 进程与职责

| 层 | 进程 | 职责 | 代码位置 |
|---|---|---|---|
| **桌面应用层** | Electron Main + Renderer | 用户交互、窗口管理、终端、模型凭据存储、进程编排 | `app/` |
| **引擎内核层** | Node.js (DSH) | Agent 执行循环、插件组合、工具调用、技能编排、会话持久化、模型适配 | `deepseek-harness/` |
| **数据/配置层** | 本地文件 | `~/.kcoder/` 下的产品配置、模型配置、子代理、token 统计等 | （运行时生成） |

> 注：旧版"双进程 sidecar（gateway + langgraph dev）"已废弃。DSH 单进程宿主即承载全部引擎能力；产品侧的本地服务（runtime-config / token-usage / workspace git）由主进程直接提供，不再走 Python helper。

### 关键设计原则

1. **引擎零仓库内改动**：DSH 通过 `deepseek-harness/` 子仓库引入，所有 KCoder 适配代码在主仓库内；引擎升级走 DSH 自身的发版节奏。
2. **Loopback 隔离**：sidecar 只监听 `127.0.0.1`，不对外暴露，安全边界清晰。
3. **Renderer 通过 IPC 消费产品能力**：渲染进程只调 `window.kcoder.*` 桥，引擎 HTTP 端点由主进程代理或转发。
4. **统一数据根**：所有用户数据落在 `~/.kcoder/`（可通过 `KCODER_APP_DATA_DIR` 覆盖）。

---

## 核心引擎：DeepSeek Harness

KCoder 内嵌 **DeepSeek Harness**——由 DeepSeek AI 开发的开源 Agent harness，采用"一切皆插件"架构，由 [Cordis](https://github.com/cordiverse/cordis) 驱动。

> 引擎源码以 `deepseek-harness/` 子仓库形式纳入 KCoder 主仓库（**未修改**，随 DSH 官方发版同步）。

### 引擎核心能力

| 能力 | 说明 |
|---|---|
| **Cordis 插件模型** | 一切皆插件；能力以 *Service Definition / Provider / Consumer* 三角色组合，能力边界（capability seam）从一开始就是完整可演进的 |
| **Agent 执行循环** | `agent-loop` + `system-prompt` + `tools` + `session` 共同驱动会话；事件日志持久化、可回放 |
| **多 Provider 模型适配** | `packages/llm` 提供 DeepSeek 等 provider；可扩展 OpenAI / Anthropic / 自托管等任意 OpenAI 兼容服务 |
| **工具与技能** | `packages/tool`、`packages/skill` 提供声明式工具与技能注册；技能可由 catalog/loader 加载 |
| **子代理（subagent）** | `packages/subagent` 支持子代理递归与 delegation，背靠 cordis effect 机制 |
| **会话与持久化** | `packages/session` 负责 session 持久化、projection、title、telemetry；SQLite / 文件持久化 |
| **MCP 兼容** | 支持 Model Context Protocol，可连接外部工具服务器 |
| **配置与凭据** | `packages/settings` + `packages/credentials` 提供用户级配置与凭据引用（env / .env 等） |
| **可观测性** | `packages/trace` + `packages/hooks`（Claude Code / Codex hook 桥）支撑轨迹落盘与外部系统对接 |
| **多种运行形态** | `apps/web`（Web UI）、`apps/cli`（headless / 单任务）、`examples/acp-agent`（ACP 服务化） |
| **Self-modification** | `packages/self-modification` 允许 Agent 检视/挂载自身的插件 |

### 引擎子系统（packages 顶层分组）

```
deepseek-harness/packages/
├── core/         # 产品 API 主干：session / system-prompt / tools / agent / agent-loop
├── api/          # 远程 BFF 装配 + Typert RPC gateway
├── typert/       # 类型图生成器、加载器、运行时注册
├── llm/          # 模型能力（Service Definition/Consumer + DeepSeek Provider）
├── shell/        # bash 能力（Service Definition + local/pwsh Provider + Consumer）
├── subprocess/   # 子进程能力 + 本地进程树 Provider
├── terminal/     # 持久化会话
├── fs/           # 文件系统能力 + 策略
├── lsp/          # 语言服务器能力
├── skill/        # 技能 Provider 注册 + 本地实现 + catalog/loader 工具
├── web/          # Web 能力（搜索、抓取等 Provider + 工具 Consumer）
├── compaction/   # 上下文压缩能力
├── context/      # 请求上下文插件
├── subagent/     # 子代理能力（Service Definition + Provider + delegation Consumer）
├── bundle/       # 可安装的 dsh --profile patch-layer bundles
├── workflow/     # 工作流能力 + Worker 线程 Provider + 工具 Consumer
├── todo/         # todo_write 工具
├── plan/         # 计划模式（作为日志状态）
├── preset/       # 基于 preset cordis.yml 的每会话 Agent 组合
├── guard/        # 循环卫生 + 工具超时
├── self-modification/  # Agent 检视/挂载自身插件
├── hooks/        # Claude Code / Codex hook 桥 + 协议库
├── session/      # 持久化 session 数据：projection / title / telemetry
├── identity/     # 匿名身份
├── settings/     # 用户设置能力 + 文件 Provider
├── credentials/  # 凭据引用能力 + env/.env Provider
├── acp/          # 仅自动化的 Agent Client Protocol server
├── interaction/  # 审批/交互能力、权限、命令、询问用户
├── boot/         # 共享 app-bin 粘合层
├── sdk/          # JSON-RPC 协议、服务端、TS 客户端
├── examples/     # 演示 bundles（agent-spine + CLI/ACP/JSON-RPC 二进制）
├── support/      # 开发/测试基础设施
└── util/         # 零依赖工具
```

### 引擎入口与运行形态

| 入口 | 行 | 用途 |
|---|---|---|
| `pnpm dsh` | `node --import tsx/esm apps/cli/src/bin.ts` | CLI 总入口（web / headless / acp …） |
| `pnpm dsh web` | 同上，subcommand `web` | 启动 Web UI，默认 `http://127.0.0.1:3080` |
| `pnpm dsh --profile headless "<task>"` | `apps/cli` | 一次性任务执行（需 `DEEPSEEK_API_KEY`） |
| `examples/acp-agent/` | `examples/acp-agent` | 自动化 ACP server |
| `packages/sdk` | `packages/sdk` | 嵌入进程 SDK（KCoder 集成主路径） |

KCoder 主进程通过 `packages/sdk` 直接驱动 DSH 引擎——具体集成形态（进程内嵌入 vs. spawn 子进程）见 [开发指南](#开发指南) 与 `app/main/engine-host.ts`。

---

## KCoder 桌面功能

KCoder 在 DSH 引擎能力之上，提供完整的桌面级编码工作站体验：

### 对话与编码

- **AI 对话面板**：流式响应、代码块语法高亮（Shiki）、工具调用过程可视化、执行视图
- **多会话管理**：会话创建、列表、删除、历史消息持久化
- **会话控制**：中断、追加指令（steer）、上下文压缩（compact）
- **命令输入**：快捷指令输入，支持斜杠命令

### 编辑器与终端

- **Monaco 代码编辑**：工作区内代码文件可直接编辑（Dark+ / Light+ 主题）
- **真实 PTY 终端**：基于 node-pty + xterm.js 的多标签终端，完整的 shell 交互能力
- **Mermaid 流程图**：聊天内可渲染 Mermaid 图
- **工作区状态**：实时查询 Git 分支、脏标记状态

### 设置与配置

- **模型供应商管理**：多模型 profile 配置、凭据安全存储、运行时切换
- **MCP 服务器配置**：可视化管理 MCP server 连接
- **技能管理**：技能列表查看、草稿管理、安装
- **子智能体管理**：子代理配置与克隆
- **项目注册表**：项目路径、名称、描述的持久化注册（产品层）

### 主题与国际化

- **明暗主题切换**：基于 CSS 变量的主题系统，纯前端切换无需重启
- **中英双语**：基于 React Context 的 i18n，zh-CN / en 实时切换

---

## 项目结构

```
KCoder/
├── app/                                 # Electron 桌面应用
│   ├── main/                            #   主进程（TypeScript）
│   │   ├── index.ts                     #     应用入口
│   │   ├── engine-host.ts               #     DSH 引擎宿主（启动/停止/端口）
│   │   ├── window.ts                    #     窗口创建
│   │   ├── terminal.ts                  #     PTY 终端 IPC
│   │   ├── menu.ts                      #     应用菜单
│   │   ├── tray.ts                      #     系统托盘
│   │   ├── dialog.ts                    #     文件夹选择对话框
│   │   ├── settings.ts                  #     应用设置
│   │   ├── models.ts                    #     模型 profile 管理
│   │   ├── user-data-store.ts           #     自实现 FileUserDataStore
│   │   ├── project-store.ts             #     产品层项目注册表
│   │   ├── sub-agent-injector.ts        #     子代理注入（DSH 插件视角）
│   │   └── local-services.ts            #     runtime-config / token-usage / git（TS 重写）
│   ├── preload/                         #   preload 脚本（安全 IPC 桥）
│   ├── renderer/                        #   React 前端
│   │   └── src/
│   │       ├── components/              #     UI 组件
│   │       │   ├── ChatPanel/           #       聊天面板
│   │       │   ├── TerminalPanel/       #       PTY 终端面板
│   │       │   ├── SettingsPanel/       #       设置面板
│   │       │   ├── Sidebar/             #       侧边栏导航
│   │       │   ├── StatusBar/           #       底部状态栏
│   │       │   ├── CodeBlock/           #       代码块渲染（含 Shiki）
│   │       │   ├── CommandInput/        #       命令输入
│   │       │   ├── WelcomeScreen/       #       欢迎页
│   │       │   ├── InfoPanel/           #       信息面板
│   │       │   └── AuthModal.tsx        #       认证弹窗
│   │       ├── hooks/                   #     useChat / useAuth
│   │       ├── services/                #     engine-api 客户端 + 契约
│   │       ├── stores/                  #     Zustand 全局状态
│   │       ├── i18n/                    #     国际化
│   │       └── types/                   #     全局类型
│   ├── electron.vite.config.ts          #   electron-vite 构建配置
│   ├── electron-builder.yml             #   打包配置
│   └── package.json                     #   @kcoder/app（独立依赖）
│
├── deepseek-harness/                    # DSH 引擎子仓库（未修改）
│   ├── packages/                        #   54 个 @deepseek-ai/dsh-<name> 包
│   ├── apps/                            #   web / cli
│   ├── examples/                        #   accp-agent / headless-agent / jsonrpc-agent / mcp-memory / web-* 示例
│   ├── docs/                            #   架构 / API / 开发指南
│   ├── scripts/                         #   仓库级 gate 与生成器
│   ├── vendor/                          #   vendored Cordis 源码
│   ├── native/                          #   原生模块（landlock-run 等）
│   ├── AGENTS.md                        #   Agent 协作约定（先读这个）
│   ├── CONTRIBUTING.md                  #   贡献指南
│   └── README.md                        #   引擎主文档
│
├── skills/                              # KCoder 工作流技能库
│   └── public/                          #   86 个技能（文档/产物/设计/场景）
│
├── logs/                                # 运行日志（debug 时落地，自动生成）
├── tsconfig.json                        # 根 TypeScript 配置
└── .gitignore
```

---

## 快速开始

### 环境要求

- **Node.js** ≥ 22.19（或 ≥ 24）
- **pnpm** ≥ 11
- **macOS** / **Linux** / **Windows**

### 1. 克隆仓库

```bash
git clone <repo-url> KCoder
cd KCoder
```

### 2. 初始化 DSH 引擎（子仓库）

```bash
cd deepseek-harness
pnpm install
pnpm run build
cd ..
```

> 第一次 pnpm install 会触发 lefthook 安装（postinstall）。DSH 仓库级 gates 完整列表见 `deepseek-harness/AGENTS.md`。

### 3. 启动桌面端（开发模式）

```bash
cd app
pnpm install
pnpm dev
```

`pnpm dev`（electron-vite）会：

1. 编译主进程 / preload / renderer
2. 由主进程 `app/main/engine-host.ts` 拉起 DSH 引擎子进程
3. 等待 DSH 健康检查通过
4. 打开应用窗口

### 4. 配置模型（可选）

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
| 代码编辑器 | Monaco Editor |
| 代码高亮 | Shiki |
| Markdown | react-markdown + remark-gfm |
| 图示 | Mermaid |
| 打包 | electron-builder（dmg / nsis / AppImage） |

### 引擎端

| 类别 | 技术 |
|---|---|
| Agent 引擎 | DeepSeek Harness `v0.1.0-rc.5`（`deepseek-harness/`） |
| 插件框架 | Cordis（"一切皆插件"） |
| 运行时 | Node.js ≥ 22.19 |
| 类型 | TypeScript 6 + 严格模式 |
| 会话 | 基于 `packages/session`（持久化 + projection） |
| 模型 | `packages/llm`（Service Definition + Provider） |
| 工具 | `packages/tool` + `packages/skill` 声明式注册 |
| 子代理 | `packages/subagent`（delegation through Cordis effects） |
| 数据 | `packages/settings` + `packages/credentials`（env / .env Provider） |
| 协议 | JSON-RPC（`packages/sdk`）、ACP（`packages/acp`） |

### 工程

| 类别 | 技术 |
|---|---|
| 包管理 | pnpm workspace（DSH 子仓库）+ Electron 桌面端独立 `app/package.json` |
| 引擎纳入方式 | 直挂子仓库（`deepseek-harness/`，随 DSH 发版同步） |
| 类型检查 | tsc（前端 + DSH 仓库级 `tsconfig.host.json` / `tsconfig.client.json`） |
| Lint | oxlint（DSH 仓库） |
| 测试 | vitest（DSH 仓库） |

---

## 开发指南

### 日常开发

```bash
# app/ 工作区
cd app
pnpm dev            # 启动带 HMR 的开发模式
pnpm build          # 构建产物
pnpm typecheck      # tsc --noEmit
pnpm package        # 打包桌面应用

# deepseek-harness/ 工作区
cd ../deepseek-harness
pnpm run build      # tsc emits lib/types + tsdown bundles
pnpm run typecheck
pnpm run lint
pnpm run test       # vitest 单元测试
pnpm run test:coverage  # CI 覆盖率门禁（per-file 100%）
pnpm run hygiene    # knip + publint + 约束 + NodeNext consumer 检查
```

### 引擎集成面

`app/main/engine-host.ts` 是 KCoder 接入 DSH 的唯一宿主入口，对外签名（`startEngine` / `stopEngine` / `restartEngine` / `getEnginePort` / `getEngineToken` / `getEngineDataDir`）保持稳定，渲染进程对其完全无感。

> ⚠️ **待决策**：DSH 的集成形态有两种走法——
> 1. **进程内嵌入**：主进程通过 `deepseek-harness/packages/sdk` 直接驱动 DSH（同进程协同、零 IPC 开销、但主机负载抬升）
> 2. **spawn 子进程**：主进程 spawn `pnpm dsh` 或 `node apps/cli/src/bin.ts` 作为子进程，通过 loopback HTTP / JSON-RPC 通信（边界清晰、便于独立升级、但需要 IPC 桥）
>
> 当前 `app/main/qilin-runtime-manager.ts` 仍保留 QiLin 时代 Python sidecar 启动代码，迁移到 DSH 后需要按选定的形态重写。具体决策由你拍板后再落到代码。

### 引擎源码修改

DSH 仓库以子仓库形式纳入（**未修改**）；遇到引擎 bug 或改进在 DSH 上游提 issue / PR，KCoder 侧通过子仓库同步获得更新。

### 跟进 DSH 上游更新

```bash
git submodule update --remote deepseek-harness
```

或在子仓库中按 DSH 发版流程（`pnpm run release:dsh`）调整。

### 常见问题

| 问题 | 解决 |
|---|---|
| `Cannot find module '@deepseek-ai/dsh-*'` | 在 `deepseek-harness/` 下重新 `pnpm install` 与 `pnpm run build` |
| `node-pty` 编译失败 | `app/` 下重新 `pnpm install`（electron-vite 会触发 `@electron/rebuild`） |
| Lefthook postinstall 失败 | 容器/CI 镜像内可 `HUSKY=0 SKIP_LEFTHOOK=1 pnpm install`，但本地推荐保持启用 |
| Sidecar 端口被占 | `app/main/engine-host.ts` 默认使用 `18899 + Math.floor(Math.random() * 1000)` 范围；可通过配置覆盖 |

---

## 文档导航

| 文档 | 说明 |
|---|---|
| [DeepSeek Harness 引擎](deepseek-harness/README.md) | 引擎主干文档（架构、运行、贡献） |
| [DSH 架构文档](deepseek-harness/docs/architecture.md) | 插件模型、能力分段、生命周期 |
| [DSH 开发指南](deepseek-harness/docs/development.md) | 仓库布局、gates、贡献流程 |
| [DSH 包设计公约](deepseek-harness/packages/AGENTS.md) | 改 `packages/` 之前必读 |
| [DSH Agent 协作](deepseek-harness/AGENTS.md) | agent 视角的工程公约 |
| [Web UI 指南](deepseek-harness/docs/user/guide/index.md) | `dsh web` 用户文档 |
| [交流区](deepseek-harness/README.md#community-and-support) | GitHub Discussions / Discord / 企微群 |

---

## 许可协议

- **DeepSeek Harness 引擎**（`deepseek-harness/`）：[MIT](deepseek-harness/LICENSE)
- **KCoder 桌面端**（`app/`、`skills/`）：项目自有（具体协议待定）
