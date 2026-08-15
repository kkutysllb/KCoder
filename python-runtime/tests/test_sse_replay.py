"""SSE 可靠性单测（Phase C2：seq / Last-Event-ID 重放 / registry 竞态）。

覆盖：
- _next_event：单调 seq + payload eventId + 缓冲追加
- sse_event_generator：断点重连只补发 seq > last_event_id；正常路径消费队列
- sse_replay_generator：迟到订阅全量重放 + 断点重放（最近缓存路径）
- RunRegistry.remove_if_current：旧 run 迟到清理不误删新 run（steer 竞态）；
  被移除的 run 进入最近缓存；最近缓存有界（20）
"""

from __future__ import annotations

import asyncio

from kcoder_gateway.sse import (
    ActiveRun,
    RunRegistry,
    _next_event,
    sse_event_generator,
    sse_replay_generator,
)


def _run(thread_id: str = "t1") -> ActiveRun:
    return ActiveRun(thread_id=thread_id, turn_id="turn-1", user_message_id="u1")


def _consumed(run: ActiveRun, n: int) -> None:
    """模拟旧连接已分发过的事件：只进缓冲（seq 已分配）。"""
    for i in range(n):
        _next_event(run, {"kind": "assistant_text_delta", "delta": f"chunk{i}"})


def _pending(run: ActiveRun, ev: dict | None = None) -> None:
    """未分发事件：raw 进队列（生成器分发时才分配 seq）。"""
    run.event_queue.put_nowait(ev if ev is not None else {"kind": "assistant_text_delta", "delta": "p"})


def _collect(async_gen_factory) -> list[dict]:
    """跑完一个异步生成器，解析 SSE 帧为 (seq, event) 列表。"""
    import json

    async def drive():
        out = []
        agen = async_gen_factory()
        async for frame in agen:
            lines = frame.decode("utf-8").strip().split("\n")
            seq, data = None, None
            for ln in lines:
                if ln.startswith("id:"):
                    seq = int(ln[3:])
                elif ln.startswith("data:"):
                    data = json.loads(ln[5:])
            out.append((seq, data))
        return out

    return asyncio.run(drive())


# ── _next_event ────────────────────────────────────────────────────────────


def test_next_event_seq_monotonic_and_buffered():
    run = _run()
    for i in range(3):
        seq, ev = _next_event(run, {"kind": "k"})
        assert seq == i + 1
        assert ev["eventId"] == i + 1
    assert [s for s, _ in run.event_buffer] == [1, 2, 3]


# ── 断线重连补发 ────────────────────────────────────────────────────────────


def test_event_generator_replay_after_last_event_id():
    """旧连接已分发 5 个（进缓冲），断线重连 last_event_id=3 → 只补发 4、5。"""
    run = _run()
    _consumed(run, 5)
    run.task = None
    run.event_queue.put_nowait(None)
    frames = _collect(lambda: sse_event_generator(run, last_event_id=3))
    seqs = [s for s, _ in frames]
    assert seqs == [4, 5], seqs


def test_event_generator_full_when_no_last_id():
    run = _run()
    _pending(run)
    _pending(run)
    _pending(run)
    run.task = None
    run.event_queue.put_nowait(None)
    frames = _collect(lambda: sse_event_generator(run))
    assert [s for s, _ in frames] == [1, 2, 3]


def test_replay_generator_recent_cache_path():
    """run 已结束（迟到订阅）：已分发 2 个进缓冲 + 队列剩余 1 个 → 三事件。"""
    run = _run()
    _consumed(run, 2)
    _pending(run, {"kind": "turn_completed"})
    run.event_queue.put_nowait(None)
    frames = _collect(lambda: sse_replay_generator(run))
    kinds = [d.get("kind") for _, d in frames]
    assert kinds == [
        "assistant_text_delta",
        "assistant_text_delta",
        "turn_completed",
    ]


# ── RunRegistry 竞态语义 ───────────────────────────────────────────────────


def test_remove_if_current_protects_new_run():
    """旧 run 的迟到 finally 清理不得误删同 thread 的新 run（steer 竞态）。"""
    reg = RunRegistry()
    old, new = _run(), _run()
    reg.register(old)
    reg.register(new)  # 旧 run 被 cancel，新 run 顶上
    assert reg.get("t1") is new
    removed = reg.remove_if_current(old)  # 旧 run 迟到收尾
    assert removed is False
    assert reg.get("t1") is new, "新 run 被误删 → No active turn"


def test_remove_if_current_moves_to_recent():
    reg = RunRegistry()
    run = _run()
    reg.register(run)
    assert reg.remove_if_current(run) is True
    assert reg.get("t1") is None
    assert reg.get_recent("t1") is run


def test_recent_cache_bounded():
    reg = RunRegistry()
    for i in range(25):
        run = _run(f"t{i}")
        reg.register(run)
        reg.remove_if_current(run)
    assert len(reg._recent) == reg._RECENT_MAX == 20
    # 最老的被挤出
    assert reg.get_recent("t0") is None
    assert reg.get_recent("t24") is not None
