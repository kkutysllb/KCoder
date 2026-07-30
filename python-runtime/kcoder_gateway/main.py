"""KCoder QiLin Gateway — FastAPI translation layer.

Phase 2: 暴露 KCoder renderer 的 /v1/* API 契约，翻译到 QiLin LangGraph
Platform REST API。核心 5 个端点（建会话/列表/删除/发消息/SSE 流式）由
threads.py 实现，SSE 翻译由 sse.py 实现。

启动时 lifespan 创建 QiLinClient 并缓存 default assistant_id。
The gateway binds 127.0.0.1 only and is never exposed to the network.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import init_auth_state
from .auth import router as auth_router
from .commands_routes import router as commands_router
from .mcp_routes import router as mcp_router
from .memory_routes import router as memory_router
from .plugins_routes import router as plugins_router
from .qilin_client import QiLinClient
from .skills_routes import router as skills_router
from .sse import RunRegistry
from .stubs import (
    approvals_router,
    attachments_router,
    engine_router,
    thread_extras_router,
)
from .sub_agents_routes import router as sub_agents_router
from .threads import router as threads_router
from .workspace_routes import router as workspace_router

logger = logging.getLogger("kcoder_gateway")

_GATEWAY_VERSION = "0.2.0"
_QILIN_SERVICE_URL = os.environ.get("QILIN_SERVICE_URL", "http://127.0.0.1:19200")
_ASSISTANT_GRAPH_ID = os.environ.get("QILIN_GRAPH_ID", "agent")

# CORS: 开发模式下 renderer 由 electron-vite dev server 提供（默认
# http://localhost:5173）。浏览器对跨 origin 的 fetch 严格执行 CORS
# preflight。gateway 仅 bind 127.0.0.1，放开 loopback 的任意端口安全。
_CORS_ORIGIN_REGEX = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"


async def _init_db_and_auth(app: FastAPI) -> None:
    """Phase 6: 初始化 QiLin DB engine + auth 子系统.

    QiLin DB 的 schema bootstrap 由 ``init_engine_from_config`` 内部完成
    （它会调 ``bootstrap_schema`` 创建 users 等表）。auth 子系统需要
    session_factory 来操作 UserRow。

    失败不阻塞 gateway 启动：auth 端点会返回 503，但 threads 等核心
    端点仍可用（langgraph dev 进程已有自己的 DB 连接）。
    """
    try:
        from qilin.config.app_config import get_app_config
        # 注意：直接从 engine 子模块导入。QiLin v1.0.0 的
        # persistence/__init__.py 的 __all__ 未导出 init_engine_from_config
        # （上游 bug），但函数本身定义在 engine.py。从子模块导入可绕过
        # __all__ 限制，且不修改 vendored 源码。
        from qilin.persistence.engine import init_engine_from_config

        config = get_app_config()
        await init_engine_from_config(config.database)
        logger.info(
            "QiLin DB initialized: backend=%s", config.database.backend
        )

        # JWT secret 持久化在 runtime 目录（与 sqlite DB 同级）
        runtime_dir = Path(__file__).resolve().parent.parent
        user_repo, jwt_secret = await init_auth_state(runtime_dir)
        app.state.user_repo = user_repo
        app.state.jwt_secret = jwt_secret
    except Exception:
        logger.exception(
            "Failed to initialize DB/auth subsystem (non-fatal — "
            "auth endpoints will return 503)"
        )


async def _close_db() -> None:
    """Phase 6: 关闭 QiLin DB engine（释放连接池）."""
    try:
        from qilin.persistence import close_engine

        await close_engine()
    except Exception:
        logger.debug("close_engine failed (non-fatal)", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan — 初始化 QiLinClient + RunRegistry + 缓存 assistant_id.

    QiLinClient 和 RunRegistry 存入 app.state，供 threads.py 的路由使用。
    assistant_id 在启动时从 LangGraph Platform 查询并缓存（避免每个 turn 都查）。
    """
    logger.info("kcoder_gateway starting (version=%s)", _GATEWAY_VERSION)
    logger.info("Upstream QiLin service: %s", _QILIN_SERVICE_URL)

    client = QiLinClient(_QILIN_SERVICE_URL)
    app.state.qilin_client = client
    app.state.run_registry = RunRegistry()
    app.state.assistant_id = None
    # Phase 13: 本地存储根目录（plugins/sub_agents/commands/skills_drafts 落盘处）
    runtime_dir = Path(__file__).resolve().parent.parent
    app.state.data_dir = str(runtime_dir)

    # Phase 6: 初始化 DB + auth（失败不阻塞，auth 端点降级为 503）
    app.state.user_repo = None
    app.state.jwt_secret = ""
    await _init_db_and_auth(app)

    # 尝试查询 default assistant_id（失败不阻塞启动，turns 端点会报 503）
    if await client.health():
        try:
            assistant_id = await client.find_default_assistant(_ASSISTANT_GRAPH_ID)
            if assistant_id:
                app.state.assistant_id = assistant_id
                logger.info("Default assistant cached: %s", assistant_id)
            else:
                logger.warning(
                    "No assistant found for graph_id='%s' — turns will 503",
                    _ASSISTANT_GRAPH_ID,
                )
        except Exception:
            logger.exception("Failed to query default assistant (non-fatal)")
    else:
        logger.warning(
            "QiLin service not healthy at startup — will retry on first turn"
        )

    yield

    logger.info("kcoder_gateway shutting down")
    await _close_db()
    await client.aclose()


