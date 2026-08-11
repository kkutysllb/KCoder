"""Tests for atomic_write_extensions_config."""

import json
from pathlib import Path

import pytest

from qilin.config.extensions_config import atomic_write_extensions_config


def test_atomic_write_creates_config(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "extensions_config.json"
    data = {"skills": {"s": {"enabled": True}}, "mcpServers": {}}

    atomic_write_extensions_config(path, data)

    assert json.loads(path.read_text()) == data


def test_atomic_write_replaces_existing(tmp_path: Path) -> None:
    path = tmp_path / "extensions_config.json"
    path.write_text(json.dumps({"old": True}))

    atomic_write_extensions_config(path, {"new": 1})

    assert json.loads(path.read_text()) == {"new": 1}


def test_atomic_write_leaves_no_temp_files(tmp_path: Path) -> None:
    path = tmp_path / "extensions_config.json"

    atomic_write_extensions_config(path, {"x": 1})

    assert list(tmp_path.glob("*.tmp")) == []


def test_atomic_write_failure_cleans_temp(tmp_path: Path) -> None:
    path = tmp_path / "extensions_config.json"
    path.write_text("original")

    # A data object whose serialization fails mid-write.
    class Unserializable:
        pass

    with pytest.raises(TypeError):
        atomic_write_extensions_config(path, {"bad": Unserializable()})

    assert path.read_text() == "original"
    assert list(tmp_path.glob("*.tmp")) == []


def test_normalize_transport_alias_maps_transport_to_type() -> None:
    from qilin.config.extensions_config import normalize_mcp_transport_alias

    assert normalize_mcp_transport_alias({"transport": "sse"}) == {"transport": "sse", "type": "sse"}


def test_normalize_transport_alias_type_takes_precedence() -> None:
    from qilin.config.extensions_config import normalize_mcp_transport_alias

    assert normalize_mcp_transport_alias({"transport": "http", "type": "stdio"}) == {
        "transport": "http",
        "type": "stdio",
    }


def test_normalize_transport_alias_passthrough() -> None:
    from qilin.config.extensions_config import normalize_mcp_transport_alias

    assert normalize_mcp_transport_alias({"type": "stdio"}) == {"type": "stdio"}
    assert normalize_mcp_transport_alias("stdio") == "stdio"
    assert normalize_mcp_transport_alias(None) is None


def test_mcp_server_config_validator_uses_normalizer() -> None:
    from qilin.config.extensions_config import McpServerConfig

    cfg = McpServerConfig(name="srv", command="x", transport="sse")
    assert cfg.type == "sse"
