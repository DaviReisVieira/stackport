"""Classifying boto3 failures by what fixes them."""

from pathlib import Path

import pytest
from botocore.exceptions import (
    ClientError,
    ConnectTimeoutError,
    EndpointConnectionError,
    NoCredentialsError,
    ProfileNotFound,
    ReadTimeoutError,
    SSLError,
)
from fastapi import HTTPException

from backend.aws_client import get_client
from backend.aws_emulator import AwsEmulatorFilesError
from backend.aws_errors import ErrorKind, classify, classify_one
from tests.fake_endpoint import FakeEndpoint, RecordedRequest, ministack_s3_fallback, s3_error


def client_error(code: str, message: str = "boom", status: int = 400, operation: str = "ListThings") -> ClientError:
    return ClientError(
        {"Error": {"Code": code, "Message": message}, "ResponseMetadata": {"HTTPStatusCode": status}},
        operation,
    )


class TestClientErrors:
    def test_aws_emulator_not_implemented(self):
        result = classify(client_error("NotImplemented", status=501, operation="ListWorkGroups"))
        assert result.kind is ErrorKind.NOT_IMPLEMENTED
        assert result.operation == "ListWorkGroups"
        assert "ListWorkGroups" in result.message

    def test_501_with_another_code(self):
        # LocalStack answers 501 with InternalFailure for operations it lacks.
        result = classify(client_error("InternalFailure", status=501))
        assert result.kind is ErrorKind.NOT_IMPLEMENTED
        assert result.code == "InternalFailure"

    def test_aws_emulator_keys_from_another_run(self):
        result = classify(client_error("AccessDenied", "Sign the request with the emulator credentials", 403))
        assert result.kind is ErrorKind.CREDENTIALS
        assert "AWS Emulator" in result.message
        assert "STACKPORT_AWS_EMULATOR_DIR" in result.hint

    @pytest.mark.parametrize("code", ["InvalidClientTokenId", "SignatureDoesNotMatch", "UnrecognizedClientException", "ExpiredToken"])
    def test_rejected_credentials(self, code):
        result = classify(client_error(code, status=403))
        assert result.kind is ErrorKind.CREDENTIALS and result.code == code

    @pytest.mark.parametrize("code", ["AccessDenied", "AccessDeniedException", "UnauthorizedOperation", "AuthorizationError"])
    def test_permission_denied(self, code):
        result = classify(client_error(code, "User is not authorized", 403))
        assert result.kind is ErrorKind.FORBIDDEN
        assert result.message == "User is not authorized"

    def test_anything_else_keeps_the_endpoints_message(self):
        result = classify(client_error("ResourceNotFoundException", "Function not found", 404))
        assert result.kind is ErrorKind.OTHER
        assert result.message == "Function not found"
        assert result.cause is None


class TestTransportErrors:
    def test_untrusted_certificate(self):
        exc = SSLError(endpoint_url="https://127.0.0.1:9297", error="CERTIFICATE_VERIFY_FAILED")
        result = classify(exc)
        assert result.kind is ErrorKind.TLS
        assert "CERTIFICATE_VERIFY_FAILED" in result.cause

    @pytest.mark.parametrize(
        "exc",
        [
            EndpointConnectionError(endpoint_url="http://localhost:4566"),
            ConnectTimeoutError(endpoint_url="http://10.0.0.1:4566"),
        ],
    )
    def test_unreachable(self, exc):
        assert classify(exc).kind is ErrorKind.UNREACHABLE

    def test_a_slow_call_is_not_an_unreachable_endpoint(self):
        # One slow operation must not make the probe give up on every service.
        result = classify(ReadTimeoutError(endpoint_url="http://localhost:4566"))
        assert result.kind is ErrorKind.OTHER
        assert not result.is_endpoint_problem
        assert "localhost:4566" in result.cause

    def test_not_tls_at_all(self):
        exc = SSLError(endpoint_url="https://127.0.0.1:4566", error="[SSL: WRONG_VERSION_NUMBER] wrong version number")
        result = classify(exc)
        assert result.kind is ErrorKind.TLS
        assert result.message == "The endpoint didn't answer with TLS."
        assert "http://" in result.hint

    def test_other_handshake_failure(self):
        result = classify(SSLError(endpoint_url="https://x", error="[SSL: SSLV3_ALERT_HANDSHAKE_FAILURE] handshake failure"))
        assert result.message == "The TLS handshake with the endpoint failed."

    @pytest.mark.parametrize("code", ["InvalidAction", "UnknownOperationException"])
    def test_ministack_unknown_operations_are_not_implemented(self, code):
        assert classify(client_error(code, status=400)).kind is ErrorKind.NOT_IMPLEMENTED

    def test_no_credentials(self):
        assert classify(NoCredentialsError()).kind is ErrorKind.CREDENTIALS

    def test_missing_profile(self):
        assert classify(ProfileNotFound(profile="dev")).kind is ErrorKind.CREDENTIALS

    def test_unreadable_emulator_files(self):
        result = classify(AwsEmulatorFilesError(Path.home() / ".aws/emulator/9297/emulator_credentials", "permission denied"))
        assert result.kind is ErrorKind.CREDENTIALS
        assert "~/.aws/emulator/9297" in result.message


