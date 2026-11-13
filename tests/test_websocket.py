"""Tests for WebSocket support."""

import asyncio
import json
import threading
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from backend import websocket
from backend.connection import EndpointInfo
from backend.endpoint_store import EndpointStore
from backend.main import app
from backend.routes.common import UnknownEndpoint, endpoint_info_for
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

    def test_remove_endpoint_from_stats_matches_the_url_exactly(self, monkeypatch):
        snapshots = {
            "a": websocket._Snapshot("http://localhost", {}),
            "b": websocket._Snapshot("http://localhost", {}),
            "c": websocket._Snapshot("http://localhost:4566", {}),
        }
        monkeypatch.setattr(websocket, "_last_stats_by_scope", snapshots)

        websocket.remove_endpoint_from_stats("http://localhost")

        assert list(websocket._last_stats_by_scope) == ["c"]


class TestSubscribe:
    def test_subscribers_get_the_stats_of_the_endpoint_they_named(self, two_saved_endpoints_on_one_url, client):
        strict_scope = EndpointInfo.from_entry(two_saved_endpoints_on_one_url.get("strict")).cache_scope()
        websocket._last_stats_by_scope[strict_scope] = websocket._Snapshot("http://shared:4566", {"region": "eu-west-1"})

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


class _Gate:
    """Holds a fake probe until the test lets it finish."""

    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()

    def collect(self, ep):
        self.started.set()
        assert self.release.wait(5)
        return {"region": ep.region}


async def _wait_until(event):
    for _ in range(200):
        if event.is_set():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("the probe never started")


class TestProbeRaces:
    @pytest.mark.anyio
    async def test_client_that_switched_endpoint_mid_probe_gets_only_the_new_one(
        self, two_saved_endpoints_on_one_url, monkeypatch
    ):
        gate = _Gate()
        monkeypatch.setattr(websocket, "collect_stats", gate.collect)
        ws = _socket()
        websocket.manager.active_connections[ws] = "strict"

        cycle = asyncio.create_task(websocket.probe_once())
        await _wait_until(gate.started)
        websocket.manager.set_endpoint(ws, "plain")
        gate.release.set()
        await cycle

        assert _stats_sent(ws) == []

    @pytest.mark.anyio
    async def test_probe_started_before_an_edit_is_thrown_away(self, two_saved_endpoints_on_one_url, monkeypatch):
        gate = _Gate()
        monkeypatch.setattr(websocket, "collect_stats", gate.collect)
        ws = _socket()
        websocket.manager.active_connections[ws] = "strict"

        cycle = asyncio.create_task(websocket.probe_once())
        await _wait_until(gate.started)
        websocket.remove_endpoint_from_stats("http://shared:4566")
        gate.release.set()
        await cycle

        assert _stats_sent(ws) == []
        assert websocket._last_stats_by_scope == {}

    @pytest.mark.anyio
    async def test_a_slow_endpoint_does_not_hold_up_the_others(self, two_saved_endpoints_on_one_url, monkeypatch):
        plain_done = threading.Event()

        def collect(ep):
            if ep.region is None:
                plain_done.set()
                return {"region": None}
            # Only finishes if the other endpoint is probed while this one is still running
            assert plain_done.wait(5)
            return {"region": ep.region}

        monkeypatch.setattr(websocket, "collect_stats", collect)
        plain, strict = _socket(), _socket()
        websocket.manager.active_connections.update({strict: "strict", plain: "plain"})

        await websocket.probe_once()

        assert _stats_sent(plain) == [{"region": None}]
        assert _stats_sent(strict) == [{"region": "eu-west-1"}]


class TestProbeLoopSurvives:
    @pytest.mark.anyio
    async def test_a_failed_cycle_does_not_end_the_loop(self, monkeypatch):
        cycles = []

        async def failing_cycle():
            cycles.append(1)
            raise RuntimeError("boom")

        async def sleep(_):
            if len(cycles) == 3:
                raise asyncio.CancelledError

        monkeypatch.setattr(websocket, "probe_once", failing_cycle)
        monkeypatch.setattr(websocket.asyncio, "sleep", sleep)

        with pytest.raises(asyncio.CancelledError):
            await websocket.probe_loop()

        assert len(cycles) == 3

    @pytest.mark.anyio
    async def test_one_unresolvable_subscription_does_not_hide_the_others(
        self, two_saved_endpoints_on_one_url, monkeypatch
    ):
        real = websocket.endpoint_info_for

        def flaky(endpoint, **kwargs):
            if endpoint == "plain":
                raise RuntimeError("store unavailable")
            return real(endpoint, **kwargs)

        monkeypatch.setattr(websocket, "endpoint_info_for", flaky)
        monkeypatch.setattr(websocket, "collect_stats", _fake_collect([]))
        plain, strict = _socket(), _socket()
        websocket.manager.active_connections.update({plain: "plain", strict: "strict"})

        await websocket.probe_once()

        assert _stats_sent(strict) == [{"region": "eu-west-1", "tls_verify": False}]


class TestDeletedEndpoint:
    @pytest.mark.anyio
    async def test_follower_of_a_deleted_name_gets_an_error_and_then_silence(
        self, two_saved_endpoints_on_one_url, monkeypatch
    ):
        calls = []
        monkeypatch.setattr(websocket, "collect_stats", _fake_collect(calls))
        ws = _socket()
        websocket.manager.active_connections[ws] = "strict"
        two_saved_endpoints_on_one_url.remove("strict")

        await websocket.probe_once()
        await websocket.probe_once()

        (message,) = [json.loads(call.args[0]) for call in ws.send_text.await_args_list]
        assert message["type"] == "error"
        assert "strict" in message["message"]
        assert calls == []

        websocket.manager.set_endpoint(ws, "plain")
        await websocket.probe_once()
        last = json.loads(ws.send_text.await_args_list[-1].args[0])
        assert last == {"type": "stats", "data": {"region": None, "tls_verify": True}}

    def test_subscribing_to_an_unknown_name_is_an_error_and_stops_stats(
        self, two_saved_endpoints_on_one_url, client
    ):
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({"type": "subscribe", "endpoint": "gone"}))
            message = json.loads(ws.receive_text())
            assert message["type"] == "error"
            assert len(websocket.manager.suspended) == 1

            ws.send_text(json.dumps({"type": "subscribe", "endpoint": "plain"}))
            ws.send_text(json.dumps({"type": "unsubscribe"}))
            assert websocket.manager.suspended == set()

    def test_http_routes_still_fall_back_to_the_default(self, two_saved_endpoints_on_one_url):
        assert endpoint_info_for("gone").url == "http://shared:4566"
        with pytest.raises(UnknownEndpoint):
            endpoint_info_for("gone", strict=True)
        assert endpoint_info_for(None, strict=True).url == "http://shared:4566"


class TestMessageShape:
    def test_bad_messages_are_answered_or_ignored_and_the_socket_keeps_working(
        self, two_saved_endpoints_on_one_url, client
    ):
        with client.websocket_connect("/ws") as ws:
            ws.send_text("[1, 2]")
            ws.send_text('"subscribe"')
            ws.send_text(json.dumps({"type": "subscribe", "endpoint": 5}))
            assert json.loads(ws.receive_text())["type"] == "error"
            ws.send_text(json.dumps({"type": "subscribe", "endpoint": "strict"}))
            ws.send_text(json.dumps({"type": "unsubscribe"}))
            assert list(websocket.manager.active_connections.values()) == ["strict"]

        assert websocket.manager.active_connections == {}
