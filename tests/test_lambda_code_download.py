"""Downloading a Lambda function's code package through StackPort.

On AWS the route redirects to the pre-signed URL that GetFunction returns. For an
emulator it fetches that URL itself and streams it back, so these tests stand up
a real HTTP(S) server as the pre-signed target and stub only boto3's GetFunction.
"""

import io
import random
import shutil
import socket
import ssl
import subprocess
import threading
import zipfile
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode, urlsplit

import anyio
import boto3
import pytest
from botocore.stub import Stubber
from fastapi.testclient import TestClient

from backend import config
from backend.connection import EndpointInfo
from backend.main import app
from backend.routes import lambda_svc
from backend.routes.common import get_endpoint_info

client = TestClient(app)

LOCAL_ENDPOINT = "http://localhost:4566"
AWS_ENDPOINT = "https://lambda.us-east-1.amazonaws.com"
FUNCTION = "my-func"
CODE_PATH = "/awslambda-us-east-1-tasks/snapshots/000000000000/my-func-6f2b"
PRESIGNED_QUERY = "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=600&X-Amz-Signature=0123abcd"
COMPOSE_HINT = "A Docker Compose service name, for example, only resolves inside its Compose network."


def _package() -> bytes:
    """A real zip, with an incompressible file so it spans several relay chunks."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        stamp = (2026, 1, 1, 0, 0, 0)
        archive.writestr(zipfile.ZipInfo("handler.py", stamp), "def main(event, context):\n    return {'ok': True}\n")
        archive.writestr(zipfile.ZipInfo("vendor/blob.bin", stamp), random.Random(0).randbytes(300_000))
    return buffer.getvalue()


PACKAGE = _package()


# --- the pre-signed target -----------------------------------------------------

Respond = Callable[[BaseHTTPRequestHandler], None]


class Upstream:
    """A real HTTP(S) server standing in for the code location an emulator returns."""

    def __init__(self, tls: ssl.SSLContext | None = None):
        self.routes: dict[str, Respond] = {}
        self.requests: list[str] = []
        # Set when StackPort closes a connection this server was still writing to.
        self.aborted = threading.Event()
        upstream = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            timeout = 10  # a connection StackPort never closes fails the test instead of hanging it

            def do_GET(self) -> None:
                upstream.requests.append(self.path)
                respond = upstream.routes.get(urlsplit(self.path).path)
                if respond is None:
                    self.send_error(404)
                else:
                    respond(self)

            def log_message(self, format: str, *args: Any) -> None:
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        if tls is not None:
            self._server.socket = tls.wrap_socket(self._server.socket, server_side=True)
        self.origin = f"{'https' if tls else 'http'}://127.0.0.1:{self._server.server_address[1]}"
        self._thread = threading.Thread(target=self._server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self._thread.start()

    def url(self, path: str = CODE_PATH) -> str:
        return f"{self.origin}{path}{PRESIGNED_QUERY}"

    def serve(self, body: bytes, *, path: str = CODE_PATH, chunked: bool = False) -> None:
        def respond(handler: BaseHTTPRequestHandler) -> None:
            handler.send_response(200)
            handler.send_header("Content-Type", "application/zip")
            handler.send_header(*(("Transfer-Encoding", "chunked") if chunked else ("Content-Length", str(len(body)))))
            handler.end_headers()
            handler.wfile.write(b"%x\r\n%s\r\n0\r\n\r\n" % (len(body), body) if chunked else body)

        self.routes[path] = respond

    def fail(self, status: int, *, path: str = CODE_PATH) -> None:
        self.routes[path] = lambda handler: handler.send_error(status)

    def redirect(self, to: str, *, path: str = CODE_PATH) -> None:
        def respond(handler: BaseHTTPRequestHandler) -> None:
            handler.send_response(302)
            handler.send_header("Location", to)
            handler.send_header("Content-Length", "0")
            handler.end_headers()

        self.routes[path] = respond

    def stream_until_closed(self, *, path: str = CODE_PATH) -> None:
        """Send a chunked body that never ends, until the reader closes the connection."""
        chunk = bytes(64 * 1024)
        frame = b"%x\r\n%s\r\n" % (len(chunk), chunk)

        def respond(handler: BaseHTTPRequestHandler) -> None:
            handler.send_response(200)
            handler.send_header("Transfer-Encoding", "chunked")
            handler.end_headers()
            try:
                while True:
                    handler.wfile.write(frame)
            except TimeoutError:
                raise
            except OSError:
                self.aborted.set()

        self.routes[path] = respond

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()


@pytest.fixture
def upstream() -> Iterator[Upstream]:
    server = Upstream()
    yield server
    server.close()


_OPENSSL_CONFIG = """\
[req]
distinguished_name = dn
prompt = no
[dn]
CN = StackPort test
[ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[server]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:127.0.0.1, DNS:localhost
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
"""


@pytest.fixture(scope="session")
def tls_dir(tmp_path_factory) -> Path:
    """A CA and a server certificate it signed for 127.0.0.1, like AWS Emulator's ca.pem and certificate."""
    openssl = shutil.which("openssl")
    if openssl is None:
        pytest.skip("the openssl command is needed to make a test certificate")
    directory = tmp_path_factory.mktemp("tls")
    (directory / "openssl.cnf").write_text(_OPENSSL_CONFIG)

    def run(*args: str) -> None:
        subprocess.run([openssl, *args], cwd=directory, check=True, capture_output=True)

    common = ("-newkey", "rsa:2048", "-nodes", "-config", "openssl.cnf")
    run("req", "-x509", "-new", *common, "-keyout", "ca.key", "-out", "ca.pem", "-days", "1",
        "-extensions", "ca", "-subj", "/CN=StackPort test CA")
    run("req", "-new", *common, "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=127.0.0.1")
    run("x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-set_serial", "1",
        "-out", "server.pem", "-days", "1", "-extfile", "openssl.cnf", "-extensions", "server")
    return directory


@pytest.fixture
def https_upstream(tls_dir) -> Iterator[Upstream]:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(tls_dir / "server.pem", tls_dir / "server.key")
    server = Upstream(tls=context)
    yield server
    server.close()


# --- StackPort's side ----------------------------------------------------------


@pytest.fixture(autouse=True)
def isolated_trust(monkeypatch, tmp_path):
    """No AWS_CA_BUNDLE and no AWS Emulator files unless a test sets them up."""
    monkeypatch.delenv("AWS_CA_BUNDLE", raising=False)
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path / "no-emulator")


