# agents 模块（agents module）

> QiLin engine · agents subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.agents` 是 QiLin 的"大脑中枢"，承担所有智能体（Agent）的构造、配置、状态管理及与 LangGraph 的对接。它包含：

- **Lead Agent 工厂**：根据用户消息、`AppConfig`、环境变量构造 LangGraph Agent 实例
- **中间件链组装**：把循环检测、读取前置、Memory、工具进度状态机等中间件按顺序注入
- **线程状态模式**：`ThreadState` / `ThreadDataState` 是 LangGraph 状态 schema 的强类型抽象
- **记忆后端抽象**：`MemoryManager` ABC 提供统一接口，可插拔 qilinmem / mem0 / openviking / noop
- **目标状态机**：让 Agent 通过 `GoalState` 维护长任务的阶段性目标
- **人机协作**：通过 `human_input.py` 暴露审批接口
- **特性开关**：`features.py` 提供 LangGraph 中间件适配层

### 关键文件

| 文件 | 作用 |
|------|------|
| `agents/lead_agent/agent.py` | `build_middlewares()` 主工厂入口 |
| `agents/lead_agent/prompt.py` | 提示词模板、动态技能注入、Skill 缓存失效 |
| `agents/features.py` | 跨中间件特性开关与兼容性垫片 |
| `agents/thread_state.py` | 线程状态 schema 构造与归一化 |
| `agents/goal_state.py` | 长任务阶段性目标跟踪 |
| `agents/human_input.py` | 用户审批 / 反馈注入 |
| `agents/memory/` | 记忆子系统：后端抽象、检索索引 |
| `agents/memory/backends/qilinmem/` | 默认后端（事实抽取、合并、去重、检索） |
| `agents/memory/backends/mem0/` | Mem0 后端 |
| `agents/memory/backends/openviking/` | OpenViking 后端 |
| `agents/memory/backends/noop/` | 无记忆占位 |
| `agents/middlewares/` | 跨图中间件（MCP 路由、MemoryMiddleware 等） |

### 设计要点

1. **中间件顺序敏感**：所有 `AgentMiddleware` 的注册顺序在 `build_middlewares()` 中显式维护，新增中间件必须考虑与 `LoopDetectionMiddleware`、`ReadBeforeWriteMiddleware` 的相对顺序。
2. **动态系统提示词**：`prompt.py` 在每次构造 Agent 时重新评估技能清单和注入常量，避免 prompt 缓存陈旧。
3. **记忆 ABC 边界**：`MemoryManager` 只暴露 `add / search / get_context / warm / shutdown_flush / close` 等 tier-1/2/3 接口，事实抽取算法等私有实现放在 `qilinmem/`。
4. **后端发现机制**：`agents/memory/backends/` 下的文件夹名为后端 ID；`_scan_backends` 通过反射导入 `MANAGER_CLASS`。
5. **目标状态作为消息道**：GoalState 不参与 checkpoint，独立通道确保可以热重置而不丢失上下文。

### 扩展入口

```python
# 注册自定义后端：直接放进 agents/memory/backends/<name>/__init__.py
from .my_manager import MyManager
MANAGER_CLASS = MyManager
```

```python
# 注册自定义中间件：在 build_middlewares() 中插入
from langchain.agents.middleware import AgentMiddleware
class MyMiddleware(AgentMiddleware): ...
```

### 关联模块

- 上游：`config/` 提供 `AppConfig`，驱动 `build_middlewares`
- 下游：`runtime/runs/manager.py` 触发 Lead Agent 执行
- 横切：`tracing/` 上报 lead-agent 相关 trace

---

## English Version

### Responsibility

`qilin.agents` is the "brain hub" of QiLin: every agent — construction, configuration, state management, and LangGraph integration — lives here.

- **Lead Agent factory** — Build LangGraph agents from user messages, `AppConfig`, env vars
- **Middleware chain assembly** — Compose loop-detection, read-before-write, memory, tool-progress, etc.
- **Thread state schema** — `ThreadState` / `ThreadDataState` provide strongly-typed LangGraph state
- **Memory backend abstraction** — `MemoryManager` ABC; pluggable: `qilinmem` / `mem0` / `openviking` / `noop`
- **Goal state machine** — `GoalState` tracks staged goals for long-running tasks
- **Human-in-the-loop** — `human_input.py` exposes approval interfaces
- **Feature flags** — `features.py` provides LangGraph middleware compatibility shims

### Key Files

| File | Purpose |
|------|---------|
| `agents/lead_agent/agent.py` | `build_middlewares()` main factory |
| `agents/lead_agent/prompt.py` | Prompt template, dynamic skill injection, skill cache invalidation |
| `agents/features.py` | Cross-middleware feature flags & compat shims |
| `agents/thread_state.py` | Thread state schema normalization |
| `agents/goal_state.py` | Long-running task goal tracker |
| `agents/human_input.py` | User approval / feedback injection |
| `agents/memory/` | Memory subsystem: ABC + retrieval index |
| `agents/memory/backends/qilinmem/` | Default backend (fact extract / merge / dedup / retrieval) |
| `agents/memory/backends/mem0/` | Mem0 backend |
| `agents/memory/backends/openviking/` | OpenViking backend |
| `agents/memory/backends/noop/` | No-memory placeholder |
| `agents/middlewares/` | Cross-graph middlewares (MCP routing, MemoryMiddleware, etc.) |

### Design Highlights

1. **Middleware ordering is sensitive** — Order is explicit in `build_middlewares()`; new middleware must respect `LoopDetectionMiddleware` / `ReadBeforeWriteMiddleware` placement.
2. **Dynamic system prompt** — `prompt.py` re-evaluates skill inventory per build, avoiding stale prompt cache.
3. **Memory ABC boundary** — `MemoryManager` only exposes tier-1/2/3 methods (`add / search / get_context / warm / shutdown_flush / close`); private fact extraction lives in `qilinmem/`.
4. **Backend discovery** — Folder name under `agents/memory/backends/` is the backend id; `_scan_backends` imports `MANAGER_CLASS` by reflection.
5. **Goal state as a dedicated channel** — GoalState uses an independent channel so it can be hot-reset without losing context.

### Extension Points

```python
# Register a custom backend: drop into agents/memory/backends/<name>/__init__.py
from .my_manager import MyManager
MANAGER_CLASS = MyManager
```

```python
# Register a custom middleware: hook into build_middlewares()
from langchain.agents.middleware import AgentMiddleware
class MyMiddleware(AgentMiddleware): ...
```

### Related Modules

- **Upstream** — `config/` provides `AppConfig`, driving `build_middlewares`
- **Downstream** — `runtime/runs/manager.py` triggers Lead Agent execution
- **Cross-cutting** — `tracing/` reports lead-agent traces
