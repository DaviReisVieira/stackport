"""Integration tests for Lambda API routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

import base64
import io
import json
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


class TestListFunctions:
    @patch("backend.routes.lambda_svc.get_client")
    def test_list_functions_empty(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        paginator = MagicMock()
        mock_lambda.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{"Functions": []}]

        resp = client.get("/api/lambda/functions")
        assert resp.status_code == 200
        data = resp.json()
        assert data["functions"] == []

    @patch("backend.routes.lambda_svc.get_client")
    def test_list_functions_with_data(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        paginator = MagicMock()
        mock_lambda.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {
                "Functions": [
                    {
                        "FunctionName": "my-func",
                        "FunctionArn": "arn:aws:lambda:us-east-1:000000000000:function:my-func",
                        "Runtime": "python3.12",
                        "Handler": "handler.main",
                        "CodeSize": 1024,
                        "Timeout": 30,
                        "MemorySize": 128,
                    }
                ]
            }
        ]

        resp = client.get("/api/lambda/functions")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["functions"]) == 1
        assert data["functions"][0]["FunctionName"] == "my-func"
        assert data["functions"][0]["Runtime"] == "python3.12"


class TestGetFunction:
    @patch("backend.routes.lambda_svc.get_client")
    def test_get_function_detail(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        mock_lambda.get_function.return_value = {
            "Configuration": {
                "FunctionName": "my-func",
                "FunctionArn": "arn:aws:lambda:us-east-1:000000000000:function:my-func",
                "Runtime": "python3.12",
                "Role": "arn:aws:iam::000000000000:role/lambda-role",
                "Handler": "handler.main",
                "CodeSize": 2048,
                "Timeout": 60,
                "MemorySize": 256,
            },
            "Code": {"Location": "https://example.com/code.zip"},
            "Tags": {"env": "test"},
            "Concurrency": {"ReservedConcurrentExecutions": 10},
        }

        resp = client.get("/api/lambda/functions/my-func")
        assert resp.status_code == 200
        data = resp.json()
        assert data["configuration"]["FunctionName"] == "my-func"
        assert data["code"]["Location"] == "https://example.com/code.zip"
        assert data["tags"] == {"env": "test"}
        assert data["concurrency"]["ReservedConcurrentExecutions"] == 10

    @patch("backend.routes.lambda_svc.get_client")
    def test_get_function_not_found(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        mock_lambda.exceptions.ResourceNotFoundException = type("ResourceNotFoundException", (Exception,), {})
        mock_lambda.get_function.side_effect = mock_lambda.exceptions.ResourceNotFoundException()

        resp = client.get("/api/lambda/functions/nonexistent")
        assert resp.status_code == 404


class TestDownloadCode:
    @patch("backend.routes.lambda_svc.get_client")
    def test_download_redirects(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        mock_lambda.get_function.return_value = {
            "Configuration": {"PackageType": "Zip"},
            "Code": {"Location": "https://example.com/code.zip"},
        }

        resp = client.get("/api/lambda/functions/my-func/code", follow_redirects=False)
        assert resp.status_code == 307
        assert "example.com/code.zip" in resp.headers["location"]

    @patch("backend.routes.lambda_svc.get_client")
    def test_download_image_returns_400(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        mock_lambda.get_function.return_value = {
            "Configuration": {"PackageType": "Image"},
            "Code": {},
        }

        resp = client.get("/api/lambda/functions/my-func/code")
        assert resp.status_code == 400


class TestInvokeFunction:
    @patch("backend.routes.lambda_svc.get_client")
    def test_invoke_returns_payload(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda

        response_payload = io.BytesIO(json.dumps({"result": "ok"}).encode("utf-8"))
        mock_lambda.invoke.return_value = {
            "StatusCode": 200,
            "ExecutedVersion": "$LATEST",
            "Payload": response_payload,
            "LogResult": base64.b64encode(b"START RequestId: abc\nEND").decode("utf-8"),
        }

        resp = client.post(
            "/api/lambda/functions/my-func/invoke",
            json={"payload": {"key": "value"}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["statusCode"] == 200
        assert data["payload"] == {"result": "ok"}
        assert data["logs"] is not None
        assert "START" in data["logs"]

    @patch("backend.routes.lambda_svc.get_client")
    def test_invoke_with_function_error(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda

        response_payload = io.BytesIO(b'"error message"')
        mock_lambda.invoke.return_value = {
            "StatusCode": 200,
            "FunctionError": "Unhandled",
            "ExecutedVersion": "$LATEST",
            "Payload": response_payload,
        }

        resp = client.post(
            "/api/lambda/functions/my-func/invoke",
            json={"payload": {}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["functionError"] == "Unhandled"


class TestListEventSources:
    @patch("backend.routes.lambda_svc.get_client")
    def test_list_event_sources_empty(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        paginator = MagicMock()
        mock_lambda.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{"EventSourceMappings": []}]

        resp = client.get("/api/lambda/functions/my-func/event-sources")
        assert resp.status_code == 200
        data = resp.json()
        assert data["eventSourceMappings"] == []

    @patch("backend.routes.lambda_svc.get_client")
    def test_list_event_sources_with_data(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        paginator = MagicMock()
        mock_lambda.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {
                "EventSourceMappings": [
                    {
                        "UUID": "abc-123",
                        "EventSourceArn": "arn:aws:sqs:us-east-1:000000000000:my-queue",
                        "FunctionArn": "arn:aws:lambda:us-east-1:000000000000:function:my-func",
                        "State": "Enabled",
                    }
                ]
            }
        ]

        resp = client.get("/api/lambda/functions/my-func/event-sources")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["eventSourceMappings"]) == 1
        assert data["eventSourceMappings"][0]["State"] == "Enabled"


class TestListAliases:
    @patch("backend.routes.lambda_svc.get_client")
    def test_list_aliases(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        paginator = MagicMock()
        mock_lambda.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {
                "Aliases": [
                    {
                        "AliasArn": "arn:aws:lambda:us-east-1:000000000000:function:my-func:prod",
                        "Name": "prod",
                        "FunctionVersion": "3",
                    }
                ]
            }
        ]

        resp = client.get("/api/lambda/functions/my-func/aliases")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["aliases"]) == 1
        assert data["aliases"][0]["Name"] == "prod"


class TestListVersions:
    @patch("backend.routes.lambda_svc.get_client")
    def test_list_versions(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        paginator = MagicMock()
        mock_lambda.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {
                "Versions": [
                    {
                        "FunctionName": "my-func",
                        "Version": "$LATEST",
                        "CodeSize": 1024,
                    },
                    {
                        "FunctionName": "my-func",
                        "Version": "1",
                        "CodeSize": 1024,
                    },
                ]
            }
        ]

        resp = client.get("/api/lambda/functions/my-func/versions")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["versions"]) == 2
        assert data["versions"][0]["Version"] == "$LATEST"
