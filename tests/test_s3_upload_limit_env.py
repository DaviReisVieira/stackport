"""Tests for STACKPORT_S3_MAX_UPLOAD_MB (MiB-only)."""

from backend.config import (
    _DEFAULT_S3_MAX_UPLOAD_BYTES,
    _DEFAULT_S3_MAX_UPLOAD_MB,
    _MIB,
    _parse_s3_max_upload_bytes_from_env,
)


class TestParseS3MaxUploadLimitFromEnv:
    def test_mb_custom(self):
        v = _parse_s3_max_upload_bytes_from_env(
            {"STACKPORT_S3_MAX_UPLOAD_MB": "1000"},
        )
        assert v == 1000 * _MIB

    def test_neither_set_uses_default(self):
        assert _parse_s3_max_upload_bytes_from_env({}) == _DEFAULT_S3_MAX_UPLOAD_BYTES
        assert _DEFAULT_S3_MAX_UPLOAD_BYTES == _DEFAULT_S3_MAX_UPLOAD_MB * _MIB

    def test_explicit_default_mb(self):
        assert (
            _parse_s3_max_upload_bytes_from_env({"STACKPORT_S3_MAX_UPLOAD_MB": "100"})
            == _DEFAULT_S3_MAX_UPLOAD_BYTES
        )

    def test_invalid_mb_returns_default(self):
        assert (
            _parse_s3_max_upload_bytes_from_env({"STACKPORT_S3_MAX_UPLOAD_MB": "x"})
            == _DEFAULT_S3_MAX_UPLOAD_BYTES
        )

    def test_empty_mb_uses_default(self):
        assert (
            _parse_s3_max_upload_bytes_from_env({"STACKPORT_S3_MAX_UPLOAD_MB": ""})
            == _DEFAULT_S3_MAX_UPLOAD_BYTES
        )
