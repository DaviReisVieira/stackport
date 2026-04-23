import os


class TestConfig:
    def test_defaults(self):
        """Config module provides sensible defaults."""
        from backend.config import (
            AWS_ACCESS_KEY_ID,
            AWS_ENDPOINT_URL,
            AWS_REGION,
            AWS_SECRET_ACCESS_KEY,
            STACKPORT_CACHE_TTL,
            STACKPORT_PORT,
            STACKPORT_PROBE_TIMEOUT,
            STACKPORT_PROBE_WORKERS,
            STACKPORT_SERVICES,
        )

        assert AWS_ENDPOINT_URL  # non-empty
        assert AWS_REGION  # non-empty
        assert AWS_ACCESS_KEY_ID  # non-empty
        assert AWS_SECRET_ACCESS_KEY  # non-empty
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
