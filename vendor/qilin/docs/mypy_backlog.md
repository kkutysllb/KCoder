# mypy Backlog：agents / community / runtime

> 状态快照：2026-08-07（`mypy==2.3.0`，`python_version=3.12`，项目实际运行于 3.13）。

## 背景与进展

mypy 存量清理从 **525 errors / 76 files** 起步，分两阶段推进：

- **4b（已完成，241 errors 清零）**：除 `agents` / `community` / `runtime` 三大模块外的全部模块达到 0 error，并在 CI 中建立 **clean-module gate**（见 [.github/workflows/ci.yml](../.github/workflows/ci.yml)）锁定结果——门禁用 `mypy --follow-imports=silent` + 白名单目录，排除了三大模块的错误泄漏，白名单内模块任何新错误都会使 CI 失败。
- **4c（本文档）**：三大模块剩余 **284 errors / 49 files** 的 backlog 整理与清理路线图。

## 当前分布（284 errors / 49 files）

| 模块 | errors | 文件数 | 说明 |
|---|---|---|---|
| `qilin/agents` | 146 | 30 | middlewares 40 个文件占 118+，lead_agent 9，factory 6，thread_state 10，memory 3 |
| `qilin/community` | 83 | 12 | 搜索类工具（serper/brave/exa/tavily/fastcrw/infoquest/jina_ai）、aio_sandbox 7、url_safety 7 |
| `qilin/runtime` | 55 | 7 | runs/manager 24、journal 15、runs/worker 12、stream_bridge 2、goal/events/memory 各 1 |

### 文件级分布（按 error 数降序）

```
24  qilin/runtime/runs/manager.py
18  qilin/community/infoquest/tools.py
16  qilin/community/jina_ai/jina_client.py
15  qilin/runtime/journal.py
15  qilin/agents/middlewares/tool_result_meta.py
14  qilin/agents/middlewares/todo_middleware.py
12  qilin/runtime/runs/worker.py
11  qilin/agents/middlewares/token_usage_middleware.py
10  qilin/community/serper/tools.py
10  qilin/community/brave/tools.py
10  qilin/agents/thread_state.py
 9  qilin/agents/middlewares/tool_error_handling_middleware.py
 9  qilin/agents/middlewares/token_budget_middleware.py
 8  qilin/agents/lead_agent/agent.py
 7  qilin/community/url_safety.py
 7  qilin/community/aio_sandbox/aio_sandbox_provider.py
 7  qilin/agents/middlewares/summarization_middleware.py
 6  qilin/agents/middlewares/durable_context_middleware.py
 6  qilin/agents/factory.py
 5  qilin/community/{tavily,fastcrw,exa}/tools.py
 5  qilin/agents/middlewares/{title,clarification}_middleware.py
 4  qilin/agents/middlewares/input_sanitization_middleware.py
 3  qilin/agents/middlewares/{subagent_limit,skill_context,loop_detection,delegation_ledger,dangling_tool_call}_middleware.py
 2  qilin/agents/middlewares/{view_image,uploads,terminal_response,safety_finish_reason,read_before_write,dynamic_context}_middleware.py
 1  qilin/runtime/{stream_bridge/redis,stream_bridge/async_provider,goal,events/store/jsonl}.py
 1  qilin/agents/middlewares/{thread_data,system_message_coalescing,skill_tool_policy,skill_activation,sandbox_audit,memory}_middleware.py
 1  qilin/agents/{memory/backends/openviking,memory/backends/noop,lead_agent/prompt}.py
```

### 错误码分布与修复模式速查

| 错误码 | 数量 | 占比 | 典型场景与修复模式 |
|---|---|---|---|
| `arg-type` | 97 | 34% | `**dict[str, object]` 展开（httpx/模型构造）→ 注解为 `dict[str, Any]`；TypedDict 传 `dict[str, Any]` 参数 → 签名改 union + `cast`；Protocol 方法参数**逆变**（实现参数必须 ⊇ 声明） |
| `union-attr` | 60 | 21% | 属性是 `X \| None` 且未收窄 → 前置 `assert x is not None`（附注释说明不变量）；`(runtime.context or {}).get(...)` 空值合并 |
| `operator` | 27 | 10% | `key in x` / `x in y` 的右操作数为 Optional → `extra = x.model_extra if x is not None else None` 后判空 |
| `assignment` | 26 | 9% | `Any \| None` 赋给已推断的 `int` 变量 → 显式 `dict[str, Any]` 注解或 `cast` 在赋值表达式处（**赋值后 assert 无效**） |
| `override` | 17 | 6% | 中间件覆盖 `langchain.agents.middleware` 基类方法 → 参数类型须与基类泛型参数一致；`Runtime[Any]` 显式参数化（未参数化 `Runtime` 的 context 被推断为 `dict[Never, ...]`） |
| `attr-defined` | 12 | 4% | 静态类型无该属性（如 `BaseTool.func`）→ `getattr(tool, "func", None)` 提取 helper 或 `cast` |
| `type-arg` | 8 | 3% | 泛型类未参数化/参数化不完整 → 补类型参数 |
| `return-value` | 8 | 3% | 返回类型过窄（如 `list[expr]` vs `list[AST]`，list 不变性）→ 返回类型放宽到 `list[ast.expr]` |
| `var-annotated` | 7 | 2% | `for c: Any in ...` 是**非法语法**（PEP 526 不支持循环目标注解）→ 行尾 `# type: ignore[var-annotated]` |
| `misc` | 7 | 2% | lambda 类型推断失败 → 提取具名函数或显式 `cast` |
| `call-overload` | 5 | 2% | langgraph `StateGraph.add_node` 的 `NodeInputT` bound → `# type: ignore[call-overload]` + 注释 |
| `index` | 4 | 1% | `object` 不可下标 → `unwrap_sandbox` 这类 helper 返回类型改 `dict[str, Any] \| None` |
| `valid-type` / `typeddict-item` / `type-var` / `list-item` / `dict-item` | 7 | 2% | TypedDict 缺键 → 补 `NotRequired` 字段；`wait()` 收到 `Task \| None` → 先断言 |

