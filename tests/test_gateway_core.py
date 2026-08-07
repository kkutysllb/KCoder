"""Tests for gateway core helpers: pagination, checkpoint lineage, run models."""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.gateway.checkpoint_lineage import (
    CheckpointLineageIntegrityError,
    CheckpointParentMissingError,
    checkpoint_configurable,
    checkpoint_messages,
    checkpoint_metadata,
    find_checkpoint_before_message,
    find_checkpoint_before_message_chronologically,
    has_pending_tasks,
    is_duration_only_checkpoint,
)
from app.gateway.pagination import trim_run_message_page
from app.gateway.run_models import RunCreateRequest

# ---------------------------------------------------------------------------
# pagination
# ---------------------------------------------------------------------------


class TestPagination:
    def test_short_page_no_more(self) -> None:
        rows = [{"id": 1}, {"id": 2}]
        assert trim_run_message_page(rows, limit=5, after_seq=None) == (rows, False)

    def test_exact_limit_page_no_more(self) -> None:
        rows = [{"id": i} for i in range(3)]
        assert trim_run_message_page(rows, limit=3, after_seq=None) == (rows, False)

    def test_overflow_without_after_keeps_tail(self) -> None:
        rows = [{"id": i} for i in range(4)]
        out, has_more = trim_run_message_page(rows, limit=2, after_seq=None)
        assert has_more is True
        assert [r["id"] for r in out] == [2, 3]

    def test_overflow_with_after_keeps_head(self) -> None:
        rows = [{"id": i} for i in range(4)]
        out, has_more = trim_run_message_page(rows, limit=2, after_seq=1)
        assert has_more is True
        assert [r["id"] for r in out] == [0, 1]


# ---------------------------------------------------------------------------
# checkpoint lineage helpers
# ---------------------------------------------------------------------------


def _tuple(
    *,
    config: dict | None = None,
    metadata: dict | None = None,
    values: dict | None = None,
    next: list | None = None,
    parent_config: dict | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        config=config or {},
        metadata=metadata,
        values=values,
        next=next,
        parent_config=parent_config,
        checkpoint_exists=True,
    )


class TestLineageHelpers:
    def test_checkpoint_messages_from_values(self) -> None:
        t = _tuple(values={"messages": [{"id": "m1"}]})
        assert checkpoint_messages(t) == [{"id": "m1"}]

    def test_checkpoint_messages_falls_back_to_channel_values(self) -> None:
        t = SimpleNamespace(
            values=None,
            checkpoint={"channel_values": {"messages": [{"id": "m1"}]}},
            config={},
        )
        assert checkpoint_messages(t) == [{"id": "m1"}]

    def test_checkpoint_messages_empty_for_missing(self) -> None:
        assert checkpoint_messages(_tuple()) == []
        assert checkpoint_messages(SimpleNamespace(values=None, checkpoint=None, config={})) == []

    def test_checkpoint_configurable_extracts(self) -> None:
        t = _tuple(config={"configurable": {"thread_id": "t", "checkpoint_id": "c"}})
        assert checkpoint_configurable(t) == {"thread_id": "t", "checkpoint_id": "c"}

    def test_checkpoint_metadata_copy(self) -> None:
        t = _tuple(metadata={"writes": {"runtime_run_duration": 1.5}})
        assert checkpoint_metadata(t) == {"writes": {"runtime_run_duration": 1.5}}

    def test_is_duration_only_checkpoint(self) -> None:
        assert is_duration_only_checkpoint(
            _tuple(metadata={"writes": {"runtime_run_duration": 1.5}})
        )
        assert not is_duration_only_checkpoint(_tuple(metadata={"writes": {"other": 1}}))

    def test_has_pending_tasks(self) -> None:
        assert has_pending_tasks(_tuple(next=["node"]))
        assert not has_pending_tasks(_tuple(next=[]))
        assert not has_pending_tasks(_tuple())


# ---------------------------------------------------------------------------
# find_checkpoint_before_message (lineage walk)
# ---------------------------------------------------------------------------


