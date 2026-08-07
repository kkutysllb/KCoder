"""Tests for langgraph compatibility patches (qilin.checkpoint_patches).

验证两个 patch 在安装的 langgraph 版本下的行为与基线守护：
1. InMemorySaver delta-history 委托 base 后保留 full→delta 迁移后的首条消息
2. BinaryOperatorAggregate Overwrite 首写解包（Union 通道无默认值场景）
"""

import importlib
import importlib.metadata

import pytest
from langgraph.channels.binop import BinaryOperatorAggregate
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.errors import InvalidUpdateError
from langgraph.types import Overwrite
from packaging.version import Version

from qilin import checkpoint_patches as cp

_THREAD_CFG = {"configurable": {"thread_id": "t", "checkpoint_ns": ""}}


def _config(checkpoint_id: str) -> dict:
    return {
        "configurable": {
            "thread_id": "t",
            "checkpoint_ns": "",
            "checkpoint_id": checkpoint_id,
        }
    }


def _checkpoint(cp_id: str, channel_values: dict, channel_versions: dict) -> dict:
    return {
        "id": cp_id,
        "channel_values": channel_values,
        "channel_versions": channel_versions,
        "versions_seen": {},
        "pending_sends": [],
        "v": 1,
        "ts": "0",
    }


def _build_migration_state(saver: InMemorySaver) -> None:
    """构造 full→delta 迁移状态（对应 patch docstring 的丢失场景）。

    A: full 模式最后 checkpoint，blob v1 = [m1]（普通值）
    B: 迁移后第一 superstep；channel_values 无 messages（delta 非快照步），
       channel_versions 仍引用 pre-delta blob v1；pending writes = [m2]
    C: B 的子 checkpoint（版本 v2 无 blob），作为 delta history 消费入口
    """
    saver.put(
        config=_THREAD_CFG,
        checkpoint=_checkpoint("A", {"messages": [{"id": "m1"}]}, {"messages": "v1"}),
        metadata={},
        new_versions={"messages": "v1"},
    )
    saver.put(
        config=_config("A"),
        checkpoint=_checkpoint("B", {}, {"messages": "v1"}),
        metadata={},
        new_versions={},
    )
    saver.put_writes(
        config=_config("B"), writes=[("messages", {"id": "m2"})], task_id="task1"
    )
    saver.put(
        config=_config("B"),
        checkpoint=_checkpoint("C", {}, {"messages": "v2"}),
        metadata={},
        new_versions={"messages": "v2"},
    )


# ---------------------------------------------------------------------------
# 基线守护：安装的 langgraph 不得超过 patch 验证版本
# ---------------------------------------------------------------------------


class TestVersionGuard:
    def test_installed_langgraph_within_validated_version(self) -> None:
        installed = Version(importlib.metadata.version("langgraph"))
        assert installed <= cp._PATCH_VALIDATED_LANGGRAPH_VERSION, (
            f"langgraph {installed} 超过 patch 验证基线 "
            f"{cp._PATCH_VALIDATED_LANGGRAPH_VERSION}，"
            "需重新检查 InMemorySaver.get_delta_channel_history 后更新基线"
        )


# ---------------------------------------------------------------------------
# InMemorySaver delta-history patch
# ---------------------------------------------------------------------------


