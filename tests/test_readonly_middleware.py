"""Tests for read-only middleware that blocks write operations.

These tests verify that write operations are properly blocked when
STACKPORT_ALLOW_WRITES is not set or explicitly False.
"""

import os

os.environ["AWS_ENDPOINT_URL"] = "http://localhost:4566"

from unittest.mock import patch

from fastapi.testclient import TestClient


class TestReadOnlyMiddleware:
    """Test read-only middleware blocks writes when disabled."""

    def test_get_requests_allowed_when_writes_disabled(self):
        """GET requests work when writes are disabled."""
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            from backend.main import app

            client = TestClient(app, raise_server_exceptions=False)

            resp = client.get("/api/health")
            assert resp.status_code == 200

            resp = client.get("/api/stats")
            assert resp.status_code == 200

            resp = client.get("/api/tags/supported")
            assert resp.status_code == 200

    def test_post_blocked_when_writes_disabled(self):
        """POST requests (excluding read-only patterns) are blocked."""
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            from backend.main import app

            client = TestClient(app, raise_server_exceptions=False)

            resp = client.post("/api/s3/buckets/test-bucket/objects", json={})
            assert resp.status_code == 403
            assert "disabled" in resp.json()["detail"].lower()

    def test_put_blocked_when_writes_disabled(self):
        """PUT requests are blocked when writes are disabled."""
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            from backend.main import app

            client = TestClient(app, raise_server_exceptions=False)

            resp = client.put("/api/tags/s3/buckets/test-bucket", json={"tags": {}})
            assert resp.status_code == 403
            assert "disabled" in resp.json()["detail"].lower()

    def test_delete_blocked_when_writes_disabled(self):
        """DELETE requests are blocked when writes are disabled."""
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            from backend.main import app

            client = TestClient(app, raise_server_exceptions=False)

            resp = client.delete("/api/s3/buckets/test-bucket/objects/test.txt")
            assert resp.status_code == 403
            assert "disabled" in resp.json()["detail"].lower()

    def test_read_only_post_patterns_allowed(self):
        """Read-only POST operations (query, invoke) are allowed even when writes disabled."""
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            from backend.main import app

            client = TestClient(app, raise_server_exceptions=False)

            # DynamoDB query is a read operation using POST
            resp = client.post(
                "/api/dynamodb/tables/test-table/query",
                json={"partition_key_value": "test"},
            )
            # Should NOT be blocked by middleware (will fail at handler, but not 403)
            assert resp.status_code != 403

            # Lambda invoke is a read operation using POST
            resp = client.post(
                "/api/lambda/functions/test-func/invoke",
                json={"payload": {}},
            )
            # Should NOT be blocked by middleware
            assert resp.status_code != 403

    def test_writes_allowed_when_enabled(self):
        """All write operations work when STACKPORT_ALLOW_WRITES=true."""
        with patch("backend.main.STACKPORT_ALLOW_WRITES", True):
            from backend.main import app

            client = TestClient(app, raise_server_exceptions=False)

            # Write operations should pass middleware
            resp = client.post("/api/bulk/tag", json={"action": "add", "tags": {}, "resources": []})
            # Should get 400 from handler (empty resources), not 403 from middleware
            assert resp.status_code != 403

            resp = client.put("/api/tags/s3/buckets/test-bucket", json={"tags": {}})
            # Should NOT be blocked by middleware
            assert resp.status_code != 403