def create_app() -> FastAPI:
    """Build the FastAPI app. Kept as a factory so tests can construct it."""
    app = FastAPI(
        title="KCoder QiLin Gateway",
        version=_GATEWAY_VERSION,
        description=(
            "Translation layer that exposes KCoder's existing /v1/* HTTP API "
            "contract on top of the QiLin agent engine (LangGraph Platform)."
        ),
        lifespan=lifespan,
    )

    # user_id 解析 middleware：每个请求从 Bearer token 解析用户 id 并存到
    # request.state.user_id，供 memory/skills 等端点同步读取。
    @app.middleware("http")
    async def _resolve_user_id_middleware(request, call_next):
        resolved_id = ""
        try:
            from .auth.middleware import get_current_user

            user = await get_current_user(request)
            if user is not None:
                resolved_id = str(getattr(user, "id", "") or "")
        except Exception:
            logger.debug("user_id resolution failed (non-fatal)", exc_info=True)
        request.state.user_id = resolved_id
        return await call_next(request)

    # /v1/threads 核心 CRUD + turns + events（threads.py）
    app.include_router(threads_router)

    # auth: Phase 6 真实实现（其余仍为 Phase 5 stub，后续阶段逐步替换）
    app.include_router(auth_router)
    app.include_router(memory_router)  # Phase 10 真实对接 QiLin MemoryManager
    app.include_router(attachments_router)  # stub（后续阶段替换）
    app.include_router(workspace_router)  # Phase 7 真实 git status
    app.include_router(skills_router)  # Phase 11 真实对接 QiLin SkillStorage
    app.include_router(mcp_router)  # Phase 12 真实对接 QiLin ExtensionsConfig
    app.include_router(plugins_router)  # Phase 13 本地 plugins.json
    app.include_router(sub_agents_router)  # Phase 13 本地 sub_agents.json
    app.include_router(commands_router)  # Phase 13 本地 commands.json
    app.include_router(engine_router)
    app.include_router(approvals_router)
    app.include_router(thread_extras_router)

    @app.get("/health")
    async def health() -> JSONResponse:
        """Liveness probe used by runtime-manager.ts during sidecar boot.

        Returns 200 once the gateway process can accept connections. The
        upstream QiLin service health is checked separately by the manager
        via `GET /ok` on the LangGraph port.
        """
        return JSONResponse(
            {
                "status": "ok",
                "gateway_version": _GATEWAY_VERSION,
                "qilin_service_url": _QILIN_SERVICE_URL,
            }
        )

    # CORS 必须在中间件栈最外层（FastAPI 中间件 LIFO：后 add 先执行）。
    # 这样 OPTIONS preflight 在此直接返回，不进入 user_id 解析等内层。
    # 用 regex 覆盖 loopback 任意端口，兼容 electron-vite/纯浏览器调试。
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=_CORS_ORIGIN_REGEX,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    return app