class TestLineageWalk:
    def test_target_missing_from_head_raises(self) -> None:
        head = _tuple(values={"messages": [{"id": "m1"}]})
        with pytest.raises(CheckpointLineageIntegrityError):
            # Accessor never reached: the head check fails first.
            async def _noop(_config: dict) -> SimpleNamespace:
                raise AssertionError("accessor must not be called")

            import asyncio

            asyncio.run(
                find_checkpoint_before_message(_noop, head, "missing", max_depth=5)
            )

    def test_lineage_ends_before_target_raises(self) -> None:
        head = _tuple(
            values={"messages": [{"id": "m2"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "head"}},
            parent_config={"configurable": {"thread_id": "t", "checkpoint_id": "base"}},
        )
        # The parent still contains the target, so the walk continues and hits
        # its missing parent_config link.
        parent = _tuple(
            values={"messages": [{"id": "m1"}, {"id": "m2"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "base"}},
            parent_config=None,
        )

        async def _aget(_cfg: dict) -> SimpleNamespace:
            return parent

        accessor = SimpleNamespace(aget=_aget)
        import asyncio

        with pytest.raises(CheckpointParentMissingError):
            asyncio.run(
                find_checkpoint_before_message(accessor, head, "m2", max_depth=5)
            )

    def test_returns_checkpoint_before_target(self) -> None:
        import asyncio

        base = _tuple(
            values={"messages": [{"id": "m1"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "base"}},
            parent_config=None,
        )
        mid = _tuple(
            values={"messages": [{"id": "m1"}, {"id": "m2"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "mid"}},
            parent_config={"configurable": {"thread_id": "t", "checkpoint_id": "base"}},
        )
        head = _tuple(
            values={"messages": [{"id": "m1"}, {"id": "m2"}, {"id": "m3"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "head"}},
            parent_config={"configurable": {"thread_id": "t", "checkpoint_id": "mid"}},
        )
        by_id = {"head": head, "mid": mid, "base": base}

        async def _aget(config: dict) -> SimpleNamespace:
            return by_id[config["configurable"]["checkpoint_id"]]

        found = asyncio.run(
            find_checkpoint_before_message(SimpleNamespace(aget=_aget), head, "m3", max_depth=5)
        )
        # The first settled ancestor that no longer contains the target message.
        assert found is mid

    def test_skips_duration_only_and_pending_parents(self) -> None:
        import asyncio

        base = _tuple(
            values={"messages": [{"id": "m1"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "base"}},
            parent_config=None,
        )
        duration = _tuple(
            values={"messages": [{"id": "m1"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "dur"}},
            metadata={"writes": {"runtime_run_duration": 1.0}},
            parent_config={"configurable": {"thread_id": "t", "checkpoint_id": "base"}},
        )
        pending = _tuple(
            values={"messages": [{"id": "m1"}, {"id": "m2"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "pend"}},
            next=["worker"],
            parent_config={"configurable": {"thread_id": "t", "checkpoint_id": "dur"}},
        )
        head = _tuple(
            values={"messages": [{"id": "m1"}, {"id": "m2"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "head"}},
            parent_config={"configurable": {"thread_id": "t", "checkpoint_id": "pend"}},
        )
        by_id = {"head": head, "pend": pending, "dur": duration, "base": base}

        async def _aget(config: dict) -> SimpleNamespace:
            return by_id[config["configurable"]["checkpoint_id"]]

        found = asyncio.run(
            find_checkpoint_before_message(SimpleNamespace(aget=_aget), head, "m2", max_depth=5)
        )
        assert found is base

    def test_cycle_detected(self) -> None:
        import asyncio

        a = _tuple(
            values={"messages": [{"id": "m1"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "a"}},
            parent_config={"configurable": {"thread_id": "t", "checkpoint_id": "b"}},
        )
        b = _tuple(
            values={"messages": [{"id": "m1"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "b"}},
            parent_config={"configurable": {"thread_id": "t", "checkpoint_id": "a"}},
        )
        head = _tuple(
            values={"messages": [{"id": "m1"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "head"}},
            parent_config={"configurable": {"thread_id": "t", "checkpoint_id": "a"}},
        )
        by_id = {"head": head, "a": a, "b": b}

        async def _aget(config: dict) -> SimpleNamespace:
            return by_id[config["configurable"]["checkpoint_id"]]

        with pytest.raises(CheckpointLineageIntegrityError):
            asyncio.run(
                find_checkpoint_before_message(
                    SimpleNamespace(aget=_aget), head, "m1", max_depth=5
                )
            )

    def test_scan_limit_exceeded(self) -> None:
        import asyncio

        # A chain longer than max_depth where every node still contains the
        # target, forcing the walk to exhaust max_depth.
        chain: dict[str, SimpleNamespace] = {}
        for i in range(4):
            chain[f"c{i}"] = _tuple(
                values={"messages": [{"id": "m0"}, {"id": "m2"}]},
                config={"configurable": {"thread_id": "t", "checkpoint_id": f"c{i}"}},
                parent_config={"configurable": {"thread_id": "t", "checkpoint_id": f"c{i+1}"}},
            )
        head = _tuple(
            values={"messages": [{"id": "m0"}, {"id": "m2"}]},
            config={"configurable": {"thread_id": "t", "checkpoint_id": "head"}},
            parent_config={"configurable": {"thread_id": "t", "checkpoint_id": "c0"}},
        )

        async def _aget(config: dict) -> SimpleNamespace:
            return chain[config["configurable"]["checkpoint_id"]]

        with pytest.raises(CheckpointLineageIntegrityError):
            asyncio.run(
                find_checkpoint_before_message(
                    SimpleNamespace(aget=_aget), head, "m1", max_depth=2
                )
            )


# ---------------------------------------------------------------------------
# chronological fallback
# ---------------------------------------------------------------------------


class TestChronologicalFallback:
    def test_returns_previous_settled_checkpoint(self) -> None:
        # History is newest-first: c2 is the newest checkpoint.
        history = [
            _tuple(values={"messages": [{"id": "m1"}, {"id": "m2"}]}, config={"configurable": {"checkpoint_id": "c2"}}),
            _tuple(values={"messages": [{"id": "m1"}]}, config={"configurable": {"checkpoint_id": "c1"}}),
        ]
        base, found = find_checkpoint_before_message_chronologically(history, "m2")
        assert found is True
        assert checkpoint_configurable(base)["checkpoint_id"] == "c1"

    def test_skips_duration_only_and_pending(self) -> None:
        # History is newest-first.
        history = [
            _tuple(
                values={"messages": [{"id": "m1"}, {"id": "m2"}, {"id": "m3"}]},
                config={"configurable": {"checkpoint_id": "c3"}},
            ),
            _tuple(
                values={"messages": [{"id": "m1"}, {"id": "m2"}]},
                next=["worker"],
                config={"configurable": {"checkpoint_id": "pend"}},
            ),
            _tuple(
                values={"messages": [{"id": "m1"}]},
                metadata={"writes": {"runtime_run_duration": 1.0}},
                config={"configurable": {"checkpoint_id": "dur"}},
            ),
        ]
        base, found = find_checkpoint_before_message_chronologically(history, "m3")
        assert found is True
        assert base is None  # both earlier checkpoints are skipped

    def test_target_not_found(self) -> None:
        history = [
            _tuple(values={"messages": [{"id": "m1"}]}, config={"configurable": {"checkpoint_id": "c1"}})
        ]
        base, found = find_checkpoint_before_message_chronologically(history, "m9")
        assert (base, found) == (None, False)


# ---------------------------------------------------------------------------
# run models
# ---------------------------------------------------------------------------


class TestRunCreateRequest:
    def test_defaults(self) -> None:
        req = RunCreateRequest()
        assert req.stream_mode is None
        assert req.multitask_strategy == "reject"
        assert req.if_not_exists == "create"
        assert req.stream_resumable is None

    def test_rejects_extra_fields(self) -> None:
        with pytest.raises(ValidationError):
            RunCreateRequest(bogus_field=1)

    def test_rejects_non_default_webhook(self) -> None:
        with pytest.raises(ValidationError):
            RunCreateRequest(webhook="http://example.com/cb")

    def test_rejects_unsupported_multitask_strategy(self) -> None:
        with pytest.raises(ValidationError):
            RunCreateRequest(multitask_strategy="bogus")

    def test_accepts_supported_multitask_strategy(self) -> None:
        assert RunCreateRequest(multitask_strategy="rollback").multitask_strategy == "rollback"

    def test_rejects_unsupported_stream_mode(self) -> None:
        with pytest.raises(ValidationError):
            RunCreateRequest(stream_mode="bogus")

    def test_accepts_supported_stream_mode(self) -> None:
        assert RunCreateRequest(stream_mode="values").stream_mode == "values"

    def test_rejects_stream_resumable_true(self) -> None:
        with pytest.raises(ValidationError):
            RunCreateRequest(stream_resumable=True)

    def test_accepts_stream_resumable_false(self) -> None:
        assert RunCreateRequest(stream_resumable=False).stream_resumable is False

    def test_rejects_after_seconds(self) -> None:
        with pytest.raises(ValidationError):
            RunCreateRequest(after_seconds=30)

    def test_rejects_feedback_keys(self) -> None:
        with pytest.raises(ValidationError):
            RunCreateRequest(feedback_keys=["key"])
