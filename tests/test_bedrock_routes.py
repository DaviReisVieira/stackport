"""Tests for the Bedrock routes: model listing and the Converse playground."""

from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError
from fastapi.testclient import TestClient

from backend.main import app

MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0"


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def _client_error(code: str, status: int, operation: str = "Converse") -> ClientError:
    return ClientError(
        {"Error": {"Code": code, "Message": f"{code} happened"}, "ResponseMetadata": {"HTTPStatusCode": status}},
        operation,
    )


def _mock_runtime(text: str = "Hello there") -> MagicMock:
    runtime = MagicMock()
    runtime.converse.return_value = {
        "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
        "stopReason": "end_turn",
        "usage": {"inputTokens": 7, "outputTokens": 3, "totalTokens": 10},
        "metrics": {"latencyMs": 412},
    }
    return runtime


class TestModels:
    @patch("backend.routes.bedrock.get_client")
    def test_lists_text_models(self, mock_client, client):
        bedrock = MagicMock()
        bedrock.list_foundation_models.return_value = {
            "modelSummaries": [
                {
                    "modelId": MODEL_ID,
                    "modelName": "Claude 3 Haiku",
                    "providerName": "Anthropic",
                    "inputModalities": ["TEXT", "IMAGE"],
                    "outputModalities": ["TEXT"],
                }
            ]
        }
        mock_client.return_value = bedrock

        response = client.get("/api/bedrock/models")

        assert response.status_code == 200
        body = response.json()
        assert body["models"] == [
            {
                "modelId": MODEL_ID,
                "modelName": "Claude 3 Haiku",
                "providerName": "Anthropic",
                "inputModalities": ["TEXT", "IMAGE"],
                "outputModalities": ["TEXT"],
            }
        ]
        bedrock.list_foundation_models.assert_called_once_with(byOutputModality="TEXT")

    @patch("backend.routes.bedrock.get_client")
    def test_model_name_falls_back_to_id(self, mock_client, client):
        bedrock = MagicMock()
        bedrock.list_foundation_models.return_value = {"modelSummaries": [{"modelId": MODEL_ID}]}
        mock_client.return_value = bedrock

        model = client.get("/api/bedrock/models").json()["models"][0]

        assert model["modelName"] == MODEL_ID

    @patch("backend.routes.bedrock.get_client")
    def test_unsupported_endpoint_is_a_classified_501(self, mock_client, client):
        bedrock = MagicMock()
        bedrock.list_foundation_models.side_effect = _client_error(
            "UnknownOperationException", 501, "ListFoundationModels"
        )
        mock_client.return_value = bedrock

        response = client.get("/api/bedrock/models")

        assert response.status_code == 501
        assert response.json()["error"]["kind"] == "not_implemented"

    @pytest.mark.parametrize(
        ("code", "status", "kind"),
        [
            ("UnrecognizedClientException", 403, "credentials"),
            ("AccessDeniedException", 403, "forbidden"),
        ],
    )
    @patch("backend.routes.bedrock.get_client")
    def test_credential_and_access_problems_are_not_hidden(self, mock_client, code, status, kind, client):
        bedrock = MagicMock()
        bedrock.list_foundation_models.side_effect = _client_error(code, status, "ListFoundationModels")
        mock_client.return_value = bedrock

        response = client.get("/api/bedrock/models")

        assert response.json()["error"]["kind"] == kind
        assert "models" not in response.json()

    @patch("backend.routes.bedrock.get_client")
    def test_unreachable_endpoint_is_a_classified_502(self, mock_client, client):
        bedrock = MagicMock()
        bedrock.list_foundation_models.side_effect = EndpointConnectionError(endpoint_url="http://localhost:4566")
        mock_client.return_value = bedrock

        response = client.get("/api/bedrock/models")

        assert response.status_code == 502
        assert response.json()["error"]["kind"] == "unreachable"


