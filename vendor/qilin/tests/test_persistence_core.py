"""Tests for persistence core: dialect-aware JSON metadata filters."""

import pytest
from sqlalchemy import (
    Column,
    Engine,
    Integer,
    MetaData,
    Table,
    create_engine,
    select,
    text,
)
from sqlalchemy.types import JSON

from qilin.persistence.json_compat import (
    JsonMatch,
    json_match,
    validate_metadata_filter_key,
    validate_metadata_filter_value,
)

# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------


class TestFilterValidation:
    def test_key_accepts_safe_charset(self) -> None:
        assert validate_metadata_filter_key("thread_id")
        assert validate_metadata_filter_key("a-b_c123")

    def test_key_rejects_unsafe(self) -> None:
        assert not validate_metadata_filter_key('a"b')
        assert not validate_metadata_filter_key("a b")
        assert not validate_metadata_filter_key("a$b")
        assert not validate_metadata_filter_key("")
        assert not validate_metadata_filter_key(42)
        assert not validate_metadata_filter_key(None)

    def test_value_accepts_scalars(self) -> None:
        assert validate_metadata_filter_value(None)
        assert validate_metadata_filter_value(True)
        assert validate_metadata_filter_value(42)
        assert validate_metadata_filter_value(3.14)
        assert validate_metadata_filter_value("text")

    def test_value_rejects_collections(self) -> None:
        assert not validate_metadata_filter_value([])
        assert not validate_metadata_filter_value({})
        assert not validate_metadata_filter_value(b"bytes")
        assert not validate_metadata_filter_value(object())

    def test_value_int64_range(self) -> None:
        assert validate_metadata_filter_value(2**63 - 1)
        assert validate_metadata_filter_value(-(2**63))
        assert not validate_metadata_filter_value(2**63)
        assert not validate_metadata_filter_value(-(2**63) - 1)

    def test_json_match_construct_rejects_bad_input(self) -> None:
        from sqlalchemy import literal_column

        col = literal_column("payload", type_=JSON)
        with pytest.raises(ValueError):
            JsonMatch(col, 'bad"key', "x")
        with pytest.raises(TypeError):
            JsonMatch(col, "ok", {"nested": 1})
        with pytest.raises(TypeError):
            JsonMatch(col, "ok", 2**63)


# ---------------------------------------------------------------------------
# SQL compilation
# ---------------------------------------------------------------------------


class TestCompilation:
    def test_sqlite_compile_uses_json_extract(self) -> None:
        from sqlalchemy import literal_column
        from sqlalchemy.dialects import sqlite

        col = literal_column("payload", type_=JSON)
        sql = str(JsonMatch(col, "status", "done").compile(dialect=sqlite.dialect()))
        assert "json_type" in sql
        assert 'json_extract(payload, \'$."status"\')' in sql

    def test_postgres_compile_uses_json_typeof(self) -> None:
        from sqlalchemy import literal_column
        from sqlalchemy.dialects import postgresql

        col = literal_column("payload", type_=JSON)
        sql = str(JsonMatch(col, "status", "done").compile(dialect=postgresql.dialect()))
        assert "json_typeof" in sql
        assert "->>" in sql

    def test_unsupported_dialect_raises(self) -> None:
        from sqlalchemy import literal_column
        from sqlalchemy.dialects import mysql

        col = literal_column("payload", type_=JSON)
        with pytest.raises(NotImplementedError):
            str(JsonMatch(col, "status", "done").compile(dialect=mysql.dialect()))


# ---------------------------------------------------------------------------
# real SQLite behavior
# ---------------------------------------------------------------------------


@pytest.fixture()
def sqlite_engine() -> Engine:
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(
            text("CREATE TABLE runs (id INTEGER PRIMARY KEY, payload JSON NOT NULL)")
        )
    yield engine
    engine.dispose()


def _insert(engine: Engine, payload: object) -> None:
    import json

    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO runs (payload) VALUES (:p)"), {"p": json.dumps(payload)}
        )


def _matching_ids(engine: Engine, key: str, value: object) -> list[int]:
    """Execute a JsonMatch predicate through SQLAlchemy against in-memory SQLite."""
    meta = MetaData()
    table = Table(
        "runs",
        meta,
        Column("id", Integer, primary_key=True),
        Column("payload", JSON),
    )
    with engine.connect() as conn:
        rows = conn.execute(
            select(table.c.id).where(json_match(table.c.payload, key, value))
        ).fetchall()
    return [r[0] for r in rows]


class TestSqliteBehavior:
    def test_string_match(self, sqlite_engine: Engine) -> None:
        _insert(sqlite_engine, {"status": "done"})
        _insert(sqlite_engine, {"status": "pending"})
        assert _matching_ids(sqlite_engine, "status", "done") == [1]

    def test_missing_key_does_not_match(self, sqlite_engine: Engine) -> None:
        _insert(sqlite_engine, {"other": 1})
        assert _matching_ids(sqlite_engine, "status", "done") == []

    def test_null_value_matches_json_null(self, sqlite_engine: Engine) -> None:
        _insert(sqlite_engine, {"a": None})
        _insert(sqlite_engine, {"a": 1})
        assert _matching_ids(sqlite_engine, "a", None) == [1]

    def test_bool_does_not_match_int(self, sqlite_engine: Engine) -> None:
        _insert(sqlite_engine, {"flag": True})
        _insert(sqlite_engine, {"flag": 1})
        assert _matching_ids(sqlite_engine, "flag", True) == [1]
        assert _matching_ids(sqlite_engine, "flag", 1) == [2]

    def test_int_does_not_match_float(self, sqlite_engine: Engine) -> None:
        _insert(sqlite_engine, {"n": 1})
        _insert(sqlite_engine, {"n": 1.5})
        assert _matching_ids(sqlite_engine, "n", 1) == [1]
        assert _matching_ids(sqlite_engine, "n", 1.5) == [2]

    def test_int64_boundary_values(self, sqlite_engine: Engine) -> None:
        _insert(sqlite_engine, {"n": 2**63 - 1})
        _insert(sqlite_engine, {"n": -(2**63)})
        assert _matching_ids(sqlite_engine, "n", 2**63 - 1) == [1]
        assert _matching_ids(sqlite_engine, "n", -(2**63)) == [2]

    def test_json_match_helper(self, sqlite_engine: Engine) -> None:
        _insert(sqlite_engine, {"k": "v"})
        meta = MetaData()
        table = Table("runs", meta, Column("payload", JSON))
        expr = json_match(table.c.payload, "k", "v")
        assert isinstance(expr, JsonMatch)
        assert _matching_ids(sqlite_engine, "k", "v") == [1]
