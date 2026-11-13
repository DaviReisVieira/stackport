"""boto3 clients against a real HTTPS server shaped like AWS Emulator.

The server uses a self-signed certificate for 127.0.0.1 and records the SigV4
access key of every request, which is what AWS Emulator checks.
"""

import json
import os
import shutil
from pathlib import Path

import pytest
from botocore.exceptions import SSLError

from backend import aws_emulator, config, connection
from backend.aws_client import get_client
from backend.aws_errors import ErrorKind, classify
from tests.fake_endpoint import FakeEndpoint, RecordedRequest, s3_list_buckets_handler, self_signed_cert

FIRST_RUN_KEY = "EMULATOR000000000001"
SECOND_RUN_KEY = "EMULATOR000000000002"


def aws_handler(request: RecordedRequest):
    target = request.headers.get("x-amz-target", "")
    if target == "AWSStepFunctions.StartSyncExecution":
        body = {"executionArn": "arn:aws:states:us-east-1:000000000000:execution:sm:1", "startDate": 0, "stopDate": 0, "status": "SUCCEEDED"}
        return 200, {"Content-Type": "application/x-amz-json-1.0"}, json.dumps(body).encode()
    return s3_list_buckets_handler(request)


@pytest.fixture
def tls(tmp_path):
    return self_signed_cert(tmp_path)


@pytest.fixture
def server(tls):
    with FakeEndpoint(handler=aws_handler, tls=tls) as endpoint:
        yield endpoint


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    base = tmp_path / "emulator"
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", base)
    monkeypatch.delenv("AWS_CA_BUNDLE", raising=False)
    # Most setups export placeholder keys; the emulator's own keys must still win.
    monkeypatch.setattr(connection, "AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setattr(connection, "AWS_SECRET_ACCESS_KEY", "test")
    get_client.cache_clear()
    aws_emulator.read_credentials.cache_clear()
    yield base
    get_client.cache_clear()


def start_run(base: Path, port: int, cert: Path, key_id: str, *, bump_seconds: int = 0) -> Path:
    """Write the files an AWS Emulator run on ``port`` would write."""
    run = base / str(port)
    run.mkdir(parents=True, exist_ok=True)
    shutil.copy(cert, run / "ca.pem")
    creds = run / "emulator_credentials"
    creds.write_text(f"[default]\naws_access_key_id = {key_id}\naws_secret_access_key = SECRET{key_id}\n")
    if bump_seconds:
        # A restart rewrites the files; make sure the mtime moves even on coarse clocks.
        for path in (creds, run / "ca.pem"):
            stat = path.stat()
            os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + bump_seconds * 1_000_000_000))
    return run


class TestAwsEmulatorFiles:
    def test_trusts_its_certificate_and_signs_with_its_keys(self, server, tls, isolated):
        start_run(isolated, server.port, tls.cert, FIRST_RUN_KEY)
        get_client("s3", endpoint_url=server.url).list_buckets()
        assert server.requests[-1].access_key_id == FIRST_RUN_KEY

    def test_follows_a_restart_without_clearing_anything(self, server, tls, isolated):
        start_run(isolated, server.port, tls.cert, FIRST_RUN_KEY)
        get_client("s3", endpoint_url=server.url).list_buckets()
        assert server.requests[-1].access_key_id == FIRST_RUN_KEY

        start_run(isolated, server.port, tls.cert, SECOND_RUN_KEY, bump_seconds=5)
        get_client("s3", endpoint_url=server.url).list_buckets()
        assert server.requests[-1].access_key_id == SECOND_RUN_KEY

    def test_restart_drops_clients_built_for_the_old_run(self, server, tls, isolated):
        start_run(isolated, server.port, tls.cert, FIRST_RUN_KEY)
        first = get_client("s3", endpoint_url=server.url)
        start_run(isolated, server.port, tls.cert, SECOND_RUN_KEY, bump_seconds=5)
        second = get_client("s3", endpoint_url=server.url)
        assert first is not second
        assert get_client.cache_info().currsize == 1

    def test_clients_are_reused_while_the_run_lasts(self, server, tls, isolated):
        start_run(isolated, server.port, tls.cert, FIRST_RUN_KEY)
        assert get_client("s3", endpoint_url=server.url) is get_client("s3", endpoint_url=server.url)

    def test_endpoint_keys_still_win(self, server, tls, isolated):
        start_run(isolated, server.port, tls.cert, FIRST_RUN_KEY)
        client = get_client(
            "s3",
            endpoint_url=server.url,
            auth_type="credentials",
            auth_access_key_id="ENDPOINTKEY",
            auth_secret_access_key="ENDPOINTSECRET",
        )
        client.list_buckets()
        assert server.requests[-1].access_key_id == "ENDPOINTKEY"

    def test_host_prefixed_operations_reach_the_endpoint(self, server, tls, isolated):
        # Without inject_host_prefix=False boto3 would send this to sync-127.0.0.1.
        start_run(isolated, server.port, tls.cert, FIRST_RUN_KEY)
        sfn = get_client("stepfunctions", endpoint_url=server.url)
        sfn.start_sync_execution(stateMachineArn="arn:aws:states:us-east-1:000000000000:stateMachine:sm")
        request = server.requests[-1]
        assert request.headers["x-amz-target"] == "AWSStepFunctions.StartSyncExecution"
        assert request.headers["host"] == f"127.0.0.1:{server.port}"


class TestTrustWithoutEmulatorFiles:
    def test_untrusted_certificate_is_a_tls_error(self, server):
        with pytest.raises(SSLError) as info:
            get_client("s3", endpoint_url=server.url).list_buckets()
        classified = classify(info.value)
        assert classified is not None and classified.kind is ErrorKind.TLS
        assert classified.hint and "CA bundle" in classified.hint

    def test_endpoint_ca_bundle(self, server, tls):
        get_client("s3", endpoint_url=server.url, ca_bundle=str(tls.cert)).list_buckets()
        assert server.requests[-1].access_key_id == "test"

    @pytest.mark.filterwarnings("ignore::urllib3.exceptions.InsecureRequestWarning")
    def test_verification_off(self, server):
        get_client("s3", endpoint_url=server.url, tls_verify=False).list_buckets()
        assert server.requests

    def test_ca_bundle_is_per_endpoint(self, server, tls):
        # A bundle on one endpoint must not leak into another endpoint's trust.
        get_client("s3", endpoint_url=server.url, ca_bundle=str(tls.cert)).list_buckets()
        with pytest.raises(SSLError):
            get_client("s3", endpoint_url=server.url).list_buckets()


def test_stopped_emulator_reads_as_unreachable(isolated, monkeypatch):
    # After a clean stop the folder is empty and nothing listens on the port.
    monkeypatch.setattr(connection, "AWS_ACCESS_KEY_ID", None)
    monkeypatch.setattr(connection, "AWS_SECRET_ACCESS_KEY", None)
    import socket

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    (isolated / str(port)).mkdir(parents=True)
    with pytest.raises(Exception) as info:
        get_client("s3", endpoint_url=f"https://127.0.0.1:{port}").list_buckets()
    assert classify(info.value).kind is ErrorKind.UNREACHABLE
