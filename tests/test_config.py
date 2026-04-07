import os


class TestConfig:
    def test_defaults(self):
        """Config module provides sensible defaults."""
        from backend.config import (
            AWS_ACCESS_KEY_ID,
            AWS_ENDPOINT_URL,
            AWS_REGION,
            AWS_SECRET_ACCESS_KEY,
            STACKPORT_PORT,
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
