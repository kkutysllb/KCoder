# KCoder Coding Agent 完成度审计报告

**审计日期：** 2026-08-14  
**审计对象：** `/Users/libing/kk_Projects/KCoder`  
**审计性质：** 只读技术与产品完成度审计  
**审计结论：** 功能丰富的内部 Alpha/MVP，尚未达到稳定发布和公开交付标准

## 1. 执行摘要

KCoder 已经完成了一个 coding agent 产品的主要骨架：Electron 桌面应用、React 工作区、FastAPI Gateway、LangGraph/QiLin sidecar、流式对话、工具调用、文件编辑、Git 操作、终端、模型配置、记忆、技能、MCP、插件和本地项目管理均有实现。

核心开发闭环已经具备：用户选择工作区，创建线程，向 Agent 发起任务，接收流式文本和工具事件，查看文件变更，编辑文件，并执行部分 Git 操作。该闭环在受信任的开发环境中具备内部演示价值。

但当前实现存在明显的“契约已存在、能力未实现”现象。治理面板、审批、用户输入、steer、interrupt、compact、远程控制、插件市场、分支列表等能力仍是 stub、空响应或 no-op。更重要的是，认证隔离、工作区路径边界、凭据处理、SSE 恢复、sidecar 配置和独立打包存在阻断级问题。

因此，当前项目应定义为：

> **功能丰富的内部 coding agent Alpha，而不是可稳定交付的生产级 coding agent 产品。**

### 1.1 完成度评分

以下评分不是代码行数比例，而是按“用户可用性、真实执行程度、可靠性、安全性和可交付性”综合估计。

| 领域 | 估计完成度 | 判断 |
|---|---:|---|
| Electron 桌面壳与基础 UI | 75%–85% | 体验面覆盖较广，主要页面和工作区交互存在 |
| 单 Agent 聊天与工具执行 | 65%–75% | 主链路真实存在，但长任务、失败恢复和真实模型 E2E 不完整 |
| Gateway/API 适配层 | 60%–70% | 端点覆盖面较宽，部分端点仍是兼容性 stub |
| 工作区、文件、Git、终端 | 60%–70% | 常用操作真实可用，但路径隔离不安全 |
| 记忆、技能、MCP、插件、子 Agent | 45%–65% | 部分真实对接，部分为本地 CRUD 或降级实现 |
| 治理、审批、运行控制 | 20%–35% | UI 先行，后端能力明显缺失 |
| 认证、权限和数据隔离 | 35%–45% | 有 JWT/auth 代码，但核心路径 fail-open |
| 测试、CI 和工程质量 | 20%–30% | 编译基线存在，KCoder 自身自动化测试不足 |
| 独立打包与跨平台交付 | 20%–30% | 目前依赖开发机 Python/runtime，安装包不可独立运行 |
| **综合功能完成度** | **约 60%** | **内部 Alpha/MVP** |
| **生产/公开交付就绪度** | **约 35%–40%** | **暂不具备发布条件** |

## 2. 审计范围与方法

本次审计覆盖以下区域：

- Electron Main、Preload、Renderer 生命周期与 IPC。
- React 聊天、历史、工具调用、文件预览、编辑器、终端和设置面板。
- FastAPI Gateway、线程、turn、SSE、工作区、附件、认证、项目、记忆、技能、MCP、插件、子 Agent、命令和运行时配置。
- QiLin vendored 源码、权限中间件和 Agent 适配层。
- electron-builder 打包配置、Python sidecar 启动方式和用户数据目录。
- 构建、类型检查、Python 编译、依赖安装、QiLin 测试和 Gateway 真实冒烟。

本次未修改业务代码。工作区原有未提交改动全部保留；报告文件是本次新增的审计产物。

## 3. 总体架构评估

### 3.1 当前架构

```text
Electron Main / Preload / Renderer
          |
          | HTTP + SSE /v1/*
          v
FastAPI KCoder Gateway
          |
          | LangGraph Platform HTTP/SSE
          v
QiLin LangGraph Service
          |
          +-- QiLin Agent
          +-- MCP extensions
          +-- sandbox / tools
          +-- memory / checkpoint
```

`qilin-runtime-manager.ts` 负责启动两个 Python 子进程：内部 LangGraph service 和面向 Renderer 的 Gateway。该分层将前端旧 API 契约与 QiLin/LangGraph 原生 API 隔离开，方向正确，也降低了 Renderer 迁移成本。

### 3.2 架构优点