class GetFunction:
    """Stubs GetFunction on a real boto3 client, so everything after it runs for real."""

    def __init__(self, stubber: Stubber):
        self._stubber = stubber

    def returns_code_at(self, location: str | None, *, name: str = FUNCTION, requested: str | None = None,
                        package_type: str = "Zip") -> None:
        code = {"RepositoryType": "ECR", "ImageUri": "000000000000.dkr.ecr.us-east-1.amazonaws.com/fn:latest"}
        if package_type == "Zip":
            code = {"RepositoryType": "S3", **({"Location": location} if location else {})}
        self._stubber.add_response(
            "get_function",
            {"Configuration": {"FunctionName": name, "PackageType": package_type}, "Code": code},
            {"FunctionName": requested or name},
        )

    def fails(self, code: str, status: int) -> None:
        self._stubber.add_client_error(
            "get_function", service_error_code=code, service_message=f"{code} from the endpoint", http_status_code=status
        )


@pytest.fixture
def get_function(monkeypatch) -> Iterator[GetFunction]:
    lambda_client = boto3.client(
        "lambda",
        region_name="us-east-1",
        endpoint_url=LOCAL_ENDPOINT,
        aws_access_key_id="test",
        aws_secret_access_key="test",
    )

    def get_client(service_name: str, **_kwargs: Any):
        assert service_name == "lambda"
        return lambda_client

    monkeypatch.setattr(lambda_svc, "get_client", get_client)
    with Stubber(lambda_client) as stubber:
        yield GetFunction(stubber)
        stubber.assert_no_pending_responses()


@pytest.fixture
def endpoint() -> Iterator[Callable[[EndpointInfo], None]]:
    """Use connection settings a direct ``?endpoint=`` URL can't carry (a CA bundle, verification off)."""

    def use(info: EndpointInfo) -> None:
        app.dependency_overrides[get_endpoint_info] = lambda: info

    yield use
    app.dependency_overrides.pop(get_endpoint_info, None)


