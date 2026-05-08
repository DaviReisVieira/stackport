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


class TestUpdateFunctionConfiguration:
    @patch("backend.routes.lambda_svc.get_client")
    def test_update_environment_variables(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        mock_lambda.update_function_configuration.return_value = {
            "FunctionName": "my-func",
            "Runtime": "python3.12",
            "Handler": "handler.main",
            "MemorySize": 256,
            "Timeout": 30,
            "Environment": {
                "Variables": {
                    "KEY1": "value1",
                    "KEY2": "value2",
                }
            },
        }

        resp = client.patch(
            "/api/lambda/functions/my-func/configuration",
            json={
                "environment": {
                    "KEY1": "value1",
                    "KEY2": "value2",
                }
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["configuration"]["Environment"]["Variables"]["KEY1"] == "value1"
        mock_lambda.update_function_configuration.assert_called_once()
        call_args = mock_lambda.update_function_configuration.call_args[1]
        assert call_args["FunctionName"] == "my-func"
        assert call_args["Environment"]["Variables"] == {"KEY1": "value1", "KEY2": "value2"}

    @patch("backend.routes.lambda_svc.get_client")
    def test_update_memory_and_timeout(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        mock_lambda.update_function_configuration.return_value = {
            "FunctionName": "my-func",
            "MemorySize": 512,
            "Timeout": 60,
        }

        resp = client.patch(
            "/api/lambda/functions/my-func/configuration",
            json={"memorySize": 512, "timeout": 60},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["configuration"]["MemorySize"] == 512
        assert data["configuration"]["Timeout"] == 60
        mock_lambda.update_function_configuration.assert_called_once_with(
            FunctionName="my-func",
            MemorySize=512,
            Timeout=60,
        )

    @patch("backend.routes.lambda_svc.get_client")
    def test_update_handler_and_runtime(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        mock_lambda.update_function_configuration.return_value = {
            "FunctionName": "my-func",
            "Handler": "new_handler.handler",
            "Runtime": "python3.13",
        }

        resp = client.patch(
            "/api/lambda/functions/my-func/configuration",
            json={"handler": "new_handler.handler", "runtime": "python3.13"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["configuration"]["Handler"] == "new_handler.handler"
        assert data["configuration"]["Runtime"] == "python3.13"

    @patch("backend.routes.lambda_svc.get_client")
    def test_update_description(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        mock_lambda.update_function_configuration.return_value = {
            "FunctionName": "my-func",
            "Description": "Updated description",
        }

        resp = client.patch(
            "/api/lambda/functions/my-func/configuration",
            json={"description": "Updated description"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["configuration"]["Description"] == "Updated description"

    @patch("backend.routes.lambda_svc.get_client")
    def test_update_partial(self, mock_get_client):
        """Test that only specified fields are included in the update call."""
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        mock_lambda.update_function_configuration.return_value = {
            "FunctionName": "my-func",
            "Timeout": 120,
        }

        resp = client.patch(
            "/api/lambda/functions/my-func/configuration",
            json={"timeout": 120},
        )
        assert resp.status_code == 200
        # Verify only Timeout and FunctionName were passed
        mock_lambda.update_function_configuration.assert_called_once()
        call_args = mock_lambda.update_function_configuration.call_args[1]
        assert set(call_args.keys()) == {"FunctionName", "Timeout"}
        assert call_args["Timeout"] == 120

    @patch("backend.routes.lambda_svc.get_client")
    def test_update_function_not_found(self, mock_get_client):
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        # Set up both exception types
        mock_lambda.exceptions.ResourceNotFoundException = type("ResourceNotFoundException", (Exception,), {})
        mock_lambda.exceptions.InvalidParameterValueException = type("InvalidParameterValueException", (Exception,), {})
        mock_lambda.update_function_configuration.side_effect = mock_lambda.exceptions.ResourceNotFoundException()

        resp = client.patch(
            "/api/lambda/functions/nonexistent/configuration",
            json={"timeout": 60},
        )
        assert resp.status_code == 404

    @patch("backend.routes.lambda_svc.get_client")
    def test_update_invalid_parameter_boto3(self, mock_get_client):
        """Test AWS InvalidParameterValueException returns 400."""
        mock_lambda = MagicMock()
        mock_get_client.return_value = mock_lambda
        # Set up both exception types
        mock_lambda.exceptions.ResourceNotFoundException = type("ResourceNotFoundException", (Exception,), {})
        mock_lambda.exceptions.InvalidParameterValueException = type("InvalidParameterValueException", (Exception,), {})
        mock_lambda.update_function_configuration.side_effect = mock_lambda.exceptions.InvalidParameterValueException("Invalid runtime")

        resp = client.patch(
            "/api/lambda/functions/my-func/configuration",
            json={"runtime": "invalid_runtime"},
        )
        assert resp.status_code == 400

    def test_update_validation_memory_too_low(self):
        """Test Pydantic validation rejects memory < 128."""
        resp = client.patch(
            "/api/lambda/functions/my-func/configuration",
            json={"memorySize": 64},
        )
        assert resp.status_code == 422

    def test_update_validation_memory_too_high(self):
        """Test Pydantic validation rejects memory > 10240."""
        resp = client.patch(
            "/api/lambda/functions/my-func/configuration",
            json={"memorySize": 20480},
        )
        assert resp.status_code == 422

    def test_update_validation_timeout_too_low(self):
        """Test Pydantic validation rejects timeout < 1."""
        resp = client.patch(
            "/api/lambda/functions/my-func/configuration",
            json={"timeout": 0},
        )
        assert resp.status_code == 422

    def test_update_validation_timeout_too_high(self):
        """Test Pydantic validation rejects timeout > 900."""
        resp = client.patch(
            "/api/lambda/functions/my-func/configuration",
            json={"timeout": 1000},
        )
        assert resp.status_code == 422