def delete_marker_version(request: RecordedRequest):
    """What S3 answers a GET or HEAD of a version that is a delete marker."""
    headers = {"Content-Type": "application/xml", "x-amz-delete-marker": "true"}
    if request.method == "HEAD":
        return 405, headers, b""
    return 405, headers, s3_error("MethodNotAllowed", "The specified method is not allowed against this resource.")


class TestApisTheEndpointHandsToS3:
    """An endpoint that gives requests for an API it doesn't serve to S3, as MiniStack does.

    botocore parses the real answers: an error that isn't in the API's own
    format keeps the HTTP status as its code.
    """

    @pytest.fixture
    def endpoint(self):
        with FakeEndpoint(handler=ministack_s3_fallback) as server:
            yield server.url

    @pytest.fixture
    def s3_with_a_delete_marker(self):
        with FakeEndpoint(handler=delete_marker_version) as server:
            yield get_client("s3", endpoint_url=server.url)

    @pytest.mark.parametrize(
        ("service", "method", "operation", "s3_code"),
        [
            # JSON APIs post to "/"; REST ones post to a path of their own or get one.
            ("codepipeline", "list_pipelines", "ListPipelines", "MethodNotAllowed"),
            ("xray", "get_groups", "GetGroups", "MethodNotAllowed"),
            ("bedrock", "list_custom_models", "ListCustomModels", "NoSuchBucket"),
        ],
    )
    def test_is_not_implemented(self, endpoint, service, method, operation, s3_code):
        with pytest.raises(ClientError) as raised:
            getattr(get_client(service, endpoint_url=endpoint), method)()
        result = classify(raised.value)
        assert result.kind is ErrorKind.NOT_IMPLEMENTED
        assert (result.code, result.operation) == (s3_code, operation)
        assert result.message == f"This endpoint doesn't implement {operation} yet."

    @pytest.mark.parametrize("method", ["get_object", "head_object"])
    def test_s3s_own_errors_keep_their_meaning(self, s3_with_a_delete_marker, method):
        with pytest.raises(ClientError) as raised:
            getattr(s3_with_a_delete_marker, method)(Bucket="reports", Key="q3.csv", VersionId="3HL4kqtJlcpXroDTDmJ")
        assert classify(raised.value).kind is ErrorKind.OTHER

    def test_an_apis_own_error_without_a_code_is_left_alone(self):
        # Not an S3 document: nothing says which part of the endpoint answered.
        result = classify(client_error("405", "<html><body>Method Not Allowed</body></html>", 405))
        assert result.kind is ErrorKind.OTHER


class TestChains:
    def test_finds_the_cause_behind_an_httpexception(self):
        # The pattern most routes use: wrap whatever was raised in a 500.
        try:
            try:
                raise client_error("NotImplemented", status=501)
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))
        except HTTPException as wrapped:
            assert classify(wrapped).kind is ErrorKind.NOT_IMPLEMENTED

    def test_explicit_cause(self):
        try:
            raise HTTPException(status_code=500) from EndpointConnectionError(endpoint_url="http://x")
        except HTTPException as wrapped:
            assert classify(wrapped).kind is ErrorKind.UNREACHABLE

    def test_unrelated_errors_are_left_alone(self):
        assert classify(ValueError("bad input")) is None
        assert classify_one(HTTPException(status_code=404)) is None

    def test_cycles_terminate(self):
        a, b = ValueError("a"), ValueError("b")
        a.__context__, b.__context__ = b, a
        assert classify(a) is None


def test_to_dict_drops_empty_fields():
    data = classify(client_error("NotImplemented", status=501)).to_dict()
    assert data["kind"] == "not_implemented"
    assert None not in data.values()


def test_hints_name_the_configured_emulator_folder(monkeypatch, tmp_path):
    from backend import config

    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path / "emu")
    result = classify(client_error("AccessDenied", "Sign the request with the emulator credentials", 403))
    assert str(tmp_path / "emu") in result.hint
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", None)
    tls = classify(SSLError(endpoint_url="https://x", error="certificate verify failed"))
    assert "STACKPORT_AWS_EMULATOR_DIR" in tls.hint
