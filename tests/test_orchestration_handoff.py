"""Unit tests for qilin.orchestration.handoff (handoff protocol)."""

from qilin.orchestration.handoff import AgentHandoff, HandoffError, HandoffResult


class TestAgentHandoff:
    def test_required_fields(self) -> None:
        h = AgentHandoff(from_agent="lead", to_agent="coder", task="fix bug")

        assert h.from_agent == "lead"
        assert h.to_agent == "coder"
        assert h.task == "fix bug"
        assert h.context == {}
        assert h.result is None

    def test_to_dict_without_result(self) -> None:
        h = AgentHandoff(from_agent="lead", to_agent="coder", task="fix bug")

        data = h.to_dict()

        assert data == {
            "from_agent": "lead",
            "to_agent": "coder",
            "task": "fix bug",
            "context": {},
        }

    def test_to_dict_with_result(self) -> None:
        h = AgentHandoff(
            from_agent="lead",
            to_agent="coder",
            task="fix bug",
            context={"trace_id": "abc123"},
        )
        h.result = "fixed"

        data = h.to_dict()

        assert data["result"] == "fixed"
        assert data["context"] == {"trace_id": "abc123"}

    def test_to_dict_copies_context(self) -> None:
        h = AgentHandoff(
            from_agent="lead",
            to_agent="coder",
            task="t",
            context={"k": ["v"]},
        )
        data = h.to_dict()

        data["context"]["k"].append("mutated")

        assert h.context["k"] == ["v"]


class TestHandoffResult:
    def test_defaults(self) -> None:
        r = HandoffResult(success=True)

        assert r.success is True
        assert r.result is None
        assert r.error is None
        assert r.handoff is None

    def test_failure_payload(self) -> None:
        r = HandoffResult(success=False, error="boom")

        assert r.error == "boom"
        assert r.result is None


class TestHandoffError:
    def test_is_runtime_error(self) -> None:
        err = HandoffError("unknown target agent")

        assert isinstance(err, RuntimeError)
        assert str(err) == "unknown target agent"
