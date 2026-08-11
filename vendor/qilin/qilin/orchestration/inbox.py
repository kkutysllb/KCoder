"""AgentInbox: async message bus for inter-agent communication.

每 agent 一个 ``asyncio.Queue``（点对点投递），外加订阅者回调表
（``subscribe`` 广播）。用于对等协作场景：agent 之间不直接持有对方
引用，而是通过收件箱解耦（见 :mod:`qilin.orchestration.patterns`）。

生命周期：``close()`` 之后 ``send`` 抛 :class:`HandoffError`，
``receive`` 立即返回 ``None``（优雅退出，不阻塞）。
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from qilin.orchestration.handoff import HandoffError

logger = logging.getLogger(__name__)


@dataclass
class AgentMessage:
    """A single message routed through the inbox.

    Attributes:
        from_agent: 发送方 agent 名称。
        to_agent: 接收方 agent 名称。
        content: 消息正文。
        context: 附加上下文（结构化载荷），发送方透传。
        timestamp: 投递时间（UTC）。
    """

    from_agent: str
    to_agent: str
    content: str
    context: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))


class AgentInbox:
    """Per-agent queues with point-to-point delivery and subscription.

    Attributes:
        agents: 可选初始注册列表（等价于逐个 ``register``）。
    """

    def __init__(self, agents: Iterable[str] | None = None) -> None:
        self._queues: dict[str, asyncio.Queue[AgentMessage]] = {}
        self._subscribers: dict[
            str, list[Callable[[AgentMessage], Awaitable[None] | None]]
        ] = {}
        self._closed = False
        if agents:
            for agent in agents:
                self.register(agent)

    def register(self, agent: str) -> None:
        """Register *agent* as a valid recipient.

        Raises:
            ValueError: 重复注册同一 agent。
        """
        if agent in self._queues:
            raise ValueError(f"Agent '{agent}' is already registered")
        self._queues[agent] = asyncio.Queue()
        self._subscribers[agent] = []

    def _require_recipient(self, agent: str) -> None:
        if agent not in self._queues:
            raise HandoffError(f"Unknown inbox recipient '{agent}'")

    async def send(
        self,
        from_agent: str,
        to_agent: str,
        message: str,
        *,
        context: dict[str, Any] | None = None,
    ) -> None:
        """Deliver *message* to *to_agent* and notify its subscribers.

        Raises:
            HandoffError: 收件人未注册，或 inbox 已关闭。
        """
        if self._closed:
            raise HandoffError("AgentInbox is closed")
        self._require_recipient(to_agent)

        msg = AgentMessage(
            from_agent=from_agent,
            to_agent=to_agent,
            content=message,
            context=context or {},
        )
        self._queues[to_agent].put_nowait(msg)

        for callback in list(self._subscribers[to_agent]):
            try:
                outcome = callback(msg)
                if inspect.isawaitable(outcome):
                    await outcome
            except Exception:
                # 订阅者隔离：单个坏回调不影响投递与其他订阅者。
                logger.exception(
                    "subscriber callback failed for message to %s", to_agent
                )

    async def receive(
        self, agent: str, timeout: float | None = None
    ) -> AgentMessage | None:
        """Pop the next pending message for *agent*.

        Args:
            timeout: 等待秒数；``None`` 表示无限阻塞。

        Returns:
            下一条消息；超时或 inbox 已关闭时返回 ``None``。
        """
        self._require_recipient(agent)
        if self._closed:
            return None
        queue = self._queues[agent]
        if timeout is None:
            return await queue.get()
        try:
            return await asyncio.wait_for(queue.get(), timeout)
        except TimeoutError:
            return None

    def pending(self, agent: str) -> int:
        """Number of unread messages queued for *agent*."""
        self._require_recipient(agent)
        return self._queues[agent].qsize()

    def subscribe(
        self, agent: str, callback: Callable[[AgentMessage], Awaitable[None] | None]
    ) -> None:
        """Register *callback* to be notified of every message to *agent*.

        回调同步或异步均可；异常被隔离，不影响投递与其他订阅者。
        """
        self._require_recipient(agent)
        self._subscribers[agent].append(callback)

    def close(self) -> None:
        """Close the inbox: forbid further sends, unblock receivers."""
        self._closed = True