def download(function: str = FUNCTION, endpoint_url: str | None = LOCAL_ENDPOINT, *, saved: bool = True, **kwargs: Any):
    """Download through the route, as if ``endpoint_url`` were a saved endpoint (what the UI uses).

    ``saved=False`` passes it as a direct ``?endpoint=`` URL instead.
    """
    path = f"/api/lambda/functions/{quote(function, safe='')}/code"
    if endpoint_url is None:
        return client.get(path, **kwargs)
    if not saved:
        return client.get(path, params={"endpoint": endpoint_url}, **kwargs)
    app.dependency_overrides[get_endpoint_info] = lambda: EndpointInfo(url=endpoint_url, region=None, saved=True)
    try:
        return client.get(path, **kwargs)
    finally:
        app.dependency_overrides.pop(get_endpoint_info, None)


# --- tests ----------------------------------------------------------------------


class TestEmulatorDownload:
    def test_streams_the_package_as_a_zip_attachment(self, get_function, upstream):
        upstream.serve(PACKAGE)
        get_function.returns_code_at(upstream.url())

        resp = download(endpoint_url=upstream.origin)

        assert resp.status_code == 200
        assert resp.content == PACKAGE
        assert resp.headers["content-type"] == "application/zip"
        assert resp.headers["content-disposition"] == 'attachment; filename="my-func.zip"'
        assert resp.headers["content-length"] == str(len(PACKAGE))
        # The pre-signed URL is requested as given, signature and all.
        assert upstream.requests == [CODE_PATH + PRESIGNED_QUERY]
        with zipfile.ZipFile(io.BytesIO(resp.content)) as archive:
            assert archive.read("handler.py").startswith(b"def main(event, context):")

    def test_streams_a_package_sent_without_a_length(self, get_function, upstream):
        upstream.serve(PACKAGE, chunked=True)
        get_function.returns_code_at(upstream.url())

        resp = download(endpoint_url=upstream.origin)

        assert resp.status_code == 200
        assert resp.content == PACKAGE
        assert "content-length" not in resp.headers

    def test_names_the_file_after_the_function_when_asked_by_arn(self, get_function, upstream):
        arn = f"arn:aws:lambda:us-east-1:000000000000:function:{FUNCTION}"
        upstream.serve(PACKAGE)
        get_function.returns_code_at(upstream.url(), requested=arn)

        resp = download(arn, endpoint_url=upstream.origin)

        assert resp.status_code == 200
        assert resp.headers["content-disposition"] == 'attachment; filename="my-func.zip"'

    def test_unusual_function_name_cannot_break_the_header(self, get_function, upstream):
        name = 'naïve "fn";\r\nv2'
        upstream.serve(PACKAGE)
        get_function.returns_code_at(upstream.url(), name=name)

        resp = download(name, endpoint_url=upstream.origin)

        assert resp.status_code == 200
        assert resp.headers["content-disposition"] == (
            "attachment; filename=\"na_ve__fn____v2.zip\"; filename*=UTF-8''na%C3%AFve%20%22fn%22%3B%0D%0Av2.zip"
        )
        assert resp.content == PACKAGE


class TestOnlyTheEndpointIsFetched:
    """A GetFunction answer must never make StackPort read a URL other than the endpoint's."""

    def test_location_on_another_port_is_left_to_the_browser(self, get_function, upstream):
        # e.g. an endpoint that answers with the address of some other service on this machine
        upstream.serve(b"INTERNAL")
        get_function.returns_code_at(upstream.url())

        resp = download(endpoint_url="http://127.0.0.1:1", follow_redirects=False)

        assert resp.status_code == 307
        assert resp.headers["location"] == upstream.url()
        assert upstream.requests == []

    @pytest.mark.parametrize(
        "location",
        [
            "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
            "http://internal.corp:4566/code.zip",
            "https://127.0.0.1:4566/code.zip",  # same host and port, other scheme
        ],
    )
    def test_other_hosts_and_schemes_are_never_fetched(self, get_function, location, monkeypatch):
        def no_network(*_args, **_kwargs):
            raise AssertionError("StackPort tried to fetch the location itself")

        monkeypatch.setattr(lambda_svc, "_open_code_location", no_network)
        get_function.returns_code_at(location)

        resp = download(endpoint_url="http://localhost:4566", follow_redirects=False)

        assert resp.status_code == 307
        assert resp.headers["location"] == location

    def test_localhost_and_127_0_0_1_are_the_same_server(self, get_function, upstream):
        upstream.serve(PACKAGE)
        get_function.returns_code_at(upstream.url())

        resp = download(endpoint_url=upstream.origin.replace("127.0.0.1", "localhost"))

        assert resp.status_code == 200
        assert resp.content == PACKAGE

    def test_loopback_location_moves_onto_the_endpoints_host(self, get_function, upstream, monkeypatch):
        # MiniStack in Compose: StackPort reaches it as ministack:4566, and it
        # answers with localhost:4566, which inside StackPort's container is StackPort.
        port = int(upstream.origin.rsplit(":", 1)[1])
        resolve = socket.getaddrinfo

        def getaddrinfo(host, *args, **kwargs):
            return resolve("127.0.0.1" if host == "ministack" else host, *args, **kwargs)

        monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
        upstream.serve(PACKAGE)
        get_function.returns_code_at(f"http://localhost:{port}{CODE_PATH}{PRESIGNED_QUERY}")

        resp = download(endpoint_url=f"http://ministack:{port}")

        assert resp.status_code == 200
        assert resp.content == PACKAGE
        assert upstream.requests == [CODE_PATH + PRESIGNED_QUERY]


