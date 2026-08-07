"""Unit tests for qilin.orchestration.inbox (AgentInbox message bus)."""

import pytest

from qilin.orchestration.handoff import HandoffError
from qilin.orchestration.inbox import AgentInbox, AgentMessage


class TestRegister:
    def test_register_and_lookup(self) -> None:
        inbox = AgentInbox(["lead", "coder"])

        assert inbox.pending("coder") == 0

    def test_duplicate_register_raises(self) -> None:
        inbox = AgentInbox(["coder"])

        with pytest.raises(ValueError, match="already registered"):
            inbox.register("coder")


class TestSendReceive:
    async def test_send_then_receive_delivers_message(self) -> None:
        inbox = AgentInbox(["lead", "coder"])
        await inbox.send("lead", "coder", "review this")

        msg = await inbox.receive("coder")

        assert isinstance(msg, AgentMessage)
        assert msg.from_agent == "lead"
        assert msg.to_agent == "coder"
        assert msg.content == "review this"

    async def test_send_to_unregistered_recipient_raises(self) -> None:
        inbox = AgentInbox(["lead"])

        with pytest.raises(HandoffError, match="Unknown inbox recipient 'coder'"):
            await inbox.send("lead", "coder", "hi")

    async def test_receive_timeout_returns_none(self) -> None:
        inbox = AgentInbox(["coder"])

        assert await inbox.receive("coder", timeout=0.05) is None

    async def test_receive_unknown_agent_raises(self) -> None:
        inbox = AgentInbox(["coder"])

        with pytest.raises(HandoffError, match="Unknown inbox recipient 'ghost'"):
            await inbox.receive("ghost")


class TestPending:
    async def test_pending_counts_unread_messages(self) -> None:
        inbox = AgentInbox(["coder"])
        await inbox.send("lead", "coder", "m1")
        await inbox.send("lead", "coder", "m2")

        assert inbox.pending("coder") == 2
        await inbox.receive("coder")
        assert inbox.pending("coder") == 1


class TestSubscribe:
    async def test_broadcasts_to_all_subscribers(self) -> None:
        inbox = AgentInbox(["lead", "coder"])
        received_async: list[AgentMessage] = []
        received_sync: list[AgentMessage] = []

        async def _async_cb(msg: AgentMessage) -> None:
            received_async.append(msg)

        def _sync_cb(msg: AgentMessage) -> None:
            received_sync.append(msg)

        inbox.subscribe("coder", _async_cb)
        inbox.subscribe("coder", _sync_cb)

        await inbox.send("lead", "coder", "hello")

        assert len(received_async) == 1
        assert len(received_sync) == 1
        assert received_async[0].content == "hello"
        assert received_sync[0].content == "hello"

    async def test_subscriber_error_does_not_block_others(self) -> None:
        inbox = AgentInbox(["lead", "coder"])
        received: list[AgentMessage] = []

        def _bad_cb(msg: AgentMessage) -> None:
            raise RuntimeError("boom")

        inbox.subscribe("coder", _bad_cb)
        inbox.subscribe("coder", lambda msg: received.append(msg))

        await inbox.send("lead", "coder", "hi")

        assert len(received) == 1

    def test_subscribe_unknown_agent_raises(self) -> None:
        inbox = AgentInbox(["coder"])

        with pytest.raises(HandoffError, match="Unknown inbox recipient 'ghost'"):
            inbox.subscribe("ghost", lambda msg: None)


class TestLifecycle:
    async def test_close_forbids_send(self) -> None:
        inbox = AgentInbox(["lead", "coder"])
        inbox.close()

        with pytest.raises(HandoffError, match="closed"):
            await inbox.send("lead", "coder", "hi")

    async def test_close_is_idempotent_and_receive_returns_none(self) -> None:
        inbox = AgentInbox(["coder"])
        inbox.close()
        inbox.close()

        assert await inbox.receive("coder") is None
