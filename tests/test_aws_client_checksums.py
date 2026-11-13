"""Flexible checksums: only where an API requires them for local emulators, botocore's defaults for AWS.

Requests go to a real HTTP server on 127.0.0.1, so the headers checked are the
ones botocore actually sends.
"""

import pytest

from backend.aws_client import get_client
from tests.fake_endpoint import FakeEndpoint, RecordedRequest

OBJECT = b"hello world"
# What moto sends for an object uploaded in parts: a checksum of the part
# checksums, without the "-<parts>" suffix that says it isn't the object's own.
NOT_THIS_OBJECTS_CRC32 = "FBDs1g=="


def s3_handler(request: RecordedRequest):
    if request.method == "GET":
        return 200, {
            "Content-Type": "application/octet-stream",
            "ETag": '"5eb63bbbe01eeed093cb22bb8f5acdc3-2"',
            "Last-Modified": "Fri, 13 Nov 2026 12:00:00 GMT",
            "x-amz-checksum-crc32": NOT_THIS_OBJECTS_CRC32,
        }, OBJECT
    if request.method == "POST":  # DeleteObjects
        return 200, {"Content-Type": "application/xml"}, b"<DeleteResult></DeleteResult>"
    return 200, {"ETag": '"etag"'}, b""


@pytest.fixture(autouse=True)
def botocore_defaults(monkeypatch, tmp_path):
    """No checksum settings from the environment or a config file: only what StackPort chooses."""
    monkeypatch.delenv("AWS_REQUEST_CHECKSUM_CALCULATION", raising=False)
    monkeypatch.delenv("AWS_RESPONSE_CHECKSUM_VALIDATION", raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "no-config"))
    get_client.cache_clear()
    yield
    get_client.cache_clear()


@pytest.fixture
def server():
    with FakeEndpoint(handler=s3_handler) as endpoint:
        yield endpoint


def checksum_headers(request: RecordedRequest) -> dict[str, str]:
    return {name: value for name, value in request.headers.items() if "checksum" in name or name == "content-md5"}


class TestLocalEndpoint:
    def test_download_is_not_held_to_a_checksum_it_did_not_ask_for(self, server):
        s3 = get_client("s3", endpoint_url=server.url)

        assert s3.get_object(Bucket="bkt", Key="big.bin")["Body"].read() == OBJECT
        assert checksum_headers(server.requests[-1]) == {}

    def test_upload_sends_no_optional_checksum(self, server):
        get_client("s3", endpoint_url=server.url).put_object(Bucket="bkt", Key="k", Body=b"data")

        assert server.requests[-1].method == "PUT"
        assert checksum_headers(server.requests[-1]) == {}

    def test_checksums_an_api_requires_are_still_sent(self, server):
        """S3 refuses a DeleteObjects request without one."""
        get_client("s3", endpoint_url=server.url).delete_objects(Bucket="bkt", Delete={"Objects": [{"Key": "k"}]})

        assert checksum_headers(server.requests[-1])


class TestRealAws:
    def test_keeps_botocore_defaults(self):
        config = get_client("s3", endpoint_url=None).meta.config

        assert config.request_checksum_calculation == "when_supported"
        assert config.response_checksum_validation == "when_supported"
