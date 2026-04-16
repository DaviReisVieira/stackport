"""Tests for WebSocket support."""

import json

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.websocket import ConnectionManager


@pytest.fixture
def client():
    return TestClient(app)


class TestWebSocketConnection:
    """Test WebSocket endpoint."""

    def test_websocket_connect_and_disconnect(self, client):
        """Test basic WebSocket connection lifecycle."""
        with client.websocket_connect("/ws") as ws:
            # Connection should be established
            # Send a subscribe message
            ws.send_text(json.dumps({"type": "subscribe", "services": ["all"]}))

    def test_websocket_receives_subscribe(self, client):
        """Test that server accepts subscribe messages."""
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({"type": "subscribe", "services": ["s3", "lambda"]}))
            # No error means the message was accepted

    def test_websocket_handles_invalid_json(self, client):
        """Test that server handles invalid JSON gracefully."""
        with client.websocket_connect("/ws") as ws:
            ws.send_text("not valid json")
            # Should not crash — server ignores malformed messages

    def test_websocket_handles_unsubscribe(self, client):
        """Test that server accepts unsubscribe messages."""
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({"type": "unsubscribe", "services": ["dynamodb"]}))


class TestConnectionManager:
    """Test the ConnectionManager class."""

    def test_initial_state(self):
        """Test that manager starts with no connections."""
        mgr = ConnectionManager()
        assert len(mgr.active_connections) == 0

    @pytest.mark.anyio
    async def test_broadcast_empty(self):
        """Test broadcast with no connections does nothing."""
        mgr = ConnectionManager()
        # Should not raise
        await mgr.broadcast({"type": "stats", "data": {}})