- 前后端边界清晰，Renderer 不直接依赖 QiLin 内部 Python 模块。
- Gateway 对 LangGraph 事件做了 KCoder SSE 格式转换，前端改动较少。
- 线程历史有 thread-log 兜底，能够缓解 LangGraph 重启或状态缺失。
- 本地 JSON 使用临时文件加原子 rename，降低崩溃导致的半写入风险。
- QiLin 已 vendored 到仓库，适配层基本在 KCoder 内部，不依赖外部源码目录。
- React/TypeScript、FastAPI/Python 的模块拆分相对明确，继续演进的结构基础存在。

### 3.3 架构缺陷

- Gateway 是状态转换层，但部分状态仍只存在内存中，无法承担可靠任务协调器的职责。
- sidecar 环境变量、主进程配置注入器和 Python 数据空间使用了不同的数据根策略。
- 认证存在，但没有成为所有敏感路由的强制边界。
- 前端 API 契约范围已经超过后端真实能力，造成“界面完成度高于系统完成度”。
- sidecar 打包策略尚未完成，开发环境依赖被误当作产品运行时依赖。

## 4. 已完成能力分析

### 4.1 桌面应用与工作区体验

已实现的桌面端能力包括：

- Electron 窗口创建、隐藏、关闭、托盘和生命周期管理。
- 主题、国际化、侧边栏、状态栏、设置面板。
- node-pty/xterm.js 终端。
- Monaco 编辑器、代码高亮、Markdown/GFM、文件预览。
- 聊天输入、历史任务、工具活动、文件变更卡片和交付结果。
- Renderer 与主进程之间的 IPC 契约。

这些内容足以构成可操作的工作台，而不是单纯的聊天页面。

### 4.2 线程与聊天闭环

真实实现包括：

- 创建、查询、列表、删除、更新线程。
- 线程元数据中的标题、工作区、模型和工作模式。
- turn 异步启动。
- LangGraph messages、AI 文本、工具调用和工具结果的 SSE 翻译。
- 历史消息从 LangGraph state 转换为 Renderer 的消息模型。
- LangGraph 状态缺失时从 thread-log 恢复历史。
- 附件文本内容注入 Agent prompt。

这一部分是项目最成熟的产品核心。但当前审计没有把“真实模型执行复杂 coding 任务”视为完全验证通过，因为仍缺少 KCoder 自有 E2E 测试、模型切换测试、长任务测试和错误恢复测试。

### 4.3 工作区、文件与 Git

工作区路由已经覆盖：

- Git status、tree、文件列表、文件读取。
- 文件保存、搜索和单文件撤销。
- 分支创建和切换。
- commit、push。
- 文件变更跟踪和前端变更卡片。

这组能力在内部 coding demo 中具有实际价值，但其安全前提尚未成立：文件接口接受任意绝对路径，并没有将请求绑定到已选择 workspace。

### 4.4 设置与扩展能力

以下能力已有代码和 UI：

- 模型 profile 和运行时配置。
- Memory 记录管理。
- Skills 列表、启用、安装相关路由。
- MCP 配置。
- Plugins、Sub-agents、Commands 的本地 JSON CRUD。
- Projects 与线程归档关联。
- Token usage 统计。

但这些能力的真实性不一致：Memory、Skills、MCP 有部分 QiLin 对接；Plugins、Commands、Projects、Sub-agents 很多部分是 KCoder 自有本地存储；marketplace、远程控制和插件更新检查仍为空实现。

## 5. 未完成和降级能力

### 5.1 治理与执行控制

[engine_stub.py](/Users/libing/kk_Projects/KCoder/python-runtime/kcoder_gateway/stubs/engine_stub.py:30) 中的治理接口仍返回空数据或 503，包括：

- governed timeline。
- run inspect。
- engine stream。
- circuit。
- engine cancel。
- checkpoint resolve。

前端执行面板可以展示这些概念，但后端没有对应的真实状态机。

### 5.2 审批和结构化用户输入

[approvals_stub.py](/Users/libing/kk_Projects/KCoder/python-runtime/kcoder_gateway/stubs/approvals_stub.py:24) 中：

- approval 统一返回 `expired`。
- user input 统一返回 `cancelled`。

这意味着高风险工具目前无法形成真正的“等待用户批准—继续执行”闭环。

### 5.3 Turn 控制

[threads.py](/Users/libing/kk_Projects/KCoder/python-runtime/kcoder_gateway/threads.py:701) 中的：

- steer
- interrupt
- compact