class TestDeltaHistoryPatch:
    def test_buggy_override_drops_migration_first_message(self) -> None:
        """上游 override（未打补丁）丢弃迁移后首条消息 —— bug 复现。"""
        fresh_module = importlib.reload(
            importlib.import_module("langgraph.checkpoint.memory")
        )
        saver = fresh_module.InMemorySaver()
        _build_migration_state(saver)
        history = saver.get_delta_channel_history(
            config=_config("C"), channels=["messages"]
        )
        # B 的 pending writes 被 pre-delta blob 误判为已 subsumed
        assert history["messages"]["writes"] == []
        assert history["messages"]["seed"] == [{"id": "m1"}]

    def test_patch_preserves_migration_first_message(self) -> None:
        """补丁后（委托 base）B 的 writes 保留，seed 取最近物化值。"""
        saver = InMemorySaver()  # qilin 模块导入时已应用补丁
        _build_migration_state(saver)
        history = saver.get_delta_channel_history(
            config=_config("C"), channels=["messages"]
        )
        assert history["messages"]["seed"] == [{"id": "m1"}]
        assert [(w[0], w[1], w[2]) for w in history["messages"]["writes"]] == [
            ("task1", "messages", {"id": "m2"})
        ]

    async def test_aget_delegates_to_base(self) -> None:
        saver = InMemorySaver()
        _build_migration_state(saver)
        history = await saver.aget_delta_channel_history(
            config=_config("C"), channels=["messages"]
        )
        assert [(w[0], w[1], w[2]) for w in history["messages"]["writes"]] == [
            ("task1", "messages", {"id": "m2"})
        ]

    def test_patch_is_idempotent(self) -> None:
        before = InMemorySaver.get_delta_channel_history
        cp.ensure_inmemory_delta_history_patch()
        assert InMemorySaver.get_delta_channel_history is before

    def test_stands_down_when_upstream_override_absent(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """模拟上游修复（override 消失）时补丁应停止干预。"""
        monkeypatch.setattr(
            InMemorySaver,
            "get_delta_channel_history",
            BaseCheckpointSaver.get_delta_channel_history,
        )
        monkeypatch.setattr(
            InMemorySaver,
            "aget_delta_channel_history",
            BaseCheckpointSaver.aget_delta_channel_history,
        )
        monkeypatch.setattr(InMemorySaver, cp._PATCH_FLAG, False, raising=False)
        cp.ensure_inmemory_delta_history_patch()
        assert getattr(InMemorySaver, cp._PATCH_FLAG, False) is False


# ---------------------------------------------------------------------------
# BinaryOperatorAggregate Overwrite 首写 patch
# ---------------------------------------------------------------------------


class TestBinopPatch:
    def test_upstream_bug_stores_overwrite_literal(self) -> None:
        """原始上游 update 把 Overwrite 包装本身存入空 Union 通道。"""
        raw = type("RawBinop", (BinaryOperatorAggregate,), {"update": cp._unpatched_binop_update})
        channel = raw(dict | None, lambda existing, new: new)
        channel.key = "probe"
        channel.update([Overwrite({"probe": True})])
        assert isinstance(channel.get(), Overwrite)

    def test_first_write_unwrapped_after_patch(self) -> None:
        channel = BinaryOperatorAggregate(dict | None, lambda existing, new: new)
        channel.key = "probe"
        channel.update([Overwrite({"probe": True})])
        assert channel.get() == {"probe": True}

    def test_second_overwrite_raises(self) -> None:
        channel = BinaryOperatorAggregate(dict | None, lambda existing, new: new)
        channel.key = "probe"
        with pytest.raises(InvalidUpdateError):
            channel.update([Overwrite({"a": 1}), Overwrite({"b": 2})])

    def test_later_plain_values_skipped_after_overwrite(self) -> None:
        channel = BinaryOperatorAggregate(dict | None, lambda existing, new: new)
        channel.key = "probe"
        channel.update([Overwrite({"a": 1}), {"b": 2}])
        assert channel.get() == {"a": 1}

    def test_non_overwrite_first_write_delegates(self) -> None:
        channel = BinaryOperatorAggregate(dict | None, lambda existing, new: new)
        channel.key = "probe"
        channel.update([{"a": 1}])
        assert channel.get() == {"a": 1}

    def test_overwrite_on_non_empty_channel_delegates(self) -> None:
        channel = BinaryOperatorAggregate(dict | None, lambda existing, new: new)
        channel.key = "probe"
        channel.update([{"a": 1}])
        channel.update([Overwrite({"b": 2})])
        assert channel.get() == {"b": 2}

    def test_stands_down_when_upstream_fixed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """模拟上游修复（探针干净）时补丁应停止干预。"""
        monkeypatch.setattr(cp, "_binop_first_write_stores_overwrite_wrapper", lambda: False)
        monkeypatch.setattr(BinaryOperatorAggregate, cp._BINOP_PATCH_FLAG, False, raising=False)
        cp.ensure_binop_overwrite_first_write_patch()
        assert getattr(BinaryOperatorAggregate, cp._BINOP_PATCH_FLAG, False) is False
