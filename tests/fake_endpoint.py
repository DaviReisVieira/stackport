"""A real HTTP(S) server on 127.0.0.1 standing in for an AWS-compatible endpoint.

For tests that need actual sockets: TLS trust, SigV4 headers, host prefixes.
Each request is recorded; a handler function decides the response.
"""

from __future__ import annotations

import shutil
import ssl
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


@dataclass
class RecordedRequest:
    method: str
    path: str
    headers: dict[str, str]
    body: bytes

    @property
    def access_key_id(self) -> str | None:
        """The access key ID from a SigV4 Authorization header, if any."""
        auth = self.headers.get("authorization", "")
        marker = "Credential="
        if marker not in auth:
            return None
        return auth.split(marker, 1)[1].split("/", 1)[0]


Response = tuple[int, dict[str, str], bytes]
Handler = Callable[[RecordedRequest], Response]

S3_EMPTY_LIST_BUCKETS = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b'<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
    b"<Owner><ID>owner</ID></Owner><Buckets></Buckets></ListAllMyBucketsResult>"
)


def s3_list_buckets_handler(_request: RecordedRequest) -> Response:
    return 200, {"Content-Type": "application/xml"}, S3_EMPTY_LIST_BUCKETS


def s3_error(code: str, message: str) -> bytes:
    """An S3 error document, as MiniStack's S3 handler writes it."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f"<Error><Code>{code}</Code><Message>{message}</Message><Resource /><RequestId>9f3c</RequestId></Error>"
    ).encode()


def ministack_s3_fallback(request: RecordedRequest) -> Response:
    """What MiniStack answers a request it can't route to a service: its S3 handler takes it."""
    headers = {"Content-Type": "application/xml"}
    if request.method == "GET":
        return 404, headers, s3_error("NoSuchBucket", "The specified bucket does not exist")
    return 405, headers, s3_error("MethodNotAllowed", "The specified method is not allowed against this resource.")


@dataclass(frozen=True)
class TlsMaterial:
    cert: Path
    key: Path


def self_signed_cert(directory: Path) -> TlsMaterial:
    """A certificate for 127.0.0.1 and localhost, like the one AWS Emulator creates."""
    if shutil.which("openssl") is None:
        pytest.skip("openssl CLI not available")
    cert, key = directory / "cert.pem", directory / "key.pem"
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(key), "-out", str(cert), "-days", "1",
            "-subj", "/CN=localhost",
            "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
        ],
        check=True,
        capture_output=True,
    )
    return TlsMaterial(cert=cert, key=key)


@dataclass
class FakeEndpoint:
    handler: Handler = s3_list_buckets_handler
    tls: TlsMaterial | None = None
    requests: list[RecordedRequest] = field(default_factory=list)

    def __post_init__(self):
        recorded = self.requests
        endpoint = self

        class _Handler(BaseHTTPRequestHandler):
            def _serve(self):
                length = int(self.headers.get("Content-Length") or 0)
                request = RecordedRequest(
                    method=self.command,
                    path=self.path,
                    headers={k.lower(): v for k, v in self.headers.items()},
                    body=self.rfile.read(length) if length else b"",
                )
                recorded.append(request)
                status, headers, body = endpoint.handler(request)
                self.send_response(status)
                for name, value in headers.items():
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = _serve

            def log_message(self, *_args):
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self._server.daemon_threads = True
        if self.tls is not None:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(self.tls.cert, self.tls.key)
            self._server.socket = context.wrap_socket(self._server.socket, server_side=True)
        self._thread = threading.Thread(target=self._server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)

    @property
    def port(self) -> int:
        return self._server.server_address[1]

    @property
    def url(self) -> str:
        scheme = "https" if self.tls is not None else "http"
        return f"{scheme}://127.0.0.1:{self.port}"

    def __enter__(self) -> FakeEndpoint:
        self._thread.start()
        return self

    def __exit__(self, *_exc):
        self._server.shutdown()
        self._server.server_close()
