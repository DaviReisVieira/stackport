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

    def test_dynamodb_item_write_post_blocked_when_writes_disabled(self):
        """POST to item write paths must be blocked (not whitelisted like /query)."""
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            from backend.main import app

            client = TestClient(app, raise_server_exceptions=False)

            resp = client.post(
                "/api/dynamodb/tables/t/items",
                json={"item": {"pk": {"S": "a"}}, "item_format": "dynamodb"},
            )
            assert resp.status_code == 403
            assert "disabled" in resp.json()["detail"].lower()

            resp = client.post(
                "/api/dynamodb/tables/t/items/batch",
                json={"requests": []},
            )
            assert resp.status_code == 403

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


class TestStreamingThroughTheMiddleware:
    """A stream that fails halfway must not reach the client looking complete (#Lambda/S3 downloads)."""

    @staticmethod
    async def _run(app) -> list[dict]:
        import asyncio

        sent: list[dict] = []
        request_sent = False
        never = asyncio.Event()

        async def receive():
            # The request body once, then block like a client that stays connected.
            nonlocal request_sent
            if not request_sent:
                request_sent = True
                return {"type": "http.request", "body": b"", "more_body": False}
            await never.wait()

        async def send(message):
            sent.append(message)

        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
                 "scheme": "http", "path": "/stream", "raw_path": b"/stream", "query_string": b"",
                 "root_path": "", "headers": [], "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 80)}
        try:
            await app(scope, receive, send)
        except RuntimeError:
            pass  # the server drops the connection; what matters is what was sent before
        return sent

    def test_failed_stream_is_not_finished(self):
        import asyncio

        from fastapi import FastAPI
        from fastapi.responses import StreamingResponse

        from backend.main import ReadOnlyMiddleware

        inner = FastAPI()

        @inner.get("/stream")
        def stream():
            def chunks():
                yield b"first half"
                raise RuntimeError("upstream went away")

            return StreamingResponse(chunks(), media_type="application/zip")

        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            sent = asyncio.run(self._run(ReadOnlyMiddleware(inner)))

        bodies = [m for m in sent if m["type"] == "http.response.body"]
        assert bodies and bodies[0]["body"] == b"first half"
        # A final message with more_body False is what tells the server the body is complete.
        assert not any(m.get("more_body") is False for m in bodies)
