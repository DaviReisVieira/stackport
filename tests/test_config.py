import os


class TestConfig:
    def test_defaults(self):
        """Config module provides sensible defaults."""
        # conftest.py sets STACKPORT_ALLOW_WRITES=true for test convenience
        # Test the actual default (false) by temporarily unsetting it
        import os

        original = os.environ.pop("STACKPORT_ALLOW_WRITES", None)
        import importlib

        import backend.config

        importlib.reload(backend.config)

        from backend.config import (
            AWS_ACCESS_KEY_ID,
            AWS_ENDPOINT_URL,
            AWS_REGION,
            AWS_SECRET_ACCESS_KEY,
            STACKPORT_ALLOW_WRITES,
            STACKPORT_CACHE_TTL,
            STACKPORT_PORT,
            STACKPORT_PROBE_TIMEOUT,
            STACKPORT_PROBE_WORKERS,
            STACKPORT_SERVICES,
        )

        # AWS_ENDPOINT_URL is now optional (None = real AWS)
        assert AWS_ENDPOINT_URL is None or isinstance(AWS_ENDPOINT_URL, str)
        assert AWS_REGION  # non-empty
        # Credentials are now optional (None = use default AWS credential chain)
        assert AWS_ACCESS_KEY_ID is None or isinstance(AWS_ACCESS_KEY_ID, str)
        assert AWS_SECRET_ACCESS_KEY is None or isinstance(AWS_SECRET_ACCESS_KEY, str)
        # Writes disabled by default
        assert STACKPORT_ALLOW_WRITES is False

        # Restore original value
        if original is not None:
            os.environ["STACKPORT_ALLOW_WRITES"] = original
        importlib.reload(backend.config)
        assert isinstance(STACKPORT_PORT, int)
        assert STACKPORT_PORT > 0
        # Services string should contain known services
        services = [s.strip() for s in STACKPORT_SERVICES.split(",")]
        assert "s3" in services
        assert "dynamodb" in services
        assert "lambda" in services
        assert len(services) >= 30  # at least 30 services configured
        # Probe and cache defaults
        assert isinstance(STACKPORT_PROBE_TIMEOUT, int)
        assert STACKPORT_PROBE_TIMEOUT == 5
        assert isinstance(STACKPORT_CACHE_TTL, int)
        assert STACKPORT_CACHE_TTL == 5
        assert isinstance(STACKPORT_PROBE_WORKERS, int)
        assert STACKPORT_PROBE_WORKERS == 10

    def test_env_override(self, monkeypatch):
        """Config respects environment variable overrides."""
        monkeypatch.setenv("STACKPORT_PORT", "9999")
        # Re-import to pick up env change
        import importlib

        import backend.config

        importlib.reload(backend.config)
        assert backend.config.STACKPORT_PORT == 9999
        # Restore
        monkeypatch.delenv("STACKPORT_PORT")
        importlib.reload(backend.config)

    def test_probe_config_override(self, monkeypatch):
        """Probe and cache config respects environment variable overrides."""
        monkeypatch.setenv("STACKPORT_PROBE_TIMEOUT", "10")
        monkeypatch.setenv("STACKPORT_CACHE_TTL", "15")
        monkeypatch.setenv("STACKPORT_PROBE_WORKERS", "20")
        # Re-import to pick up env changes
        import importlib

        import backend.config

        importlib.reload(backend.config)
        assert backend.config.STACKPORT_PROBE_TIMEOUT == 10
        assert backend.config.STACKPORT_CACHE_TTL == 15
        assert backend.config.STACKPORT_PROBE_WORKERS == 20
        # Restore
        monkeypatch.delenv("STACKPORT_PROBE_TIMEOUT")
        monkeypatch.delenv("STACKPORT_CACHE_TTL")
        monkeypatch.delenv("STACKPORT_PROBE_WORKERS")
        importlib.reload(backend.config)

    def test_allow_writes_config(self, monkeypatch):
        """STACKPORT_ALLOW_WRITES parsing."""
        import importlib

        import backend.config

        # Test various truthy values
        for val in ("1", "true", "True", "TRUE", "yes", "Yes", "YES"):
            monkeypatch.setenv("STACKPORT_ALLOW_WRITES", val)
            importlib.reload(backend.config)
            assert backend.config.STACKPORT_ALLOW_WRITES is True, f"Failed for value: {val}"

        # Test falsy values
        for val in ("0", "false", "False", "no", "", "random"):
            monkeypatch.setenv("STACKPORT_ALLOW_WRITES", val)
            importlib.reload(backend.config)
            assert backend.config.STACKPORT_ALLOW_WRITES is False, f"Failed for value: {val}"

        # Test unset (default False)
        monkeypatch.delenv("STACKPORT_ALLOW_WRITES", raising=False)
        importlib.reload(backend.config)
        assert backend.config.STACKPORT_ALLOW_WRITES is False


class TestIsLocalEndpoint:
    def test_localhost_is_local(self):
        from backend.config import is_local_endpoint

        assert is_local_endpoint("http://localhost:4566") is True

    def test_127_is_local(self):
        from backend.config import is_local_endpoint

        assert is_local_endpoint("http://127.0.0.1:4566") is True

    def test_amazonaws_is_not_local(self):
        from backend.config import is_local_endpoint

        assert is_local_endpoint("https://s3.amazonaws.com") is False

    def test_none_falls_back_to_default_endpoint(self):
        from backend.config import DEFAULT_ENDPOINT, is_local_endpoint

        # None means "use DEFAULT_ENDPOINT", so result depends on that value
        if DEFAULT_ENDPOINT is None:
            assert is_local_endpoint(None) is False
        else:
            assert is_local_endpoint(None) is True  # test env uses localhost

    def test_docker_hostname_is_local(self):
        from backend.config import is_local_endpoint

        assert is_local_endpoint("http://localstack:4566") is True

    def test_minio_is_local(self):
        from backend.config import is_local_endpoint

        assert is_local_endpoint("http://minio:9000") is True

    def test_zero_addr_is_local(self):
        from backend.config import is_local_endpoint

        assert is_local_endpoint("http://0.0.0.0:4566") is True

    def test_real_aws_vpc_endpoint_is_not_local(self):
        from backend.config import is_local_endpoint

        assert is_local_endpoint("https://s3.us-west-2.amazonaws.com") is False
