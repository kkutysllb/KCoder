# KCoder Python Runtime — QiLin Sidecar

> KCoder 的 Python 后端 sidecar，基于 [QiLin](https://github.com/kkutysllb/QiLin) agent harness engine。
> QiLin 引擎仓库只读；本目录所有文件是 KCoder 仓库内的适配层。

---

## 中文版

### 这是什么

KCoder 的 Electron 主进程（TypeScript）通过 `app/main/qilin-runtime-manager.ts`
spawn 一个独立的 Python 子进程，运行 QiLin 引擎（作为 LangGraph Platform
service）。子进程监听 `127.0.0.1:<port>`，KCoder renderer 通过 HTTP/SSE 调用。

### 目录结构

```
python-runtime/
├── langgraph.json          # LangGraph Platform 入口配置
├── config.yaml             # QiLin AppConfig（sandbox + models 占位）
├── .env / .env.example     # 环境变量（QILIN_CONFIG_PATH 等）
├── requirements.txt        # Python 依赖（qilin + langgraph-cli + gateway + mcp）
├── extensions_config.json  # MCP server 注册（用户通过前端 MCP 设置页面管理）
├── kcoder_gateway/         # FastAPI 翻译层（/v1/* → LangGraph Platform API）
│   ├── __init__.py
│   ├── main.py             # FastAPI app + lifespan
│   ├── qilin_client.py     # LangGraph Platform HTTP 客户端
│   ├── threads.py          # 5 个核心端点（建会话/列表/删除/发消息/SSE）
│   └── sse.py              # SSE 事件桥（LangGraph → KCoder renderer 格式）
└── README.md               # 本文件
```

注意：`runtime-manager.ts` 已迁移到 `app/main/qilin-runtime-manager.ts`，
因为它属于 Electron 主进程代码（受 `app/tsconfig.json` 编译边界约束）。

### 一次性安装

```bash
cd KCoder/python-runtime
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

> QiLin wheel 目前在 [GitHub Release v1.0.0](https://github.com/kkutysllb/QiLin/releases/tag/v1.0.0)。
> `pip install` 会从 PyPI 拉（一旦发布），或从 Release URL 装：
> ```bash
> pip install https://github.com/kkutysllb/QiLin/releases/download/v1.0.0/qilin-1.0.0-py3-none-any.whl
> ```

### 日常开发

正常 `pnpm dev` 即可——Electron 主进程会自动 spawn sidecar，无需手动启动。

手动调试 sidecar：

```bash
cd KCoder/python-runtime
source .venv/bin/activate
langgraph dev --port 19200 --host 127.0.0.1 --no-browser --allow-blocking
```

健康检查：

```bash
curl http://127.0.0.1:19200/ok
# => {"ok":true}
```

### 关键配置说明

| 文件 / 字段 | 说明 |
|---|---|
| `langgraph.json` 的 `graphs.agent` | **必须**是 `qilin.agents.lead_agent.agent:make_lead_agent`（实际定义模块，不能用 `qilin.agents:` 懒加载入口） |
| `config.yaml` 的 `models[].use` | **必须**是 `module:Class` 格式（如 `langchain_openai:ChatOpenAI`），不是 provider 名 |
| `QILIN_CONFIG_PATH` 环境变量 | **必须**指向 `config.yaml` 绝对/相对路径，不能依赖 cwd |
| `langgraph dev --allow-blocking` | `make_lead_agent` 含同步调用（os.getcwd 等），dev 模式必需；生产 `langgraph build` 不需要 |

### 手动调试 gateway（/v1/* 翻译层）

```bash
cd KCoder/python-runtime
source .venv/bin/activate
# 终端 1：启动 QiLin service
langgraph dev --port 19200 --host 127.0.0.1 --no-browser --allow-blocking
# 终端 2：启动 gateway
KCODER_GATEWAY_PORT=18900 python -m kcoder_gateway.main
```

健康检查：

```bash
curl http://127.0.0.1:18900/health
# => {"status":"ok","gateway_version":"0.2.0",...}
```

### 已知限制

- model 凭据（api_key）是占位符，真实调用需通过 KCoder model store 注入
- runtime-manager.ts 当前只 spawn `langgraph dev`，gateway 需手动启动（Phase 4 补齐）
- 首次 `pip install` 体积较大（约 1.5GB）；分发阶段用 PyInstaller 打包
- `mcp>=2.0.0` 与 `langchain-mcp-adapters` 不兼容，requirements.txt 已 pin `<2.0.0`

### 相关文档

- 可行性 spike 报告：`KCoder/spike-qilin/spike-report.md`
- 集成计划：`plans/kcoder-qilin-mvp_cb1815b4.md`

---

## English Version

### What This Is

KCoder's Electron main process (TypeScript) spawns an independent Python
subprocess via `app/main/qilin-runtime-manager.ts`, running the QiLin engine
(as a LangGraph Platform service). The subprocess listens on
`127.0.0.1:<port>`; KCoder's renderer calls it via HTTP/SSE.

### Directory Layout

See Chinese section above.

Note: `runtime-manager.ts` was moved to `app/main/qilin-runtime-manager.ts`
because it is Electron main-process code (subject to `app/tsconfig.json`'s
compile boundary).

### One-time Setup

```bash
cd KCoder/python-runtime
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

### Daily Development

Normal `pnpm dev` is enough — the Electron main process auto-spawns the
sidecar. No manual start needed.

Manual sidecar debugging:

```bash
cd KCoder/python-runtime
source .venv/bin/activate
langgraph dev --port 19200 --host 127.0.0.1 --no-browser --allow-blocking
```

### Key Configuration Notes

See Chinese section above.

### Manual Gateway Debugging (/v1/* translation layer)

```bash
cd KCoder/python-runtime
source .venv/bin/activate
# Terminal 1: start QiLin service
langgraph dev --port 19200 --host 127.0.0.1 --no-browser --allow-blocking
# Terminal 2: start gateway
KCODER_GATEWAY_PORT=18900 python -m kcoder_gateway.main
```

### Known Limitations

See Chinese section above.
