"""Send one Try it request to an API Gateway stage or a Lambda function URL, and read the answer.

The connection always goes to the target's own host and port
(``invoke_urls.InvokeTarget``), worked out from the resource: the request
only supplies the method, a path below the target, query parameters, headers
and a body. Redirects are shown, not followed, and the answer's body is read
up to RESPONSE_BODY_LIMIT. The whole exchange, from the TLS handshake to the
last byte, ends at RESPONSE_TIMEOUT: socket timeouts alone only bound each wait
for data, and a server sending a byte at a time would hold the request. Line
lengths and the number of headers are http.client's own limits.
"""

from __future__ import annotations

import base64
import codecs
import http.client
import socket
import ssl
import threading
import time
from dataclasses import dataclass, field
from urllib.parse import quote, urlencode

from backend.aws_errors import ClassifiedError, ErrorKind
from backend.invoke_urls import InvokeTarget
from backend.schemas.try_it import TryItRequest

# Bytes of the answer's body StackPort reads and shows.
RESPONSE_BODY_LIMIT = 1024 * 1024
# Seconds for the whole exchange. API Gateway gives an integration 29 seconds;
# an emulator starting a function's container for the first time can take a
# while longer.
RESPONSE_TIMEOUT = 60.0
_READ_CHUNK = 64 * 1024

# Headers that describe one connection rather than the request (RFC 9110,
# section 7.6.1), plus the two StackPort sets itself.
_LEFT_OUT_HEADERS = frozenset({
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
})
# Methods that carry a body, which get "Content-Length: 0" without one, as http.client sends them.
_BODY_METHODS = frozenset({"POST", "PUT", "PATCH"})

_SLOW_HINT = "A function starting for the first time on an emulator can be slow. Try again in a moment."
_TLS_HINT = (
    "StackPort trusts the same certificates for this request as for the endpoint's API calls. "
    "For a self-signed certificate, set the endpoint's CA bundle in Settings."
)


class SendFailed(Exception):
    """No answer came back. ``error`` says why, in the terms of backend.aws_errors."""

    def __init__(self, error: ClassifiedError):
        super().__init__(error.message)
        self.error = error


@dataclass
class Exchange:
    """What was sent and what came back, as the route returns it."""

    method: str
    url: str
    request_headers: list[tuple[str, str]]
    status: int
    reason: str
    headers: list[tuple[str, str]]
    body: bytes
    truncated: bool
    duration_ms: float
    notices: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        text = _text(self.body, complete=not self.truncated)
        return {
            "request": {"method": self.method, "url": self.url, "headers": [list(pair) for pair in self.request_headers]},
            "status": self.status,
            "reason": self.reason,
            "headers": [list(pair) for pair in self.headers],
            "bodyText": text,
            "bodyBase64": base64.b64encode(self.body).decode("ascii") if text is None else None,
            "bodyBytes": len(self.body),
            "truncated": self.truncated,
            "durationMs": round(self.duration_ms, 1),
            "notices": self.notices,
        }


def request_target(target: InvokeTarget, request: TryItRequest) -> str:
    """The path and query StackPort sends: the target's base path, then the request's path below it."""
    path = target.base_path + request.path
    query = urlencode([(pair.name, pair.value) for pair in request.query], quote_via=quote)
    return f"{path}?{query}" if query else path


def send(
    target: InvokeTarget,
    request: TryItRequest,
    *,
    context: ssl.SSLContext | None,
    connect_timeout: float,
) -> Exchange:
    """Send ``request`` to ``target`` and read the answer.

    Raises:
        SendFailed: nothing answered, or the answer didn't arrive in time.
    """
    notices: list[str] = []
    headers = [("Host", target.host)]
    left_out = sorted({pair.name for pair in request.headers if pair.name.lower() in _LEFT_OUT_HEADERS})
    if left_out:
        notices.append(f"StackPort sets these headers itself, so yours were left out: {', '.join(left_out)}.")
    headers += [(pair.name, pair.value) for pair in request.headers if pair.name.lower() not in _LEFT_OUT_HEADERS]
    body = request.body.encode("utf-8") if request.body is not None else None
    if body is not None or request.method in _BODY_METHODS:
        headers.append(("Content-Length", str(len(body or b""))))

    path = request_target(target, request)
    origin = f"{target.scheme}://{target.host}"
    started = time.perf_counter()
    connection = _connection(target, context, connect_timeout)
    deadline = _Deadline(connection, RESPONSE_TIMEOUT)
    connected = False
    try:
        with deadline:
            connection.connect()
            connected = True
            connection.sock.settimeout(RESPONSE_TIMEOUT)
            # Accept-Encoding is only added when the request doesn't set one: two would contradict each other.
            connection.putrequest(
                request.method,
                path,
                skip_host=True,
                skip_accept_encoding=any(name.lower() == "accept-encoding" for name, _ in headers),
            )
            for name, value in headers:
                connection.putheader(name, value)
            connection.endheaders(body)
            response = connection.getresponse()
            payload, truncated = _read(response)
    except (OSError, http.client.HTTPException) as exc:
        failure = (
            _timed_out(origin)
            if deadline.expired.is_set()
            else _failure(origin, exc, connecting=not connected, connect_timeout=connect_timeout)
        )
        raise SendFailed(failure) from exc
    finally:
        connection.close()
    # Shutting the socket can look like the server ending its answer normally.
    if deadline.expired.is_set():
        raise SendFailed(_timed_out(origin))

    if truncated:
        notices.append(f"The body is longer than {_size(RESPONSE_BODY_LIMIT)}: this is its beginning.")
    return Exchange(
        method=request.method,
        url=f"{origin}{path}",
        request_headers=headers,
        status=response.status,
        reason=response.reason,
        headers=response.getheaders(),
        body=payload,
        truncated=truncated,
        duration_ms=(time.perf_counter() - started) * 1000,
        notices=notices,
    )


