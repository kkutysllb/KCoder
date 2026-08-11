"""Tests for run event stores: in-memory and JSONL-backed implementations."""

from pathlib import Path

import pytest

from qilin.runtime.events.store.jsonl import JsonlRunEventStore
from qilin.runtime.events.store.memory import MemoryRunEventStore

THREAD = "t-1"
RUN_A = "run-a"
RUN_B = "run-b"


def _msg(store, run_id: str, text: str, *, seq_slot: int | None = None):
    return store.put(
        thread_id=THREAD,
        run_id=run_id,
        event_type="ai_message",
        category="message",
        content=text,
        metadata={"caller": "agent"},
    )


def _trace(store, run_id: str, event_type: str = "tool.start"):
    return store.put(
        thread_id=THREAD,
        run_id=run_id,
        event_type=event_type,
        category="trace",
        content={"tool": "bash"},
    )


# ---------------------------------------------------------------------------
# MemoryRunEventStore
# ---------------------------------------------------------------------------


class TestMemoryStore:
    async def test_put_returns_full_envelope_with_increasing_seq(self) -> None:
        store = MemoryRunEventStore()
        first = await store.put(
            thread_id=THREAD, run_id=RUN_A, event_type="run.start", category="lifecycle"
        )
        second = await store.put(
            thread_id=THREAD, run_id=RUN_A, event_type="ai_message", category="message"
        )
        assert first["seq"] == 1
        assert second["seq"] == 2
        for key in ("thread_id", "run_id", "event_type", "category", "content", "metadata", "seq", "created_at"):
            assert key in first
        assert first["thread_id"] == THREAD
        assert first["run_id"] == RUN_A

    async def test_put_batch_assigns_sequential_seqs(self) -> None:
        store = MemoryRunEventStore()
        records = await store.put_batch(
            [
                {"thread_id": THREAD, "run_id": RUN_A, "event_type": "a", "category": "message"},
                {"thread_id": THREAD, "run_id": RUN_A, "event_type": "b", "category": "message"},
            ]
        )
        assert [r["seq"] for r in records] == [1, 2]

    async def test_list_messages_filters_non_message_categories(self) -> None:
        store = MemoryRunEventStore()
        await _msg(store, RUN_A, "hi")
        await _trace(store, RUN_A)
        await _msg(store, RUN_A, "hello")
        messages = await store.list_messages(THREAD)
        assert [m["content"] for m in messages] == ["hi", "hello"]

    async def test_list_messages_without_cursor_returns_latest_limit(self) -> None:
        store = MemoryRunEventStore()
        for i in range(5):
            await _msg(store, RUN_A, f"m{i}")
        assert [m["content"] for m in await store.list_messages(THREAD, limit=2)] == ["m3", "m4"]
        assert len(await store.list_messages(THREAD, limit=50)) == 5

    async def test_list_messages_before_seq_returns_tail_page(self) -> None:
        store = MemoryRunEventStore()
        for i in range(5):
            await _msg(store, RUN_A, f"m{i}")
        page = await store.list_messages(THREAD, limit=2, before_seq=5)
        assert [m["content"] for m in page] == ["m2", "m3"]
        assert [m["seq"] for m in page] == [3, 4]

    async def test_list_messages_after_seq_returns_head_page(self) -> None:
        store = MemoryRunEventStore()
        for i in range(5):
            await _msg(store, RUN_A, f"m{i}")
        page = await store.list_messages(THREAD, limit=2, after_seq=1)
        assert [m["content"] for m in page] == ["m1", "m2"]

    async def test_list_events_scoped_to_run_and_sorted(self) -> None:
        store = MemoryRunEventStore()
        await _msg(store, RUN_A, "a1")
        await _msg(store, RUN_B, "b1")
        await _trace(store, RUN_A, "tool.start")
        await _msg(store, RUN_A, "a2")
        events = await store.list_events(THREAD, RUN_A)
        assert [e["event_type"] for e in events] == ["ai_message", "tool.start", "ai_message"]

    async def test_list_events_filters_by_event_types(self) -> None:
        store = MemoryRunEventStore()
        await _trace(store, RUN_A, "tool.start")
        await _msg(store, RUN_A, "a1")
        events = await store.list_events(THREAD, RUN_A, event_types=["ai_message"])
        assert [e["event_type"] for e in events] == ["ai_message"]

    async def test_list_events_filters_by_task_id(self) -> None:
        store = MemoryRunEventStore()
        await store.put(
            thread_id=THREAD,
            run_id=RUN_A,
            event_type="tool.start",
            category="trace",
            metadata={"task_id": "task.a"},
        )
        await store.put(
            thread_id=THREAD,
            run_id=RUN_A,
            event_type="tool.result",
            category="trace",
            metadata={"task_id": "task.b"},
        )
        events = await store.list_events(THREAD, RUN_A, task_id="task.b")
        assert [e["event_type"] for e in events] == ["tool.result"]
        # Unfiltered listing keeps both.
        assert len(await store.list_events(THREAD, RUN_A)) == 2

    async def test_list_events_after_seq_cursor_pages(self) -> None:
        store = MemoryRunEventStore()
        for i in range(4):
            await _msg(store, RUN_A, f"m{i}")
        page = await store.list_events(THREAD, RUN_A, limit=2, after_seq=1)
        assert [e["seq"] for e in page] == [2, 3]
        # Filtering happens before limit so a small page survives run-wide limit.
        page2 = await store.list_events(THREAD, RUN_A, limit=1, after_seq=3)
        assert [e["seq"] for e in page2] == [4]

    async def test_list_messages_by_run_scoped(self) -> None:
        store = MemoryRunEventStore()
        await _msg(store, RUN_A, "a1")
        await _msg(store, RUN_B, "b1")
        await _msg(store, RUN_A, "a2")
        assert [m["content"] for m in await store.list_messages_by_run(THREAD, RUN_A)] == [
            "a1",
            "a2",
        ]

    async def test_list_messages_by_run_bidirectional_cursors(self) -> None:
        store = MemoryRunEventStore()
        for i in range(4):
            await _msg(store, RUN_A, f"m{i}")
        tail = await store.list_messages_by_run(THREAD, RUN_A, limit=2, before_seq=4)
        assert [m["seq"] for m in tail] == [2, 3]
        head = await store.list_messages_by_run(THREAD, RUN_A, limit=2, after_seq=1)
        assert [m["seq"] for m in head] == [2, 3]

    async def test_put_if_absent_creates_once_and_returns_existing(self) -> None:
        store = MemoryRunEventStore()
        record, created = await store.put_if_absent(
            thread_id=THREAD, run_id=RUN_A, event_type="run.end", category="lifecycle"
        )
        assert created is True
        again, created = await store.put_if_absent(
            thread_id=THREAD, run_id=RUN_A, event_type="run.end", category="lifecycle"
        )
        assert created is False
        assert again["seq"] == record["seq"]
        # Different run may still write the same event type.
        other, created = await store.put_if_absent(
            thread_id=THREAD, run_id=RUN_B, event_type="run.end", category="lifecycle"
        )
        assert created is True
        assert other["seq"] == 2

    async def test_get_last_visible_ai_seq_skips_middleware(self) -> None:
        store = MemoryRunEventStore()
        await store.put(
            thread_id=THREAD,
            run_id=RUN_A,
            event_type="llm.ai.response",
            category="message",
            metadata={"caller": "middleware:guardrail"},
        )
        await _msg(store, RUN_A, "real answer")
        result = await store.get_last_visible_ai_seq_by_run(THREAD, {RUN_A})
        assert result == {RUN_A: 2}

    async def test_get_last_visible_ai_seq_ignores_non_ai_events(self) -> None:
        store = MemoryRunEventStore()
        await store.put(
            thread_id=THREAD, run_id=RUN_A, event_type="human_message", category="message"
        )
        await store.put(
            thread_id=THREAD, run_id=RUN_A, event_type="tool.result", category="message"
        )
        assert await store.get_last_visible_ai_seq_by_run(THREAD, {RUN_A}) == {}

    async def test_count_messages_only_message_category(self) -> None:
        store = MemoryRunEventStore()
        await _msg(store, RUN_A, "a")
        await _trace(store, RUN_A)
        await _msg(store, RUN_A, "b")
        assert await store.count_messages(THREAD) == 2

    async def test_delete_by_run_removes_events_and_updates_projections(self) -> None:
        store = MemoryRunEventStore()
        await _msg(store, RUN_A, "a1")
        await _msg(store, RUN_B, "b1")
        await _trace(store, RUN_A)
        assert await store.delete_by_run(THREAD, RUN_A) == 2
        assert await store.list_events(THREAD, RUN_A) == []
        assert [m["content"] for m in await store.list_messages(THREAD)] == ["b1"]
        assert await store.count_messages(THREAD) == 1

    async def test_delete_by_thread_removes_everything(self) -> None:
        store = MemoryRunEventStore()
        await _msg(store, RUN_A, "a1")
        await _trace(store, RUN_B)
        assert await store.delete_by_thread(THREAD) == 2
        assert await store.list_messages(THREAD) == []
        assert await store.count_messages(THREAD) == 0
        # seq counter resets for a fresh thread lifecycle
        await _msg(store, RUN_A, "again")
        assert (await store.list_messages(THREAD))[0]["seq"] == 1

    async def test_unknown_thread_is_empty(self) -> None:
        store = MemoryRunEventStore()
        assert await store.list_messages("missing") == []
        assert await store.list_events("missing", RUN_A) == []
        assert await store.count_messages("missing") == 0
        assert await store.delete_by_thread("missing") == 0


