"""Tests for multi-endpoint support."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from unittest.mock import MagicMock, patch

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
        monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
        importlib.reload(backend.config)

    def test_empty_url_means_real_aws(self, monkeypatch):
        """Test that name= (empty URL) maps to None for real AWS."""
        monkeypatch.setenv("STACKPORT_ENDPOINTS", "local=http://localhost:4566,nprod=")

        import importlib

        import backend.config

        importlib.reload(backend.config)

        assert len(backend.config.ENDPOINTS) == 2
        assert backend.config.ENDPOINTS["local"] == "http://localhost:4566"
        assert backend.config.ENDPOINTS["nprod"] is None

        monkeypatch.delenv("STACKPORT_ENDPOINTS")
        importlib.reload(backend.config)


class TestAddEndpoint:
    """Test POST /api/endpoints."""

    @patch("backend.routes.endpoints.endpoint_store")
    @patch("backend.websocket.broadcast_endpoints_changed")
    def test_add_endpoint_returns_201(self, mock_broadcast, mock_store, client):
        """Test creating endpoint returns 201."""
        mock_store.add.return_value = None
        mock_store.get.return_value = {
            "url": "http://new-endpoint:4566",
            "source": "user",
            "region": None,
        }

        resp = client.post(
            "/api/endpoints",
            json={"name": "new-endpoint", "url": "http://new-endpoint:4566"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "new-endpoint"
        assert data["url"] == "http://new-endpoint:4566"
        assert data["source"] == "user"

    @patch("backend.routes.endpoints.endpoint_store")
    def test_add_endpoint_duplicate_returns_409(self, mock_store, client):
        """Test duplicate endpoint name returns 409."""
        mock_store.add.side_effect = ValueError("Endpoint 'duplicate' already exists")

        resp = client.post(
            "/api/endpoints",
            json={"name": "duplicate", "url": "http://dup:4566"},
        )
        assert resp.status_code == 409
        assert "already exists" in resp.json()["detail"]

    @patch("backend.routes.endpoints.endpoint_store")
    def test_add_endpoint_invalid_name_returns_422(self, mock_store, client):
        """Test invalid endpoint name returns 422."""
        mock_store.add.side_effect = ValueError("Invalid endpoint name")

        resp = client.post(
            "/api/endpoints",
            json={"name": "bad name", "url": "http://test:4566"},
        )
        assert resp.status_code == 422


class TestUpdateEndpoint:
    """Test PUT /api/endpoints/{name}."""

    @patch("backend.routes.endpoints.endpoint_store")
    @patch("backend.aws_client.get_client")
    @patch("backend.routes.endpoints.cache")
    @patch("backend.websocket.broadcast_endpoints_changed")
    def test_update_endpoint_url(self, mock_broadcast, mock_cache, mock_get_client, mock_store, client):
        """Test updating endpoint URL."""
        mock_store.get.side_effect = [
            {"url": "http://old:4566", "source": "user", "region": None},
            {"url": "http://new:4566", "source": "user", "region": None},
        ]
        mock_store.update.return_value = None

        resp = client.put(
            "/api/endpoints/test-endpoint",
            json={"url": "http://new:4566"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["url"] == "http://new:4566"

        # Verify cache was cleared
        mock_get_client.cache_clear.assert_called_once()
        mock_cache.delete_by_prefix.assert_called_once_with("http://old:4566:")

    @patch("backend.routes.endpoints.endpoint_store")
    def test_update_nonexistent_endpoint_returns_404(self, mock_store, client):
        """Test updating non-existent endpoint returns 404."""
        mock_store.get.return_value = None
        mock_store.update.side_effect = ValueError("Endpoint 'nonexistent' not found")

        resp = client.put(
            "/api/endpoints/nonexistent",
            json={"url": "http://new:4566"},
        )
        assert resp.status_code == 404


class TestDeleteEndpoint:
    """Test DELETE /api/endpoints/{name}."""

    @patch("backend.routes.endpoints.endpoint_store")
    @patch("backend.aws_client.get_client")
    @patch("backend.routes.endpoints.cache")
    @patch("backend.websocket.broadcast_endpoints_changed")
    @patch("backend.websocket.remove_endpoint_from_stats")
    def test_delete_endpoint(self, mock_remove, mock_broadcast, mock_cache, mock_get_client, mock_store, client):
        """Test deleting endpoint."""
        mock_store.get.return_value = {"url": "http://deleted:4566", "source": "user", "region": None}
        mock_store.remove.return_value = None

        resp = client.delete("/api/endpoints/test-endpoint")
        assert resp.status_code == 204

        # Verify cache and client cache cleared
        mock_get_client.cache_clear.assert_called_once()
        mock_cache.delete_by_prefix.assert_called_once_with("http://deleted:4566:")
        mock_remove.assert_called_once_with("http://deleted:4566")

    @patch("backend.routes.endpoints.endpoint_store")
    def test_delete_last_endpoint_returns_400(self, mock_store, client):
        """Test deleting last endpoint returns 400."""
        mock_store.get.return_value = {"url": "http://last:4566", "source": "user", "region": None}
        mock_store.remove.side_effect = ValueError("Cannot delete the last endpoint")

        resp = client.delete("/api/endpoints/last")
        assert resp.status_code == 400
        assert "last endpoint" in resp.json()["detail"]

    @patch("backend.routes.endpoints.endpoint_store")
    def test_delete_nonexistent_endpoint_returns_404(self, mock_store, client):
        """Test deleting non-existent endpoint returns 404."""
        mock_store.get.return_value = None
        mock_store.remove.side_effect = ValueError("Endpoint 'nonexistent' not found")

        resp = client.delete("/api/endpoints/nonexistent")
        assert resp.status_code == 404


class TestSetDefaultEndpoint:
    """Test PUT /api/endpoints/default."""

    @patch("backend.routes.endpoints.endpoint_store")
    @patch("backend.websocket.broadcast_endpoints_changed")
    def test_set_default_endpoint(self, mock_broadcast, mock_store, client):
        """Test setting default endpoint."""
        mock_store.set_default.return_value = None

        resp = client.put(
            "/api/endpoints/default",
            json={"name": "new-default"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["default"] == "new-default"

    @patch("backend.routes.endpoints.endpoint_store")
    def test_set_default_nonexistent_returns_404(self, mock_store, client):
        """Test setting non-existent default returns 404."""
        mock_store.set_default.side_effect = ValueError("Endpoint 'nonexistent' not found")

        resp = client.put(
            "/api/endpoints/default",
            json={"name": "nonexistent"},
        )
        assert resp.status_code == 404


class TestEndpointHealth:
    """Test POST /api/endpoints/{name}/health."""

    @patch("backend.routes.endpoints.endpoint_store")
    @patch("backend.routes.endpoints.get_client")
    def test_check_endpoint_health_healthy(self, mock_get_client, mock_store, client):
        """Test health check returns healthy status."""
        mock_store.get.return_value = {"url": "http://test:4566", "source": "user", "region": None}
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.list_buckets.return_value = {}

        resp = client.post("/api/endpoints/test-endpoint/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["health"] == "healthy"
        assert data["name"] == "test-endpoint"
        assert data["url"] == "http://test:4566"
        assert data["error"] is None

    @patch("backend.routes.endpoints.endpoint_store")
    @patch("backend.routes.endpoints.get_client")
    def test_check_endpoint_health_unhealthy(self, mock_get_client, mock_store, client):
        """Test health check returns unhealthy status on error."""
        mock_store.get.return_value = {"url": "http://test:4566", "source": "user", "region": None}
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.list_buckets.side_effect = Exception("Connection failed")

        resp = client.post("/api/endpoints/test-endpoint/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["health"] == "unhealthy"
        assert "Connection failed" in data["error"]

    @patch("backend.routes.endpoints.endpoint_store")
    def test_check_health_nonexistent_returns_404(self, mock_store, client):
        """Test health check for non-existent endpoint returns 404."""
        mock_store.get.return_value = None

        resp = client.post("/api/endpoints/nonexistent/health")
        assert resp.status_code == 404


class TestReadOnlyMiddlewareEndpoints:
    """Test ReadOnlyMiddleware allows endpoint CRUD methods."""

    def test_endpoint_crud_allowed_when_writes_disabled(self):
        """Test endpoint management works when STACKPORT_ALLOW_WRITES=false."""
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            from backend.main import app

            client = TestClient(app, raise_server_exceptions=False)

            # GET should work
            resp = client.get("/api/endpoints")
            assert resp.status_code == 200

            # POST should work (will fail at handler level if mocked incorrectly, but NOT 403)
            with patch("backend.routes.endpoints.endpoint_store") as mock_store:
                mock_store.add.side_effect = ValueError("Duplicate")
                resp = client.post("/api/endpoints", json={"name": "test", "url": "http://test:1234"})
                assert resp.status_code != 403

            # PUT should work
            with patch("backend.routes.endpoints.endpoint_store") as mock_store:
                mock_store.get.return_value = None
                mock_store.update.side_effect = ValueError("Not found")
                resp = client.put("/api/endpoints/test", json={"url": "http://new:1234"})
                assert resp.status_code != 403

            # DELETE should work
            with patch("backend.routes.endpoints.endpoint_store") as mock_store:
                mock_store.get.return_value = None
                mock_store.remove.side_effect = ValueError("Not found")
                resp = client.delete("/api/endpoints/test")
                assert resp.status_code != 403


class TestCacheClearingOnEndpointChange:
    """Test cache invalidation on endpoint modifications."""

    @patch("backend.routes.endpoints.endpoint_store")
    @patch("backend.aws_client.get_client")
    @patch("backend.routes.endpoints.cache")
    @patch("backend.websocket.broadcast_endpoints_changed")
    def test_cache_cleared_after_update(self, mock_broadcast, mock_cache, mock_get_client, mock_store, client):
        """Test cache is cleared after endpoint update."""
        mock_store.get.side_effect = [
            {"url": "http://old:4566", "source": "user", "region": None},
            {"url": "http://new:4566", "source": "user", "region": None},
        ]

        resp = client.put("/api/endpoints/test", json={"url": "http://new:4566"})
        assert resp.status_code == 200

        # Verify get_client cache cleared
        mock_get_client.cache_clear.assert_called_once()
        # Verify stats cache cleared for old URL
        mock_cache.delete_by_prefix.assert_called_once_with("http://old:4566:")

    @patch("backend.routes.endpoints.endpoint_store")
    @patch("backend.aws_client.get_client")
    @patch("backend.routes.endpoints.cache")
    @patch("backend.websocket.broadcast_endpoints_changed")
    @patch("backend.websocket.remove_endpoint_from_stats")
    def test_cache_cleared_after_delete(self, mock_remove, mock_broadcast, mock_cache, mock_get_client, mock_store, client):
        """Test cache is cleared after endpoint deletion."""
        mock_store.get.return_value = {"url": "http://deleted:4566", "source": "user", "region": None}

        resp = client.delete("/api/endpoints/test")
        assert resp.status_code == 204

        # Verify get_client cache cleared
        mock_get_client.cache_clear.assert_called_once()
        # Verify stats cache cleared for deleted URL
        mock_cache.delete_by_prefix.assert_called_once_with("http://deleted:4566:")
        # Verify WebSocket stats tracking cleared
        mock_remove.assert_called_once_with("http://deleted:4566")