仍是 no-op 或兼容性响应。前端按钮存在，但调用不能改变真实 Agent 执行状态。

### 5.4 插件、市场和远程能力

- plugin discover/update 永远为空。
- install 主要写入本地 metadata，不负责真正安装和依赖解析。
- marketplace 返回空索引。
- remote control API 全部 no-op。
- 远程二维码和连接 UI 属于占位实现。
- 分支列表接口永远返回空数组，前端只能从 status 推导当前分支。

### 5.5 消息编辑与重新生成

当前编辑/重新生成主要是前端截断后重新发送 prompt。它没有真正操作引擎历史，也没有形成 branch-from-message 或可追踪的消息版本关系。

## 6. 安全审计结果

### 6.1 凭据风险

被忽略的 `python-runtime/config.yaml` 当前仍包含真实 API key。忽略文件不等于安全文件，因为：

- 文件仍存在于开发机。
- 打包规则默认复制 `python-runtime`。
- 备份、日志和构建产物可能携带该文件。

该凭据应立即轮换，报告不复述具体内容。

### 6.2 工作区越权

[workspace_routes.py](/Users/libing/kk_Projects/KCoder/python-runtime/kcoder_gateway/workspace_routes.py:376) 的文件写入只检查绝对路径，不检查 workspace 归属。读取、搜索等接口也存在相同问题。

[workspace_routes.py](/Users/libing/kk_Projects/KCoder/python-runtime/kcoder_gateway/workspace_routes.py:421) 使用字符串 `startswith` 做路径边界判断，不能可靠处理路径前缀、符号链接和规范化问题。

在真实 Gateway 冒烟中，未登录请求可以读取 `/etc/hosts`，说明该风险已经可以被外部请求利用。

### 6.3 认证 fail-open

[main.py](/Users/libing/kk_Projects/KCoder/python-runtime/kcoder_gateway/main.py:165) 使用软用户解析中间件；没有 token 时只是把 `request.state.user_id` 设为空，而不是拒绝请求。

[auth/middleware.py](/Users/libing/kk_Projects/KCoder/python-runtime/kcoder_gateway/auth/middleware.py:26) 提供了 `require_user`，但核心 threads、workspace、projects 和 turn 路由没有统一采用它。

审计观察到未登录请求可以看到已有线程，说明用户隔离没有真正贯穿数据访问层。

### 6.4 Runtime token 未启用

[engine-host.ts](/Users/libing/kk_Projects/KCoder/app/main/engine-host.ts:177) 明确说明 runtime token 在 MVP 阶段被 sidecar 忽略。loopback 监听只防止远程网络访问，不能防止同一台机器上的其他进程调用。

### 6.5 权限默认放行

[permission_middleware.py](/Users/libing/kk_Projects/KCoder/vendor/qilin/qilin/agents/middlewares/permission_middleware.py:128) 对未明确列入变更工具集合的工具倾向放行，未知模式也未采用严格拒绝策略。子 Agent 没有完全复用同一权限中间件。

这对 MCP、浏览器、外部系统和未来新增工具尤其危险。

### 6.6 附件资源限制不足

附件 base64 上传缺少明确的请求体和文件大小上限，存在内存占用和磁盘消耗风险。附件内容注入 prompt 后还可能放大上下文成本。

## 7. 可靠性审计结果

### 7.1 SSE 只能满足短连接演示

当前 SSE registry 主要保存在内存中：

- 无持久 event id。
- 无真正的 `Last-Event-ID` 重放。
- Gateway 重启后无法恢复实时流。
- 短 turn 可能在 Renderer 建立 SSE 连接前结束，导致 `No active turn`。
- 旧 run 清理逻辑可能误删同线程的新 run。

对于短响应尚可，对于多分钟的代码修改、测试和修复任务不够可靠。

### 7.2 工具失败状态可能失真

[sse.py](/Users/libing/kk_Projects/KCoder/python-runtime/kcoder_gateway/sse.py:365) 对 ToolMessage 的错误状态映射不够严格，存在工具执行失败却被前端显示为成功的风险。

### 7.3 Sidecar 异常处理不完整

当 LangGraph 或 Gateway 单独退出时，运行句柄和端口状态处理不够严谨；启动健康检查失败时也没有统一保证所有已启动子进程被清理，存在孤儿进程和端口冲突风险。

### 7.4 删除语义不完整

删除线程主要删除上游 LangGraph 线程，但本地 thread-log 没有可靠 tombstone。后续列表合并 thread-log 时，被删除线程可能重新出现。

