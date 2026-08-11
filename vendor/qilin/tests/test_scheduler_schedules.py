"""Unit tests for qilin.scheduler.schedules (pure scheduling primitives)."""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from qilin.scheduler.schedules import (
    next_run_at,
    normalize_cron_expression,
    validate_timezone,
)

NOW = datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)


class TestValidateTimezone:
    def test_known_timezone_roundtrips(self) -> None:
        assert validate_timezone("UTC") == "UTC"
        assert validate_timezone("Asia/Shanghai") == "Asia/Shanghai"

    def test_unknown_timezone_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown timezone"):
            validate_timezone("Not/AZone")


class TestNormalizeCronExpression:
    def test_collapses_redundant_whitespace(self) -> None:
        assert normalize_cron_expression("0   0 * * *") == "0 0 * * *"

    def test_rejects_wrong_field_count(self) -> None:
        with pytest.raises(ValueError, match="exactly 5 fields"):
            normalize_cron_expression("0 0 * * * *")

    def test_rejects_empty_expression(self) -> None:
        with pytest.raises(ValueError, match="exactly 5 fields"):
            normalize_cron_expression("   ")


class TestNextRunAtOnce:
    def test_future_aware_run_at_keeps_timezone(self) -> None:
        run_at = "2026-01-02T10:00:00+00:00"
        result = next_run_at("once", {"run_at": run_at}, "UTC", now=NOW)
        assert result == datetime(2026, 1, 2, 10, 0, tzinfo=UTC)

    def test_naive_run_at_is_wall_clock_in_declared_timezone(self) -> None:
        result = next_run_at(
            "once",
            {"run_at": "2026-01-02T10:00:00"},
            "Asia/Shanghai",
            now=NOW,
        )
        assert result == datetime(2026, 1, 2, 10, 0, tzinfo=ZoneInfo("Asia/Shanghai"))

    def test_past_run_at_returns_none(self) -> None:
        assert (
            next_run_at("once", {"run_at": "2020-01-01T00:00:00"}, "UTC", now=NOW)
            is None
        )

    def test_missing_run_at_raises(self) -> None:
        with pytest.raises(ValueError, match="requires run_at"):
            next_run_at("once", {}, "UTC", now=NOW)

    def test_naive_now_is_treated_as_utc(self) -> None:
        naive_now = datetime(2026, 1, 1, 0, 0, 0)
        result = next_run_at(
            "once",
            {"run_at": "2026-01-01T00:00:30"},
            "UTC",
            now=naive_now,
        )
        assert result is not None
        assert result == datetime(2026, 1, 1, 0, 0, 30, tzinfo=UTC)


class TestNextRunAtCron:
    def test_next_utc_midnight_after_now(self) -> None:
        result = next_run_at("cron", {"cron": "0 0 * * *"}, "UTC", now=NOW)
        assert result == datetime(2026, 1, 2, 0, 0, tzinfo=UTC)
        assert result > NOW

    def test_timezone_shift_local_noon_to_utc(self) -> None:
        # Local noon in Shanghai is 04:00 UTC.
        result = next_run_at(
            "cron",
            {"cron": "0 12 * * *"},
            "Asia/Shanghai",
            now=NOW,
        )
        assert result == datetime(2026, 1, 1, 4, 0, tzinfo=UTC)

    def test_invalid_field_count_raises(self) -> None:
        with pytest.raises(ValueError, match="exactly 5 fields"):
            next_run_at("cron", {"cron": "0 0 * * * *"}, "UTC", now=NOW)

    def test_invalid_values_raise(self) -> None:
        # croniter rejects out-of-range fields with a ValueError subclass.
        with pytest.raises(ValueError):
            next_run_at("cron", {"cron": "99 99 * * *"}, "UTC", now=NOW)

    def test_unsupported_schedule_type_raises(self) -> None:
        with pytest.raises(ValueError, match="Unsupported schedule_type"):
            next_run_at("hourly", {}, "UTC", now=NOW)
