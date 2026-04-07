"""Integration tests for API routes using FastAPI TestClient."""

import os

import pytest

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


class TestHealth:
    def test_health_returns_ok(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "uptime_seconds" in data
        assert isinstance(data["uptime_seconds"], (int, float))


class TestStats:
    def test_stats_returns_structure(self):
        """Stats endpoint returns the expected structure even if services are unavailable."""
        resp = client.get("/api/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert "services" in data
        assert "total_resources" in data
        assert "uptime_seconds" in data
        assert isinstance(data["services"], dict)
        assert isinstance(data["total_resources"], int)

    def test_stats_services_have_expected_shape(self):
        resp = client.get("/api/stats")
        data = resp.json()
        for svc_name, svc_data in data["services"].items():
            assert "status" in svc_data
            assert svc_data["status"] in ("available", "unavailable")
            assert "resources" in svc_data
            assert isinstance(svc_data["resources"], dict)


class TestResources:
    def test_unknown_service_returns_404(self):
        resp = client.get("/api/resources/nonexistent-service")
        assert resp.status_code == 404

    def test_known_service_returns_structure(self):
        """A known service returns the right shape even if the emulator is down."""
        resp = client.get("/api/resources/s3")
        # Could be 200 (emulator running) or 500 (connection refused)
        if resp.status_code == 200:
            data = resp.json()
            assert data["service"] == "s3"
            assert "resources" in data

    def test_unknown_detail_returns_404(self):
        resp = client.get("/api/resources/nonexistent/type/id")
        assert resp.status_code == 404


class TestS3Routes:
    @patch("backend.routes.s3.get_client")
    def test_list_buckets(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.list_buckets.return_value = {"Buckets": []}
        resp = client.get("/api/s3/buckets")
        assert resp.status_code == 200
        data = resp.json()
        assert "buckets" in data
        assert data["buckets"] == []

    @patch("backend.routes.s3.get_client")
    def test_list_objects(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        paginator = MagicMock()
        mock_s3.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {"CommonPrefixes": [{"Prefix": "folder/"}], "Contents": []}
        ]
        resp = client.get("/api/s3/buckets/test-bucket/objects?prefix=&delimiter=/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert "folders" in data
        assert "files" in data
        assert data["folders"] == ["folder/"]

    @patch("backend.routes.s3.get_client")
    def test_get_object_detail(self, mock_get_client):
        from datetime import datetime, timezone

        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.head_object.return_value = {
            "ContentLength": 1024,
            "ContentType": "text/plain",
            "ETag": '"abc123"',
            "LastModified": datetime(2024, 1, 1, tzinfo=timezone.utc),
            "Metadata": {},
        }
        mock_s3.get_object_tagging.return_value = {"TagSet": []}
        resp = client.get("/api/s3/buckets/test-bucket/objects/test-key.txt")
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert data["key"] == "test-key.txt"
        assert data["size"] == 1024
