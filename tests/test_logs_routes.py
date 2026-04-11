"""Integration tests for CloudWatch Logs API routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app
from backend.cache import cache

client = TestClient(app)


class TestListLogGroups:
    @patch("backend.routes.logs.cache")
    @patch("backend.routes.logs.get_client")
    def test_list_log_groups_empty(self, mock_get_client, mock_cache):
        mock_cache.get.return_value = None
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.describe_log_groups.return_value = {"logGroups": []}

        resp = client.get("/api/logs/groups")
        assert resp.status_code == 200
        data = resp.json()
        assert data["log_groups"] == []
        assert data["next_token"] is None

    @patch("backend.routes.logs.cache")
    @patch("backend.routes.logs.get_client")
    def test_list_log_groups_with_data(self, mock_get_client, mock_cache):
        mock_cache.get.return_value = None
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.describe_log_groups.return_value = {
            "logGroups": [
                {
                    "logGroupName": "/aws/lambda/my-function",
                    "arn": "arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/my-function",
                    "creationTime": 1609459200000,
                    "retentionInDays": 7,
                    "storedBytes": 1024,
                    "metricFilterCount": 0,
                }
            ],
            "nextToken": "token123",
        }

        resp = client.get("/api/logs/groups")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["log_groups"]) == 1
        assert data["log_groups"][0]["name"] == "/aws/lambda/my-function"
        assert data["log_groups"][0]["retention_days"] == 7
        assert data["log_groups"][0]["stored_bytes"] == 1024
        assert data["next_token"] == "token123"

    @patch("backend.routes.logs.get_client")
    def test_list_log_groups_with_prefix_filter(self, mock_get_client):
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.describe_log_groups.return_value = {
            "logGroups": [
                {
                    "logGroupName": "/aws/lambda/test-function",
                    "arn": "arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/test-function",
                    "creationTime": 1609459200000,
                    "storedBytes": 512,
                }
            ]
        }

        resp = client.get("/api/logs/groups?prefix=/aws/lambda")
        assert resp.status_code == 200
        mock_logs.describe_log_groups.assert_called_once()
        call_args = mock_logs.describe_log_groups.call_args[1]
        assert call_args["logGroupNamePrefix"] == "/aws/lambda"

    @patch("backend.routes.logs.get_client")
    def test_list_log_groups_api_error_returns_empty(self, mock_get_client):
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.describe_log_groups.side_effect = Exception("API error")

        resp = client.get("/api/logs/groups")
        assert resp.status_code == 200
        data = resp.json()
        assert data["log_groups"] == []


class TestListLogStreams:
    @patch("backend.routes.logs.cache")
    @patch("backend.routes.logs.get_client")
    def test_list_log_streams_empty(self, mock_get_client, mock_cache):
        mock_cache.get.return_value = None
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.describe_log_streams.return_value = {"logStreams": []}

        resp = client.get("/api/logs/groups/my-log-group/streams")
        assert resp.status_code == 200
        data = resp.json()
        assert data["log_streams"] == []
        assert data["next_token"] is None

    @patch("backend.routes.logs.cache")
    @patch("backend.routes.logs.get_client")
    def test_list_log_streams_with_data(self, mock_get_client, mock_cache):
        mock_cache.get.return_value = None
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.describe_log_streams.return_value = {
            "logStreams": [
                {
                    "logStreamName": "2024/01/01/[$LATEST]abc123",
                    "creationTime": 1609459200000,
                    "firstEventTimestamp": 1609459300000,
                    "lastEventTime": 1609459400000,
                    "lastIngestionTime": 1609459500000,
                    "storedBytes": 2048,
                }
            ],
            "nextToken": "stream_token",
        }

        resp = client.get("/api/logs/groups/my-log-group/streams")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["log_streams"]) == 1
        assert data["log_streams"][0]["name"] == "2024/01/01/[$LATEST]abc123"
        assert data["log_streams"][0]["stored_bytes"] == 2048
        assert data["next_token"] == "stream_token"

    @patch("backend.routes.logs.get_client")
    def test_list_log_streams_with_order_params(self, mock_get_client):
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.describe_log_streams.return_value = {"logStreams": []}

        resp = client.get(
            "/api/logs/groups/my-log-group/streams?order_by=LogStreamName&descending=false&limit=10"
        )
        assert resp.status_code == 200
        mock_logs.describe_log_streams.assert_called_once()
        call_args = mock_logs.describe_log_streams.call_args[1]
        assert call_args["orderBy"] == "LogStreamName"
        assert call_args["descending"] is False
        assert call_args["limit"] == 10

    @patch("backend.routes.logs.get_client")
    def test_list_log_streams_with_path_encoded_group_name(self, mock_get_client):
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.describe_log_streams.return_value = {"logStreams": []}

        # Test with URL-encoded log group name containing slashes
        resp = client.get("/api/logs/groups/%2Faws%2Flambda%2Fmy-function/streams")
        assert resp.status_code == 200
        mock_logs.describe_log_streams.assert_called_once()
        call_args = mock_logs.describe_log_streams.call_args[1]
        assert call_args["logGroupName"] == "/aws/lambda/my-function"


class TestGetLogEvents:
    @patch("backend.routes.logs.get_client")
    def test_get_log_events_empty(self, mock_get_client):
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.get_log_events.return_value = {"events": [], "nextForwardToken": None}

        resp = client.get("/api/logs/groups/my-log-group/streams/my-stream/events")
        assert resp.status_code == 200
        data = resp.json()
        assert data["events"] == []
        assert data["next_token"] is None

    @patch("backend.routes.logs.get_client")
    def test_get_log_events_with_data(self, mock_get_client):
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.get_log_events.return_value = {
            "events": [
                {
                    "timestamp": 1609459200000,
                    "message": "START RequestId: abc123",
                },
                {
                    "timestamp": 1609459201000,
                    "message": '{"level": "INFO", "message": "Processing request"}',
                },
            ],
            "nextForwardToken": "event_token",
        }

        resp = client.get("/api/logs/groups/my-log-group/streams/my-stream/events")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["events"]) == 2
        assert data["events"][0]["message"] == "START RequestId: abc123"
        assert data["events"][1]["message"] == '{"level": "INFO", "message": "Processing request"}'
        assert data["next_token"] == "event_token"

    @patch("backend.routes.logs.get_client")
    def test_get_log_events_with_filter_pattern(self, mock_get_client):
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.filter_log_events.return_value = {
            "events": [
                {
                    "timestamp": 1609459200000,
                    "message": "ERROR: Something went wrong",
                    "ingestionTime": 1609459300000,
                    "eventId": "evt123",
                }
            ],
            "nextToken": "filter_token",
        }

        resp = client.get(
            "/api/logs/groups/my-log-group/streams/my-stream/events?filter_pattern=ERROR"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["events"]) == 1
        assert "ERROR" in data["events"][0]["message"]
        assert data["events"][0]["event_id"] == "evt123"
        mock_logs.filter_log_events.assert_called_once()

    @patch("backend.routes.logs.get_client")
    def test_get_log_events_with_time_range(self, mock_get_client):
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.get_log_events.return_value = {"events": []}

        start_time = 1609459200000
        end_time = 1609459800000
        resp = client.get(
            f"/api/logs/groups/my-log-group/streams/my-stream/events?start_time={start_time}&end_time={end_time}"
        )
        assert resp.status_code == 200
        mock_logs.get_log_events.assert_called_once()
        call_args = mock_logs.get_log_events.call_args[1]
        assert call_args["startTime"] == start_time
        assert call_args["endTime"] == end_time

    @patch("backend.routes.logs.get_client")
    def test_get_log_events_with_url_encoded_names(self, mock_get_client):
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.get_log_events.return_value = {"events": []}

        # Test with URL-encoded names containing slashes
        resp = client.get(
            "/api/logs/groups/%2Faws%2Flambda%2Fmy-function/streams/2024%2F01%2F01%2F%5B%24LATEST%5Dabc/events"
        )
        assert resp.status_code == 200
        mock_logs.get_log_events.assert_called_once()
        call_args = mock_logs.get_log_events.call_args[1]
        assert call_args["logGroupName"] == "/aws/lambda/my-function"
        assert call_args["logStreamName"] == "2024/01/01/[$LATEST]abc"

    @patch("backend.routes.logs.get_client")
    def test_get_log_events_api_error_returns_empty(self, mock_get_client):
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.get_log_events.side_effect = Exception("API error")

        resp = client.get("/api/logs/groups/my-log-group/streams/my-stream/events")
        assert resp.status_code == 200
        data = resp.json()
        assert data["events"] == []