class TestDirectEndpointUrls:
    """A URL passed straight in ``?endpoint=`` could point StackPort anywhere."""

    def test_location_is_left_to_the_browser(self, get_function, upstream):
        upstream.serve(PACKAGE)
        get_function.returns_code_at(upstream.url())

        resp = download(endpoint_url=upstream.origin, saved=False, follow_redirects=False)

        assert resp.status_code == 307
        assert resp.headers["location"] == upstream.url()
        assert upstream.requests == []

    @pytest.mark.parametrize(
        "endpoint_url",
        ["http://attacker.test:1\\@127.0.0.1:2", "http://user@127.0.0.1:2", "http://127.0.0.1:2 /x"],
    )
    def test_ambiguous_endpoint_urls_are_refused(self, endpoint_url):
        resp = download(endpoint_url=endpoint_url, saved=False)
        assert resp.status_code == 422


class TestAwsDownload:
    def test_redirects_to_the_presigned_url_without_fetching_it(self, get_function, upstream):
        upstream.serve(PACKAGE)
        get_function.returns_code_at(upstream.url())

        resp = download(endpoint_url=AWS_ENDPOINT, follow_redirects=False)

        assert resp.status_code == 307
        assert resp.headers["location"] == upstream.url()
        assert upstream.requests == []


class TestUnavailablePackage:
    def test_container_image_function(self, get_function):
        get_function.returns_code_at(None, package_type="Image")

        resp = download()

        assert resp.status_code == 400
        assert resp.json() == {"detail": "Cannot download code for container image functions"}

    def test_missing_function(self, get_function):
        get_function.fails("ResourceNotFoundException", 404)

        resp = download()

        assert resp.status_code == 404
        assert resp.json() == {"detail": f"Function {FUNCTION} not found"}

    def test_no_code_location(self, get_function):
        get_function.returns_code_at(None)

        resp = download()

        assert resp.status_code == 404
        assert resp.json() == {"detail": "Code location not available"}

    def test_get_function_failure_keeps_its_classification(self, get_function):
        get_function.fails("UnrecognizedClientException", 403)

        resp = download()

        assert resp.status_code == 401
        body = resp.json()
        assert body["error"]["kind"] == "credentials"
        assert body["error"]["operation"] == "GetFunction"


