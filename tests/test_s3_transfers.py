"""S3 transfers through StackPort where the bytes on the wire matter.

Errors an emulator really sends. Everything StackPort does runs for real: a
real boto3 client against an HTTP server on a socket.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

BUCKET = "my-bucket"
MIB = 1024 * 1024

# What AWS Emulator 1.0.345 answers (HTTP 400) when a part would take a bucket
# past the 64 MiB it keeps per bucket: a live capture, with this test's bucket.
BUCKET_FULL = (
    b"<Error><Code>ValidationException</Code><Message>recording part 2 would leave the bucket "
    b"&quot;my-bucket&quot; holding 71303168 bytes, past the 67108864 bytes this emulator keeps per bucket"
    b"</Message><RequestId>1A3D15D98E58C150</RequestId><HostId>1a3d15d98e58c150</HostId></Error>"
)
BUCKET_FULL_MESSAGE = (
    'recording part 2 would leave the bucket "my-bucket" holding 71303168 bytes, '
    "past the 67108864 bytes this emulator keeps per bucket"
)

Respond = Callable[[BaseHTTPRequestHandler, dict[str, list[str]]], None]


class SocketS3:
    """A real HTTP server answering S3 requests the way a test says to."""

    def __init__(self, respond: Respond):
        self.requests: list[tuple[str, str]] = []
        server = self

        class Handler(BaseHTTPRequestHandler):
            # HTTP/1.1 answers "Expect: 100-continue", which boto3 sends with every upload body.
            protocol_version = "HTTP/1.1"
            timeout = 10  # a connection StackPort never closes fails the test instead of hanging it

            def _handle(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                if length:
                    self.rfile.read(length)
                parts = urlsplit(self.path)
                server.requests.append((self.command, parts.path))
                respond(self, parse_qs(parts.query, keep_blank_values=True))

            do_GET = do_PUT = do_POST = do_DELETE = _handle

            def log_message(self, format: str, *args: Any) -> None:
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self.origin = f"http://127.0.0.1:{self._server.server_address[1]}"
        self._thread = threading.Thread(target=self._server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()


@pytest.fixture
def socket_s3() -> Iterator[Callable[[Respond], SocketS3]]:
    servers: list[SocketS3] = []

    def start(respond: Respond) -> SocketS3:
        servers.append(SocketS3(respond))
        return servers[-1]

    yield start
    for server in servers:
        server.close()


def reply(handler: BaseHTTPRequestHandler, status: int, body: bytes = b"", headers: dict[str, str] | None = None) -> None:
    handler.send_response(status)
    for name, value in (headers or {}).items():
        handler.send_header(name, value)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class TestUploadErrors:
    def test_full_bucket_reaches_the_client_and_the_upload_is_aborted(self, socket_s3):
        """AWS Emulator refuses a part that would overfill the bucket.

        Its own words reach the browser, and the upload is aborted, so the parts
        already sent don't keep counting against the bucket.
        """

        def bucket_fills_up(handler: BaseHTTPRequestHandler, query: dict[str, list[str]]) -> None:
            if handler.command == "POST" and "uploads" in query:
                reply(
                    handler,
                    200,
                    b"<InitiateMultipartUploadResult><Bucket>my-bucket</Bucket><Key>big.bin</Key>"
                    b"<UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
                    {"Content-Type": "application/xml"},
                )
            elif handler.command == "PUT" and query.get("partNumber") == ["1"]:
                reply(handler, 200, headers={"ETag": '"part-1"'})
            elif handler.command == "PUT":
                reply(handler, 400, BUCKET_FULL, {"Content-Type": "application/xml"})
            elif handler.command == "DELETE" and query.get("uploadId") == ["upload-1"]:
                reply(handler, 204)
            else:
                reply(handler, 500)

        server = socket_s3(bucket_fills_up)

        resp = client.post(
            f"/api/s3/buckets/{BUCKET}/objects",
            params={"endpoint": server.origin},
            files={"file": ("big.bin", os.urandom(9 * MIB), "application/octet-stream")},
        )

        assert resp.status_code == 400
        body = resp.json()
        assert body["detail"] == BUCKET_FULL_MESSAGE
        assert body["error"]["code"] == "ValidationException"
        assert body["error"]["operation"] == "UploadPart"
        assert server.requests == [
            ("POST", "/my-bucket/big.bin"),
            ("PUT", "/my-bucket/big.bin"),
            ("PUT", "/my-bucket/big.bin"),
            ("DELETE", "/my-bucket/big.bin"),
        ]
