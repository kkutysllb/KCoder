"""QiLin LangGraph Platform HTTP 客户端.

封装对内部 QiLin service（langgraph dev）的 HTTP 调用。gateway 的所有
/v1/* 端点都通过这个客户端与 QiLin 交互。

LangGraph Platform REST API 参考（spike 已验证可用）：
    GET  /ok                                     健康检查
    POST /threads                                创建 thread
    POST /threads/search                         列出 thread（注意是 POST，不是 GET）
    DELETE /threads/{id}                         删除 thread
    POST /threads/{id}/runs/stream               发起 run + SSE 流式响应
    POST /assistants/search                      查找 graph assistant

这个客户端只做 HTTP 通信，不做语义翻译——翻译在 sse.py / threads.py 里。
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger("kcoder_gateway.qilin_client")


class QiLinClient:
    """异步 HTTP 客户端，包装 LangGraph Platform REST API.

    生命周期由 main.py 的 lifespan 管理（启动创建、关闭清理）。
    """

    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        self._base_url = base_url.rstrip("/")
        # stream 用长 timeout，普通 REST 用 timeout
        #
        # trust_env=False 禁止 httpx 读取系统/环境代理。gateway → langgraph dev
        # 永远是 loopback 直连（127.0.0.1），绝不应走代理。在 macOS 上，若用户
        # 开了系统代理（如 Clash 的 7890 端口），Python 的 urllib.getproxies()
        # 不解析 scutil ExceptionsList 的通配符（如 127.*），导致 httpx 把
        # loopback 请求也发给代理，代理回 502。trust_env=False 彻底绕开。
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(timeout, read=None),  # read=None 让流不超时
            trust_env=False,
        )
        logger.info("QiLinClient initialized for %s", self._base_url)

    async def aclose(self) -> None:
        await self._client.aclose()
        logger.info("QiLinClient closed")

    @property
    def base_url(self) -> str:
        return self._base_url

    # ---------- 健康检查 ----------

    async def health(self) -> bool:
        """GET /ok → {"ok": true}."""
        try:
            r = await self._client.get("/ok")
            if r.status_code == 200:
                data = r.json()
                return bool(data.get("ok"))
        except httpx.HTTPError:
            pass
        return False

    # ---------- Thread 管理 ----------

    async def create_thread(self, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        """POST /threads → 创建 thread，返回 LangGraph thread 对象."""
        body = {"metadata": metadata or {}}
        r = await self._client.post("/threads", json=body)
        r.raise_for_status()
        return r.json()

    async def search_threads(self, limit: int = 200) -> list[dict[str, Any]]:
        """POST /threads/search → 列出 threads.

        LangGraph Platform 的 thread 列表是 POST /threads/search（不是 GET /threads，
        那会 405）。返回 thread 对象数组。
        """
        r = await self._client.post("/threads/search", json={"limit": limit})
        r.raise_for_status()
        return r.json()

    async def delete_thread(self, thread_id: str) -> bool:
        """DELETE /threads/{id} → 删除 thread."""
        r = await self._client.delete(f"/threads/{thread_id}")
        return r.status_code in (200, 204)

    async def get_thread(self, thread_id: str) -> dict[str, Any]:
        """GET /threads/{id} → 单个 thread 详情."""
        r = await self._client.get(f"/threads/{thread_id}")
        r.raise_for_status()
        return r.json()

    async def update_thread_metadata(self, thread_id: str, metadata: dict[str, Any]) -> dict[str, Any]:
        """PATCH /threads/{id} → 更新 thread metadata（合并式，不替换）.

        LangGraph Platform 的 Threads.patch 会把传入的 metadata 合并到现有
        metadata（而非整体替换），所以只传需要更新的字段即可，例如
        ``{"metadata": {"title": "新标题"}}`` 只改 title，保留 workspace/model 等。

        典型用途：首条用户消息后，根据消息内容把 title 从 "New Chat"
        更新为有意义的摘要。
        """
        r = await self._client.patch(f"/threads/{thread_id}", json={"metadata": metadata})
        r.raise_for_status()
        return r.json()

    # ---------- Assistant / Run ----------

    async def find_default_assistant(self, graph_id: str = "agent") -> str | None:
        """POST /assistants/search → 找 graph_id 对应的默认 assistant_id.

        langgraph dev 启动时会自动给每个 graph 建一个默认 assistant。
        """
        r = await self._client.post("/assistants/search", json={"graph_id": graph_id})
        r.raise_for_status()
        items = r.json()
        if not items:
            return None
        # 第一个就是默认 assistant（metadata.created_by == 'system'）
        return items[0].get("assistant_id")

    async def stream_run(
        self,
        thread_id: str,
        assistant_id: str,
        input_data: dict[str, Any],
        *,
        config: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        """POST /threads/{id}/runs/stream → 发起 run，返回 SSE 字节流.
    
        yield 原始 SSE 字节块（bytes）。调用方负责跨块缓冲并解析
        `event: xxx\n\ndata: {...}\n\n` 格式（见 sse.py 中的解析器）。
    
        stream_mode 说明：
          "messages" — 流式 AI 消息 token（AIMessageChunk），是 MVP 唯一必需的模式。
          LangGraph Platform 总是在 run 结束时 emit `event: end`（与 stream_mode 无关）。
    
        参考 spike 已验证的调用：
            POST /threads/{id}/runs/stream
            body: {
                "assistant_id": "...",
                "input": {"messages": [{"role":"user","content":"hello"}]},
                "stream_mode": ["messages"]
            }
        """
        body: dict[str, Any] = {
            "assistant_id": assistant_id,
            "input": input_data,
            "stream_mode": ["messages"],
        }
        if config:
            body["config"] = config
        if metadata:
            body["metadata"] = metadata

        # stream=True 让 httpx 不缓冲整个响应；我们逐块 yield
        async with self._client.stream(
            "POST", f"/threads/{thread_id}/runs/stream", json=body
        ) as response:
            if response.status_code != 200:
                body_text = await response.aread()
                logger.error(
                    "QiLin stream_run failed: %s %s",
                    response.status_code,
                    body_text[:500],
                )
                raise RuntimeError(
                    f"QiLin stream_run returned {response.status_code}"
                )
            async for chunk in response.aiter_bytes():
                if chunk:
                    yield chunk

    async def get_thread_state(self, thread_id: str) -> dict[str, Any]:
        """GET /threads/{id}/state → thread 的完整 state（含 messages 历史）.

        用于 GET /v1/threads/:id 时重建聊天历史。
        """
        r = await self._client.get(f"/threads/{thread_id}/state")
        if r.status_code == 404:
            return {"values": {"messages": []}}
        r.raise_for_status()
        return r.json()
