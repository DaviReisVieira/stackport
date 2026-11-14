"""App-wide handlers: AWS failures answered with the right status and an actionable message."""

from urllib.parse import quote
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError, SSLError
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.error_handlers import install_aws_error_handlers
from backend.main import app as stackport_app
from tests.moto_aws import aws, moto_account


def client_error(code: str, status: int, message: str = "boom") -> ClientError:
    return ClientError(
        {"Error": {"Code": code, "Message": message}, "ResponseMetadata": {"HTTPStatusCode": status}},
        "ListThings",
    )


def build_app(exc: Exception, *, wrap_status: int | None = None, explicit_cause: bool = False) -> TestClient:
    """An app with one route that raises ``exc``, wrapped the way StackPort's routes do.

    Most routes raise the HTTPException inside their ``except`` block, which
    chains the error implicitly; ``explicit_cause`` raises it ``from`` the error.
    """
    app = FastAPI()
    install_aws_error_handlers(app)

    @app.get("/thing")
    def thing():
        if wrap_status is None:
            raise exc
        try:
            raise exc
        except Exception as e:
            wrapper = HTTPException(status_code=wrap_status, detail=str(e))
            if explicit_cause:
                raise wrapper from e
            raise wrapper

    return TestClient(app, raise_server_exceptions=False)


class TestWrappedErrors:
    def test_not_implemented_becomes_501(self):
        resp = build_app(client_error("NotImplemented", 501), wrap_status=500).get("/thing")
        assert resp.status_code == 501
        body = resp.json()
        assert body["detail"] == "This endpoint doesn't implement ListThings yet."
        assert body["error"]["kind"] == "not_implemented"
        assert body["error"]["operation"] == "ListThings"

    def test_not_implemented_overrides_a_routes_400(self):
        # Some routes turn every ClientError into a 400; NotImplemented isn't the request's fault.
        assert build_app(client_error("NotImplemented", 501), wrap_status=400).get("/thing").status_code == 501

    def test_rejected_credentials_become_401(self):
        resp = build_app(client_error("InvalidClientTokenId", 403), wrap_status=500).get("/thing")
        assert resp.status_code == 401
        assert resp.json()["error"]["kind"] == "credentials"
        assert resp.json()["error"]["hint"]

    def test_untrusted_certificate_becomes_502(self):
        exc = SSLError(endpoint_url="https://127.0.0.1:9297", error="CERTIFICATE_VERIFY_FAILED")
        resp = build_app(exc, wrap_status=500).get("/thing")
        assert resp.status_code == 502
        assert resp.json()["error"]["kind"] == "tls"
        assert "CERTIFICATE_VERIFY_FAILED" in resp.json()["error"]["cause"]

    def test_unreachable_becomes_502(self):
        resp = build_app(EndpointConnectionError(endpoint_url="http://localhost:4566"), wrap_status=500).get("/thing")
        assert resp.status_code == 502
        assert resp.json()["error"]["kind"] == "unreachable"

    def test_access_denied_in_a_generic_500_becomes_403(self):
        assert build_app(client_error("AccessDenied", 403), wrap_status=500).get("/thing").status_code == 403

    def test_a_routes_deliberate_4xx_is_kept(self):
        resp = build_app(client_error("AccessDenied", 403, "nope"), wrap_status=409).get("/thing")
        assert resp.status_code == 409
        assert resp.json() == {"detail": "An error occurred (AccessDenied) when calling the ListThings operation: nope"}

    def test_a_routes_404_for_a_missing_resource_is_kept(self):
        resp = build_app(client_error("ResourceNotFoundException", 404), wrap_status=404).get("/thing")
        assert resp.status_code == 404
        assert "error" not in resp.json()

    @pytest.mark.parametrize("explicit_cause", [False, True], ids=["implicit", "from"])
    @pytest.mark.parametrize(
        ("code", "status"),
        [("ResourceNotFoundException", 404), ("ValidationException", 400), ("ResourceInUseException", 409)],
    )
    def test_an_endpoint_4xx_in_a_generic_500_keeps_its_status(self, code, status, explicit_cause):
        exc = client_error(code, status, "What the endpoint said.")
        resp = build_app(exc, wrap_status=500, explicit_cause=explicit_cause).get("/thing")
        assert resp.status_code == status
        body = resp.json()
        assert body["detail"] == "What the endpoint said."
        assert body["error"] == {
            "kind": "other",
            "message": "What the endpoint said.",
            "code": code,
            "operation": "ListThings",
        }

    def test_an_endpoint_5xx_in_a_generic_500_is_a_bad_gateway(self):
        # As when no route catches it: the endpoint failed, not StackPort.
        resp = build_app(client_error("InternalFailure", 500, "it broke"), wrap_status=500).get("/thing")
        assert resp.status_code == 502
        assert resp.json()["detail"] == "it broke"
        assert resp.json()["error"]["code"] == "InternalFailure"

    def test_an_endpoint_4xx_in_a_routes_502_keeps_its_status(self):
        resp = build_app(client_error("InvalidParameterValue", 400, "bad period"), wrap_status=502).get("/thing")
        assert resp.status_code == 400
        assert resp.json()["detail"] == "bad period"

    def test_a_routes_501_for_something_the_endpoint_lacks_is_kept(self):
        # The S3 routes answer 501 "not supported" for an endpoint's MethodNotAllowed.
        resp = build_app(client_error("MethodNotAllowed", 405), wrap_status=501).get("/thing")
        assert resp.status_code == 501
        assert "error" not in resp.json()

    def test_a_stackport_failure_while_handling_an_endpoint_error_stays_500(self):
        app = FastAPI()
        install_aws_error_handlers(app)

        @app.get("/thing")
        def thing():
            try:
                try:
                    raise client_error("ResourceNotFoundException", 404)
                except ClientError:
                    raise RuntimeError("bug in the route's own handling")
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        resp = TestClient(app, raise_server_exceptions=False).get("/thing")
        assert resp.status_code == 500
        assert resp.json() == {"detail": "bug in the route's own handling"}

    def test_plain_httpexceptions_are_untouched(self):
        app = FastAPI()
        install_aws_error_handlers(app)

        @app.get("/thing")
        def thing():
            raise HTTPException(status_code=418, detail="teapot", headers={"X-Reason": "tea"})

        resp = TestClient(app).get("/thing")
        assert resp.status_code == 418
        assert resp.json() == {"detail": "teapot"}
        assert resp.headers["X-Reason"] == "tea"


