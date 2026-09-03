"""Tests for the live log tailing WebSocket endpoint (#85)."""

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.websocket import _fetch_new_events


@pytest.fixture
def client():
    return TestClient(app)


def _mock_logs_client(events):
    logs = MagicMock()
    logs.get_log_events.return_value = {"events": events}
    logs.filter_log_events.return_value = {"events": events}
    return logs


class TestFetchNewEvents:
    def test_serializes_plain_events(self):
        logs = _mock_logs_client([{"timestamp": 1000, "message": "hello"}])
        with patch("backend.websocket.get_client", return_value=logs):
            events = _fetch_new_events("g", "s", 500, "", {})
        assert events == [
            {
                "timestamp": events[0]["timestamp"],
                "timestamp_millis": 1000,
                "message": "hello",
                "ingestion_time": None,
                "event_id": "",
            }
        ]
        kwargs = logs.get_log_events.call_args.kwargs
        assert kwargs["logGroupName"] == "g"
        assert kwargs["logStreamName"] == "s"
        assert kwargs["startTime"] == 500
        assert kwargs["startFromHead"] is True

    def test_uses_filter_log_events_for_patterns(self):
        logs = _mock_logs_client([{"timestamp": 2000, "message": "ERROR boom", "eventId": "e1", "ingestionTime": 2001}])
        with patch("backend.websocket.get_client", return_value=logs):
            events = _fetch_new_events("g", "s", 0, "ERROR", {})
        assert events[0]["message"] == "ERROR boom"
        assert events[0]["event_id"] == "e1"
        kwargs = logs.filter_log_events.call_args.kwargs
        assert kwargs["filterPattern"] == "ERROR"
        assert kwargs["logStreamNames"] == ["s"]
        assert "startTime" not in kwargs

    def test_errors_degrade_to_empty_batch(self):
        logs = MagicMock()
        logs.get_log_events.side_effect = Exception("boom")
        with patch("backend.websocket.get_client", return_value=logs):
            assert _fetch_new_events("g", "s", 0, "", {}) == []


class TestLogsTailWebSocket:
    def test_rejects_connection_without_tail_config(self, client):
        with client.websocket_connect("/ws/logs/tail") as ws:
            ws.send_text(json.dumps({"type": "subscribe"}))
            msg = json.loads(ws.receive_text())
            assert msg["type"] == "error"

    def test_streams_new_events_and_advances_cursor(self, client):
        batches = [
            [{"timestamp": 1000, "message": "first"}],
            [{"timestamp": 1500, "message": "second"}],
        ]
        calls = []

        def fake_get_client(service, **kwargs):
            logs = MagicMock()

            def get_log_events(**params):
                calls.append(params)
                return {"events": batches.pop(0)} if batches else {"events": []}

            logs.get_log_events.side_effect = get_log_events
            return logs

        with patch("backend.websocket.get_client", side_effect=fake_get_client), patch(
            "backend.websocket.TAIL_POLL_SECONDS", 0.01
        ):
            with client.websocket_connect("/ws/logs/tail") as ws:
                ws.send_text(json.dumps({"type": "tail", "group": "g", "stream": "s", "since": 900}))

                first = json.loads(ws.receive_text())
                assert first["type"] == "events"
                assert first["data"]["events"][0]["message"] == "first"

                second = json.loads(ws.receive_text())
                assert second["data"]["events"][0]["message"] == "second"

                ws.send_text(json.dumps({"type": "stop"}))

        # cursor advanced: first call starts at the client's since, the next after the last event
        assert calls[0]["startTime"] == 900
        assert calls[1]["startTime"] == 1001
