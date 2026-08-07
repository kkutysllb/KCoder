"""Tests for runtime core helpers: stream modes, converters, checkpoint mode, event catalog."""

from types import SimpleNamespace

import pytest

from qilin.runtime.checkpoint_mode import (
    INTERNAL_CHECKPOINT_MODE_KEY,
    CheckpointModeMismatchError,
    CheckpointModeReconfigurationError,
    aensure_checkpoint_mode_compatible,
    checkpoint_metadata_uses_delta,
    ensure_checkpoint_mode_compatible,
    freeze_checkpoint_channel_mode,
    freeze_checkpoint_snapshot_frequency,
    inject_checkpoint_mode,
    raise_if_snapshot_incompatible,
    resolve_checkpoint_snapshot_frequency,
    state_snapshot_uses_delta,
)
from qilin.runtime.converters import (
    langchain_messages_to_openai,
    langchain_to_openai_completion,
    langchain_to_openai_message,
)
from qilin.runtime.events.catalog import (
    MIDDLEWARE_EVENT_PATTERN,
    RUN_START_EVENT,
    RunEventDefinition,
    RunEventPattern,
)
from qilin.runtime.stream_modes import (
    UnsupportedStreamModeError,
    normalize_stream_modes,
    to_langgraph_stream_modes,
)

# ---------------------------------------------------------------------------
# stream_modes
# ---------------------------------------------------------------------------


class TestStreamModes:
    def test_normalize_none_defaults_to_values(self) -> None:
        assert normalize_stream_modes(None) == ["values"]

    def test_normalize_string_wraps(self) -> None:
        assert normalize_stream_modes("updates") == ["updates"]

    def test_normalize_list_preserves_input_order(self) -> None:
        assert normalize_stream_modes(["values", "tasks"]) == ["values", "tasks"]

    def test_normalize_empty_list_defaults(self) -> None:
        assert normalize_stream_modes([]) == ["values"]

    def test_normalize_rejects_unknown_mode(self) -> None:
        with pytest.raises(UnsupportedStreamModeError) as exc:
            normalize_stream_modes(["bogus"])
        assert "bogus" in str(exc.value)

    def test_normalize_rejects_non_string_element(self) -> None:
        with pytest.raises(UnsupportedStreamModeError):
            normalize_stream_modes(["values", 42])

    def test_to_langgraph_maps_messages_tuple(self) -> None:
        assert to_langgraph_stream_modes("messages-tuple") == ["messages"]

    def test_to_langgraph_passthrough_and_dedupe(self) -> None:
        assert to_langgraph_stream_modes(["values", "values", "messages-tuple"]) == [
            "values",
            "messages",
        ]


# ---------------------------------------------------------------------------
# converters
# ---------------------------------------------------------------------------


def _message(**kwargs: object) -> SimpleNamespace:
    return SimpleNamespace(**kwargs)


class TestConverters:
    def test_human_message_maps_to_user(self) -> None:
        assert langchain_to_openai_message(_message(type="human", content="hi")) == {
            "role": "user",
            "content": "hi",
        }

    def test_ai_message_text(self) -> None:
        assert langchain_to_openai_message(_message(type="ai", content="hello")) == {
            "role": "assistant",
            "content": "hello",
        }

    def test_ai_message_with_tool_calls(self) -> None:
        msg = _message(
            type="ai",
            content="",
            tool_calls=[
                {"id": "call_1", "name": "search", "args": {"q": "x"}},
                {"id": "call_2", "name": "bash", "args": '{"cmd": "ls"}'},
            ],
        )
        out = langchain_to_openai_message(msg)
        assert out["role"] == "assistant"
        assert out["content"] is None
        assert out["tool_calls"][0]["function"] == {
            "name": "search",
            "arguments": '{"q": "x"}',
        }
        assert out["tool_calls"][1]["function"]["arguments"] == '{"cmd": "ls"}'

    def test_ai_message_list_content_preserved(self) -> None:
        content = [{"type": "text", "text": "hi"}]
        assert langchain_to_openai_message(_message(type="ai", content=content))[
            "content"
        ] == content

    def test_tool_message(self) -> None:
        out = langchain_to_openai_message(
            _message(type="tool", content="result", tool_call_id="call_1")
        )
        assert out == {"role": "tool", "tool_call_id": "call_1", "content": "result"}

    def test_unknown_type_passthrough(self) -> None:
        assert langchain_to_openai_message(_message(type="custom", content="x")) == {
            "role": "custom",
            "content": "x",
        }

    def test_completion_usage_and_finish_reason(self) -> None:
        msg = _message(
            type="ai",
            content="answer",
            id="msg-1",
            response_metadata={"model_name": "gpt-4o", "finish_reason": "stop"},
            usage_metadata={"input_tokens": 10, "output_tokens": 5},
        )
        out = langchain_to_openai_completion(msg)
        assert out["id"] == "msg-1"
        assert out["model"] == "gpt-4o"
        assert out["choices"][0]["finish_reason"] == "stop"
        assert out["usage"] == {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}

    def test_completion_finish_reason_tool_calls_takes_precedence(self) -> None:
        msg = _message(
            type="ai",
            content="",
            tool_calls=[{"id": "c", "name": "f", "args": {}}],
            response_metadata={"finish_reason": "stop"},
        )
        assert langchain_to_openai_completion(msg)["choices"][0]["finish_reason"] == "tool_calls"

    def test_completion_no_usage(self) -> None:
        msg = _message(type="ai", content="x", id="m")
        assert langchain_to_openai_completion(msg)["usage"] is None

    def test_messages_batch(self) -> None:
        msgs = [_message(type="human", content="a"), _message(type="ai", content="b")]
        out = langchain_messages_to_openai(msgs)
        assert [m["role"] for m in out] == ["user", "assistant"]


