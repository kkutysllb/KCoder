"""Unit tests for qilin.config.file_signature.get_config_signature.

The signature tuple is ``(mtime, size, sha256-hexdigest)``; ``None`` means
the file could not be stat-ed at all, and a ``None`` digest means the stat
succeeded but the content could not be read.
"""

import hashlib
import os
from pathlib import Path

import pytest

from qilin.config.file_signature import get_config_signature


class TestGetConfigSignature:
    def test_missing_file_returns_none(self, tmp_path: Path) -> None:
        assert get_config_signature(tmp_path / "nope.yaml") is None

    def test_regular_file_full_signature(self, tmp_path: Path) -> None:
        path = tmp_path / "config.yaml"
        content = b"key: value\nother: 42\n"
        path.write_bytes(content)

        mtime, size, digest = get_config_signature(path)

        assert size == len(content)
        assert isinstance(mtime, float)
        assert digest == hashlib.sha256(content).hexdigest()

    def test_same_mtime_and_size_different_content_is_detected(
        self, tmp_path: Path
    ) -> None:
        """Core scenario: a same-length swap inside the same second.

        mtime *and* size both stay put, so only the sha256 can catch the
        change -- the exact gap this signature was built to close.
        """
        path = tmp_path / "config.yaml"
        path.write_bytes(b"AAAAAAAAAAAAAAAAAA")  # 18 bytes
        first_mtime, first_size, first_digest = get_config_signature(path)

        path.write_bytes(b"BBBBBBBBBBBBBBBBBB")  # 18 bytes
        stat = path.stat()
        os.utime(path, (stat.st_atime, first_mtime))  # restore the mtime

        mtime, size, digest = get_config_signature(path)

        assert size == first_size  # byte-identical length
        assert mtime == pytest.approx(first_mtime)
        assert digest != first_digest  # content swap caught by sha256 only

    def test_unreadable_content_yields_partial_signature(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / "config.yaml"
        path.write_bytes(b"content")

        def deny_open(*args: object, **kwargs: object) -> None:
            raise OSError("permission denied")

        monkeypatch.setattr(Path, "open", deny_open)

        mtime, size, digest = get_config_signature(path)

        assert isinstance(mtime, float)
        assert size == 7
        assert digest is None

    def test_large_file_chunked_hashing(self, tmp_path: Path) -> None:
        # 2 MiB of payload plus a short tail: exercises the 1 MiB chunk loop.
        content = b"\x00" * (2 * 1024 * 1024) + b"tail"
        path = tmp_path / "big.yaml"
        path.write_bytes(content)

        _, _, digest = get_config_signature(path)

        assert digest == hashlib.sha256(content).hexdigest()