class TestUpstreamFailures:
    @pytest.mark.parametrize(("status", "reason"), [(404, "Not Found"), (500, "Internal Server Error")])
    def test_error_status(self, get_function, upstream, status, reason):
        upstream.fail(status)
        get_function.returns_code_at(upstream.url())

        resp = download(endpoint_url=upstream.origin)

        assert resp.status_code == 502
        assert resp.json() == {
            "detail": f"StackPort couldn't fetch the code package from {upstream.origin}: it answered HTTP {status} {reason}.",
            "error": {
                "kind": "other",
                "message": f"StackPort couldn't fetch the code package from {upstream.origin}: it answered HTTP {status} {reason}.",
            },
        }

    def test_redirect_is_not_followed(self, get_function, upstream):
        upstream.serve(PACKAGE, path="/elsewhere")
        upstream.redirect(upstream.url("/elsewhere"))
        get_function.returns_code_at(upstream.url())

        resp = download(endpoint_url=upstream.origin)

        assert resp.status_code == 502
        assert resp.json()["detail"].endswith(": it answered HTTP 302 Found.")
        assert upstream.requests == [CODE_PATH + PRESIGNED_QUERY]

    def test_nothing_listening(self, get_function):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        get_function.returns_code_at(f"http://127.0.0.1:{port}{CODE_PATH}{PRESIGNED_QUERY}")

        resp = download(endpoint_url=f"http://127.0.0.1:{port}")

        assert resp.status_code == 502
        error = resp.json()["error"]
        assert error["kind"] == "unreachable"
        assert error["message"] == f"StackPort couldn't fetch the code package from http://127.0.0.1:{port}: the connection was refused."
        assert error["hint"].endswith(COMPOSE_HINT)
        assert "Connection refused" in error["cause"]

    def test_compose_host_name_that_does_not_resolve(self, get_function, monkeypatch):
        resolve = socket.getaddrinfo

        def getaddrinfo(host, *args, **kwargs):
            if host == "floci":
                raise socket.gaierror(socket.EAI_NONAME, "nodename nor servname provided, or not known")
            return resolve(host, *args, **kwargs)

        monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
        get_function.returns_code_at(f"http://floci:4566{CODE_PATH}{PRESIGNED_QUERY}")

        resp = download(endpoint_url="http://floci:4566")

        assert resp.status_code == 502
        body = resp.json()
        assert body["detail"] == "StackPort couldn't fetch the code package from http://floci:4566: StackPort can't resolve that host name."
        assert body["error"]["kind"] == "unreachable"
        assert body["error"]["hint"].endswith(COMPOSE_HINT)

    def test_server_that_never_answers(self, get_function, monkeypatch):
        monkeypatch.setattr(lambda_svc, "CODE_FETCH_TIMEOUT_SECONDS", 0.2)
        # The kernel completes the connection, then nothing ever reads the request.
        with socket.create_server(("127.0.0.1", 0)) as silent:
            origin = f"http://127.0.0.1:{silent.getsockname()[1]}"
            get_function.returns_code_at(f"{origin}{CODE_PATH}{PRESIGNED_QUERY}")

            resp = download(endpoint_url=origin)

        assert resp.status_code == 502
        error = resp.json()["error"]
        assert error["kind"] == "unreachable"
        assert error["message"] == f"StackPort couldn't fetch the code package from {origin}: it didn't answer within 0.2 seconds."

    @pytest.mark.parametrize(
        ("location", "shown"),
        [
            (
                "s3://awslambda-us-east-1-tasks.s3-us-east-1.amazonaws.com/snapshots/my-func?X-Amz-Signature=0123abcd",
                "s3://awslambda-us-east-1-tasks.s3-us-east-1.amazonaws.com/snapshots/my-func",
            ),
            ("file:///etc/passwd", "file:///etc/passwd"),
            ("http://[::1/code.zip", "a malformed URL"),
        ],
    )
    def test_location_that_is_not_an_http_url(self, get_function, location, shown):
        get_function.returns_code_at(location)

        resp = download()

        assert resp.status_code == 502
        assert resp.json() == {
            "detail": (
                f"StackPort can't download the code package: the endpoint gave {shown} as its location, "
                "and StackPort only fetches http and https URLs."
            ),
            "error": {
                "kind": "other",
                "message": (
                    f"StackPort can't download the code package: the endpoint gave {shown} as its location, "
                    "and StackPort only fetches http and https URLs."
                ),
            },
        }

    @pytest.mark.parametrize(("path", "reason"), [("/código.zip", "can't encode"), ("/code zip", "control characters")])
    def test_location_the_http_client_cannot_send(self, get_function, upstream, path, reason):
        get_function.returns_code_at(f"{upstream.origin}{path}")

        resp = download(endpoint_url=upstream.origin)

        assert resp.status_code == 502
        error = resp.json()["error"]
        assert error["kind"] == "other"
        assert error["message"].startswith(f"StackPort couldn't fetch the code package from {upstream.origin}: ")
        assert reason in error["message"]
        assert upstream.requests == []

    def test_declared_size_over_the_cap(self, get_function, upstream, monkeypatch):
        monkeypatch.setattr(lambda_svc, "CODE_PACKAGE_MAX_BYTES", len(PACKAGE) - 1)
        upstream.serve(PACKAGE)
        get_function.returns_code_at(upstream.url())

        resp = download(endpoint_url=upstream.origin)

        assert resp.status_code == 502
        assert resp.json()["detail"] == (
            f"StackPort didn't download the code package from {upstream.origin}: it is {len(PACKAGE):,} bytes, "
            f"and StackPort stops at {len(PACKAGE) - 1:,} bytes, more than any package Lambda accepts."
        )