# ---------------------------------------------------------------------------
# JsonlRunEventStore
# ---------------------------------------------------------------------------


@pytest.fixture()
def jsonl_store(tmp_path: Path) -> JsonlRunEventStore:
    return JsonlRunEventStore(tmp_path)


class TestJsonlStore:
    async def test_put_persists_and_new_instance_continues_seq(self, tmp_path: Path) -> None:
        first = JsonlRunEventStore(tmp_path)
        await _msg(first, RUN_A, "hello")
        second = JsonlRunEventStore(tmp_path)
        record = await second.put(
            thread_id=THREAD, run_id=RUN_A, event_type="ai_message", category="message"
        )
        assert record["seq"] == 2
        messages = await second.list_messages(THREAD)
        assert [m["content"] for m in messages] == ["hello", ""]
        assert [m["seq"] for m in messages] == [1, 2]

    async def test_file_layout_threads_runs(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        await _msg(store, RUN_A, "hi")
        assert (tmp_path / "threads" / THREAD / "runs" / f"{RUN_A}.jsonl").exists()

    async def test_put_batch_single_file_append(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        records = await store.put_batch(
            [
                {"thread_id": THREAD, "run_id": RUN_A, "event_type": "a", "category": "message"},
                {"thread_id": THREAD, "run_id": RUN_A, "event_type": "b", "category": "trace"},
            ]
        )
        assert [r["seq"] for r in records] == [1, 2]
        # A reload sees both records in one file.
        reloaded = JsonlRunEventStore(tmp_path)
        assert len(await reloaded.list_events(THREAD, RUN_A)) == 2

    async def test_put_batch_empty_returns_empty(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        assert await store.put_batch([]) == []

    async def test_put_if_absent_is_idempotent_across_instances(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        record, created = await store.put_if_absent(
            thread_id=THREAD, run_id=RUN_A, event_type="run.end", category="lifecycle"
        )
        assert created is True
        # A brand-new store re-reads the file and must not duplicate.
        reloaded = JsonlRunEventStore(tmp_path)
        again, created = await reloaded.put_if_absent(
            thread_id=THREAD, run_id=RUN_A, event_type="run.end", category="lifecycle"
        )
        assert created is False
        assert again["seq"] == record["seq"]

    async def test_list_messages_cross_run_global_seq_order(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        await _msg(store, RUN_A, "a1")
        await _msg(store, RUN_B, "b1")
        await _msg(store, RUN_A, "a2")
        messages = await store.list_messages(THREAD)
        assert [m["content"] for m in messages] == ["a1", "b1", "a2"]
        assert [m["seq"] for m in messages] == [1, 2, 3]

    async def test_list_messages_cursor_pagination(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        for i in range(4):
            await _msg(store, RUN_A, f"m{i}")
        tail = await store.list_messages(THREAD, limit=2, before_seq=4)
        assert [m["seq"] for m in tail] == [2, 3]
        head = await store.list_messages(THREAD, limit=2, after_seq=1)
        assert [m["seq"] for m in head] == [2, 3]

    async def test_malformed_lines_are_skipped(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "threads" / THREAD / "runs"
        run_dir.mkdir(parents=True)
        (run_dir / f"{RUN_A}.jsonl").write_text(
            '{"seq": 1, "thread_id": "t-1", "run_id": "run-a", "event_type": "x", '
            '"category": "message", "content": "ok", "metadata": {}, "created_at": "c"}\n'
            "this is not json\n"
            '{"seq": 3, "thread_id": "t-1", "run_id": "run-a", "event_type": "y", '
            '"category": "message", "content": "ok2", "metadata": {}, "created_at": "c"}\n',
            encoding="utf-8",
        )
        store = JsonlRunEventStore(tmp_path)
        messages = await store.list_messages(THREAD)
        assert [m["seq"] for m in messages] == [1, 3]
        # seq counter resumes from the largest surviving record
        record = await store.put(
            thread_id=THREAD, run_id=RUN_A, event_type="z", category="message"
        )
        assert record["seq"] == 4

    async def test_list_events_filters_and_cursor(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        for i in range(4):
            await _msg(store, RUN_A, f"m{i}")
        events = await store.list_events(THREAD, RUN_A, limit=2, after_seq=1)
        assert [e["seq"] for e in events] == [2, 3]

    async def test_delete_by_run_removes_file(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        await _msg(store, RUN_A, "a1")
        await _msg(store, RUN_B, "b1")
        assert await store.delete_by_run(THREAD, RUN_A) == 1
        assert not (tmp_path / "threads" / THREAD / "runs" / f"{RUN_A}.jsonl").exists()
        assert await store.list_events(THREAD, RUN_A) == []
        assert [m["content"] for m in await store.list_messages(THREAD)] == ["b1"]

    async def test_delete_by_thread_removes_all_files(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        await _msg(store, RUN_A, "a1")
        await _trace(store, RUN_B)
        assert await store.delete_by_thread(THREAD) == 2
        assert list((tmp_path / "threads" / THREAD / "runs").glob("*.jsonl")) == []
        # A fresh instance sees nothing.
        reloaded = JsonlRunEventStore(tmp_path)
        assert await reloaded.count_messages(THREAD) == 0

    async def test_invalid_ids_rejected(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        with pytest.raises(ValueError, match="thread_id"):
            await store.put(thread_id="bad/id", run_id=RUN_A, event_type="x", category="trace")
        with pytest.raises(ValueError, match="run_id"):
            await store.put(thread_id=THREAD, run_id="bad run", event_type="x", category="trace")

    async def test_missing_run_file_returns_empty(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        assert await store.list_events(THREAD, "ghost") == []
        assert await store.get_last_visible_ai_seq_by_run(THREAD, {"ghost"}) == {}

    async def test_get_last_visible_ai_seq_after_reload(self, tmp_path: Path) -> None:
        store = JsonlRunEventStore(tmp_path)
        await store.put(
            thread_id=THREAD,
            run_id=RUN_A,
            event_type="llm.ai.response",
            category="message",
            metadata={"caller": "middleware:guardrail"},
        )
        await _msg(store, RUN_A, "real")
        reloaded = JsonlRunEventStore(tmp_path)
        assert await reloaded.get_last_visible_ai_seq_by_run(THREAD, {RUN_A}) == {RUN_A: 2}
