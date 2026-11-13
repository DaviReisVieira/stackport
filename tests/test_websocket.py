"""Tests for WebSocket support."""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from backend import websocket
from backend.connection import EndpointInfo
from backend.endpoint_store import EndpointStore
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
        await mgr.send_to([], {"type": "stats", "data": {}})


@pytest.fixture
def two_saved_endpoints_on_one_url(tmp_path, monkeypatch):
    """Two saved endpoints on one URL, one of them with its own region and TLS settings."""
    store = EndpointStore(tmp_path / "endpoints.json", {"plain": "http://shared:4566"})
    store.add("strict", "http://shared:4566", region="eu-west-1", tls_verify=False)
    monkeypatch.setattr("backend.routes.common.endpoint_store", store)
    monkeypatch.setattr(websocket, "manager", ConnectionManager())
    monkeypatch.setattr(websocket, "_last_stats_by_scope", {})
    return store


def _socket():
    ws = MagicMock()
    ws.send_text = AsyncMock()
    return ws


def _stats_sent(ws):
    return [json.loads(call.args[0])["data"] for call in ws.send_text.await_args_list]


def _fake_collect(calls):
    def collect(ep):
        calls.append(ep)
        return {"region": ep.region, "tls_verify": ep.tls_verify}

    return collect


class TestProbeOnce:
    @pytest.mark.anyio
    async def test_saved_endpoints_sharing_a_url_get_their_own_probe_and_stats(
        self, two_saved_endpoints_on_one_url, monkeypatch
    ):
        calls = []
        monkeypatch.setattr(websocket, "collect_stats", _fake_collect(calls))
        plain, strict = _socket(), _socket()
        websocket.manager.active_connections.update({plain: "plain", strict: "strict"})

        await websocket.probe_once()

        assert sorted((ep.region or "", ep.tls_verify) for ep in calls) == [("", True), ("eu-west-1", False)]
        assert _stats_sent(plain) == [{"region": None, "tls_verify": True}]
        assert _stats_sent(strict) == [{"region": "eu-west-1", "tls_verify": False}]

    @pytest.mark.anyio
    async def test_each_scope_is_probed_once_however_many_subscribe(
        self, two_saved_endpoints_on_one_url, monkeypatch
    ):
        calls = []
        monkeypatch.setattr(websocket, "collect_stats", _fake_collect(calls))
        sockets = [_socket() for _ in range(3)]
        for ws in sockets:
            websocket.manager.active_connections[ws] = "strict"
        by_url = _socket()
        websocket.manager.active_connections[by_url] = "http://shared:4566"

        await websocket.probe_once()

        assert len(calls) == 2
        for ws in sockets:
            assert _stats_sent(ws) == [{"region": "eu-west-1", "tls_verify": False}]
        # A direct URL is its own endpoint: no saved settings apply
        assert _stats_sent(by_url) == [{"region": None, "tls_verify": True}]

    @pytest.mark.anyio
    async def test_disconnected_client_stops_being_probed(self, two_saved_endpoints_on_one_url, monkeypatch):
        calls = []
        monkeypatch.setattr(websocket, "collect_stats", _fake_collect(calls))
        ws = _socket()
        websocket.manager.active_connections[ws] = "strict"
        await websocket.probe_once()
        assert len(calls) == 1

        websocket.manager.disconnect(ws)
        await websocket.probe_once()

        assert len(calls) == 1
        assert websocket._last_stats_by_scope == {}

    @pytest.mark.anyio
    async def test_failed_send_drops_the_client(self, two_saved_endpoints_on_one_url, monkeypatch):
        monkeypatch.setattr(websocket, "collect_stats", _fake_collect([]))
        gone = _socket()
        gone.send_text.side_effect = RuntimeError("closed")
        websocket.manager.active_connections[gone] = "plain"

        await websocket.probe_once()

        assert gone not in websocket.manager.active_connections

    @pytest.mark.anyio
    async def test_a_failing_probe_does_not_stop_the_others(self, two_saved_endpoints_on_one_url, monkeypatch):
        def collect(ep):
            if ep.region is None:
                raise RuntimeError("boom")
            return {"region": ep.region}

        monkeypatch.setattr(websocket, "collect_stats", collect)
        plain, strict = _socket(), _socket()
        websocket.manager.active_connections.update({plain: "plain", strict: "strict"})

        await websocket.probe_once()

        assert _stats_sent(plain) == []
        assert _stats_sent(strict) == [{"region": "eu-west-1"}]

    @pytest.mark.anyio
    async def test_edited_endpoint_is_followed_under_its_new_settings(
        self, two_saved_endpoints_on_one_url, monkeypatch
    ):
        calls = []
        monkeypatch.setattr(websocket, "collect_stats", _fake_collect(calls))
        ws = _socket()
        websocket.manager.active_connections[ws] = "strict"
        await websocket.probe_once()

        two_saved_endpoints_on_one_url.update("strict", region="ap-south-1")
        websocket.remove_endpoint_from_stats("http://shared:4566")
        await websocket.probe_once()

        assert [ep.region for ep in calls] == ["eu-west-1", "ap-south-1"]
        assert _stats_sent(ws)[-1] == {"region": "ap-south-1", "tls_verify": False}
        assert len(websocket._last_stats_by_scope) == 1

    def test_remove_endpoint_from_stats_keeps_other_urls(self, monkeypatch):
        scopes = [
            "http://a:1:None:default:None:None:True:None",
            "http://a:1:eu-west-1:default:None:None:False:None",
            "http://a:10:None:default:None:None:True:None",
        ]
        monkeypatch.setattr(websocket, "_last_stats_by_scope", dict.fromkeys(scopes, {}))

        websocket.remove_endpoint_from_stats("http://a:1")

        assert list(websocket._last_stats_by_scope) == [scopes[2]]


class TestSubscribe:
    def test_subscribers_get_the_stats_of_the_endpoint_they_named(self, two_saved_endpoints_on_one_url, client):
        strict_scope = EndpointInfo.from_entry(two_saved_endpoints_on_one_url.get("strict")).cache_scope()
        websocket._last_stats_by_scope[strict_scope] = {"region": "eu-west-1"}

        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({"type": "subscribe", "endpoint": "plain"}))
            ws.send_text(json.dumps({"type": "subscribe", "endpoint": "strict"}))
            assert json.loads(ws.receive_text()) == {"type": "stats", "data": {"region": "eu-west-1"}}
            assert list(websocket.manager.active_connections.values()) == ["strict"]

    def test_connection_is_forgotten_on_disconnect(self, two_saved_endpoints_on_one_url, client):
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({"type": "subscribe", "endpoint": "strict"}))
            ws.send_text(json.dumps({"type": "unsubscribe"}))
            assert len(websocket.manager.active_connections) == 1

        assert websocket.manager.active_connections == {}

    def test_invalid_direct_url_is_answered_with_an_error_and_not_kept(self, two_saved_endpoints_on_one_url, client):
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({"type": "subscribe", "endpoint": "http://evil.test\\@127.0.0.1:2"}))
            message = json.loads(ws.receive_text())
            assert message["type"] == "error"
            assert list(websocket.manager.active_connections.values()) == [None]