class TestTlsTrust:
    """StackPort trusts exactly what boto3 trusts for the endpoint the code came from."""

    def test_aws_emulator_ca_is_trusted(self, get_function, https_upstream, tls_dir, tmp_path, monkeypatch):
        emulator_dir = tmp_path / "emulator"
        run_dir = emulator_dir / https_upstream.origin.rsplit(":", 1)[1]
        run_dir.mkdir(parents=True)
        shutil.copy(tls_dir / "ca.pem", run_dir / "ca.pem")
        monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", emulator_dir)
        https_upstream.serve(PACKAGE)
        get_function.returns_code_at(https_upstream.url())

        resp = download(endpoint_url=https_upstream.origin)

        assert resp.status_code == 200
        assert resp.content == PACKAGE

    def test_endpoint_ca_bundle_is_trusted(self, get_function, https_upstream, tls_dir, endpoint):
        endpoint(EndpointInfo(url=https_upstream.origin, region=None, ca_bundle=str(tls_dir / "ca.pem"), saved=True))
        https_upstream.serve(PACKAGE)
        get_function.returns_code_at(https_upstream.url())

        resp = download(endpoint_url=None)

        assert resp.status_code == 200
        assert resp.content == PACKAGE

    def test_verification_off_for_the_endpoint(self, get_function, https_upstream, endpoint):
        endpoint(EndpointInfo(url=https_upstream.origin, region=None, tls_verify=False, saved=True))
        https_upstream.serve(PACKAGE)
        get_function.returns_code_at(https_upstream.url())

        resp = download(endpoint_url=None)

        assert resp.status_code == 200
        assert resp.content == PACKAGE

    def test_untrusted_certificate(self, get_function, https_upstream):
        https_upstream.serve(PACKAGE)
        get_function.returns_code_at(https_upstream.url())

        resp = download(endpoint_url=https_upstream.origin)

        assert resp.status_code == 502
        error = resp.json()["error"]
        assert error["kind"] == "tls"
        assert error["message"] == (
            f"StackPort couldn't fetch the code package from {https_upstream.origin}: "
            "it doesn't trust the server's TLS certificate."
        )
        assert "CERTIFICATE_VERIFY_FAILED" in error["cause"]
        assert https_upstream.requests == []


async def _call_app(sent: list[dict], endpoint_url: str, *, disconnect_after_first_chunk: bool) -> None:
    """Run one download through the whole app over ASGI, the way uvicorn does, recording what it sends.

    TestClient collects the whole body before returning, so it can't show what
    happens when the client goes away halfway through. The upstream never stops
    sending, so a regression fails on the time limit instead of hanging.
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

    path = f"/api/lambda/functions/{FUNCTION}/code"
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": b"",
        "headers": [(b"host", b"testserver")],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
        "state": {},
    }
    with anyio.fail_after(10):
        app.dependency_overrides[get_endpoint_info] = lambda: EndpointInfo(url=endpoint_url, region=None, saved=True)
        try:
            await app(scope, receive, send)
        finally:
            app.dependency_overrides.pop(get_endpoint_info, None)


def _relayed(sent: list[dict]) -> int:
    return sum(len(message.get("body", b"")) for message in sent if message["type"] == "http.response.body")


class TestStreaming:
    @pytest.mark.anyio
    async def test_size_cap_is_enforced_while_streaming(self, get_function, upstream, monkeypatch):
        cap = 200_000
        monkeypatch.setattr(lambda_svc, "CODE_PACKAGE_MAX_BYTES", cap)
        upstream.stream_until_closed()
        get_function.returns_code_at(upstream.url())
        sent: list[dict] = []

        with pytest.raises(lambda_svc.CodePackageTooLarge):
            await _call_app(sent, upstream.origin, disconnect_after_first_chunk=False)

        assert sent[0]["type"] == "http.response.start" and sent[0]["status"] == 200
        assert 0 < _relayed(sent) <= cap
        assert await anyio.to_thread.run_sync(upstream.aborted.wait, 5)

    @pytest.mark.anyio
    async def test_client_going_away_closes_the_upstream(self, get_function, upstream):
        upstream.stream_until_closed()
        get_function.returns_code_at(upstream.url())
        sent: list[dict] = []

        await _call_app(sent, upstream.origin, disconnect_after_first_chunk=True)

        assert _relayed(sent) > 0
        assert await anyio.to_thread.run_sync(upstream.aborted.wait, 5)