# ---------------------------------------------------------------------------
# checkpoint_mode
# ---------------------------------------------------------------------------


class TestCheckpointMode:
    def test_freeze_accepts_first_mode(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("qilin.runtime.checkpoint_mode._frozen_checkpoint_channel_mode", None)
        assert freeze_checkpoint_channel_mode("delta") == "delta"

    def test_freeze_same_mode_is_idempotent(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("qilin.runtime.checkpoint_mode._frozen_checkpoint_channel_mode", "delta")
        assert freeze_checkpoint_channel_mode("delta") == "delta"

    def test_freeze_conflicting_mode_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("qilin.runtime.checkpoint_mode._frozen_checkpoint_channel_mode", "delta")
        with pytest.raises(CheckpointModeReconfigurationError):
            freeze_checkpoint_channel_mode("full")

    def test_freeze_snapshot_frequency_rejects_non_positive(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("qilin.runtime.checkpoint_mode._frozen_checkpoint_snapshot_frequency", None)
        with pytest.raises(ValueError):
            freeze_checkpoint_snapshot_frequency(0)

    def test_freeze_snapshot_frequency_conflict(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("qilin.runtime.checkpoint_mode._frozen_checkpoint_snapshot_frequency", 10)
        with pytest.raises(CheckpointModeReconfigurationError):
            freeze_checkpoint_snapshot_frequency(20)

    def test_resolve_snapshot_frequency_explicit_wins(self) -> None:
        assert resolve_checkpoint_snapshot_frequency(5) == 5

    def test_inject_checkpoint_mode_delta(self) -> None:
        config: dict = {}
        inject_checkpoint_mode(config, "delta")
        assert config["configurable"][INTERNAL_CHECKPOINT_MODE_KEY] == "delta"
        assert config["metadata"]["qilin_checkpoint_channel_mode"] == "delta"

    def test_inject_checkpoint_mode_full_removes_marker(self) -> None:
        config = {"metadata": {"qilin_checkpoint_channel_mode": "delta"}}
        inject_checkpoint_mode(config, "full")
        assert "qilin_checkpoint_channel_mode" not in config["metadata"]

    def test_metadata_marker_detection(self) -> None:
        assert checkpoint_metadata_uses_delta({"qilin_checkpoint_channel_mode": "delta"})
        assert checkpoint_metadata_uses_delta({"counters_since_delta_snapshot": {"messages": 3}})
        assert not checkpoint_metadata_uses_delta({})
        assert not checkpoint_metadata_uses_delta(None)

    def test_raise_if_snapshot_incompatible_full_mode(self) -> None:
        snapshot = SimpleNamespace(metadata={"qilin_checkpoint_channel_mode": "delta"})
        with pytest.raises(CheckpointModeMismatchError):
            raise_if_snapshot_incompatible(snapshot, "full")
        raise_if_snapshot_incompatible(snapshot, "delta")

    def test_state_snapshot_uses_delta(self) -> None:
        assert state_snapshot_uses_delta(
            SimpleNamespace(metadata={"qilin_checkpoint_channel_mode": "delta"})
        )
        assert not state_snapshot_uses_delta(SimpleNamespace(metadata={}))

    def test_ensure_checkpoint_mode_compatible(self) -> None:
        delta_tuple = SimpleNamespace(metadata={"qilin_checkpoint_channel_mode": "delta"})
        full_tuple = SimpleNamespace(metadata={})
        with pytest.raises(CheckpointModeMismatchError):
            ensure_checkpoint_mode_compatible(
                SimpleNamespace(get_tuple=lambda _c: delta_tuple), {}, "full"
            )
        # delta mode is always permissive
        ensure_checkpoint_mode_compatible(
            SimpleNamespace(get_tuple=lambda _c: delta_tuple), {}, "delta"
        )
        ensure_checkpoint_mode_compatible(
            SimpleNamespace(get_tuple=lambda _c: full_tuple), {}, "full"
        )

    @pytest.mark.asyncio
    async def test_aensure_checkpoint_mode_compatible(self) -> None:
        async def _aget_tuple(_config: dict) -> SimpleNamespace:
            return SimpleNamespace(metadata={"qilin_checkpoint_channel_mode": "delta"})

        with pytest.raises(CheckpointModeMismatchError):
            await aensure_checkpoint_mode_compatible(
                SimpleNamespace(aget_tuple=_aget_tuple), {}, "full"
            )
        await aensure_checkpoint_mode_compatible(
            SimpleNamespace(aget_tuple=_aget_tuple), {}, "delta"
        )


# ---------------------------------------------------------------------------
# events catalog
# ---------------------------------------------------------------------------


class TestEventCatalog:
    def test_definition_validation(self) -> None:
        with pytest.raises(ValueError):
            RunEventDefinition("", "trace")
        with pytest.raises(ValueError):
            RunEventDefinition("run.start", "")

    def test_definition_constants_well_formed(self) -> None:
        assert RUN_START_EVENT.event_type == "run.start"
        assert RUN_START_EVENT.category == "trace"

    def test_pattern_event_type_builds_prefixed_name(self) -> None:
        assert MIDDLEWARE_EVENT_PATTERN.event_type("guardrail") == "middleware:guardrail"

    def test_pattern_rejects_empty_suffix(self) -> None:
        with pytest.raises(ValueError):
            MIDDLEWARE_EVENT_PATTERN.event_type("")

    def test_pattern_rejects_oversized_suffix(self) -> None:
        with pytest.raises(ValueError):
            RunEventPattern(pattern="x:{t}", prefix="x:", category="c").event_type("y" * 100)

    def test_pattern_validates_category(self) -> None:
        with pytest.raises(ValueError):
            RunEventPattern(pattern="x", prefix="x:", category="")
