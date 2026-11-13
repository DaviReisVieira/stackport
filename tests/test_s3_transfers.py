"""S3 transfers through StackPort where the bytes on the wire matter.

Errors an emulator really sends, streams that break or never end, and the
chunks a download is relayed in. Everything StackPort does runs for real: a
real boto3 client against moto, or against an HTTP server on a socket.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

import anyio
import pytest
from botocore.exceptions import IncompleteReadError, ResponseStreamingError
from fastapi.testclient import TestClient

from backend.downloads import RELAY_CHUNK_BYTES
from backend.main import app
from backend.routes import s3 as s3_routes
from tests.moto_inprocess import moto_client, moto_routes

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
        # Set when StackPort closes a connection this server was still writing to.
        self.aborted = threading.Event()
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


def send_object_head(handler: BaseHTTPRequestHandler, length: int) -> None:
    handler.send_response(200)
    handler.send_header("Content-Type", "application/octet-stream")
    handler.send_header("Content-Length", str(length))
    handler.send_header("ETag", '"0123456789abcdef"')
    handler.send_header("Last-Modified", "Fri, 13 Nov 2026 12:00:00 GMT")
    handler.end_headers()


async def run_download(sent: list[dict], key: str, *, endpoint: str | None = None, disconnect_after_first_chunk: bool = False) -> None:
    """Download ``key`` through the whole app over ASGI, the way uvicorn does, recording what it sends.

    TestClient collects the whole body before returning, so it can't show the
    chunks, or what happens when the client goes away halfway through.
    """
    first_chunk = anyio.Event()
    request_delivered = False

    async def receive() -> dict:
        nonlocal request_delivered
        if not request_delivered:
            request_delivered = True
            return {"type": "http.request", "body": b"", "more_body": False}
        if disconnect_after_first_chunk:
            await first_chunk.wait()
        else:
            await anyio.sleep_forever()
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        sent.append(message)
        if message["type"] == "http.response.body" and message.get("body"):
            first_chunk.set()

    path = f"/api/s3/buckets/{BUCKET}/objects/{key}"
    query = {"download": "1", **({"endpoint": endpoint} if endpoint else {})}
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": urlencode(query).encode(),
        "headers": [(b"host", b"testserver")],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
        "state": {},
    }
    with anyio.fail_after(10):
        await app(scope, receive, send)


def bodies(sent: list[dict]) -> list[dict]:
    return [message for message in sent if message["type"] == "http.response.body"]


def chain(exc: BaseException | None) -> Iterator[BaseException]:
    while exc is not None:
        yield exc
        exc = exc.__cause__ or exc.__context__


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


class TestDownloadStreaming:
    @pytest.mark.anyio
    async def test_relays_in_large_chunks(self, monkeypatch):
        """A botocore body iterates in 1 KiB chunks, each a hop through the thread pool (50 MiB took 4.7 s, not 0.3 s)."""
        data = os.urandom(MIB)
        sent: list[dict] = []
        with moto_routes(monkeypatch, s3_routes):
            s3 = moto_client("s3")
            s3.create_bucket(Bucket=BUCKET)
            s3.put_object(Bucket=BUCKET, Key="blob.bin", Body=data)
            await run_download(sent, "blob.bin")

        chunks = [message["body"] for message in bodies(sent) if message["body"]]
        assert RELAY_CHUNK_BYTES >= 64 * 1024
        assert [len(chunk) for chunk in chunks] == [RELAY_CHUNK_BYTES] * (MIB // RELAY_CHUNK_BYTES)
        assert b"".join(chunks) == data
        assert sent[0]["status"] == 200
        assert (b"content-length", str(MIB).encode()) in sent[0]["headers"]
        assert bodies(sent)[-1] == {"type": "http.response.body", "body": b"", "more_body": False}

    @pytest.mark.anyio
    async def test_cut_off_download_is_not_finished(self, socket_s3):
        """The endpoint stops halfway: the response must end without the message that says it's complete."""
        whole = 2 * MIB

        def cut_off(handler: BaseHTTPRequestHandler, _query: dict[str, list[str]]) -> None:
            send_object_head(handler, whole)
            handler.wfile.write(bytes(whole // 2))
            handler.close_connection = True

        server = socket_s3(cut_off)
        sent: list[dict] = []

        # The error reaches the server, which drops the connection.
        with pytest.raises(Exception) as raised:
            await run_download(sent, "half.bin", endpoint=server.origin)

        # Depending on the botocore release, the short body surfaces from urllib3
        # (ResponseStreamingError) or from botocore's own Content-Length check (IncompleteReadError).
        assert any(isinstance(exc, (ResponseStreamingError, IncompleteReadError)) for exc in chain(raised.value))
        assert sent[0]["status"] == 200
        assert (b"content-length", str(whole).encode()) in sent[0]["headers"]
        assert 0 < sum(len(message["body"]) for message in bodies(sent)) <= whole // 2
        assert not any(message.get("more_body") is False for message in bodies(sent))

    @pytest.mark.anyio
    async def test_client_going_away_closes_the_upstream(self, socket_s3):
        """A cancelled download mustn't leave the endpoint sending to StackPort."""

        def endless(handler: BaseHTTPRequestHandler, _query: dict[str, list[str]]) -> None:
            send_object_head(handler, 1024 * MIB)
            chunk = bytes(64 * 1024)
            try:
                while True:
                    handler.wfile.write(chunk)
            except TimeoutError:
                raise
            except OSError:
                server.aborted.set()

        server = socket_s3(endless)
        sent: list[dict] = []

        await run_download(sent, "endless.bin", endpoint=server.origin, disconnect_after_first_chunk=True)

        assert sum(len(message["body"]) for message in bodies(sent)) > 0
        assert await anyio.to_thread.run_sync(server.aborted.wait, 5)