class TestConverse:
    @patch("backend.routes.bedrock.get_client")
    def test_returns_reply_and_metadata(self, mock_client, client):
        mock_client.return_value = _mock_runtime("Hello there")

        response = client.post("/api/bedrock/converse", json={"modelId": MODEL_ID, "prompt": "Say hi"})

        assert response.status_code == 200
        body = response.json()
        assert body["modelId"] == MODEL_ID
        assert body["text"] == "Hello there"
        assert body["stopReason"] == "end_turn"
        assert body["usage"] == {"inputTokens": 7, "outputTokens": 3, "totalTokens": 10}
        assert body["latencyMs"] == 412
        assert body["roundTripMs"] >= 0

    @patch("backend.routes.bedrock.get_client")
    def test_uses_the_bedrock_runtime_client(self, mock_client, client):
        mock_client.return_value = _mock_runtime()

        client.post("/api/bedrock/converse", json={"modelId": MODEL_ID, "prompt": "Say hi"})

        assert mock_client.call_args.args[0] == "bedrock-runtime"

    @patch("backend.routes.bedrock.get_client")
    def test_sends_only_the_prompt_by_default(self, mock_client, client):
        runtime = _mock_runtime()
        mock_client.return_value = runtime

        client.post("/api/bedrock/converse", json={"modelId": MODEL_ID, "prompt": "Say hi"})

        runtime.converse.assert_called_once_with(
            modelId=MODEL_ID,
            messages=[{"role": "user", "content": [{"text": "Say hi"}]}],
        )

    @patch("backend.routes.bedrock.get_client")
    def test_passes_system_prompt_and_inference_config(self, mock_client, client):
        runtime = _mock_runtime()
        mock_client.return_value = runtime

        client.post(
            "/api/bedrock/converse",
            json={
                "modelId": MODEL_ID,
                "prompt": "Say hi",
                "system": "Be terse",
                "maxTokens": 64,
                "temperature": 0.2,
                "topP": 0.9,
            },
        )

        params = runtime.converse.call_args.kwargs
        assert params["system"] == [{"text": "Be terse"}]
        assert params["inferenceConfig"] == {"maxTokens": 64, "temperature": 0.2, "topP": 0.9}

    @patch("backend.routes.bedrock.get_client")
    def test_zero_temperature_is_still_sent(self, mock_client, client):
        runtime = _mock_runtime()
        mock_client.return_value = runtime

        client.post("/api/bedrock/converse", json={"modelId": MODEL_ID, "prompt": "Say hi", "temperature": 0})

        assert runtime.converse.call_args.kwargs["inferenceConfig"] == {"temperature": 0}

    @patch("backend.routes.bedrock.get_client")
    def test_joins_multiple_text_blocks_and_ignores_others(self, mock_client, client):
        runtime = _mock_runtime()
        runtime.converse.return_value["output"]["message"]["content"] = [
            {"text": "Hello "},
            {"toolUse": {"name": "lookup"}},
            {"text": "world"},
        ]
        mock_client.return_value = runtime

        response = client.post("/api/bedrock/converse", json={"modelId": MODEL_ID, "prompt": "Say hi"})

        assert response.json()["text"] == "Hello world"

    @patch("backend.routes.bedrock.get_client")
    def test_missing_usage_and_metrics_are_tolerated(self, mock_client, client):
        runtime = MagicMock()
        runtime.converse.return_value = {"output": {"message": {"content": [{"text": "ok"}]}}}
        mock_client.return_value = runtime

        body = client.post("/api/bedrock/converse", json={"modelId": MODEL_ID, "prompt": "hi"}).json()

        assert body["usage"] == {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
        assert body["latencyMs"] is None
        assert body["stopReason"] is None

    @pytest.mark.parametrize(
        ("code", "upstream_status", "status"),
        [
            ("ValidationException", 400, 400),
            ("ResourceNotFoundException", 404, 404),
            ("AccessDeniedException", 403, 403),
            ("ThrottlingException", 429, 429),
            ("InternalServerException", 500, 502),
        ],
    )
    @patch("backend.routes.bedrock.get_client")
    def test_keeps_the_upstream_status(self, mock_client, code, upstream_status, status, client):
        runtime = MagicMock()
        runtime.converse.side_effect = _client_error(code, upstream_status)
        mock_client.return_value = runtime

        response = client.post("/api/bedrock/converse", json={"modelId": MODEL_ID, "prompt": "hi"})

        assert response.status_code == status
        assert code in response.json()["detail"]

    @patch("backend.routes.bedrock.get_client")
    def test_rejected_credentials_are_classified(self, mock_client, client):
        runtime = MagicMock()
        runtime.converse.side_effect = _client_error("UnrecognizedClientException", 403)
        mock_client.return_value = runtime

        response = client.post("/api/bedrock/converse", json={"modelId": MODEL_ID, "prompt": "hi"})

        assert response.status_code == 401
        assert response.json()["error"]["kind"] == "credentials"

    @patch("backend.routes.bedrock.get_client")
    def test_unreachable_endpoint_is_a_classified_502(self, mock_client, client):
        runtime = MagicMock()
        runtime.converse.side_effect = EndpointConnectionError(endpoint_url="http://localhost:4566")
        mock_client.return_value = runtime

        response = client.post("/api/bedrock/converse", json={"modelId": MODEL_ID, "prompt": "hi"})

        assert response.status_code == 502
        assert response.json()["error"]["kind"] == "unreachable"

    @patch("backend.routes.bedrock.get_client")
    def test_does_not_retry_a_billed_invocation(self, mock_client, client):
        mock_client.return_value = _mock_runtime()

        client.post("/api/bedrock/converse", json={"modelId": MODEL_ID, "prompt": "Say hi"})

        config = mock_client.call_args.kwargs["client_config"]
        assert config.retries["total_max_attempts"] == 1
        assert config.read_timeout > 60

    @patch("backend.routes.bedrock.get_client")
    def test_model_listing_keeps_the_default_client_config(self, mock_client, client):
        mock_client.return_value = MagicMock(list_foundation_models=MagicMock(return_value={}))

        client.get("/api/bedrock/models")

        assert "client_config" not in mock_client.call_args.kwargs

    @pytest.mark.parametrize(
        "payload",
        [
            {"prompt": "hi"},
            {"modelId": MODEL_ID},
            {"modelId": MODEL_ID, "prompt": ""},
            {"modelId": "", "prompt": "hi"},
            {"modelId": MODEL_ID, "prompt": "hi", "maxTokens": 0},
            {"modelId": MODEL_ID, "prompt": "hi", "temperature": 1.5},
            {"modelId": MODEL_ID, "prompt": "hi", "topP": -0.1},
        ],
    )
    @patch("backend.routes.bedrock.get_client")
    def test_rejects_invalid_requests(self, mock_client, payload, client):
        response = client.post("/api/bedrock/converse", json=payload)

        assert response.status_code == 422
        mock_client.assert_not_called()


class TestReadOnlyMode:
    """Invoking a model is allowed when writes are disabled; other POSTs are not."""

    @patch("backend.routes.bedrock.get_client")
    def test_converse_is_allowed(self, mock_client, client):
        mock_client.return_value = _mock_runtime()

        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            response = client.post("/api/bedrock/converse", json={"modelId": MODEL_ID, "prompt": "hi"})

        assert response.status_code == 200

    def test_other_posts_are_still_blocked(self, client):
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            response = client.post("/api/sns/topics", json={"name": "orders"})

        assert response.status_code == 403