## 清理路线图（建议顺序）

三个模块相互独立、互不阻塞；按"独立性强、模式重复度高、收益快"排序：

### 阶段 1：`qilin/runtime`（55 errors，7 文件）— 建议先行

核心执行路径已由 `tests/test_runtime_core.py` 覆盖，清理回归风险最低。

- 优先：`runs/manager.py`（24）——错误高度同质：`RunStore | None` 的 `union-attr`（`put`/`get`/`update_status`/`cancel` 等），以及 `Task[Any] | None`。多数可在方法开头对 `self._store` 做一次统一收窄或加 `_require_store()` 断言 helper，一次消灭 20+。
- 其次：`journal.py`（15）、`runs/worker.py`（12）。
- 收尾：`stream_bridge/*`（2）、`goal.py`（1）、`events/store/jsonl.py`（1）。
- 完成后把 `qilin/runtime`（或剩余文件清单）移入 CI 白名单。

### 阶段 2：`qilin/community`（83 errors，12 文件）— 模式高度重复

搜索类工具（serper/brave/exa/tavily/fastcrw/infoquest/jina_ai）结构几乎相同：`**kwargs` 展开、`model_extra` 判空、响应字段 `get`。**先修一个（建议 `serper/tools.py` 10 或 `infoquest/tools.py` 18），把修复模式固化为 checklist，再批量套用**。

- `jina_client.py`（16）：httpx `AsyncClient(**dict[str, object])` → 参数逐个显式传入或注解 `dict[str, Any]`。
- `url_safety.py`（7）、`aio_sandbox_provider.py`（7）：独立问题，可并行。
- 完成后把 `qilin/community` 移入 CI 白名单。

### 阶段 3：`qilin/agents`（146 errors，30 文件）— 最后攻坚

量最大、且与 langchain AgentMiddleware 泛型交互（`override` 17 处）。

- 模式一（`override`/`assignment`）：middleware 覆盖 `before_agent`/`abefore_agent`/`after_model` 等时，state 参数需与基类泛型 `AgentMiddleware[StateT]` 对齐——参考已清零的 `qilin/sandbox/middleware.py`（`Runtime[Any]` 参数化 + `SandboxMiddlewareState` 显式 schema）。
- 模式二（`union-attr`/`operator`）：middleware 访问 `AgentState`/`ThreadState` 时对 `NotRequired` 字段判空。
- 建议顺序：`tool_result_meta.py`（15）→ `todo_middleware.py`（14）→ `token_usage_middleware.py`（11）→ 其余 middlewares 按错误数递减；`thread_state.py`（10）与 `factory.py`（6）是公共依赖，早修早受益。
- 完成后把 `qilin/agents` 移入 CI 白名单，`docs/mypy_backlog.md` 归档为历史文档。

## CI 白名单维护

`.github/workflows/ci.yml` 中 `Type check (clean-module gate)` 步骤维护已清零模块清单：

1. 本地验证目标模块：`.venv/bin/mypy qilin/<module>` 输出 `Success`。
2. 将模块（或其中的文件）加入白名单命令。
3. 全量检查确认整体 error 数下降：`.venv/bin/mypy qilin 2>&1 | tail -1`。
4. 提交时附上错误数变化，便于追踪。

## 已验证的 4b 修复模式参考（来自已清零模块）

- TypedDict 与 `dict[str, Any]` 互转：函数签名 `dict[str, Any] | RunnableConfig` + 函数内 `cast`（`runtime/checkpoint_mode.py`、`tracing/metadata.py` 同款）。
- `str | None` 返回值必有值时：`cast(str, validate_agent_name(name))` 在赋值表达式处（`persistence/agents/file.py`）。
- 类方法名遮蔽 builtin（如 `list`）：模块级类型别名（`_AgentList = list[tuple[str, AgentConfig]]`）。
- `session.execute(update(...))` 无 rowcount：`cast(CursorResult[Any], result).rowcount`（`persistence/run/sql.py`）。
- `For c: Any in ...` 非法：`# type: ignore[var-annotated]`（`persistence/base.py`）。
- 状态 schema 缺键：`ThreadState` 补 `NotRequired` 字段（`agents/thread_state.py` 的 `thread_directories_created`）。
