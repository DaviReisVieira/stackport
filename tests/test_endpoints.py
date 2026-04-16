"""Tests for multi-endpoint support."""

import os

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


class TestEndpoints:
    """Test endpoint configuration and routing."""

    def test_endpoints_route_returns_list(self, client):
        """Test /api/endpoints returns endpoint configuration."""
        response = client.get("/api/endpoints")
        assert response.status_code == 200
        data = response.json()
        assert "endpoints" in data
        assert isinstance(data["endpoints"], list)
        assert len(data["endpoints"]) >= 1
        # Check first endpoint structure
        endpoint = data["endpoints"][0]
        assert "name" in endpoint
        assert "url" in endpoint
        assert "health" in endpoint

    def test_default_endpoint_configuration(self, client):
        """Test default endpoint is configured when STACKPORT_ENDPOINTS is not set."""
        response = client.get("/api/endpoints")
        data = response.json()
        # Should have at least one endpoint (default)
        assert len(data["endpoints"]) >= 1
        # First endpoint should be "default"
        assert data["endpoints"][0]["name"] == "default"

    def test_stats_without_endpoint_param(self, client):
        """Test /api/stats works without endpoint query param (uses default)."""
        response = client.get("/api/stats")
        assert response.status_code == 200
        data = response.json()
        assert "services" in data

    def test_resources_without_endpoint_param(self, client):
        """Test /api/resources works without endpoint query param (uses default)."""
        response = client.get("/api/resources/s3")
        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "s3"
        assert "resources" in data


class TestEndpointParsing:
    """Test STACKPORT_ENDPOINTS parsing."""

    def test_parse_endpoints_from_env(self, monkeypatch):
        """Test parsing STACKPORT_ENDPOINTS env var."""
        monkeypatch.setenv("STACKPORT_ENDPOINTS", "local=http://localhost:4566,moto=http://localhost:5000")

        # Re-import to pick up env change
        import importlib

        import backend.config

        importlib.reload(backend.config)

        assert len(backend.config.ENDPOINTS) == 2
        assert "local" in backend.config.ENDPOINTS
        assert "moto" in backend.config.ENDPOINTS
        assert backend.config.ENDPOINTS["local"] == "http://localhost:4566"
        assert backend.config.ENDPOINTS["moto"] == "http://localhost:5000"

        # Restore
        monkeypatch.delenv("STACKPORT_ENDPOINTS")
        importlib.reload(backend.config)

    def test_default_endpoint_when_not_configured(self, monkeypatch):
        """Test default endpoint when STACKPORT_ENDPOINTS is not set."""
        monkeypatch.delenv("STACKPORT_ENDPOINTS", raising=False)
        monkeypatch.setenv("AWS_ENDPOINT_URL", "http://test:1234")

        import importlib

        import backend.config

        importlib.reload(backend.config)

        assert len(backend.config.ENDPOINTS) == 1
        assert "default" in backend.config.ENDPOINTS
        assert backend.config.ENDPOINTS["default"] == "http://test:1234"

        # Restore
        importlib.reload(backend.config)