# When launched via `python -m kcoder_gateway.main`, run under uvicorn.
# The host/port are injected by runtime-manager.ts via argv or env vars;
# defaults match the dev fallback so `python -m kcoder_gateway.main` works
# for manual debugging.
def _parse_bind_args() -> tuple[str, int]:
    """Resolve host/port from KCODER_GATEWAY_HOST / KCODER_GATEWAY_PORT."""
    host = os.environ.get("KCODER_GATEWAY_HOST", "127.0.0.1")
    port = int(os.environ.get("KCODER_GATEWAY_PORT", "18900"))
    return host, port


def _ensure_extensions_config(runtime_dir: Path) -> None:
    """生成 extensions_config.json，注册 worktree-overlay MCP server.

    QiLin 通过 ExtensionsConfig（QILIN_EXTENSIONS_CONFIG_PATH）加载 MCP servers。
    MCP server 的 path 必须是绝对路径——mcp-server.ts 用
    ``import.meta.url === file://${process.argv[1]}`` 判断是否为直接运行。

    worktree-overlay 编译产物位于::

        <kcoder_root>/overlays/worktree-overlay/dist/mcp-server.js

    我们从 gateway 模块位置反推 kcoder_root，确保跨机器可移植。

    注意：QiLin 懒加载 extensions config（首次 Agent 构造时），所以即使
    gateway 在 LangGraph service 之后启动，文件也能在第一次 turn 前就绪。
    """
    kcoder_root = runtime_dir.parent
    mcp_server_js = (
        kcoder_root / "overlays" / "worktree-overlay" / "dist" / "mcp-server.js"
    )

    if not mcp_server_js.exists():
        logger.warning(
            "worktree-overlay mcp-server.js not found at %s — git worktree MCP tools disabled",
            mcp_server_js,
        )
        return

    config = {
        "mcpServers": {
            "git-worktree": {
                "type": "stdio",
                "command": "node",
                "args": [str(mcp_server_js)],
                "description": "Git worktree operations for parallel agent branches (create/list/remove/merge)",
            }
        }
    }

    config_file = runtime_dir / "extensions_config.json"
    config_file.write_text(json.dumps(config, indent=2), encoding="utf-8")

    os.environ.setdefault("QILIN_EXTENSIONS_CONFIG_PATH", str(config_file))
    logger.info(
        "Extensions config written: %s (git-worktree MCP: %s)",
        config_file,
        mcp_server_js,
    )


def main() -> None:
    """Entry point for `python -m kcoder_gateway.main`."""
    logging.basicConfig(
        level=os.environ.get("KCODER_GATEWAY_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s [kcoder-gateway] %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )

    # Ensure QiLin can find config.yaml regardless of cwd.
    runtime_dir = Path(__file__).resolve().parent.parent
    config_path = os.environ.get("QILIN_CONFIG_PATH") or str(runtime_dir / "config.yaml")
    if Path(config_path).exists():
        os.environ.setdefault("QILIN_CONFIG_PATH", config_path)
        logger.info("QiLin config path: %s", config_path)
    else:
        logger.warning("QiLin config.yaml not found at %s", config_path)

    # Phase 3: 生成 extensions_config.json（worktree-overlay MCP 注册）
    _ensure_extensions_config(runtime_dir)

    host, port = _parse_bind_args()
    logger.info("Starting kcoder_gateway on %s:%s", host, port)

    import uvicorn

    uvicorn.run(
        "kcoder_gateway.main:create_app",
        factory=True,
        host=host,
        port=port,
        log_level="warning",  # let our handler above control gateway logs
        access_log=False,
    )


if __name__ == "__main__":
    main()
