"""Unit tests for qilin.trace_context."""

from qilin.trace_context import (
    ensure_trace_context,
    generate_trace_id,
    get_current_trace_id,
    is_trace_id_from_request_header,
    mark_trace_id_from_request_header,
    normalize_trace_id,
    request_trace_context,
    reset_current_trace_id,
    reset_trace_id_from_request_header,
    resolve_qilin_trace_id,
    set_current_trace_id,
)


class TestGenerateTraceId:
    def test_returns_32_hex_chars(self):
        trace_id = generate_trace_id()
        assert len(trace_id) == 32
        assert all(c in "0123456789abcdef" for c in trace_id)

    def test_ids_are_unique(self):
        assert generate_trace_id() != generate_trace_id()


class TestNormalizeTraceId:
    def test_accepts_printable_ascii(self):
        assert normalize_trace_id("abc-123_XYZ") == "abc-123_XYZ"

    def test_strips_whitespace(self):
        assert normalize_trace_id("  abcd  ") == "abcd"

    def test_rejects_non_string(self):
        assert normalize_trace_id(123) is None
        assert normalize_trace_id(None) is None
        assert normalize_trace_id(b"abc") is None

    def test_rejects_empty_and_blank(self):
        assert normalize_trace_id("") is None
        assert normalize_trace_id("   ") is None

    def test_rejects_oversized(self):
        assert normalize_trace_id("x" * 513) is None
        assert normalize_trace_id("x" * 512) == "x" * 512

    def test_rejects_control_characters(self):
        assert normalize_trace_id("abc\ndef") is None
        assert normalize_trace_id("abc\x00") is None

    def test_rejects_non_ascii(self):
        # Codepoints above 0x7E would break latin-1 header encoding.
        assert normalize_trace_id("abc\u00ff") is None
        assert normalize_trace_id("中文") is None


class TestCurrentTraceId:
    def test_unset_by_default(self):
        assert get_current_trace_id() is None

    def test_set_get_reset(self):
        token = set_current_trace_id("trace-1")
        assert get_current_trace_id() == "trace-1"
        reset_current_trace_id(token)
        assert get_current_trace_id() is None

    def test_set_normalizes_invalid_value(self):
        token = set_current_trace_id("bad\u00ffvalue")
        assert get_current_trace_id() is not None
        assert get_current_trace_id() != "bad\u00ffvalue"
        reset_current_trace_id(token)

    def test_request_trace_context(self):
        with request_trace_context("ctx-1") as trace_id:
            assert trace_id == "ctx-1"
            assert get_current_trace_id() == "ctx-1"
        assert get_current_trace_id() is None

    def test_request_trace_context_generates_when_missing(self):
        with request_trace_context() as trace_id:
            assert len(trace_id) == 32
            assert get_current_trace_id() == trace_id

    def test_ensure_trace_context_inherits(self):
        with request_trace_context("parent"):
            with ensure_trace_context() as trace_id:
                assert trace_id == "parent"
                assert get_current_trace_id() == "parent"

    def test_ensure_trace_context_generates_when_none(self):
        with ensure_trace_context() as trace_id:
            assert len(trace_id) == 32


class TestHeaderFlagAndResolution:
    def test_header_flag_default_false(self):
        assert is_trace_id_from_request_header() is False

    def test_header_flag_set_reset(self):
        token = mark_trace_id_from_request_header(from_header=True)
        assert is_trace_id_from_request_header() is True
        reset_trace_id_from_request_header(token)
        assert is_trace_id_from_request_header() is False

    def test_resolve_prefers_header(self):
        token = mark_trace_id_from_request_header(from_header=True)
        with request_trace_context("from-header"):
            assert resolve_qilin_trace_id("from-metadata") == "from-header"
        reset_trace_id_from_request_header(token)

    def test_resolve_uses_metadata_without_header(self):
        assert resolve_qilin_trace_id("  from-metadata  ") == "from-metadata"

    def test_resolve_falls_back_to_ambient(self):
        with request_trace_context("ambient"):
            assert resolve_qilin_trace_id(None) == "ambient"

    def test_resolve_rejects_bad_metadata(self):
        with request_trace_context("ambient"):
            assert resolve_qilin_trace_id("bad\nid") == "ambient"
