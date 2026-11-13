"""App-wide handlers: AWS failures answered with the right status and an actionable message."""

from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError, SSLError
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.error_handlers import install_aws_error_handlers
from backend.main import app as stackport_app


def client_error(code: str, status: int, message: str = "boom") -> ClientError:
    return ClientError(
        {"Error": {"Code": code, "Message": message}, "ResponseMetadata": {"HTTPStatusCode": status}},
        "ListThings",
    )


def build_app(exc: Exception, *, wrap_status: int | None = None) -> TestClient:
    """An app with one route that raises ``exc``, wrapped the way StackPort's routes do."""
    app = FastAPI()
    install_aws_error_handlers(app)

    @app.get("/thing")
    def thing():
        if wrap_status is None:
            raise exc
        try:
            raise exc
        except Exception as e:
            raise HTTPException(status_code=wrap_status, detail=str(e))

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