## 8. 配置与数据空间问题

项目已经尝试统一使用 `~/.kcoder`，并划分 `config/runtime/product/cache/logs/backups`，方向是正确的。

当前仍有以下不一致：

- Electron runtime-manager 使用用户数据根。
- Gateway `main.py` 仍把 Python runtime 目录作为 `app.state.data_dir`。
- local_store 根据环境变量和旧目录回退。
- JWT secret 可能落在仓库 `python-runtime/`。
- 模型注入器读取主进程环境，而 sidecar 配置路径只写入子进程环境。

结果是：配置、线程日志、模型数据、JWT secret 和插件 JSON 可能分散在不同根目录；首次启动、重启、升级和迁移场景的行为不够确定。

## 9. 打包与发布评估

### 9.1 当前打包配置的问题

[electron-builder.yml](/Users/libing/kk_Projects/KCoder/app/electron-builder.yml:9) 只复制 Python 源码，排除 `.venv`、`.qilin` 和 `.langgraph_api`，没有携带完整 Python 解释器、QiLin 依赖和运行时数据。

运行时仍依赖：

- 系统 Python 版本满足要求。
- 本地虚拟环境存在。
- Python 依赖已经安装。
- MCP/worktree-overlay 路径可解析。

这些都是开发机前提，不是独立产品安装包应有的行为。

### 9.2 当前验证结果

- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `python3 -m compileall -q python-runtime/kcoder_gateway`：通过。
- `pnpm install --frozen-lockfile --offline`：通过。
- `pnpm package`：失败，当前至少存在缺失的 `@kcoder/worktree-overlay` symlink 问题。
- `app/build/entitlements.mac.plist` 不存在，但打包配置引用了它。
- Windows Python 路径探测没有 `Scripts/python.exe` 分支。

即使修复当前 symlink，完整独立打包仍未完成。

## 10. 测试与工程质量

### 10.1 已有基础

- TypeScript 类型检查通过。
- 前端生产构建通过。
- Python Gateway 可编译。
- QiLin vendored 测试此前审计记录为 `266 passed`。
- 依赖锁文件可以离线安装。

### 10.2 主要缺口

没有发现 KCoder 自有的：

- Gateway 单元测试。
- workspace 路径安全测试。
- 认证和 owner 隔离测试。
- SSE 连接、断线、重放测试。
- Electron IPC 测试。
- Renderer/Gateway 集成测试。
- 真实 coding 场景 E2E 测试。
- CI 工作流、覆盖率门禁、lint 或安全扫描。

当前环境的 `.venv` 没有安装 `pytest`，因此本次无法重新执行 QiLin 测试；此前 `266 passed` 是既有审计记录，不应视为 KCoder 适配层测试覆盖。

此外，README 仍标记 QiLin 为 v1.0.0，而 vendored QiLin 与 `pyproject.toml` 已是 v2.0.0；`docs/` 又被 `.gitignore` 忽略，部分设计文档不在版本控制中。Python sidecar README 仍保留“需手动启动 Gateway”等过时说明。

## 11. 当前可支持的产品场景

在受信任的 macOS/Linux 开发环境中，当前版本可以支持：

1. 启动 Electron 工作台。
2. 选择本地代码仓库。
3. 创建 coding thread。
4. 向 QiLin Agent 发送任务。
5. 接收助手文本、工具调用和文件变更事件。
6. 查看或编辑工作区文件。
7. 使用终端和部分 Git 操作。
8. 查看历史任务和本地设置。

以下场景尚不能视为稳定支持：

- 不受信任用户访问。
- 多用户或多租户隔离。
- 破坏性工具的审批流程。
- 长时间运行任务和断线恢复。
- Electron 安装包在无开发环境机器上的启动。
- Windows/Linux/macOS 全平台一致交付。
- 远程控制、插件市场和治理运行控制。

## 12. 风险分级

### P0：必须立即处理

1. 真实 API key 存在于被打包规则覆盖的 ignored 配置文件中。
2. 文件读取/写入/搜索允许任意绝对路径。
3. 核心请求不强制认证，线程和项目没有完整 owner 隔离。
4. runtime token 被忽略，本机其他进程可以访问 Gateway。

### P1：进入 Beta 前必须处理

1. 配置注入路径与用户数据根不一致。
2. Python/QiLin runtime 没有独立打包方案。
3. SSE 没有可靠重放和断线恢复。
4. sidecar 孤儿进程和启动失败清理不完整。
5. 权限策略 fail-open，子 Agent 权限不一致。
6. 附件缺少严格大小限制。
7. 删除线程可能被本地日志重新恢复。