def _connection(target: InvokeTarget, context: ssl.SSLContext | None, timeout: float) -> http.client.HTTPConnection:
    if target.scheme == "https":
        return _HTTPSConnection(
            target.connect_host, target.connect_port, timeout=timeout, context=context or ssl.create_default_context()
        )
    return http.client.HTTPConnection(target.connect_host, target.connect_port, timeout=timeout)


class _HTTPSConnection(http.client.HTTPConnection):
    """HTTPS that shakes hands once the TLS socket is in ``sock``.

    ``HTTPSConnection`` shakes hands inside ``wrap_socket``, on a socket nothing
    else can reach yet, so the deadline couldn't shut a handshake that stalls.
    """

    def __init__(self, host: str, port: int, *, timeout: float, context: ssl.SSLContext):
        super().__init__(host, port, timeout=timeout)
        self._tls_context = context

    def connect(self) -> None:
        super().connect()
        self.sock = self._tls_context.wrap_socket(self.sock, server_hostname=self.host, do_handshake_on_connect=False)
        self.sock.do_handshake()


class _Deadline:
    """Shuts the connection's socket when time runs out, wherever the exchange is waiting.

    A shutdown wakes a blocked read, which a timeout set on the socket only does
    when no byte at all arrives for that long.
    """

    def __init__(self, connection: http.client.HTTPConnection, seconds: float):
        self.expired = threading.Event()
        self._connection = connection
        self._timer = threading.Timer(seconds, self._expire)
        self._timer.daemon = True

    def __enter__(self) -> _Deadline:
        self._timer.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._timer.cancel()

    def _expire(self) -> None:
        self.expired.set()
        # The TCP socket, then the TLS one from the handshake on; None before TCP connects.
        sock = self._connection.sock
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass  # already closed


def _read(response: http.client.HTTPResponse) -> tuple[bytes, bool]:
    """Up to RESPONSE_BODY_LIMIT bytes of the body, and whether there was more."""
    chunks: list[bytes] = []
    size = 0
    while size <= RESPONSE_BODY_LIMIT:
        # read1 returns whatever arrived; read(n) would wait for all n bytes.
        chunk = response.read1(min(_READ_CHUNK, RESPONSE_BODY_LIMIT + 1 - size))
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
    body = b"".join(chunks)
    return body[:RESPONSE_BODY_LIMIT], size > RESPONSE_BODY_LIMIT


def _size(size: int) -> str:
    return f"{size / (1024 * 1024):g} MB" if size >= 1024 * 1024 else f"{size:,} bytes"


def _text(body: bytes, *, complete: bool) -> str | None:
    """The body as text when it is UTF-8, or None. A cut-off body can end inside a character: that one is left out."""
    try:
        return codecs.getincrementaldecoder("utf-8")().decode(body, final=complete)
    except UnicodeDecodeError:
        return None


def _timed_out(origin: str) -> ClassifiedError:
    return ClassifiedError(
        ErrorKind.OTHER,
        f"{origin} didn't answer within {RESPONSE_TIMEOUT:g} seconds.",
        hint=_SLOW_HINT,
    )


def _failure(origin: str, exc: BaseException, *, connecting: bool, connect_timeout: float) -> ClassifiedError:
    prefix = f"StackPort couldn't reach {origin}" if connecting else f"{origin} didn't answer"
    if isinstance(exc, ssl.SSLCertVerificationError):
        return ClassifiedError(ErrorKind.TLS, f"{prefix}: StackPort doesn't trust its TLS certificate.", hint=_TLS_HINT, cause=str(exc))
    if isinstance(exc, ssl.SSLError):
        return ClassifiedError(ErrorKind.TLS, f"{prefix}: the TLS handshake failed.", hint=_TLS_HINT, cause=str(exc))
    if isinstance(exc, socket.gaierror):
        return ClassifiedError(ErrorKind.UNREACHABLE, f"{prefix}: StackPort can't resolve that host name.", cause=str(exc))
    if isinstance(exc, TimeoutError):
        if connecting:
            return ClassifiedError(ErrorKind.UNREACHABLE, f"{prefix}: it didn't accept the connection within {connect_timeout:g} seconds.")
        return _timed_out(origin)
    if isinstance(exc, ConnectionRefusedError):
        return ClassifiedError(ErrorKind.UNREACHABLE, f"{prefix}: the connection was refused.", cause=str(exc))
    if isinstance(exc, http.client.HTTPException):
        return ClassifiedError(ErrorKind.OTHER, f"{prefix} with a valid HTTP response.", cause=repr(exc))
    return ClassifiedError(ErrorKind.UNREACHABLE if connecting else ErrorKind.OTHER, f"{prefix}: {exc}.", cause=str(exc))
