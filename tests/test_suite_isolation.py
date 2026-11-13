"""The suite never reaches an emulator on its default port (see conftest.py)."""

import errno
import socket

import boto3
import pytest
from botocore.config import Config
from botocore.exceptions import EndpointConnectionError

from tests.conftest import EMULATOR_DEFAULT_PORTS


@pytest.mark.parametrize("port", sorted(EMULATOR_DEFAULT_PORTS))
def test_connections_to_emulator_default_ports_are_refused(port):
    with socket.socket() as sock, pytest.raises(ConnectionRefusedError, match="default port"):
        sock.connect(("127.0.0.1", port))
    with socket.socket() as sock:
        assert sock.connect_ex(("localhost", port)) == errno.ECONNREFUSED


def test_other_local_ports_still_work():
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        with socket.create_connection(server.getsockname(), timeout=2):
            pass


@pytest.mark.parametrize("endpoint_url", ["http://localhost:4566", "https://127.0.0.1:9297"])
def test_an_aws_call_to_a_default_port_never_reaches_an_emulator(endpoint_url):
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        region_name="us-east-1",
        aws_access_key_id="test",
        aws_secret_access_key="test",
        config=Config(retries={"total_max_attempts": 1}),
    )
    with pytest.raises(EndpointConnectionError):
        s3.list_buckets()
