# subagents 模块（subagents module）

> QiLin engine · sub-agents subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.subagents` 把"启动一个 LangGraph 子图"封装成与 Lead Agent 完全同构的一等公民。子代理拥有独立 checkpoint、独立 callbacks、独立 token 计量、独立中间件链，并支持任意层级嵌套。

- **执行器**：`SubagentExecutor` 负责调度、取消、Token 统计、子代理 step 事件回报
- **注册中心**：`registry.py` 维护子代理名 → 配置的映射
- **配置解析**：`config.py` + `resolve_subagent_model_name()` 把 `name:model` 形式的 spec 解析为具体的 `ModelConfig`
- **内置子代理**：
  - `general_purpose`：通用 research / write 子代理
  - `bash_agent`：受 sandbox 隔离的 Bash 执行子代理
- **状态协议**：`status_contract.py` 与 `step_events.py` 标准化子代理状态机事件

### 关键文件

| 文件 | 作用 |
|------|------|
| `subagents/executor.py` | `SubagentExecutor` 主执行器 |
| `subagents/registry.py` | 子代理注册表 |
| `subagents/config.py` | 模型名解析 |
| `subagents/token_collector.py` | 子代理 Token 用量收集 |
| `subagents/status_contract.py` | 状态机契约常量 |
| `subagents/step_events.py` | Step 事件协议 |
| `subagents/builtins/general_purpose.py` | 内置通用子代理 |
| `subagents/builtins/bash_agent.py` | 内置 Bash 子代理 |

### 设计要点

1. **同构**：子代理使用与 Lead Agent 同样的 AgentFactory 构造，确保中间件行为一致。
2. **递归上限**：`max_depth` 来自配置；超出后抛出明确错误而非死循环。
3. **审批门控**：可对单个子代理启用 `require_human_approval`，由 `human_input` 模块触发交互。
4. **取消协议**：`CancelOutcome` 枚举子代理取消返回结果（已取消 / 部分完成 / 已回滚），上层可据此提示用户。
5. **Token 计量**：每个子代理使用独立的 `token_collector`，汇总后回写 Lead Agent 的 `token_usage`。

### 触发方式

通过内置工具触发：

```python
from qilin.tools.builtins.task_tool import task_tool
# task_tool 内部调用 SubagentExecutor
```

或通过 ACP 协议调用外部子代理：

```python
from qilin.tools.builtins.invoke_acp_agent_tool import build_invoke_acp_agent_tool
```

### 扩展入口

```python
# 注册自定义子代理
from qilin.subagents.registry import registry
from qilin.subagents.config import SubagentConfig

registry.register("my_agent", SubagentConfig(
    model="openai-gpt4",
    system_prompt="...",
    tools=[...],
))
```

---

## English Version

### Responsibility

`qilin.subagents` elevates "spawning a LangGraph subgraph" to a first-class citizen isomorphic with Lead Agent. Each sub-agent has independent checkpoint, callbacks, token accounting, middleware chain, and supports arbitrary depth nesting.

- **Executor** — `SubagentExecutor` handles scheduling, cancellation, token accounting, step-event reporting
- **Registry** — `registry.py` maintains name → config mapping
- **Config resolution** — `config.py` + `resolve_subagent_model_name()` resolve `name:model` specs
- **Built-in sub-agents** — `general_purpose` and `bash_agent`
- **Status protocol** — `status_contract.py` + `step_events.py` standardize state-machine events

### Key Files

| File | Purpose |
|------|---------|
| `subagents/executor.py` | `SubagentExecutor` main executor |
| `subagents/registry.py` | Sub-agent registry |
| `subagents/config.py` | Model name resolution |
| `subagents/token_collector.py` | Sub-agent token usage collection |
| `subagents/status_contract.py` | State-machine contract constants |
| `subagents/step_events.py` | Step event protocol |
| `subagents/builtins/general_purpose.py` | General-purpose sub-agent |
| `subagents/builtins/bash_agent.py` | Bash sub-agent |

### Design Highlights

1. **Isomorphism** — Sub-agents reuse the same AgentFactory, ensuring consistent middleware behavior.
2. **Recursion cap** — `max_depth` from config; explicit error rather than infinite recursion.
3. **Approval gating** — Per sub-agent `require_human_approval` flag, surfaced via `human_input`.
4. **Cancellation protocol** — `CancelOutcome` enumerates results (cancelled / partial / rolled back); the host can prompt the user accordingly.
5. **Token accounting** — Per sub-agent `token_collector` aggregates back into Lead Agent `token_usage`.

### Trigger Pattern

Via built-in tool:

```python
from qilin.tools.builtins.task_tool import task_tool
# task_tool internally invokes SubagentExecutor
```

Or via ACP for external sub-agents:

```python
from qilin.tools.builtins.invoke_acp_agent_tool import build_invoke_acp_agent_tool
```

### Extension Points

```python
from qilin.subagents.registry import registry
from qilin.subagents.config import SubagentConfig

registry.register("my_agent", SubagentConfig(
    model="openai-gpt4",
    system_prompt="...",
    tools=[...],
))
```
