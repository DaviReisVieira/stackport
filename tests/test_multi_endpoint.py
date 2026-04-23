"""Tests for multi-endpoint switching: dependency injection, cache isolation, routing."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.routes.common import get_endpoint_url


@pytest.fixture
def client():
    return TestClient(app)


class TestGetEndpointUrlDependency:
    """Test the get_endpoint_url FastAPI dependency."""

    def test_returns_default_when_no_param(self):
        with patch("backend.routes.common.DEFAULT_ENDPOINT", "http://localhost:4566"):
            result = get_endpoint_url(endpoint=None)
            assert result == "http://localhost:4566"

    def test_resolves_known_endpoint_name(self):
        endpoints = {"local": "http://localhost:4566", "staging": "http://staging:4566"}
        with patch("backend.routes.common.ENDPOINTS", endpoints):
            result = get_endpoint_url(endpoint="local")
            assert result == "http://localhost:4566"

    def test_resolves_second_endpoint_name(self):
        endpoints = {"local": "http://localhost:4566", "staging": "http://staging:4566"}
        with patch("backend.routes.common.ENDPOINTS", endpoints):
            result = get_endpoint_url(endpoint="staging")
            assert result == "http://staging:4566"

    def test_passes_through_direct_url(self):
        endpoints = {"local": "http://localhost:4566"}
        with patch("backend.routes.common.ENDPOINTS", endpoints):
            result = get_endpoint_url(endpoint="http://custom:9999")
            assert result == "http://custom:9999"

    def test_passes_through_https_url(self):
        endpoints = {"local": "http://localhost:4566"}
        with patch("backend.routes.common.ENDPOINTS", endpoints):
            result = get_endpoint_url(endpoint="https://s3.amazonaws.com")
            assert result == "https://s3.amazonaws.com"

    def test_falls_back_to_default_for_invalid_name(self):
        endpoints = {"local": "http://localhost:4566"}
        with patch("backend.routes.common.ENDPOINTS", endpoints), \
             patch("backend.routes.common.DEFAULT_ENDPOINT", "http://localhost:4566"):
            result = get_endpoint_url(endpoint="aws")
            assert result == "http://localhost:4566"

    def test_falls_back_to_default_for_garbage_string(self):
        endpoints = {"local": "http://localhost:4566"}
        with patch("backend.routes.common.ENDPOINTS", endpoints), \
             patch("backend.routes.common.DEFAULT_ENDPOINT", "http://localhost:4566"):
            result = get_endpoint_url(endpoint="not-a-url")
            assert result == "http://localhost:4566"


class TestHealthEndpointAwareness:
    """Test /api/health reflects the queried endpoint."""

    def test_health_without_endpoint_uses_default(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "endpoint_url" in data
        assert "connection_type" in data

    def test_health_with_endpoint_param(self, client):
        resp = client.get("/api/health?endpoint=http://other:4566")
        assert resp.status_code == 200
        data = resp.json()
        assert data["endpoint_url"] == "http://other:4566"
        assert data["connection_type"] == "local"

    def test_health_aws_connection_type(self, client):
        resp = client.get("/api/health?endpoint=https://s3.amazonaws.com")
        assert resp.status_code == 200
        data = resp.json()
        assert data["connection_type"] == "aws"


class TestStatsEndpointParam:
    """Test /api/stats passes endpoint through."""

    @patch("backend.routes.stats._probe_service")
    def test_stats_uses_endpoint_param(self, mock_probe, client):
        mock_probe.return_value = ("s3", {"status": "available", "resources": {"buckets": 3}})
        resp = client.get("/api/stats?endpoint=http://other:4566")
        assert resp.status_code == 200
        calls = [c for c in mock_probe.call_args_list if c[0][1] == "http://other:4566"]
        assert len(calls) > 0


class TestCacheKeyIsolation:
    """Test that cache keys are prefixed with endpoint_url."""

    @patch("backend.routes.stats.cache")
    @patch("backend.routes.stats._probe_service")
    def test_stats_cache_key_includes_endpoint(self, mock_probe, mock_cache, client):
        mock_cache.get.return_value = None
        mock_probe.return_value = ("s3", {"status": "available", "resources": {}})

        client.get("/api/stats?endpoint=http://endpoint-a:4566")
        cache_key = mock_cache.get.call_args[0][0]
        assert "http://endpoint-a:4566" in cache_key

    @patch("backend.routes.stats.cache")
    @patch("backend.routes.stats._probe_service")
    def test_different_endpoints_use_different_cache_keys(self, mock_probe, mock_cache, client):
        mock_cache.get.return_value = None
        mock_probe.return_value = ("s3", {"status": "available", "resources": {}})

        client.get("/api/stats?endpoint=http://endpoint-a:4566")
        key_a = mock_cache.get.call_args[0][0]

        client.get("/api/stats?endpoint=http://endpoint-b:4566")
        key_b = mock_cache.get.call_args[0][0]

        assert key_a != key_b


class TestResourcesEndpointParam:
    """Test resource routes accept endpoint param."""

    def test_resources_with_endpoint_param(self, client):
        resp = client.get("/api/resources/s3?endpoint=http://localhost:4566")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service"] == "s3"


class TestS3EndpointParam:
    """Test S3 routes pass endpoint to get_client."""

    @patch("backend.routes.s3.get_client")
    def test_list_buckets_with_endpoint(self, mock_get_client, client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.list_buckets.return_value = {"Buckets": []}

        client.get("/api/s3/buckets?endpoint=http://other:4566")
        mock_get_client.assert_called_with("s3", "http://other:4566")

    @patch("backend.routes.s3.get_client")
    def test_list_objects_with_endpoint(self, mock_get_client, client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        paginator = MagicMock()
        mock_s3.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{"CommonPrefixes": [], "Contents": []}]

        client.get("/api/s3/buckets/test-bucket/objects?endpoint=http://other:4566")
        mock_get_client.assert_called_with("s3", "http://other:4566")


class TestDynamoDBEndpointParam:
    """Test DynamoDB routes pass endpoint to get_client."""

    @patch("backend.routes.dynamodb.get_client")
    def test_list_tables_with_endpoint(self, mock_get_client, client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.list_tables.return_value = {"TableNames": []}

        client.get("/api/dynamodb/tables?endpoint=http://other:4566")
        mock_get_client.assert_called_with("dynamodb", "http://other:4566")


class TestSQSEndpointParam:
    """Test SQS routes pass endpoint to get_client."""

    @patch("backend.routes.sqs.get_client")
    def test_list_queues_with_endpoint(self, mock_get_client, client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.list_queues.return_value = {}

        client.get("/api/sqs/queues?endpoint=http://other:4566")
        mock_get_client.assert_called_with("sqs", "http://other:4566")


class TestLambdaEndpointParam:
    """Test Lambda routes pass endpoint to get_client."""

    @patch("backend.routes.lambda_svc.get_client")
    def test_list_functions_with_endpoint(self, mock_get_client, client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        mock_lambda.list_functions.return_value = {"Functions": []}

        client.get("/api/lambda/functions?endpoint=http://other:4566")
        mock_get_client.assert_called_with("lambda", "http://other:4566")


class TestIAMEndpointParam:
    """Test IAM routes pass endpoint to get_client."""

    @patch("backend.routes.iam.get_client")
    def test_list_roles_with_endpoint(self, mock_get_client, client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.list_roles.return_value = {"Roles": []}

        client.get("/api/iam/roles?endpoint=http://other:4566")
        mock_get_client.assert_called_with("iam", "http://other:4566")


class TestEC2EndpointParam:
    """Test EC2 routes pass endpoint to get_client."""

    @patch("backend.routes.ec2.get_client")
    def test_list_instances_with_endpoint(self, mock_get_client, client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_instances.return_value = {"Reservations": []}

        client.get("/api/ec2/instances?endpoint=http://other:4566")
        mock_get_client.assert_called_with("ec2", "http://other:4566")


class TestLogsEndpointParam:
    """Test CloudWatch Logs routes pass endpoint to get_client."""

    @patch("backend.routes.logs.get_client")
    def test_list_log_groups_with_endpoint(self, mock_get_client, client):
        mock_logs = MagicMock()
        mock_get_client.return_value = mock_logs
        mock_logs.describe_log_groups.return_value = {"logGroups": []}

        client.get("/api/logs/groups?endpoint=http://other:4566")
        mock_get_client.assert_called_with("logs", "http://other:4566")


class TestSecretsManagerEndpointParam:
    """Test Secrets Manager routes pass endpoint to get_client."""

    @patch("backend.routes.secretsmanager.get_client")
    def test_list_secrets_with_endpoint(self, mock_get_client, client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.list_secrets.return_value = {"SecretList": []}

        client.get("/api/secretsmanager/secrets?endpoint=http://other:4566")
        mock_get_client.assert_called_with("secretsmanager", "http://other:4566")


class TestEndpointsRoute:
    """Test /api/endpoints response structure."""

    def test_endpoints_include_metadata(self, client):
        resp = client.get("/api/endpoints")
        assert resp.status_code == 200
        data = resp.json()
        for ep in data["endpoints"]:
            assert "name" in ep
            assert "url" in ep
            assert "health" in ep
            assert "active" in ep
            assert "connection_type" in ep
            assert "region" in ep
            assert ep["connection_type"] in ("local", "aws")
            assert isinstance(ep["active"], bool)


class TestWebSocketEndpointSubscription:
    """Test WebSocket per-endpoint subscription."""

    def test_subscribe_with_endpoint(self, client):
        import json

        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "subscribe",
                "services": ["all"],
                "endpoint": "local",
            }))

    def test_subscribe_without_endpoint(self, client):
        import json

        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "subscribe",
                "services": ["all"],
            }))


class TestConnectionManagerEndpointTracking:
    """Test ConnectionManager per-endpoint tracking."""

    def test_initial_empty(self):
        from backend.websocket import ConnectionManager

        mgr = ConnectionManager()
        assert len(mgr.active_connections) == 0
        assert mgr.get_active_endpoints() == set()

    @pytest.mark.anyio
    async def test_broadcast_to_specific_endpoint(self):
        from backend.websocket import ConnectionManager

        mgr = ConnectionManager()
        await mgr.broadcast_to_endpoint("http://a:4566", {"type": "stats", "data": {}})

    def test_set_endpoint_updates_tracking(self):
        from backend.websocket import ConnectionManager

        mgr = ConnectionManager()
        mock_ws = MagicMock()
        mgr.active_connections[mock_ws] = "http://default:4566"
        mgr.set_endpoint(mock_ws, "http://other:4566")
        assert mgr.active_connections[mock_ws] == "http://other:4566"
        assert "http://other:4566" in mgr.get_active_endpoints()

    def test_get_active_endpoints_returns_unique(self):
        from backend.websocket import ConnectionManager

        mgr = ConnectionManager()
        ws1, ws2, ws3 = MagicMock(), MagicMock(), MagicMock()
        mgr.active_connections[ws1] = "http://a:4566"
        mgr.active_connections[ws2] = "http://a:4566"
        mgr.active_connections[ws3] = "http://b:4566"
        endpoints = mgr.get_active_endpoints()
        assert endpoints == {"http://a:4566", "http://b:4566"}
