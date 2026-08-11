"""Unit tests for qilin.reflection.resolvers (module path resolution)."""

import datetime
import os
from pathlib import Path

import pytest

from qilin.reflection.resolvers import resolve_class, resolve_variable


class TestResolveVariable:
    def test_resolves_existing_attribute(self) -> None:
        assert resolve_variable("os:sep") == os.sep

    def test_expected_type_passes(self) -> None:
        assert resolve_variable("os:sep", expected_type=str) == os.sep

    def test_expected_type_tuple_passes(self) -> None:
        assert resolve_variable("os:sep", expected_type=(int, str)) == os.sep

    def test_missing_colon_raises_importerror(self) -> None:
        with pytest.raises(ImportError, match="doesn't look like a variable path"):
            resolve_variable("just_a_path")

    def test_missing_module_gets_install_hint(self) -> None:
        with pytest.raises(ImportError, match="Install it with `uv add"):
            resolve_variable("qilin_nonexistent_pkg:thing")

    def test_missing_attribute_raises_importerror(self) -> None:
        with pytest.raises(ImportError, match="does not define a no_such_attr"):
            resolve_variable("os:no_such_attr")

    def test_wrong_type_raises_valueerror(self) -> None:
        with pytest.raises(ValueError, match="not an instance of int"):
            resolve_variable("os:sep", expected_type=int)

    def test_module_internal_import_error_is_preserved(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A module that raises a plain ImportError (not ModuleNotFoundError)
        # must surface its original message rather than a dependency hint.
        bad_dir = tmp_path / "badmods"
        bad_dir.mkdir()
        (bad_dir / "broken_mod.py").write_text("raise ImportError('boom')\n")
        monkeypatch.syspath_prepend(str(bad_dir))

        with pytest.raises(ImportError, match="Error importing module broken_mod: boom"):
            resolve_variable("broken_mod:thing")


class TestResolveClass:
    def test_resolves_class(self) -> None:
        assert resolve_class("datetime:datetime") is datetime.datetime

    def test_non_class_object_raises(self) -> None:
        with pytest.raises(ValueError, match="not an instance of type"):
            resolve_class("os:sep")

    def test_not_a_subclass_raises(self) -> None:
        with pytest.raises(ValueError, match="not a subclass of str"):
            resolve_class("datetime:datetime", base_class=str)

    def test_valid_subclass_passes(self) -> None:
        assert resolve_class("datetime:datetime", base_class=datetime.date) is (
            datetime.datetime
        )