class TestValidationErrors:
    @pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity"])
    def test_numbers_json_cant_carry_are_refused_as_invalid_input(self, number):
        # Python's JSON parser accepts these, and the 422 repeats the input it refused.
        resp = TestClient(stackport_app, raise_server_exceptions=False).post(
            "/api/explorer/services/sqs/operations/ListQueues/run",
            content=f'{{"params": {{}}, "maxPages": {number}}}'.encode(),
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 422
        [error] = resp.json()["detail"]
        assert error["loc"] == ["body", "maxPages"]
        assert error["input"] == ("nan" if number == "NaN" else "inf" if number == "Infinity" else "-inf")


class TestUncaughtErrors:
    def test_upstream_4xx_is_passed_through(self):
        resp = build_app(client_error("NoSuchBucket", 404, "The bucket does not exist")).get("/thing")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "The bucket does not exist"

    def test_upstream_5xx_is_a_bad_gateway(self):
        assert build_app(client_error("InternalError", 500)).get("/thing").status_code == 502

    def test_uncaught_not_implemented(self):
        assert build_app(client_error("NotImplemented", 501)).get("/thing").status_code == 501

    def test_uncaught_transport_error(self):
        resp = build_app(SSLError(endpoint_url="https://x", error="bad cert")).get("/thing")
        assert resp.status_code == 502
        assert resp.json()["error"]["kind"] == "tls"


class TestInstalledOnStackPort:
    @pytest.fixture
    def client(self):
        return TestClient(stackport_app)

    @patch("backend.routes.lambda_svc.get_client")
    def test_a_real_route_reports_an_unimplemented_operation(self, mock_get_client, client):
        paginator = MagicMock()
        paginator.paginate.side_effect = client_error("NotImplemented", 501)
        mock_get_client.return_value.get_paginator.return_value = paginator

        resp = client.get("/api/lambda/functions")
        assert resp.status_code == 501
        assert resp.json()["error"]["kind"] == "not_implemented"

    @patch("backend.routes.lambda_svc.get_client")
    def test_unrelated_failures_keep_their_old_shape(self, mock_get_client, client):
        mock_get_client.side_effect = RuntimeError("bug")
        resp = client.get("/api/lambda/functions")
        assert resp.status_code == 500
        assert resp.json() == {"detail": "bug"}


# --- Routes that wrap every endpoint error in a 500 (#220) -------------------

SFN_MACHINE = quote("arn:aws:states:us-east-1:123456789012:stateMachine:missing", safe="")
SFN_EXECUTION = quote("arn:aws:states:us-east-1:123456789012:execution:missing:run", safe="")


def a_secret_marked_for_deletion() -> None:
    secrets = aws("secretsmanager")
    secrets.create_secret(Name="retired", SecretString="x")
    secrets.delete_secret(SecretId="retired", RecoveryWindowInDays=7)


ROUTE_CASES = [
    pytest.param(
        a_secret_marked_for_deletion,
        "PUT", "/api/secretsmanager/secrets/retired/metadata", {"description": "old"},
        400, "InvalidRequestException", "marked for deletion",
        id="secretsmanager-update-a-deleted-secret",
    ),
    pytest.param(
        None,
        "GET", f"/api/stepfunctions/state-machines/{SFN_MACHINE}/executions", None,
        400, "StateMachineDoesNotExist", "State Machine Does Not Exist",
        id="stepfunctions-executions-of-a-missing-machine",
    ),
    pytest.param(
        None,
        "POST", f"/api/stepfunctions/executions/{SFN_EXECUTION}/stop", {},
        400, "ExecutionDoesNotExist", "Execution Does Not Exist",
        id="stepfunctions-stop-a-missing-execution",
    ),
    pytest.param(
        None,
        "GET", "/api/stepfunctions/state-machines/not-an-arn", None,
        400, "InvalidArn", "Invalid State Machine Arn",
        id="stepfunctions-invalid-arn",
    ),
    pytest.param(
        None,
        "GET", "/api/ec2/security-groups/sg-0123456789abcdef0/inbound", None,
        400, "InvalidGroup.NotFound", "does not exist",
        id="ec2-rules-of-a-missing-security-group",
    ),
    pytest.param(
        None,
        "GET", "/api/lambda/functions/missing/aliases", None,
        404, "ResourceNotFoundException", "Function not found",
        id="lambda-aliases-of-a-missing-function",
    ),
    pytest.param(
        None,
        "PUT", "/api/tags/s3/buckets/missing", {"tags": {"team": "data"}},
        404, "NoSuchBucket", "The specified bucket does not exist",
        id="tags-of-a-missing-bucket",
    ),
    pytest.param(
        None,
        "GET", "/api/tags/sqs/queues/missing", None,
        400, "AWS.SimpleQueueService.NonExistentQueue", "The specified queue does not exist",
        id="tags-of-a-missing-queue",
    ),
]


class TestEndpointErrorsThroughRoutes:
    """Routes that wrap whatever they catch in a 500 answer with the endpoint's own 4xx and message."""

    @pytest.fixture
    def client(self):
        with moto_account():
            yield TestClient(stackport_app)

    @pytest.mark.parametrize(("prepare", "method", "path", "body", "status", "code", "message"), ROUTE_CASES)
    def test_the_endpoints_answer(self, client, prepare, method, path, body, status, code, message):
        if prepare is not None:
            prepare()
        resp = client.request(method, path, json=body)
        assert resp.status_code == status, resp.text
        data = resp.json()
        assert data["error"]["kind"] == "other"
        assert data["error"]["code"] == code
        assert message in data["detail"]
        assert data["detail"] == data["error"]["message"]