### P2：产品完整性问题

1. 治理图和运行控制仍是 stub。
2. approval、user input、steer、interrupt、compact 未实现。
3. branches、marketplace、remote control 未实现。
4. 插件 install/update 只有部分 metadata 能力。
5. regenerate/branch-from-message 语义不完整。
6. README、版本号、设计文档和实际实现存在漂移。

## 13. 建议路线图

### 阶段一：安全止血

目标：消除能造成直接数据泄露或任意执行的风险。

- 轮换并清理现有 API key。
- 将真实凭据迁移到用户数据目录或系统密钥存储。
- 从安装包排除所有配置、secret、`.env` 和运行时数据。
- 默认关闭 host bash。
- 建立 workspace allowlist。
- 所有敏感路由强制 `require_user`。
- 启用并校验 runtime token。
- 增加附件请求体、文件大小和内容类型限制。

阶段完成标准：未登录请求无法访问线程、工作区、配置和附件；路径测试无法读取 workspace 外文件；安装包不包含任何凭据。

### 阶段二：统一数据与配置模型

- 统一 Electron、Gateway、QiLin 的数据根。
- 统一 `QILIN_CONFIG_PATH` 的传递方式。
- 为 thread、project、attachment、plugin、model profile 添加 owner 关系。
- 为删除线程添加 tombstone 或同步删除本地日志。
- 明确迁移、升级和回滚策略。

阶段完成标准：重启、升级和多用户切换后，配置、历史和项目归属保持一致。

### 阶段三：可靠运行时

- 持久化 run 状态。
- SSE 增加 event id、重放和 `Last-Event-ID` 恢复。
- 修复 turn 与 SSE 建连竞态。
- 为 registry 清理增加 run identity 检查。
- 统一 sidecar 启动失败、异常退出和关闭路径。
- 正确传递工具失败状态。

阶段完成标准：网络抖动、Gateway 重启和长任务情况下，用户不会静默丢失任务状态或工具结果。

### 阶段四：可交付运行时

- 选择 PyInstaller、Nuitka 或等价方案打包 Python runtime。
- 携带 QiLin、LangGraph、MCP 和必要依赖。
- 完成 macOS、Windows、Linux clean-machine 测试。
- 修复 macOS entitlements、worktree-overlay、原生模块和签名流程。
- 建立版本升级和 runtime migration 流程。

阶段完成标准：新机器只安装产品包，不安装 Python、pnpm 或仓库依赖，也能启动并完成健康检查。

### 阶段五：补齐产品能力和质量体系

- 真正实现 approval、user input、interrupt、steer、compact。
- 实现治理状态、运行检查、取消和 checkpoint。
- 实现插件安装、更新、版本和 marketplace。
- 实现远程控制或明确移除相关 UI。
- 建立 Gateway、SSE、权限、IPC 和真实 coding E2E 测试。
- 建立 CI、lint、coverage 和依赖/secret 扫描。

## 14. 发布门槛建议

在满足以下条件前，不建议公开发布：

- [ ] 仓库和安装包中不存在真实凭据。
- [ ] 未认证请求无法访问任何用户数据或工作区文件。
- [ ] 所有 workspace 路径经过规范化和 allowlist 校验。
- [ ] runtime token 实际生效。
- [ ] 工具权限默认拒绝，审批链路真实可用。
- [ ] SSE 支持断线恢复和任务状态持久化。
- [ ] Python/QiLin runtime 可独立打包。
- [ ] macOS、Windows、Linux clean-machine 安装测试通过。
- [ ] KCoder 自有集成和 E2E 测试进入 CI。
- [ ] 所有前端可见的 stub 能力已实现，或从 UI 中移除。

## 15. 最终判断

KCoder 的产品方向和核心架构是成立的，当前已经投入了大量真实实现，尤其是桌面工作区、聊天适配、工具事件、文件和 Git 交互部分具有较高完成度。

项目当前最大的风险不是“功能太少”，而是“功能表面覆盖广，但安全边界、运行可靠性和交付链路没有跟上”。继续增加 UI 或扩展端点数量，不能替代认证隔离、路径安全、配置一致性、SSE 恢复和独立打包。

建议将下一阶段目标从“继续扩展功能”切换为：

> **先把内部 Alpha 变成安全、可恢复、可独立安装的 Beta，再补治理和生态能力。**
